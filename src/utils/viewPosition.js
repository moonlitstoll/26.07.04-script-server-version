// 대본별 '마지막으로 보던 문장' 위치를 이 기기 localStorage에 저장/복원한다.
// 식별자는 앱 전반과 동일하게 "{이름}_{크기}" (재생성되는 런타임 file.id가 아님).

const KEY = 'miniapp_last_pos';

const loadAll = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
};

const idOf = (name, size) => `${name}_${size}`;

// { idx, seconds } 반환 (없으면 null)
export const getLastPos = (name, size) => {
    if (!name) return null;
    const v = loadAll()[idOf(name, size)];
    return v && typeof v.idx === 'number' ? v : null;
};

export const setLastPos = (name, size, idx, seconds) => {
    if (!name || idx == null || idx < 0) return;
    const all = loadAll();
    all[idOf(name, size)] = { idx, seconds };
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota 초과 무시 */ }
};
