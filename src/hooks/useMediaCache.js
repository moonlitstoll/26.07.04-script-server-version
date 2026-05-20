import { useState, useEffect, useCallback } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';

export const useMediaCache = ({
    files,
    setFiles,
    setActiveFileId,
    setShowSettings,
    setShowCacheHistory,
    setIsSwitchingFile,
    resetPlayerState,
    runStage2,
    apiKey,
    stage2Model,
    stage2AbortRef,
    showConfirm,
    showToast
}) => {
    const [cacheKeys, setCacheKeys] = useState([]);

    const refreshCacheKeys = useCallback(() => {
        setCacheKeys(Object.keys(localStorage).filter(k => k.startsWith('gemini_analysis_')));
    }, []);

    useEffect(() => {
        refreshCacheKeys();
    }, [refreshCacheKeys]);

    const deleteCache = async (key) => {
        showConfirm({
            message: "이 분석 기록을 삭제하시겠습니까?",
            onConfirm: async () => {
                const cachedStr = localStorage.getItem(key);
                localStorage.removeItem(key);
                setCacheKeys(prev => prev.filter(k => k !== key));

                if (cachedStr) {
                    try {
                        const parsed = JSON.parse(cachedStr);
                        const hasMetadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.data;
                        if (hasMetadata && parsed.metadata.name) {
                            await mediaStore.deleteFile(parsed.metadata.name, parsed.metadata.size);
                        }
                    } catch (e) { console.warn("Failed to parse cache for cleanup:", e); }
                }
                showToast({ message: "삭제 완료", type: "success" });
            }
        });
    };

    const clearAllCache = async () => {
        const count = cacheKeys.length;
        showConfirm({
            message: `저장된 분석 기록 ${count}개를 모두 삭제하시겠습니까?`,
            onConfirm: async () => {
                if (stage2AbortRef && stage2AbortRef.current) stage2AbortRef.current.abort();
                cacheKeys.forEach(k => localStorage.removeItem(k));
                await mediaStore.clearAll();
                setCacheKeys([]);
                showToast({ message: "전체 기록 삭제 완료", type: "success" });
            }
        });
    };

    const loadCache = async (key) => {
        if (resetPlayerState) resetPlayerState();
        if (setIsSwitchingFile) setIsSwitchingFile(true);

        const cachedStr = localStorage.getItem(key);
        if (cachedStr) {
            try {
                const parsed = JSON.parse(cachedStr);
                const hasMetadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.data;
                const rawData = hasMetadata ? parsed.data : parsed;

                if (!Array.isArray(rawData)) {
                    throw new Error("Invalid cache format: Data is not an array. Please clear cache.");
                }

                const metadata = hasMetadata ? parsed.metadata : { name: key.replace('gemini_analysis_', '').replace(/_\d+$/, '') };

                let matchingFile = null;
                if (hasMetadata && metadata.size) {
                    matchingFile = files.find(f => f.file.name === metadata.name && f.file.size === metadata.size);
                } else {
                    matchingFile = files.find(f => f.file.name === metadata.name);
                }

                let mediaBlob = null;
                let mediaUrl = matchingFile ? matchingFile.url : null;
                let fileForDuration = matchingFile ? matchingFile.file : null;

                if (!mediaUrl && metadata.name && metadata.size) {
                    try {
                        mediaBlob = await mediaStore.getFile(metadata.name, metadata.size);
                        if (mediaBlob) {
                            mediaUrl = URL.createObjectURL(mediaBlob);
                            fileForDuration = mediaBlob;
                        }
                    } catch (e) {
                        console.error("Failed to load media from store:", e);
                    }
                }

                let cacheDuration = 0;
                if (fileForDuration) {
                    try { cacheDuration = await getMediaDuration(fileForDuration); } catch (e) { console.warn("Failed to get media duration:", e); }
                }
                const data = sanitizeData(rawData, cacheDuration);

                const id = 'cached-' + Date.now();
                const name = metadata.name;

                const newFileEntry = {
                    id,
                    file: matchingFile ? matchingFile.file : { name, type: metadata.type || 'video/unknown', size: metadata.size },
                    data,
                    url: mediaUrl,
                    isAnalyzing: false,
                    isFromCache: true
                };

                if (setFiles) setFiles(prev => [...prev, newFileEntry]);
                if (setActiveFileId) setActiveFileId(id);
                if (setShowSettings) setShowSettings(false);
                if (setShowCacheHistory) setShowCacheHistory(false);

                const hasPending = data.some(d => !d.isAnalyzed);
                if (hasPending && apiKey && newFileEntry.file?.name && runStage2) {
                    console.log(`[Cache Load] ${data.filter(d => !d.isAnalyzed).length} pending items detected. Resuming Stage 2...`);
                    runStage2(id, newFileEntry.file, data, apiKey, stage2Model);
                }
                if (setIsSwitchingFile) setIsSwitchingFile(false);
            } catch (e) {
                console.error("Failed to load cache:", e);
                showToast({ message: "캐시 데이터 로드에 실패했습니다.", type: "error" });
                if (setIsSwitchingFile) setIsSwitchingFile(false);
            }
        }
    };

    return {
        cacheKeys,
        setCacheKeys,
        deleteCache,
        clearAllCache,
        loadCache,
        refreshCacheKeys
    };
};
