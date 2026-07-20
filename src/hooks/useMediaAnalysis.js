import { useState, useRef } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { extractTranscript, analyzeBatchSentences, retranscribeSegments, deduplicateOverlap, detectSpeechEnds } from '../services/gemini';
import { parseCacheEntry, saveCacheEntry } from '../utils/cacheUtils';
import { uploadMedia as cloudUploadMedia, saveMeta as cloudSaveMeta } from '../services/cloudSync';
import { materializeFile } from '../utils/materializeFile';
import { getStage2Concurrency } from '../constants/models';
import { addToTrash, removeFromTrash, sentenceKey } from '../utils/trashUtils';
import { validSpeechEnd } from '../utils/speechSegments';

// 재전사 로딩 표시(isRetranscribing) 해제 클로저 생성: 지정 파일의 모든 문장에서 플래그 제거.
const makeClearRetranscribingFlag = (setFiles, fileId) => () => {
    setFiles(prev => prev.map(p => p.id === fileId
        ? { ...p, data: p.data.map(d => {
            if (!d.isRetranscribing) return d;
            const c = { ...d }; delete c.isRetranscribing; return c;
        }) }
        : p));
};

// 분석이 '뭉침/과편중'인지 감지: 모든 볼드 청크 중 '가장 큰 것'이 문장의 60% 이상을 덮으면 뭉침.
// (문장 전체를 1청크로 낸 경우뿐 아니라, 한 청크가 지나치게 큰 편중 분할도 재교정 대상에 포함)
// 짧은 문장(6단어 미만)은 1청크가 정상이라 제외. ⚡실제 태그는 원어 볼드가 아니라 영향 미미.
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
    speechAutoDetect, // 전사+분석 완료 후 대사 구간 감지 자동 실행 (설정, 기본 꺼짐)
    stage2AbortRef,
    stage2ActiveRef, // Map<fileId, 실행중 개수> — loadCache의 Stage 2 재시작 방지용
    showToast,
    onTrashChange
}) => {
    const [isDragging, setIsDragging] = useState(false);
    // 백그라운드 Stage 2(재분석 등) 진행 표시: null 또는 { fileId, done, total }.
    // 최초 전체분석은 isAnalyzing 전체 스피너가 있으므로, 이 배너는 그 외(재분석/이어서 분석)에서 사용.
    const [stage2Progress, setStage2Progress] = useState(null);
    // [대사 끝 감지] 진행 중인 파일 id (칩 스피너 표시용). null = 유휴.
    const [speechDetectBusy, setSpeechDetectBusy] = useState(null);
    const speechBusyRef = useRef(false); // 중복 실행 가드는 ref로 (자동 실행 경로의 stale closure 방지)
    // [대사 끝 감지 결과의 동기 사본] key: `${name}_${size}|${seconds}` → speechEnd(초).
    // Stage 2가 자기 스냅샷으로 상태/캐시를 통째로 덮어쓸 때, 그 사이 감지가 채운 speechEnd가
    // 지워지지 않도록 덮어쓰기 직전에 여기서 이식한다(상태는 지연 갱신이라 ref가 필요).
    const speechEndGraftRef = useRef(new Map());
    const stage1AbortRef = useRef(null);
    const analysisQueueRef = useRef([]);   // 순차 분석 대기 파일 목록
    const queueRunningRef = useRef(false);  // 큐 워커 실행 중 여부
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
    // [주의] fileInfo는 '신원'(name/size)으로만 쓰인다 — 캐시 키·graft 키·클라우드 폴더 계산.
    // 실제 바이트는 읽지 않으므로, 호출부는 반드시 '원본 신원'을 넘겨야 한다.
    // materializeFile이 만든 메모리 적재본(new File([buf], ...))은 size가 '실제 읽은 바이트 수'로
    // 바뀌어, 온디맨드 파일(드라이브/OneDrive)에서 원본 보고 크기와 달라질 수 있다. 그걸 넘기면
    // 전사·감지는 원본 키에, 분석은 다른 키에 저장돼 캐시가 두 갈래로 쪼개진다.
    // [실행 중 표시] 호출 전후로 stage2ActiveRef를 갱신하는 얇은 래퍼.
    // loadCache가 '이 파일 분석이 지금 돌고 있나'를 보고 재시작을 건너뛰는 데 쓴다
    // (재시작하면 runStage2 첫 줄의 abort가 진행 중이던 요청을 죽여 중복 비용이 든다).
    // finally로 감싸 예외·중단에도 표시가 남지 않게 한다.
    const runStage2 = async (fileId, ...rest) => {
        const m = stage2ActiveRef?.current;
        if (m) m.set(fileId, (m.get(fileId) || 0) + 1);
        try {
            return await runStage2Inner(fileId, ...rest);
        } finally {
            if (m) {
                const n = (m.get(fileId) || 1) - 1;
                if (n > 0) m.set(fileId, n); else m.delete(fileId);
            }
        }
    };

    const runStage2Inner = async (fileId, fileInfo, transcript, currentApiKey, currentModelId, opts = {}) => {
        // reportPartialFail: 부분 실패 시 이 함수가 직접 토스트를 띄울지. 재분석(원본 복원 로직)에서는 false로 두고 호출부가 처리.
        const { reportPartialFail = true } = opts;
        console.log(`[Stage 2] Starting FULL BATCH Analysis for file ${fileId}...`);

        if (stage2AbortRef.current) stage2AbortRef.current.abort();
        stage2AbortRef.current = new AbortController();
        const { signal } = stage2AbortRef.current;

        // [필드 보존] Stage 2는 시작 시점 스냅샷(workingData)을 통째로 상태/캐시에 덮어쓴다.
        // 분석이 도는 사이 '대사 끝 감지'가 채운 speechEnd는 이 스냅샷에 없어 배치가 끝날 때마다
        // 지워지는 경합이 있다 → 덮어쓰기 직전에 감지 결과(ref)를 스냅샷에 이식한다.
        // (배열 항목을 직접 교체하므로 바로 뒤따르는 persistCache도 이식된 값을 저장한다)
        const updateGlobalState = (data) => {
            const graft = speechEndGraftRef.current;
            if (graft.size > 0) {
                for (let i = 0; i < data.length; i++) {
                    if (typeof data[i].speechEnd === 'number') continue;
                    const se = graft.get(`${fileInfo.name}_${fileInfo.size}|${data[i].seconds}`);
                    if (typeof se === 'number') data[i] = { ...data[i], speechEnd: se };
                }
            }
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

        // rolling 워커풀: 그룹 하드 장벽(Promise.all-per-group)을 제거 → 항상 CONCURRENCY개 배치가 in-flight.
        // 한 배치가 느려도(재시도/타임아웃) 다른 워커는 계속 다음 배치를 당겨 처리 → head-of-line blocking 제거.
        // 배치 간 의존성 없음(불변 text만 읽고 배타적 index에만 기록) → 완료 순서 무관, 프롬프트·출력 동일.
        let batchCursor = 0;
        let succeededBatches = 0;

        const processBatch = async (batchIndices) => {
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
                                transcriptSuspect: res.transcriptSuspect || '', // 규칙15: 없으면 빈 값(배지 없음)
                                isAnalyzed: true
                            };
                            groupSuccess++;
                        }
                    });
                    totalSuccessCount += groupSuccess;
                    updateGlobalState(workingData);
                    setStage2Progress({ fileId, done: totalSuccessCount, total: pendingIndices.length });
                    succeededBatches++;
                    const allDone = succeededBatches >= batches.length; // 전 배치 성공 시에만 'completed'(부분 실패는 하단 마무리에서 처리)
                    persistCache(fileInfo, workingData, allDone ? 'completed' : 'analyzing');
                    if (refreshCacheKeys) refreshCacheKeys();
                }
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.error(`[Stage 2] Batch failed:`, e);
            }
        };

        const runBatchWorker = async () => {
            while (!signal.aborted) {
                const bi = batchCursor++;
                if (bi >= batches.length) break;
                await processBatch(batches[bi]);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => runBatchWorker()));

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
            console.log(`[Stage 2] 뭉침 ${lumped.length}개 (라운드 ${round + 1}/${MAX_SPLIT_RETRIES}) → 강제 분할 재분석(배치)`);

            // [비용 절감] 뭉친 문장을 문장당 개별 호출하지 않고 BATCH_SIZE 단위로 묶어 forceSplit 재분석
            //  → 대형 프롬프트 프리픽스 재전송이 L회 → ⌈L/BATCH_SIZE⌉회로 감소. 파싱은 INDEX별 독립,
            //    'better' 가드(더 잘 쪼개졌을 때만 채택)는 그대로라 퇴행 없음(품질 동등 이상).
            const splitBatches = [];
            for (let i = 0; i < lumped.length; i += BATCH_SIZE) splitBatches.push(lumped.slice(i, i + BATCH_SIZE));

            let splitCursor = 0;
            const processSplitBatch = async (idxGroup) => {
                const batchItems = idxGroup.map(idx => ({ index: idx, text: workingData[idx].text }));
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
                                        transcriptSuspect: res.transcriptSuspect || '',
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
            };
            const runSplitWorker = async () => {
                while (!signal.aborted) {
                    const si = splitCursor++;
                    if (si >= splitBatches.length) break;
                    await processSplitBatch(splitBatches[si]);
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, splitBatches.length) }, () => runSplitWorker()));
        }
        if (didRetry && !signal.aborted) {
            const allDone2 = workingData.every(d => d.isAnalyzed);
            persistCache(fileInfo, workingData, allDone2 ? 'completed' : 'analyzing');
        }

        // 이 실행이 최신일 때만 진행배너 정리 (옛 실행이 새 배너를 지우지 않게)
        if (stage2RunIdRef.current === myRun) setStage2Progress(null);

        // 최종적으로 여전히 미분석인 대상 = 실패 문장
        const failedIndices = pendingIndices.filter(idx => !workingData[idx].isAnalyzed);

        // [실패 표시] 분석이 끝났는데도 미분석으로 남은 문장에 analysisFailed 플래그를 단다.
        // → 무한 로딩 스피너 대신, 문장 카드에 '분석 실패 · 다시 시도' UI가 뜬다.
        // (취소/파일전환으로 중단된 경우는 실패가 아니므로 제외)
        if (!signal.aborted && failedIndices.length > 0) {
            failedIndices.forEach(idx => { workingData[idx] = { ...workingData[idx], analysisFailed: true }; });
            updateGlobalState(workingData);
            persistCache(fileInfo, workingData, workingData.every(d => d.isAnalyzed) ? 'completed' : 'analyzing');
        }

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
    const runFullAnalysis = async (fileId, sourceFile, { saveMedia = false, syncCloud = false, awaitStage2 = false } = {}) => {
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

        // [자동 감지 옵션] 전사+분석이 '완료된 뒤' 대사 구간 감지를 자동 실행 (설정, 기본 꺼짐).
        // 완료 후에 돌리는 이유: 분석과 병행하면 API 동시 부하 + 결과 덮어쓰기 경합 창이 넓어진다.
        // 중단(aborted)이나 전량 실패 시엔 실행하지 않는다 — 취소한 파일에 감지 비용을 쓰지 않기 위함.
        // 신원은 sourceFile로 고정 — 이 위의 persistCache(sourceFile)·감지 저장과 같은 캐시 키를 쓴다
        const stage2Promise = runStage2(fileId, sourceFile, data, apiKey, stage2Model)
            .then((res) => {
                // 전량 실패(success 0)면 API 자체가 아픈 상태 — 감지까지 얹지 않는다
                if (speechAutoDetect && res && !res.aborted && (res.total === 0 || res.success > 0)) {
                    detectSpeechEndsForFile(fileId);
                }
                return res;
            });

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
                    // [중요] 여기서 data를 보내면 안 된다.
                    // 대용량 업로드는 수 분이 걸리는데 그 사이 Stage 2(분석)와 대사 구간 감지가
                    // 이미 최신 결과를 클라우드에 저장한다. data는 Stage 1 시점 스냅샷에 고정돼
                    // 있으므로(runStage2가 깊은 복사로 작업) 그걸 다시 올리면 분석·speechEnd가
                    // 통째로 지워지고 status도 'extracted'로 되돌아간다.
                    // → 업로드 완료 시엔 mediaUrl만 갱신한다(data 생략 = 서버가 data.json 보존).
                    await cloudSaveMeta(sourceFile, undefined, undefined, mediaUrl, duration);
                } catch (e) {
                    console.warn('[Cloud] 대본 저장 실패:', e);
                }
            })();
        }

        // 순차 큐: 다음 파일로 넘어가기 전에 이 파일의 Stage2까지 완료 대기 (공유 abort ref 충돌 방지)
        if (awaitStage2) { try { await stage2Promise; } catch { /* 개별 실패는 runStage2가 처리 */ } }
    };

    // 순차 분석 큐: 여러 파일을 동시에 올려도 하나씩 '끝까지'(Stage1+Stage2) 처리한다.
    // (이전엔 파일마다 공유 abort ref를 새로 잡아 뒤 파일이 앞 파일을 중단시켜, 사실상
    //  한 파일만 완료되고 나머지는 스피너로 갇혔다. 큐로 직렬화해 모두 완료시킨다.)
    const processAnalysisQueue = async () => {
        if (queueRunningRef.current) return;      // 워커 중복 실행 방지
        queueRunningRef.current = true;
        try {
            while (analysisQueueRef.current.length > 0) {
                const fItem = analysisQueueRef.current.shift();
                try {
                    await runFullAnalysis(fItem.id, fItem.file, { saveMedia: true, syncCloud: true, awaitStage2: true });
                } catch (err) {
                    if (err.name === 'AbortError') {
                        // 큐 처리 중 외부(재분석/재전사/취소 등)가 공유 abort ref를 건드려 중단된 경우:
                        // 무한 스피너로 방치하지 말고, 아직 분석 중이면 재시도 가능한 상태로 전환한다.
                        setFiles(prev => prev.map(p => (p.id === fItem.id && p.isAnalyzing)
                            ? { ...p, isAnalyzing: false, error: "분석이 중단됐어요. 다시 시도할 수 있습니다." }
                            : p));
                        continue;
                    }
                    console.error("Analysis Error", err);
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
                }
            }
        } finally {
            queueRunningRef.current = false;
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
                    // 진단용 토스트로 저장 성공/실패를 화면에 노출 (콘솔 없이도 원인 파악)
                    try {
                        const existing = await mediaStore.getFileFlexible(fItem.file.name, fItem.file.size);
                        if (existing) {
                            if (showToast) showToast({ message: `영상 이미 저장됨 (${(fItem.file.size / 1048576).toFixed(0)}MB) — 새로고침 유지 정상`, type: 'success' });
                        } else if (!fItem.file.size) {
                            if (showToast) showToast({ message: '영상 저장 불가: 빈 파일(0바이트) — 온디맨드/클라우드 파일일 수 있음', type: 'error' });
                        } else {
                            await mediaStore.saveFile(fItem.file, { name: fItem.file.name, size: fItem.file.size });
                            if (showToast) showToast({ message: `영상 저장 완료 (${(fItem.file.size / 1048576).toFixed(0)}MB) — 이제 새로고침해도 유지`, type: 'success' });
                        }
                    } catch (e) {
                        console.warn("캐시 히트 미디어 저장 실패:", e);
                        if (showToast) showToast({ message: `영상 저장 실패: ${e.name || ''} ${e.message || e}`, type: 'error' });
                    }
                    return;
                }

                // 캐시 없음 → 순차 큐에 넣고 워커 가동 (여러 파일이 서로를 중단시키지 않게 하나씩 완료)
                analysisQueueRef.current.push(fItem);
                processAnalysisQueue();
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
        const clearRetranscribingFlag = makeClearRetranscribingFlag(setFiles, fileId);
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
                runStage2(fileId, targetFile, cleanData, apiKey, stage3Model); // 신원=targetFile (이 위의 persistCache와 동일 키)
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
                // 원본이 분석돼 있었으면 복원용으로 보관 (전사의심 플래그도 함께 — 실패 복원 시 배지 유지)
                if (d.isAnalyzed) snapshot.set(i, { translation: d.translation, analysis: d.analysis, a: d.a, transcriptSuspect: d.transcriptSuspect || '', isAnalyzed: true });
                // analysisFailed 해제 → 재시도 동안은 실패 UI가 아니라 로딩 스피너로 표시
                return { ...d, translation: '', analysis: '', a: '', transcriptSuspect: '', isAnalyzed: false, analysisFailed: false };
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
                    return { ...d, ...snapshot.get(i), analysisFailed: false }; // 실패분은 원본 분석으로 복원(실패 표시 해제)
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
     * [대사 끝 시각 감지] '대사만 재생' 모드용 1회성 패스.
     * 오디오+대본을 보내 문장별 speechEnd(대사가 실제로 끝나는 시각)를 받아 캐시에 저장한다.
     * Stage 1/2 파이프라인·전역 abort 채널을 일절 건드리지 않는다(큐 간섭 없음).
     * 병합은 스냅샷이 아니라 '최신 상태' 위에 한다 — 감지가 도는 몇 분 사이 Stage 2가
     * 분석을 채워 넣어도 덮어쓰지 않고, 문장별 seconds 일치 검사로 인덱스 어긋남도 방어.
     */
    const detectSpeechEndsForFile = async (fileId, { onlyMissing = false } = {}) => {
        if (!apiKey) {
            if (showToast) showToast({ message: '설정에서 Gemini API 키를 먼저 입력하세요.', type: 'error' });
            return false;
        }
        if (speechBusyRef.current) return false; // 중복 실행 방지 (ref — 자동 실행 경로의 stale state 회피)

        let targetFile = null; let targetUrl = null; let snapshot = null;
        setFiles(prev => {
            const f = prev.find(p => p.id === fileId);
            if (f) { targetFile = f.file; targetUrl = f.url; snapshot = f.data; }
            return prev;
        });
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !Array.isArray(snapshot) || snapshot.length === 0) return false;

        speechBusyRef.current = true;
        setSpeechDetectBusy(fileId);
        try {
            // [실체 확보 3단 폴백] 캐시에서 복원한 파일의 f.file은 실제 파일이 아니라
            // {name,type,size} 자리표시자일 수 있다(loadCache). 그걸 그대로 오디오 추출에
            // 넘기면 FileReader가 "not of type 'Blob'"으로 터진다 → Blob 여부를 먼저 검사하고,
            // 자리표시자면 IndexedDB(원본 저장소) → 재생 URL(fetch) 순으로 진짜 바이트를 확보한다.
            const isRealBlob = (b) => typeof Blob !== 'undefined' && b instanceof Blob && b.size > 0;
            let fileForAnalysis = null;
            if (isRealBlob(targetFile)) {
                fileForAnalysis = targetFile;
                try {
                    fileForAnalysis = await materializeFile(targetFile, {
                        onWait: (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중...', type: 'success' }); }
                    });
                } catch (e) {
                    console.warn('[SpeechEnd] 메모리 적재 실패 → 원본으로 진행:', e.message);
                }
            } else {
                try {
                    const stored = await mediaStore.getFileFlexible(targetFile.name, targetFile.size);
                    if (isRealBlob(stored)) {
                        fileForAnalysis = new File([stored], targetFile.name || 'media', { type: stored.type || targetFile.type || 'application/octet-stream' });
                        console.log('[SpeechEnd] IndexedDB에서 원본 확보');
                    }
                } catch (e) { console.warn('[SpeechEnd] IndexedDB 조회 실패:', e); }
                if (!fileForAnalysis && targetUrl) {
                    try {
                        const res = await fetch(targetUrl);
                        const blob = await res.blob();
                        if (isRealBlob(blob)) {
                            fileForAnalysis = new File([blob], targetFile.name || 'media', { type: blob.type || targetFile.type || 'application/octet-stream' });
                            console.log('[SpeechEnd] 재생 URL에서 원본 확보');
                        }
                    } catch (e) { console.warn('[SpeechEnd] 재생 URL 읽기 실패:', e); }
                }
                if (!fileForAnalysis) {
                    if (showToast) showToast({ message: '원본 미디어를 읽을 수 없어요. 하단의 "연결하기"로 원본 파일을 연결한 뒤 다시 시도해 주세요.', type: 'error' });
                    return false;
                }
            }

            let duration = 0;
            try { duration = await getMediaDuration(fileForAnalysis); } catch { /* 0이면 상한 클램프 생략 */ }

            // onlyMissing: 유효한 speechEnd가 아직 없는 문장만 골라 재감지 —
            // 이미 감지된 문장은 목록에서 빼서(덮어쓸 일 없음) 모델이 빠진 문장에만 집중하게 한다.
            // onlyMissing: 유효 speechEnd가 없고 '아직 포기 표시도 안 된' 문장만 재요청
            // (speechEndSkipped = 이미 시도했는데 모델이 판단 못 한 구간 → 반복 요청해봐야 비용만 든다)
            const sentences = snapshot
                .map((d, i) => ({ index: i, seconds: d.seconds, text: d.text, done: validSpeechEnd(d) !== null || !!d.speechEndSkipped }))
                .filter(s => !onlyMissing || !s.done)
                .map(({ index, seconds, text }) => ({ index, seconds, text }));
            if (sentences.length === 0) {
                if (showToast) showToast({ message: '더 감지할 문장이 없어요. (남은 문장은 소리로 끝을 판단하기 어려운 구간이에요)', type: 'success' });
                return true;
            }
            const ends = await detectSpeechEnds(fileForAnalysis, apiKey, stage1Model, sentences);

            // 최신 상태에 병합. 채택 조건(환각 방어): 시작+0.2초 이후, 지속 60초 이내, 영상 길이 이내.
            // 스냅샷과 seconds가 다른 문장(감지 중 재전사/삭제됨)은 건너뛴다.
            // [필수 가드] 이번에 '요청한' 인덱스만 병합한다.
            // onlyMissing이면 희소 인덱스([3],[17],[42]…)를 보내는데, 모델이 규칙 5의 '순서대로 출력'을
            // 0,1,2…로 재번호매김하면 ends의 키가 요청과 무관해진다. 그대로 적용하면 이미 정상 감지된
            // 앞쪽 문장들의 speechEnd가 엉뚱한 값으로 덮어쓰이고 캐시·클라우드에 영속된다.
            const requested = new Set(sentences.map(s => s.index));
            let applied = 0; let latestData = null;
            setFiles(prev => prev.map(p => {
                if (p.id !== fileId) return p;
                const merged = p.data.map((d, i) => {
                    if (!requested.has(i)) return d;
                    if (!snapshot[i] || snapshot[i].seconds !== d.seconds) return d;
                    let se = ends.get(i);
                    if (typeof se !== 'number' || !Number.isFinite(se)) {
                        // 요청했는데 값이 안 온 문장(모델이 SKIP했거나 누락) → '시도했음' 표시.
                        // 안 하면 감지 불가 구간이 영원히 미감지로 집계돼 배지가 안 사라지고
                        // 재감지를 누를 때마다 오디오 1회 전송 비용이 반복된다.
                        return d.speechEndSkipped ? d : { ...d, speechEndSkipped: true };
                    }
                    if (duration > 0) se = Math.min(se, duration);
                    if (se <= d.seconds + 0.2 || se - d.seconds > 60) {
                        return d.speechEndSkipped ? d : { ...d, speechEndSkipped: true };
                    }
                    applied++;
                    // 동기 사본(graft ref)에도 기록 — 진행 중인 Stage 2가 스냅샷으로 덮어써도 이식돼 살아남는다
                    speechEndGraftRef.current.set(`${targetFile.name}_${targetFile.size}|${d.seconds}`, se);
                    const next = { ...d, speechEnd: se };
                    delete next.speechEndSkipped; // 재시도로 성공하면 포기 표시 해제
                    return next;
                });
                latestData = merged;
                return { ...p, data: merged };
            }));
            await new Promise(r => setTimeout(r, 0));

            if (applied === 0 || !latestData) {
                if (showToast) showToast({ message: '대사 구간을 감지하지 못했어요. 잠시 후 다시 시도해 주세요.', type: 'error' });
                return false;
            }
            const status = latestData.every(d => d.isAnalyzed) ? 'completed' : 'analyzing';
            // [중요] 저장 결과를 반드시 검사한다. 예전엔 반환값을 버리고 곧바로 '감지 완료' 성공
            // 토스트를 띄웠는데, 토스트는 슬롯이 하나라 persistCache가 띄운 실패 경고를 덮어썼다.
            // 게다가 용량 경고는 세션당 1회(quotaWarnedRef)라 두 번째부터는 완전 무음 →
            // 사용자는 '완료'만 보고 대본을 옮겼다가, 돌아와서 감지 결과가 사라진 걸 발견하게 된다.
            // (로컬 캐시가 유일한 영속 경로다. 여기 실패 = 다음 방문에 확실히 유실)
            const saved = persistCache(targetFile, latestData, status);
            if (refreshCacheKeys) refreshCacheKeys();
            // 클라우드 저장은 CLOUD_ENABLED=false로 꺼져 있어 조용히 early-return 한다.
            // (예전엔 여기 실패 시 빨간 토스트를 띄웠는데, 로컬 저장이 이미 끝난 뒤라 문구가
            //  사실과 반대였고 '감지 완료' 성공 토스트와 동시에 떴다 → 제거. 다른 5개 클라우드
            //  호출부와 동일하게 console.warn만 남긴다.)
            cloudSaveMeta(targetFile, latestData, status, null, duration)
                .catch(e => console.warn('[SpeechEnd] 클라우드 반영 실패:', e));

            if (!saved || !saved.ok) {
                if (showToast) showToast({
                    message: saved && saved.reason === 'quota'
                        ? '⚠️ 저장 공간이 꽉 차 감지 결과를 저장하지 못했어요. 목록(휴지통·저장 기록)에서 오래된 대본을 지운 뒤 다시 시도해 주세요. — 지금 화면에서는 동작하지만, 다른 대본에 갔다 오면 사라집니다.'
                        : `⚠️ 감지 결과를 저장하지 못했어요 (${(saved && saved.message) || '알 수 없는 오류'}). 다른 대본에 갔다 오면 사라집니다.`,
                    type: 'error',
                    duration: 12000,
                });
                return true; // 감지 자체는 성공(화면엔 반영됨) — 재시도 루프를 유발하지 않는다
            }
            // 미감지 문장이 남았으면 '그 문장들만' 재감지하는 액션 제공 (기감지분은 안 건드림)
            const remaining = latestData.filter(d => validSpeechEnd(d) === null && !d.speechEndSkipped).length;
            if (showToast) {
                if (remaining > 0) {
                    showToast({
                        message: `대사 구간 감지 완료 (${applied}/${sentences.length}문장 · 미감지 ${remaining}개)`,
                        type: 'success',
                        duration: 8000,
                        action: { label: `빠진 ${remaining}개 재시도`, onClick: () => detectSpeechEndsForFile(fileId, { onlyMissing: true }) },
                    });
                } else {
                    showToast({ message: `대사 구간 감지 완료 (전체 ${latestData.length}문장)`, type: 'success' });
                }
            }
            return true;
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('[SpeechEnd] 감지 실패:', e);
                if (showToast) showToast({ message: `대사 구간 감지 실패: ${e.message || e}`, type: 'error' });
            }
            return false;
        } finally {
            speechBusyRef.current = false;
            setSpeechDetectBusy(null);
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
        const clearRetranscribingFlag = makeClearRetranscribingFlag(setFiles, fileId);
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
            runStage2(fileId, targetFile, cleanData, apiKey, stage3Model); // 신원=targetFile (이 위의 persistCache와 동일 키)
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

    // 진행 중인 Stage1 전사를 사용자가 취소.
    // abort 후 해당 파일을 취소 상태로 전환 → 무한 스피너 대신 재시도 가능한 에러 카드 노출.
    const cancelStage1 = (fileId) => {
        if (stage1AbortRef.current) stage1AbortRef.current.abort();
        setFiles(prev => prev.map(p => p.id === fileId
            ? { ...p, isAnalyzing: false, error: "전사를 취소했습니다. 다시 시도할 수 있습니다." }
            : p));
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

    return { processFiles, runStage2, retryAnalysis, retranscribeSentences, reanalyzeSentences, recoverGap, deleteSentences, restoreSentences, cancelStage1, stage1AbortRef, isDragging, onDragOver, onDragLeave, onDrop, stage2Progress, detectSpeechEndsForFile, speechDetectBusy };
};
