import { useState, useRef } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { extractTranscript, analyzeBatchSentences, retranscribeSegments } from '../services/gemini';
import { parseCacheEntry, saveCacheEntry } from '../utils/cacheUtils';
import { uploadMedia as cloudUploadMedia, saveMeta as cloudSaveMeta } from '../services/cloudSync';
import { materializeFile } from '../utils/materializeFile';
import { getStage2Concurrency } from '../constants/models';
import { addToTrash, removeFromTrash, sentenceKey } from '../utils/trashUtils';

export const useMediaAnalysis = ({
    setFiles,
    setActiveFileId,
    setIsSwitchingFile,
    resetPlayerState,
    refreshCacheKeys,
    apiKey,
    stage1Model,
    stage2Model,
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
    const stage1AbortRef = useRef(null);

    /**
     * STAGE 2: FULL BATCH ANALYSIS
     */
    const runStage2 = async (fileId, fileInfo, transcript, currentApiKey, currentModelId) => {
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

        if (pendingIndices.length === 0) return;

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
                        const isLast = i + (currentBatchGroup.length * BATCH_SIZE) >= pendingIndices.length;
                        saveCacheEntry(fileInfo, workingData, isLast ? 'completed' : 'analyzing');
                        if (refreshCacheKeys) refreshCacheKeys();
                    }
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    console.error(`[Stage 2] Batch failed:`, e);
                }
            });

            await Promise.all(batchPromises);
        }

        if (!signal.aborted && totalSuccessCount === 0 && pendingIndices.length > 0) {
            console.error('[Stage 2] All batches failed.');
            if (showToast) showToast({ message: '분석 실패: API 오류가 발생했습니다. 설정에서 모델을 확인해주세요.', type: 'error' });
        }

        // 클라우드에 최종 분석 결과 반영 (best-effort, mediaUrl은 서버가 기존 값 보존)
        if (!signal.aborted && totalSuccessCount > 0) {
            const allDone = workingData.every(d => d.isAnalyzed);
            cloudSaveMeta(fileInfo, workingData, allDone ? 'completed' : 'analyzing', null, 0)
                .catch(e => console.warn('[Cloud] 분석 결과 저장 실패:', e));
        }

        console.log(`[Stage 2] Finished. Analyzed: ${totalSuccessCount}/${pendingIndices.length}`);
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

        saveCacheEntry(sourceFile, data, 'extracted');
        if (refreshCacheKeys) refreshCacheKeys();

        runStage2(fileId, fileForAnalysis, data, apiKey, stage2Model);

        if (saveMedia) {
            try {
                await mediaStore.saveFile(fileForAnalysis);
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
                blockMap.set(lo, { lo, hi, start: t, end, prevText, nextText, selfText });
            }
            const blocks = [...blockMap.values()].sort((a, b) => a.lo - b.lo);
            const windows = blocks.map(b => ({ start: b.start, end: b.end, prevText: b.prevText, nextText: b.nextText, selfText: b.selfText }));

            const perWindow = await retranscribeSegments(fileForAnalysis, apiKey, stage1Model, windows, {
                totalDuration: duration,
                temperature,
                topP,
                signal,
                antiRecitation,
                markerChar,
                markerInterval,
                mediaSrc: targetUrl, // 실시간 캡처용(모바일 대응). 실패 시 전체추출 폴백
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
            saveCacheEntry(targetFile, cleanData, allDone ? 'completed' : 'analyzing');
            if (refreshCacheKeys) refreshCacheKeys();

            if (replacedCount > 0) {
                if (showToast) showToast({
                    message: `${replacedCount}개 구간 재전사 완료${failedCount ? `, ${failedCount}개는 실패로 원본 유지` : ''}. 분석 진행 중...`,
                    type: 'success'
                });
                // 새로 들어온(미분석) 문장만 분석
                runStage2(fileId, fileForAnalysis, cleanData, apiKey, stage2Model);
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
        setFiles(prev => prev.map(p => {
            if (p.id !== fileId) return p;
            targetFile = p.file;
            // 선택 문장만 미분석 상태로 리셋 (전사 텍스트·타임스탬프는 유지)
            resetData = p.data.map((d, i) => idxSet.has(i)
                ? { ...d, translation: '', analysis: '', a: '', isAnalyzed: false }
                : d);
            return { ...p, data: resetData };
        }));
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !resetData) return;

        saveCacheEntry(targetFile, resetData, 'analyzing');
        if (refreshCacheKeys) refreshCacheKeys();

        if (showToast) showToast({ message: `${idxSet.size}개 문장 분석을 다시 진행 중...`, type: 'success' });
        // 미분석(리셋된) 문장만 Stage 2가 다시 분석 (설정의 Stage 2 모델)
        runStage2(fileId, targetFile, resetData, apiKey, stage2Model);
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
            saveCacheEntry(targetFile, data, status);
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
        saveCacheEntry(targetFile, clean, status);
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

    return { processFiles, runStage2, retryAnalysis, retranscribeSentences, reanalyzeSentences, deleteSentences, restoreSentences, stage1AbortRef, isDragging, onDragOver, onDragLeave, onDrop };
};
