import { describe, it, expect } from 'vitest';
import { saveStatusOf } from '../cacheStatus';

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
