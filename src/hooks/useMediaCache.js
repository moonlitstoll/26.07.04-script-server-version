import { useState, useEffect, useCallback } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { parseCacheEntry } from '../utils/cacheUtils';
import { listItems as cloudListItems, fetchData as cloudFetchData, deleteItem as cloudDeleteItem } from '../services/cloudSync';

// Content-Length 기반으로 진행률을 보고하며 Blob 다운로드.
// 길이를 모르거나 스트림을 못 읽으면 onProgress(null)로 폴백하고 통째로 받는다.
async function fetchBlobWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`media ${res.status}`);
    const total = Number(res.headers.get('Content-Length')) || 0;
    if (!res.body || !total) {
        if (onProgress) onProgress(null);
        return await res.blob();
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress) onProgress(Math.min(100, Math.round((received / total) * 100)));
    }
    const type = res.headers.get('Content-Type') || 'application/octet-stream';
    return new Blob(chunks, { type });
}

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
    const [cloudItems, setCloudItems] = useState([]);
    // 클라우드 영상 다운로드 진행률: null(비활성) | { percent: number|null }
    const [cloudDownload, setCloudDownload] = useState(null);

    const refreshCacheKeys = useCallback(() => {
        setCacheKeys(Object.keys(localStorage).filter(k => k.startsWith('gemini_analysis_')));
    }, []);

    // 클라우드(다른 기기) 보관함 목록 새로고침 — best-effort
    const refreshCloud = useCallback(async () => {
        try {
            const items = await cloudListItems();
            setCloudItems(items);
        } catch (e) {
            console.warn('[Cloud] 목록 조회 실패:', e);
        }
    }, []);

    useEffect(() => {
        refreshCacheKeys();
    }, [refreshCacheKeys]);

    // \ub85c\uceec(localStorage \ub300\ubcf8 + IndexedDB \uc601\uc0c1 + \uc5f4\ub824\uc788\ub294 \ud30c\uc77c) \uc81c\uac70 \u2014 \ud655\uc778\ucc3d \uc5c6\uc74c(\ud638\ucd9c\ubd80\uc5d0\uc11c \ucc98\ub9ac)
    const purgeLocalByKey = async (key) => {
        const cacheEntry = parseCacheEntry(key);
        let deletedName = null;
        let deletedSize = null;
        if (cacheEntry && cacheEntry.metadata) {
            deletedName = cacheEntry.metadata.name;
            deletedSize = cacheEntry.metadata.size;
            if (deletedName) {
                try { await mediaStore.deleteFile(deletedName, deletedSize); } catch (e) { console.warn("Failed to delete media file:", e); }
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
                if (stage2AbortRef && stage2AbortRef.current) stage2AbortRef.current.abort();
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
    };

    // \ud074\ub77c\uc6b0\ub4dc(\uc11c\ubc84) \uc81c\uac70 \u2014 \ud655\uc778\ucc3d \uc5c6\uc74c
    const purgeCloud = async (item) => {
        await cloudDeleteItem({ name: item.name, size: item.size });
        setCloudItems(prev => prev.filter(i => i.folder !== item.folder));
    };

    const deleteCache = async (key) => {
        showConfirm({
            message: "\uc774 \ubd84\uc11d \uae30\ub85d\uc744 \uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?",
            onConfirm: async () => {
                await purgeLocalByKey(key);
                showToast({ message: "\uc0ad\uc81c \uc644\ub8cc", type: "success" });
            }
        });
    };

    // \ud1b5\ud569 \uc0ad\uc81c: \ud55c \ub179\uc74c\uc744 \ubc94\uc704(scope)\uc5d0 \ub530\ub77c \uc0ad\uc81c
    //  - scope 'local': \uc774 \uae30\uae30\uc5d0\uc11c\ub9cc \ub0b4\ub9bc (\ud074\ub77c\uc6b0\ub4dc \uc720\uc9c0)
    //  - scope 'all'  : \ub85c\uceec + \ud074\ub77c\uc6b0\ub4dc(\ubaa8\ub4e0 \uae30\uae30) \uc644\uc804 \uc0ad\uc81c
    // rec = { displayName, localKey, cloudItem }
    const deleteRecording = (rec, scope) => {
        const { displayName, localKey, cloudItem } = rec;
        const removeCloud = scope === 'all' && !!cloudItem;
        const message = removeCloud
            ? `"${displayName}"\uc744(\ub97c) \ubaa8\ub4e0 \uae30\uae30(\uc11c\ubc84)\uc5d0\uc11c \uc644\uc804\ud788 \uc0ad\uc81c\ud560\uae4c\uc694? \ub418\ub3cc\ub9b4 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.`
            : (cloudItem
                ? `"${displayName}"\uc744(\ub97c) \uc774 \uae30\uae30\uc5d0\uc11c\ub9cc \ub0b4\ub9b4\uae4c\uc694? (\ud074\ub77c\uc6b0\ub4dc\u00b7\ub2e4\ub978 \uae30\uae30\uc5d4 \ub0a8\uc2b5\ub2c8\ub2e4)`
                : `"${displayName}"\uc744(\ub97c) \uc0ad\uc81c\ud560\uae4c\uc694?`);
        showConfirm({
            message,
            onConfirm: async () => {
                if (localKey) {
                    try { await purgeLocalByKey(localKey); } catch (e) { console.warn('[Delete] \ub85c\uceec \uc81c\uac70 \uc2e4\ud328:', e); }
                }
                if (removeCloud) {
                    try { await purgeCloud(cloudItem); } catch (e) { console.warn('[Delete] \ud074\ub77c\uc6b0\ub4dc \uc81c\uac70 \uc2e4\ud328:', e); }
                }
                showToast({ message: removeCloud ? "\uc0ad\uc81c \uc644\ub8cc" : "\uc774 \uae30\uae30\uc5d0\uc11c \ub0b4\ub838\uc2b5\ub2c8\ub2e4", type: "success" });
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

            const id = 'cached-' + crypto.randomUUID();

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

    // 클라우드 항목 로드 (다른 기기서 추출한 대본을 불러와 재생)
    const loadCloud = async (item) => {
        if (resetPlayerState) resetPlayerState();
        if (setIsSwitchingFile) setIsSwitchingFile(true);
        try {
            const rawData = await cloudFetchData(item.dataUrl);
            if (!rawData || !Array.isArray(rawData)) throw new Error('클라우드 데이터 형식 오류');

            const data = sanitizeData(rawData, item.duration || 0);

            // 영상: 로컬(IndexedDB) 캐시 우선 → 없으면 서버에서 통째로 받아 로컬 저장.
            // 한 번 받으면 이후엔 재다운로드 없이 로컬 재생 → seek 시 끊김 없음.
            // 다운로드 실패 시엔 기존처럼 원격 URL 스트리밍으로 폴백.
            let mediaUrl = null;
            if (item.mediaUrl && item.name && item.size) {
                try {
                    let blob = await mediaStore.getFile(item.name, item.size);
                    if (!blob) {
                        setCloudDownload({ percent: 0 });
                        const downloaded = await fetchBlobWithProgress(item.mediaUrl, (percent) => setCloudDownload({ percent }));
                        blob = new File([downloaded], item.name, { type: item.type || downloaded.type || 'video/mp4' });
                        try { await mediaStore.saveFile(blob); } catch (e) { console.warn('[Cloud] 영상 로컬 저장 실패:', e); }
                    }
                    mediaUrl = URL.createObjectURL(blob);
                } catch (e) {
                    console.warn('[Cloud] 영상 다운로드 실패 → 원격 스트리밍 폴백:', e);
                    mediaUrl = item.mediaUrl;
                }
            }

            const id = 'cloud-' + crypto.randomUUID();
            const newFileEntry = {
                id,
                file: { name: item.name, type: item.type || 'video/unknown', size: item.size },
                data,
                url: mediaUrl,
                isAnalyzing: false,
                isFromCache: true
            };

            if (setFiles) setFiles(prev => [...prev, newFileEntry]);
            if (setActiveFileId) setActiveFileId(id);
            if (setShowSettings) setShowSettings(false);
            if (setShowCacheHistory) setShowCacheHistory(false);

            // 미완료 분석이 남아있으면 Stage 2 재개 (기기 간 이어서 분석)
            const hasPending = data.some(d => !d.isAnalyzed);
            if (hasPending && apiKey && runStage2) {
                console.log(`[Cloud Load] ${data.filter(d => !d.isAnalyzed).length}개 미완료 항목 → Stage 2 재개`);
                runStage2(id, newFileEntry.file, data, apiKey, stage2Model);
            }
        } catch (e) {
            console.error('[Cloud] 로드 실패:', e);
            showToast({ message: '클라우드 대본 로드에 실패했습니다.', type: 'error' });
        } finally {
            setCloudDownload(null);
            if (setIsSwitchingFile) setIsSwitchingFile(false);
        }
    };

    // 클라우드 항목 삭제 (영상+대본 모두 서버에서 제거)
    const deleteCloud = async (item) => {
        showConfirm({
            message: "이 대본과 영상을 클라우드에서 삭제하시겠습니까?",
            onConfirm: async () => {
                try {
                    await purgeCloud(item);
                } catch (e) {
                    console.warn('[Cloud] 삭제 실패:', e);
                    showToast({ message: '클라우드 삭제에 실패했습니다.', type: 'error' });
                    return;
                }
                showToast({ message: "삭제 완료", type: "success" });
            }
        });
    };

    return {
        cacheKeys,
        setCacheKeys,
        deleteCache,
        deleteRecording,
        clearAllCache,
        loadCache,
        refreshCacheKeys,
        cloudItems,
        refreshCloud,
        loadCloud,
        deleteCloud,
        cloudDownload
    };
};
