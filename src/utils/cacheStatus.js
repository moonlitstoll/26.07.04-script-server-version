// 기록 창 배지. running = 이 영상의 전사·분석이 '지금' 돌고 있는가(App이 알려 준다 — 저장본만으로는 모른다).
// 예전엔 덜 분석된 대본이면 무조건 깜박이는 "ANALYZING"이라, 실패 문장이 남은 채 끝났거나 중간에 멈춘 영상도
// 계속 진행 중처럼 보였다(2026-10-11 점검 #13: 233/258에서 끝난 영상이 계속 깜박임). 지금은 돌고 있을 때만 깜박이고,
// 끝났는데 실패가 남았으면 '일부 실패', 멈췄으면 '멈춤'(둘 다 열면 남은 문장을 이어서 분석한다).
export function cacheStatusOf(cachedData, { running = false } = {}) {
    let statusText = "READY";
    let badgeColor = "bg-gray-100 text-gray-600";
    let progressText = "";
    if (!cachedData || !Array.isArray(cachedData.data)) return { statusText, badgeColor, progressText };

    const total = cachedData.data.length;
    const analyzed = cachedData.data.filter(d => d.isAnalyzed).length;
    progressText = `${analyzed}/${total} Sentences`;

    if (total > 0 && analyzed === total) {
        statusText = "COMPLETED";
        badgeColor = "bg-emerald-100 text-emerald-700 font-black";
    } else if (running) {
        statusText = "ANALYZING";
        badgeColor = "bg-sky-100 text-sky-700 animate-pulse font-bold";
    } else if (cachedData.metadata?.status === 'partial') {
        statusText = "일부 실패";
        badgeColor = "bg-amber-100 text-amber-700 font-bold";
    } else if (analyzed > 0) {
        statusText = "멈춤";
        badgeColor = "bg-amber-100 text-amber-700 font-bold";
    } else if (cachedData.metadata?.status === 'extracted') {
        statusText = "READY";
        badgeColor = "bg-amber-100 text-amber-700 font-bold";
    }
    return { statusText, badgeColor, progressText };
}

export function getCacheStatus(cacheKey, opts) {
    try {
        return cacheStatusOf(JSON.parse(localStorage.getItem(cacheKey)), opts);
    } catch (e) {
        console.error("Error parsing history cache:", e);
        return cacheStatusOf(null);
    }
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
