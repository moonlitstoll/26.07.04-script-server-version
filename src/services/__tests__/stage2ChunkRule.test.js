// 규칙 13(의미 청크 나누기) — 2026-11-23 '숫자 맞추기'에서 '뜻 단위'로 바꿈.
// 휴대폰 대본 200문장 판정: 옛 규칙(2~4단어씩, 5단어 초과 금지, 최소 ⌈단어수÷4⌉청크)은 영어 73%·베트남어 65%를
// 동사|목적어·전치사|명사 사이에서 잘랐다. 새 규칙(수정판 C)은 같은 문장에서 정상 89%·87%.
// 지시문 글이 되돌아가지 않게 핵심 문구만 단정한다(모델 결과는 테스트로 못 잡는다).
import { describe, it, expect } from 'vitest';
import { STAGE2_BATCH_PROMPT } from '../prompts';

describe('규칙 13 — 뜻 단위 청크', () => {
    it('옛 숫자 규칙이 없다', () => {
        expect(STAGE2_BATCH_PROMPT).not.toContain('⌈단어수÷4⌉');
        expect(STAGE2_BATCH_PROMPT).not.toContain('2~4단어씩');
        expect(STAGE2_BATCH_PROMPT).not.toContain('5단어를 넘기지');
    });

    it('자르면 안 되는 곳·자르는 곳·크기 상한이 있다', () => {
        expect(STAGE2_BATCH_PROMPT).toContain('자르면 안 되는 곳');
        expect(STAGE2_BATCH_PROMPT).toContain('자르는 곳');
        expect(STAGE2_BATCH_PROMPT).toContain('10단어(베트남어 12음절)를 넘으면');
        expect(STAGE2_BATCH_PROMPT).toContain('절 하나뿐인 9단어 이하 문장은 통째로 한 청크여도 됩니다');
    });

    it('작성 예시도 동사와 목적어를 가르지 않는다', () => {
        expect(STAGE2_BATCH_PROMPT).toContain('[분석] **Mình có thêm một đứa bạn nữa**:');
        expect(STAGE2_BATCH_PROMPT).not.toContain('[분석] **Mình có thêm**:');
        expect(STAGE2_BATCH_PROMPT).toContain('[분석] **Hiện tại mình đang ở Hải Phòng**:');
    });

    it('예시 문장은 시험 문장(휴대폰 대본)과 겹치지 않는 지어낸 문장이다', () => {
        // 시험에 쓴 사용자 캡처 문장이 예시로 들어가면 다음 시험이 오염된다
        expect(STAGE2_BATCH_PROMPT).not.toContain('I am flattered');
        expect(STAGE2_BATCH_PROMPT).not.toContain('sway my opinion');
    });
});
