// 묶음 반복(N문장 반복)의 묶음 경계를 만든다.
//
// 방식: '고정 분할'. 대본을 앞에서부터 N개씩 잘라 묶음을 만든다(1~5 / 6~10 / ...).
// 어느 문장을 눌러도 그 문장이 속한 묶음이 반복되므로 경계가 항상 같아 예측 가능하다.
//
// 단 하나의 예외 — 형제 문장 블록은 절대 쪼개지 않는다:
//   여러 문장이 같은 seconds를 공유하는 블록이 실제로 존재한다(sentenceSplitter가 뭉친 줄을
//   문장별로 쪼개되 시각은 그대로 복사한다). 이 문장들은 오디오상 구분이 불가능해서,
//   묶음 경계가 블록 한가운데를 자르면 그 문장만 따로 재생할 방법이 없다.
//   그래서 마지막 멤버가 블록 중간이면 블록 끝까지 흡수한다 → 묶음이 N보다 커질 수 있다.

export const LOOP_GROUP_MIN = 1;
export const LOOP_GROUP_MAX = 10;

export const clampLoopGroupSize = (n) => {
    const v = typeof n === 'number' ? n : parseInt(n, 10);
    if (!Number.isFinite(v)) return LOOP_GROUP_MIN;
    return Math.min(LOOP_GROUP_MAX, Math.max(LOOP_GROUP_MIN, Math.trunc(v)));
};

const EMPTY = { groups: [], groupOf: null };

/**
 * @returns {{ groups: {start:number,end:number}[], groupOf: Int32Array|null }}
 *          groupOf[문장 인덱스] = 그 문장이 속한 묶음 번호
 */
export const buildLoopGroups = (data, n) => {
    const size = clampLoopGroupSize(n);
    if (size <= 1 || !Array.isArray(data) || data.length === 0) return EMPTY;

    const groups = [];
    const groupOf = new Int32Array(data.length);

    let i = 0;
    while (i < data.length) {
        let end = Math.min(i + size - 1, data.length - 1);
        // 형제 블록(같은 seconds)을 자르지 않도록 블록 끝까지 흡수
        while (end + 1 < data.length && data[end + 1].seconds === data[end].seconds) end++;

        const gi = groups.length;
        for (let k = i; k <= end; k++) groupOf[k] = gi;
        groups.push({ start: i, end });
        i = end + 1;
    }

    return { groups, groupOf };
};
