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
    stage2AbortRef
}) => {
    const [cacheKeys, setCacheKeys] = useState([]);

    const refreshCacheKeys = useCallback(() => {
        setCacheKeys(Object.keys(localStorage).filter(k => k.startsWith('gemini_analysis_')));
    }, []);

    useEffect(() => {
        // Initial Load
        refreshCacheKeys();
    }, [refreshCacheKeys]);

    const deleteCache = async (key) => {
        if (window.confirm("Delete this analysis cache?")) {
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
                } catch { /* ignore */ }
            }
        }
    };

    const clearAllCache = async () => {
        const count = cacheKeys.length;
        if (window.confirm(`Clear all ${count} cached analysis files?`)) {
            // 분석 중단 신호
            if (stage2AbortRef && stage2AbortRef.current) stage2AbortRef.current.abort();
            cacheKeys.forEach(k => localStorage.removeItem(k));
            await mediaStore.clearAll();
            setCacheKeys([]);
            window.alert("All cache cleared!");
        }
    };

    const loadCache = async (key) => {
        // FORCE RESET
        if (resetPlayerState) resetPlayerState();
        if (setIsSwitchingFile) setIsSwitchingFile(true);

        const cachedStr = localStorage.getItem(key);
        if (cachedStr) {
            try {
                const parsed = JSON.parse(cachedStr);
                // Handle new format {data, metadata} vs legacy format [items...]
                const hasMetadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.data;
                const rawData = hasMetadata ? parsed.data : parsed;

                // [마이그레이션 방어] 데이터 캐시의 형태가 유효한 배열인지 검증
                if (!Array.isArray(rawData)) {
                    throw new Error("Invalid cache format: Data is not an array. Please clear cache.");
                }

                const metadata = hasMetadata ? parsed.metadata : { name: key.replace('gemini_analysis_', '').replace(/_\d+$/, '') };

                // 미디어 파일 매칭 (duration 추출을 위해 먼저 수행)
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

                // 영상 길이 확보 후 sanitizeData 호출
                let cacheDuration = 0;
                if (fileForDuration) {
                    try { cacheDuration = await getMediaDuration(fileForDuration); } catch { /* ignore */ }
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

                // [문제 3 수정] 미완성 분석 데이터가 있으면 Stage 2 자동 재시작
                const hasPending = data.some(d => !d.isAnalyzed);
                if (hasPending && apiKey && newFileEntry.file?.name && runStage2) {
                    console.log(`[Cache Load] ${data.filter(d => !d.isAnalyzed).length} pending items detected. Resuming Stage 2...`);
                    runStage2(id, newFileEntry.file, data, apiKey, stage2Model);
                }
                if (setIsSwitchingFile) setIsSwitchingFile(false);
            } catch (e) {
                console.error("Failed to load cache:", e);
                window.alert("Failed to load cached data.");
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
