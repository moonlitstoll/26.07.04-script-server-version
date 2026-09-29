import { describe, it, expect } from 'vitest';
import { selectSpeechEndTargets, withNextStarts, mergeSpeechEnds } from '../speechEndMerge';

const S = (seconds, text, extra = {}) => ({ seconds, text, ...extra });

describe('감지 요청할 문장 고르기', () => {
    const data = [
        S(10, 'a', { speechEnd: 12 }),          // 감지됨
        S(15, 'b'),                              // 미감지
        S(20, 'c', { speechEndSkipped: true }),  // 이미 시도했는데 판단 불가
        S(25, 'd1', { speechEnd: 26 }),          // 같은 시각 형제(분할된 한 덩어리)
        S(25, 'd2'),
        S(30, 'e'),
    ];

    it('전체: 모든 문장', () => {
        const r = selectSpeechEndTargets(data);
        expect(r.sentences.map(s => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(r.selective).toBe(false);
    });

    it('빠진 것만: 감지된 문장과 포기 표시된 문장은 뺀다(반복 요청은 비용만 든다)', () => {
        expect(selectSpeechEndTargets(data, { onlyMissing: true }).sentences.map(s => s.index)).toEqual([1, 4, 5]);
    });

    it('선택 재감지: 이미 감지됐어도 포함하고, 같은 시각 형제까지 넓힌다', () => {
        const r = selectSpeechEndTargets(data, { indices: [3] });
        expect(r.sentences.map(s => s.index)).toEqual([3, 4]);
        expect(r.selective).toBe(true);
        // onlyMissing이 같이 와도 선택이 우선
        expect(selectSpeechEndTargets(data, { indices: new Set([0]), onlyMissing: true }).sentences.map(s => s.index)).toEqual([0]);
    });

    it('다음 대사 시작 = 자기보다 시각이 큰 첫 문장(형제는 건너뜀), 마지막은 null', () => {
        const r = withNextStarts(data, [{ index: 3, seconds: 25 }, { index: 5, seconds: 30 }]);
        expect(r.map(s => s.nextStart)).toEqual([30, null]);
    });
});

describe('감지 결과 합치기', () => {
    it('한 음절 감탄사도 받는다 (실측: "À." 272.6 시작, 모델 답 272.8)', () => {
        const cur = [S(272.6, 'À.')];
        const r = mergeSpeechEnds(cur, cur, new Set([0]), new Map([[0, 272.8]]), 724);
        expect(r.applied).toBe(1);
        expect(r.merged[0].speechEnd).toBe(272.8);
        expect(r.grafts).toEqual([[272.6, 272.8]]);
    });

    it('요청한 인덱스만 건드린다 — 모델이 0,1,2로 번호를 다시 매겨도 정상 문장이 오염되지 않음', () => {
        const cur = [S(10, 'a', { speechEnd: 12 }), S(15, 'b'), S(20, 'c'), S(30, 'd')];
        // 3번만 요청했는데 모델이 0번에도 그럴듯한 값(기준 안)을 붙여 보냄
        const r = mergeSpeechEnds(cur, cur, new Set([3]), new Map([[0, 14], [3, 31.5]]), 0);
        expect(r.merged[0]).toBe(cur[0]); // 손대지 않음(포기 표시도 안 붙음)
        expect(r.merged[3].speechEnd).toBe(31.5);
        expect(r.applied).toBe(1);
    });

    it('감지하는 사이 문장 시각이 바뀌었으면(재전사·삭제) 건너뛴다', () => {
        const snap = [S(10, 'a'), S(15, 'b')];
        const cur = [S(10, 'a'), S(16.2, 'b 다시 전사됨')];
        const r = mergeSpeechEnds(cur, snap, new Set([0, 1]), new Map([[0, 11], [1, 17]]), 0);
        expect(r.merged[1].speechEnd).toBeUndefined();
        expect(r.secondsMismatch).toBe(1);
        expect(r.applied).toBe(1);
    });

    it('답이 없거나 기준 밖이면 포기 표시만 하고 기존 값은 그대로', () => {
        const cur = [S(10, 'a', { speechEnd: 12 }), S(20, 'b'), S(30, 'c')];
        const r = mergeSpeechEnds(cur, cur, new Set([0, 1, 2]), new Map([[1, 20.02], [2, 95]]), 0);
        expect(r.merged[0]).toMatchObject({ speechEnd: 12, speechEndSkipped: true }); // 답 없음
        expect(r.merged[1]).toMatchObject({ speechEndSkipped: true });                // 0.05초 이하
        expect(r.merged[1].speechEnd).toBeUndefined();
        expect(r.merged[2]).toMatchObject({ speechEndSkipped: true });                // 60초 초과
        expect(r.applied).toBe(0);
    });

    it('다시 시도해 성공하면 포기 표시를 지우고, 영상 끝을 넘는 값은 끝으로 자른다', () => {
        const cur = [S(100, 'a', { speechEndSkipped: true })];
        const r = mergeSpeechEnds(cur, cur, new Set([0]), new Map([[0, 130]]), 120);
        expect(r.merged[0].speechEnd).toBe(120);
        expect('speechEndSkipped' in r.merged[0]).toBe(false);
    });
});
