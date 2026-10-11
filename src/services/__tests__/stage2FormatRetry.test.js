// Stage 2 '형식 실패 재요청' 검증 — 실제 analyzeBatchSentences(gemini.js)를 네트워크만 가짜로 바꿔 돌린다.
// 응답은 정상(200·STOP)으로 왔는데 일부 문장의 마커가 없어 failed가 되면, 그 문장만 한 번 더 요청한다.
// 예전엔 이 경우 재시도 경로가 아예 없어 그대로 '분석 실패' 카드가 됐다(2026-10-11 점검).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeBatchSentences } from '../gemini';

const block = (i, tr, a) => `--- [INDEX: ${i}] START ---\n[번역] ${tr}\n[분석] ${a}\n--- [INDEX: ${i}] END ---`;
const reply = (text, finishReason = 'STOP') => new Response(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason, index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const ITEMS = [{ index: 0, text: 'Xin chào.' }, { index: 1, text: 'Cảm ơn.' }];
const B0 = block(0, '안녕하세요.', '**Xin chào**: 안녕하세요 (Xin chào: 안녕하세요)');
const B1 = block(1, '고마워요.', '**Cảm ơn**: 고마워요 (Cảm ơn: 고맙다)');

let calls;
const stubReplies = (...texts) => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
        calls.push(JSON.parse(opts.body).contents[0].parts[0].text);
        const t = texts[Math.min(calls.length - 1, texts.length - 1)];
        return reply(t);
    }));
};

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('analyzeBatchSentences — 형식 실패 재요청', () => {
    it('정상 응답이면 한 번만 요청한다', async () => {
        stubReplies(`${B0}\n${B1}`);
        const res = await analyzeBatchSentences(ITEMS, 'k', 'gemini-2.5-flash-lite', null);
        expect(calls).toHaveLength(1);
        expect(res.every(r => !r.failed)).toBe(true);
    });

    it('마커가 빠진 문장만 한 번 더 요청해 채운다', async () => {
        stubReplies(B1, B0); // 첫 응답에 0번 블록이 통째로 없음 → 0번만 다시
        const res = await analyzeBatchSentences(ITEMS, 'k', 'gemini-2.5-flash-lite', null);
        expect(calls).toHaveLength(2);
        expect(calls[1]).toContain('[분석대상] 문장(INDEX: 0)');
        expect(calls[1]).not.toContain('[분석대상] 문장(INDEX: 1)');
        expect(res.find(r => r.index === 0)).toMatchObject({ translation: '안녕하세요.' });
        expect(res.find(r => r.index === 1)).toMatchObject({ translation: '고마워요.' });
        expect(res.some(r => r.failed)).toBe(false);
    });

    it('다시 요청해도 실패하면 거기서 멈춘다 (무한 반복 없음)', async () => {
        stubReplies(B1, '알 수 없는 답');
        const res = await analyzeBatchSentences(ITEMS, 'k', 'gemini-2.5-flash-lite', null);
        expect(calls).toHaveLength(2);
        expect(res.find(r => r.index === 0).failed).toBe(true);
        expect(res.find(r => r.index === 1).failed).toBeUndefined();
    });

    it('END가 하나도 없는 실측 모양(START만, 정상 종료)은 재요청 없이 받아들인다', async () => {
        const noEnd = `${B0}\n${B1}`.replace(/--- \[INDEX: \d+\] END ---\n?/g, '');
        stubReplies(noEnd);
        const res = await analyzeBatchSentences(ITEMS, 'k', 'gemini-2.5-flash-lite', null);
        expect(calls).toHaveLength(1);
        expect(res.map(r => r.translation)).toEqual(['안녕하세요.', '고마워요.']);
    });
});
