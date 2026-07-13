// 묶음 반복(N문장 반복)의 묶음 경계를 만든다.
//
// 방식: '앵커 슬라이딩'. 묶음 = [앵커 문장, 앵커+N-1]. 어느 문장을 누르든
// 그 문장부터 N개가 반복되므로, "막힌 문장부터 연습"이라는 쉐도잉 흐름과 맞는다.
// 대본 끝에서 N개가 안 남으면 남은 만큼만 묶는다(처음으로 감아 이어붙이지 않음 —
// 반복 엔진은 연속 시간 구간 하나를 돌리는 구조라 끝↔처음을 붙일 수 없다).
//
// 형제 문장 블록은 절대 쪼개지 않는다:
//   여러 문장이 같은 seconds를 공유하는 블록이 실제로 존재한다(sentenceSplitter가 뭉친 줄을
//   문장별로 쪼개되 시각은 그대로 복사한다). 이 문장들은 오디오상 구분이 불가능해서,
//   앵커가 블록 중간이면 블록 시작까지 당기고, 끝 경계가 블록 중간이면 블록 끝까지 늘린다.
//   그래서 묶음이 N보다 커질 수 있고, 탭한 문장보다 앞에서 시작할 수도 있다(띠로 표시됨).
//
// 이 함수가 유일한 경계 계산원이다 — 반복 엔진(useAudioPlayer), 주황 띠(App),
// ←/→ 묶음 이동(App)이 모두 이 함수를 쓰므로 세 곳이 어긋날 수 없다.

export const LOOP_GROUP_MIN = 1;
export const LOOP_GROUP_MAX = 20;

export const clampLoopGroupSize = (n) => {
    const v = typeof n === 'number' ? n : parseInt(n, 10);
    if (!Number.isFinite(v)) return LOOP_GROUP_MIN;
    return Math.min(LOOP_GROUP_MAX, Math.max(LOOP_GROUP_MIN, Math.trunc(v)));
};

/**
 * 앵커 문장이 속한 묶음의 경계.
 * @returns {{start:number, end:number} | null}  N<=1이거나 데이터가 없으면 null (묶음 경로 꺼짐)
 */
export const slidingGroupBounds = (data, anchor, n) => {
    const size = clampLoopGroupSize(n);
    if (size <= 1 || !Array.isArray(data) || data.length === 0) return null;

    let s = Math.min(Math.max(typeof anchor === 'number' ? anchor : 0, 0), data.length - 1);
    // 앵커가 형제 블록 중간이면 블록 시작으로 (블록은 시작 시각이 같아 오디오상 쪼갤 수 없음)
    while (s > 0 && data[s - 1].seconds === data[s].seconds) s--;

    let e = Math.min(s + size - 1, data.length - 1);
    // 끝 경계가 형제 블록 중간이면 블록 끝까지 흡수
    // (<=는 반복 엔진의 다음 문장 탐색과 같은 방어적 비교 — 정렬 이상 데이터에도 안전)
    while (e + 1 < data.length && data[e + 1].seconds <= data[e].seconds) e++;

    return { start: s, end: e };
};
