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

// 저장된 대본의 메타데이터만 읽는다. 없으면 null, 옛 형식(메타데이터 없음)이면 {}.
// 저장할 때마다 부르므로 대본 전체를 풀지 않고 끝에 붙은 메타데이터 조각만 푼다(실패하면 전체를 푼다).
export function readCacheMeta(cacheKey) {
    let s = null;
    try { s = localStorage.getItem(cacheKey); } catch { return null; }
    if (!s) return null;
    const at = s.lastIndexOf('"metadata":');
    if (at > 0) {
        try {
            const m = JSON.parse('{' + s.slice(at)).metadata;
            if (m && typeof m === 'object') return m;
        } catch { /* 아래에서 전체를 푼다 */ }
    }
    try {
        const p = JSON.parse(s);
        return (p && typeof p === 'object' && !Array.isArray(p) && p.metadata) || {};
    } catch { return null; }
}

// 이 대본이 어느 규칙 버전으로 분석됐는지 = 분석된 문장들 중 가장 옛 버전.
// 문장마다 분석한 버전(av)을 적어 두고, 안 적힌 문장(이 기능 전에 분석됨)은 저장돼 있던 버전(stored)으로 본다.
// 예전엔 저장할 때마다 무조건 현재 버전을 적어서, 옛 규칙 대본에서 문장 하나만 지워도 '옛 대본' 안내가 사라졌다.
// 재분석 중이라 비어 있는 문장(_prev 보관)은 옛 분석의 버전으로 센다 — 재분석이 끝나야 새 버전이 된다.
export function analysisVersionOf(data, stored) {
    const base = stored ?? ANALYSIS_VERSION;
    let v = null;
    for (const d of data || []) {
        if (!d) continue;
        let lv = null;
        if (d.isAnalyzed) lv = d.av ?? base;
        else if (d._prev) lv = d._prev.av ?? base;
        if (lv !== null && (v === null || lv < v)) v = lv;
    }
    return v === null ? base : v;
}

// 저장 결과를 반환한다: { ok: true } | { ok: false, reason: 'quota'|'error', message }
// (조용한 실패를 호출부에서 사용자에게 알릴 수 있도록 — util은 UI를 직접 건드리지 않음)
// extra.incomplete: 전사를 끝까지 못 받은 지점 { at, reason }. 안 넘기면 저장돼 있던 값을 유지, null이면 지운다.
export function saveCacheEntry(fileInfo, data, status, extra = {}) {
    if (!fileInfo || !fileInfo.name) return { ok: false, reason: 'error', message: '파일 정보 없음' };
    const cacheKey = `gemini_analysis_${fileInfo.name}_${fileInfo.size}`;
    try {
        const prev = readCacheMeta(cacheKey);
        const incomplete = 'incomplete' in extra ? extra.incomplete : prev?.incomplete;
        localStorage.setItem(cacheKey, JSON.stringify({
            data,
            metadata: {
                name: fileInfo.name,
                size: fileInfo.size,
                type: fileInfo.type,
                lastModified: fileInfo.lastModified,
                savedAt: Date.now(),
                status,
                version: analysisVersionOf(data, prev ? (prev.version ?? 0) : undefined),
                ...(incomplete ? { incomplete } : {})
            }
        }));
        return { ok: true };
    } catch (e) {
        console.warn("Failed to save cache:", e);
        return { ok: false, reason: isQuotaError(e) ? 'quota' : 'error', message: e.message };
    }
}

// 저장된 대본의 '끝까지 못 받음' 표시만 지운다(대본 내용은 그대로).
export function clearCacheIncomplete(fileInfo) {
    if (!fileInfo || !fileInfo.name) return false;
    const cacheKey = `gemini_analysis_${fileInfo.name}_${fileInfo.size}`;
    try {
        const p = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (!p || Array.isArray(p) || !p.metadata || !p.metadata.incomplete) return false;
        delete p.metadata.incomplete;
        localStorage.setItem(cacheKey, JSON.stringify(p));
        return true;
    } catch { return false; }
}
