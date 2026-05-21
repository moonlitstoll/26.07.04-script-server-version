import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractOriginalAudio } from "../utils/audioExtractor";
import { STAGE1_PROMPT, STAGE2_PROMPT, STAGE2_BATCH_PROMPT } from "./prompts";
import { analyzeIntraLineRepetition } from "../utils/languageUtils";

const VALID_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2-flash", "gemini-3.5-flash"];

const resolveModel = (modelId) =>
    VALID_MODELS.find(m => m === modelId) || "gemini-2.5-flash";


async function fileToGenerativePart(file) {
    const isVideo = file.type && file.type.startsWith('video/');
    const isAudio = file.type && file.type.startsWith('audio/');

    // [FFmpeg 단일 스레드 오디오 100% 무변환 적출 (Demuxing)]
    // 리샘플링/디코딩/인코딩을 거치지 않아 원본의 피치와 타임라인이 0.1%도 왜곡되지 않음
    console.log(`[Stage 1] Extracting demuxed original audio from ${file.type} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`);
    try {
        const audioBlob = await extractOriginalAudio(file);
        console.log(`[Stage 1] Demuxing complete: ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB`);

        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onloadend = () => resolve({
                inlineData: {
                    data: reader.result.split(',')[1],
                    mimeType: audioBlob.type || 'audio/aac'
                }
            });
            reader.onerror = reject;
            reader.readAsDataURL(audioBlob);
        });
    } catch (err) {
        console.warn('[Stage 1] Native audio extraction failed, falling back to original:', err.message);
    }

    // [폴백] -> 원본 그대로 전송
    console.log(`[Stage 1] Sending original fallback (${(file.size / 1024 / 1024).toFixed(1)}MB, ${file.type})`);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            resolve({
                inlineData: {
                    data: reader.result.split(',')[1],
                    mimeType: file.type || 'audio/mpeg'
                }
            });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}


const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
];

