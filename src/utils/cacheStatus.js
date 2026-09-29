export function getCacheStatus(cacheKey) {
    let statusText = "READY";
    let badgeColor = "bg-gray-100 text-gray-600";
    let progressText = "";

    try {
        const cachedData = JSON.parse(localStorage.getItem(cacheKey));
        if (cachedData && cachedData.data) {
            const total = cachedData.data.length;
            const analyzed = cachedData.data.filter(d => d.isAnalyzed).length;
            const isFullyAnalyzed = total > 0 && analyzed === total;
            progressText = `${analyzed}/${total} Sentences`;

            if (isFullyAnalyzed) {
                statusText = "COMPLETED";
                badgeColor = "bg-emerald-100 text-emerald-700 font-black";
            } else if (analyzed > 0) {
                statusText = "ANALYZING";
                badgeColor = "bg-sky-100 text-sky-700 animate-pulse font-bold";
            } else if (cachedData.metadata?.status === 'extracted') {
                statusText = "READY";
                badgeColor = "bg-amber-100 text-amber-700 font-bold";
            }
        }
    } catch (e) {
        console.error("Error parsing history cache:", e);
    }

    return { statusText, badgeColor, progressText };
}

// 저장할 때 붙이는 상태 — 문장이 없으면 'extracted', 전부 분석됐으면 'completed', 아니면 'analyzing'.
// 위 목록 표시(getCacheStatus)와 같은 기준(문장 0개는 완료가 아님). 예전엔 호출부 9곳이 제각각 계산해
// 0개일 때 결과가 서로 달랐다(휴지통 복구는 [].every가 true라 'completed').
export function saveStatusOf(data) {
    if (!Array.isArray(data) || data.length === 0) return 'extracted';
    return data.every(d => d.isAnalyzed) ? 'completed' : 'analyzing';
}

export function getCacheDisplayName(cacheKey) {
    return cacheKey.replace('gemini_analysis_', '').replace(/_\d+$/, '');
}
