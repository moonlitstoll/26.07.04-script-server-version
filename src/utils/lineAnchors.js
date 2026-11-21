// 문장 번호 따라가기 (순수 함수 — 단위 테스트 有)
//
// 화면은 '고른 문장', '자르기 창의 문장', '반복하는 문장', '지금 강조된 문장'을 번호(몇 번째)로 기억한다.
// 그런데 그사이 문장 수가 바뀌면(실행취소로 문장이 돌아옴, 다시 전사가 끝나 문장이 늘어남, 휴지통 복구 등)
// 같은 번호가 다른 문장을 가리킨다 — 고른 문장 대신 옆 문장이 지워지고, 반복이 옆 문장으로 넘어갔다
// (2026-11-19 점검, 화면 재현). 대본이 바뀔 때마다 여기서 '그 문장이 지금 몇 번째인지' 다시 찾는다.
import { lineKey } from './liveMerge';

// 같은 문장(시각·글자 모두 같음)이 둘 이상이면 앞에서부터 순서로 구분한다
function tagsOf(data) {
    const seen = new Map();
    return data.map((d) => {
        const k = lineKey(d);
        const n = seen.get(k) || 0;
        seen.set(k, n + 1);
        return `${k}#${n}`;
    });
}

/**
 * 옛 대본(prev)의 번호를 새 대본(next)의 번호로 옮기는 함수를 만든다. 없어진 문장은 null.
 *  1) 시각과 글자가 같은 문장을 찾는다.
 *  2) 못 찾으면(그 문장의 글자·시각이 바뀜 — 제자리 다시 전사 등) 앞뒤로 '살아남은 문장' 사이의 문장 수를 본다.
 *     수가 그대로면 같은 자리의 문장으로 본다. 수가 달라졌으면(한 문장이 둘이 됨, 지워짐) 어느 것인지 알 수 없으니 null.
 */
export function makeRemap(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return () => null;
    const inRange = (i) => Number.isInteger(i) && i >= 0 && i < prev.length;
    if (prev === next) return (i) => (inRange(i) ? i : null);

    const pos = new Map(tagsOf(next).map((t, i) => [t, i]));
    const direct = tagsOf(prev).map((t) => (pos.has(t) ? pos.get(t) : -1));
    return (i) => {
        if (!inRange(i)) return null;
        if (direct[i] >= 0) return direct[i];
        let p = i - 1; while (p >= 0 && direct[p] < 0) p--;
        let q = i + 1; while (q < prev.length && direct[q] < 0) q++;
        const p2 = p >= 0 ? direct[p] : -1;
        const q2 = q < prev.length ? direct[q] : next.length;
        return (q2 - p2 === q - p) ? p2 + (i - p) : null;
    };
}

/** 번호 하나를 옮긴다. 없어졌으면 null. */
export const remapIndex = (prev, next, i) => makeRemap(prev, next)(i);

/** 번호 여러 개를 옮긴다. 없어진 문장은 뺀다(순서는 받은 그대로). */
export function remapIndices(prev, next, idxs) {
    const remap = makeRemap(prev, next);
    const out = [];
    for (const i of idxs) {
        const j = remap(i);
        if (j !== null) out.push(j);
    }
    return out;
}
