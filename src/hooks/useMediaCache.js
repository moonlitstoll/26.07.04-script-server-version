import { useState, useEffect, useCallback } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { parseCacheEntry } from '../utils/cacheUtils';

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
            message: "\uc774 \ubd84\uc11d \uae30\ub85d\uc744 \uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?",
            onConfirm: async () => {
                const cacheEntry = parseCacheEntry(key);

                let deletedName = null;
                let deletedSize = null;
                if (cacheEntry && cacheEntry.metadata) {
                    deletedName = cacheEntry.metadata.name;
                    deletedSize = cacheEntry.metadata.size;
                    if (deletedName) {
                        try {
                            await mediaStore.deleteFile(deletedName, deletedSize);
                        } catch (e) { console.warn("Failed to delete media file:", e); }
                    }
                }

                localStorage.removeItem(key);
                setCacheKeys(prev => prev.filter(k => k !== key));

                // \uc0ad\uc81c\ub41c \uce90\uc2dc\uc5d0 \ud574\ub2f9\ud558\ub294 \ud65c\uc131 \ud30c\uc77c\uc774 \uc788\uc73c\uba74 Stage 2 \uc911\ub2e8 \ubc0f \ud30c\uc77c \uc81c\uac70
                if (deletedName) {
                    const matchingFile = files.find(f =>
                        f.file?.name === deletedName && (deletedSize == null || f.file?.size === deletedSize)
                    );
                    if (matchingFile) {
                        if (stage2AbortRef && stage2AbortRef.current) {
                            stage2AbortRef.current.abort();
                        }
                        if (setFiles) {
                            setFiles(prev => {
                                const fileToRemove = prev.find(f => f.id === matchingFile.id);
                                if (fileToRemove && fileToRemove.url) URL.revokeObjectURL(fileToRemove.url);
                                const newFiles = prev.filter(f => f.id !== matchingFile.id);
                                if (setActiveFileId && matchingFile.id === files.find(f => f.id)?.id) {
                                    setActiveFileId(newFiles.length > 0 ? newFiles[0].id : null);
                                }
                                return newFiles;
                            });
                        }
                    }
                }

                showToast({ message: "\uc0ad\uc81c \uc644\ub8cc", type: "success" });
            }
        });
    };

    const clearAllCache = async () => {
        const count = cacheKeys.length;
        showConfirm({
            message: `\uc800\uc7a5\ub41c \ubd84\uc11d \uae30\ub85d ${count}\uac1c\ub97c \ubaa8\ub450 \uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?`,
            onConfirm: async () => {
                if (stage2AbortRef && stage2AbortRef.current) stage2AbortRef.current.abort();
                cacheKeys.forEach(k => localStorage.removeItem(k));
                await mediaStore.clearAll();
                setCacheKeys([]);
                showToast({ message: "\uc804\uccb4 \uae30\ub85d \uc0ad\uc81c \uc644\ub8cc", type: "success" });
            }
        });
    };

    const loadCache = async (key) => {
        if (resetPlayerState) resetPlayerState();
        if (setIsSwitchingFile) setIsSwitchingFile(true);

        const cacheEntry = parseCacheEntry(key);
        if (!cacheEntry) {
            showToast({ message: "\uce90\uc2dc \ub370\uc774\ud130 \ub85c\ub4dc\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.", type: "error" });
            if (setIsSwitchingFile) setIsSwitchingFile(false);
            return;
        }

        try {
            const { rawData, metadata } = cacheEntry;

            let matchingFile = null;
            if (metadata.size) {
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

            const newFileEntry = {
                id,
                file: matchingFile ? matchingFile.file : { name: metadata.name, type: metadata.type || 'video/unknown', size: metadata.size },
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
            showToast({ message: "\uce90\uc2dc \ub370\uc774\ud130 \ub85c\ub4dc\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.", type: "error" });
            if (setIsSwitchingFile) setIsSwitchingFile(false);
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
