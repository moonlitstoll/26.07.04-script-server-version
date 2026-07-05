import { useEffect } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

const Toast = ({ message, type = 'success', onClose, duration = 2500, action = null }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [onClose, duration]);

    return (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-4 fade-in duration-300">
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
