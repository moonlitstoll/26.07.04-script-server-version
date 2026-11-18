import { describe, it, expect } from 'vitest';
import { analysisViewOf, nextAnalysisView, analysisButtonText, DRILL_VIEW_START } from '../analysisView';

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

describe('가리기의 눈 버튼', () => {
    it('문장만에서 시작해 번역 → 정답·해설 → 문장만으로 돈다', () => {
        let s = DRILL_VIEW_START;
        const seen = [analysisViewOf(s)];
        for (let i = 0; i < 3; i++) { s = nextAnalysisView(s); seen.push(analysisViewOf(s)); }
        expect(seen).toEqual(['hidden', 'folded', 'open', 'hidden']);
        expect(s).toEqual(DRILL_VIEW_START);
    });

    it('안내 문구는 가리기와 일반 화면이 다르다', () => {
        const folded = { showAnalysis: true, showBreakdown: false };
        expect(analysisButtonText(DRILL_VIEW_START, true).label).toBe('번역 보기');
        expect(analysisButtonText(folded, true).label).toBe('정답·해설 모두 열기');
        expect(analysisButtonText({ showAnalysis: true, showBreakdown: true }, true).label).toBe('정답·해설 모두 가리기');
        expect(analysisButtonText(folded).label).toBe('단어 풀이 펼치기');
        expect(analysisButtonText({ showAnalysis: false, showBreakdown: false }).label).toBe('번역/분석 보기');
    });
});
