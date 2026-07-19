import { useState, useMemo } from 'react';
import { Check, X, Languages } from 'lucide-react';
import { buildCloze } from '../utils/clozeUtils';

// 가려진 청크를 '박스 하나 + 단어별 밑줄'로 렌더.
// 박스(연노랑 배경)는 청크 전체에 하나 — 청크가 한 단위임이 보인다.
// 내부는 실제 단어를 투명 텍스트로 깔아 너비가 답 길이와 일치하고,
// 단어마다 밑줄이 끊어져 밑줄 수 = 단어 수. (베트남어는 음절마다 띄어쓰기라 발음 박자와도 맞는다)
// select-none + aria-label로 드래그/스크린리더로 답이 새지 않게 한다.
// 박스 아무 데나 탭하면 onReveal — 그 청크(통째 가림이면 문장 전체) 공개.
const BlankChunk = ({ text, title, label, onReveal }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onReveal(); }}
        title={title}
        aria-label={label}
        className="align-baseline mx-0.5 px-1.5 rounded-md bg-amber-50 hover:bg-amber-100 transition-colors inline-flex flex-wrap gap-x-1.5 max-w-full"
    >
        {text.split(/\s+/).filter(Boolean).map((w, j) => (
            <span key={j} className="border-b-2 border-amber-400 text-transparent select-none">
                {w}
            </span>
        ))}
    </button>
);

// 한 문장의 빈칸 학습 UI. TranscriptItem 안에서 원문/분석 대신 렌더된다.
// 흐름: 빈칸 탭 → 그 청크 공개(채점 없음) → 전부 공개되면 [알았음/몰랐음] 자가표시.
// 통째 가림(1청크/고급)이면 문장 전체가 단어 칸으로 나오고, 아무 칸이나 탭하면 전체 공개 → 자가표시.
// 회상 모드(recall)는 통째 가림에 더해 번역을 단서로 위에 보여준다 — 뜻을 보고 원어를 산출하는 연습.
// round/difficulty가 바뀌면 부모가 key로 remount시켜 상태(공개/표시)를 초기화한다.
// [점프] 청크(빈칸/공개청크)·마크버튼이 아닌 빈 영역을 탭하면 onJump → 그 문장으로 이동
//   (하이라이트+재생, 일반 모드 문장 클릭과 동일). 청크/버튼은 모두 stopPropagation이라 점프로 안 샌다.
const ClozeDrill = ({ item, idx, difficulty, round, onMark, onJump }) => {
    const drill = useMemo(() => buildCloze(item, idx, round, difficulty), [item, idx, round, difficulty]);
    const [revealed, setRevealed] = useState(() => new Set()); // 공개된 빈칸의 part 인덱스
    const [marked, setMarked] = useState(null); // 'known' | 'unknown' | null

    // 분석 안 된(청크 0개) 문장 → 드릴 불가, 원문만 표시 (탭하면 점프)
    if (!drill.ok) {
        return (
            <div onClick={onJump} className="text-lg sm:text-xl leading-snug px-1 font-bold text-slate-400 cursor-pointer">
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
    // 다시 가리면 marked도 초기화 → 나중에 다시 전부 공개하면 [알았음/몰랐음]이 재등장(같은 문장 재연습).
    // (이미 저장된 ❗오답 기록(localStorage)은 그대로 유지 — 로컬 marked만 리셋)
    const hideOne = (i) => { setRevealed(prev => { const n = new Set(prev); n.delete(i); return n; }); setMarked(null); };
    const clearReveals = () => { setRevealed(new Set()); setMarked(null); };
    const mark = (known) => { setMarked(known ? 'known' : 'unknown'); if (onMark) onMark(known); };

    return (
        // 빈 영역 탭 → 점프. 내부 청크/버튼은 stopPropagation으로 자기 동작만 한다.
        <div onClick={onJump} className="px-1 cursor-pointer">
            {/* [회상 모드] 번역 단서 — 이걸 보고 원어를 입으로 꺼낸 뒤 빈칸을 열어 확인.
                stopPropagation 필수: 단서를 읽으려고 탭했는데 onJump로 문장이 재생되면 정답 음성이 샌다. */}
            {drill.recall && (
                item.translation ? (
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="mb-2 rounded-xl px-3 py-1.5 border bg-indigo-50/80 border-indigo-100 cursor-default"
                    >
                        <div className="flex items-center gap-1.5 text-indigo-600 font-bold text-[11px] uppercase tracking-wider mb-0.5">
                            <Languages size={12} /> 번역 단서 — 원어로 말해보세요
                        </div>
                        <p className="text-slate-700 text-[15px] leading-snug whitespace-pre-line font-medium">
                            {item.translation.replace(/\\n/g, '\n')}
                        </p>
                    </div>
                ) : (
                    <div className="mb-1 text-[12px] text-slate-400 font-medium">(번역 없음 — 고급 가리기와 동일)</div>
                )
            )}
            {/* 클로즈 문장 */}
            <div className="text-lg sm:text-xl md:text-2xl leading-relaxed font-bold text-slate-900 mb-2">
                {drill.parts.map((p, i) => {
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
                    // 통째 가림이면 어떤 칸을 탭해도 문장 전체 공개 (부분 공개 없음 → 자가표시 흐름 단일화)
                    return (
                        <BlankChunk
                            key={i}
                            text={p.answer}
                            title={drill.wholeSentence ? '탭하면 문장 전체 공개' : '탭하면 공개'}
                            label={drill.wholeSentence ? '빈칸 — 탭하면 문장 전체 공개' : '빈칸 — 탭하면 공개'}
                            onReveal={() => (drill.wholeSentence ? revealAll() : revealOne(i))}
                        />
                    );
                })}
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

            {/* 컨트롤: 전부 공개 + 아직 미선택일 때만 '알았음/몰랐음' 표시.
                선택하면 숨겨 화면 절약(몰랐음은 문장 앞 ❗배지로 남음). 청크 다시 가렸다 열면 marked 리셋돼 재등장. */}
            {allRevealed && marked === null && (
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400">알았나요?</span>
                    <button
                        onClick={(e) => { e.stopPropagation(); mark(true); }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                    >
                        <Check size={13} /> 알았음
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); mark(false); }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100"
                    >
                        <X size={13} /> 몰랐음
                    </button>
                </div>
            )}
        </div>
    );
};

export default ClozeDrill;
