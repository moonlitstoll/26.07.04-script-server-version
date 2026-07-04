import { useState, useEffect, useCallback, useRef } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { parseCacheEntry } from '../utils/cacheUtils';
import { listItems as cloudListItems, fetchData as cloudFetchData, deleteItem as cloudDeleteItem, uploadMedia as cloudUploadMedia, saveMeta as cloudSaveMeta } from '../services/cloudSync';

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
    // 로컬에 영상이 저장된 항목 id 집합 ("{name}_{size}") — 초록 테두리/로컬 삭제 표시용
    const [localVideoIds, setLocalVideoIds] = useState(() => new Set());

    const cacheKeysRef = useRef([]);              // retry에서 최신 로컬 키 참조
    const attemptedUploadsRef = useRef(new Set()); // 세션 내 재업로드 시도한 id (중복 방지)
    const retryingRef = useRef(false);             // 재업로드 동시 실행 방지

    const refreshCacheKeys = useCallback(() => {
        setCacheKeys(Object.keys(localStorage).filter(k => k.startsWith('gemini_analysis_')));
    }, []);

    // 로컬에 저장된 영상 id 집합 갱신 (삭제/다운로드 후 호출)
    const refreshLocalVideos = useCallback(async () => {
        try {
            const entries = await mediaStore.listEntries();
            setLocalVideoIds(new Set(entries.map(e => e.id)));
        } catch (e) { console.warn('[Cache] 로컬 목록 조회 실패:', e); }
    }, []);

    // 미업로드(로컬에만 있는) 항목을 온라인일 때 클라우드로 자동 재업로드.
    // cloudList: 방금 조회한 클라우드 목록(어떤 게 이미 서버에 있는지 판단).
    const retryPendingUploads = useCallback(async (cloudList) => {
        if (retryingRef.current || !navigator.onLine) return;
        const cloudIds = new Set((cloudList || []).map(it => `${it.name}_${it.size}`));
        const pending = cacheKeysRef.current.filter(k => {
            const id = k.replace('gemini_analysis_', '');
            return !cloudIds.has(id) && !attemptedUploadsRef.current.has(id);
        });
        if (pending.length === 0) return;

        retryingRef.current = true;
        try {
            for (const key of pending) {
                const id = key.replace('gemini_analysis_', '');
                attemptedUploadsRef.current.add(id); // 세션 내 1회만 시도 (성공/실패 무관 표시 후, 실패 시 아래서 해제)
                const entry = parseCacheEntry(key);
                const metadata = entry?.metadata;
                if (!entry || !metadata?.name) continue;
                try {
                    const blob = await mediaStore.getFile(metadata.name, metadata.size);
                    let mediaUrl = null;
                    let dur = metadata.duration || 0;
                    if (blob) {
                        if (!dur) { try { dur = await getMediaDuration(blob); } catch { /* noop */ } }
                        const file = new File([blob], metadata.name, { type: metadata.type || blob.type || 'application/octet-stream' });
                        try { mediaUrl = await cloudUploadMedia(file); } catch (e) { console.warn('[Sync] 영상 업로드 실패:', e); }
                    }
                    await cloudSaveMeta(
                        { name: metadata.name, size: metadata.size, type: metadata.type || '' },
                        entry.rawData,
                        metadata.status || 'extracted',
                        mediaUrl,
                        dur
                    );
                    console.log('[Sync] 미업로드 항목 재업로드 완료:', metadata.name);
                } catch (e) {
                    console.warn('[Sync] 재업로드 실패 (다음 기회에 재시도):', e);
                    attemptedUploadsRef.current.delete(id); // 실패분은 다시 시도 가능하도록 해제
                }
            }
        } finally {
            retryingRef.current = false;
        }
    }, []);

    // 클라우드(다른 기기) 보관함 목록 새로고침 — best-effort. 조회 후 미업로드분 자동 재업로드.
    const refreshCloud = useCallback(async () => {
        try {
            const items = await cloudListItems();
            setCloudItems(items);
            retryPendingUploads(items);
        } catch (e) {
            console.warn('[Cloud] 목록 조회 실패:', e);
        }
    }, [retryPendingUploads]);

    useEffect(() => {
        refreshCacheKeys();
    }, [refreshCacheKeys]);

    // cacheKeys를 ref로 미러링 (retry가 최신값 참조)
    useEffect(() => {
        cacheKeysRef.current = cacheKeys;
    }, [cacheKeys]);

    // 온라인 복귀 시 목록 새로고침 → 미업로드분 재업로드
    useEffect(() => {
        const onOnline = () => { refreshCloud(); };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [refreshCloud]);

    // 최초 1회 로컬 영상 목록 로드
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const entries = await mediaStore.listEntries();
                if (alive) setLocalVideoIds(new Set(entries.map(e => e.id)));
            } catch { /* noop */ }
        })();
        return () => { alive = false; };
    }, []);

    // \ub85c\uceec(IndexedDB \uc601\uc0c1 + localStorage \ub300\ubcf8 + \uc5f4\ub824\uc788\ub294 \ud30c\uc77c) \uc81c\uac70 \u2014 \ud655\uc778\ucc3d \uc5c6\uc74c
    const purgeLocal = async ({ name, size, localKey }) => {
        if (name) {
            try { await mediaStore.deleteFile(name, size); } catch (e) { console.warn("Failed to delete media file:", e); }
        }
        if (localKey) {
            localStorage.removeItem(localKey);
            setCacheKeys(prev => prev.filter(k => k !== localKey));
        }
        // \ud65c\uc131 \ud30c\uc77c\uc774\uba74 Stage 2 \uc911\ub2e8 \ubc0f \ud30c\uc77c \uc81c\uac70
        if (name) {
            const matchingFile = files.find(f =>
                f.file?.name === name && (size == null || f.file?.size === size)
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
        if (name != null && size != null) {
            setLocalVideoIds(prev => { const n = new Set(prev); n.delete(`${name}_${size}`); return n; });
        }
    };

    const purgeLocalByKey = async (key) => {
        const cacheEntry = parseCacheEntry(key);
        const name = cacheEntry?.metadata?.name ?? null;
        const size = cacheEntry?.metadata?.size ?? null;
        await purgeLocal({ name, size, localKey: key });
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

    // \uc774 \uae30\uae30(\ub85c\uceec)\uc5d0\uc11c\ub9cc \uc0ad\uc81c \u2014 \ud074\ub77c\uc6b0\ub4dc\ub294 \uc720\uc9c0
    // rec = { displayName, localKey, cloudItem }
    const deleteLocal = (rec) => {
        const { displayName, localKey, cloudItem } = rec;
        let name = cloudItem?.name ?? null;
        let size = cloudItem?.size ?? null;
        if ((name == null || size == null) && localKey) {
            const meta = parseCacheEntry(localKey)?.metadata;
            if (meta) { name = meta.name; size = meta.size; }
        }
        const message = cloudItem
            ? `"${displayName}"\uc744(\ub97c) \uc774 \uae30\uae30\uc5d0\uc11c \uc0ad\uc81c\ud560\uae4c\uc694? (\ud074\ub77c\uc6b0\ub4dc\u00b7\ub2e4\ub978 \uae30\uae30\uc5d4 \ub0a8\uc544, \ub2e4\uc2dc \uc5f4\uba74 \ubc1b\uc544\uc635\ub2c8\ub2e4)`
            : `"${displayName}"\uc744(\ub97c) \uc774 \uae30\uae30\uc5d0\uc11c \uc0ad\uc81c\ud560\uae4c\uc694? \uc774 \ud56d\ubaa9\uc740 \ud074\ub77c\uc6b0\ub4dc\uc5d0 \uc5c6\uc5b4 \uc644\uc804\ud788 \uc0ac\ub77c\uc9d1\ub2c8\ub2e4.`;
        showConfirm({
            message,
            onConfirm: async () => {
                try { await purgeLocal({ name, size, localKey }); } catch (e) { console.warn('[Delete] \ub85c\uceec \uc81c\uac70 \uc2e4\ud328:', e); }
                showToast({ message: "\uc774 \uae30\uae30\uc5d0\uc11c \uc0ad\uc81c\ud588\uc2b5\ub2c8\ub2e4", type: "success" });
            }
        });
    };

    // \uc11c\ubc84(\ud074\ub77c\uc6b0\ub4dc)\uc5d0\uc11c \uc0ad\uc81c \u2014 \ub85c\uceec \uc0ac\ubcf8\uc740 \uadf8\ub300\ub85c \ub460
    const deleteServer = (rec) => {
        const { displayName, cloudItem } = rec;
        if (!cloudItem) return;
        showConfirm({
            message: `"${displayName}"\uc744(\ub97c) \uc11c\ubc84(\ud074\ub77c\uc6b0\ub4dc)\uc5d0\uc11c \uc0ad\uc81c\ud560\uae4c\uc694? \ubaa8\ub4e0 \uae30\uae30\uc5d0\uc11c \uc0ac\ub77c\uc9c0\uba70 \ub418\ub3cc\ub9b4 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.`,
            onConfirm: async () => {
                try { await purgeCloud(cloudItem); } catch (e) { console.warn('[Delete] \uc11c\ubc84 \uc81c\uac70 \uc2e4\ud328:', e); showToast({ message: '\uc11c\ubc84 \uc0ad\uc81c \uc2e4\ud328', type: 'error' }); return; }
                showToast({ message: "\uc11c\ubc84\uc5d0\uc11c \uc0ad\uc81c\ud588\uc2b5\ub2c8\ub2e4", type: "success" });
            }
        });
    };

    // \uc774 \uae30\uae30 \uce90\uc2dc \uc77c\uad04 \ube44\uc6b0\uae30 \u2014 \ud074\ub77c\uc6b0\ub4dc\uc5d0 \uc788\ub294 \ud56d\ubaa9\ub9cc \ub85c\uceec\uc5d0\uc11c \uc81c\uac70(\ubbf8\ub3d9\uae30\ud654 \ud56d\ubaa9\uc740 \ubcf4\uc874)
    const clearLocalCache = () => {
        showConfirm({
            message: "\uc774 \uae30\uae30\uc5d0 \ubc1b\uc544\ub454 \uc601\uc0c1/\ub300\ubcf8\uc744 \ubaa8\ub450 \ube44\uc6b8\uae4c\uc694? (\ud074\ub77c\uc6b0\ub4dc\uc5d0 \uc788\ub294 \ud56d\ubaa9\uc740 \ubaa9\ub85d\uc5d0 \ub0a8\uace0, \ub2e4\uc2dc \uc5f4\uba74 \ubc1b\uc544\uc635\ub2c8\ub2e4)",
            onConfirm: async () => {
                try {
                    const cloudIds = new Set((cloudItems || []).map(it => `${it.name}_${it.size}`));
                    const entries = await mediaStore.listEntries();
                    for (const e of entries) {
                        if (!cloudIds.has(e.id)) continue; // \ubbf8\ub3d9\uae30\ud654(\ub85c\uceec \uc804\uc6a9)\ub294 \ubcf4\uc874
                        try { await mediaStore.deleteFile(e.name, e.size); } catch { /* noop */ }
                        localStorage.removeItem(`gemini_analysis_${e.id}`);
                    }
                    setCacheKeys(prev => prev.filter(k => !cloudIds.has(k.replace('gemini_analysis_', ''))));
                    await refreshLocalVideos();
                    showToast({ message: "\uc774 \uae30\uae30 \uce90\uc2dc\ub97c \ube44\uc6e0\uc2b5\ub2c8\ub2e4 (\ud074\ub77c\uc6b0\ub4dc \uc720\uc9c0)", type: "success" });
                } catch (e) {
                    console.warn('[Cache] \ub85c\uceec \uc77c\uad04 \ube44\uc6b0\uae30 \uc2e4\ud328:', e);
                }
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
                setLocalVideoIds(new Set());
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
                        try {
                            await mediaStore.saveFile(blob);
                            setLocalVideoIds(prev => new Set(prev).add(`${item.name}_${item.size}`));
                        } catch (e) { console.warn('[Cloud] 영상 로컬 저장 실패:', e); }
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

    return {
        cacheKeys,
        setCacheKeys,
        deleteCache,
        deleteLocal,
        deleteServer,
        clearLocalCache,
        clearAllCache,
        loadCache,
        refreshCacheKeys,
        cloudItems,
        refreshCloud,
        loadCloud,
        localVideoIds,
        cloudDownload
    };
};
