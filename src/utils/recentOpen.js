// '마지막으로 연(또는 별을 누른) 시각' — 목록 정렬용. 이 기기에만 저장(클라우드 동기화 꺼짐).
// 식별자는 즐겨찾기와 같은 "{name}_{size}" (캐시 키에서 'gemini_analysis_'를 뗀 것).
//
// 첫 실행에는 기록이 없으므로, 캐시에 저장된 대본의 마지막 저장 시각(metadata.savedAt)으로 한 번 채운다.
// 그 뒤로는 작은 이 목록만 읽는다 — 목록 화면이 그릴 때마다 큰 대본 JSON을 전부 파싱하지 않게.
const KEY = 'miniapp_recent_open';
const CACHE_PREFIX = 'gemini_analysis_';

const write = (map) => {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* 가득 차도 정렬만 옛 순서로 남는다 */ }
};

function seedFromCache() {
    const map = {};
    try {
        for (const k of Object.keys(localStorage)) {
            if (!k.startsWith(CACHE_PREFIX)) continue;
            try {
                const savedAt = JSON.parse(localStorage.getItem(k))?.metadata?.savedAt;
                if (Number.isFinite(savedAt)) map[k.slice(CACHE_PREFIX.length)] = savedAt;
            } catch { /* 깨진 항목은 건너뜀 */ }
        }
    } catch { /* 저장소 접근 불가 */ }
    write(map);
    return map;
}

export function readRecent() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch { return {}; }
    if (raw == null) return seedFromCache();
    try {
        const m = JSON.parse(raw);
        return m && typeof m === 'object' ? m : {};
    } catch { return {}; }
}

export function touchRecent(id, now = Date.now()) {
    if (!id) return;
    const m = readRecent();
    m[id] = now;
    write(m);
}

export function forgetRecent(id) {
    if (!id) return;
    const m = readRecent();
    if (!(id in m)) return;
    delete m[id];
    write(m);
}

// 최근 순(내림차순)으로 정렬한 새 배열. 기록이 없거나 같으면 원래 순서 유지(안정 정렬).
export function sortByRecent(items, idOf, recent = readRecent()) {
    const at = (x) => recent[idOf(x)] || 0;
    return [...items].sort((a, b) => at(b) - at(a));
}
