// 청크가 문장 전체를 덮어도 초록 원문을 숨기지 않는다 (2026-11-23 사용자 요청).
// 카드는 브라우저 컴포넌트라 여기서 그려 볼 수 없어 소스 글자로 단정한다 — 숨김 함수를 다시 넣으면 여기서 걸린다.
// 배경: 예전 '문장 전체 반복 볼드 지우기'(80% 이상 덮으면 **원문**: 을 떼고 뜻만)가 규칙 13(뜻 단위, 절 하나 문장은 1청크 허용) 뒤로
// 새 분석 문장의 22%에서 초록을 지워, 휴대폰에서 "Ok, let's get right into it" 같은 문장이 뜻만 남아 오류처럼 보였다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { splitBreakdown, tidyGlosses } from '../../utils/analysisParser.js';

const src = readFileSync(fileURLToPath(new URL('../TranscriptItem.jsx', import.meta.url)), 'utf8');

describe('분석 칸의 초록 원문', () => {
    it('분석 줄을 만들 때 문장 글자(item.text)와 견주어 지우지 않는다', () => {
        const body = src.slice(src.indexOf('const analysisLines'), src.indexOf('const hasBreakdown'));
        expect(body).toMatch(/stripPatternTags\(item\.analysis\)/);
        expect(body).not.toMatch(/item\.text/);
        expect(src).not.toMatch(/dedupeSentenceInAnalysis\s*=/);
    });
    it('문장 통째 한 청크 줄도 표시용 정리를 거친 뒤 **원문**이 남는다', () => {
        const line = "**Ok, let's get right into it**: 좋아, 바로 시작하자 (Ok: 좋아 + let's: ~하자 + get into: 들어가다 + right: 바로 + it: 그것)";
        const [main] = splitBreakdown(tidyGlosses(line, { hideAddedNote: true, fixArrows: true }));
        expect(main).toMatch(/^\*\*Ok, let's get right into it\*\*/);
    });
});
