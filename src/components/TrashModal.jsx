import { Trash2, X, RotateCcw, Clock } from 'lucide-react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

// 삭제한 문장 휴지통. 개별/전체 복구, 비우기 지원.
const TrashModal = ({ items = [], onRestore, onClear, onClose }) => {
    useEscapeToClose(onClose);
    return (
        <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="bg-red-50 p-2 rounded-xl text-red-500"><Trash2 size={18} /></div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">삭제한 문장 휴지통</h2>
                            <p className="text-xs text-slate-400 font-medium">{items.length}개 보관됨 · 복구하면 원래 위치로</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="닫기" className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Actions */}
                {items.length > 0 && (
                    <div className="px-4 py-2.5 border-b border-slate-50 flex items-center justify-between gap-2 shrink-0">
                        <button
                            onClick={() => onRestore(items)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                        >
                            <RotateCcw size={14} /> 전체 복구
                        </button>
                        <button
                            onClick={onClear}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                            <Trash2 size={14} /> 휴지통 비우기
                        </button>
                    </div>
                )}

                {/* List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {items.length === 0 ? (
                        <div className="text-center py-16 text-slate-400">
                            <Trash2 size={40} className="mx-auto mb-3 opacity-20" />
                            <p className="text-sm font-medium">휴지통이 비어 있습니다.</p>
                        </div>
                    ) : (
                        items.map((it) => (
                            <div
                                key={`${it.seconds}-${(it.text || it.o || '').slice(0, 20)}`}
                                className="flex items-start gap-3 p-3 rounded-2xl border border-slate-100 bg-white hover:border-slate-200 transition-colors"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-slate-400 mb-1">
                                        <Clock size={10} /> {it.timestamp || it.s || ''}
                                    </div>
                                    <p className="text-sm font-bold text-slate-700 break-words leading-snug">
                                        {it.text || it.o || '(내용 없음)'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => onRestore([it])}
                                    title="이 문장 복구"
                                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                                >
                                    <RotateCcw size={13} /> 복구
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default TrashModal;
