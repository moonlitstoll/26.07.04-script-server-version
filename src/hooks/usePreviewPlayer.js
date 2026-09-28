import { useRef, useState, useCallback, useEffect } from 'react';

// 편집 창의 '미리 듣기' 전용 재생기 — 본 플레이어와 별개의 <audio>를 쓴다.
// 본 플레이어로 재생하면 문장 반복·대사만 건너뛰기 엔진이 위치를 다른 곳으로 옮겨 버려,
// 경계를 귀로 확인하는 용도로 쓸 수 없다. 같은 재생 링크(blob URL)를 따로 읽는다.
export function usePreviewPlayer(url, { onStart, rate = 1 } = {}) {
    const audioRef = useRef(null);
    const timerRef = useRef(null);
    const onStartRef = useRef(onStart);
    useEffect(() => { onStartRef.current = onStart; }, [onStart]);
    const [playing, setPlaying] = useState(null); // 재생 중인 미리 듣기 이름(버튼 표시용)

    const stop = useCallback(() => {
        clearTimeout(timerRef.current);
        if (audioRef.current) audioRef.current.pause();
        setPlaying(null);
    }, []);

    useEffect(() => () => {
        clearTimeout(timerRef.current);
        const a = audioRef.current;
        if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    }, []);

    // [start, end) 구간을 재생하고 끝에서 멈춘다. 같은 이름을 다시 누르면 멈춤.
    const play = useCallback(async (start, end, name) => {
        if (!url) return;
        if (playing === name) { stop(); return; }
        stop();
        if (onStartRef.current) onStartRef.current(); // 본 플레이어는 멈춘다(소리 겹침 방지)
        let a = audioRef.current;
        if (!a) { a = new Audio(); a.preload = 'auto'; audioRef.current = a; }
        if (a.src !== url) a.src = url;
        if (a.readyState < 1) {
            await new Promise(res => {
                a.addEventListener('loadedmetadata', res, { once: true });
                a.addEventListener('error', res, { once: true });
                setTimeout(res, 4000);
            });
        }
        const r = rate > 0 ? rate : 1;
        a.playbackRate = r;
        try { a.currentTime = Math.max(0, start); } catch { /* 메타데이터 전 */ }
        setPlaying(name);
        try {
            await a.play();
        } catch (e) {
            console.warn('[Preview] 재생 실패:', e && e.message);
            setPlaying(null);
            return;
        }
        timerRef.current = setTimeout(() => { a.pause(); setPlaying(null); }, Math.max(0.2, end - start) * 1000 / r);
    }, [url, rate, playing, stop]);

    return { play, stop, playing, available: !!url };
}
