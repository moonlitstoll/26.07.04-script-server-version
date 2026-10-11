import { parseChunks, splitBreakdown } from './analysisParser';

// 분석 커버리지 자동 검사 (API 비용 0 — 이미 받은 분석을 코드로만 대조).
// Stage 2 규칙 위반을 감지한다:
//  - 규칙 9(문장 전수 분석): 원문 단어가 청크 분석에 빠짐없이 들어갔는가
//  - 규칙 13(뭉침 금지): 한 청크가 5단어를 초과하지 않는가
//  - 형식 깨짐: 분석됐다는데 파싱되는 청크가 0개
// 캐시된 옛 분석에도 소급 적용된다(표시 단계에서 매번 계산).
//
// 비교 규칙: 소문자化 + 구두점 제거 + 괄호 구간 제거.
//  괄호 제거 이유: 숫자·기호 발음 병기 `sáu trăm(690.000)`의 (원본) 부분은
//  '소리나는 말'이 아니라 표기 보조라, 원문/청크 중 한쪽에만 있어도 오탐이 된다.
const normWords = (t) => (t || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

// 뭉침 길이 검사용 '의미 단위' 개수. 대문자로 시작하는 음절이 이어지면 지명·이름 하나로 센다.
// 베트남어는 음절마다 띄어 써서 지명이 2칸으로 세어졌다 — 실측 오탐(휴대폰, 2026-10-09):
//  "đi từ Hải Phòng đến xã Bum Tở Lai Châu" = 10칸 → 뭉침 배지. 지명을 하나로 세면 6.
// 쉼표·마침표로 끝난 토큰 뒤에서는 끊는다("Hà Nội, Sài Gòn"은 둘). 문장 첫 단어 + 이름("Chú Hùng")은
// 하나로 세어지지만 경고가 덜 뜨는 쪽이라 둔다. 누락 검사(normWords)에는 쓰지 않는다.
const countMeaningUnits = (t) => {
    const toks = (t || '').replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean);
    let n = 0;
    let prevCap = false;
    for (const raw of toks) {
        const w = raw.replace(/[^\p{L}\p{N}]/gu, '');
        if (!w) { prevCap = false; continue; }
        const cap = /^\p{Lu}/u.test(w);
        if (!(cap && prevCap)) n++;
        prevCap = cap && !/[,.;:!?…]$/.test(raw);
    }
    return n;
};

/**
 * @returns {null | { kind: 'no-chunks' } | { kind: 'coverage', missing: string[], overlong: string[], oversplit: null | { punct: number, chunks: number, words: number } }}
 *  null = 통과(또는 검사 대상 아님). missing = 청크 분석에 안 들어간 원문 단어(중복 제거).
 *  oversplit = 과분할(2026-10): 구두점만인 청크(`**?**: ?`)가 있거나, 6청크 이상인데 청크당 평균 2.5음절 미만.
 *   기준 2.5의 근거: 규칙 13이 청크를 2~4단어로 두므로 평균 2.5 미만은 '거의 전부 2단어'. 실측 2.5 Flash 결과 278문장은
 *   2.8 미만도 0건, 2.5 Flash Lite 165문장은 2.5 미만 9건(2-단어 청크 나열) — Flash 오탐 없이 Lite 과분할만 잡힌다.
 *   실측(휴대폰, 2.5 Flash Lite): 33단어 문장이 18줄(`Cảm ơn` / `những con người` / `,` / …)로 쪼개짐.
 *   Lite로 42묶음을 돌리면 구두점 청크가 9/990 나왔다(규칙 추가 후 0). 7단어 문장이 4청크로 나뉜 정도는
 *   잡지 않는다(6청크 조건) — 그건 읽는 데 지장이 없고 배지 신뢰를 깎는다.
 */
