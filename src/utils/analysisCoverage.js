import { parseChunks } from './analysisParser';

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

/**
 * @returns {null | { kind: 'no-chunks' } | { kind: 'coverage', missing: string[], overlong: string[] }}
 *  null = 통과(또는 검사 대상 아님). missing = 청크 분석에 안 들어간 원문 단어(중복 제거).
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
    //  ② 8단어 이상 청크. 규칙 13의 문구는 '5단어 초과 금지'지만 프롬프트의 공식 작성 예시
    //     자체에 7단어 청크(để mình búng tay nó xuất hiện)가 있어, 그 기준으로 잡으면
    //     예시를 충실히 따른 정상 출력까지 오탐된다. 예시 최대치(7)+1부터 뭉침으로 본다.
    //  ③ 예외: 숫자 발음 병기가 든 청크는 길이 검사 제외 — 'sáu trăm chín mươi nghìn(690.000)'처럼
    //     숫자 하나의 낭독이 단어 5개로 세어져 정상 청크가 8단어를 넘기 일쑤다(규칙 6·12가
    //     병기 보존을 강제하므로 이 부풀림은 위반이 아니라 규칙 준수의 결과).
    const wholeSentence = chunks.length === 1 && textWords.length >= 6;
    const HAS_NUM_NOTATION = /\([\d.,%/\s]+\)/;
    const overlong = wholeSentence
        ? [chunks[0].chunk]
        : chunks.map(c => c.chunk).filter(c => !HAS_NUM_NOTATION.test(c) && normWords(c).length > 7);

    if (missing.length === 0 && overlong.length === 0) return null;
    return { kind: 'coverage', missing, overlong };
}

/** 배지 title용 요약문 (탭 안내 포함) */
export function coverageTitle(cov) {
    if (!cov) return '';
    if (cov.kind === 'no-chunks') return '분석 형식이 깨져 청크를 읽을 수 없어요 — 탭하면 이 문장만 재분석';
    const parts = [];
    if (cov.missing.length > 0) parts.push(`분석에서 빠진 단어: ${cov.missing.join(', ')}`);
    if (cov.overlong.length > 0) parts.push(`5단어 초과 뭉친 청크 ${cov.overlong.length}개`);
    return `${parts.join(' · ')} — 탭하면 이 문장만 재분석`;
}
