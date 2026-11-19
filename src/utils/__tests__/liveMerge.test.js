import { describe, it, expect } from 'vitest';
import { locateLines, replaceLines, revertEdit, restoreSpeechEnds, syncBusyFlags, lineKey } from '../liveMerge';

const S = (seconds, text, extra = {}) => ({ seconds, text, ...extra });
const texts = (data) => data.map(d => d.text);

describe('지금 대본에서 문장 찾기', () => {
    it('앞 문장이 지워져 번호가 밀려도 시각과 글자로 찾는다', () => {
        const snapshot = [S(1, 'a'), S(3, 'b'), S(9, 'c')];
        const live = [S(3, 'b'), S(9, 'c')];
        expect(locateLines(live, [snapshot[2]])).toEqual([1]);
    });

    it('없어진 문장은 빠진다', () => {
        expect(locateLines([S(1, 'a')], [S(3, 'b')])).toEqual([]);
    });

    it('시각만 같거나 글자만 같으면 다른 문장이다', () => {
        const live = [S(3, 'b'), S(5, 'x')];
        expect(locateLines(live, [S(3, 'x')])).toEqual([]);
        expect(locateLines(live, [S(5, 'b')])).toEqual([]);
    });

    it('똑같은 문장이 둘이면 앞에서부터 하나씩 짝짓는다', () => {
        const live = [S(3, 'b'), S(3, 'b'), S(9, 'c')];
        expect(locateLines(live, [S(3, 'b'), S(3, 'b'), S(3, 'b')])).toEqual([0, 1]);
    });
});

describe('다시 전사 결과를 지금 대본에 넣기', () => {
    const snapshot = [S(1, 'a'), S(3, 'b', { translation: '옛' }), S(9, 'c'), S(12, 'd')];
    const fresh = [S(3.2, 'B1'), S(5, 'B2')];

    it('그사이 다른 문장을 지웠으면 지운 채로 두고 대상 문장만 바꾼다', () => {
        const live = [snapshot[0], snapshot[1], snapshot[3]]; // c를 지움
        const r = replaceLines(live, [{ old: [snapshot[1]], fresh }]);
        expect(texts(r.data)).toEqual(['a', 'B1', 'B2', 'd']);
        expect(r.placed).toEqual(fresh);
        expect(r.skipped).toBe(0);
    });

    it('그사이 다른 문장에 넣은 값(대사 끝)이 남는다', () => {
        const live = [snapshot[0], snapshot[1], { ...snapshot[2], speechEnd: 10.5 }, snapshot[3]];
        const r = replaceLines(live, [{ old: [snapshot[1]], fresh }]);
        expect(r.data.find(d => d.text === 'c').speechEnd).toBe(10.5);
    });

    it('대상 문장을 그사이 지웠으면 결과를 버린다(지운 문장을 되살리지 않는다)', () => {
        const live = [snapshot[0], snapshot[2], snapshot[3]];
        const r = replaceLines(live, [{ old: [snapshot[1]], fresh }]);
        expect(texts(r.data)).toEqual(['a', 'c', 'd']);
        expect(r.placed).toEqual([]);
        expect(r.skipped).toBe(1);
    });

    it('대상 문장을 그사이 잘라 글자가 바뀌었으면 결과를 버린다', () => {
        const live = [snapshot[0], S(3, 'b 앞부분'), snapshot[2], snapshot[3]];
        const r = replaceLines(live, [{ old: [snapshot[1]], fresh }]);
        expect(texts(r.data)).toEqual(['a', 'b 앞부분', 'c', 'd']);
        expect(r.skipped).toBe(1);
    });

    it('같은 시각으로 묶인 문장 중 하나만 남았어도 남은 것을 바꾼다', () => {
        const snap = [S(1, 'a'), S(3, 'b1'), S(3, 'b2'), S(9, 'c')];
        const live = [snap[0], snap[2], snap[3]];
        const r = replaceLines(live, [{ old: [snap[1], snap[2]], fresh }]);
        expect(texts(r.data)).toEqual(['a', 'B1', 'B2', 'c']);
    });

    it('새 문장이 없는 묶음(전사 실패)은 원래 문장을 그대로 둔다', () => {
        const r = replaceLines(snapshot, [{ old: [snapshot[1]], fresh: [] }, { old: [snapshot[2]], fresh: [S(9.1, 'C')] }]);
        expect(texts(r.data)).toEqual(['a', 'b', 'C', 'd']);
        expect(r.skipped).toBe(0);
    });

    it('대상이 아닌 문장은 같은 객체 그대로다', () => {
        const r = replaceLines(snapshot, [{ old: [snapshot[1]], fresh }]);
        expect(r.data[0]).toBe(snapshot[0]);
        expect(r.data[3]).toBe(snapshot[2]);
    });
});

