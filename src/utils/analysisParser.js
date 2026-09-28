// 문장의 analysis 문자열(여러 줄)에서 의미 청크를 뽑아낸다.
// 각 줄 형식: "**원어 청크**: 한국어 뜻 (요소별 상세)"  ([분석] 마커는 저장 시 제거됨)
// 반환: [{ chunk: '원어', meaning: '뜻(상세)' }]
//  - 💡 태그(폐지 기능)는 뜻에서 제거, ⚡실제 병기는 보존(학습에 유용)
//  - "문장 전체=1청크" 실패본이면 길이 1 배열이 나오고, 호출부에서 '통째 가림'으로 처리
// 분석 한 줄을 [본문(청크+뜻), 요소 풀이, 꼬리]로 나눈다 — 화면에서 풀이만 흐리게 보여 강약을 주기 위함.
//  "**Ở đây thì**: 여기서는 (Ở đây: 여기 + thì: ~라면)" → ["**Ở đây thì**: 여기서는 ", "(Ở đây: 여기 + thì: ~라면)", ""]
//  - 풀이 = 줄 끝의 괄호 묶음(중첩 허용). 앞에 공백이 있고 안에 ':'가 있을 때만 — "개(단위)"처럼
//    뜻에 붙은 짧은 괄호나 숫자 병기 "một nghìn(1.000)"은 풀이가 아니다.
//  - 줄 끝의 〔⚡실제: …〕는 풀이 뒤에 와도 꼬리로 떼어 본문 강조를 유지한다.
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
