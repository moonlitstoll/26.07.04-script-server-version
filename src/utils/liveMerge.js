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

/**
 * 재분석이 끝내 안 됐을 때 옛 분석으로 되돌린 문장. 옛 분석을 안 들고 있으면 null.
 * 재분석은 고른 문장의 번역·분석을 비우고 시작하는데, 옛 것을 문장 안(_prev)에 넣어 둔다 —
 * 예전엔 재분석 함수만 들고 있어서, 재분석이 다른 편집으로 끊기고 이어진 분석이 실패하면 옛 분석이 사라졌다.
 */
export function restorePrev(d) {
    const p = d?._prev;
    if (!p || typeof p !== 'object') return null;
    // 보관할 때의 글자와 다르면(그사이 자르거나 고친 문장) 그 분석은 이 문장의 것이 아니다
    if (p.text !== undefined && p.text !== d.text) return null;
    const next = { ...d, translation: p.translation || '', analysis: p.analysis || '', transcriptSuspect: p.transcriptSuspect || '', isAnalyzed: true };
    delete next._prev;
    delete next.analysisFailed;
    if (p.a !== undefined) next.a = p.a;
    if (p.av !== undefined) next.av = p.av; else delete next.av;
    return next;
}

/** 대본을 열 때: 재분석이 끝나기 전에 앱이 닫혀 비어 있는 문장은 옛 분석으로 되돌린다. 바뀐 게 없으면 받은 배열 그대로. */
export function settlePrev(data) {
    let changed = false;
    const next = (data || []).map(d => {
        if (!d?._prev) return d;
        changed = true;
        const back = d.isAnalyzed ? null : restorePrev(d);
        if (back) return back;
        const c = { ...d }; // 이미 분석됐거나, 글자가 바뀌어 못 되돌리는 문장 — 보관본만 치운다(분석 전이면 열 때 이어서 분석된다)
        delete c._prev;
        return c;
    });
    return changed ? next : data;
}

/**
 * 분석(2단계) 결과를 '지금 대본'에 넣는다. work = 분석이 들고 있는 사본, owned = 이 분석이 맡은 문장 번호(work 기준).
 * 맡은 문장의 번역·분석·실패 표시만 옮긴다. 그 밖의 것(대사 끝, '판단 불가' 표시, 그사이 휴지통에서 되살린 문장)은
 * 지금 대본 그대로 둔다 — 예전엔 사본으로 통째로 덮어써서 되살린 문장이 사라지고 표시가 지워졌다.
 * 그사이 지우거나 글자가 바뀐 문장의 결과는 버린다. 바뀐 게 없으면 받은 배열을 그대로 돌려준다.
 */
export function mergeAnalysis(live, work, owned) {
    const find = makeFinder(live);
    const patch = new Map();
    (work || []).forEach((w, i) => {
        const at = find(w); // 맡지 않은 문장도 찾아 둔다 — 같은 문장이 둘일 때 짝이 밀리지 않게
        if (at < 0 || !owned.has(i)) return;
        const l = live[at];
        if (w.isAnalyzed) {
            const same = l.isAnalyzed && !l._prev && !l.analysisFailed && l.translation === w.translation
                && l.analysis === w.analysis && (l.transcriptSuspect || '') === (w.transcriptSuspect || '') && l.av === w.av;
            if (same) return;
            const next = { ...l, translation: w.translation, analysis: w.analysis, transcriptSuspect: w.transcriptSuspect || '', isAnalyzed: true };
            delete next._prev;
            delete next.analysisFailed;
            if (w.a !== undefined) next.a = w.a; else delete next.a;
            if (w.av !== undefined) next.av = w.av; else delete next.av;
            patch.set(at, next);
        } else if (w.analysisFailed && !l.isAnalyzed && !l.analysisFailed) {
            patch.set(at, { ...l, analysisFailed: true });
        }
    });
    if (patch.size === 0) return live;
    return live.map((d, i) => patch.get(i) || d);
}