describe('편집 하나만 되돌리기', () => {
    const a = S(1, 'a'); const b = S(3, 'b'); const c = S(9, 'c'); const d = S(12, 'd');

    it('삭제 취소: 지운 문장이 제자리에 돌아온다', () => {
        expect(texts(revertEdit([a, c, d], { removed: [b], before: [a, b, c, d] }))).toEqual(['a', 'b', 'c', 'd']);
    });

    it('삭제 취소: 그사이 끝난 다시 전사 결과는 그대로 남는다', () => {
        // c를 지움 → b의 다시 전사가 끝나 B가 됨 → 삭제 취소
        const live = [a, S(3.2, 'B'), d];
        expect(texts(revertEdit(live, { removed: [c], before: [a, b, c, d] }))).toEqual(['a', 'B', 'c', 'd']);
    });

    it('삭제 취소: 돌아온 문장에 옛 "다시 전사 중" 표시가 남지 않는다', () => {
        const out = revertEdit([a, d], { removed: [{ ...b, isRetranscribing: true }], before: [a, b, d] });
        expect(out[1].text).toBe('b');
        expect('isRetranscribing' in out[1]).toBe(false);
    });

    it('삭제 취소: 휴지통에서 이미 복구한 문장은 또 넣지 않는다', () => {
        expect(texts(revertEdit([a, b, c], { removed: [b], before: [a, b, c] }))).toEqual(['a', 'b', 'c']);
    });

    it('자르기 취소: 조각을 빼고 원래 문장을 넣는다(조각이 그사이 분석돼 객체가 바뀌었어도)', () => {
        const head = S(3, 'b 앞'); const tail = S(4, '뒤');
        const live = [a, { ...head, translation: '번역', isAnalyzed: true }, { ...tail, isAnalyzed: true }, c];
        const out = revertEdit(live, { removed: [S(3, 'b 앞 뒤', { speechEnd: 5 })], added: [head, tail], before: [a, S(3, 'b 앞 뒤'), c] });
        expect(texts(out)).toEqual(['a', 'b 앞 뒤', 'c']);
        expect(out[1].speechEnd).toBe(5);
    });

    it('같은 시각으로 묶인 문장은 편집 전 순서로 돌아온다', () => {
        const x = S(5, 'x'); const y = S(5, 'y'); const z = S(5, 'z');
        expect(texts(revertEdit([y, z], { removed: [x], before: [x, y, z] }))).toEqual(['x', 'y', 'z']);
        expect(texts(revertEdit([x, z], { removed: [y], before: [x, y, z] }))).toEqual(['x', 'y', 'z']);
    });

    it('구간 전사 취소: 새 문장을 빼고 옛 문장을 넣는다. 구간 밖에서 그사이 지운 문장은 지운 채로', () => {
        const live = [S(3.1, 'N1'), S(8, 'N2'), d]; // a는 그사이 지움
        expect(texts(revertEdit(live, { removed: [b, c], added: [S(3.1, 'N1'), S(8, 'N2')], before: [a, b, c, d] }))).toEqual(['b', 'c', 'd']);
    });
});

describe('대사 끝 맞추기 되돌리기', () => {
    it('끝 시각만 예전 값으로, 그사이 들어온 번역은 그대로', () => {
        const old = S(3, 'b', { speechEnd: 4 });
        const live = [S(1, 'a'), S(3, 'b', { speechEnd: 6, translation: '새 번역', isAnalyzed: true })];
        const out = restoreSpeechEnds(live, [old]);
        expect(out[1]).toEqual(S(3, 'b', { speechEnd: 4, translation: '새 번역', isAnalyzed: true }));
        expect(out[0]).toBe(live[0]);
    });

    it('예전에 값이 없었으면 지우고, 판단 불가 표시를 되살린다', () => {
        const out = restoreSpeechEnds([S(3, 'b', { speechEnd: 6 })], [S(3, 'b', { speechEndSkipped: true })]);
        expect(out[0]).toEqual(S(3, 'b', { speechEndSkipped: true }));
    });

    it('그 문장이 없어졌으면 아무것도 바꾸지 않는다', () => {
        const live = [S(1, 'a')];
        expect(restoreSpeechEnds(live, [S(3, 'b', { speechEnd: 4 })])).toBe(live);
    });
});

describe('"다시 전사 중" 표시 맞추기', () => {
    it('아직 안 끝난 작업의 문장에만 붙인다', () => {
        const data = [S(1, 'a'), S(3, 'b'), S(9, 'c')];
        const out = syncBusyFlags(data, new Set([lineKey(data[2])]));
        expect(out.map(d => !!d.isRetranscribing)).toEqual([false, false, true]);
        expect(out[0]).toBe(data[0]);
    });

    it('끝난 작업의 표시는 지운다(옛 사본에 찍혀 있던 표시가 되살아나지 않게)', () => {
        const data = [S(1, 'a', { isRetranscribing: true }), S(3, 'b', { isRetranscribing: true })];
        const out = syncBusyFlags(data, new Set([lineKey(data[1])]));
        expect('isRetranscribing' in out[0]).toBe(false);
        expect(out[1]).toBe(data[1]);
    });

    it('바뀔 게 없으면 받은 배열을 그대로 돌려준다', () => {
        const data = [S(1, 'a')];
        expect(syncBusyFlags(data, new Set())).toBe(data);
        const busy = [S(1, 'a', { isRetranscribing: true })];
        expect(syncBusyFlags(busy, new Set([lineKey(busy[0])]))).toBe(busy);
    });
});
