/**
 * Robust Helper: Parse [HH:MM:SS.ms] or [MM:SS.ms] to Total Seconds (Float)
 * Formula: (H * 3600) + (M * 60) + S + (ms / 1000)
 */
export const parseTime = (timeStr) => {
    if (!timeStr) return 0;
    if (typeof timeStr === 'number') return Math.max(0, timeStr);

    // 1. Range Handling: Take the first part of "01:02 - 01:05" or similar
    let raw = timeStr.toString().split(/[-~]/)[0];

    // 2. Strict Cleaning: Keep ONLY digits, colons (:), and dots (.)
    const clean = raw.replace(/[^\d:.]/g, '');
    if (!clean) return 0;

    // 3. Mathematical Absolute Normalization
    // (아래 연산(split/reverse/parseFloat/산술)은 예외를 던지지 않으므로 try/catch가 불필요)
    const parts = clean.split(':');
    if (parts.length >= 2) {
        // Handle [SS.ms, MM, HH] in reverse to be agnostic to depth
        const rev = parts.reverse();
        const s = parseFloat(rev[0]) || 0;
        const m = parseFloat(rev[1]) || 0;
        const h = parseFloat(rev[2]) || 0;
        // Formula: H*3600 + M*60 + S (All as high-precision floats)
        return (h * 3600) + (m * 60) + s;
    }
    // Raw seconds (e.g., "79.5", "14")
    return parseFloat(clean) || 0;
};

/**
 * 초를 "MM:SS" 시계 표기로 변환(음수/NaN은 0으로 가드). 재생 컨트롤 시간 표시용.
 */
export const formatClock = (sec) => {
    const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
    return new Date(s * 1000).toISOString().slice(14, 19);
};
