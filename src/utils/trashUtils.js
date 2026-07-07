// [문장 휴지통] 삭제한 대본 문장을 파일별로 localStorage에 보관해 나중에 복구할 수 있게 한다.
// 6초 실행취소가 지나도 여기서 개별/전체 복구가 가능하다.
// 키: miniapp_trash_{파일명}_{크기}, 값: 삭제된 문장 객체 배열(최신이 앞).

const TRASH_PREFIX = 'miniapp_trash_';
const MAX_TRASH = 300; // 파일당 보관 상한(폭주 방지)

const keyFor = (name, size) => `${TRASH_PREFIX}${name}_${size}`;

// 문장 동일성 판별용 키(시각+본문). 중복 저장/복구 방지에 사용.
export const sentenceKey = (it) =>
    `${Math.round((it?.seconds || 0) * 100)}|${(it?.text ?? it?.o ?? '').trim().toLowerCase()}`;

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
