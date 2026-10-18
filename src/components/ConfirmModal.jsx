import { AlertTriangle } from 'lucide-react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

const ConfirmModal = ({ message, onConfirm, onCancel, confirmText = "삭제", cancelText = "취소", danger = true }) => {
    useEscapeToClose(onCancel);
    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-6 text-center space-y-4">
                    <div className={`inline-flex p-3 rounded-2xl ${danger ? 'bg-red-50 dark:bg-red-950/40' : 'bg-indigo-50 dark:bg-indigo-950/40'}`}>
                        <AlertTriangle size={28} className={danger ? 'text-red-500 dark:text-red-400' : 'text-indigo-500 dark:text-indigo-400'} />
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 font-medium text-base leading-relaxed">{message}</p>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-900 flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 font-bold hover:bg-white dark:hover:bg-slate-700 rounded-xl transition-all"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-2.5 text-white font-bold rounded-xl transition-all shadow-lg ${
                            danger
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-200 dark:shadow-black/40'
                                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 dark:shadow-black/40'
                        }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
