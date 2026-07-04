import { useEffect } from 'react';

// 전역 키보드 단축키
// Space: 재생/일시정지, Enter: 구간 반복, B: 분석 토글,
// ←/→: 문장 이동, ↑/↓: 5초 탐색
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
}) => {
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!mediaUrl || !activeFile?.data?.length) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const data = activeFile.data;

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
                    if (data.length > 0) {
                        const idx = activeIdxRef.current !== null ? activeIdxRef.current : 0;
                        const prevIdx = Math.max(0, idx - 1);
                        if (prevIdx !== idx) jumpToSentence(prevIdx);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (data.length > 0) {
                        const idx = activeIdxRef.current !== null ? activeIdxRef.current : 0;
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
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mediaUrl, activeFile, togglePlay, toggleLoop, toggleGlobalAnalysis, jumpToSentence, activeIdxRef, lastActionTimeRef, videoRef]);
};
