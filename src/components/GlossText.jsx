import { Fragment } from 'react';
import { splitGlossPairs } from '../utils/analysisParser';

// 괄호 안 단어 풀이 "(Và: 그리고 + đây: 여기)" 표시 — 대본 카드와 가리기 학습이 같이 쓴다(2026-11-17).
//  - 원어 단어만 하늘색: 풀이의 한글이 위쪽 한글 뜻과 같은 밝기라 어디가 풀이인지 안 갈렸다.
//  - "단어: 뜻 +" 한 쌍은 한 덩어리(inline-block): 줄 끝에서 "(Và:" / "그리고"로 갈라지지 않고 줄은 더하기 뒤에서만 바뀐다.
//    대신 줄 끝에 빈자리가 생긴다(실측 221문장: 풀이 줄 +5%). 한 줄보다 긴 쌍은 max-w-full 이라 덩어리 안에서 줄이 바뀐다.
//    단어가 없는 묶음(옛 한자 풀이 등 설명 글)은 묶지 않고 그대로 흘린다.
//  - 쌍점·더하기 기호는 한 단계 흐리게: 단어와 뜻이 더 도드라진다.
// 글자색·크기·굵기는 감싸는 쪽이 정한다. renderText 는 글자 조각을 그리는 함수(대본 카드는 **굵게** 처리를 넘긴다).
const WORD = 'text-sky-700 dark:text-sky-300';
const MARK = 'text-slate-400 dark:text-slate-500';

export default function GlossText({ text, keyPrefix = 'g', renderText = (t) => t }) {
    return splitGlossPairs(text).map((u, i) => {
        const parts = u.parts.map((p, j) => {
            const key = `${keyPrefix}-${i}-${j}`;
            if (p.type === 'word') return <span key={key} className={WORD}>{p.text}</span>;
            if (p.type === 'mark') return <span key={key} className={MARK}>{p.text}</span>;
            return <Fragment key={key}>{renderText(p.text, key)}</Fragment>;
        });
        const paired = u.parts.some(p => p.type === 'word');
        return (
            <Fragment key={`${keyPrefix}-${i}`}>
                {paired ? <span className="inline-block max-w-full">{parts}</span> : parts}
                {u.after}
            </Fragment>
        );
    });
}
