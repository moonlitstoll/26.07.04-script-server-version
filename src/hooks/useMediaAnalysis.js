import { useState, useRef } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { extractTranscript, analyzeBatchSentences } from '../services/gemini';
import { parseCacheEntry, saveCacheEntry } from '../utils/cacheUtils';
import { uploadMedia as cloudUploadMedia, saveMeta as cloudSaveMeta } from '../services/cloudSync';
import { materializeFile, materializeFromHandle } from '../utils/materializeFile';

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
    stage2AbortRef,
    showToast
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
        const CONCURRENCY = currentModelId === 'gemini-2.5-pro' ? 2 : 3;
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
                try {
                    const results = await analyzeBatchSentences(batchItems, currentApiKey, currentModelId, signal);
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
    const runStage1 = async (fileId, file) => {
        // 기존 Stage 1 중단
        if (stage1AbortRef.current) stage1AbortRef.current.abort();
        stage1AbortRef.current = new AbortController();
        const { signal } = stage1AbortRef.current;

        let fileDuration = 0;
        try {
            fileDuration = await getMediaDuration(file);
            console.log(`[Stage 1] Real duration for ${file.name}: ${fileDuration}s (Temp: ${temperature}, TopP: ${topP})`);
        } catch (e) { console.warn("Failed to get media duration:", e); }

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
        });

        if (!rawData) throw new Error("Received empty data from Stage 1 API");

        const data = sanitizeData(rawData, fileDuration);
        if (data.length === 0) throw new Error("Stage 1 extraction returned no valid text data.");

        return data;
    };

    const processFiles = async (fileList) => {
        setIsDragging(false);
        if (!fileList || fileList.length === 0) return;

        setIsSwitchingFile(true);
        if (resetPlayerState) resetPlayerState();

        console.log("[Upload] Processing files...", fileList);

        // 입력 정규화: File(기존 <input>/드래그) 또는 { file, handle }(File System Access API)
        const items = Array.from(fileList).map(src =>
            (src instanceof File) ? { file: src, handle: null } : { file: src.file, handle: src.handle || null }
        );

        const newFiles = items.map(it => ({
            id: Math.random().toString(36).substr(2, 9),
            file: it.file,
            handle: it.handle,
            url: null, // 메모리 적재(materializeFile) 후 설정
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
                if (!apiKey) throw new Error("Please set Gemini API Key in Settings.");

                // ① 가능하면 메모리에 적재(OneDrive/Drive 온디맨드 대응).
                //    핸들이 있으면 매번 새 참조를 재획득(스트리밍 파일 대응), 없으면 일반 적재.
                //    실패해도 절대 중단하지 않고 원본 파일로 그대로 진행 → 기존 동작 보존
                const onWait = (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중... (클라우드 다운로드 대기)', type: 'success' }); };
                let file = fItem.file;
                try {
                    file = fItem.handle
                        ? await materializeFromHandle(fItem.handle, { onWait })
                        : await materializeFile(fItem.file, { onWait });
                } catch (e) {
                    console.warn('[Stage 1] 메모리 적재 실패 → 원본 파일로 진행:', e.message);
                    file = fItem.file;
                }
                // 재생용 URL 생성 (메모리 파일 우선, 실패 시 원본)
                const objectUrl = URL.createObjectURL(file);
                setFiles(prev => prev.map(p => {
                    if (p.id !== fItem.id) return p;
                    if (p.url) URL.revokeObjectURL(p.url);
                    return { ...p, file, url: objectUrl };
                }));

                const cacheKey = `gemini_analysis_${file.name}_${file.size}`;
                const cacheEntry = parseCacheEntry(cacheKey);

                if (cacheEntry) {
                    console.log("Using cached analysis for", file.name);
                    let cacheDuration = 0;
                    try { cacheDuration = await getMediaDuration(file); } catch (e) { console.warn("Failed to get cached media duration:", e); }
                    const data = sanitizeData(cacheEntry.rawData, cacheDuration);
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data: data, isAnalyzing: false, isFromCache: true } : p));
                } else {
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, isAnalyzing: true } : p));

                    const data = await runStage1(fItem.id, file);

                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data: data, isAnalyzing: false } : p));

                    saveCacheEntry(file, data, 'extracted');
                    if (refreshCacheKeys) refreshCacheKeys();

                    runStage2(fItem.id, file, data, apiKey, stage2Model);

                    try {
                        await mediaStore.saveFile(file);
                    } catch (storageError) {
                        console.warn("Failed to save media file to store", storageError);
                    }

                    // 클라우드 동기화 (best-effort): 원본 영상 업로드 + 대본 저장 → 다른 기기서 열람 가능
                    (async () => {
                        try {
                            let mediaUrl = null;
                            try {
                                mediaUrl = await cloudUploadMedia(file);
                            } catch (e) {
                                console.warn('[Cloud] 영상 업로드 실패:', e);
                            }
                            let dur = 0;
                            try { dur = await getMediaDuration(file); } catch { /* noop */ }
                            await cloudSaveMeta(file, data, 'extracted', mediaUrl, dur);
                        } catch (e) {
                            console.warn('[Cloud] 대본 저장 실패:', e);
                        }
                    })();
                }
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
            if (!apiKey) throw new Error("Please set Gemini API Key in Settings.");

            // 가능하면 메모리에 적재. 실패해도 중단하지 않고 원본으로 진행 (기존 동작 보존)
            let file = targetFile;
            try {
                file = await materializeFile(targetFile, {
                    onWait: (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중... (클라우드 다운로드 대기)', type: 'success' }); }
                });
            } catch (e) {
                console.warn('[Retry] 메모리 적재 실패 → 원본 파일로 진행:', e.message);
                file = targetFile;
            }
            const objectUrl = URL.createObjectURL(file);
            setFiles(prev => prev.map(p => {
                if (p.id !== fileId) return p;
                if (p.url) URL.revokeObjectURL(p.url);
                return { ...p, file, url: objectUrl };
            }));

            const data = await runStage1(fileId, file);

            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: data, isAnalyzing: false } : p));

            saveCacheEntry(file, data, 'extracted');
            if (refreshCacheKeys) refreshCacheKeys();

            runStage2(fileId, file, data, apiKey, stage2Model);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error("Retry Analysis Error", err);
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
        }
    };

    // File System Access API로 파일 선택 (파일 핸들 확보 → 클라우드 스트리밍 파일 재획득 가능)
    // 미지원 브라우저에서는 false 반환 → 호출부가 기존 <input>으로 폴백
    const openFilePicker = async () => {
        if (!window.showOpenFilePicker) return false;
        try {
            const handles = await window.showOpenFilePicker({
                multiple: true,
                types: [{
                    description: 'Media',
                    accept: {
                        'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'],
                        'audio/*': ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'],
                    },
                }],
            });
            const picked = await Promise.all(handles.map(async h => ({ handle: h, file: await h.getFile() })));
            processFiles(picked);
            return true;
        } catch (e) {
            if (e && e.name === 'AbortError') return true; // 사용자가 취소한 경우
            console.warn('[Picker] showOpenFilePicker 실패 → 기본 입력으로 폴백:', e);
            return false;
        }
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
        setIsDragging(false);
        const dt = e.dataTransfer;
        const filesFallback = Array.from(dt.files || []);
        const dtItems = dt.items;
        // 가능하면 드롭 항목에서 파일시스템 핸들 확보 (스트리밍 파일 재획득 대응)
        if (dtItems && dtItems.length && typeof dtItems[0].getAsFileSystemHandle === 'function') {
            const handlePromises = [];
            for (const it of Array.from(dtItems)) {
                if (it.kind === 'file') handlePromises.push(it.getAsFileSystemHandle());
            }
            Promise.all(handlePromises).then(async (handles) => {
                const picked = [];
                for (const handle of handles) {
                    if (handle && handle.kind === 'file') {
                        try { picked.push({ handle, file: await handle.getFile() }); } catch { /* skip */ }
                    }
                }
                processFiles(picked.length ? picked : filesFallback);
            }).catch(() => processFiles(filesFallback));
            return;
        }
        processFiles(filesFallback);
    };

    return { processFiles, openFilePicker, runStage2, retryAnalysis, stage1AbortRef, isDragging, onDragOver, onDragLeave, onDrop };
};
