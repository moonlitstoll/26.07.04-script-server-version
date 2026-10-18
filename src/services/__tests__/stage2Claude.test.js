// 2단계 분석을 Claude 모델로 돌릴 때 — 실제 analyzeBatchSentences(gemini.js)를 네트워크(fetch)만 가짜로 바꿔 돌린다.
// Anthropic SDK는 클라이언트를 만들 때의 전역 fetch를 쓰고, 클라이언트는 호출마다 새로 만든다 → vi.stubGlobal로 잡힌다.
// 지키는 것: ①Claude 요청 모양(주소·키 헤더·생각 끔·샘플링 값 없음·같은 지시문) ②응답 해석이 Gemini와 같은 파서를 탐
// ③키·크레딧 오류는 재시도 없이 사용자 문구를 단다 ④Gemini 모델은 예전 그대로 구글로 간다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeBatchSentences, claudeFailureMessage } from '../gemini';
import { STAGE2_BATCH_PROMPT } from '../prompts';

const block = (i, tr, a) => `--- [INDEX: ${i}] START ---\n[번역] ${tr}\n[분석] ${a}\n--- [INDEX: ${i}] END ---`;
const ITEMS = [{ index: 0, text: 'Xin chào.' }, { index: 1, text: 'Cảm ơn.' }];
const B0 = block(0, '안녕하세요.', '**Xin chào**: 안녕하세요 (Xin chào: 안녕하세요)');
const B1 = block(1, '고마워요.', '**Cảm ơn**: 고마워요 (Cảm ơn: 고맙다)');

const claudeOk = (text, stop_reason = 'end_turn') => new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text }], stop_reason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });
const claudeErr = (status, type, message) => new Response(JSON.stringify({ type: 'error', error: { type, message } }),
    { status, headers: { 'Content-Type': 'application/json' } });

