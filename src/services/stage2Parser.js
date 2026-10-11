// Stage 2 배치 응답 파서 (순수 함수 — 단위 테스트 대상).
// analyzeBatchSentences(gemini.js) 안의 인라인 클로저에서 분리했다. 경계 계산을 한 곳에 모아
// 테스트로 지킬 수 있게 한 것 — speechSegments.js와 같은 '순수 유틸 분리' 방침.
//
// 모델은 [분석대상] 문장마다 다음 형식으로 응답한다:
//   --- [INDEX: N] START ---
//   [번역] ...
//   [분석] 청크: 뜻
//   [분석] 청크: 뜻
//   --- [INDEX: N] END ---
// 각 INDEX의 START~END 사이에서만 그 문장의 [번역]/[분석]/[전사의심]을 뽑는다.
//
// [버그 수정 — 끝 경계를 '다음 문장 START'로도 clamp]
// 예전엔 한 문장의 끝을 '자기 END 마커' 위치로만 잡았다(text.indexOf(endMarker)).
// 그런데 모델이 END 마커를 제 블록 바로 뒤가 아니라 응답 끝쪽에 몰아서 출력하면(실측된 이탈),
// 자기 END가 뒤 문장들 블록 '너머'에 있어서 substring 구간이 뒤 문장까지 삼키고
// matchAll(/\[분석\]/g)이 그들의 [분석] 줄을 전부 긁어왔다.
// → 문장 카드마다 다음 문장들의 분석이 줄줄이 누적(S1⊃S2⊃S3…). 이제 끝을 '자기 END'와
//   '바로 다음 문장 START' 중 먼저 오는 쪽으로 잘라, 마커가 밀려도 뒤 문장을 삼키지 않는다.
// 정상 응답에선 다음 START가 자기 END '바로 뒤'라 min이 자기 END를 고르고, 그 사이엔 [분석] 줄이
// 없으므로 결과가 기존과 완전히 동일하다(회귀 없음).
//
// failed 판정은 기존 그대로: 자기 START나 자기 END 마커가 아예 없으면 실패(빈 분석).
// (출력이 토큰 상한에 잘려 뒤쪽 마커가 통째로 유실된 경우를 재시도로 넘기는 안전망 — 유지.)

import { flattenNestedParens, tidyGlosses } from '../utils/analysisParser';

// 분석 청크 앞에 붙는 접두어(청크:/분석: 등)를 벗겨 순수 '원어: 뜻'만 남긴다.
export const ANALYSIS_PREFIX_STRIP = /^(청크|Analysis|분석|•|청크:|\[분석\])[:\s-]*/i;

// 굵은 청크에 글자·숫자가 하나도 없는 줄(구두점만) 판정. 굵은 청크가 없는 줄은 건드리지 않는다.
const isPunctOnlyChunk = (line) => {
    const m = line.match(/^\s*\*\*(.+?)\*\*/);
    return !!m && !/[\p{L}\p{N}]/u.test(m[1]);
};

// 어느 INDEX든 문장 시작 마커. 다음 문장 경계(끝 clamp)를 찾는 데 쓴다.
const START_MARKER_RE = /--- \[INDEX: \d+\] START ---/g;

export const parseStage2Response = (text, items) => {
    const src = typeof text === 'string' ? text : '';
    if (!Array.isArray(items)) return [];

    // 응답 안 모든 문장 START 마커의 위치(오름차순). '다음 문장 START'를 O(1) 근처로 찾기 위함.
    const startPositions = [...src.matchAll(START_MARKER_RE)].map(m => m.index);
    const nextStartAfter = (pos) => {
        let best = Infinity;
        for (const p of startPositions) if (p > pos && p < best) best = p;
        return best;
    };

    const results = [];
    for (const item of items) {
        const startMarker = `--- [INDEX: ${item.index}] START ---`;
        const endMarker = `--- [INDEX: ${item.index}] END ---`;

        const startIndex = src.indexOf(startMarker);
        const endIndex = src.indexOf(endMarker);

        if (startIndex !== -1 && endIndex !== -1) {
            // 끝 경계: 자기 END(자기 START 뒤에 있을 때만 유효)와 '다음 문장 START' 중 먼저 오는 것.
            const ownEnd = endIndex > startIndex ? endIndex : Infinity;
            const end = Math.min(ownEnd, nextStartAfter(startIndex), src.length);
            const subText = src.substring(startIndex + startMarker.length, end);

            const translationMatch = subText.match(/\[번역\]\s*(.*)/);
            // 구두점만인 청크 줄(`**?**: ?`, `**,**: ,`)은 버린다 — 2.5 Flash Lite 실측 이탈(42묶음 중 9문장).
            // 규칙 13에 금지를 넣어 0이 됐지만, 다시 나와도 저장·화면에 남지 않게 하는 안전망.
            const analysisLines = [...subText.matchAll(/\[분석\]\s*(.*)/g)]
                .map(m => tidyGlosses(flattenNestedParens(m[1].replace(ANALYSIS_PREFIX_STRIP, '').trim())))
                .filter(line => !isPunctOnlyChunk(line));
            // [전사의심] (규칙 15, 선택 출력): 문맥상 오전사가 의심될 때만 모델이 남기는 한 줄.
            // 없으면 빈 문자열 — 이 줄이 없는 응답/옛 캐시와 완전 호환.
            const suspectMatch = subText.match(/\[전사의심\]\s*(.*)/);

            results.push({
                index: item.index,
                translation: translationMatch ? translationMatch[1].trim() : "",
                analysis: analysisLines.join("\n").trim(),
                transcriptSuspect: suspectMatch ? suspectMatch[1].trim() : ""
            });
        } else {
            console.warn(`[Stage 2] Could not find markers for index ${item.index}`);
            results.push({ index: item.index, translation: "", analysis: "", failed: true });
        }
    }
    return results;
};
