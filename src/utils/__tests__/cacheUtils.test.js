import { describe, it, expect, beforeEach } from 'vitest';
import { ANALYSIS_VERSION } from '../../services/prompts';

// node에는 localStorage가 없어 최소 구현을 붙인다
const store = new Map();
let failWrites = false;
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
        if (failWrites) throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
        store.set(k, String(v));
    },
    removeItem: (k) => { store.delete(k); },
};
const { saveCacheEntry, readCacheMeta, analysisVersionOf, clearCacheIncomplete, isCacheStale } = await import('../cacheUtils');

const FILE = { name: 'a.mp4', size: 10, type: 'video/mp4' };
const KEY = 'gemini_analysis_a.mp4_10';
const line = (seconds, extra = {}) => ({ seconds, text: 't' + seconds, ...extra });
const analyzed = (seconds, extra = {}) => line(seconds, { isAnalyzed: true, translation: 'x', ...extra });
const seedOld = (version) => store.set(KEY, JSON.stringify({ data: [analyzed(1), analyzed(3)], metadata: { name: 'a.mp4', size: 10, status: 'completed', ...(version === undefined ? {} : { version }) } }));

beforeEach(() => { store.clear(); failWrites = false; });

describe('대본의 분석 규칙 버전', () => {
    it('새 대본은 현재 버전', () => {
        saveCacheEntry(FILE, [line(1)], 'extracted');
        expect(readCacheMeta(KEY).version).toBe(ANALYSIS_VERSION);
    });

    it("옛 규칙 대본은 문장을 지우거나 고쳐서 저장해도 옛 버전 그대로다 ('옛 대본' 안내가 사라지지 않는다)", () => {
        seedOld(ANALYSIS_VERSION - 1);
        saveCacheEntry(FILE, [analyzed(1)], 'completed');
        const meta = readCacheMeta(KEY);
        expect(meta.version).toBe(ANALYSIS_VERSION - 1);
        expect(isCacheStale(meta)).toBe(true);
    });

    it('일부 문장만 새로 분석하면 아직 옛 버전, 전부 새로 분석해야 현재 버전', () => {
        seedOld(ANALYSIS_VERSION - 1);
        saveCacheEntry(FILE, [analyzed(1, { av: ANALYSIS_VERSION }), analyzed(3)], 'completed');
        expect(readCacheMeta(KEY).version).toBe(ANALYSIS_VERSION - 1);
        saveCacheEntry(FILE, [analyzed(1, { av: ANALYSIS_VERSION }), analyzed(3, { av: ANALYSIS_VERSION })], 'completed');
        expect(readCacheMeta(KEY).version).toBe(ANALYSIS_VERSION);
    });

    it('재분석 중이라 비어 있는 문장은 보관한 옛 분석의 버전으로 센다', () => {
        expect(analysisVersionOf([line(1, { _prev: { translation: '옛' } }), analyzed(3, { av: 4 })], 3)).toBe(3);
        expect(analysisVersionOf([line(1, { _prev: { translation: '옛', av: 4 } }), analyzed(3, { av: 4 })], 3)).toBe(4);
    });

    it('버전 표시가 없는 아주 옛 대본은 0(낡음)으로 남는다', () => {
        seedOld(undefined);
        saveCacheEntry(FILE, [analyzed(1)], 'completed');
        expect(readCacheMeta(KEY).version).toBe(0);
    });

    it('분석된 문장이 없으면 저장돼 있던 버전을 따른다', () => {
        expect(analysisVersionOf([line(1)], 3)).toBe(3);
        expect(analysisVersionOf([line(1)], undefined)).toBe(ANALYSIS_VERSION);
    });
});

describe("'끝까지 못 받음' 표시", () => {
    const info = { at: 138.6, reason: 'network' };

    it('한 번 적으면 그 뒤 저장에서도 남는다', () => {
        saveCacheEntry(FILE, [line(1)], 'extracted', { incomplete: info });
        saveCacheEntry(FILE, [analyzed(1, { av: ANALYSIS_VERSION })], 'completed');
        expect(readCacheMeta(KEY).incomplete).toEqual(info);
    });

    it('닫으면 지워지고 대본 내용은 그대로다', () => {
        saveCacheEntry(FILE, [line(1)], 'extracted', { incomplete: info });
        expect(clearCacheIncomplete(FILE)).toBe(true);
        expect(readCacheMeta(KEY).incomplete).toBeUndefined();
        expect(JSON.parse(store.get(KEY)).data).toHaveLength(1);
    });

    it('전사를 새로 하면(null을 넘김) 지워진다', () => {
        saveCacheEntry(FILE, [line(1)], 'extracted', { incomplete: info });
        saveCacheEntry(FILE, [line(1)], 'extracted', { incomplete: null });
        expect(readCacheMeta(KEY).incomplete).toBeUndefined();
    });
});

describe('메타데이터 읽기·저장 실패', () => {
    it('문장 글자에 "metadata":가 들어 있어도 메타데이터를 맞게 읽는다', () => {
        saveCacheEntry(FILE, [line(1, { text: 'x "metadata":{"version":1} y' })], 'extracted');
        expect(readCacheMeta(KEY)).toMatchObject({ name: 'a.mp4', status: 'extracted', version: ANALYSIS_VERSION });
    });

    it('없는 대본은 null, 옛 형식(배열만)은 빈 메타데이터', () => {
        expect(readCacheMeta(KEY)).toBeNull();
        store.set(KEY, JSON.stringify([line(1)]));
        expect(readCacheMeta(KEY)).toEqual({});
    });

    it('저장 공간이 꽉 차면 quota로 알리고 저장돼 있던 내용은 그대로다', () => {
        saveCacheEntry(FILE, [line(1)], 'extracted');
        const before = store.get(KEY);
        failWrites = true;
        expect(saveCacheEntry(FILE, [line(1), line(3)], 'extracted')).toMatchObject({ ok: false, reason: 'quota' });
        expect(store.get(KEY)).toBe(before);
    });
});
