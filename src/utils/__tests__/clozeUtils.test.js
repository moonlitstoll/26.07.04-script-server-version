// buildCloze — 가리기 학습(클로즈)의 출제 로직.
//
// 시드(idx + round + difficulty) 기반이라 같은 입력이면 항상 같은 문제가 나온다.
// 토글을 껐다 켜도 문제가 안 바뀌는 게 이 성질 덕분이므로, 재현성이 깨지면 학습 흐름이 망가진다.
import { describe, it, expect } from 'vitest';
import { buildCloze, DRILL_RATIOS } from '../clozeUtils';

// 청크 n개, 청크마다 단어 w개인 문장 (뜻풀이 없음 → 한 단어씩 가린다)
const mk = (n, w = 4) => ({
    isAnalyzed: true,
    text: 'x',
    translation: '테스트 번역',
    analysis: Array.from({ length: n }, (_, i) =>
        `**${Array.from({ length: w }, (_, j) => `w${i}x${j}`).join(' ')}**: 뜻${i}`).join('\n'),
});
const blanks = (r) => r.parts.filter(p => p.type === 'blank');
const shown = (r) => r.parts.map(p => p.type === 'blank' ? p.answer : p.value).join(' ');

describe('난이도별 가리는 비율', () => {
    it('비율은 초급 25 · 중급 50 · 고급 75 · 전체 100%', () => {
        expect(DRILL_RATIOS).toEqual({ easy: 0.25, mid: 0.5, hard: 0.75, full: 1 });
    });

    it.each([['easy', 5], ['mid', 10], ['hard', 15]])('%s는 20단어 중 %i단어를 가리고 문맥을 남긴다', (level, want) => {
        for (let idx = 0; idx < 40; idx++) {
            for (let round = 0; round < 3; round++) {
                const r = buildCloze(mk(5), idx, round, level);
                expect(r.wordCount).toBe(20);
                expect(r.hiddenWords, `${level} idx${idx} round${round}`).toBe(want);
                expect(r.wholeSentence).toBe(false);
            }
        }
    });

    it('청크가 1개뿐인 문장도 초급이면 통째로 가리지 않는다', () => {
        const r = buildCloze(mk(1, 8), 0, 0, 'easy');
        expect(r.hiddenWords).toBe(2);
        expect(r.wholeSentence).toBe(false);
    });

    it('전체는 청크별 빈칸으로 문장을 통째로 가린다', () => {
        const r = buildCloze(mk(3), 5, 0, 'full');
        expect(r.wholeSentence).toBe(true);
        expect(r.hiddenWords).toBe(12);
        expect(r.parts.every(p => p.type === 'blank')).toBe(true);
        expect(blanks(r)).toHaveLength(3);
    });

    it('두 단어 문장의 고급도 한 단어는 남긴다', () => {
        const r = buildCloze(mk(1, 2), 0, 0, 'hard');
        expect(r.hiddenWords).toBe(1);
    });

    it('단어가 하나뿐이면 어느 난이도든 그 단어를 가린다', () => {
        for (const level of ['easy', 'mid', 'hard', 'full']) {
            expect(buildCloze(mk(1, 1), 0, 0, level).wholeSentence).toBe(true);
        }
    });

    it('모르는 난이도는 초급처럼 동작한다', () => {
        expect(buildCloze(mk(5), 1, 0, 'zzz').hiddenWords).toBe(5);
    });
});

describe('낱말 경계', () => {
    const item = {
        isAnalyzed: true, text: 'x', translation: '번역',
        analysis: '**so với khẩu vị của mình**: 내 입맛에 비해 (so với: ~에 비해 + khẩu vị: 입맛 + của: ~의 + mình: 나)',
    };

    it('뜻풀이의 두 음절 낱말은 절대 갈리지 않는다', () => {
        for (const level of ['easy', 'mid', 'hard']) {
            for (let idx = 0; idx < 60; idx++) {
                const r = buildCloze(item, idx, 0, level);
                for (const p of r.parts) {
                    const t = p.type === 'blank' ? p.answer : p.value;
                    for (const pair of [['so', 'với'], ['khẩu', 'vị']]) {
                        const a = t.split(' ');
                        expect(a.at(-1) === pair[0], `${level}: "${t}"`).toBe(false);
                        expect(a[0] === pair[1], `${level}: "${t}"`).toBe(false);
                    }
                }
            }
        }
    });

    it('이어진 낱말은 빈칸 하나로 묶고, 합치면 원래 문장이다', () => {
        const r = buildCloze(item, 3, 0, 'hard');
        expect(shown(r)).toBe('so với khẩu vị của mình');
        expect(r.parts.some((p, i) => p.type === 'blank' && r.parts[i + 1]?.type === 'blank')).toBe(false);
    });

    it('숫자 병기가 붙은 낱말도 풀이와 맞춘다', () => {
        const r = buildCloze({ ...item, analysis: '**hai mươi tư(24) giờ**: 24시간 (hai mươi tư: 24 + giờ: 시간)' }, 0, 0, 'mid');
        expect(r.wordCount).toBe(4);
        expect(shown(r)).toBe('hai mươi tư(24) giờ');
        expect(['hai mươi tư(24)', 'giờ']).toContain(blanks(r)[0].answer);
    });
});

describe('분석 전 문장', () => {
    it('청크가 없으면 ok:false', () => {
        const r = buildCloze({ isAnalyzed: false, text: 'x' }, 0, 0, 'full');
        expect(r.ok).toBe(false);
        expect(r.parts).toEqual([]);
    });
});

describe('시드 재현성', () => {
    it('같은 입력이면 항상 같은 문제가 나온다', () => {
        expect(JSON.stringify(buildCloze(mk(4), 7, 1, 'mid'))).toBe(JSON.stringify(buildCloze(mk(4), 7, 1, 'mid')));
    });

    it("'새 문제'(round 변경)면 다른 문제가 나온다", () => {
        const rounds = new Set(
            Array.from({ length: 8 }, (_, round) => JSON.stringify(buildCloze(mk(5), 3, round, 'easy').parts)),
        );
        expect(rounds.size).toBeGreaterThan(1);
    });
});
