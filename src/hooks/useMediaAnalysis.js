import { useState } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { extractTranscript, analyzeBatchSentences } from '../services/gemini';

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
    stage2AbortRef,
    showToast
}) => {
    const [isDragging, setIsDragging] = useState(false);

    /**
     * STAGE 2: FULL BATCH ANALYSIS (All at once)
     */
    const runStage2 = async (fileId, fileInfo, transcript, currentApiKey, currentModelId) => {
        console.log(`[Stage 2] Starting FULL BATCH Analysis for file ${fileId}...`);

        if (stage2AbortRef.current) stage2AbortRef.current.abort();
        stage2AbortRef.current = new AbortController();
        const { signal } = stage2AbortRef.current;

        const updateGlobalState = (data) => {
            setFiles(prev => prev.map(f => f.id === fileId ? { ...f, data: [...data] } : f));
        };

        const saveToCache = (fInfo, data, status) => {
            if (!fInfo || !fInfo.name) return;
            const cacheKey = `gemini_analysis_${fInfo.name}_${fInfo.size}`;
            try {
                localStorage.setItem(cacheKey, JSON.stringify({
                    data,
                    metadata: {
                        name: fInfo.name,
                        size: fInfo.size,
                        lastModified: fInfo.lastModified,
                        savedAt: Date.now(),
                        status
                    }
                }));
                if (refreshCacheKeys) refreshCacheKeys();
            } catch (e) { console.warn("Failed to save cache:", e); }
        };

        const pendingIndices = transcript
            .map((item, idx) => ({ item, idx }))
            .filter(x => !x.item.isAnalyzed)
            .map(x => x.idx);

        if (pendingIndices.length === 0) return;

        // 20개씩 묶어 동시 처리 (Pro는 RPM 낮아서 2, 나머지는 3)
        const BATCH_SIZE = 20;
        const CONCURRENCY = currentModelId === 'gemini-2.5-pro' ? 2 : 3;
        const batches = [];
        for (let i = 0; i < pendingIndices.length; i += BATCH_SIZE) {
            batches.push(pendingIndices.slice(i, i + BATCH_SIZE));
        }

        console.log(`[Stage 2] Split into ${batches.length} batches (Max 2 concurrent).`);

        let workingData = JSON.parse(JSON.stringify(transcript));
        let totalSuccessCount = 0;

        // 배치 순차 처리 (병렬성 제어)
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
                        // 중간 결과 반영 및 저장
                        updateGlobalState(workingData);
                        saveToCache(fileInfo, workingData, i + (currentBatchGroup.length * BATCH_SIZE) >= pendingIndices.length ? 'completed' : 'analyzing');
                    }
                } catch (e) {
                    console.error(`[Stage 2] Batch failed:`, e);
                }
            });

            await Promise.all(batchPromises);
        }

        if (!signal.aborted && totalSuccessCount === 0 && pendingIndices.length > 0) {
            console.error('[Stage 2] All batches failed — no sentences analyzed.');
            if (showToast) showToast({ message: '분석 실패: API 오류가 발생했습니다. 설정에서 모델을 확인해주세요.', type: 'error' });
        }

        console.log(`[Stage 2] Full Batch processing finished. Analyzed: ${totalSuccessCount}/${pendingIndices.length}`);
    };

    const processFiles = async (fileList) => {
        setIsDragging(false);
        if (!fileList || fileList.length === 0) return;

        // Force Reset
        setIsSwitchingFile(true);
        if (resetPlayerState) resetPlayerState();

        console.log("[Upload] Processing files...", fileList);

        const newFiles = Array.from(fileList).map(f => ({
            id: Math.random().toString(36).substr(2, 9),
            file: f,
            url: URL.createObjectURL(f),
            data: [],
            isAnalyzing: true,
            error: null
        }));

        setFiles(prev => [...prev, ...newFiles]);

        if (newFiles.length > 0) {
            setActiveFileId(newFiles[0].id);
        }
        setIsSwitchingFile(false);

        newFiles.forEach(async (fItem) => {
            try {
                if (!apiKey) throw new Error("Please set Gemini API Key in Settings.");

                // --- CACHE CHECK ---
                const cacheKey = `gemini_analysis_${fItem.file.name}_${fItem.file.size}`;
                const cached = localStorage.getItem(cacheKey);

                if (cached) {
                    console.log("Using cached analysis for", fItem.file.name);
                    const parsed = JSON.parse(cached);
                    const rawData = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed.data : parsed;
                    let cacheDuration = 0;
                    try { cacheDuration = await getMediaDuration(fItem.file); } catch (e) { console.warn("Failed to get cached media duration:", e); }
                    const data = sanitizeData(rawData, cacheDuration);
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data: data, isAnalyzing: false, isFromCache: true } : p));
                } else {
                    // API Call
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, isAnalyzing: true } : p));

                    let rawData;
                    let fileDuration = 0;
                    try {
                        fileDuration = await getMediaDuration(fItem.file);
                        console.log(`[Stage 1] Real duration for ${fItem.file.name}: ${fileDuration}s (Temp: ${temperature}, TopP: ${topP})`);

                        rawData = await extractTranscript(fItem.file, apiKey, stage1Model, fileDuration, (incrementalData) => {
                            setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data: incrementalData } : p));
                        }, temperature, topP);
                    } catch (apiError) {
                        throw new Error(`API Error (Stage 1): ${apiError.message}`);
                    }

                    if (!rawData) throw new Error("Received empty data from Stage 1 API");

                    const data = sanitizeData(rawData, fileDuration);

                    if (data.length === 0) {
                        throw new Error("Stage 1 extraction returned no valid text data.");
                    }

                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data: data, isAnalyzing: false } : p));

                    // [Phase 4] 히스토리 미표시 수정: 1단계 완료 즉시 중간 저장
                    try {
                        const cacheData = {
                            data: data,
                            metadata: {
                                name: fItem.file.name,
                                size: fItem.file.size,
                                type: fItem.file.type,
                                lastModified: fItem.file.lastModified,
                                savedAt: Date.now(),
                                status: 'extracted'
                            }
                        };
                        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                        if (refreshCacheKeys) refreshCacheKeys();
                    } catch (e) { console.warn("Failed to save Stage 1 cache:", e); }

                    runStage2(fItem.id, fItem.file, data, apiKey, stage2Model);

                    try {
                        await mediaStore.saveFile(fItem.file);
                    } catch (storageError) {
                        console.warn("Failed to save media file to store", storageError);
                    }
                }
            } catch (err) {
                console.error("Analysis Error", err);
                setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
            }
        });
    };

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

    return { processFiles, runStage2, isDragging, onDragOver, onDragLeave, onDrop };
};
