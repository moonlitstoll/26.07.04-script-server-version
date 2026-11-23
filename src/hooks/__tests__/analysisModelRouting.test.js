// 재분석·분석은 전부 2단계 모델, 3단계 모델은 다시 받아쓰기(소리)에만 (2026-11-23 사용자 결정).
// 훅은 브라우저 의존이라 실행해 볼 수 없어 소스 글자로 단정한다 — 누가 runStage2에 stage3Model을 다시 넘기면 여기서 걸린다.
// 배경: 재분석이 3단계(2.5 Flash)로 돌 때 연속 25문장 묶음에서 청크를 길게 뭉쳤다(같은 200문장 뭉침 Flash 32·20 vs Claude 7·5).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const hook = read('../useMediaAnalysis.js');
const modal = read('../../components/SettingsModal.jsx');

describe('분석 모델 고르기', () => {
    it('분석(runStage2)은 어디서도 3단계 모델로 돌지 않는다', () => {
        const calls = hook.match(/runStage2\([^;]*?\)/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(10);
        for (const c of calls) expect(c, c).not.toMatch(/stage3Model/);
    });
    it('재분석 버튼(reanalyzeSentences)은 2단계 모델로 분석한다', () => {
        const body = hook.slice(hook.indexOf('const reanalyzeSentences'), hook.indexOf('const detectSpeechEndsForFile'));
        expect(body).toMatch(/runStage2\([^)]*stage2Model/);
    });
    it('3단계 모델은 다시 받아쓰기(retranscribeSegments)에만 쓴다', () => {
        const uses = hook.match(/[^\n]*\bstage3Model\b[^\n]*/g) || [];
        const code = uses.filter(l => !/^\s*(\/\/|stage3Model,)/.test(l) && !/^\s*const settingsNow/.test(l));
        expect(code.length).toBeGreaterThan(0);
        for (const l of code) expect(l, l).toMatch(/retranscribeSegments\(/);
    });
    it('모델 기억(stampCarry) 설정 문자열에 3단계 모델이 없다 — 받아쓰기 모델을 바꿔도 이어 하던 분석 모델이 안 버려진다', () => {
        const line = hook.match(/const settingsNow = [^\n]*/)[0];
        expect(line).not.toMatch(/stage3Model/);
    });
    it('설정창 제목: 2단계에 재분석, 3단계는 다시 받아쓰기만', () => {
        expect(modal).toContain("'2단계 — 번역·풀이(분석·재분석)'");
        expect(modal).toContain("'3단계 — 다시 받아쓰기'");
        expect(modal).not.toContain('다시 받아쓰기 · 다시 분석');
    });
});