export async function extractTranscript(file, apiKey, modelId = "gemini-2.5-flash", totalDuration = 0, onProgress = null, temperature = 0.5, topP = 0.7) {
    if (!apiKey) throw new Error("API Key is required");
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = resolveModel(modelId);

    console.log(`[Stage 1] Streaming Analysis with Circuit Breaker, model: ${modelName} `);

    try {
        const mediaData = await fileToGenerativePart(file);
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                // [2단계 문맥 균형형] 사용자가 설정한 온도 반영 (기본 0.5)
                temperature: temperature || 0.5,
                // [2단계 문맥 균형형] 사용자가 설정한 후보 샘플링 반영 (기본 0.7)
                topP: topP || 0.7,
                maxOutputTokens: 65536,
                ...(modelName.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
            },
            safetySettings
        }, { apiVersion: "v1beta" });

        let dynamicPrompt = STAGE1_PROMPT;
        if (totalDuration > 0) {
            // Helper function to format seconds into HH:MM:SS.ms
            const formatTime = (seconds) => {
                const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
                const s = Math.floor(seconds % 60).toString().padStart(2, '0');
                const m = Math.floor((seconds / 60) % 60).toString().padStart(2, '0');
                const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
                return `${h}:${m}:${s}.${ms}`;
            };
            dynamicPrompt += `\n[미디어 길이 정보] 00:00:00.000부터 ${formatTime(totalDuration)}까지의 전체 분량에 대해 타임스탬프를 작성하세요.\n`;
        }

        // 맹인 모드: 모든 파일(비디오 오픈, 오디오 오픈 공통)은 오직 '소리'만 전달됨
        const audioOnlyPrompt = `
[특별 주의 사항]
본 데이터는 시각 단서(화면)가 전혀 없는 순수 오디오 데이터입니다. 화면을 묘사하거나 시각적 행동을 추론하려 하지 마십시오.
화자의 미세한 톤 변화, 숨소리, 억양 등 오직 '청각적 단서'에만 100% 의존해서 대화의 문맥을 파악하고 전사하십시오.
`;
        dynamicPrompt += audioOnlyPrompt;

        dynamicPrompt += `
[필독: 영상 정보 및 절대 규칙]
이 영상의 실제 총 재생 길이는 ${totalDuration.toFixed(1)}초 입니다.
영상이 길더라도 처음(0초)부터 끝(${totalDuration.toFixed(1)}초)까지 빠짐없이 모든 대사를 전사하십시오.
여러분이 생성하는 타임라인(예: [02:30.50])이 영상의 총 길이를 절대 초과해서는 안 됩니다.
실제 음성이 종료되었거나 ${totalDuration.toFixed(1)}초 근방에 도달했다면, 무의미한 텍스트(환각)를 절대 지어내지 말고 즉각 \`[END_OF_AUDIO]\`를 한 줄 출력한 뒤 출력을 완전히 멈추십시오.
`;

        const streamResult = await model.generateContentStream([mediaData, dynamicPrompt]);

        let fullText = "";
        let allMatches = [];
        let lastSentences = [];
        const historyCache = new Map();
        let lastProgressTime = 0;
        const PROGRESS_INTERVAL = 500; // 500ms 쓰로틀: 과다 리렌더링 방지

        // [MM:SS.cc] [화자 라벨] || 텍스트 정규식 파서
        // [수정점] 문장 분리가 많아짐에 따라 앞에 붙는 기호나 괄호 처리를 더 유연하게 개선
        const lineRegex = /^[\s\-*>#]*(?:\[)?(\d+:[0-9.]+)(?:\])?\s*(?:\[([^\]]+)\])?\s*(?:\|\||-\s*|\||:)?\s*(.+)/;

        // [C안] 화면 텍스트 및 비음성 묘사 필터 패턴: 제목, 자막 라벨, 음악/소음 표시 등 제거
        // 괄호([]) 캡션 내부에 대사가 아닌 '묘사' 혹은 특정 키워드가 포함된 경우 필터링 (다국어 대응)
        const screenTextPatterns = /^(Phim:|Film:|Movie:|Sub:|Subtitle:|Nguồn:|Source:|[[({]?(Music|Nhạc|음악|Sound|Effect|Laughter|Applause|Noise|Silence|tiếng|background|audio|động|thanh)[[)}]?)[:\s-]*$/i;

        // 추가적인 괄호 전용 필터: [Music], (Laughter) 등 괄호로만 감싸진 단답형 묘사 차단
        const bracketDescriptionPattern = /^[[({][^\]})]+[\]})]$/i;

        // [C안] 타임스탬프 역행 방지용 마지막 유효 시간 추적
        let lastValidTime = -1;

        // 줄 파싱 헬퍼 함수 (증분/잔여 공통 사용)
        const parseLine = (line) => {
            const match = line.match(lineRegex);
            if (!match) return null;

            let rawTimeStr = match[1];
            let speaker = match[2] ? match[2].trim() : ""; // Capture group 2 for speaker
            let content = match[3].trim(); // Capture group 3 for content
            if (!content || content.length < 2) return null;

            // [C안] 화면 텍스트 필터: 제목, 자막 라벨, 음악 표시 등 제거
            if (screenTextPatterns.test(content)) return null;

            // [강화] 모든 형태의 괄호 묘사([tiếng nhạc] 등) 단독 출력 차단
            if (bracketDescriptionPattern.test(content)) return null;

            const analysisResult = analyzeIntraLineRepetition(content);
            if (analysisResult.status === "BLOCKED") {
                content = analysisResult.refined_text;
            } else if (analysisResult.status === "TRUNCATED") {
                content = analysisResult.refined_text;
            }
            if (!content) return null;

            let currentTime = 0;
            const parts = rawTimeStr.replace(/[^\d:.]/g, '').split(':').reverse();
            if (parts.length >= 2) {
                const ss = parseFloat(parts[0]) || 0;
                const mm = parseFloat(parts[1]) || 0;
                const hh = parseFloat(parts[2]) || 0;
                currentTime = (hh * 3600) + (mm * 60) + ss;
            } else {
                currentTime = parseFloat(parts[0]) || 0;
            }

            // [방어망 2] 하드 리미트: 영상 총 길이 + 5초 초과 시 폐기
            if (totalDuration > 0 && currentTime > totalDuration + 5.0) return null;

            // [C안 순정 유지] 타임스탬프 역행 방지: 이전 유효 시간보다 뒤로 가면 최소한(0.1초) 보정
            if (lastValidTime >= 0 && currentTime < lastValidTime) {
                currentTime = lastValidTime + 0.1;
            }
            lastValidTime = currentTime;

            const normalizedContent = content.toLowerCase().trim();

            // 2중 방어망: 짧은 문구 연속 중복(환각) 방지
            if (normalizedContent.length <= 50) {
                if (historyCache.has(normalizedContent)) {
                    const lastSeenTime = historyCache.get(normalizedContent);
                    if (currentTime - lastSeenTime < 5.0) return null;
                }
                historyCache.set(normalizedContent, currentTime);
            }

            // 3중 방어망: 직전 5문장과 중복되는 환각 텍스트 배제
            if (lastSentences.some(s => s === normalizedContent)) return null;
            lastSentences.push(normalizedContent);
            if (lastSentences.length > 5) lastSentences.shift();

            const outMm = Math.floor(currentTime / 60).toString().padStart(2, '0');
            const outSs = (currentTime % 60).toFixed(2).padStart(5, '0');
            const timeStr = `${outMm}:${outSs}`;

            return {
                s: timeStr,
                o: content,
                timestamp: timeStr,
                seconds: currentTime,
                startSeconds: currentTime,
                text: content,
                translation: "",
                a: "",
                isAnalyzed: false
            };
        };

        for await (const chunk of streamResult.stream) {
            const chunkText = chunk.text();
            if (!chunkText) continue;
            fullText += chunkText;

            // [방어망 1] AI 종료 마커 감지 — 영상의 90% 이상 전사된 경우에만 존중 (조기 종료 방지)
            if (fullText.includes('[END_OF_AUDIO]')) {
                const lastMatch = allMatches[allMatches.length - 1];
                const lastTime = lastMatch ? lastMatch.seconds : 0;
                const progressRatio = totalDuration > 0 ? lastTime / totalDuration : 1;
                if (progressRatio >= 0.9) {
                    console.log(`[Stage 1] END_OF_AUDIO at ${(progressRatio * 100).toFixed(0)}% progress. Stopping stream.`);
                    break;
                } else {
                    console.log(`[Stage 1] END_OF_AUDIO detected too early (${(progressRatio * 100).toFixed(0)}%). Ignoring and continuing...`);
                    // 마커를 제거하여 다음 chunk에서 재감지 방지
                    fullText = fullText.replace('[END_OF_AUDIO]', '');
                }
            }

            // [증분 파싱] 완성된 줄만 처리, 마지막 미완성 줄은 다음 chunk로 이월
            const lines = fullText.split('\n');
            fullText = lines.pop() || ""; // 미완성 줄만 남김

            for (const line of lines) {
                const parsed = parseLine(line);
                if (parsed) allMatches.push(parsed);
            }

            // [쓰로틀된 프로그레스] 500ms 간격으로 UI 업데이트
            const now = Date.now();
            if (onProgress && allMatches.length > 0 && now - lastProgressTime > PROGRESS_INTERVAL) {
                lastProgressTime = now;
                onProgress([...allMatches]);
            }
        }

        // 스트림 종료 후 잔여 텍스트 처리
        if (fullText.trim()) {
            const parsed = parseLine(fullText);
            if (parsed) allMatches.push(parsed);
        }

        // 최종 프로그레스 콜백 (마지막 결과 반영 보장)
        if (onProgress && allMatches.length > 0) {
            onProgress([...allMatches]);
        }

        if (allMatches.length === 0) {
            console.error("[Stage 1] Analysis failed. AI Raw Output Sample:", fullText.substring(0, 500));
            throw new Error("API Error (Stage 1): No valid data found. Video might just be music/noise.");
        }

        // 정규화는 위에서 자체적으로 하였으므로 추출 데이터 그대로 반환
        return allMatches.sort((a, b) => a.seconds - b.seconds);
    } catch (err) {
        console.error(`Stage 1 Error: `, err);
        const errStr = String(err.message || err);
        if (errStr.includes("RECITATION")) {
            throw new Error("[오류: 저작권/표절 필터링] 오디오에 유명 노래 가사나 연설문 등 기존 데이터와 완벽히 일치하는 내용이 감지되어 구글 AI가 생성을 차단했습니다. 1. 이 오디오 특정 구간(노래 등)을 잘라내거나, 2. 다른 모델(예: 1.5 Pro)을 선택해서 시도해 보세요.");
        }
        if (errStr.includes("reading from the stream") || errStr.includes("QUIC")) {
            throw new Error("[오류: 구글 서버 네트워크 불안정] 해외 AI 서버로의 스트리밍 연결이 끊어졌습니다(QUIC Protocol Error). 잠시 후 다시 재생 버튼을 눌러 시도하거나 새로고침 후 진행해 주세요.");
        }
        throw new Error(`API Error (Stage 1): ${errStr}`);
    }
}