export function checkAnalysisCoverage(item) {
    if (!item || !item.isAnalyzed || item.analysisFailed) return null;
    const chunks = parseChunks(item);
    if (chunks.length === 0) return { kind: 'no-chunks', missing: [], overlong: [] };

    const textWords = normWords(item.text);
    if (textWords.length === 0) return null;

    // 집합 비교(멀티셋 아님): 원문에 두 번 나온 단어를 청크가 한 번만 다뤄도 정상 처리
    // (모델이 반복 단어를 한 청크에서 함께 풀이하는 관행을 오탐하지 않기 위함)
    const chunkWordSet = new Set(chunks.flatMap(c => normWords(c.chunk)));
    const missing = [...new Set(textWords)].filter(w => !chunkWordSet.has(w));
    // 뭉침 판정 — 배지는 '확실한 위반'만 잡아야 신뢰를 유지한다:
    //  ① 문장 전체=1청크 (규칙 13이 명시한 절대 금지, 6단어 이상 문장에서)
    //  ② 10단어 이상 청크. 규칙 13의 문구는 '5단어 초과 금지'지만,
    //     - 프롬프트 공식 작성 예시 자체에 7단어 청크(để mình búng tay nó xuất hiện)가 있고
    //     - 베트남어는 띄어쓰기가 음절 단위라 겹단어(bứ bừ, chẩm chéo…)가 2칸으로 세어져
    //       실제 의미 단어 수보다 부풀려진다 (8칸 청크가 실제론 ~6단어인 사례 확인됨)
    //     → 심한 뭉침은 ①과 분석 시점의 60% 편중 자동재분할이 이미 잡으므로,
    //       길이 검사는 그 둘이 놓친 극단만 잡는 보조 그물로 10부터 본다.
    //  ③ 예외: 숫자 발음 병기가 든 청크는 길이 검사 제외 — 'sáu trăm chín mươi nghìn(690.000)'처럼
    //     숫자 하나의 낭독이 단어 5개로 세어져 정상 청크가 기준을 넘기 일쑤다(규칙 6·12가
    //     병기 보존을 강제하므로 이 부풀림은 위반이 아니라 규칙 준수의 결과).
    const wholeSentence = chunks.length === 1 && textWords.length >= 6;
    const HAS_NUM_NOTATION = /\([\d.,%/\s]+\)/;
    const overlong = wholeSentence
        ? [chunks[0].chunk]
        : chunks.map(c => c.chunk).filter(c => !HAS_NUM_NOTATION.test(c) && countMeaningUnits(c) > 9);

    const chunkLens = chunks.map(c => normWords(c.chunk).length);
    const punct = chunkLens.filter(n => n === 0).length;
    const tooFine = chunks.length >= 6 && textWords.length / chunks.length < 2.5; // 휴대폰 실측 33/16 = 2.06
    const oversplit = (punct > 0 || tooFine) ? { punct, chunks: chunks.length, words: textWords.length } : null;

    if (missing.length === 0 && overlong.length === 0 && !oversplit) return null;
    return { kind: 'coverage', missing, overlong, oversplit };
}

/** 분석에서 빠진 원문 단어 수. 분석 형식이 깨졌으면(청크 0) 원문 단어 수 전부. */
export function missingWordCount(text, analysis) {
    const cov = checkAnalysisCoverage({ text, analysis, isAnalyzed: !!analysis });
    if (!cov) return 0;
    if (cov.kind === 'no-chunks') return normWords(text).length;
    return cov.missing.length;
}

/**
 * [누락 재시도 채택 규칙] 빠진 단어가 있는 문장을 다시 요청한 결과를 받아들일지.
 *  - 빠진 단어가 줄었을 때만 (같거나 늘면 옛것 유지 — 퇴행 방지)
 *  - 단, 문장 전체가 1청크로 뭉친 결과는 거부 (빠진 단어 0이어도 규칙 13 위반 — 뭉침 재시도가 다시 돌게 됨)
 * 실측(2026-10, Circle K 165문장): 2.5 Flash가 청크 하나를 통째로 건너뛰는 문장이 실행마다 3~16%.
 */
export function shouldAdoptMissingRetry(text, prevAnalysis, nextAnalysis) {
    if (!nextAnalysis) return false;
    const nextChunks = parseChunks({ text, analysis: nextAnalysis, isAnalyzed: true });
    if (nextChunks.length === 0) return false;
    if (nextChunks.length === 1 && normWords(text).length >= 6) return false;
    return missingWordCount(text, nextAnalysis) < missingWordCount(text, prevAnalysis);
}

