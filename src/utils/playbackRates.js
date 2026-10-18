// 재생 배속 — 범위 0.5~2.0은 예전 16칸 격자와 같다. 고르는 방법만 바꿨다:
// 자주 쓰는 6칸은 바로 탭, 그 사이 값은 −/+ 0.1씩(창 유지). 순수 함수라 화면 없이 테스트한다.
export const RATE_MIN = 0.5;
export const RATE_MAX = 2.0;
export const RATE_STEP = 0.1;
export const RATE_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

const round2 = (r) => Math.round(r * 100) / 100;

export function clampRate(r) {
    const n = Number(r);
    if (!Number.isFinite(n)) return 1.0;
    return round2(Math.min(RATE_MAX, Math.max(RATE_MIN, n)));
}

// dir = -1 | +1. 0.75처럼 0.1 격자 밖에 있으면 가장 가까운 격자로 올라타지 않고 그냥 0.1을 더한다(0.85).
export function stepRate(r, dir) {
    return clampRate(clampRate(r) + Math.sign(dir) * RATE_STEP);
}

// "1x", "0.75x", "1.5x" — 끝의 0은 떼서 버튼이 좁아도 들어가게
export function fmtRate(r) {
    return `${String(round2(clampRate(r)))}x`;
}
