import { useEffect, useRef } from 'react';

// 열려 있는 모달들의 ESC 닫기 핸들러 스택 (LIFO).
// 모달이 겹쳐 있을 때 ESC는 "가장 위" 모달 하나만 닫는다.
// (모달마다 window에 리스너를 각각 붙이면 ESC 한 번에 여러 개가 같이 닫히는 문제 방지)
const stack = [];

// 뒤 화면을 가리는 창(설정·편집 창·확인창 등)이 몇 개 열려 있는지. 열려 있는 동안 재생 단축키를 쉬게 하는 데 쓴다
// (2026-11-27 점검: 설정·자르기 창을 띄운 채 Space·→·Enter가 뒤 화면을 움직였다).
// 팝오버(묶음·가리기·배속)는 뒤 화면을 보며 쓰는 작은 창이라 세지 않는다.
let modalCount = 0;
export const hasOpenModal = () => modalCount > 0;

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
export const useEscapeToClose = (onClose, { modal = true } = {}) => {
    const handlerRef = useRef(onClose);

    // 매 렌더 후 최신 onClose를 ref에 반영 (ESC 발생 시 최신값 호출).
    useEffect(() => { handlerRef.current = onClose; });

    useEffect(() => {
        if (stack.length === 0) window.addEventListener('keydown', handleKeyDown);
        stack.push(handlerRef);
        if (modal) modalCount += 1;
        return () => {
            if (modal) modalCount -= 1;
            const idx = stack.indexOf(handlerRef);
            if (idx !== -1) stack.splice(idx, 1);
            if (stack.length === 0) window.removeEventListener('keydown', handleKeyDown);
        };
        // modal은 마운트 때 값으로 고정(창 종류는 열려 있는 동안 안 바뀐다)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
};
