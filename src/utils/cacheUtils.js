/**
 * 캐시 엔트리 파싱 유틸리티
 * useMediaAnalysis와 useMediaCache에서 공유
 */
import { getCacheDisplayName } from './cacheStatus';
import { ANALYSIS_VERSION } from '../services/prompts';

// 캐시 메타데이터가 현재 분석 버전보다 낮으면(=옛 규칙으로 분석됨) 낡음으로 판정.
// version 필드가 없는 옛 캐시는 0으로 취급 → 낡음.
export function isCacheStale(metadata) {
    return (metadata?.version ?? 0) < ANALYSIS_VERSION;
}

export function parseCacheEntry(cacheKey) {
    const cachedStr = localStorage.getItem(cacheKey);
    if (!cachedStr) return null;

    try {
        const parsed = JSON.parse(cachedStr);
        const hasMetadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.data;
        const rawData = hasMetadata ? parsed.data : parsed;
        const metadata = hasMetadata ? parsed.metadata : { name: getCacheDisplayName(cacheKey) };

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

// 용량 초과(QuotaExceededError)를 브라우저별 name/code 차이까지 감안해 판별
function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError'
        || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' // Firefox
        || e.code === 22 || e.code === 1014
        || /quota|exceeded/i.test(e.message || '');
}

// 저장 결과를 반환한다: { ok: true } | { ok: false, reason: 'quota'|'error', message }
// (조용한 실패를 호출부에서 사용자에게 알릴 수 있도록 — util은 UI를 직접 건드리지 않음)
export function saveCacheEntry(fileInfo, data, status) {
    if (!fileInfo || !fileInfo.name) return { ok: false, reason: 'error', message: '파일 정보 없음' };
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
                status,
                version: ANALYSIS_VERSION
            }
        }));
        return { ok: true };
    } catch (e) {
        console.warn("Failed to save cache:", e);
        return { ok: false, reason: isQuotaError(e) ? 'quota' : 'error', message: e.message };
    }
}
