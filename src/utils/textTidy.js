// 받아쓰기 글자에 섞여 든 찌꺼기 정리 (2026-11-23, 휴대폰 대본 20개 점검에서 발견).
// sanitizeData가 대본을 열 때·저장할 때마다 부르므로, 이미 저장된 대본도 열면 바로 깨끗해진다(다시 분석할 필요 없음).
//
// ① 같은 말 괄호 겹침: `km(km)`, `Mon(Mon)`, `order(order)`, `YouTube(YouTube)` → `km`, `Mon`…
//    1단계 규칙 6(숫자·기호는 `소리나는말(원본)`)을 모델이 영어 단어에까지 써서 생긴다
//    ("6. Mình Có Thể" 64문장, "3. Kiểm Chứng" 2문장). 괄호 안이 앞 단어와 글자가 같을 때(대소문자 무시)만 지운다 —
//    `một(1)`·`ca(65k)`·`lít(L)` 같은 진짜 병기는 그대로 둔다. 2단계 분석의 청크·풀이에도 같은 모양이 옮아 있어 같이 지운다.
// ② 문장 앞 말한 사람 표시: `[Người nói] || Khoảng…` → `Khoảng…`
//    모델이 `[시각] || [화자] || 문장`처럼 화자 칸을 한 번 더 써서, 줄 파서가 둘째 칸을 문장으로 읽었다(MV 대본 21:09, 1문장).
//    대괄호 + `||`(또는 `|`)로 시작할 때만 지운다.

const SAME_PAREN = /([\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*)\(\s*([^()\n]{1,40}?)\s*\)/gu;
const LEAD_LABEL = /^\s*\[[^\]\n]{1,30}\]\s*\|\|?\s*/;

/** `word(word)`처럼 괄호 안이 앞 단어와 같은 겹침만 앞 단어로 줄인다. 문자열이 아니면 그대로 돌려준다. */
export function stripSameParen(s) {
    if (typeof s !== 'string' || !s.includes('(')) return s;
    return s.replace(SAME_PAREN, (m, word, inner) => (word.toLowerCase() === inner.toLowerCase() ? word : m));
}

/** 대본 문장 글자 정리: 앞의 `[화자] ||` + 같은 말 괄호 겹침. 정리하고 나서 비면 원래 글자를 돌려준다. */
export function tidyTranscriptText(text) {
    if (typeof text !== 'string') return text;
    const out = stripSameParen(text.replace(LEAD_LABEL, ''));
    return out.trim() ? out : text;
}
