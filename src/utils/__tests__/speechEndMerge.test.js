import { describe, it, expect } from 'vitest';
import { selectSpeechEndTargets, withNextStarts, mergeSpeechEnds, initialSpeechEnd, speechEndEditBounds, applyManualSpeechEnd, speechEndSkipInfo, unresolvedSpeechEnds, speechEndMissingSet } from '../speechEndMerge';
import { gapSkipTarget } from '../speechSegments';
import { sanitizeData } from '../mediaUtils';

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

// ─── 대사 끝 직접 맞추기 ───
describe('대사 끝 직접 맞추기', () => {
    // 실측 v1b(1번 영상): 4:30.0 "Ai."가 판단 불가 → 뒤따르는 음악(재청취상 4:24.7~4:40.7)을 못 건너뜀
    const v1b = () => [
        S(262.5, 'Thôi chết rồi.', { speechEnd: 263.6 }),
        S(270.0, 'Ai.', { speechEndSkipped: true }),
        S(281.2, 'Đây là cái gì vậy?', { speechEnd: 282.9 }),
    ];

    it('판단 불가 문장의 처음 값은 글자 수 어림(다음 문장 시작이 아니다 — −0.5를 20번 넘게 눌러야 해서)', () => {
        const r = initialSpeechEnd(v1b(), 1, 900);
        expect(r).toEqual({ value: 270.6, estimated: true });
    });

    it('어림값은 다음 문장 시작을 넘지 않는다', () => {
        const d = [S(100, 'một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba'), S(102.5, 'x')];
        expect(initialSpeechEnd(d, 0, 900).value).toBe(102.5);
    });

    it('끝 시각이 있으면 그 값(형제 문장 중 가장 늦은 값 — 엔진이 쓰는 값)', () => {
        const d = [S(50, 'a', { speechEnd: 51.2 }), S(50, 'b', { speechEnd: 53.4 }), S(60, 'c')];
        expect(initialSpeechEnd(d, 0, 900)).toEqual({ value: 53.4, estimated: false });
    });

    it('맞출 수 있는 범위: 시작+0.1 ~ min(시작+60, 영상 끝)', () => {
        expect(speechEndEditBounds(v1b(), 1, 900)).toEqual({ min: 270.1, max: 330 });
        expect(speechEndEditBounds(v1b(), 1, 300)).toEqual({ min: 270.1, max: 300 });
    });

    it('맞춘 값을 넣으면 판단 불가가 풀리고 실제 재생 엔진이 다음 문장까지 건너뛴다', () => {
        const { data, changed } = applyManualSpeechEnd(v1b(), 1, 270.6);
        expect(changed).toEqual([1]);
        expect(data[1].speechEnd).toBe(270.6);
        expect('speechEndSkipped' in data[1]).toBe(false);
        expect(data[0]).toEqual(v1b()[0]); // 다른 문장은 그대로
        // 대사 끝 + 여유(0.5)가 지나면 다음 문장 시작 − 버퍼(0.5)로 점프
        expect(gapSkipTarget(data, 1, 2, 271.2, 0.5, 0.5)).toBe(280.7);
        expect(gapSkipTarget(v1b(), 1, 2, 271.2, 0.5, 0.5)).toBeNull(); // 맞추기 전엔 못 건너뜀
    });

    it('같은 시각의 형제 문장 전부에 넣는다(하나만 바꾸면 옛 늦은 값이 이겨 건너뛰기가 안 바뀜)', () => {
        const d = [S(50, 'a', { speechEnd: 51.2 }), S(50, 'b', { speechEnd: 58.0 }), S(65, 'c')];
        const { data, changed } = applyManualSpeechEnd(d, 0, 52.0);
        expect(changed).toEqual([0, 1]);
        expect(gapSkipTarget(data, 1, 2, 52.6, 0.5, 0.5)).toBe(64.5);
    });

    it('저장 형식 정리(sanitizeData)를 거쳐도 맞춘 값이 남고 판단 불가 표시는 없다', () => {
        const { data } = applyManualSpeechEnd(v1b(), 1, 270.6);
        const clean = sanitizeData(data, 0);
        expect(clean[1].speechEnd).toBe(270.6);
        expect(clean[1].speechEndSkipped).toBeUndefined();
    });

    it('안내 문구: 건너뜀 / 간격 짧음(3초 이하) / 마지막 문장', () => {
        expect(speechEndSkipInfo(v1b(), 1, 270.6, 900)).toMatchObject({ kind: 'skip', nextStart: 281.2 });
        expect(speechEndSkipInfo(v1b(), 1, 278.2, 900).kind).toBe('short');   // 간격 정확히 3.0 → 엔진도 안 건너뜀
        expect(speechEndSkipInfo(v1b(), 2, 282.9, 900).kind).toBe('wrap');
        expect(speechEndSkipInfo(v1b(), 2, 282.9, 285).kind).toBe('end');
    });

    it('판단 불가로 비어 있는 문장만 센다(옛 값이 남았거나 형제가 끝을 가진 문장은 재생에 문제없음)', () => {
        const d = [
            S(10, 'a', { speechEndSkipped: true }),                   // 비어 있음 → 셈
            S(20, 'b', { speechEndSkipped: true, speechEnd: 21.5 }),  // 재감지 실패했지만 옛 값 유지
            S(30, 'c1', { speechEndSkipped: true }),                  // 형제가 끝을 가짐
            S(30, 'c2', { speechEnd: 31.4 }),
            S(40, 'd'),                                                // 아직 감지 안 함(미감지 — 따로 셈)
        ];
        expect(unresolvedSpeechEnds(d)).toEqual([0]);
    });
});

