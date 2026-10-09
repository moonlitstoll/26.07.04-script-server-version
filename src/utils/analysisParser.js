// 문장의 analysis 문자열(여러 줄)에서 의미 청크를 뽑아낸다.
// 각 줄 형식: "**원어 청크**: 한국어 뜻 (요소별 상세)"  ([분석] 마커는 저장 시 제거됨)
// 반환: [{ chunk: '원어', meaning: '뜻(상세)' }]
//  - 💡 태그(폐지 기능)는 뜻에서 제거, ⚡ 슬랭 병기(〔⚡표현: 뜻·말투〕, v4부터 표현 이름 포함, 종류 꼬리표 없음)는 보존(학습에 유용)
//  - "문장 전체=1청크" 실패본이면 길이 1 배열이 나오고, 호출부에서 '통째 가림'으로 처리
// 분석 한 줄을 [본문(청크+뜻), 요소 풀이, 꼬리]로 나눈다 — 화면에서 풀이만 흐리게 보여 강약을 주기 위함.
//  "**Ở đây thì**: 여기서는 (Ở đây: 여기 + thì: ~라면)" → ["**Ở đây thì**: 여기서는 ", "(Ở đây: 여기 + thì: ~라면)", ""]
//  - 풀이 = 줄 끝의 괄호 묶음(중첩 허용). 앞에 공백이 있고 안에 ':'가 있을 때만 — "개(단위)"처럼
//    뜻에 붙은 짧은 괄호나 숫자 병기 "một nghìn(1.000)"은 풀이가 아니다.
//  - 줄 끝의 〔⚡…〕(옛 '⚡실제: …' / v4 '⚡표현: 뜻')는 풀이 뒤에 와도 꼬리로 떼어 본문 강조를 유지한다.
//  - 해당 없으면 [줄 전체, '', 꼬리] — 세 조각을 이으면 항상 원래 줄이 된다.
export function splitBreakdown(line) {
    const s = line || '';
    const t = s.match(/\s*〔[^〕]*〕\s*$/);
    const tail = t ? t[0] : '';
    const body = t ? s.slice(0, t.index) : s;
    const end = body.replace(/\s+$/, '');
    const trailingWs = body.slice(end.length);
    if (!end.endsWith(')')) return [body, '', tail];
    let depth = 0;
    for (let i = end.length - 1; i >= 0; i--) {
        const c = end[i];
        if (c === ')') depth++;
        else if (c === '(' && --depth === 0) {
            const group = end.slice(i);
            if (i > 0 && /\s/.test(end[i - 1]) && group.includes(':')) {
                return [end.slice(0, i), group + trailingWs, tail];
            }
            break;
        }
    }
    return [body, '', tail];
}

// [괄호 속 괄호 안전망 — Stage 2 v4 표기 규칙] 요소 풀이 안에 모델이 또 괄호를 넣으면 정한 모양으로 바꾼다.
// 규칙(prompts.js D·E): 보충 설명은 가운뎃점, 합성어 부품은 〈〉. 모델이 어겨도 저장 모양이 같게.
//  "쨍(종소리)"            → "쨍·종소리"            (뜻 뒤에 붙은 보충 설명)
//  "팽팽한→(무게를) 재다"   → "팽팽한→무게를 재다"   (뜻 앞머리 괄호는 괄호만 벗김)
//  "튕기다(búng: 튀기다 + tay: 손)" → "튕기다〈튀기다·손〉" (괄호로 쓴 부품 풀이)
//  숫자·기호 병기 "sáu trăm(600)"·"mét(m)"·"trên(/)"는 전사 규칙 6의 단어 자체라 그대로 둔다.
// 새로 받은 응답에만 쓴다(stage2Parser). 옛 캐시의 한자 뜻풀이 "(날 출 + 나타날 현)"까지 바꾸면
// 오히려 모양이 깨지므로 표시 단계에서는 부르지 않는다.
const NOTATION_PAREN = /^[^\s가-힣ㄱ-ㅎㅏ-ㅣ()]{1,12}$/;
// 청크 뜻(굵은 청크 바로 뒤)에 화살표가 오면 오른쪽(이 문장의 뜻)만 남긴다 — 화살표는 괄호 안 단어 풀이 전용.
// 실측(v4 시험): "**đang chơi**: ~하는 중이다→운행하는 중이다", "**ghé tới**: 들르다→비추다".
const stripMainArrow = (main) => {
    const m = main.match(/^(\s*\*\*.+?\*\*\s*:\s*)(.*)$/s);
    if (!m || !m[2].includes('→')) return main;
    const rest = m[2];
    const ws = rest.match(/\s*$/)[0];
    return m[1] + rest.slice(rest.lastIndexOf('→') + 1).trim() + ws;
};
export function flattenNestedParens(line) {
    const [rawMain, group, tail] = splitBreakdown(line);
    const main = stripMainArrow(rawMain);
    if (!group) return main + tail;
    const g = group.replace(/\s+$/, '');
    const ws = group.slice(g.length);
    let inner = g.slice(1, -1);
    for (let pass = 0; pass < 3; pass++) {
        const next = inner.replace(/(\s*)\(([^()]*)\)/g, (m, sp, body, off, str) => {
            const prev = str.slice(0, off).replace(/\s+$/, '').slice(-1);
            if (NOTATION_PAREN.test(body) && /[\p{L}\p{N}]/u.test(prev)) return m;
            const content = body.trim();
            if (!content) return '';
            if (/\s\+\s/.test(content)) {
                const parts = content.split(/\s\+\s/).map(x => x.replace(/^[^:]*:\s*/, '').trim()).filter(Boolean);
                return '〈' + parts.join('·') + '〉';
            }
            if (!prev || /[:→+·]/.test(prev)) return (sp ? ' ' : '') + content;
            return '·' + content;
        });
        if (next === inner) break;
        inner = next;
    }
    return main + '(' + inner + ')' + ws + tail;
}

export function parseChunks(item) {
    if (!item || !item.isAnalyzed || typeof item.analysis !== 'string') return [];
    return item.analysis.split('\n')
        .map(raw => {
            // 혹시 남아있을 수 있는 [분석]/분석] 접두 제거
            const line = raw.replace(/^\s*\[?\s*분석\s*\]?\s*/, '');
            const m = line.match(/^\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/);
            if (!m) return null;
            const chunk = m[1].trim();
            if (!chunk) return null;
            const meaning = (m[2] || '').replace(/\\n/g, ' ').replace(/\s*〔💡[^〕]*〕/g, '').trim();
            return { chunk, meaning };
        })
        .filter(Boolean);
}
