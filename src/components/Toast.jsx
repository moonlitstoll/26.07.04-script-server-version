import { useEffect, useRef } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

const Toast = ({ message, type = 'success', onClose, duration = 2500, action = null }) => {
    // [중요] onClose를 ref로 고정하고 deps에서 뺀다.
    // App이 onClose를 인라인 화살표로 넘기므로 렌더마다 참조가 바뀌는데, 재생 중에는
    // currentTime 틱(100ms)마다 App이 리렌더된다 → deps에 onClose가 있으면 매 틱
    // cleanup+setTimeout이 반복돼 타이머가 영원히 만료되지 않는다(토스트가 안 사라짐).
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });
    useEffect(() => {
        const timer = setTimeout(() => onCloseRef.current && onCloseRef.current(), duration);
        return () => clearTimeout(timer);
    }, [duration]);

    return (
        // 탭하면 즉시 닫힘: 모바일에서 앱을 잠깐 벗어나면 백그라운드 타이머가 멈춰
        // 토스트가 한참 남아 보이는 문제의 탈출구 (action 버튼은 자체 onClick에서 닫음)
        <div onClick={onClose} className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] cursor-pointer animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl font-bold text-sm ${
                type === 'success'
                    ? 'bg-emerald-600 text-white shadow-emerald-200'
                    : 'bg-red-600 text-white shadow-red-200'
            }`}>
                <div className="flex items-center gap-2">
                    {type === 'success'
                        ? <CheckCircle size={18} />
                        : <XCircle size={18} />
                    }
                    {message}
                </div>
                {action && (
                    <button
                        onClick={() => { action.onClick(); onClose(); }}
                        className="shrink-0 px-3 py-1 rounded-lg bg-white/25 hover:bg-white/40 text-white font-bold text-xs transition-colors"
                    >
                        {action.label}
                    </button>
                )}
            </div>
        </div>
    );
};

export default Toast;
