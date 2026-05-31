/**
 * 캐시 엔트리 파싱 유틸리티
 * useMediaAnalysis와 useMediaCache에서 공유
 */

export function parseCacheEntry(cacheKey) {
    const cachedStr = localStorage.getItem(cacheKey);
    if (!cachedStr) return null;

    try {
        const parsed = JSON.parse(cachedStr);
        const hasMetadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.data;
        const rawData = hasMetadata ? parsed.data : parsed;
        const metadata = hasMetadata ? parsed.metadata : { name: cacheKey.replace('gemini_analysis_', '').replace(/_\d+$/, '') };

        if (!Array.isArray(rawData)) {
            console.error("Invalid cache format: Data is not an array.");
            return null;
        }

        return { rawData, metadata };
    } catch (e) {
        console.error("Failed to parse cache entry:", e);
        return null;
    }
}

export function saveCacheEntry(fileInfo, data, status) {
    if (!fileInfo || !fileInfo.name) return;
    const cacheKey = `gemini_analysis_${fileInfo.name}_${fileInfo.size}`;
    try {
        localStorage.setItem(cacheKey, JSON.stringify({
            data,
            metadata: {
                name: fileInfo.name,
                size: fileInfo.size,
                type: fileInfo.type,
                lastModified: fileInfo.lastModified,
                savedAt: Date.now(),
                status
            }
        }));
    } catch (e) {
        console.warn("Failed to save cache:", e);
    }
}
