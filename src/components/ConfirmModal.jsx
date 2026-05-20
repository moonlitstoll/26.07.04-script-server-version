import { AlertTriangle } from 'lucide-react';

const ConfirmModal = ({ message, onConfirm, onCancel, confirmText = "삭제", cancelText = "취소", danger = true }) => {
    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 text-center space-y-4">
                    <div className={`inline-flex p-3 rounded-2xl ${danger ? 'bg-red-50' : 'bg-indigo-50'}`}>
                        <AlertTriangle size={28} className={danger ? 'text-red-500' : 'text-indigo-500'} />
                    </div>
                    <p className="text-slate-700 font-medium text-base leading-relaxed">{message}</p>
                </div>
                <div className="p-4 bg-slate-50 flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 text-slate-600 font-bold hover:bg-white rounded-xl transition-all"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-2.5 text-white font-bold rounded-xl transition-all shadow-lg ${
                            danger
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-200'
                                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
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
