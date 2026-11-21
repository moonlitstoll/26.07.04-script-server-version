import { describe, it, expect } from 'vitest';
import { withTieHints, mergeRestored } from '../trashUtils';
import { applySplit, splitKeepsGroupTime } from '../sentenceEdit';
import { sanitizeData } from '../mediaUtils';

const S = (seconds, text) => ({ seconds, text, o: text, timestamp: `00:${seconds.toFixed(2).padStart(5, '0')}`, isAnalyzed: true, translation: '번역' });
const texts = (list) => list.map(d => d.text);
const a = S(1, 'a'); const x = S(5, 'x'); const y = S(5, 'y'); const z = S(5, 'z'); const d = S(9, 'd');
const ALL = [a, x, y, z, d];
// 되살린 뒤 실제로 거치는 것과 같게: 끼우고 → 시각 정렬(sanitizeData)
const restore = (cur, toAdd) => texts(sanitizeData(mergeRestored(cur, toAdd), 0));

describe('같은 시각으로 묶인 문장 — 지웠다 되살리기', () => {
    it('묶음이 아닌 문장에는 순서를 적지 않는다', () => {
        expect(withTieHints(ALL, [a])[0]._tie).toBeUndefined();
    });

    it('묶음 문장에는 묶음 순서를 적는다', () => {
        expect(withTieHints(ALL, [x])[0]._tie).toEqual(['x', 'y', 'z']);
    });

    it('맨 앞 문장을 지웠다 되살리면 맨 앞으로 — 화면 재현 건(예전엔 [y, z, x])', () => {
        const [tx] = withTieHints(ALL, [x]);
        expect(restore([a, y, z, d], [tx])).toEqual(['a', 'x', 'y', 'z', 'd']);
    });

    it('가운데·맨 뒤도 제자리', () => {
        const [ty] = withTieHints(ALL, [y]);
        expect(restore([a, x, z, d], [ty])).toEqual(['a', 'x', 'y', 'z', 'd']);
        const [tz] = withTieHints(ALL, [z]);
        expect(restore([a, x, y, d], [tz])).toEqual(['a', 'x', 'y', 'z', 'd']);
    });

    it('하나씩 따로 지워도 처음 순서를 이어 적는다 → 어느 순서로 되살려도 원래 순서', () => {
        const [tx] = withTieHints(ALL, [x]);
        const [ty] = withTieHints([a, y, z, d], [y], [tx]);   // x는 이미 휴지통
        expect(ty._tie).toEqual(['x', 'y', 'z']);
        expect(restore([a, z, d], [ty, tx])).toEqual(['a', 'x', 'y', 'z', 'd']);   // 휴지통 순서(최신이 앞)
        expect(restore([a, z, d], [tx, ty])).toEqual(['a', 'x', 'y', 'z', 'd']);
        expect(restore(sanitizeData(mergeRestored([a, z, d], [ty]), 0), [tx])).toEqual(['a', 'x', 'y', 'z', 'd']);
    });

    it('묶음이 한 문장만 남았을 때 지워도, 먼저 지운 문장의 순서표가 있으면 이어 적는다', () => {
        const two = [a, x, y, d];
        const [tx] = withTieHints(two, [x]);
        const [ty] = withTieHints([a, y, d], [y], [tx]);
        expect(restore([a, d], [tx, ty])).toEqual(['a', 'x', 'y', 'd']);
        expect(restore([a, d], [ty, tx])).toEqual(['a', 'x', 'y', 'd']);
    });

    it('한 번에 여러 개를 지웠다 전부 되살려도 원래 순서', () => {
        const hinted = withTieHints(ALL, [x, z]);
        expect(restore([a, y, d], [...hinted].reverse())).toEqual(['a', 'x', 'y', 'z', 'd']);
    });

    it('순서표가 없는 옛 휴지통 문장은 예전처럼 묶음 뒤에 붙는다', () => {
        expect(restore([a, y, z, d], [x])).toEqual(['a', 'y', 'z', 'x', 'd']);
    });

    it('묶음이 통째로 없어졌으면 시각 자리로만 간다', () => {
        const [tx] = withTieHints(ALL, [x]);
        expect(restore([a, d], [tx])).toEqual(['a', 'x', 'd']);
    });

    it('형제 문장의 글자가 그사이 바뀌어도(다시 전사) 빈 자리 수가 맞으면 제자리로', () => {
        const y2 = S(5, 'y 고침'); const x2 = S(5, 'x 고침'); const z2 = S(5, 'z 고침');
        const [tx] = withTieHints(ALL, [x]);
        expect(restore([a, y2, z, d], [tx])).toEqual(['a', 'x', 'y 고침', 'z', 'd']);   // 예전엔 ['y 고침', 'x', 'z']
        const [ty] = withTieHints(ALL, [y]);
        expect(restore([a, x2, z, d], [ty])).toEqual(['a', 'x 고침', 'y', 'z', 'd']);
        expect(restore([a, x, z2, d], [ty])).toEqual(['a', 'x', 'y', 'z 고침', 'd']);
        const [tz] = withTieHints(ALL, [z]);
        expect(restore([a, x, y2, d], [tz])).toEqual(['a', 'x', 'y 고침', 'z', 'd']);
    });

    it('새로 끼어든 문장이 있어 자리를 가릴 수 없으면 아는 문장만 보고 끼운다', () => {
        const n = S(5, '새 문장');
        const [ty] = withTieHints(ALL, [y]);
        // x와 z 사이 빈 순서는 y 하나뿐인데 그건 되살리는 문장 자신 → '새 문장'은 자리 판단에서 빠지고, y는 z 앞
        expect(restore([a, x, n, z, d], [ty])).toEqual(['a', 'x', '새 문장', 'y', 'z', 'd']);
    });

    it('같은 글의 문장이 이미 있으면 그 뒤에 끼운다(앞이 아니라)', () => {
        const again = { ...withTieHints(ALL, [x])[0], translation: '되살린 것' };
        const out = sanitizeData(mergeRestored([a, x, y, z, d], [again]), 0);
        expect(texts(out)).toEqual(['a', 'x', 'x', 'y', 'z', 'd']);
        expect(out[1].translation).toBe('번역');
        expect(out[2].translation).toBe('되살린 것');
    });

    it('순서표(_tie)는 대본에 남지 않는다', () => {
        const [tx] = withTieHints(ALL, [x]);
        expect(sanitizeData(mergeRestored([a, y, z, d], [tx]), 0).some(r => '_tie' in r)).toBe(false);
    });
});