/**
 * [Stage 2] 여러 문장 일괄 분석 (Batch)
 */
export async function analyzeBatchSentences(items, apiKey, modelId, signal) {
    if (!apiKey) throw new Error("API Key is required");
    if (!items || items.length === 0) return [];
    const genAI = new GoogleGenerativeAI(apiKey);
    const resolvedModel = modelId || "gemini-2.5-flash";
    const model = genAI.getGenerativeModel({
        model: resolvedModel,
        generationConfig: { temperature: 0.3 },
        safetySettings
    });

    const inputContent = items.map(item => `문장(INDEX: ${item.index}): ${item.text} `).join('\n');
    const prompt = `${STAGE2_BATCH_PROMPT} \n\n분석할 문장 목록: \n${inputContent} `;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        }, { signal });

        const response = await result.response;
        const text = response.text();

        // 인덱스 마커별로 쪼개기
        const results = [];
        for (const item of items) {
            const startMarker = `--- [INDEX: ${item.index}] START ---`;
            const endMarker = `--- [INDEX: ${item.index}] END ---`;

            const startIndex = text.indexOf(startMarker);
            const endIndex = text.indexOf(endMarker);

            if (startIndex !== -1 && endIndex !== -1) {
                const subText = text.substring(startIndex + startMarker.length, endIndex);
                const translationMatch = subText.match(/\[번역\]\s*(.*)/);
                const analysisLines = [...subText.matchAll(/\[분석\]\s*(.*)/g)]
                    .map(m => m[1].replace(/^(청크|Analysis|분석|•|청크:|\[분석\])[:\s-]*/i, '').trim());

                results.push({
                    index: item.index,
                    translation: translationMatch ? translationMatch[1].trim() : "",
                    analysis: analysisLines.join("\n").trim()
                });
            } else {
                console.warn(`[Stage 2] Could not find markers for index ${item.index}`);
                results.push({ index: item.index, translation: "", analysis: "", failed: true });
            }
        }
        return results;
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.error(`[Stage 2] Batch analysis failed: `, error);
        return items.map(item => ({ index: item.index, failed: true }));
    }
}

