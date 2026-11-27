import { useEffect } from 'react';
import { focusedByKeyboard } from '../utils/inputModality';
import { hasOpenModal } from './useEscapeToClose';

// 전역 키보드 단축키
// Space: 재생/일시정지, Enter: 구간 반복, B: 분석 토글,
// ←/→: 문장 이동, ↑/↓: 5초 탐색, [ / ]: 배속 -/+
//
// 2026-11-27 점검에서 정한 규칙(화면에서 눌러 확인):
//  ① 마우스로 누른 문장·해설·버튼에 초점이 남아 있어도 Space·Enter는 단축키다. Tab으로 온 경우만 '그 칸 누르기'.
//  ② 뒤 화면을 가리는 창(설정·편집 창·확인창·도움말)이 열려 있으면 쉰다 — 창 안의 버튼·입력은 브라우저 기본 동작대로.
//  ③ Space·Enter·B·?는 꾹 눌러도 한 번(자동 반복 무시). 화살표·배속은 꾹 눌러 연속으로 넘기는 게 편해 그대로.
//  ④ Ctrl·Alt·Meta와 같이 누른 키는 건드리지 않는다(Alt+← 뒤로 가기 등 브라우저 기능).
const NO_REPEAT = new Set(['Space', 'Enter', 'KeyB']);
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
    helpOpen = false,
}) => {
    useEffect(() => {
        // 이번 Space 누름을 단축키로 썼는지 — 뗄 때 초점 남은 버튼이 한 번 더 눌리지 않게 막는 데 쓴다
        let spaceTaken = false;
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            // 창이 열려 있으면 쉰다. 도움말 창만은 '?'로 다시 닫을 수 있게 둔다.
            if (hasOpenModal()) {
                if (helpOpen && e.key === '?' && !e.repeat) { e.preventDefault(); if (onToggleHelp) onToggleHelp(); }
                return;
            }
            // 버튼/링크 등 포커스된 인터랙티브 요소에서 Space·Enter는 네이티브 활성(클릭)에 맡긴다.
            // (전역 핸들러까지 같이 실행되면 재생↔정지가 2번 토글돼 상쇄되는 버그 방지)
            // 단, Tab으로 초점을 옮긴 경우만 — 마우스로 누른 문장·해설·버튼에 초점이 남아 있으면 단축키로 쓴다
            // (2026-11-27 사용자 보고: 문장을 누른 뒤 Space가 그 문장으로 이동·스크롤했다. Enter도 같았다).
            if ((e.code === 'Space' || e.code === 'Enter') && focusedByKeyboard() && e.target.closest('button, a, [role="button"]')) return;

            // '?' (Shift+/) : 단축키 도움말 토글 — 파일이 없어도 동작
            if (e.key === '?') { e.preventDefault(); if (!e.repeat && onToggleHelp) onToggleHelp(); return; }

            if (!mediaUrl || !activeFile?.data?.length) return;

            const data = activeFile.data;

            // 꾹 눌러 생긴 자동 반복은 한 번으로 친다(재생↔정지가 연달아 바뀌던 것). 페이지 스크롤 등 기본 동작만 막는다.
            if (e.repeat && NO_REPEAT.has(e.code)) { e.preventDefault(); return; }

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
                    spaceTaken = true;
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
                    // 버튼과 동일한 네비게이션 로직 사용 (묶음 반복이면 묶음 단위) — 없으면 기존 ±1 폴백
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
        // 마우스로 누른 버튼에 초점이 남아 있을 때 Space를 떼는 순간 그 버튼이 한 번 더 눌리지 않게
        // (버튼의 Space 누르기는 키를 뗄 때 일어난다 — 재생/일시정지와 겹쳐 두 번 바뀌는 것 방지)
        const handleKeyUp = (e) => {
            if (e.code !== 'Space') return;
            const taken = spaceTaken;
            spaceTaken = false;
            if (taken && e.target.closest?.('button, a, [role="button"]')) e.preventDefault();
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [mediaUrl, activeFile, togglePlay, toggleLoop, toggleGlobalAnalysis, jumpToSentence, activeIdxRef, lastActionTimeRef, videoRef, onToggleHelp, playbackRate, handleRateChange, onPrevSentence, onNextSentence, helpOpen]);
};
