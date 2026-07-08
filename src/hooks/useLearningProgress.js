import { useState, useCallback, useMemo } from 'react';

// 문장별 '알았음/몰랐음'을 localStorage에 저장.
// 구조: { [fileKey]: { [stableId]: { status:'known'|'unknown', seconds, miss, ts } } }
// fileKey = `${name}_${size}` (즐겨찾기/캐시와 동일 신원)
// stableId = `${seconds}|${text 앞부분}` — 배열 인덱스가 아니라 문장 내용 기반이라
//   문장 삭제/복구/재정렬로 인덱스가 밀려도 같은 문장에 계속 매핑된다.
//   (재전사로 text가 바뀌면 새 문장으로 간주 → 옛 기록 자연 소멸: 올바른 동작)
// → 나중에 오답노트·복습(SRS)의 연료. 지금은 오답 표시/필터에만 쓴다.
const STORAGE_KEY = 'miniapp_learn_progress';

function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
}
function saveStore(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
    catch { /* 용량 초과 등은 조용히 무시 (학습 표시는 부가기능) */ }
}

const idOf = (item) => (item ? `${item.seconds}|${(item.text || '').slice(0, 24)}` : null);

export function useLearningProgress(fileKey, items) {
    const [store, setStore] = useState(loadStore);

    const mark = useCallback((item, known) => {
        const id = idOf(item);
        if (!fileKey || !id) return;
        setStore(prev => {
            const next = { ...prev };
            const forFile = { ...(next[fileKey] || {}) };
            const cur = forFile[id] || { miss: 0 };
            forFile[id] = {
                status: known ? 'known' : 'unknown',
                seconds: typeof item.seconds === 'number' ? item.seconds : (cur.seconds ?? 0),
                miss: known ? (cur.miss || 0) : (cur.miss || 0) + 1,
                ts: Date.now(),
            };
            next[fileKey] = forFile;
            saveStore(next);
            return next;
        });
    }, [fileKey]);

    // 현재 파일의 학습 기록 전체 초기화 (❗오답 표시·알았음 모두 제거). '새 문제'에서 호출.
    const clearFile = useCallback(() => {
        if (!fileKey) return;
        setStore(prev => {
            if (!prev[fileKey]) return prev;
            const next = { ...prev };
            delete next[fileKey];
            saveStore(next);
            return next;
        });
    }, [fileKey]);

    const fileProg = useMemo(() => (fileKey ? (store[fileKey] || {}) : {}), [store, fileKey]);

    // 현재 대본에서 '몰랐음'인 문장의 (현재) 인덱스 오름차순 — 삭제/재정렬돼도 내용 기반으로 재해석.
    const wrongIndices = useMemo(() => {
        if (!items || items.length === 0) return [];
        const res = [];
        items.forEach((it, i) => {
            const id = idOf(it);
            if (id && fileProg[id]?.status === 'unknown') res.push(i);
        });
        return res;
    }, [items, fileProg]);

    const isWrong = useCallback((idx) => {
        const it = items?.[idx];
        const id = idOf(it);
        return !!(id && fileProg[id]?.status === 'unknown');
    }, [items, fileProg]);

    return { mark, wrongIndices, isWrong, clearFile };
}
