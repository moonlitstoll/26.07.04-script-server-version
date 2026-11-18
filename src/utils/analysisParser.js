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

// 요소 풀이 "(Và: 그리고 + đây: 여기)"를 [원어 단어 / 나머지] 조각으로 나눈다 — 화면에서 단어만 색을 달리 보여
// 위쪽 한글 뜻과 구분하기 위함(2026-11-17). 반환: [{ word, text }] — 이으면 항상 원래 글자.
//  - 항목은 괄호·〈〉 밖의 " + "로 나뉘고, 항목의 첫 쌍점 앞이 단어다. "ba(3)"처럼 숫자를 같이 적은 괄호는 단어에 포함.
//  - 쌍점이 없거나(옛 한자 풀이 "날 출 + 나타날 현") 앞이 한글이면("참고: …") 단어로 보지 않는다.
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
export function splitGlossWords(group) {
    const out = [];
    const push = (word, text) => {
        if (!text) return;
        const last = out[out.length - 1];
        if (!word && last && !last.word) last.text += text;
        else out.push({ word, text });
    };
    for (const u of splitGlossPairs(group)) {
        for (const p of u.parts) push(p.type === 'word', p.text);
        push(false, u.after);
    }
    return out;
}

// 요소 풀이를 "단어: 뜻 +" 묶음으로 나눈다 — 화면에서 단어 뒤 쌍점과 사이 더하기를 기호로 골라
// 쌍점·더하기 기호를 흐리게 보여 주기 위함(2026-11-17). splitGlossWords 도 이 결과를 이어 붙여 만든다.
// 반환: [{ parts: [{ type: 'word' | 'mark' | 'text', text }], after }] — parts 와 after 를 차례로 이으면 항상 원래 글자.
//  - 묶음은 더하기 기호까지다. 더하기 뒤 공백은 묶음 밖(after)이라 줄은 거기서만 바뀐다.
//    여는 괄호는 첫 묶음에, 닫는 괄호는 끝 묶음에 들어간다.
//  - mark 는 단어 바로 뒤의 첫 쌍점과 묶음을 가르는 더하기뿐이다. 뜻 안의 쌍점·괄호 속 더하기는 글자(text)다.
export function splitGlossPairs(group) {
    const s = group || '';
    if (!s) return [];
    const m = s.match(/^(\s*\()([\s\S]*)(\)\s*)$/);
    if (!m) return [{ parts: [{ type: 'text', text: s }], after: '' }];
    const inner = m[2];
    const items = [];
    let depth = 0, start = 0;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '(' || ch === '〈') depth++;
        else if (ch === ')' || ch === '〉') depth = Math.max(0, depth - 1);
        else if (depth === 0 && ch === '+' && /\s/.test(inner[i - 1] || '') && /\s/.test(inner[i + 1] || '')) {
            items.push({ raw: inner.slice(start, i), plus: true });
            start = i + 1;
        }
    }
    items.push({ raw: inner.slice(start), plus: false });
    // 둘째 항목부터는 앞 공백(더하기 뒤 공백)을 앞 묶음의 after 로 넘긴다
    const leads = items.map((it, idx) => (idx === 0 ? 0 : it.raw.length - it.raw.trimStart().length));
    return items.map((it, idx) => {
        const parts = [];
        const add = (type, text) => {
            if (!text) return;
            const last = parts[parts.length - 1];
            if (type === 'text' && last && last.type === 'text') last.text += text;
            else parts.push({ type, text });
        };
        if (idx === 0) add('text', m[1]);
        const body = it.raw.slice(leads[idx]);
        let d = 0, colon = -1;
        for (let i = 0; i < body.length; i++) {
            const ch = body[i];
            if (ch === '(' || ch === '〈') d++;
            else if (ch === ')' || ch === '〉') d = Math.max(0, d - 1);
            else if (d === 0 && (ch === ':' || ch === '：')) { colon = i; break; }
        }
        const head = colon < 0 ? '' : body.slice(0, colon);
        const w = head.trim();
        if (!w || HANGUL.test(w)) add('text', body);
        else {
            const lead = head.length - head.trimStart().length;
            add('text', head.slice(0, lead));
            add('word', w);
            add('text', head.slice(lead + w.length));
            add('mark', body[colon]);
            add('text', body.slice(colon + 1));
        }
        if (it.plus) add('mark', '+');
        if (idx === items.length - 1) add('text', m[3]);
        const next = items[idx + 1];
        return { parts, after: next ? next.raw.slice(0, leads[idx + 1]) : '' };
    });
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
// 청크 뜻(굵은 청크 바로 뒤)에 화살표가 오면 '이 문장의 뜻' 쪽만 남긴다 — 화살표는 괄호 안 단어 풀이 전용.
// v4 규칙 C는 `문맥뜻←본뜻`(지금 뜻이 앞)이라 ←면 왼쪽을, 옛 모양 `본뜻→문맥뜻`이 섞여 오면 →의 오른쪽을 남긴다.
// 실측(v4 시험): "**đang chơi**: ~하는 중이다→운행하는 중이다", "**ghé tới**: 들르다→비추다".
const stripMainArrow = (main) => {
    const m = main.match(/^(\s*\*\*.+?\*\*\s*:\s*)(.*)$/s);
    if (!m || !/[→←]/.test(m[2])) return main;
    const rest = m[2];
    const ws = rest.match(/\s*$/)[0];
    const kept = rest.includes('←') ? rest.slice(0, rest.indexOf('←')) : rest.slice(rest.lastIndexOf('→') + 1);
    return m[1] + kept.trim() + ws;
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
            if (!prev || /[:→←+·]/.test(prev)) return (sp ? ' ' : '') + content;
            return '·' + content;
        });
        if (next === inner) break;
        inner = next;
    }
    return main + '(' + inner + ')' + ws + tail;
}