// ─────────────────────────────────────────────────────────────
// [뭉침 자동 재분할 판정] (2026-10-11, useMediaAnalysis 안에서 옮겨 옴 — 테스트 대상)
// 분석 직후 '뭉친' 문장을 강제 분할로 다시 요청할지 정한다. 화면 배지(checkAnalysisCoverage)와는 따로다.
// 옛 기준('가장 큰 청크의 단어 집합이 문장 단어의 60% 이상을 덮음')이 정상 분석을 대량으로 뭉침으로 봤다
// — 9회 실행 1차 분석 2,019문장 중 175개, 그중 137개가 정상:
//  ① 같은 말이 되풀이되는 문장: "Màu xanh, màu xanh, ôi màu xanh."의 `**Màu xanh**`(2단어)가 집합 비교로 86%
//  ② 규칙 13대로 2~4단어씩 나눈 짧은 문장: "Bắt tay vào làm / luôn nào"(6단어 중 4 = 67%)
//  ③ 숫자 병기가 단어로 세어짐: "Phải đến năm(5) phút rồi."(실제 5단어 → 6)
// 이런 문장을 3라운드 내내 다시 보냈고, '줄 수가 늘면 채택' 규칙 때문에 한 단어·구두점 청크로 쪼갠 답이
// 멀쩡한 분석을 덮어썼다(4번 영상 '풀이 없음' 줄 전부). 새 기준:
//  - 가장 큰 청크가 6단어 이상(규칙 13의 '5단어 초과 금지' 위반)이면서 문장의 60% 이상.
//    (문장 전체 = 1청크인 6단어 이상 문장도 여기에 든다 — 규칙 13의 절대 금지)
// 단어 수는 숫자 병기 괄호를 빼고 청크 안 단어를 그대로 센다(집합 비교 아님). 결과 175 → 38(새로 잡힌 것 0).
const unitCount = (t) => normWords(t).length;
const boldChunks = (analysis) => (analysis || '').match(/\*\*(.+?)\*\*/g) || [];

export function isLumpedAnalysis(sentence, analysis) {
    if (!analysis || !sentence) return false;
    const sw = unitCount(sentence);
    if (sw < 6) return false;
    const lens = boldChunks(analysis).map(unitCount).filter(n => n > 0);
    if (lens.length === 0) return false;
    const max = Math.max(...lens); // 문장 전체 = 1청크(6단어 이상)도 여기서 잡힌다
    return max >= 6 && max / sw >= 0.6;
}

// 단어 풀이 괄호가 없는 청크 줄 수
const glosslessLines = (analysis) => (analysis || '').split('\n')
    .filter(l => /^\s*\*\*/.test(l) && !splitBreakdown(l)[1]).length;
const largestChunk = (analysis) => Math.max(0, ...boldChunks(analysis).map(unitCount));

/**
 * [뭉침 재분할 채택 규칙] 강제 분할로 다시 받은 분석을 받아들일지.
 *  - 나빠진 게 없어야 한다: 풀이 없는 줄이 늘지 않고, 빠진 단어가 늘지 않고, 과분할(구두점 청크·잘게 쪼갬)이 새로 생기지 않음
 *  - 그리고 나아져야 한다: 더 이상 뭉침이 아니거나, 가장 큰 청크가 작아짐
 * 옛 규칙은 '뭉침이 풀렸거나 줄 수가 늘면' 채택이라, 문맥 없이 보낸 강제 분할 답이 `**,**`·한 단어 청크로
 * 줄 수만 늘려도 채택됐다(예 4번 6:41: 풀이 있던 `ôi màu xanh: 아, 파란색 (…)`이 `Màu xanh / , / màu xanh / , / ôi`로).
 */
export function shouldAdoptSplitRetry(text, prevAnalysis, nextAnalysis) {
    if (!nextAnalysis || parseChunks({ text, analysis: nextAnalysis, isAnalyzed: true }).length === 0) return false;
    if (glosslessLines(nextAnalysis) > glosslessLines(prevAnalysis)) return false;
    if (missingWordCount(text, nextAnalysis) > missingWordCount(text, prevAnalysis)) return false;
    const over = (a) => !!checkAnalysisCoverage({ text, analysis: a, isAnalyzed: true })?.oversplit;
    if (over(nextAnalysis) && !over(prevAnalysis)) return false;
    return !isLumpedAnalysis(text, nextAnalysis) || largestChunk(nextAnalysis) < largestChunk(prevAnalysis);
}

/** 배지 title용 요약문 (탭 안내 포함) */
export function coverageTitle(cov) {
    if (!cov) return '';
    if (cov.kind === 'no-chunks') return '분석 형식이 깨져 청크를 읽을 수 없어요 — 탭하면 이 문장만 재분석';
    const parts = [];
    if (cov.missing.length > 0) parts.push(`분석에서 빠진 단어: ${cov.missing.join(', ')}`);
    if (cov.overlong.length > 0) parts.push(`5단어 초과 뭉친 청크 ${cov.overlong.length}개`);
    if (cov.oversplit) parts.push(cov.oversplit.punct > 0
        ? `구두점만 있는 청크 ${cov.oversplit.punct}개`
        : `너무 잘게 쪼개짐 (${cov.oversplit.words}단어를 ${cov.oversplit.chunks}청크로)`);
    return `${parts.join(' · ')} — 탭하면 이 문장만 재분석`;
}