/**
 * [Stage 2] 단일 문장 정밀 분석
 * 텍스트 마커를 사용하여 파싱 에러를 방지합니다.
 */
export async function analyzeSingleSentence(item, index, apiKey, modelId, signal) {
    if (!apiKey) throw new Error("API Key is required");
    const genAI = new GoogleGenerativeAI(apiKey);
    const resolvedModel = modelId || "gemini-2.5-flash";
    const model = genAI.getGenerativeModel({
        model: resolvedModel,
        generationConfig: { temperature: 0.3 },
        safetySettings
    });

    const prompt = `${STAGE2_PROMPT} \n\n분석할 문장(번호: ${index}): \n${item.text} `;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        }, { signal });

        const response = await result.response;
        const text = response.text();

        // 텍스트 마커 파싱 및 클리닝
        const translationMatch = text.match(/\[번역\]\s*(.*)/);
        const analysisLines = [...text.matchAll(/\[분석\]\s*(.*)/g)]
            .map(m => m[1].replace(/^(청크|Analysis|분석|•|청크:|\[분석\])[:\s-]*/i, '').trim());

        return {
            index,
            translation: translationMatch ? translationMatch[1].trim() : "",
            analysis: analysisLines.join("\n").trim()
        };
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.error(`[Stage 2] Failed sentence ${index}: `, error);
        return null;
    }
}

