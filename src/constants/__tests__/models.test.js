// 모델 목록 규칙 — Claude는 2단계(분석)에서만 고를 수 있고, 소리를 보내는 경로(전사·재전사·감지)엔 절대 못 들어간다.
// Claude는 소리 입력을 받지 않는다(2026-10-17 실측: Messages API audio/document/image 블록·파일 API 전부 400).
import { describe, it, expect } from 'vitest';
import {
    MODELS, MODEL_IDS, GEMINI_MODEL_IDS, DEFAULT_MODEL_ID,
    modelsForStage, modelIdsForStage, isClaudeModel, providerOf, getStage2Concurrency,
} from '../models';

describe('Claude 모델의 자리', () => {
    it('Claude Sonnet 5.5는 목록에 있고 공급자가 claude다', () => {
        expect(MODEL_IDS).toContain('claude-sonnet-5-5');
        expect(isClaudeModel('claude-sonnet-5-5')).toBe(true);
        expect(providerOf('claude-sonnet-5-5')).toBe('claude');
    });

    it('Gemini 모델은 공급자 표시가 없어도 gemini로 본다', () => {
        expect(providerOf('gemini-2.5-flash')).toBe('gemini');
        expect(isClaudeModel('gemini-2.5-flash')).toBe(false);
        expect(isClaudeModel(undefined)).toBe(false);
    });

    it('2단계 목록에만 있고 1·3단계 목록에는 없다', () => {
        expect(modelIdsForStage('stage2')).toContain('claude-sonnet-5-5');
        expect(modelIdsForStage('stage1')).not.toContain('claude-sonnet-5-5');
        expect(modelIdsForStage('stage3')).not.toContain('claude-sonnet-5-5');
    });

    it('소리 경로의 유효 모델 목록(GEMINI_MODEL_IDS)에 Claude가 없다', () => {
        expect(GEMINI_MODEL_IDS).not.toContain('claude-sonnet-5-5');
        for (const id of GEMINI_MODEL_IDS) expect(isClaudeModel(id)).toBe(false);
    });

    it('Gemini 모델은 세 단계 모두 고를 수 있다', () => {
        for (const m of MODELS.filter(x => x.provider !== 'claude')) {
            for (const s of ['stage1', 'stage2', 'stage3']) expect(modelIdsForStage(s), `${m.id} ${s}`).toContain(m.id);
        }
    });

    it('기본 모델은 Gemini이고 세 단계 모두에 있다', () => {
        expect(isClaudeModel(DEFAULT_MODEL_ID)).toBe(false);
        for (const s of ['stage1', 'stage2', 'stage3']) expect(modelIdsForStage(s)).toContain(DEFAULT_MODEL_ID);
    });

    it('Claude의 2단계 동시 요청 수는 Gemini 기본(3)보다 작다 (새 계정 분당 한도)', () => {
        expect(getStage2Concurrency('claude-sonnet-5-5')).toBeLessThan(getStage2Concurrency('gemini-2.5-flash'));
        expect(getStage2Concurrency('claude-sonnet-5-5')).toBeGreaterThanOrEqual(1);
    });

    it('modelsForStage는 화면용 객체(name·badge)를 돌려준다', () => {
        const claude = modelsForStage('stage2').find(m => m.id === 'claude-sonnet-5-5');
        expect(claude.name).toBe('Claude Sonnet 5.5');
        expect(claude.badge).toBe('크레딧');
    });
});
