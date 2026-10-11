// '대사만' 감지가 1단계 오디오를 재사용하면 추출·업로드 없이 감지 요청 하나만 보낸다 — 실제 detectSpeechEnds에 fetch만 가짜로.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectSpeechEnds } from '../gemini';

const PART = { fileData: { fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/stage1-audio', mimeType: 'audio/wav' } };
let urls; let bodies;
beforeEach(() => {
    urls = []; bodies = [];
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
        urls.push(String(url)); bodies.push(JSON.parse(opts.body));
        return new Response(JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: '[3] 00:34.20\n[DONE]' }] }, finishReason: 'STOP', index: 0 }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('대사 끝 감지 — 1단계 오디오 재사용', () => {
    it('파일 없이도 올라간 오디오 주소로 요청 1번만 보낸다(업로드 없음)', async () => {
        const ends = await detectSpeechEnds(null, 'k', 'gemini-2.5-flash', [{ index: 3, seconds: 33.4, text: 'Ơ.' }], { mediaPartOverride: PART });
        expect(ends.get(3)).toBeCloseTo(34.2);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toMatch(/:generateContent/);
        expect(urls.some(u => /upload/.test(u))).toBe(false);
        expect(bodies[0].contents[0].parts[0]).toEqual(PART);
    });
});