describe('같은 시각으로 묶인 문장 — 나누기', () => {
    const X = S(5, 'one two three four');
    const data = [a, X, y, z, d];

    it('뒤에 같은 시각 문장이 있을 때만 원래 시각을 지킨다', () => {
        expect(splitKeepsGroupTime(data, 1)).toBe(true);
        expect(splitKeepsGroupTime(data, 3)).toBe(false);   // 묶음의 마지막
        expect(splitKeepsGroupTime(data, 0)).toBe(false);
        expect(splitKeepsGroupTime(data, 4)).toBe(false);
    });

    it('둘로 나누면 두 조각이 붙어 있다 — 화면 재현 건(예전엔 뒤 조각이 묶음 끝으로)', () => {
        const r = applySplit(data, 1, { wordIndex: 2, mode: 'keepBoth', splitSeconds: 7.2 });
        const clean = sanitizeData(r.data, 0);
        expect(texts(clean)).toEqual(['a', 'one two', 'three four', 'y', 'z', 'd']);
        expect(clean.map(c => c.seconds)).toEqual([1, 5, 5, 5, 5, 9]);
    });

    it('앞부분 삭제: 남는 뒷부분이 묶음 맨 앞 자리를 지킨다', () => {
        const r = applySplit(data, 1, { wordIndex: 2, mode: 'dropHead', splitSeconds: 7.2 });
        expect(texts(sanitizeData(r.data, 0))).toEqual(['a', 'three four', 'y', 'z', 'd']);
    });

    it('묶음의 마지막 문장은 예전처럼 고른 시각을 쓴다', () => {
        const last = [a, x, y, S(5, 'one two three four'), d];
        const r = applySplit(last, 3, { wordIndex: 2, mode: 'keepBoth', splitSeconds: 7.2 });
        const clean = sanitizeData(r.data, 0);
        expect(texts(clean)).toEqual(['a', 'x', 'y', 'one two', 'three four', 'd']);
        expect(clean[4].seconds).toBe(7.2);
    });

    it('묶음이 아닌 문장은 예전 그대로(고른 시각)', () => {
        const r = applySplit([a, S(3, 'one two three four'), d], 1, { wordIndex: 2, mode: 'keepBoth', splitSeconds: 4.5 });
        expect(r.data.map(c => c.seconds)).toEqual([1, 3, 4.5, 9]);
        expect(r.trashed).toEqual([]);
    });

    it('지운 조각을 휴지통에서 되살리면 남은 조각 옆 제자리로', () => {
        const head = applySplit(data, 1, { wordIndex: 2, mode: 'dropHead', splitSeconds: 7.2 });
        expect(restore(sanitizeData(head.data, 0), head.trashed)).toEqual(['a', 'one two', 'three four', 'y', 'z', 'd']);
        const tail = applySplit(data, 1, { wordIndex: 2, mode: 'dropTail', splitSeconds: 7.2 });
        expect(restore(sanitizeData(tail.data, 0), tail.trashed)).toEqual(['a', 'one two', 'three four', 'y', 'z', 'd']);
    });
});
