import { describe, it, expect } from 'vitest';
import { stage1FailureNotice } from '../failureNotice';

describe('stage1FailureNotice — 전사 실패 화면 문구', () => {
    it('키 오류(실측 SDK 원문)는 "API 키 문제" + 설정 열기 버튼', () => {
        const raw = 'Analysis failed: API Error (Stage 1): [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID"}]';
        const n = stage1FailureNotice(raw);
        expect(n.title).toBe('API 키 문제예요');
        expect(n.action).toBe('settings');
        expect(n.raw).toBe(raw);           // 원문은 '자세히'용으로 보존
        expect(n.title).not.toMatch(/400|Error/);
    });
    it('키가 아예 없을 때도 설정으로', () => {
        expect(stage1FailureNotice('Analysis failed: Please set Gemini API Key in Settings.').action).toBe('settings');
    });
    it('429는 한도 안내 + 다시 시도', () => {
        const n = stage1FailureNotice('Analysis failed: API Error (Stage 1): [429 Too Many Requests] Resource has been exhausted (e.g. check quota).');
        expect(n.title).toBe('요청 한도에 걸렸어요');
        expect(n.action).toBe('retry');
    });
    it('503·overloaded는 서버 혼잡', () => {
        expect(stage1FailureNotice('API Error (Stage 1): [503 Service Unavailable] The model is overloaded.').title).toBe('구글 서버가 붐벼요');
    });
    it('gemini.js가 만든 [오류: …] 머리말은 제목으로, 나머지는 설명으로', () => {
        const n = stage1FailureNotice("Analysis failed: [오류: 구글 서버 과부하] 구글 AI 서버가 지금 붐빕니다(자동으로 3번 다시 보내 봄). 잠시 후 '다시 시도' 버튼을 눌러주세요.");
        expect(n.title).toBe('구글 서버 과부하');
        expect(n.detail).toMatch(/^구글 AI 서버가/);
        expect(n.action).toBe('retry');
    });
    it('말소리 없음', () => {
        expect(stage1FailureNotice('API Error (Stage 1): No valid data found. Video might just be music/noise.').title).toBe('말소리를 찾지 못했어요');
    });
    it('우리가 쓴 짧은 한국어 안내(취소)는 그대로 제목', () => {
        const n = stage1FailureNotice('전사를 취소했습니다. 다시 시도할 수 있습니다.');
        expect(n.title).toBe('전사를 취소했습니다. 다시 시도할 수 있습니다.');
        expect(n.detail).toBe('');
    });
    it('모르는 오류는 일반 문구 + 원문 보존', () => {
        const n = stage1FailureNotice('Analysis failed: TypeError: x is not a function');
        expect(n.title).toBe('받아쓰기에 실패했어요');
        expect(n.raw).toContain('TypeError');
    });
});
