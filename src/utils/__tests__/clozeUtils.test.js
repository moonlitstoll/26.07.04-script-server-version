// buildCloze — 가리기 학습(클로즈)의 출제 로직.
//
// 시드(idx + round + difficulty) 기반이라 같은 입력이면 항상 같은 문제가 나온다.
// 토글을 껐다 켜도 문제가 안 바뀌는 게 이 성질 덕분이므로, 재현성이 깨지면 학습 흐름이 망가진다.
import { describe, it, expect } from 'vitest';
import { buildCloze } from '../clozeUtils';

// 청크 n개짜리 분석 문자열을 가진 문장을 만든다
const mk = (n) => ({
    isAnalyzed: true,
    text: 'x',
    translation: '테스트 번역',
    analysis: Array.from({ length: n }, (_, i) => `**chunk${i}**: 뜻${i}`).join('\n'),
});

describe('회상(recall) 모드', () => {
    it('청크를 전부 가리고 recall 플래그를 세운다', () => {
        const r = buildCloze(mk(3), 5, 0, 'recall');
        expect(r.ok).toBe(true);
        expect(r.recall).toBe(true);
        expect(r.wholeSentence).toBe(true);
        expect(r.hiddenCount).toBe(3);
        expect(r.parts.every(p => p.type === 'blank')).toBe(true);
    });

    it('정답과 뜻을 함께 보존한다 (번역 단서 렌더용)', () => {
        const r = buildCloze(mk(3), 5, 0, 'recall');
        expect(r.parts[0].answer).toBe('chunk0');
        expect(r.parts[0].meaning).toBe('뜻0');
    });

    it('청크가 1개여도 동일하게 동작한다', () => {
        const r = buildCloze(mk(1), 2, 0, 'recall');
        expect([r.ok, r.recall, r.wholeSentence, r.hiddenCount]).toEqual([true, true, true, 1]);
    });

    it('분석 전(청크 0개)이면 ok:false — 단 recall 플래그는 유지', () => {
        const r = buildCloze({ isAnalyzed: false, text: 'x' }, 0, 0, 'recall');
        expect(r.ok).toBe(false);
        expect(r.recall).toBe(true);
    });
});

describe('난이도별 가리기 개수', () => {
    it('고급(hard)은 전체를 가리되 recall 플래그는 세우지 않는다', () => {
        // recall이 켜지면 번역 단서 박스가 렌더돼 난이도가 달라진다.
        const r = buildCloze(mk(3), 5, 0, 'hard');
        expect(r.ok).toBe(true);
        expect(r.wholeSentence).toBe(true);
        expect(r.recall).toBe(false);
    });

    it('초급(easy)은 1~2개만 가리고 문맥을 남긴다', () => {
        for (let idx = 0; idx < 40; idx++) {
            for (let round = 0; round < 3; round++) {
                const e = buildCloze(mk(5), idx, round, 'easy');
                expect(e.hiddenCount, `easy idx${idx} round${round}`).toBeGreaterThanOrEqual(1);
                expect(e.hiddenCount, `easy idx${idx} round${round}`).toBeLessThanOrEqual(2);
                expect(e.wholeSentence).toBe(false);
                expect(e.recall).toBe(false);
            }
        }
    });

    it('중급(mid)은 절반 이상을 가리되 최소 1청크는 남긴다', () => {
        for (let idx = 0; idx < 40; idx++) {
            for (let round = 0; round < 3; round++) {
                const m = buildCloze(mk(5), idx, round, 'mid');
                expect(m.hiddenCount, `mid idx${idx} round${round}`).toBeGreaterThanOrEqual(2);
                expect(m.hiddenCount, `mid idx${idx} round${round}`).toBeLessThanOrEqual(4);
                expect(m.wholeSentence).toBe(false);
                expect(m.recall).toBe(false);
            }
        }
    });
});

describe('시드 재현성', () => {
    it('같은 입력이면 항상 같은 문제가 나온다', () => {
        const a = JSON.stringify(buildCloze(mk(4), 7, 1, 'recall'));
        const b = JSON.stringify(buildCloze(mk(4), 7, 1, 'recall'));
        expect(a).toBe(b);
    });

    it("'새 문제'(round 변경)면 다른 문제가 나온다", () => {
        // 5청크 중 일부만 가리는 난이도라야 라운드별 차이가 드러난다.
        const rounds = new Set(
            Array.from({ length: 8 }, (_, round) =>
                JSON.stringify(buildCloze(mk(5), 3, round, 'easy').parts.map(p => p.type))),
        );
        expect(rounds.size).toBeGreaterThan(1);
    });
});
