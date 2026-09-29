import { describe, it, expect, beforeEach } from 'vitest';
import { readRecent, touchRecent, forgetRecent, sortByRecent } from '../recentOpen';

// node에는 localStorage가 없어 최소 구현을 붙인다(Object.keys(localStorage)가 저장된 키를 돌려주게 Proxy로)
const store = new Map();
const api = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
};
globalThis.localStorage = new Proxy(api, {
    ownKeys: () => [...store.keys()],
    getOwnPropertyDescriptor: (_, k) => (store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : undefined),
});

const cache = (id, savedAt) => store.set(`gemini_analysis_${id}`, JSON.stringify({ data: [], metadata: { savedAt } }));

describe('마지막으로 연 시각', () => {
    beforeEach(() => store.clear());

    it('처음엔 대본의 마지막 저장 시각으로 한 번 채운다', () => {
        cache('a.mp4_1', 100); cache('b.mp4_2', 300);
        expect(readRecent()).toEqual({ 'a.mp4_1': 100, 'b.mp4_2': 300 });
        // 채운 뒤엔 캐시가 바뀌어도(분석 저장 등) 다시 채우지 않는다
        cache('a.mp4_1', 999);
        expect(readRecent()['a.mp4_1']).toBe(100);
    });

    it('열면 맨 위로, 지우면 기록도 뺀다', () => {
        cache('a.mp4_1', 100); cache('b.mp4_2', 300); cache('c.mp4_3', 200);
        touchRecent('a.mp4_1', 500);
        const ids = ['a.mp4_1', 'b.mp4_2', 'c.mp4_3'];
        expect(sortByRecent(ids, x => x)).toEqual(['a.mp4_1', 'b.mp4_2', 'c.mp4_3']);
        forgetRecent('a.mp4_1');
        expect(sortByRecent(ids, x => x)).toEqual(['b.mp4_2', 'c.mp4_3', 'a.mp4_1']); // 기록 없음 = 맨 아래
    });

    it('기록이 같거나 없으면 원래 순서를 지킨다', () => {
        store.set('miniapp_recent_open', JSON.stringify({ x: 5 }));
        expect(sortByRecent(['p', 'x', 'q'], s => s)).toEqual(['x', 'p', 'q']);
    });
});
