import { useEffect } from 'react';

// 전역 키보드 단축키
// Space: 재생/일시정지, Enter: 구간 반복, B: 분석 토글,
// ←/→: 문장 이동, ↑/↓: 5초 탐색, [ / ]: 배속 -/+
export const useKeyboardShortcuts = ({
    mediaUrl,
    activeFile,
    togglePlay,
    toggleLoop,
    toggleGlobalAnalysis,
    jumpToSentence,
    activeIdxRef,
    lastActionTimeRef,
    videoRef,
    onToggleHelp,
    playbackRate,
    handleRateChange,
    onPrevSentence,
    onNextSentence,
}) => {
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            // 버튼/링크 등 포커스된 인터랙티브 요소에서 Space·Enter는 네이티브 활성(클릭)에 맡긴다.
            // (전역 핸들러까지 같이 실행되면 재생↔정지가 2번 토글돼 상쇄되는 버그 방지)
            if ((e.code === 'Space' || e.code === 'Enter') && e.target.closest('button, a, [role="button"]')) return;

            // '?' (Shift+/) : 단축키 도움말 토글 — 파일이 없어도 동작
            if (e.key === '?') { e.preventDefault(); if (onToggleHelp) onToggleHelp(); return; }

            if (!mediaUrl || !activeFile?.data?.length) return;

            const data = activeFile.data;

            // 배속 조절: [ 느리게 / ] 빠르게 (0.5~2.0, 0.1 간격)
            const stepRate = (delta) => {
                if (!handleRateChange) return;
                const cur = typeof playbackRate === 'number' ? playbackRate : 1.0;
                const next = Math.min(2.0, Math.max(0.5, Math.round((cur + delta) * 10) / 10));
                if (next !== cur) handleRateChange(next);
            };

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'Enter':
                    e.preventDefault();
                    toggleLoop();
                    break;
                case 'KeyB':
                    e.preventDefault();
                    toggleGlobalAnalysis();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    // 버튼과 동일한 네비게이션 로직 사용 (오답 모드면 오답만 순회) — 없으면 기존 ±1 폴백
                    if (onPrevSentence) {
                        onPrevSentence();
                    } else {
                        const idx = activeIdxRef.current ?? 0;
                        const prevIdx = Math.max(0, idx - 1);
                        if (prevIdx !== idx) jumpToSentence(prevIdx);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (onNextSentence) {
                        onNextSentence();
                    } else {
                        const idx = activeIdxRef.current ?? 0;
                        const nextIdx = Math.min(data.length - 1, idx + 1);
                        if (nextIdx !== idx) jumpToSentence(nextIdx);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (videoRef.current) {
                        lastActionTimeRef.current = Date.now();
                        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
                    }
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    if (videoRef.current) {
                        lastActionTimeRef.current = Date.now();
                        videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
                    }
                    break;
                case 'BracketLeft':
                    e.preventDefault();
                    stepRate(-0.1);
                    break;
                case 'BracketRight':
                    e.preventDefault();
                    stepRate(0.1);
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mediaUrl, activeFile, togglePlay, toggleLoop, toggleGlobalAnalysis, jumpToSentence, activeIdxRef, lastActionTimeRef, videoRef, onToggleHelp, playbackRate, handleRateChange, onPrevSentence, onNextSentence]);
};
