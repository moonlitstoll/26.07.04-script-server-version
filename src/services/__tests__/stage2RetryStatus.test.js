// Stage 2 재시도 상태 알림(onStatus) 검증 — 실제 analyzeBatchSentences에 fetch만 가짜로.
// 휴대폰에서 '분석 중… 230/255'가 한참 멈춘 것처럼 보였던 일(2026-10-18): 묶음 하나가 503으로 조용히
// 재시도 중이었는데 화면엔 아무 표시가 없었다. 이제 재시도마다 횟수·사유·대기 시간을 알린다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeBatchSentences, stage2RetryReason } from '../gemini';

const block = (i, tr, a) => `--- [INDEX: ${i}] START ---\n[번역] ${tr}\n[분석] ${a}\n--- [INDEX: ${i}] END ---`;
const ok = (text) => new Response(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });
const err = (status, message) => new Response(JSON.stringify({ error: { code: status, message, status: 'UNAVAILABLE' } }),
    { status, headers: { 'Content-Type': 'application/json' } });

const ITEMS = [{ index: 0, text: 'Xin chào.' }];
const B0 = block(0, '안녕하세요.', '**Xin chào**: 안녕하세요 (Xin chào: 안녕하세요)');

beforeEach(() => {
    vi.useFakeTimers();
    for (const k of ['warn', 'log', 'error']) vi.spyOn(console, k).mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('analyzeBatchSentences — 재시도 상태 알림', () => {
    it('503이 두 번 오면 재시도 1·2를 사유·대기시간과 함께 알리고, 세 번째에 성공한다', async () => {
        let n = 0;
        vi.stubGlobal('fetch', vi.fn(async () => (++n <= 2 ? err(503, 'The model is overloaded.') : ok(B0))));
        const events = [];
        const p = analyzeBatchSentences(ITEMS, 'k', 'gemini-2.5-flash-lite', null, [], false, true, (e) => events.push(e));
        await vi.advanceTimersByTimeAsync(60000); // 백오프(1.5s·3s + 지터)를 건너뛴다
        const res = await p;
        expect(n).toBe(3);
        expect(res[0]).toMatchObject({ index: 0, translation: '안녕하세요.' });
        const waits = events.filter(e => e.phase === 'wait');
        expect(waits.map(e => e.attempt)).toEqual([1, 2]);
        expect(waits.every(e => e.maxAttempts === 5 && e.reason === '서버 혼잡' && e.waitMs >= 1500)).toBe(true);
        // 요청 시작도 매번 알린다(1→2→3)
        expect(events.filter(e => e.phase === 'request').map(e => e.attempt)).toEqual([1, 2, 3]);
    });

    it('콜백을 안 넘기면 예전처럼 조용히 재시도한다', async () => {
        let n = 0;
        vi.stubGlobal('fetch', vi.fn(async () => (++n <= 1 ? err(503, 'overloaded') : ok(B0))));
        const p = analyzeBatchSentences(ITEMS, 'k', 'gemini-2.5-flash-lite', null);
        await vi.advanceTimersByTimeAsync(60000);
        const res = await p;
        expect(res[0].failed).toBeUndefined();
    });

    it('콜백이 던져도 분석은 멈추지 않는다 (표시용이라 삼킨다)', async () => {
        let n = 0;
        vi.stubGlobal('fetch', vi.fn(async () => (++n <= 1 ? err(503, 'overloaded') : ok(B0))));
        const p = analyzeBatchSentences(ITEMS, 'k', 'gemini-2.5-flash-lite', null, [], false, true, () => { throw new Error('ui broke'); });
        await vi.advanceTimersByTimeAsync(60000);
        const res = await p;
        expect(res[0].translation).toBe('안녕하세요.');
    });
});

describe('stage2RetryReason — 사유를 사람 말로', () => {
    it('타임아웃·429·503·네트워크·그 외', () => {
        expect(stage2RetryReason(new Error('x'), true)).toBe('응답 없음');
        expect(stage2RetryReason({ status: 429, message: 'quota' })).toBe('요청 한도');
        expect(stage2RetryReason(new Error('[503 Service Unavailable] The model is overloaded.'))).toBe('서버 혼잡');
        expect(stage2RetryReason({ status: 500, message: 'boom' })).toBe('서버 오류 500');
        expect(stage2RetryReason(new TypeError('Failed to fetch'))).toBe('네트워크');
        expect(stage2RetryReason(new Error('[400 Bad Request] key'))).toBe('오류 400');
    });
});
