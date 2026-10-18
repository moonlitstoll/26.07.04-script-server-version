import { X, Keyboard } from 'lucide-react';

const SHORTCUTS = [
    { keys: ['Space'], desc: '재생 / 일시정지' },
    { keys: ['Enter'], desc: '현재 문장 구간 반복 (묶음 N이면 N문장)' },
    { keys: ['B'], desc: '분석 보기 전환 (풀이 접힘 → 풀이 펼침 → 숨김)' },
    { keys: ['←', '→'], desc: '이전 / 다음 문장 (묶음 반복 중엔 묶음 단위, 오답 모드에선 오답만)' },
    { keys: ['↑', '↓'], desc: '5초 뒤로 / 앞으로 탐색' },
    { keys: ['[', ']'], desc: '재생 속도 느리게 / 빠르게' },
    { keys: ['?'], desc: '이 도움말 열기 / 닫기' },
];

const ShortcutsHelp = ({ onClose }) => (
    <div className="fixed inset-0 z-[120] bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div
            className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-slate-100 dark:bg-slate-700 p-2 rounded-xl">
                        <Keyboard size={20} className="text-slate-600 dark:text-slate-300" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">키보드 단축키</h2>
                </div>
                <button onClick={onClose} aria-label="닫기" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                    <X size={20} className="text-slate-400 dark:text-slate-500" />
                </button>
            </div>

            <div className="p-5 space-y-2.5">
                {SHORTCUTS.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                        <span className="text-sm text-slate-600 dark:text-slate-300">{s.desc}</span>
                        <div className="flex items-center gap-1 shrink-0">
                            {s.keys.map((k) => (
                                <kbd key={k} className="min-w-[28px] px-2 py-1 text-center text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
                                    {k}
                                </kbd>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900 text-center">
                <p className="text-[11px] text-slate-400 dark:text-slate-500">입력창에 타이핑 중일 땐 단축키가 비활성화됩니다.</p>
            </div>
        </div>
    </div>
);

export default ShortcutsHelp;
