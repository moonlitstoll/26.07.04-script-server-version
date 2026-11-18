import { Fragment } from 'react';
import { splitGlossPairs } from '../utils/analysisParser';

// 괄호 안 단어 풀이 "(Và: 그리고 + đây: 여기)" 표시 — 대본 카드와 가리기 학습이 같이 쓴다(2026-11-17).
//  - 원어 단어만 하늘색: 풀이의 한글이 위쪽 한글 뜻과 같은 밝기라 어디가 풀이인지 안 갈렸다.
//  - 쌍점·더하기 기호는 한 단계 흐리게: 단어와 뜻이 더 도드라진다.
//  - "단어: 뜻 +" 한 쌍을 inline-block 으로 묶어 줄 끝에서 안 갈라지게 하는 것도 해 봤지만
//    오른쪽 끝이 들쭉날쭉해져 사용자가 뺐다(2026-11-18). 다시 넣지 말 것. 줄바꿈은 보통 글처럼 흐른다.
// 글자색·크기·굵기는 감싸는 쪽이 정한다. renderText 는 글자 조각을 그리는 함수(대본 카드는 **굵게** 처리를 넘긴다).
const WORD = 'text-sky-700 dark:text-sky-300';
const MARK = 'text-slate-400 dark:text-slate-500';

export default function GlossText({ text, keyPrefix = 'g', renderText = (t) => t }) {
    return splitGlossPairs(text).map((u, i) => (
        <Fragment key={`${keyPrefix}-${i}`}>
            {u.parts.map((p, j) => {
                const key = `${keyPrefix}-${i}-${j}`;
                if (p.type === 'word') return <span key={key} className={WORD}>{p.text}</span>;
                if (p.type === 'mark') return <span key={key} className={MARK}>{p.text}</span>;
                return <Fragment key={key}>{renderText(p.text, key)}</Fragment>;
            })}
            {u.after}
        </Fragment>
    ));
}
