import { useState } from 'react';
import { Languages } from 'lucide-react';

// 가려진 청크를 '박스 하나 + 단어별 밑줄'로 렌더.
// 박스(연노랑 배경)는 청크 전체에 하나 — 청크가 한 단위임이 보인다.
// 내부는 실제 단어를 투명 텍스트로 깔아 너비가 답 길이와 일치하고,
// 단어마다 밑줄이 끊어져 밑줄 수 = 단어 수. (베트남어는 음절마다 띄어쓰기라 발음 박자와도 맞는다)
// select-none + aria-label로 드래그/스크린리더로 답이 새지 않게 한다.
// 답을 열면 같은 박스·밑줄에 글자만 노랗게 드러난다 — 자리가 안 움직이고, 초록 해설과 구분된다(2026-11-18 사용자 요청).
// 누르면 문장 칸의 onClick으로 올라가 열기/가리기가 된다(버튼은 키보드로도 누를 수 있게 남겨 둔다).
// onMouseDown 막기: 손가락·마우스로 눌렀을 때 버튼에 초점이 남아 파란 테두리가 뜨지 않게 한다.
const ClozeChunk = ({ text, revealed }) => (
    <button
        onMouseDown={(e) => e.preventDefault()}
        title={revealed ? '다시 가리기' : '탭하면 문장 전체 공개'}
        aria-label={revealed ? `${text} — 탭하면 다시 가리기` : '빈칸 — 탭하면 문장 전체 공개'}
        className="align-baseline mx-0.5 px-1.5 rounded-md bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors inline-flex flex-wrap gap-x-1.5 max-w-full"
    >
        {text.split(/\s+/).filter(Boolean).map((w, j) => (
            <span key={j} className={`border-b-2 border-amber-400 ${revealed ? 'text-amber-700 dark:text-amber-300' : 'text-transparent select-none'}`}>
                {w}
            </span>
        ))}
    </button>
);

// 한 문장의 빈칸 학습 UI. TranscriptItem 안에서 원문 대신 렌더된다.
// 흐름: 문장 칸(빈칸·글자·빈 곳) 어디든 탭 → 문장의 빈칸 전부 공개(채점 없음). 다시 탭 → 전부 다시 가림.
// (2026-11-18 사용자 요청: 단어 단위로 가리면서 빈칸이 늘어 하나씩 누르기가 번거로웠다)
// 답을 열면 그 아래에 explanation(일반 화면과 같은 번역·분석 칸)을 그린다 — 문장 전체 해설이 나오고,
//   하단 눈·책 버튼(숨김/접힘/풀이 펼침)과 분석 칸 탭(이 카드만 펼침)도 일반 화면과 똑같이 듣는다.
//   열기 전에는 그리지 않는다(분석에 정답이 그대로 들어 있다). 가려졌던 단어는 해설에서도 노란 글자다.
// '번역 보기'를 켜면 어떤 난이도든 번역을 단서로 위에 보여준다 — 뜻을 보고 원어를 산출하는 연습.
// round/difficulty가 바뀌면 부모가 key로 remount시켜 공개 상태를 초기화한다.
// [점프] 번역 단서를 탭하면 onJump → 그 문장으로 이동·재생(일반 화면의 번역 상자와 동일, 2026-11-18 사용자 요청).
//   예전엔 문장의 빈 곳이 재생이라, 답을 보려다 빗나가면 정답 음성이 나왔다.
//   번역 보기를 끈 동안의 재생은 카드 위 시간 표시로 한다.
const ClozeDrill = ({ item, drill, showTranslation = false, onJump, explanation = null }) => {
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
        <div>
            <div className="px-1">
                {/* [번역 보기] 번역 단서 — 이걸 보고 원어를 입으로 꺼낸 뒤 문장을 눌러 확인. 탭하면 그 문장 재생. */}
                {showTranslation && (
                    item.translation ? (
                        <div
                            onClick={onJump}
                            title="탭하면 이 문장 재생"
                            className="mb-2 rounded-xl px-3 py-1.5 border bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-100 dark:border-indigo-900 cursor-pointer"
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
                {/* 클로즈 문장 — 칸 어디든 탭하면 열기/다시 가리기. 안의 버튼 탭도 여기로 올라온다. */}
                <div
                    onClick={() => setRevealed(v => !v)}
                    className="text-lg sm:text-xl md:text-2xl leading-relaxed font-medium text-slate-900 dark:text-slate-100 pb-1 cursor-pointer"
                >
                    {drill.parts.map((p, i) => {
                        if (p.type === 'text') return <span key={i}>{p.value} </span>;
                        return <ClozeChunk key={i} text={p.answer} revealed={revealed} />;
                    })}
                </div>
            </div>
            {revealed && explanation}
        </div>
    );
};

export default ClozeDrill;
