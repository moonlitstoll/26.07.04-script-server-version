import { useState, useMemo } from 'react';
import { Eye, Check, X } from 'lucide-react';
import { buildCloze } from '../utils/clozeUtils';

// 한 문장의 빈칸 학습 UI. TranscriptItem 안에서 원문/분석 대신 렌더된다.
// 흐름: 빈칸 탭 → 그 청크 공개(채점 없음) → 전부 공개되면 [알았음/몰랐음] 자가표시.
// 통째 가림(1청크/고급)이면 '정답 보기' 한 번으로 전체 공개 → 자가표시.
// round/difficulty가 바뀌면 부모가 key로 remount시켜 상태(공개/표시)를 초기화한다.
const ClozeDrill = ({ item, idx, difficulty, round, onMark }) => {
    const drill = useMemo(() => buildCloze(item, idx, round, difficulty), [item, idx, round, difficulty]);
    const [revealed, setRevealed] = useState(() => new Set()); // 공개된 빈칸의 part 인덱스
    const [marked, setMarked] = useState(null); // 'known' | 'unknown' | null

    // 분석 안 된(청크 0개) 문장 → 드릴 불가, 원문만 표시
    if (!drill.ok) {
        return (
            <div className="text-lg sm:text-xl leading-snug px-1 font-bold text-slate-400">
                {item.text}
                <span className="ml-2 text-[11px] font-medium text-slate-300">(분석 전 — 가리기 불가)</span>
            </div>
        );
    }

    const blankPartIdxs = drill.parts.map((p, i) => (p.type === 'blank' ? i : -1)).filter(i => i >= 0);
    const allRevealed = blankPartIdxs.every(i => revealed.has(i));

    const revealOne = (i) => setRevealed(prev => { const n = new Set(prev); n.add(i); return n; });
    const revealAll = () => setRevealed(new Set(blankPartIdxs));
    // 다시 가리기(토글): 공개한 청크를 다시 탭하면 빈칸으로 복귀. 통째 가림은 전체 접기.
    // (전부 공개 상태가 깨지면 아래 알았음/몰랐음 버튼은 allRevealed 조건으로 자동 숨김.
    //  이미 저장된 ❗오답 기록은 그대로 유지 — 화면만 리셋)
    const hideOne = (i) => setRevealed(prev => { const n = new Set(prev); n.delete(i); return n; });
    const clearReveals = () => setRevealed(new Set());
    const mark = (known) => { setMarked(known ? 'known' : 'unknown'); if (onMark) onMark(known); };

    return (
        <div className="px-1">
            {/* 클로즈 문장 */}
            <div className="text-lg sm:text-xl md:text-2xl leading-relaxed font-bold text-slate-900 mb-2">
                {drill.wholeSentence && !allRevealed ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-400 tracking-widest">
                        _______________
                    </span>
                ) : (
                    drill.parts.map((p, i) => {
                        if (p.type === 'text') return <span key={i}>{p.value} </span>;
                        if (revealed.has(i)) {
                            return (
                                <button
                                    key={i}
                                    onClick={(e) => { e.stopPropagation(); if (drill.wholeSentence) clearReveals(); else hideOne(i); }}
                                    title="다시 가리기"
                                    className="align-baseline text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded px-1 transition-colors"
                                >
                                    {p.answer}{' '}
                                </button>
                            );
                        }
                        return (
                            <button
                                key={i}
                                onClick={(e) => { e.stopPropagation(); revealOne(i); }}
                                className="align-baseline mx-0.5 px-2 rounded-md bg-amber-50 border-b-2 border-amber-300 text-amber-400 hover:bg-amber-100 tracking-widest transition-colors"
                            >
                                ____
                            </button>
                        );
                    })
                )}
            </div>

            {/* 공개된 청크의 뜻 */}
            {allRevealed && (
                <div className="mb-2 space-y-0.5">
                    {drill.parts.filter(p => p.type === 'blank').map((p, i) => (
                        <div key={i} className="text-[13px] text-slate-600">
                            <span className="font-bold text-emerald-700">{p.answer}</span>
                            {p.meaning ? <span className="text-slate-500"> — {p.meaning}</span> : null}
                        </div>
                    ))}
                </div>
            )}

            {/* 컨트롤: 통째 가림이면 '정답 보기', 전부 공개되면 '알았음/몰랐음' */}
            {drill.wholeSentence && !allRevealed ? (
                <button
                    onClick={(e) => { e.stopPropagation(); revealAll(); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition-colors"
                >
                    <Eye size={14} /> 정답 보기
                </button>
            ) : allRevealed ? (
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400">알았나요?</span>
                    <button
                        onClick={(e) => { e.stopPropagation(); mark(true); }}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${marked === 'known' ? 'bg-emerald-500 text-white border-emerald-500' : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'}`}
                    >
                        <Check size={13} /> 알았음
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); mark(false); }}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${marked === 'unknown' ? 'bg-amber-500 text-white border-amber-500' : 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100'}`}
                    >
                        <X size={13} /> 몰랐음
                    </button>
                </div>
            ) : (
                <div className="text-[11px] font-medium text-slate-400">🔊 듣고 떠올린 뒤 빈칸을 탭해 확인하세요</div>
            )}
        </div>
    );
};

export default ClozeDrill;
