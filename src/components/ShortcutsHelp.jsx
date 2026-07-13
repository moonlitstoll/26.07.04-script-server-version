import { X, Keyboard } from 'lucide-react';

const SHORTCUTS = [
    { keys: ['Space'], desc: '재생 / 일시정지' },
    { keys: ['Enter'], desc: '현재 문장 구간 반복 (묶음 N이면 N문장)' },
    { keys: ['B'], desc: '분석 표시 켜기 / 끄기' },
    { keys: ['←', '→'], desc: '이전 / 다음 문장 (묶음 반복 중엔 묶음 단위, 오답 모드에선 오답만)' },
    { keys: ['↑', '↓'], desc: '5초 뒤로 / 앞으로 탐색' },
    { keys: ['[', ']'], desc: '재생 속도 느리게 / 빠르게' },
    { keys: ['?'], desc: '이 도움말 열기 / 닫기' },
];

const ShortcutsHelp = ({ onClose }) => (
    <div className="fixed inset-0 z-[120] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-slate-100 p-2 rounded-xl">
                        <Keyboard size={20} className="text-slate-600" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900">키보드 단축키</h2>
                </div>
                <button onClick={onClose} aria-label="닫기" className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <X size={20} className="text-slate-400" />
                </button>
            </div>

            <div className="p-5 space-y-2.5">
                {SHORTCUTS.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                        <span className="text-sm text-slate-600">{s.desc}</span>
                        <div className="flex items-center gap-1 shrink-0">
                            {s.keys.map((k) => (
                                <kbd key={k} className="min-w-[28px] px-2 py-1 text-center text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg shadow-sm">
                                    {k}
                                </kbd>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="px-5 py-3 bg-slate-50 text-center">
                <p className="text-[11px] text-slate-400">입력창에 타이핑 중일 땐 단축키가 비활성화됩니다.</p>
            </div>
        </div>
    </div>
);

export default ShortcutsHelp;
