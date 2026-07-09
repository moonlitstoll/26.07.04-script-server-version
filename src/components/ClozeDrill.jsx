import { useState, useMemo } from 'react';
import { Check, X } from 'lucide-react';
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

            {/* 컨트롤: 전부 공개되면 '알았음/몰랐음', 아니면 안내 (통째 가림도 빈칸을 직접 탭해 공개) */}
            {allRevealed ? (
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