describe("카드의 '대사 끝 없음' 배지", () => {
    it('감지를 한 번도 안 한 영상엔 배지 없음(전부 없으니 무의미)', () => {
        expect([...speechEndMissingSet([S(1, 'a'), S(5, 'b')])]).toEqual([]);
    });
    it('판단 불가·미감지 모두, 형제가 끝을 가진 문장은 제외', () => {
        const d = [
            S(10, 'a', { speechEnd: 11 }),
            S(20, 'b', { speechEndSkipped: true }),  // 판단 불가
            S(30, 'c'),                              // 재전사로 새로 생긴 미감지
            S(40, 'd1'), S(40, 'd2', { speechEnd: 41.5 }), // 형제가 끝을 가짐
            S(50, 'e', { speechEnd: 49 }),           // 시작보다 이른 값 = 무효
        ];
        expect([...speechEndMissingSet(d)]).toEqual([1, 2, 5]);
    });
});

describe('건너뛸 자리가 아니면 배지·안내에서 뺀다', () => {
    // 실측 5번 영상: 판단 불가 "Này là cơm."(15:27.12) 다음 문장 "Bà ơi."가 0.68초 뒤 — 끝을 알아도 건너뛸 게 없다
    const v5 = () => [
        S(900.0, 'Trước.', { speechEnd: 901.2 }),
        S(927.12, 'Này là cơm.', { speechEndSkipped: true }),
        S(927.8, 'Bà ơi. Ừm.', { speechEnd: 929.0 }),
    ];
    it('다음 문장까지 3초 이하면 배지 없음', () => {
        expect([...speechEndMissingSet(v5(), 961)]).toEqual([]);
        expect(unresolvedSpeechEnds(v5(), 961)).toEqual([]);
    });
    it('실측 1번 영상 "Ai."(4:30.0, 다음 4:41.2)는 배지·안내 대상', () => {
        const d = [S(262.5, 'a', { speechEnd: 263.6 }), S(270.0, 'Ai.', { speechEndSkipped: true }), S(281.2, 'b', { speechEnd: 282.9 })];
        expect([...speechEndMissingSet(d, 900)]).toEqual([1]);
        expect(unresolvedSpeechEnds(d, 900)).toEqual([1]);
    });
    it('마지막 문장: 영상 끝까지 3초 넘으면 대상, 아니면 제외(길이를 모르면 대상)', () => {
        const d = [S(10, 'a', { speechEnd: 11 }), S(20, 'b', { speechEndSkipped: true })];
        expect(unresolvedSpeechEnds(d, 30)).toEqual([1]);
        expect(unresolvedSpeechEnds(d, 22)).toEqual([]);
        expect(unresolvedSpeechEnds(d)).toEqual([1]);
    });
});
