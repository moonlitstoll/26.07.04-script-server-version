import { useState, useMemo } from 'react';
import { Languages } from 'lucide-react';
import { buildCloze } from '../utils/clozeUtils';
import { splitBreakdown } from '../utils/analysisParser';
import GlossText from './GlossText';

// 가려진 청크를 '박스 하나 + 단어별 밑줄'로 렌더.
// 박스(연노랑 배경)는 청크 전체에 하나 — 청크가 한 단위임이 보인다.
// 내부는 실제 단어를 투명 텍스트로 깔아 너비가 답 길이와 일치하고,
// 단어마다 밑줄이 끊어져 밑줄 수 = 단어 수. (베트남어는 음절마다 띄어쓰기라 발음 박자와도 맞는다)
// select-none + aria-label로 드래그/스크린리더로 답이 새지 않게 한다.
// 박스 아무 데나 탭하면 onReveal — 그 문장의 빈칸 전부 공개.
const BlankChunk = ({ text, title, label, onReveal }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onReveal(); }}
        title={title}
        aria-label={label}
        className="align-baseline mx-0.5 px-1.5 rounded-md bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors inline-flex flex-wrap gap-x-1.5 max-w-full"
    >
        {text.split(/\s+/).filter(Boolean).map((w, j) => (
            <span key={j} className="border-b-2 border-amber-400 text-transparent select-none">
                {w}
            </span>
        ))}
    </button>
);

// 한 문장의 빈칸 학습 UI. TranscriptItem 안에서 원문/분석 대신 렌더된다.
// 흐름: 빈칸을 아무거나 탭 → 문장의 빈칸 전부 공개(채점 없음). 공개된 단어를 탭 → 전부 다시 가림.
// (2026-11-18 사용자 요청: 단어 단위로 가리면서 빈칸이 늘어 하나씩 누르기가 번거로웠다)
// '번역 보기'를 켜면 어떤 난이도든 번역을 단서로 위에 보여준다 — 뜻을 보고 원어를 산출하는 연습.
// round/difficulty가 바뀌면 부모가 key로 remount시켜 공개 상태를 초기화한다.
// [점프] 청크(빈칸/공개청크)가 아닌 빈 영역을 탭하면 onJump → 그 문장으로 이동
//   (하이라이트+재생, 일반 모드 문장 클릭과 동일). 청크는 모두 stopPropagation이라 점프로 안 샌다.
const ClozeDrill = ({ item, idx, difficulty, round, showTranslation = false, onJump }) => {
    const drill = useMemo(() => buildCloze(item, idx, round, difficulty), [item, idx, round, difficulty]);
    const [revealed, setRevealed] = useState(false); // 문장의 빈칸을 모두 열었는가

    // 분석 안 된(청크 0개) 문장 → 드릴 불가, 원문만 표시 (탭하면 점프)
    if (!drill.ok) {
        return (
            <div onClick={onJump} className="text-lg sm:text-xl leading-snug px-1 font-medium text-slate-400 dark:text-slate-500 cursor-pointer">
                {item.text}
                <span className="ml-2 text-[11px] font-medium text-slate-300 dark:text-slate-600">(분석 전 — 가리기 불가)</span>
            </div>
        );
    }

    return (
        // 빈 영역 탭 → 점프. 내부 청크/버튼은 stopPropagation으로 자기 동작만 한다.
        <div onClick={onJump} className="px-1 cursor-pointer">
            {/* [번역 보기] 번역 단서 — 이걸 보고 원어를 입으로 꺼낸 뒤 빈칸을 열어 확인.
                stopPropagation 필수: 단서를 읽으려고 탭했는데 onJump로 문장이 재생되면 정답 음성이 샌다. */}
            {showTranslation && (
                item.translation ? (
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="mb-2 rounded-xl px-3 py-1.5 border bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-100 dark:border-indigo-900 cursor-default"
                    >
                        <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold text-[11px] uppercase tracking-wider mb-0.5">
                            <Languages size={12} /> 번역 단서 — {drill.wholeSentence ? '원어로 말해보세요' : '가려진 곳을 말해보세요'}
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 text-[15px] leading-snug whitespace-pre-line font-medium">
                            {item.translation.replace(/\\n/g, '\n')}
                        </p>
                    </div>
                ) : (
                    <div className="mb-1 text-[12px] text-slate-400 dark:text-slate-500 font-medium">(번역 없음)</div>
                )
            )}
            {/* 클로즈 문장 */}
            <div className="text-lg sm:text-xl md:text-2xl leading-relaxed font-medium text-slate-900 dark:text-slate-100 mb-2">
                {drill.parts.map((p, i) => {
                    if (p.type === 'text') return <span key={i}>{p.value} </span>;
                    if (revealed) {
                        return (
                            <button
                                key={i}
                                onClick={(e) => { e.stopPropagation(); setRevealed(false); }}
                                title="다시 가리기"
                                className="align-baseline text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded px-1 transition-colors"
                            >
                                {p.answer}{' '}
                            </button>
                        );
                    }
                    return (
                        <BlankChunk
                            key={i}
                            text={p.answer}
                            title="탭하면 문장 전체 공개"
                            label="빈칸 — 탭하면 문장 전체 공개"
                            onReveal={() => setRevealed(true)}
                        />
                    );
                })}
            </div>

            {/* 가려졌던 단어가 든 청크의 뜻 */}
            {revealed && (
                <div className="mb-2 space-y-0.5">
                    {drill.meanings.map((p, i) => {
                        // 뜻 뒤의 괄호 풀이는 대본 카드와 같은 모양(단어 하늘색·기호 흐리게)으로 보여 준다
                        const [main, gloss, tail] = splitBreakdown(p.meaning || '');
                        return (
                            <div key={i} className="text-[13px] text-slate-600 dark:text-slate-300">
                                <span className="font-semibold text-emerald-700 dark:text-emerald-300">{p.chunk}</span>
                                {p.meaning ? <span className="text-slate-600 dark:text-slate-300"> — {main}{gloss && <GlossText text={gloss} keyPrefix={`c${i}`} />}{tail}</span> : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ClozeDrill;
