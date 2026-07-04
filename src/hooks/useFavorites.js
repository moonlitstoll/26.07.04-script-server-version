import { useState, useEffect, useCallback } from 'react';
import { getFavorites, saveFavorites } from '../services/cloudSync';

// 즐겨찾기: 로컬(localStorage)에 즉시 반영 + 서버에 best-effort 동기화 → 모든 기기 공유.
// 식별자(id)는 "{name}_{size}" 규칙 (로컬 캐시/클라우드 항목 공통).
const LS_KEY = 'miniapp_favorites';

const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
};
const writeLocal = (arr) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch { /* noop */ }
};

export const useFavorites = (passphrase) => {
    const [favorites, setFavorites] = useState(() => readLocal());

    // 암호가 있으면 서버에서 최신 즐겨찾기를 불러와 로컬과 동기화
    useEffect(() => {
        if (!passphrase) return;
        let alive = true;
        (async () => {
            try {
                const remote = await getFavorites();
                if (alive && Array.isArray(remote)) {
                    setFavorites(remote);
                    writeLocal(remote);
                }
            } catch (e) { console.warn('[Favorites] 로드 실패:', e); }
        })();
        return () => { alive = false; };
    }, [passphrase]);

    const isFavorite = useCallback((id) => favorites.includes(id), [favorites]);

    const toggleFavorite = useCallback((id) => {
        if (!id) return;
        setFavorites((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            writeLocal(next);
            saveFavorites(next).catch((e) => console.warn('[Favorites] 저장 실패:', e));
            return next;
        });
    }, []);

    return { favorites, isFavorite, toggleFavorite };
};
