import { describe, it, expect } from 'vitest';
import { planSpeechEndParts, runSpeechEndParts, SPEECH_PART_MAX, SPEECH_PART_PAD } from '../speechEndParts';

// 2초 간격 문장 n개 (다음 대사 시작 = 다음 문장 시작, 마지막은 null)
const mk = (n, step = 2, t0 = 10) => Array.from({ length: n }, (_, i) => ({
    index: i, seconds: t0 + i * step, text: `s${i}`, nextStart: i + 1 < n ? t0 + (i + 1) * step : null,
}));

describe('planSpeechEndParts', () => {
    it('130개 이하는 나누지 않는다', () => {
        expect(planSpeechEndParts(mk(130), 400)).toBeNull();
        expect(planSpeechEndParts(mk(1), 400)).toBeNull();
    });

    it('524문장(실측 28분)은 105개 안팎 5조각, 문장 빠짐·겹침 없음', () => {
        const parts = planSpeechEndParts(mk(524), 2000);
        expect(parts.map(p => p.items.length)).toEqual([105, 105, 105, 105, 104]);
        const all = parts.flatMap(p => p.items.map(it => it.index));
        expect(all).toEqual(Array.from({ length: 524 }, (_, i) => i));
    });

    it('131문장은 66+65로 고르게 (130+1로 나누지 않음)', () => {
        expect(planSpeechEndParts(mk(131), 400).map(p => p.items.length)).toEqual([66, 65]);
    });

    it('조각 구간 = 첫 문장 1.5초 앞 ~ 마지막 문장의 다음 대사 시작 1.5초 뒤, 문장 시각은 조각 기준', () => {
        const parts = planSpeechEndParts(mk(200), 1000); // 100 + 100
        const p1 = parts[1]; // 문장 100~199, 시작 210초
        expect(p1.winStart).toBe(210 - SPEECH_PART_PAD);
        // 마지막 문장(199, 408초)은 다음 대사가 없음 → 영상 끝(1000)과 시작+60초(468) 중 이른 쪽 + 1.5
        expect(p1.winStart + p1.winDur).toBeCloseTo(469.5, 5);
        expect(p1.items[0]).toEqual({ index: 100, seconds: 1.5, text: 's100' });
        const p0 = parts[0]; // 마지막 문장 99(208초)의 다음 대사 210초 + 1.5
        expect(p0.winStart).toBe(10 - SPEECH_PART_PAD);
        expect(p0.winStart + p0.winDur).toBeCloseTo(211.5, 5);
    });

    it('영상 길이를 넘지 않고, 0초보다 앞으로 가지 않는다', () => {
        const s = mk(140, 2, 0.5); // 첫 문장 0.5초
        const parts = planSpeechEndParts(s, 250);
        expect(parts[0].winStart).toBe(0);
        expect(parts[0].items[0].seconds).toBe(0.5);
        const last = parts[parts.length - 1];
        expect(last.winStart + last.winDur).toBe(250);
    });

    it('다음 대사가 70초 뒤여도 구간은 시작+60초까지만 (병합 상한과 같게)', () => {
        const s = mk(140);
        s[139] = { ...s[139], nextStart: null };
        s[69] = { ...s[69], nextStart: s[69].seconds + 70 };
        const parts = planSpeechEndParts(s, 0); // 길이 모름
        expect(parts[0].winStart + parts[0].winDur).toBeCloseTo(s[69].seconds + 60 + SPEECH_PART_PAD, 5);
    });
});

describe('runSpeechEndParts', () => {
    const parts = [
        { winStart: 100, winDur: 50, items: [{ index: 0, seconds: 1, text: 'a' }, { index: 1, seconds: 5, text: 'b' }] },
        { winStart: 300, winDur: 50, items: [{ index: 2, seconds: 1, text: 'c' }, { index: 3, seconds: 5, text: 'd' }] },
    ];

    it('조각 기준 시각에 조각 시작을 더해 되돌린다', async () => {
        const out = await runSpeechEndParts(parts, async (p) => new Map(p.items.map(it => [it.index, it.seconds + 1])));
        expect([...out]).toEqual([[0, 102], [1, 106], [2, 302], [3, 306]]);
        expect(out.failedIndices.size).toBe(0);
    });

    it('조각에 넣지 않은 번호로 온 답은 버린다(모델이 0,1로 다시 매긴 경우)', async () => {
        const out = await runSpeechEndParts(parts, async (p) => p.winStart === 300 ? new Map([[0, 2], [1, 6], [3, 9]]) : new Map([[0, 2]]));
        expect(out.get(0)).toBe(102);
        expect(out.get(1)).toBeUndefined();
        expect(out.get(3)).toBe(309);
    });

    it('답은 왔는데 조각 번호가 하나도 없으면(0부터 다시 매김) 그 조각은 실패로 친다', async () => {
        const out = await runSpeechEndParts(parts, async (p) => p.winStart === 300 ? new Map([[0, 2], [1, 6]]) : new Map([[0, 2], [1, 6]]));
        expect([...out.keys()]).toEqual([0, 1]);
        expect([...out.failedIndices].sort()).toEqual([2, 3]);
    });

    it('한 조각이 실패하면 그 문장만 failedIndices, 나머지는 살린다', async () => {
        const out = await runSpeechEndParts(parts, async (p) => {
            if (p.winStart === 300) throw new Error('503');
            return new Map([[0, 2], [1, 6]]);
        });
        expect([...out.keys()]).toEqual([0, 1]);
        expect([...out.failedIndices].sort()).toEqual([2, 3]);
    });

    it('모든 조각이 실패하면 오류를 던진다', async () => {
        await expect(runSpeechEndParts(parts, async () => { throw new Error('키 오류'); })).rejects.toThrow('키 오류');
    });

    it('사용자 취소는 그대로 던진다', async () => {
        await expect(runSpeechEndParts(parts, async () => { throw new DOMException('Aborted', 'AbortError'); }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });

    it('동시에 2조각까지만 보낸다', async () => {
        let now = 0, peak = 0;
        const many = Array.from({ length: 5 }, (_, k) => ({ winStart: k * 100, winDur: 50, items: [{ index: k, seconds: 1, text: 'x' }] }));
        await runSpeechEndParts(many, async (p) => {
            now++; peak = Math.max(peak, now);
            await new Promise(r => setTimeout(r, 5));
            now--;
            return new Map([[p.items[0].index, 2]]);
        });
        expect(peak).toBe(2);
    });

    it('상한 값은 130', () => { expect(SPEECH_PART_MAX).toBe(130); });
});