// [표기 정리 안전망 — 2026-10, 실측: Circle K 182문장 저장본(2.5 Flash 분석 — 노란 줄 '전체 재분석'은 재분석 모델을 쓴다)] 규칙은 알지만 적는 모양이 틀린 것만 고친다.
// 뜻이 맞는지는 판단하지 않는다(틀린 소리 ♪·틀린 부품 뜻은 모델 지식 문제라 코드로 못 고침).
//  ① 같은 말 되풀이 ♪: "công viên: 공원·공원♪" → "공원♪", "thành công: 성공하다·성공♪" → "성공하다♪" (실측 18곳)
//     — '자연스러운 말·한자어♪'(규칙 5)는 두 말이 다를 때만 쓰는 모양이다.
//  ② 양쪽이 같은 화살표: "phi: 날다←날다" → "날다" (본뜻과 같으면 화살표가 무의미)
//  ⑤ [화면 전용, hideAddedNote] '뜻·한자어♪'의 덧붙인 한자어♪를 뗌: "느끼다·감수♪" → "느끼다" (2026-10-11)
//  ⑥ 덩어리 뜻 줄의 ♪는 지움: "**môi trường**: 환경·환경♪" → "환경" (♪는 괄호 안 단어 풀이 전용)
//  ④ 부품끼리 같은 말인 〈〉는 지움: "khó khăn: 어렵다〈어렵다·어렵다〉" → "어렵다" (2026-10-11)
//  ③ 〔⚡표현: 뜻〕 안의 꼬리표·여러 뜻: "〔⚡vãi chưởng: 존나/개–(강한 감탄·강조)〕" → "〔⚡vãi chưởng: 존나〕"
//     (괄호 꼬리표 제거 → '/' 나열은 첫 뜻만 → 끝의 ·슬랭/·비속어 제거)
// 옛 캐시에도 안전하다(v3엔 ♪·←가 없고, 옛 〔⚡실제: …(슬랭)〕은 꼬리표만 빠짐) — 그래서 표시 단계에서도 부른다.
const FLASH_LABEL = /\s*·\s*(슬랭|비속어|욕설|속어|은어|강조)\s*$/;
const tidyFlash = (tail) => tail.replace(/〔⚡([^:：〕]+)([:：])\s*([^〕]*)〕/g, (m, expr, colon, mean) => {
    let v = mean.replace(/\s*\([^()]*\)/g, '').split('/')[0].replace(FLASH_LABEL, '').replace(/[\s–—\-·]+$/, '').trim();
    return v ? `〔⚡${expr}${colon} ${v}〕` : m;
});
// ⑦ [화면 전용, fixArrows] 화살표 방향 바로잡기 (2026-10-20, 휴대폰 Circle K 캡처 4장에서 7개 실측).
//    규칙 C는 `이 문장의 뜻←사전 뜻`인데 모델(특히 재분석 모델 2.5 Flash)이 자주 어겼다. 저장본은 그대로 두고 보일 때만 고친다.
//    a) 옛 방향 `A→B`(사전 뜻→문맥 뜻) → `B←A`:  "Mấy hôm nay: 며칠 전→요즘" → "요즘←며칠 전"
//    b) 화살표 뒤가 뜻이 아니라 말투 설명이면 가운뎃점:  "vãi: 존나←강조 비속어" → "존나·강조 비속어", "luôn: 항상←강조" → "항상·강조"
//    c) 뒤쪽만 덩어리 뜻(굵은 청크 옆)에 들어 있으면 뒤집는다:  "Quay: 돌리다←찍다" + "영상을 찍을 때는" → "찍다←돌리다"
//       양쪽 다 있거나 다 없으면 판단하지 않고 그대로(맞는 것을 망치지 않게). 한국어 활용 때문에 낱말 끝 한 글자를 떼고 비교한다.
const ARROW_DESC = /^(강조\s*)?(비속어|욕설|속어|은어|강조|감탄사?|완곡|반말|존댓말|높임|낮춤|어감|말투|호격|부르는 말|의문|부정 강조|부정)(\s*표현)?$/;
const ONE_CHAR_COMMON = new Set(['가', '오', '하', '보', '되', '있', '없', '주', '이', '나', '들', '알', '먹', '사', '자', '쓰', '말', '받', '놓', '두']);
const wordKeys = (phrase) => phrase.split(/[\s·,~]+/).map(w => w.replace(/[^가-힣]/g, '')).filter(Boolean).map(w => {
    const k = w.replace(/다$/, '');
    return k.length >= 3 ? k.slice(0, -1) : k;
}).filter(k => k && !(k.length === 1 && ONE_CHAR_COMMON.has(k)));
const inMeaning = (phrase, meaning) => {
    const keys = wordKeys(phrase);
    return keys.length > 0 && keys.every(k => meaning.includes(k));
};
const fixArrow = (mean, mainMeaning) => {
    if (!mean.includes('←') && (mean.match(/→/g) || []).length === 1) {
        const [a, b] = mean.split('→').map(x => x.trim());
        if (a && b) mean = `${b}←${a}`;
    }
    const m = mean.match(/^(.+?)←(.+)$/);
    if (!m) return mean;
    const left = m[1].trim(), right = m[2].trim();
    if (ARROW_DESC.test(right)) return `${left}·${right}`;
    if (mainMeaning && inMeaning(right, mainMeaning) && !inMeaning(left, mainMeaning)) return `${right}←${left}`;
    return mean;
};
const tidyGloss = (part, hideAddedNote, fixArrows, mainMeaning) => {
    const m = part.match(/^(\s*[^:]+:\s*)(.*?)(\s*)$/s);
    if (!m) return part;
    let mean = m[2];
    if (fixArrows) mean = fixArrow(mean, mainMeaning);
    const arrow = mean.match(/^(.+?)←(.+)$/);
    if (arrow && arrow[1].trim() === arrow[2].trim()) mean = arrow[1].trim();
    const note = mean.match(/^(.*)·([^·]+)♪$/);
    if (note && note[1].trim().startsWith(note[2].trim())) mean = note[1].trim() + '♪';
    // ⑤ [화면 전용] 덧붙인 한자어♪ 떼기: "cảm thấy: 느끼다·감수♪" → "느끼다", "xuất hiện: 나타나다·출현♪" → "나타나다"
    //    AI가 자연스러운 뜻과 별도로 '소리 닮은 한자어'를 짐작해 덧붙인 모양이 틀린 ♪의 대부분이었다
    //    (Circle K 2.5 Flash 저장본: '뜻·한자어♪' 42개 중 약 22개가 틀린 소리·낯선 말, '한자어♪' 단독 12개는 전부 맞음).
    //    맞는 것(나타나다·출현♪)도 같이 빠지는 대가를 사용자가 알고 택함(2026-10-11). 저장본엔 남겨 두어 되돌릴 수 있게
    //    표시 단계(TranscriptItem·parseChunks)에서만 켠다 — stage2Parser는 끈 채로 부른다.
    //    같은 말 정리(①) 뒤에 이어서 적용 — "오락·해소·오락♪" → ① "오락·해소♪" → ⑤ "오락" (실측 giải trí, Flash)
    if (hideAddedNote) {
        const added = mean.match(/^(.*)·[^·]+♪$/);
        if (added && added[1].trim()) mean = added[1].trim();
    }
    // ④ 부품끼리 같은 말인 〈〉: "khó khăn: 어렵다〈어렵다·어렵다〉" → "어렵다", "màu sắc: 색깔〈색·색깔〉" → "색깔"
    //    (부품이 서로 같거나 한쪽이 다른 쪽에 들어 있으면 배울 게 없다. "닭다리〈다리·닭〉"처럼 부품이 다르면 그대로)
    const pm = mean.match(/^(.*?)〈([^〉]*)〉(.*)$/);
    if (pm) {
        const ps = pm[2].split('·').map(x => x.trim()).filter(Boolean);
        const same = ps.length >= 2 && ps.every(a => ps.every(b => a.includes(b) || b.includes(a)));
        if (same) mean = (pm[1] + pm[3]).trim();
    }
    return m[1] + mean + m[3];
};
// ⑥ 덩어리 뜻(굵은 청크 바로 뒤)의 ♪는 뗀다 — ♪는 괄호 안 단어 풀이 전용(규칙 5). 화살표(stripMainArrow)와 같은 취지.
//    실측(2026-10-11, 영상 1번 2.5 Flash 169문장 중 1줄): "**môi trường**: 환경·환경♪ (môi trường: 환경♪)" → "**môi trường**: 환경 (…)"
const stripMainNote = (main) => {
    const m = main.match(/^(\s*\*\*.+?\*\*\s*:\s*)(.*)$/s);
    if (!m || !m[2].includes('♪')) return main;
    return m[1] + m[2].replace(/·[^·\s()]+♪/g, '').replace(/♪/g, '');
};
export function tidyGlosses(line, { hideAddedNote = false, fixArrows = false } = {}) {
    const [rawMain, group, tail] = splitBreakdown(line);
    const main = stripMainNote(rawMain);
    const t = tail ? tidyFlash(tail) : tail;
    if (!group) return main + t;
    const g = group.replace(/\s+$/, '');
    const ws = group.slice(g.length);
    const mainMeaning = (main.match(/\*\*.+?\*\*\s*:\s*(.*)$/s) || [])[1] || '';
    const inner = g.slice(1, -1).split(/(\s\+\s)/).map((x, i) => (i % 2 ? x : tidyGloss(x, hideAddedNote, fixArrows, mainMeaning))).join('');
    return main + '(' + inner + ')' + ws + t;
}

export function parseChunks(item) {
    if (!item || !item.isAnalyzed || typeof item.analysis !== 'string') return [];
    return item.analysis.split('\n')
        .map(raw => {
            // 혹시 남아있을 수 있는 [분석]/분석] 접두 제거
            const line = tidyGlosses(raw.replace(/^\s*\[?\s*분석\s*\]?\s*/, ''), { hideAddedNote: true, fixArrows: true });
            const m = line.match(/^\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/);
            if (!m) return null;
            const chunk = m[1].trim();
            if (!chunk) return null;
            const meaning = (m[2] || '').replace(/\\n/g, ' ').replace(/\s*〔💡[^〕]*〕/g, '').trim();
            return { chunk, meaning };
        })
        .filter(Boolean);
}
