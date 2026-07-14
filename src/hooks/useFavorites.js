import { useState, useEffect, useCallback, useRef } from 'react';
import { getFavorites, saveFavorites } from '../services/cloudSync';

// 즐겨찾기: 로컬(localStorage)에 즉시 반영 + 서버에 best-effort 동기화 → 모든 기기 공유.
// 식별자(id)는 "{name}_{size}" 규칙 (로컬 캐시/클라우드 항목 공통).
//
// 동기화 규칙: 평소에는 서버가 기준(다른 기기의 변경을 받아옴).
// 단, 이 기기의 변경이 아직 서버에 확정 반영되지 않은 상태(dirty)면 로컬이 기준 —
// 시작 시 서버 목록으로 로컬을 덮지 않고, 반대로 로컬을 서버에 밀어 올린다.
// (dirty 없이 서버 우선만 하면, 저장 실패/오프라인 직후 재시작 때 별이 풀린다)
const LS_KEY = 'miniapp_favorites';
const DIRTY_KEY = 'miniapp_favorites_dirty';

const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
};
const writeLocal = (arr) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch { /* noop */ }
};
const isDirty = () => {
    try { return localStorage.getItem(DIRTY_KEY) === 'true'; } catch { return false; }
};
const setDirty = (on) => {
    try {
        if (on) localStorage.setItem(DIRTY_KEY, 'true');
        else localStorage.removeItem(DIRTY_KEY);
    } catch { /* noop */ }
};

export const useFavorites = (passphrase) => {
    const [favorites, setFavorites] = useState(() => readLocal());
    // POST를 체인으로 직렬화: 연타 시 옛 목록이 나중에 도착해 서버를 되돌리는 역전 방지
    const queueRef = useRef(Promise.resolve());
    const seqRef = useRef(0);

    const pushToServer = useCallback((list) => {
        setDirty(true);
        const seq = ++seqRef.current;
        queueRef.current = queueRef.current.then(() =>
            saveFavorites(list)
                .then(() => { if (seqRef.current === seq) setDirty(false); }) // 최신 스냅샷이 반영됐을 때만 확정
                .catch((e) => console.warn('[Favorites] 저장 실패(다음 실행 때 재전송):', e))
        );
    }, []);

    // 시작 시 동기화: dirty면 로컬 → 서버(밀어 올리기), 아니면 서버 → 로컬(받아오기)
    useEffect(() => {
        if (!passphrase) return;
        let alive = true;
        (async () => {
            try {
                if (isDirty()) {
                    await saveFavorites(readLocal());
                    if (alive) setDirty(false);
                    return;
                }
                const remote = await getFavorites();
                if (alive && Array.isArray(remote)) {
                    setFavorites(remote);
                    writeLocal(remote);
                }
            } catch (e) { console.warn('[Favorites] 동기화 실패:', e); }
        })();
        return () => { alive = false; };
    }, [passphrase]);

    const isFavorite = useCallback((id) => favorites.includes(id), [favorites]);

    const toggleFavorite = useCallback((id) => {
        if (!id) return;
        setFavorites((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            writeLocal(next);
            pushToServer(next);
            return next;
        });
    }, [pushToServer]);

    return { favorites, isFavorite, toggleFavorite };
};
