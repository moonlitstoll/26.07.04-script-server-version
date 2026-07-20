// graftSpeechEnds — 감지 결과 구제 로직.
//
// 배경: 완료된 대본을 다시 여는 유일한 경로인 loadCache는 항목 data를 localStorage
// 스냅샷으로 통째 교체한다. 저장이 실패했거나 저장 전에 대본을 전환하면, 화면에 있던
// speechEnd가 그 한 줄에서 소멸했다(되돌릴 방법 없음). 이 함수가 교체 직전에 이식한다.
//
// 규칙 두 가지가 핵심이고, 어기면 조용히 데이터가 오염된다:
//   1. 채우기만 하고 덮어쓰지 않는다 (저장본이 항상 우선)
//   2. seconds와 text가 둘 다 같을 때만 이식한다 (재전사된 문장에 옛 값이 붙는 것 방지)
import { describe, it, expect } from 'vitest';
import { graftSpeechEnds } from '../mediaUtils';

const S = (seconds, text, extra = {}) => ({ seconds, text, ...extra });

describe('graftSpeechEnds — 핵심 동작', () => {
    it('스냅샷에 없는 speechEnd를 메모리에서 이식한다', () => {
        const snap = [S(0, 'a'), S(5, 'b')];
        const mem = [S(0, 'a', { speechEnd: 3.5 }), S(5, 'b', { speechEnd: 8.1 })];
        expect(graftSpeechEnds(snap, mem).map(d => d.speechEnd)).toEqual([3.5, 8.1]);
    });

    it('스냅샷에 이미 있는 값은 절대 덮어쓰지 않는다 (저장본 우선)', () => {
        const snap = [S(0, 'a', { speechEnd: 3.0 })];
        const mem = [S(0, 'a', { speechEnd: 99 })];
        expect(graftSpeechEnds(snap, mem)[0].speechEnd).toBe(3.0);
    });

    it('seconds가 다르면 이식하지 않는다', () => {
        expect(graftSpeechEnds([S(0, 'a')], [S(1, 'a', { speechEnd: 3.5 })])[0].speechEnd).toBeUndefined();
    });

    it('text가 다르면 이식하지 않는다 (재전사로 문장이 바뀐 경우)', () => {
        expect(graftSpeechEnds([S(0, '새 문장')], [S(0, '옛 문장', { speechEnd: 3.5 })])[0].speechEnd).toBeUndefined();
    });

    it('문장 삭제로 인덱스가 밀려도 올바른 문장에 이식된다', () => {
        const snap = [S(5, 'b'), S(9, 'c')];   // 앞 문장이 삭제된 스냅샷
        const mem = [S(0, 'a', { speechEnd: 3 }), S(5, 'b', { speechEnd: 8 }), S(9, 'c', { speechEnd: 12 })];
        expect(graftSpeechEnds(snap, mem).map(d => d.speechEnd)).toEqual([8, 12]);
    });

    it('같은 seconds에 여러 문장(블록)이 있어도 text로 구분한다', () => {
        const snap = [S(7, 'first'), S(7, 'second')];
        const mem = [S(7, 'first', { speechEnd: 9 }), S(7, 'second', { speechEnd: 11 })];
        expect(graftSpeechEnds(snap, mem).map(d => d.speechEnd)).toEqual([9, 11]);
    });

    it('speechEndSkipped 표시도 구제된다', () => {
        expect(graftSpeechEnds([S(0, 'a')], [S(0, 'a', { speechEndSkipped: true })])[0].speechEndSkipped).toBe(true);
    });

    it('메모리에 실값이 있으면 스냅샷의 skipped 표시를 해제한다', () => {
        const r = graftSpeechEnds([S(0, 'a', { speechEndSkipped: true })], [S(0, 'a', { speechEnd: 4.2 })])[0];
        expect(r.speechEnd).toBe(4.2);
        expect(r.speechEndSkipped).toBeUndefined();
    });

    it('다른 필드(analysis 등)는 보존된다', () => {
        const snap = [S(0, 'a', { analysis: 'X', translation: 'Y', isAnalyzed: true })];
        const r = graftSpeechEnds(snap, [S(0, 'a', { speechEnd: 5 })])[0];
        expect([r.analysis, r.translation, r.isAnalyzed, r.speechEnd]).toEqual(['X', 'Y', true, 5]);
    });
});

describe('graftSpeechEnds — 방어', () => {
    it('메모리가 비면 스냅샷을 그대로 반환', () => {
        const snap = [S(0, 'a')];
        expect(graftSpeechEnds(snap, [])).toEqual(snap);
    });

    it('이식할 게 없으면 새 배열을 만들지 않는다 (불필요한 리렌더 방지)', () => {
        const snap = [S(0, 'a')];
        expect(graftSpeechEnds(snap, [S(0, 'a')])).toBe(snap);
    });

    it('null/비배열 입력에도 터지지 않는다', () => {
        expect(graftSpeechEnds(null, [S(0, 'a', { speechEnd: 1 })])).toBeNull();
        expect(graftSpeechEnds([S(0, 'a')], null)).toEqual([S(0, 'a')]);
        expect(graftSpeechEnds([S(0, 'a')], undefined)).toEqual([S(0, 'a')]);
    });

    it('배열 안의 null 항목을 건너뛴다', () => {
        const snap = [null, S(0, 'a')];
        const mem = [null, S(0, 'a', { speechEnd: 2 })];
        expect(graftSpeechEnds(snap, mem)[1].speechEnd).toBe(2);
    });

    it('seconds가 숫자가 아닌 항목은 무시한다', () => {
        expect(graftSpeechEnds([S('x', 'a')], [S('x', 'a', { speechEnd: 2 })])[0].speechEnd).toBeUndefined();
    });

    it('NaN/Infinity speechEnd는 이식하지 않는다', () => {
        const snap = [S(0, 'a'), S(1, 'b')];
        const mem = [S(0, 'a', { speechEnd: NaN }), S(1, 'b', { speechEnd: Infinity })];
        expect(graftSpeechEnds(snap, mem).map(d => d.speechEnd)).toEqual([undefined, undefined]);
    });

    it('원본 스냅샷을 변형하지 않는다 (불변)', () => {
        const snap = [S(0, 'a')];
        const before = JSON.stringify(snap);
        graftSpeechEnds(snap, [S(0, 'a', { speechEnd: 5 })]);
        expect(JSON.stringify(snap)).toBe(before);
    });
});

describe('graftSpeechEnds — 실제 시나리오', () => {
    it('감지 성공 → 저장 실패 → 대본 전환 후 복귀: 결과가 살아남는다', () => {
        const cached = [S(0, 'a'), S(5, 'b'), S(9, 'c')];   // 저장 실패로 speechEnd 없음
        const onScreen = cached.map((d, i) => ({ ...d, speechEnd: d.seconds + 2 + i }));
        const r = graftSpeechEnds(cached, onScreen);
        expect(r.map(d => d.speechEnd)).toEqual([2, 8, 13]);
        // 하나라도 남아야 '대사만' 칩이 회색으로 되돌아가지 않는다
        expect(r.some(d => typeof d.speechEnd === 'number')).toBe(true);
    });

    it('저장 성공 후 복귀: 스냅샷 값이 그대로 유지된다', () => {
        expect(graftSpeechEnds([S(0, 'a', { speechEnd: 2 })], [S(0, 'a', { speechEnd: 2 })])[0].speechEnd).toBe(2);
    });
});
