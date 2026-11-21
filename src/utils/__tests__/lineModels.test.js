import { describe, it, expect } from 'vitest';
import { pickLineModels, batchesByModel, stampCarry, usableCarry } from '../lineModels';
import { lineKey } from '../liveMerge';

const line = (seconds, text, extra = {}) => ({ seconds, text, ...extra });

describe('pickLineModels — 문장별 분석 모델', () => {
    const T = [line(1, 'a'), line(2, 'b'), line(3, 'c'), line(4, 'd')];

    it('앞 분석이 남긴 것이 없으면 전부 이번 모델', () => {
        const m = pickLineModels(T, [0, 1, 2, 3], null, 'flash');
        expect([...m.values()]).toEqual(['flash', 'flash', 'flash', 'flash']);
    });

    it('앞 분석이 못 끝낸 문장은 그 모델을 이어 쓰고, 새로 맡은 문장만 이번 모델', () => {
        // 첫 분석(lite)이 b·c·d를 못 끝낸 채 중단, 사용자가 a를 다시 전사 → 재분석 모델(pro)로 시작
        const carry = new Map([[lineKey(T[1]), 'lite'], [lineKey(T[2]), 'lite'], [lineKey(T[3]), 'lite']]);
        const next = [line(1, 'a 고침'), T[1], T[2], T[3]];
        const m = pickLineModels(next, [0, 1, 2, 3], carry, 'pro');
        expect(m.get(lineKey(next[0]))).toBe('pro');
        expect([m.get(lineKey(T[1])), m.get(lineKey(T[2])), m.get(lineKey(T[3]))]).toEqual(['lite', 'lite', 'lite']);
    });

    it('앞 분석이 끝낸 문장(기억에서 지워짐)을 다시 분석하라고 하면 이번 모델', () => {
        const carry = new Map([[lineKey(T[2]), 'lite']]); // b는 끝나서 지워졌다
        const m = pickLineModels(T, [1, 2], carry, 'pro');
        expect(m.get(lineKey(T[1]))).toBe('pro');
        expect(m.get(lineKey(T[2]))).toBe('lite');
    });

    it('글자가 바뀐 문장은 새 문장으로 본다', () => {
        const carry = new Map([[lineKey(T[1]), 'lite']]);
        const next = [T[0], line(2, 'b 고침')];
        expect(pickLineModels(next, [1], carry, 'pro').get(lineKey(next[1]))).toBe('pro');
    });

    it('맡은 문장만 담는다(대본에 없는 번호는 건너뜀)', () => {
        const m = pickLineModels(T, [1, 9], null, 'flash');
        expect(m.size).toBe(1);
    });
});

describe('batchesByModel — 모델별 묶음', () => {
    const modelOf = (i) => (i === 0 ? 'pro' : 'lite');

    it('모델이 하나면 예전처럼 순서대로 size개씩', () => {
        const b = batchesByModel([0, 1, 2, 3, 4], () => 'flash', 2, 'flash');
        expect(b.map(x => [...x])).toEqual([[0, 1], [2, 3], [4]]);
        expect(b.every(x => x.model === 'flash')).toBe(true);
    });

    it('모델이 섞이면 한 묶음에 한 모델만, 이번 모델 묶음이 먼저', () => {
        const b = batchesByModel([1, 2, 0, 3], modelOf, 25, 'pro');
        expect(b.map(x => [x.model, [...x]])).toEqual([['pro', [0]], ['lite', [1, 2, 3]]]);
    });

    it('이번 모델의 문장이 하나도 없으면 빈 묶음을 만들지 않는다', () => {
        const b = batchesByModel([1, 2], modelOf, 25, 'pro');
        expect(b.map(x => [x.model, [...x]])).toEqual([['lite', [1, 2]]]);
    });

    it('빈 목록이면 묶음 없음', () => {
        expect(batchesByModel([], modelOf, 25, 'pro')).toEqual([]);
    });
});

describe('모델 기억은 설정이 그대로일 때만 쓴다', () => {
    const T = [line(1, 'a'), line(2, 'b')];
    const made = stampCarry(pickLineModels(T, [0, 1], null, 'pro'), 'lite|pro|1');

    it('설정이 같으면 기억을 쓴다 → 끊긴 문장은 그때 모델 그대로', () => {
        const m = pickLineModels(T, [0, 1], usableCarry(made, 'lite|pro|1'), 'lite');
        expect([...m.values()]).toEqual(['pro', 'pro']);
    });

    it('끊긴 뒤 모델 설정을 바꿨으면 기억을 버린다 → 지금 모델', () => {
        const m = pickLineModels(T, [0, 1], usableCarry(made, 'lite|flash|1'), 'flash');
        expect([...m.values()]).toEqual(['flash', 'flash']);
    });

    it('Claude 키를 지웠어도 기억을 버린다', () => {
        expect(usableCarry(made, 'lite|pro|0')).toBe(null);
    });

    it('기억이 없거나 설정 표시가 없는 기억은 쓰지 않는다', () => {
        expect(usableCarry(undefined, 'x')).toBe(null);
        expect(usableCarry(new Map([['k', 'pro']]), 'x')).toBe(null);
    });

    it('설정 표시를 붙여도 문장별 모델은 그대로 담긴다', () => {
        expect(made.get(lineKey(T[0]))).toBe('pro');
        expect(made.size).toBe(2);
    });
});
