import { useState, useRef } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { extractTranscript, analyzeBatchSentences, retranscribeSegments, deduplicateOverlap } from '../services/gemini';
import { parseCacheEntry, saveCacheEntry } from '../utils/cacheUtils';
import { uploadMedia as cloudUploadMedia, saveMeta as cloudSaveMeta } from '../services/cloudSync';
import { materializeFile } from '../utils/materializeFile';
import { getStage2Concurrency } from '../constants/models';
import { addToTrash, removeFromTrash, sentenceKey } from '../utils/trashUtils';

// 분석이 '뭉침/과편중'인지 감지: 모든 볼드 청크 중 '가장 큰 것'이 문장의 60% 이상을 덮으면 뭉침.
// (문장 전체를 1청크로 낸 경우뿐 아니라, 한 청크가 지나치게 큰 편중 분할도 재교정 대상에 포함)
// 짧은 문장(6단어 미만)은 1청크가 정상이라 제외. 💡패턴/⚡실제 태그는 원어 볼드가 아니라 영향 미미.
const NORM_WORDS = (t) => (t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const isLumpedAnalysis = (sentence, analysis) => {
    if (!analysis || !sentence) return false;
    const sw = NORM_WORDS(sentence);
    if (sw.length < 6) return false;
    const bolds = analysis.match(/\*\*(.+?)\*\*/g) || [];
    if (bolds.length === 0) return false;
    let maxCovered = 0;
    for (const b of bolds) {
        const cw = new Set(NORM_WORDS(b));
        if (cw.size === 0) continue;
        const covered = sw.filter(w => cw.has(w)).length / sw.length;
        if (covered > maxCovered) maxCovered = covered;
    }
    return maxCovered >= 0.6;
};

// 인덱스 범위 [from, to]의 문장 텍스트를 순서대로 수집(빈 문자열 제외). 앞뒤 문맥 문장 추출용.
const collectTexts = (data, from, to) => {
    const out = [];
    for (let j = Math.max(0, from); j <= Math.min(data.length - 1, to); j++) {
        const t = data[j].text || '';
        if (t) out.push(t);
    }
    return out;
};

export const useMediaAnalysis = ({
    setFiles,
    setActiveFileId,
    setIsSwitchingFile,
    resetPlayerState,
    refreshCacheKeys,
    apiKey,
    stage1Model,
    stage2Model,
    stage3Model, // 재전사/재분석 전용 모델
    temperature,
    topP,
    antiRecitation,
    markerChar,
    markerInterval,
    chunkEnabled,
    chunkMinutes,
    realignEnabled,
    stage2AbortRef,
    showToast,
    onTrashChange
}) => {
    const [isDragging, setIsDragging] = useState(false);
    // 백그라운드 Stage 2(재분석 등) 진행 표시: null 또는 { fileId, done, total }.
    // 최초 전체분석은 isAnalyzing 전체 스피너가 있으므로, 이 배너는 그 외(재분석/이어서 분석)에서 사용.
    const [stage2Progress, setStage2Progress] = useState(null);
    const stage1AbortRef = useRef(null);
    const stage2RunIdRef = useRef(0); // 최신 Stage 2 실행만 진행배너를 정리(옛 실행이 새 배너를 지우지 않게)
    const quotaWarnedRef = useRef(false); // 용량 경고 세션당 1회만(반복 저장 스팸 방지)

    // saveCacheEntry 래퍼: 저장 실패 시 사용자에게 명시적으로 알림('조용한 실패' 제거).
    // 용량 초과면 "오래된 기록 삭제" 안내, 그 외는 일반 에러 알림. 성공 시 경고 플래그 해제.
    const persistCache = (fileInfo, data, status) => {
        const res = saveCacheEntry(fileInfo, data, status);
        if (res && res.ok) {
            quotaWarnedRef.current = false;
            return res;
        }
        if (res && res.reason === 'quota') {
            if (!quotaWarnedRef.current) {
                quotaWarnedRef.current = true;
                if (showToast) showToast({
                    message: '⚠️ 저장 공간이 꽉 찼습니다. 목록에서 오래된 기록을 삭제한 뒤 다시 시도하세요. (이번 세션엔 보이지만 새로고침 시 사라질 수 있어요)',
                    type: 'error',
                });
            }
        } else if (res && showToast) {
            showToast({ message: '분석 결과 저장 실패: ' + (res.message || '알 수 없는 오류'), type: 'error' });
        }
        return res;
    };

    /**
     * STAGE 2: FULL BATCH ANALYSIS
     */
    const runStage2 = async (fileId, fileInfo, transcript, currentApiKey, currentModelId, opts = {}) => {
        // reportPartialFail: 부분 실패 시 이 함수가 직접 토스트를 띄울지. 재분석(원본 복원 로직)에서는 false로 두고 호출부가 처리.
        const { reportPartialFail = true } = opts;
        console.log(`[Stage 2] Starting FULL BATCH Analysis for file ${fileId}...`);

        if (stage2AbortRef.current) stage2AbortRef.current.abort();
        stage2AbortRef.current = new AbortController();
        const { signal } = stage2AbortRef.current;

        const updateGlobalState = (data) => {
            setFiles(prev => prev.map(f => f.id === fileId ? { ...f, data: [...data] } : f));
        };

        const pendingIndices = transcript
            .map((item, idx) => ({ item, idx }))
            .filter(x => !x.item.isAnalyzed)
            .map(x => x.idx);

        if (pendingIndices.length === 0) return { total: 0, success: 0, failedIndices: [] };

        // [진행 표시] 백그라운드 분석 시작 — 상단 배너용 (전체 스피너가 없는 재분석/이어서분석에서 노출)
        const myRun = ++stage2RunIdRef.current;
        setStage2Progress({ fileId, done: 0, total: pendingIndices.length });

        const BATCH_SIZE = 25;
        const CONCURRENCY = getStage2Concurrency(currentModelId);
        const batches = [];
        for (let i = 0; i < pendingIndices.length; i += BATCH_SIZE) {
            batches.push(pendingIndices.slice(i, i + BATCH_SIZE));
        }

        console.log(`[Stage 2] Split into ${batches.length} batches (Max ${CONCURRENCY} concurrent).`);

        let workingData = JSON.parse(JSON.stringify(transcript));
        let totalSuccessCount = 0;

        for (let i = 0; i < batches.length; i += CONCURRENCY) {
            if (signal.aborted) break;

            const currentBatchGroup = batches.slice(i, i + CONCURRENCY);
            console.log(`[Stage 2] Running Batch Group ${Math.floor(i / CONCURRENCY) + 1}...`);

            const batchPromises = currentBatchGroup.map(async (batchIndices) => {
                const batchItems = batchIndices.map(idx => ({ index: idx, text: workingData[idx].text }));
                // 분석 정확도용 앞뒤 문맥(대상 제외, 최대 CONTEXT_EACH씩). 참고용으로만 전달.
                const CONTEXT_EACH = 5;
                const targetSet = new Set(batchIndices);
                const ctxSet = new Set();
                for (const idx of batchIndices) {
                    for (let d = 1; d <= CONTEXT_EACH; d++) {
                        if (idx - d >= 0) ctxSet.add(idx - d);
                        if (idx + d < workingData.length) ctxSet.add(idx + d);
                    }
                }
                for (const t of targetSet) ctxSet.delete(t);
                const contextItems = [...ctxSet].sort((a, b) => a - b)
                    .slice(0, 40) // 폭주 방지 상한
                    .map(idx => ({ index: idx, text: workingData[idx].text }));
                try {
                    const results = await analyzeBatchSentences(batchItems, currentApiKey, currentModelId, signal, contextItems);
                    if (results && !signal.aborted) {
                        let groupSuccess = 0;
                        results.forEach(res => {
                            if (res && res.translation && !res.failed) {
                                workingData[res.index] = {
                                    ...workingData[res.index],
                                    translation: res.translation,
                                    analysis: res.analysis,
                                    isAnalyzed: true
                                };
                                groupSuccess++;
                            }
                        });
                        totalSuccessCount += groupSuccess;
                        updateGlobalState(workingData);
                        setStage2Progress({ fileId, done: totalSuccessCount, total: pendingIndices.length });
                        const isLast = i + (currentBatchGroup.length * BATCH_SIZE) >= pendingIndices.length;
                        persistCache(fileInfo, workingData, isLast ? 'completed' : 'analyzing');
                        if (refreshCacheKeys) refreshCacheKeys();
                    }
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    console.error(`[Stage 2] Batch failed:`, e);
                }
            });

            await Promise.all(batchPromises);
        }

        // [뭉침 자동 교정 — 검증형 재시도] 뭉친 문장을 '강제 분할'로 재분석하되,
        // 결과가 '더 잘 쪼개졌을 때만' 채택하고, 여전히 뭉치면 최대 MAX_SPLIT_RETRIES회까지 재시도(퇴행 방지).
        const MAX_SPLIT_RETRIES = 3;
        const chunkCount = (a) => (a ? a.split('\n').filter(l => l.trim()).length : 0);
        let didRetry = false;
        for (let round = 0; round < MAX_SPLIT_RETRIES && !signal.aborted; round++) {
            const lumped = pendingIndices.filter(idx => {
                const d = workingData[idx];
                return d && d.isAnalyzed && isLumpedAnalysis(d.text, d.analysis);
            });
            if (lumped.length === 0) break;
            didRetry = true;
            console.log(`[Stage 2] 뭉침 ${lumped.length}개 (라운드 ${round + 1}/${MAX_SPLIT_RETRIES}) → 강제 분할 재분석`);
            for (let i = 0; i < lumped.length && !signal.aborted; i += CONCURRENCY) {
                const group = lumped.slice(i, i + CONCURRENCY);
                await Promise.all(group.map(async (idx) => {
                    const batchItems = [{ index: idx, text: workingData[idx].text }];
                    try {
                        // 문맥 생략(속도) + forceSplit=true 로 강제 분할 요청
                        const results = await analyzeBatchSentences(batchItems, currentApiKey, currentModelId, signal, [], true);
                        if (results && !signal.aborted) {
                            results.forEach(res => {
                                if (res && res.translation && !res.failed) {
                                    const prev = workingData[res.index];
                                    // 더 잘 쪼개졌을 때만 채택: 더 이상 뭉치지 않거나, 청크 수가 늘었을 때 (퇴행 방지)
                                    const better = !isLumpedAnalysis(prev.text, res.analysis)
                                        || chunkCount(res.analysis) > chunkCount(prev.analysis);
                                    if (better) {
                                        workingData[res.index] = {
                                            ...prev,
                                            translation: res.translation,
                                            analysis: res.analysis,
                                            isAnalyzed: true
                                        };
                                    }
                                }
                            });
                            updateGlobalState(workingData);
                        }
                    } catch (e) {
                        if (e.name === 'AbortError') return;
                        console.warn('[Stage 2] 강제 분할 재분석 실패:', e);
                    }
                }));
            }
        }
        if (didRetry && !signal.aborted) {
            const allDone2 = workingData.every(d => d.isAnalyzed);
            persistCache(fileInfo, workingData, allDone2 ? 'completed' : 'analyzing');
        }

        // 이 실행이 최신일 때만 진행배너 정리 (옛 실행이 새 배너를 지우지 않게)
        if (stage2RunIdRef.current === myRun) setStage2Progress(null);

        // 최종적으로 여전히 미분석인 대상 = 실패 문장
        const failedIndices = pendingIndices.filter(idx => !workingData[idx].isAnalyzed);

        if (!signal.aborted && totalSuccessCount === 0 && pendingIndices.length > 0) {
            console.error('[Stage 2] All batches failed.');
            if (showToast) showToast({ message: '분석 실패: API 오류가 발생했습니다. 설정에서 모델을 확인해주세요.', type: 'error' });
        } else if (!signal.aborted && reportPartialFail && failedIndices.length > 0 && totalSuccessCount > 0) {
            // [부분 실패 알림] 일부 배치만 실패 → 조용히 두지 말고 개수 표시 + 재시도 제공
            if (showToast) showToast({
                message: `${failedIndices.length}개 문장 분석 실패. 나머지는 완료됐어요.`,
                type: 'error',
                action: { label: '실패분 재시도', onClick: () => reanalyzeSentences(fileId, failedIndices) },
                duration: 8000,
            });
        }

        // 클라우드에 최종 분석 결과 반영 (best-effort, mediaUrl은 서버가 기존 값 보존)
        if (!signal.aborted && totalSuccessCount > 0) {
            const allDone = workingData.every(d => d.isAnalyzed);
            cloudSaveMeta(fileInfo, workingData, allDone ? 'completed' : 'analyzing', null, 0)
                .catch(e => console.warn('[Cloud] 분석 결과 저장 실패:', e));
        }

        console.log(`[Stage 2] Finished. Analyzed: ${totalSuccessCount}/${pendingIndices.length}`);
        return { total: pendingIndices.length, success: totalSuccessCount, failedIndices, aborted: signal.aborted };
    };

    /**
     * Stage 1 실행 공통 로직
     */
    const runStage1 = async (fileId, file, precomputedDuration = null) => {
        // 기존 Stage 1 중단
        if (stage1AbortRef.current) stage1AbortRef.current.abort();
        stage1AbortRef.current = new AbortController();
        const { signal } = stage1AbortRef.current;

        // 호출부에서 이미 계산했으면 재사용, 아니면 여기서 계산 (중복 계산 방지)
        let fileDuration = precomputedDuration;
        if (fileDuration == null) {
            fileDuration = 0;
            try { fileDuration = await getMediaDuration(file); } catch (e) { console.warn("Failed to get media duration:", e); }
        }
        console.log(`[Stage 1] Real duration for ${file.name}: ${fileDuration}s (Temp: ${temperature}, TopP: ${topP})`);

        const rawData = await extractTranscript(file, apiKey, stage1Model, {
            totalDuration: fileDuration,
            onProgress: (incrementalData) => {
                setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: incrementalData } : p));
            },
            temperature,
            topP,
            signal,
            antiRecitation,
            markerChar,
            markerInterval,
            chunkEnabled,
            chunkMinutes,
            realignEnabled,
        });

        if (!rawData) throw new Error("Received empty data from Stage 1 API");

        const data = sanitizeData(rawData, fileDuration);
        if (data.length === 0) throw new Error("Stage 1 extraction returned no valid text data.");

        return data;
    };

    // Stage1 전사 → 캐시/클라우드 저장 → Stage2 분석까지, 한 파일의 전체 파이프라인.
    // 신규 업로드(processFiles)와 재시도(retryAnalysis)가 공유한다.
    //  - saveMedia: 원본을 IndexedDB에 저장 (재생 복원용)
    //  - syncCloud: 원본 영상 업로드 + 대본 저장 (다른 기기 열람용)
    const runFullAnalysis = async (fileId, sourceFile, { saveMedia = false, syncCloud = false } = {}) => {
        if (!apiKey) throw new Error("Please set Gemini API Key in Settings.");

        // 전사(분석)용으로만 파일을 메모리에 적재 시도 (클라우드/온디맨드 파일 대응).
        // 재생 URL과 state의 원본 file은 그대로 유지 → 재생은 원본으로 정상 동작. 실패 시 원본 폴백.
        let fileForAnalysis = sourceFile;
        try {
            fileForAnalysis = await materializeFile(sourceFile, {
                onWait: (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중...', type: 'success' }); }
            });
        } catch (e) {
            console.warn('[Stage 1] 메모리 적재 실패 → 원본 파일로 진행:', e.message);
            fileForAnalysis = sourceFile;
        }

        // 미디어 길이는 한 번만 계산해 Stage 1 전사와 클라우드 메타에서 공유 (중복 계산 제거)
        let duration = 0;
        try { duration = await getMediaDuration(fileForAnalysis); } catch (e) { console.warn("Failed to get media duration:", e); }

        const data = await runStage1(fileId, fileForAnalysis, duration);

        setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data, isAnalyzing: false } : p));

        persistCache(sourceFile, data, 'extracted');
        if (refreshCacheKeys) refreshCacheKeys();

        runStage2(fileId, fileForAnalysis, data, apiKey, stage2Model);

        if (saveMedia) {
            try {
                // 캐시/클라우드 메타는 sourceFile 신원으로 저장되므로 미디어도 동일 신원으로 저장해야
                // 나중에 loadCache가 name_size로 찾을 수 있다 (온디맨드 파일 크기 불일치 방지)
                await mediaStore.saveFile(fileForAnalysis, { name: sourceFile.name, size: sourceFile.size });
            } catch (storageError) {
                console.warn("Failed to save media file to store", storageError);
            }
        }

        if (syncCloud) {
            // 클라우드 동기화 (best-effort): 원본 영상 업로드 + 대본 저장 → 다른 기기서 열람 가능
            (async () => {
                try {
                    let mediaUrl = null;
                    try {
                        mediaUrl = await cloudUploadMedia(fileForAnalysis);
                    } catch (e) {
                        console.warn('[Cloud] 영상 업로드 실패:', e);
                    }
                    await cloudSaveMeta(sourceFile, data, 'extracted', mediaUrl, duration);
                } catch (e) {
                    console.warn('[Cloud] 대본 저장 실패:', e);
                }
            })();
        }
    };

    const processFiles = async (fileList) => {
        setIsDragging(false);
        if (!fileList || fileList.length === 0) return;

        setIsSwitchingFile(true);
        if (resetPlayerState) resetPlayerState();

        console.log("[Upload] Processing files...", fileList);

        const newFiles = Array.from(fileList).map(file => ({
            id: crypto.randomUUID(),
            file,
            url: URL.createObjectURL(file), // 재생은 항상 원본 파일로 (원래 동작 보존)
            data: [],
            isAnalyzing: true,
            error: null
        }));

        setFiles(prev => [...prev, ...newFiles]);

        if (newFiles.length > 0) {
            setActiveFileId(newFiles[0].id);
        }
        setIsSwitchingFile(false);

        // fire-and-forget: 각 파일을 병렬로 독립 처리 (개별 try/catch로 에러 격리)
        newFiles.forEach(async (fItem) => {
            try {
                // 이미 분석된 캐시가 있으면 Stage 1/2 없이 즉시 복원
                const cacheKey = `gemini_analysis_${fItem.file.name}_${fItem.file.size}`;
                const cacheEntry = parseCacheEntry(cacheKey);
                if (cacheEntry) {
                    console.log("Using cached analysis for", fItem.file.name);
                    let cacheDuration = 0;
                    try { cacheDuration = await getMediaDuration(fItem.file); } catch (e) { console.warn("Failed to get cached media duration:", e); }
                    const data = sanitizeData(cacheEntry.rawData, cacheDuration);
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data, isAnalyzing: false, isFromCache: true } : p));
                    // 캐시된 대본이 있어도 미디어가 IndexedDB에 없으면 (재)저장 → 새로고침 후에도 재생 복원.
                    // (사이트 데이터 삭제 등으로 미디어 스토어가 비면, '연결하기'/재업로드 한 번으로 다시 채워짐)
                    try {
                        const existing = await mediaStore.getFileFlexible(fItem.file.name, fItem.file.size);
                        if (!existing) {
                            await mediaStore.saveFile(fItem.file, { name: fItem.file.name, size: fItem.file.size });
                        }
                    } catch (e) { console.warn("캐시 히트 미디어 저장 실패:", e); }
                    return;
                }

                await runFullAnalysis(fItem.id, fItem.file, { saveMedia: true, syncCloud: true });
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("Analysis Error", err);
                setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
            }
        });
    };

    const retryAnalysis = async (fileId) => {
        // 기존 Stage 2 중단
        if (stage2AbortRef.current) stage2AbortRef.current.abort();

        let targetFile = null;
        setFiles(prev => {
            const f = prev.find(p => p.id === fileId);
            if (f) targetFile = f.file;
            return prev.map(p => p.id === fileId ? { ...p, error: null, data: [], isAnalyzing: true } : p);
        });

        await new Promise(r => setTimeout(r, 0));
        if (!targetFile) return;

        try {
            // 재시도는 신규 업로드와 달리 미디어 재저장/클라우드 재동기화는 생략 (기존 동작 보존)
            await runFullAnalysis(fileId, targetFile);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error("Retry Analysis Error", err);
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
        }
    };

    /**
     * [구간 선택 재전사]
     * 사용자가 고른 문장들의 시간대 오디오만 다시 전사하고, 그 자리에 교체한다.
     * 나머지 문장의 타임스탬프·분석은 그대로 보존된다(타임라인 최대 보존).
     * 새로 나온 문장은 미분석 상태로 넣고 runStage2가 그것들만 분석한다.
     */
    const retranscribeSentences = async (fileId, indices) => {
        if (!apiKey) {
            if (showToast) showToast({ message: '설정에서 Gemini API 키를 먼저 입력하세요.', type: 'error' });
            return;
        }
        if (!indices || indices.length === 0) return;

        // 현재 파일/데이터 스냅샷 확보
        let targetFile = null;
        let targetUrl = null;
        let currentData = null;
        setFiles(prev => {
            const f = prev.find(p => p.id === fileId);
            if (f) { targetFile = f.file; targetUrl = f.url; currentData = f.data; }
            return prev;
        });
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !Array.isArray(currentData) || currentData.length === 0) return;

        const sortedIdx = [...new Set(indices)]
            .filter(i => i >= 0 && i < currentData.length)
            .sort((a, b) => a - b);
        if (sortedIdx.length === 0) return;

        // 진행 중인 Stage 2 중단 (교체 후 재개)
        if (stage2AbortRef.current) stage2AbortRef.current.abort();

        // 선택 문장에 재전사 로딩 표시
        const clearRetranscribingFlag = () => {
            setFiles(prev => prev.map(p => p.id === fileId
                ? { ...p, data: p.data.map(d => {
                    if (!d.isRetranscribing) return d;
                    const c = { ...d }; delete c.isRetranscribing; return c;
                }) }
                : p));
        };
        setFiles(prev => prev.map(p => p.id === fileId
            ? { ...p, data: p.data.map((d, i) => sortedIdx.includes(i) ? { ...d, isRetranscribing: true } : d) }
            : p));

        // 재전사도 Stage 1 계열 → 같은 abort 채널 사용 (파일 전환 시 함께 취소됨)
        if (stage1AbortRef.current) stage1AbortRef.current.abort();
        stage1AbortRef.current = new AbortController();
        const { signal } = stage1AbortRef.current;

        try {
            // 온디맨드/클라우드 파일 대응: 분석용으로 메모리 적재 (실패 시 원본 폴백)
            let fileForAnalysis = targetFile;
            try {
                fileForAnalysis = await materializeFile(targetFile, {
                    onWait: (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중...', type: 'success' }); }
                });
            } catch (e) {
                console.warn('[Retranscribe] 메모리 적재 실패 → 원본 파일로 진행:', e.message);
                fileForAnalysis = targetFile;
            }

            let duration = 0;
            try { duration = await getMediaDuration(fileForAnalysis); } catch (e) { console.warn('duration 계산 실패:', e); }

            // 선택 문장을 '블록'(동일 시각으로 뭉친 연속 구간) 단위로 정규화.
            // 블록 시각 공유로 여러 문장이 같은 seconds를 가지면, 한 개만 교체 시 형제 문장이
            // 남아 중복이 생기므로 그 블록 전체를 통째로 교체한다. (보통은 lo===hi인 단일 문장)
            const grabTexts = (from, to) => collectTexts(currentData, from, to);
            const blockMap = new Map(); // lo -> { lo, hi, start, end }
            for (const i of sortedIdx) {
                const t = currentData[i].seconds;
                let lo = i; while (lo > 0 && currentData[lo - 1].seconds === t) lo--;
                let hi = i; while (hi < currentData.length - 1 && currentData[hi + 1].seconds === t) hi++;
                if (blockMap.has(lo)) continue;
                // 블록 끝(배타적 경계) = 다음(더 큰) 시각, 없으면 영상 끝
                let end = duration > t ? duration : t + 8;
                let nextIdx = -1;
                for (let j = hi + 1; j < currentData.length; j++) {
                    if (currentData[j].seconds > t) { end = currentData[j].seconds; nextIdx = j; break; }
                }
                // 경계 겹침/딸려온 이웃 판별용 텍스트
                const prevText = lo > 0 ? (currentData[lo - 1].text || '') : '';
                const nextText = nextIdx >= 0 ? (currentData[nextIdx].text || '') : '';
                // 대상 블록 자신의 (기존) 텍스트 — 재전사 결과 중 '진짜 대상 문장'을 골라내는 기준
                const selfText = currentData.slice(lo, hi + 1).map(d => d.text || '').join(' ');
                // 프롬프트 문맥용 앞뒤 2문장 (경계 파편 차단)
                const contextBefore = grabTexts(lo - 2, lo - 1);
                const contextAfter = nextIdx >= 0 ? grabTexts(nextIdx, nextIdx + 1) : [];
                blockMap.set(lo, { lo, hi, start: t, end, prevText, nextText, selfText, contextBefore, contextAfter });
            }
            const blocks = [...blockMap.values()].sort((a, b) => a.lo - b.lo);
            const windows = blocks.map(b => ({ start: b.start, end: b.end, prevText: b.prevText, nextText: b.nextText, selfText: b.selfText, contextBefore: b.contextBefore, contextAfter: b.contextAfter }));

            // [속도·효율] 선택 구간이 한데 모여 있으면(유니온 ≤120초) 복구처럼 오디오 1회추출 후
            //  슬라이스 + 병렬 전사로 대폭 단축. 멀리 흩어져 유니온이 과대하면 기존 안전 방식 폴백.
            const unionSpan = windows.length
                ? Math.max(...windows.map(w => w.end)) - Math.min(...windows.map(w => w.start))
                : 0;
            const useSingleExtract = windows.length > 1 && unionSpan > 0 && unionSpan <= 120;

            const perWindow = await retranscribeSegments(fileForAnalysis, apiKey, stage3Model, windows, {
                totalDuration: duration,
                temperature,
                topP,
                signal,
                antiRecitation,
                markerChar,
                markerInterval,
                mediaSrc: targetUrl, // 실시간 캡처용(모바일 대응). 실패 시 전체추출 폴백
                singleExtract: useSingleExtract, // 모여 있을 때만 1회추출(유니온 과대 방지)
                concurrency: 3,                  // 유니온 추출 성공 시에만 병렬(실패 시 자동 순차)
            });

            // 뒤 블록부터 splice 교체 (앞 인덱스 밀림 방지)
            const newData = currentData.slice();
            let replacedCount = 0;
            let failedCount = 0;
            let firstError = null;
            for (let k = blocks.length - 1; k >= 0; k--) {
                const b = blocks[k];
                const fresh = perWindow[k]?.sentences;
                if (fresh && fresh.length > 0) {
                    newData.splice(b.lo, b.hi - b.lo + 1, ...fresh); // 새 문장은 isAnalyzed:false 상태
                    replacedCount++;
                } else {
                    failedCount++; // 실패 → 원본 유지
                    if (!firstError && perWindow[k]?.error) firstError = perWindow[k].error;
                }
            }

            const cleanData = sanitizeData(newData, duration);
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: cleanData } : p));

            const allDone = cleanData.every(d => d.isAnalyzed);
            persistCache(targetFile, cleanData, allDone ? 'completed' : 'analyzing');
            if (refreshCacheKeys) refreshCacheKeys();

            if (replacedCount > 0) {
                if (showToast) showToast({
                    message: `${replacedCount}개 구간 재전사 완료${failedCount ? `, ${failedCount}개는 실패로 원본 유지` : ''}. 분석 진행 중...`,
                    type: 'success'
                });
                // 새로 들어온(미분석) 문장만 분석 (재전사 흐름 → Stage 3 모델)
                runStage2(fileId, fileForAnalysis, cleanData, apiKey, stage3Model);
            } else {
                clearRetranscribingFlag();
                if (showToast) showToast({
                    message: `재전사 실패: ${firstError || '결과 없음'}`,
                    type: 'error'
                });
            }
        } catch (err) {
            clearRetranscribingFlag();
            if (err.name === 'AbortError') return;
            console.error('[Retranscribe] 실패', err);
            if (showToast) showToast({ message: '재전사 실패: ' + err.message, type: 'error' });
        }
    };

    /**
     * [구간 선택 분석만 다시 - Phase 2 재실행]
     * 선택 문장의 전사(문장·타임스탬프)는 그대로 두고, 번역/분석만 지우고 다시 분석한다.
     * 오디오 재전사가 없어(텍스트만 전송) 빠르고 타임라인이 완전히 보존된다.
     */
    const reanalyzeSentences = async (fileId, indices) => {
        if (!apiKey) {
            if (showToast) showToast({ message: '설정에서 Gemini API 키를 먼저 입력하세요.', type: 'error' });
            return;
        }
        if (!indices || indices.length === 0) return;

        // 진행 중인 Stage 2 중단 (재분석으로 재개)
        if (stage2AbortRef.current) stage2AbortRef.current.abort();

        const idxSet = new Set(indices);
        let targetFile = null;
        let resetData = null;
        const snapshot = new Map(); // idx -> 원본 분석 (재분석 실패 시 복원용)
        setFiles(prev => prev.map(p => {
            if (p.id !== fileId) return p;
            targetFile = p.file;
            // 선택 문장만 미분석 상태로 리셋 (전사 텍스트·타임스탬프는 유지)
            resetData = p.data.map((d, i) => {
                if (!idxSet.has(i)) return d;
                // 원본이 분석돼 있었으면 복원용으로 보관
                if (d.isAnalyzed) snapshot.set(i, { translation: d.translation, analysis: d.analysis, a: d.a, isAnalyzed: true });
                return { ...d, translation: '', analysis: '', a: '', isAnalyzed: false };
            });
            return { ...p, data: resetData };
        }));
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !resetData) return;

        // [원본 소실 방지] 지워진 버전을 캐시에 저장하지 않는다 → 분석이 전부 실패하거나 도중에
        // 탭이 닫혀도 캐시엔 직전 원본 분석이 남는다. (성공분은 runStage2가 배치별로 저장)
        if (refreshCacheKeys) refreshCacheKeys();

        if (showToast) showToast({ message: `${idxSet.size}개 문장 분석을 다시 진행 중...`, type: 'success' });
        // 미분석(리셋된) 문장만 다시 분석 (재분석 → 설정의 Stage 3 모델).
        // reportPartialFail:false — 실패분은 아래에서 원본 복원으로 직접 처리(중복 토스트 방지).
        const result = await runStage2(fileId, targetFile, resetData, apiKey, stage3Model, { reportPartialFail: false });

        // 여전히 미분석(실패)인 선택 문장은 원본 분석으로 되돌린다. (취소/파일전환으로 중단된 경우는 제외)
        const failed = (result && !result.aborted ? (result.failedIndices || []) : []).filter(i => snapshot.has(i));
        if (failed.length > 0) {
            let restoredData = null;
            setFiles(prev => prev.map(p => {
                if (p.id !== fileId) return p;
                restoredData = p.data.map((d, i) => {
                    if (!snapshot.has(i) || d.isAnalyzed) return d; // 성공분은 새 결과 유지
                    return { ...d, ...snapshot.get(i) };            // 실패분은 원본 복원
                });
                return { ...p, data: restoredData };
            }));
            if (restoredData) {
                const status = restoredData.every(d => d.isAnalyzed) ? 'completed' : 'analyzing';
                persistCache(targetFile, restoredData, status);
                if (refreshCacheKeys) refreshCacheKeys();
            }
            if (showToast) showToast({
                message: `${failed.length}개 문장 재분석 실패 — 기존 분석을 유지했어요.`,
                type: 'error',
                action: { label: '다시 시도', onClick: () => reanalyzeSentences(fileId, failed) },
                duration: 8000,
            });
        }
    };

    /**
     * [빈칸 구간 복구]
     * 실수로 문장을 지워 빈칸이 생긴 경우, 선택한 '앵커' 문장 1개는 그대로 두고
     * 그 옆 빈칸 구간만 다시 들어(raw 모드) 삭제됐던 문장을 복구한다.
     *  - direction 'both'(기본): 앞 이웃 ~ 뒤 이웃 전체를 한 번에 확인(어느 쪽이 지워졌든 복구)
     *  - direction 'forward' : 앵커 ~ 다음 살아있는 문장 사이(뒤 빈칸)
     *  - direction 'backward': 이전 살아있는 문장 ~ 앵커 사이(앞 빈칸, 맨 앞 포함)
     * 앵커/이웃 문장은 유지(분석 보존)하고, 복구된 문장만 실측 시각으로 삽입 → 자동 재분석(Stage 3).
     */
    const recoverGap = async (fileId, anchorIndex, direction = 'both') => {
        if (!apiKey) {
            if (showToast) showToast({ message: '설정에서 Gemini API 키를 먼저 입력하세요.', type: 'error' });
            return;
        }
        if (anchorIndex === null || anchorIndex === undefined || anchorIndex < 0) return;

        let targetFile = null;
        let targetUrl = null;
        let currentData = null;
        setFiles(prev => {
            const f = prev.find(p => p.id === fileId);
            if (f) { targetFile = f.file; targetUrl = f.url; currentData = f.data; }
            return prev;
        });
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !Array.isArray(currentData) || currentData.length === 0) return;
        if (anchorIndex >= currentData.length) return;

        if (stage2AbortRef.current) stage2AbortRef.current.abort();

        const anchorSec = currentData[anchorIndex].seconds;

        // 로딩 표시: 앵커와 같은 시각(블록) 문장에 스피너
        const clearRetranscribingFlag = () => {
            setFiles(prev => prev.map(p => p.id === fileId
                ? { ...p, data: p.data.map(d => {
                    if (!d.isRetranscribing) return d;
                    const c = { ...d }; delete c.isRetranscribing; return c;
                }) }
                : p));
        };
        setFiles(prev => prev.map(p => p.id === fileId
            ? { ...p, data: p.data.map(d => d.seconds === anchorSec ? { ...d, isRetranscribing: true } : d) }
            : p));

        if (stage1AbortRef.current) stage1AbortRef.current.abort();
        stage1AbortRef.current = new AbortController();
        const { signal } = stage1AbortRef.current;

        try {
            let fileForAnalysis = targetFile;
            try {
                fileForAnalysis = await materializeFile(targetFile, {
                    onWait: (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중...', type: 'success' }); }
                });
            } catch (e) {
                console.warn('[Recover] 메모리 적재 실패 → 원본 파일로 진행:', e.message);
                fileForAnalysis = targetFile;
            }

            let duration = 0;
            try { duration = await getMediaDuration(fileForAnalysis); } catch (e) { console.warn('duration 계산 실패:', e); }

            // 앵커 블록(동일 시각) 경계
            let lo = anchorIndex; while (lo > 0 && currentData[lo - 1].seconds === anchorSec) lo--;
            let hi = anchorIndex; while (hi < currentData.length - 1 && currentData[hi + 1].seconds === anchorSec) hi++;
            const sBlockText = currentData.slice(lo, hi + 1).map(d => d.text || '').join(' ');

            // 앞/뒤 이웃(살아있는 문장) 탐색
            let prevIdx = -1;
            for (let j = lo - 1; j >= 0; j--) { if (currentData[j].seconds < anchorSec) { prevIdx = j; break; } }
            let nextIdx = -1;
            for (let j = hi + 1; j < currentData.length; j++) { if (currentData[j].seconds > anchorSec) { nextIdx = j; break; } }
            const pSec = prevIdx >= 0 ? currentData[prevIdx].seconds : 0;
            const pText = prevIdx >= 0 ? (currentData[prevIdx].text || '') : '';
            const nSec = nextIdx >= 0 ? currentData[nextIdx].seconds : (duration > anchorSec ? duration : anchorSec + 8);
            const nText = nextIdx >= 0 ? (currentData[nextIdx].text || '') : '';

            // 방향별 구간(빈칸) 및 유지 경계 문장 계산.
            //  - 'both'(기본): 앞 이웃 ~ 뒤 이웃 전체를 한 번에(앵커는 가운데서 유지)
            //  - 'backward': 앞 이웃 ~ 앵커  /  'forward': 앵커 ~ 뒤 이웃
            //  dropSimilarTo: 유지되는 경계 문장(앞/앵커/뒤)과 겹치는 재전사본 제거 → 중복 방지
            let winStart, winEnd, prevText, nextText, dropList;
            if (direction === 'backward') {
                winStart = pSec; winEnd = anchorSec;
                prevText = pText; nextText = sBlockText;
                dropList = [pText, sBlockText];
            } else if (direction === 'forward') {
                winStart = anchorSec; winEnd = nSec;
                prevText = sBlockText; nextText = nText;
                dropList = [sBlockText, nText];
            } else {
                winStart = pSec; winEnd = nSec;
                prevText = pText; nextText = nText;
                dropList = [pText, sBlockText, nText];
            }

            if (winEnd - winStart < 0.5) {
                clearRetranscribingFlag();
                if (showToast) showToast({ message: '복구할 구간이 없습니다.', type: 'error' });
                return;
            }

            // 긴 빈칸을 한 번에 재전사하면 Gemini가 문장을 덜 쪼개거나(언더세그멘테이션)
            // 실시간 캡처가 중간에 끊겨 일부만 잡힌다 → 구간을 서브창으로 분할해 순차 재전사 후 합침.
            // 짧은 구간(임계값 이하)은 지금처럼 한 번에 처리한다.
            const dropSimilarTo = dropList.filter(Boolean);

            // 프롬프트 문맥용 앞뒤 2문장 (경계 파편 차단) — 빈칸 양쪽의 살아있는 이웃 기준
            const grabTexts = (from, to) => collectTexts(currentData, from, to);
            const anchorTexts = grabTexts(lo, hi);
            let contextBefore, contextAfter;
            if (direction === 'backward') {
                contextBefore = prevIdx >= 0 ? grabTexts(prevIdx - 1, prevIdx) : [];
                contextAfter = anchorTexts;
            } else if (direction === 'forward') {
                contextBefore = anchorTexts;
                contextAfter = nextIdx >= 0 ? grabTexts(nextIdx, nextIdx + 1) : [];
            } else {
                contextBefore = prevIdx >= 0 ? grabTexts(prevIdx - 1, prevIdx) : [];
                contextAfter = nextIdx >= 0 ? grabTexts(nextIdx, nextIdx + 1) : [];
            }
            // 근접 가드용: 빈칸 양쪽 살아있는 이웃 문장의 시작 시각 (파편 시각 제거)
            const boundaryTimes = [
                prevIdx >= 0 ? pSec : null,
                nextIdx >= 0 ? nSec : null,
            ].filter(v => v != null);

            const SUB_LEN = 22;          // 서브창 길이(초) — 무음 스냅이 경계를 방어하므로 크게(호출↓·토큰↓)
            const SUB_OVERLAP = 2.5;     // 오버랩(초) — 무음 스냅 덕에 축소 가능(중복 전송↓)
            const SPLIT_THRESHOLD = 25;  // 이 길이 넘으면 분할
            const windows = [];
            if (winEnd - winStart > SPLIT_THRESHOLD) {
                const step = SUB_LEN - SUB_OVERLAP;
                for (let s = winStart; s < winEnd - 0.5; s += step) {
                    const e = Math.min(s + SUB_LEN, winEnd);
                    windows.push({ start: s, end: e, prevText, nextText, recover: true, dropSimilarTo, contextBefore, contextAfter, boundaryTimes });
                    if (e >= winEnd) break;
                }
            } else {
                windows.push({ start: winStart, end: winEnd, prevText, nextText, recover: true, dropSimilarTo, contextBefore, contextAfter, boundaryTimes });
            }

            const perWindow = await retranscribeSegments(fileForAnalysis, apiKey, stage3Model, windows, {
                totalDuration: duration,
                temperature,
                topP,
                signal,
                antiRecitation,
                markerChar,
                markerInterval,
                mediaSrc: targetUrl,
                singleExtract: true, // 유니온 오디오 1회 추출 후 슬라이스 → 실시간 캡처 대기 제거
                concurrency: 3,      // 서브창 병렬 전사 → 순차 대비 대폭 단축
            });

            // 서브창 결과를 모두 합치고 오버랩 중복 제거 → 빈칸 전체를 원래 밀도로 복구
            const merged = perWindow.flatMap(r => r?.sentences || []);
            const fresh = deduplicateOverlap(merged);
            if (!fresh || fresh.length === 0) {
                clearRetranscribingFlag();
                const firstErr = perWindow.find(r => r?.error)?.error;
                if (showToast) showToast({
                    message: `복구할 내용이 없습니다 (${firstErr || '전사된 내용 없음'}).`,
                    type: 'error'
                });
                return;
            }

            // 기존 문장은 그대로 유지하고, 복구된(실측 시각) 문장만 삽입 → 정렬
            const cleanData = sanitizeData([...currentData, ...fresh], duration);
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: cleanData } : p));

            const allDone = cleanData.every(d => d.isAnalyzed);
            persistCache(targetFile, cleanData, allDone ? 'completed' : 'analyzing');
            if (refreshCacheKeys) refreshCacheKeys();

            if (showToast) showToast({ message: `${fresh.length}개 문장 복구 완료. 분석 진행 중...`, type: 'success' });
            // 새로 들어온(미분석) 문장만 분석 (복구 흐름 → Stage 3 모델)
            runStage2(fileId, fileForAnalysis, cleanData, apiKey, stage3Model);
        } catch (err) {
            clearRetranscribingFlag();
            if (err.name === 'AbortError') return;
            console.error('[Recover] 실패', err);
            if (showToast) showToast({ message: '구간 복구 실패: ' + err.message, type: 'error' });
        }
    };

    /**
     * [구간 선택 삭제]
     * 선택한 문장(카드)들을 대본에서 제거한다. 중복·불필요 문장 정리용.
     * 로컬 캐시 + 클라우드에 반영해 다른 기기에서도 사라지게 한다.
     */
    const deleteSentences = async (fileId, indices) => {
        if (!indices || indices.length === 0) return;
        const idxSet = new Set(indices);
        let targetFile = null;
        let prevData = null; // 실행취소용 삭제 전 스냅샷
        let newData = null;
        let deletedItems = [];
        setFiles(prev => prev.map(p => {
            if (p.id !== fileId) return p;
            targetFile = p.file;
            prevData = p.data;
            deletedItems = p.data.filter((_, i) => idxSet.has(i));
            newData = p.data.filter((_, i) => !idxSet.has(i));
            return { ...p, data: newData };
        }));
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !newData) return;

        // 휴지통에 보관 (6초 실행취소가 지나도 나중에 복구 가능)
        if (targetFile.name) {
            addToTrash(targetFile.name, targetFile.size, deletedItems);
            if (onTrashChange) onTrashChange();
        }

        // 로컬 캐시 + 클라우드에 상태 반영 (best-effort)
        const persist = (data) => {
            const status = data.length === 0 ? 'extracted' : (data.every(d => d.isAnalyzed) ? 'completed' : 'analyzing');
            persistCache(targetFile, data, status);
            if (refreshCacheKeys) refreshCacheKeys();
            cloudSaveMeta(targetFile, data, status, null, 0).catch(e => console.warn('[Cloud] 반영 실패:', e));
        };
        persist(newData);

        // 실행취소: 삭제 전 데이터로 되돌리고, 방금 넣은 휴지통 항목도 제거
        const undo = () => {
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: prevData } : p));
            persist(prevData);
            if (targetFile.name) {
                removeFromTrash(targetFile.name, targetFile.size, deletedItems);
                if (onTrashChange) onTrashChange();
            }
            if (showToast) showToast({ message: '삭제를 취소했습니다.', type: 'success' });
        };

        if (showToast) showToast({
            message: `${idxSet.size}개 문장 삭제됨`,
            type: 'success',
            action: { label: '실행취소', onClick: undo },
            duration: 6000, // 되돌릴 시간 여유
        });
    };

    /**
     * [휴지통 복구] 휴지통의 문장들을 대본에 다시 넣는다.
     * 타임스탬프 기준 정렬이라 원래 위치로 복원된다. 이미 있는(중복) 문장은 건너뛴다.
     */
    const restoreSentences = async (fileId, items) => {
        if (!items || items.length === 0) return;
        let targetFile = null;
        let curData = null;
        setFiles(prev => {
            const f = prev.find(p => p.id === fileId);
            if (f) { targetFile = f.file; curData = f.data; }
            return prev;
        });
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !Array.isArray(curData)) return;

        const existing = new Set(curData.map(sentenceKey));
        const toAdd = items.filter(it => !existing.has(sentenceKey(it)));
        const merged = [...curData, ...toAdd];
        const clean = sanitizeData(merged, 0); // 시각 기준 재정렬 → 원위치 복원
        setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: clean } : p));

        const status = clean.every(d => d.isAnalyzed) ? 'completed' : (clean.length ? 'analyzing' : 'extracted');
        persistCache(targetFile, clean, status);
        if (refreshCacheKeys) refreshCacheKeys();
        cloudSaveMeta(targetFile, clean, status, null, 0).catch(e => console.warn('[Cloud] 복구 반영 실패:', e));

        if (targetFile.name) {
            removeFromTrash(targetFile.name, targetFile.size, items);
            if (onTrashChange) onTrashChange();
        }
        if (showToast) showToast({ message: `${toAdd.length}개 문장 복구됨`, type: 'success' });
    };

    // 드래그앤드롭 핸들러
    const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = (e) => {
        if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
            setIsDragging(false);
        }
    };
    const onDrop = (e) => {
        e.preventDefault();
        processFiles(e.dataTransfer.files);
    };

    return { processFiles, runStage2, retryAnalysis, retranscribeSentences, reanalyzeSentences, recoverGap, deleteSentences, restoreSentences, stage1AbortRef, isDragging, onDragOver, onDragLeave, onDrop, stage2Progress };
};
