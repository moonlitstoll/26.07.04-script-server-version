// [문장 휴지통] 삭제한 대본 문장을 파일별로 localStorage에 보관해 나중에 복구할 수 있게 한다.
// 6초 실행취소가 지나도 여기서 개별/전체 복구가 가능하다.
// 키: miniapp_trash_{파일명}_{크기}, 값: 삭제된 문장 객체 배열(최신이 앞).

const TRASH_PREFIX = 'miniapp_trash_';
const MAX_TRASH = 300; // 파일당 보관 상한(폭주 방지)

const keyFor = (name, size) => `${TRASH_PREFIX}${name}_${size}`;

// 문장 동일성 판별용 키(시각+본문). 중복 저장/복구 방지에 사용.
export const sentenceKey = (it) =>
    `${Math.round((it?.seconds || 0) * 100)}|${(it?.text ?? it?.o ?? '').trim().toLowerCase()}`;

// ── 같은 시각으로 묶인 문장의 순서 ──
// 전사가 여러 문장에 같은 시각을 찍는 일이 있다(묶음). 대본은 시각으로만 줄을 세우므로, 그런 문장을 지웠다가
// 휴지통에서 되살리면 묶음 맨 뒤에 붙었다 — [A, B, C]에서 A를 지웠다 살리면 [B, C, A] (2026-11-19 점검, 화면 재현).
// 그래서 지울 때 '그 묶음의 순서'(_tie)를 같이 적어 두고, 되살릴 때 그 순서대로 끼운다.
const secKey = (it) => Math.round((it?.seconds || 0) * 100);
const tieText = (it) => (it?.text ?? it?.o ?? '').trim();

/**
 * 지울 문장에 묶음 순서를 적어 돌려준다(묶음이 아니면 그대로).
 * 같은 묶음에서 먼저 지운 문장이 휴지통에 있으면 그 순서표를 이어 쓴다 — 하나씩 지워 묶음이 줄어도 처음 순서가 남는다.
 */
export function withTieHints(prevData, deletedItems, trashNow = []) {
    return (deletedItems || []).map((it) => {
        const s = secKey(it);
        const group = (prevData || []).filter(d => secKey(d) === s).map(tieText);
        let best = null;
        for (const t of trashNow || []) {
            if (secKey(t) !== s || !Array.isArray(t._tie)) continue;
            if (group.every(x => t._tie.includes(x)) && (!best || t._tie.length > best.length)) best = t._tie;
        }
        const order = best || (group.length > 1 ? group : null);
        return order ? { ...it, _tie: order } : it;
    });
}

// 순서표에 없는 문장(그사이 글자가 바뀐 형제 — 다시 전사·자르기)의 자리를 짐작한다.
// 앞뒤로 아는 문장 사이에 '비어 있는 순서'의 수와 모르는 문장의 수가 딱 맞을 때만 차례로 짝짓는다.
// 예) 순서표 [A, B, C]에서 A를 되살리는데 대본이 [B', C]면 → 빈 순서는 B 하나, 모르는 문장도 B' 하나 → B' = B 자리.
// 안 맞으면 그대로 둔다(-1) — 그 문장은 자리 판단에 쓰지 않는다.
function guessRanks(members, size, mine) {
    const known = new Set(members.map(m => m[1]).filter(r => r >= 0));
    let i = 0;
    while (i < members.length) {
        if (members[i][1] >= 0) { i++; continue; }
        let j = i;
        while (j < members.length && members[j][1] < 0) j++;
        const lo = i > 0 ? members[i - 1][1] : -1;
        const hi = j < members.length ? members[j][1] : size;
        const free = [];
        for (let r = lo + 1; r < hi; r++) if (r !== mine && !known.has(r)) free.push(r);
        if (free.length === j - i) for (let k = i; k < j; k++) members[k][1] = free[k - i];
        i = j;
    }
}

/**
 * 되살릴 문장을 지금 대본에 끼운다. 순서표가 있고 같은 시각 문장이 남아 있으면 그 순서 자리에
 * (순서표에서 자기보다 뒤인 첫 문장 앞), 아니면 맨 뒤에 붙인다(뒤따르는 시각 정렬이 제자리로 보낸다 — 예전과 같다).
 */
export function mergeRestored(cur, toAdd) {
    const out = [...(cur || [])];
    for (const it of toAdd || []) {
        const order = Array.isArray(it?._tie) ? it._tie : null;
        const mine = order ? order.indexOf(tieText(it)) : -1;
        let at = -1;
        if (mine >= 0) {
            const s = secKey(it);
            const members = []; // [대본 번호, 순서표 자리(-1 = 순서표에 없음)]
            for (let i = 0; i < out.length; i++) {
                if (secKey(out[i]) === s) members.push([i, order.indexOf(tieText(out[i]))]);
            }
            guessRanks(members, order.length, mine);
            const next = members.find(m => m[1] > mine);
            if (next) at = next[0];
        }
        if (at >= 0) out.splice(at, 0, it); else out.push(it);
    }
    return out;
}

export const getTrash = (name, size) => {
    try {
        const raw = localStorage.getItem(keyFor(name, size));
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
};

// 삭제된 문장들을 휴지통에 추가(중복은 건너뜀, 최신이 앞).
export const addToTrash = (name, size, items) => {
    if (!items || items.length === 0) return;
    const cur = getTrash(name, size);
    const seen = new Set(cur.map(sentenceKey));
    const add = [];
    for (const it of items) {
        const k = sentenceKey(it);
        if (!seen.has(k)) { seen.add(k); add.push({ ...it, _trashedAt: Date.now() }); }
    }
    if (add.length === 0) return;
    let next = [...add, ...cur];
    if (next.length > MAX_TRASH) next = next.slice(0, MAX_TRASH);
    try { localStorage.setItem(keyFor(name, size), JSON.stringify(next)); }
    catch (e) { console.warn('[Trash] 저장 실패:', e); }
};

// 복구 등으로 특정 문장들을 휴지통에서 제거.
export const removeFromTrash = (name, size, items) => {
    const rm = new Set((items || []).map(sentenceKey));
    if (rm.size === 0) return;
    const next = getTrash(name, size).filter(it => !rm.has(sentenceKey(it)));
    try { localStorage.setItem(keyFor(name, size), JSON.stringify(next)); }
    catch (e) { console.warn('[Trash] 갱신 실패:', e); }
};

export const clearTrash = (name, size) => {
    try { localStorage.removeItem(keyFor(name, size)); }
    catch (e) { console.warn('[Trash] 비우기 실패:', e); }
};

// 대본 키(`이름_크기`)로 그 대본의 휴지통을 지운다 — '이 기기의 대본 전부 지우기'용
export const clearTrashById = (fileKey) => {
    try { localStorage.removeItem(`${TRASH_PREFIX}${fileKey}`); }
    catch (e) { console.warn('[Trash] 비우기 실패:', e); }
};
