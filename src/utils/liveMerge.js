// 오래 걸리는 작업(다시 전사·구간 전사)과 실행취소의 결과를 '지금 대본'에 넣는 계산. 순수 모듈(테스트 대상).
//
// 예전엔 작업을 시작할 때 잡은 대본 사본에 결과를 넣고 그 사본으로 통째로 덮어썼다. 전사는 20~60초가 걸려서
// 그사이 지운 문장이 되살아나고, 자른 문장·맞춘 대사 끝이 되돌아갔다(2026-11-19 점검, PC 재현).
// 실행취소도 편집 전 사본으로 통째로 되돌려서, 그사이 끝난 전사 결과가 같이 사라졌다.
// 여기서는 번호가 아니라 '시각과 글자가 모두 같은 문장'으로 자리를 찾는다(speechEndMerge#alignSpeechEnds와 같은 기준).

export const lineKey = (d) => `${d?.seconds}|${d?.text ?? ''}`;

// 같은 문장이 둘 이상이면 앞에서부터 하나씩 짝짓는다. 못 찾으면 -1.
function makeFinder(live) {
    const slots = new Map();
    live.forEach((d, i) => {
        const k = lineKey(d);
        if (!slots.has(k)) slots.set(k, []);
        slots.get(k).push(i);
    });
    return (item) => {
        const at = slots.get(lineKey(item))?.shift();
        return at === undefined ? -1 : at;
    };
}

/** 사본(snapshot)에서 고른 문장들이 지금 대본(live)의 몇 번째인지. 없어진 문장은 뺀다. */
export function locateLines(live, items) {
    const find = makeFinder(live);
    return (items || []).map(find).filter(i => i >= 0);
}

/**
 * 다시 전사 결과 넣기. blocks = [{ old: 시작 때 그 자리에 있던 문장들, fresh: 새로 받은 문장들 }]
 * 옛 문장이 지금 대본에 하나라도 남아 있으면 남은 것들을 지우고 첫 자리에 새 문장을 넣는다.
 * 옛 문장이 전부 없어졌으면(그사이 지웠거나 잘라서 글자가 바뀜) 사용자가 그 문장을 직접 손본 것이므로 결과를 버린다.
 * @returns {{ data: Array, placed: Array, skipped: number }} placed = 실제로 넣은 새 문장, skipped = 버린 묶음 수
 */
export function replaceLines(live, blocks) {
    const find = makeFinder(live);
    const drop = new Set();
    const insertAt = new Map();
    const placed = [];
    let skipped = 0;
    for (const b of blocks || []) {
        if (!b?.fresh?.length) continue;
        const at = (b.old || []).map(find).filter(i => i >= 0);
        if (at.length === 0) { skipped++; continue; }
        at.forEach(i => drop.add(i));
        const first = Math.min(...at);
        insertAt.set(first, [...(insertAt.get(first) || []), ...b.fresh]);
        placed.push(...b.fresh);
    }
    const data = [];
    live.forEach((d, i) => {
        if (insertAt.has(i)) data.push(...insertAt.get(i));
        if (!drop.has(i)) data.push(d);
    });
    return { data, placed, skipped };
}

// 시작 시각 순서. 같은 시각이면 기준 대본(reference)에서의 순서, 거기 없으면 지금 순서 그대로.
function sortLike(data, reference) {
    const rank = new Map();
    (reference || []).forEach((d, i) => { const k = lineKey(d); if (!rank.has(k)) rank.set(k, i); });
    return data
        .map((d, i) => ({ d, i, r: rank.has(lineKey(d)) ? rank.get(lineKey(d)) : null }))
        .sort((a, b) => (a.d.seconds - b.d.seconds)
            || (a.r !== null && b.r !== null ? a.r - b.r : 0)
            || (a.i - b.i))
        .map(x => x.d);
}

const withoutBusyFlag = (d) => {
    if (!d?.isRetranscribing) return d;
    const next = { ...d };
    delete next.isRetranscribing;
    return next;
};

/**
 * 편집 하나만 되돌린다. added = 그 편집이 넣은 문장(자른 조각, 구간 전사 결과), removed = 그 편집이 뺀 문장.
 * 지금 대본에서 added를 찾아 빼고 removed를 다시 넣는다. 그사이 다른 문장에 생긴 변화(끝난 전사, 다른 삭제)는 그대로 둔다.
 * 이미 같은 문장이 있으면(휴지통에서 먼저 복구함) 또 넣지 않는다. before = 편집 직전 대본(같은 시각 문장의 순서 기준).
 */
export function revertEdit(live, { removed = [], added = [], before = null } = {}) {
    const find = makeFinder(live);
    const drop = new Set(added.map(find).filter(i => i >= 0));
    const kept = live.filter((_, i) => !drop.has(i));
    const have = new Set(kept.map(lineKey));
    const back = [];
    for (const r of removed) {
        const k = lineKey(r);
        if (have.has(k)) continue;
        have.add(k);
        back.push(withoutBusyFlag(r));
    }
    return sortLike([...kept, ...back], before);
}

/**
 * 대사 끝 직접 맞추기 되돌리기 — 그 문장의 끝 시각·판단 불가 표시만 예전 값으로. 번역·분석 등 나머지는 지금 값 그대로.
 * olds = 맞추기 직전의 그 문장들.
 */
export function restoreSpeechEnds(live, olds) {
    const find = makeFinder(live);
    const patch = new Map();
    for (const o of olds || []) {
        const at = find(o);
        if (at >= 0) patch.set(at, o);
    }
    if (patch.size === 0) return live;
    return live.map((d, i) => {
        const o = patch.get(i);
        if (!o) return d;
        const next = { ...d };
        if (typeof o.speechEnd === 'number') next.speechEnd = o.speechEnd; else delete next.speechEnd;
        if (o.speechEndSkipped) next.speechEndSkipped = true; else delete next.speechEndSkipped;
        return next;
    });
}

/**
 * '다시 전사 중' 표시를 지금 도는 작업에 맞춘다. busyKeys = 아직 끝나지 않은 작업이 맡은 문장들의 lineKey 모음.
 * 맡은 문장에는 붙이고, 아무도 안 맡은 문장에서는 지운다. 바뀐 게 없으면 받은 배열을 그대로 돌려준다.
 *  - 붙이기: 대본 정리(sanitizeData)가 표시를 지우는데, 차례를 기다리는 다른 문장의 표시까지 사라지면 그 카드를 또 누를 수 있게 된다.
 *  - 지우기: 분석·실행취소가 들고 있던 옛 사본에 찍힌 표시가 작업이 끝난 뒤 되살아나면 그 카드를 영영 못 누른다.
 */
export function syncBusyFlags(data, busyKeys) {
    const busy = busyKeys || new Set();
    let changed = false;
    const next = data.map(d => {
        const want = busy.has(lineKey(d));
        if (want === !!d.isRetranscribing) return d;
        changed = true;
        if (want) return { ...d, isRetranscribing: true };
        const c = { ...d };
        delete c.isRetranscribing;
        return c;
    });
    return changed ? next : data;
}
