// 한 줄 안 반복 축약(analyzeIntraLineRepetition) — 1단계 전사 줄 파서가 줄마다 부른다.
// 실측 원문은 2026-10-31 정확도 시험(영상 5개 × Flash·Pro) 응답 그대로. 앞 숫자는 영상_회차 · 모델 시각(초).
import { describe, it, expect } from 'vitest';
import { analyzeIntraLineRepetition } from '../languageUtils';

const refine = (s) => analyzeIntraLineRepetition(s).refined_text;

describe('한 줄 안 반복 축약 — 끝 부호 보존', () => {
    // 예전엔 버린 마지막 단위에 붙어 있던 마침표·물음표가 함께 사라졌다("Kết thúc, kết thúc,").
    it('3번 이상 이어진 말은 2번으로 줄이되, 버린 단위의 끝 부호를 남긴 단위로 옮긴다', () => {
        expect(refine('Kết thúc, kết thúc, kết thúc.')).toBe('Kết thúc, kết thúc.'); // v4_flash4 556.2
        expect(refine('Kết thúc kết thúc kết thúc.')).toBe('Kết thúc kết thúc.');     // v4_flash1 556.3
        expect(refine('Trả trả trả.')).toBe('Trả trả.');                              // g1_flash1 102.2
        expect(refine('Trả, trả, trả.')).toBe('Trả, trả.');                           // g1_flash3 102.3
        expect(refine('Yeah yeah yeah.')).toBe('Yeah yeah.');                         // v1_flash2 383.7
        expect(refine('Happy happy new year, new year, new year.')).toBe('Happy happy new year, new year.'); // s1_flash1 13.2
    });

    it('반복이 문장 중간이면 남긴 단위의 쉼표만 떼고 뒷말에 그대로 잇는다', () => {
        expect(refine('Màu gì, màu gì, màu gì đây?')).toBe('Màu gì, màu gì đây?');   // v4_flash1 388.5 (예전 "Màu gì, màu gì, đây?")
        expect(refine('Màu gì màu gì màu gì đây?')).toBe('Màu gì màu gì đây?');       // v4_flash3 388.4
        expect(refine('Cứ lầm lầm lầm lầm lì lì lì.')).toBe('Cứ lầm lầm lì lì.');      // g1_flash2 614.04
        expect(refine('Cứ lầm lầm lầm lầm lì lì đi.')).toBe('Cứ lầm lầm lì lì đi.');   // g1_flash1 614
        expect(refine('Thế có cái chuyện gì thì anh cứ nói với em làm sao mà anh cứ phải im im im thế.'))
            .toBe('Thế có cái chuyện gì thì anh cứ nói với em làm sao mà anh cứ phải im im thế.'); // g1_flash1 606.3
    });

    it('부호 없이 끝난 반복은 부호를 지어내지 않는다', () => {
        expect(refine('Happy Happy New Year New Year New Year')).toBe('Happy Happy New Year New Year'); // s1_flash2 12.8
        expect(refine('New Year New Year New Year')).toBe('New Year New Year');                         // s1_flash3 14.07
    });

    // 줄이는 횟수는 그대로 — 환각 반복(같은 말 수십 번)을 막는 보호는 바뀌지 않았다
    it('긴 반복은 예전처럼 2번만 남긴다', () => {
        expect(refine('Đi đi đi đi đi đi đi đi đi đi đi.')).toBe('Đi đi.');                 // t1_flash4 82.2
        expect(refine('Tăng tăng tăng tăng tăng tăng tăng tăng tăng tăng tăng tăng tăng tăng tăng.')).toBe('Tăng tăng.'); // s1_flash3 217.23
        expect(refine('Tằng tắng tắng tằng tằng tằng.')).toBe('Tằng tắng tắng tằng tằng.'); // s1_pro1 95.03 (성조가 다르면 다른 말)
        expect(analyzeIntraLineRepetition('Trả trả trả.').status).toBe('TRUNCATED');
        expect(analyzeIntraLineRepetition('Trả trả.').status).toBe('PASS');
    });

    it('2000자를 넘는 거대 반복 줄은 예전처럼 막는다', () => {
        const giant = Array.from({ length: 400 }, (_, i) => `từ${i}`).join(' ') + '.';
        expect(analyzeIntraLineRepetition(giant).status).toBe('BLOCKED');
    });
});
