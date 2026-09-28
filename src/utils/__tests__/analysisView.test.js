import { describe, it, expect } from 'vitest';
import { analysisViewOf, nextAnalysisView } from '../analysisView';

describe('눈 버튼 3단계 순환', () => {
    it('접힘 → 펼침 → 숨김 → 접힘 순서로 돈다', () => {
        let s = { showAnalysis: true, showBreakdown: false }; // 기본(설정 기본값)
        const seen = [analysisViewOf(s)];
        for (let i = 0; i < 3; i++) { s = nextAnalysisView(s); seen.push(analysisViewOf(s)); }
        expect(seen).toEqual(['folded', 'open', 'hidden', 'folded']);
    });

    it('숨김에서 돌아올 때는 풀이가 펼쳐져 있던 적이 있어도 접힘으로 시작한다', () => {
        expect(nextAnalysisView({ showAnalysis: false, showBreakdown: true })).toEqual({ showAnalysis: true, showBreakdown: false });
        expect(nextAnalysisView({ showAnalysis: false, showBreakdown: false })).toEqual({ showAnalysis: true, showBreakdown: false });
    });
});
