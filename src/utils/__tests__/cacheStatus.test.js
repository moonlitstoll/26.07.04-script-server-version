import { describe, it, expect } from 'vitest';
import { saveStatusOf, cacheStatusOf } from '../cacheStatus';

describe('저장 상태', () => {
    it('전부 분석 → completed, 하나라도 남으면 analyzing', () => {
        expect(saveStatusOf([{ isAnalyzed: true }, { isAnalyzed: true }])).toBe('completed');
        expect(saveStatusOf([{ isAnalyzed: true }, { isAnalyzed: false }])).toBe('analyzing');
    });
    it('문장이 0개면 완료가 아니라 extracted — 목록 표시(getCacheStatus)와 같은 기준', () => {
        // [].every(...)는 true라 예전 휴지통 복구 경로는 여기서 'completed'를 저장했다
        expect(saveStatusOf([])).toBe('extracted');
        expect(saveStatusOf(null)).toBe('extracted');
    });
});

describe('기록 창 배지(cacheStatusOf)', () => {
    const doc = (analyzed, total, status) => ({ data: Array.from({ length: total }, (_, i) => ({ isAnalyzed: i < analyzed })), metadata: { status } });
    it('전부 분석이면 COMPLETED', () => {
        expect(cacheStatusOf(doc(3, 3, 'completed')).statusText).toBe('COMPLETED');
    });
    it('덜 분석됐어도 지금 돌고 있을 때만 깜박이는 ANALYZING', () => {
        const s = cacheStatusOf(doc(233, 258, 'analyzing'), { running: true });
        expect(s.statusText).toBe('ANALYZING');
        expect(s.badgeColor).toMatch(/animate-pulse/);
    });
    it('실측 #13: 233/258에서 실패가 남은 채 끝나면 깜박이지 않는 "일부 실패"', () => {
        const s = cacheStatusOf(doc(233, 258, 'partial'));
        expect(s.statusText).toBe('일부 실패');
        expect(s.badgeColor).not.toMatch(/animate-pulse/);
        expect(s.progressText).toBe('233/258 Sentences');
    });
    it('중간에 멈춘 대본은 "멈춤"(깜박임 없음)', () => {
        const s = cacheStatusOf(doc(100, 258, 'analyzing'));
        expect(s.statusText).toBe('멈춤');
        expect(s.badgeColor).not.toMatch(/animate-pulse/);
    });
    it('전사만 끝난 대본은 READY', () => {
        expect(cacheStatusOf(doc(0, 50, 'extracted')).statusText).toBe('READY');
    });
});
