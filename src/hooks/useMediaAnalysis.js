import { useState, useRef } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { extractTranscript, analyzeBatchSentences } from '../services/gemini';
import { parseCacheEntry, saveCacheEntry } from '../utils/cacheUtils';

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

        const BATCH_SIZE = 20;
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

        const rawData = await extractTranscript(file, apiKey, stage1Model, fileDuration, (incrementalData) => {
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: incrementalData } : p));
        }, temperature, topP, signal, antiRecitation, markerChar, markerInterval);

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

                const cacheKey = `gemini_analysis_${fItem.file.name}_${fItem.file.size}`;
                const cacheEntry = parseCacheEntry(cacheKey);

                if (cacheEntry) {
                    console.log("Using cached analysis for", fItem.file.name);
                    let cacheDuration = 0;
                    try { cacheDuration = await getMediaDuration(fItem.file); } catch (e) { console.warn("Failed to get cached media duration:", e); }
                    const data = sanitizeData(cacheEntry.rawData, cacheDuration);
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data: data, isAnalyzing: false, isFromCache: true } : p));
                } else {
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, isAnalyzing: true } : p));

                    const data = await runStage1(fItem.id, fItem.file);

                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data: data, isAnalyzing: false } : p));

                    saveCacheEntry(fItem.file, data, 'extracted');
                    if (refreshCacheKeys) refreshCacheKeys();

                    runStage2(fItem.id, fItem.file, data, apiKey, stage2Model);

                    try {
                        await mediaStore.saveFile(fItem.file);
                    } catch (storageError) {
                        console.warn("Failed to save media file to store", storageError);
                    }
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

            const data = await runStage1(fileId, targetFile);

            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: data, isAnalyzing: false } : p));

            saveCacheEntry(targetFile, data, 'extracted');
            if (refreshCacheKeys) refreshCacheKeys();

            runStage2(fileId, targetFile, data, apiKey, stage2Model);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error("Retry Analysis Error", err);
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
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
        processFiles(e.dataTransfer.files);
    };

    return { processFiles, runStage2, retryAnalysis, stage1AbortRef, isDragging, onDragOver, onDragLeave, onDrop };
};
