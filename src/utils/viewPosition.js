// 대본별 '마지막으로 보던 문장' 위치. 이 기기 localStorage에 즉시 저장하고,
// 암호(보관함)가 있으면 서버에도 best-effort로 동기화하여 기기 간 공유한다.
// 값: { "{name}_{size}": { idx, seconds, t } }  (t = 조회 시각 ms)
// 충돌: 각 항목의 t가 더 큰(가장 최근에 본) 쪽이 이김 — 서버·클라이언트 양쪽 병합.
import { savePositions } from '../services/cloudSync';

const KEY = 'miniapp_last_pos';
const PUSH_DELAY = 3000;   // 스크롤 멈춘 뒤 서버 업로드까지 대기(ms)
let pushTimer = null;

const loadAll = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
};
const writeAll = (m) => {
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* quota 초과 무시 */ }
};

const idOf = (name, size) => `${name}_${size}`;

const now = () => {
    try { return Date.now(); } catch { return 0; }
};

// 디바운스 서버 업로드 (암호 없으면 savePositions가 알아서 no-op)
const schedulePush = () => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        pushTimer = null;
        savePositions(loadAll()).catch(() => { /* best-effort */ });
    }, PUSH_DELAY);
};

// { idx, seconds, t } 반환 (없으면 null)
export const getLastPos = (name, size) => {
    if (!name) return null;
    const v = loadAll()[idOf(name, size)];
    return v && typeof v.idx === 'number' ? v : null;
};

export const setLastPos = (name, size, idx, seconds) => {
    if (!name || idx == null || idx < 0) return;
    const all = loadAll();
    const key = idOf(name, size);
    const cur = all[key];
    // 같은 위치면 t만 갱신되는 불필요한 서버 업로드 방지
    if (cur && cur.idx === idx) return;
    all[key] = { idx, seconds, t: now() };
    writeAll(all);
    schedulePush();
};

// 서버에서 받은 위치들을 로컬과 병합 (각 항목 t 최신 우선). 병합 결과를 로컬에 저장.
export const mergeRemotePositions = (remote) => {
    if (!remote || typeof remote !== 'object') return;
    const local = loadAll();
    let changed = false;
    for (const [k, v] of Object.entries(remote)) {
        if (!v || typeof v.idx !== 'number') continue;
        const cur = local[k];
        if (!cur || (v.t || 0) > (cur.t || 0)) { local[k] = v; changed = true; }
    }
    if (changed) writeAll(local);
};

// 대기 중인 업로드를 즉시 전송 (창 닫기/탭 전환 시 최신 위치 보장)
export const flushPositions = () => {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    savePositions(loadAll()).catch(() => { /* best-effort */ });
};
