import { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';

// 기기 간 동기화용 비밀 암호 입력 게이트
// 같은 암호를 넣은 기기끼리 같은 보관함(대본 목록)을 공유한다.
const PassphraseGate = ({ onSubmit }) => {
    const [value, setValue] = useState('');

    const submit = (e) => {
        e.preventDefault();
        const p = value.trim();
        if (p.length < 4) return;
        onSubmit(p);
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-[#F8FAFC] p-6">
            <form
                onSubmit={submit}
                className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-slate-100 p-8 space-y-6 animate-in zoom-in-95 duration-200"
            >
                <div className="text-center space-y-3">
                    <div className="inline-flex p-4 bg-indigo-50 rounded-2xl text-indigo-600">
                        <Lock size={28} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">보관함 열기</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            비밀 암호를 입력하면 어느 기기서든<br />같은 대본 목록을 볼 수 있어요.
                        </p>
                    </div>
                </div>

                <div className="space-y-2">
                    <input
                        type="password"
                        autoFocus
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="비밀 암호 (4자 이상)"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-center font-bold tracking-wide"
                    />
                    <p className="text-[11px] text-slate-400 text-center px-2">
                        같은 암호를 다른 기기·친구가 넣으면 같은 보관함을 공유합니다.<br />
                        나만 쓰려면 남이 모를 암호를 정하세요.
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={value.trim().length < 4}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100"
                >
                    보관함 열기 <ArrowRight size={18} />
                </button>
            </form>
        </div>
    );
};

export default PassphraseGate;