let calls;
const stub = (...responses) => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
        calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        return typeof r === 'function' ? r() : r;
    }));
};
// SDK가 보낸 헤더는 Headers 객체이거나 평범한 객체일 수 있다
const header = (h, name) => (typeof h?.get === 'function' ? h.get(name) : (h?.[name] ?? h?.[name.toLowerCase()]));

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('analyzeBatchSentences — Claude 모델', () => {
    it('Claude 주소로, 키 헤더·생각 끔·샘플링 값 없이, Gemini와 같은 지시문을 보낸다', async () => {
        stub(claudeOk(`${B0}\n${B1}`));
        const res = await analyzeBatchSentences(ITEMS, 'sk-ant-test', 'claude-sonnet-5-5', null, [{ index: 2, text: 'Tạm biệt.' }]);
        expect(calls).toHaveLength(1);
        const { url, headers, body } = calls[0];
        expect(url).toContain('api.anthropic.com/v1/messages');
        expect(header(headers, 'x-api-key')).toBe('sk-ant-test');
        expect(header(headers, 'anthropic-dangerous-direct-browser-access')).toBe('true');
        expect(body.model).toBe('claude-sonnet-5-5');
        expect(body.thinking).toEqual({ type: 'between_tools' });
        expect(body).not.toHaveProperty('temperature');
        expect(body).not.toHaveProperty('top_p');
        expect(body.stream).toBeFalsy();
        const prompt = body.messages[0].content;
        expect(prompt).toContain('[분석대상] 문장(INDEX: 0): Xin chào.');
        expect(prompt).toContain('[문맥참고] (INDEX: 2): Tạm biệt.');
        expect(prompt.startsWith(STAGE2_BATCH_PROMPT)).toBe(true); // Gemini와 한 글자도 다르지 않은 지시문(비교 시험 조건)
        expect(res.map(r => r.translation)).toEqual(['안녕하세요.', '고마워요.']);
        expect(res.some(r => r.failed)).toBe(false);
    });

    it('Gemini 모델은 예전 그대로 구글 주소로 간다 (Claude 코드가 끼어들지 않음)', async () => {
        stub(new Response(JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: `${B0}\n${B1}` }] }, finishReason: 'STOP', index: 0 }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const res = await analyzeBatchSentences(ITEMS, 'g-key', 'gemini-2.5-flash-lite', null);
        expect(calls[0].url).toContain('generativelanguage.googleapis.com');
        expect(calls[0].url).not.toContain('anthropic');
        expect(res.map(r => r.translation)).toEqual(['안녕하세요.', '고마워요.']);
    });

    it('출력 상한(max_tokens)에 잘리면 끝 블록만 실패로 보고 그 문장만 한 번 더 요청한다', async () => {
        const cut = `${B0}\n--- [INDEX: 1] START ---\n[번역] 고마`; // 1번은 쓰다 말았다
        stub(claudeOk(cut, 'max_tokens'), claudeOk(B1));
        const res = await analyzeBatchSentences(ITEMS, 'sk-ant-test', 'claude-sonnet-5-5', null);
        expect(calls).toHaveLength(2);
        expect(calls[1].body.messages[0].content).toContain('[분석대상] 문장(INDEX: 1)');
        expect(calls[1].body.messages[0].content).not.toContain('[분석대상] 문장(INDEX: 0)');
        expect(res.map(r => r.translation)).toEqual(['안녕하세요.', '고마워요.']);
    });

    it('정상 종료(end_turn)면 END 마커 없는 마지막 블록도 받아들인다 (Claude stop_reason → 파서의 STOP)', async () => {
        const noEnd = `${B0}\n${B1}`.replace(/--- \[INDEX: \d+\] END ---\n?/g, '');
        stub(claudeOk(noEnd, 'end_turn'));
        const res = await analyzeBatchSentences(ITEMS, 'sk-ant-test', 'claude-sonnet-5-5', null);
        expect(calls).toHaveLength(1);
        expect(res.map(r => r.translation)).toEqual(['안녕하세요.', '고마워요.']);
    });

    it('키가 틀리면(401) 재시도 없이 실패하고 키 안내 문구를 단다', async () => {
        stub(claudeErr(401, 'authentication_error', 'invalid x-api-key'));
        const res = await analyzeBatchSentences(ITEMS, 'sk-ant-bad', 'claude-sonnet-5-5', null);
        expect(calls).toHaveLength(1);
        expect(res.every(r => r.failed)).toBe(true);
        expect(res[0].errorMessage).toContain('Claude 키');
    });

    it('크레딧이 떨어지면(400 credit) 재시도 없이 실패하고 Gemini로 바꾸라는 문구를 단다', async () => {
        stub(claudeErr(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'));
        const res = await analyzeBatchSentences(ITEMS, 'sk-ant-test', 'claude-sonnet-5-5', null);
        expect(calls).toHaveLength(1);
        expect(res.every(r => r.failed)).toBe(true);
        expect(res[0].errorMessage).toMatch(/크레딧.*Gemini/);
    });

    it('서버가 붐비면(529) 기다렸다 다시 보내고, 되면 성공으로 끝난다', async () => {
        vi.useFakeTimers();
        stub(claudeErr(529, 'overloaded_error', 'Overloaded'), claudeOk(`${B0}\n${B1}`));
        const p = analyzeBatchSentences(ITEMS, 'sk-ant-test', 'claude-sonnet-5-5', null);
        await vi.advanceTimersByTimeAsync(30000); // 백오프(1.5초+지터)를 지나 두 번째 요청까지
        const res = await p;
        expect(calls).toHaveLength(2);
        expect(res.map(r => r.translation)).toEqual(['안녕하세요.', '고마워요.']);
    });

    it('Gemini 실패에는 Claude 문구가 붙지 않는다', async () => {
        stub(new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }));
        const res = await analyzeBatchSentences(ITEMS, 'g-bad', 'gemini-2.5-flash-lite', null);
        expect(res.every(r => r.failed)).toBe(true);
        expect(res[0]).not.toHaveProperty('errorMessage');
    });
});

describe('claudeFailureMessage — 사유별 문구', () => {
    it('401·403은 키, 400+credit은 크레딧, 429는 한도, 5xx는 서버, 그 외는 빈 문자열', () => {
        expect(claudeFailureMessage({ status: 401, message: 'x' })).toContain('키');
        expect(claudeFailureMessage({ status: 403, message: 'x' })).toContain('키');
        expect(claudeFailureMessage({ status: 400, message: 'credit balance is too low' })).toContain('크레딧');
        expect(claudeFailureMessage({ status: 400, message: 'max_tokens: invalid' })).toBe('');
        expect(claudeFailureMessage({ status: 429, message: 'x' })).toContain('한도');
        expect(claudeFailureMessage({ status: 529, message: 'x' })).toContain('서버');
        expect(claudeFailureMessage(new Error('network'))).toBe('');
    });
});
