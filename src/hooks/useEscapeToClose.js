import { useEffect, useRef } from 'react';

// 열려 있는 모달들의 ESC 닫기 핸들러 스택 (LIFO).
// 모달이 겹쳐 있을 때 ESC는 "가장 위" 모달 하나만 닫는다.
// (모달마다 window에 리스너를 각각 붙이면 ESC 한 번에 여러 개가 같이 닫히는 문제 방지)
const stack = [];

function handleKeyDown(e) {
    if (e.key !== 'Escape') return;
    const top = stack[stack.length - 1];
    if (top) {
        e.preventDefault();
        top.current?.();
    }
}

// 모달을 ESC로 닫는다. onClose는 매 렌더 새로 만들어질 수 있으므로
// ref에 최신값을 담아두고, 스택에는 마운트 시 1회만 push (열린 순서 = 스택 순서 유지).
export const useEscapeToClose = (onClose) => {
    const handlerRef = useRef(onClose);

    // 매 렌더 후 최신 onClose를 ref에 반영 (ESC 발생 시 최신값 호출).
    useEffect(() => { handlerRef.current = onClose; });

    useEffect(() => {
        if (stack.length === 0) window.addEventListener('keydown', handleKeyDown);
        stack.push(handlerRef);
        return () => {
            const idx = stack.indexOf(handlerRef);
            if (idx !== -1) stack.splice(idx, 1);
            if (stack.length === 0) window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);
};
