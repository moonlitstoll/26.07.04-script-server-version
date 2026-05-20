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

export function getCacheDisplayName(cacheKey) {
    return cacheKey.replace('gemini_analysis_', '').replace(/_\d+$/, '');
}
