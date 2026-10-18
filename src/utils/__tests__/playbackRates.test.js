import { describe, it, expect } from 'vitest';
import { clampRate, stepRate, fmtRate, RATE_PRESETS, RATE_MIN, RATE_MAX } from '../playbackRates';

describe('playbackRates — 배속 범위·단계·표시', () => {
    it('범위는 예전 16칸 격자와 같은 0.5~2.0', () => {
        expect(RATE_MIN).toBe(0.5);
        expect(RATE_MAX).toBe(2.0);
        expect(clampRate(0.3)).toBe(0.5);
        expect(clampRate(2.7)).toBe(2.0);
        expect(clampRate('abc')).toBe(1.0); // 저장값이 깨졌을 때
    });
    it('−/+는 0.1씩, 끝에서 멈춘다 (부동소수 오차 없이)', () => {
        expect(stepRate(1.0, +1)).toBe(1.1);
        expect(stepRate(1.1, +1)).toBe(1.2);   // 1.1+0.1 = 1.2000000000000002 가 아니라 1.2
        expect(stepRate(0.5, -1)).toBe(0.5);
        expect(stepRate(2.0, +1)).toBe(2.0);
        expect(stepRate(0.75, +1)).toBe(0.85); // 격자 밖 값도 그냥 0.1
    });
    it('프리셋은 전부 범위 안이고 1.0을 포함', () => {
        expect(RATE_PRESETS).toContain(1.0);
        RATE_PRESETS.forEach(r => expect(clampRate(r)).toBe(r));
    });
    it('표시는 끝 0을 뗀다', () => {
        expect(fmtRate(1)).toBe('1x');
        expect(fmtRate(0.75)).toBe('0.75x');
        expect(fmtRate(1.5)).toBe('1.5x');
        expect(fmtRate(1.1 + 0.1)).toBe('1.2x');
    });
});
