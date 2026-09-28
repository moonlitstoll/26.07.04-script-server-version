import { describe, it, expect } from 'vitest';
import {
    formatStamp, estimateSplitTime, sentenceEndOf, splitTimeBounds, applySplit,
    rangeFromSelection, indicesInRange, rangeNeighbors, clampRange, replaceRange, isLeakedFrom,
} from '../sentenceEdit';
import { sanitizeData } from '../mediaUtils';

// 실측 화면(2026-09, "1 Tiếng Ăn 1 Lần tại Circle K" 6:21~6:28)
const A = 'Ở đây thì mình có một cái vòng quay màu sắc, quay ra màu gì thì mình ăn màu đấy thôi.';
const S = (seconds, text, extra = {}) => ({
    s: formatStamp(seconds), timestamp: formatStamp(seconds), seconds, startSeconds: seconds,
    o: text, text, translation: '번역', analysis: '**x**: y', a: '**x**: y', isAnalyzed: true, ...extra,
});
const DATA = [
    S(376.6, 'Và bữa ăn thứ sáu(6) này thì mình quyết định thay đổi một chút.'),
    S(381.0, A, { speechEnd: 385.9 }),
    S(386.3, 'Nào, bữa ăn thứ sáu(6) của chúng ta sẽ là màu gì nào?'),
    S(388.5, 'Màu gì, màu gì, đây?'),
];
const HEAD_WORDS = 11; // "Ở đây thì mình có một cái vòng quay màu sắc," 까지 11단어

describe('시각 표기', () => {
    it('전사와 같은 "MM:SS.ss" 형식', () => {
        expect(formatStamp(381)).toBe('06:21.00');
        expect(formatStamp(5.3)).toBe('00:05.30');
        expect(formatStamp(3725.25)).toBe('62:05.25');
    });
});

describe('나눌 곳 시각 어림', () => {
    it('대사 끝 시각이 있으면 그걸 끝으로 쓴다(뒤 무음·음악 제외)', () => {
        expect(sentenceEndOf(DATA, 1)).toBe(385.9);
        expect(sentenceEndOf(DATA, 0)).toBe(381.0); // 없으면 다음 문장 시작
        expect(sentenceEndOf(DATA, 3, 724)).toBe(724); // 마지막 문장은 영상 끝
    });
    it('공백을 뺀 글자 수 비율로 나눈다', () => {
        const t = estimateSplitTime(381.0, 385.9, A, HEAD_WORDS);
        // 앞 11단어 = 공백 뺀 34자, 전체 65자 → 381.0 + 4.9 × 34/65 ≈ 383.56
        expect(t).toBeCloseTo(381.0 + 4.9 * (34 / 65), 5);
        // 공백까지 세면(43/86) 383.45 — 방식이 바뀌면 이 값이 달라진다
        expect(t).not.toBeCloseTo(381.0 + 4.9 * (43 / 86), 2);
    });
    it('허용 범위는 문장 시작 뒤 ~ 다음 문장 시작 앞', () => {
        expect(splitTimeBounds(DATA, 1)).toEqual({ min: 381.05, max: 386.25 });
    });
});

describe('문장 나누기', () => {
    it('앞부분 삭제(캡처 요청): 뒷부분만 남고 시작이 옮겨지며, 다시 분석 상태가 된다', () => {
        const r = applySplit(DATA, 1, { wordIndex: HEAD_WORDS, mode: 'dropHead', splitSeconds: 383.4 });
        expect(r.data).toHaveLength(4);
        const kept = r.data[1];
        expect(kept.text).toBe('quay ra màu gì thì mình ăn màu đấy thôi.');
        expect(kept.o).toBe(kept.text);
        expect(kept.seconds).toBe(383.4);
        expect(kept.timestamp).toBe('06:23.40');
        expect(kept.isAnalyzed).toBe(false);
        expect(kept.speechEnd).toBe(385.9); // 끝은 그대로라 대사 끝 시각은 유지
        expect(r.trashed.map(x => x.text)).toEqual(['Ở đây thì mình có một cái vòng quay màu sắc,']);
        expect(r.trashed[0].seconds).toBe(381.0);
        expect(r.changed).toEqual([1]);
    });

    it('뒷부분 삭제: 앞부분만 남고 대사 끝 시각은 비운다(끝이 잘렸으므로)', () => {
        const r = applySplit(DATA, 1, { wordIndex: HEAD_WORDS, mode: 'dropTail', splitSeconds: 383.4 });
        expect(r.data[1].text).toBe('Ở đây thì mình có một cái vòng quay màu sắc,');
        expect(r.data[1].seconds).toBe(381.0);
        expect('speechEnd' in r.data[1]).toBe(false);
        expect(r.trashed[0].seconds).toBe(383.4);
    });

    it('둘 다 남기기: 두 문장이 되고 둘 다 다시 분석', () => {
        const r = applySplit(DATA, 1, { wordIndex: HEAD_WORDS, mode: 'keepBoth', splitSeconds: 383.4 });
        expect(r.data.map(d => d.seconds)).toEqual([376.6, 381.0, 383.4, 386.3, 388.5]);
        expect(r.changed).toEqual([1, 2]);
        expect(r.trashed).toEqual([]);
        expect(r.data.slice(1, 3).every(d => !d.isAnalyzed)).toBe(true);
    });

    it('저장 정리(sanitizeData)를 거쳐도 새 시각·본문·미분석 상태가 유지된다', () => {
        const r = applySplit(DATA, 1, { wordIndex: HEAD_WORDS, mode: 'dropHead', splitSeconds: 383.4 });
        const clean = sanitizeData(r.data, 724);
        expect(clean[1].seconds).toBeCloseTo(383.4, 5);
        expect(clean[1].text).toBe('quay ra màu gì thì mình ăn màu đấy thôi.');
        expect(clean[1].isAnalyzed).toBe(false);
        expect(clean[0].isAnalyzed).toBe(true); // 다른 문장은 그대로
    });

    it('단어가 하나뿐이면 나눌 수 없다', () => {
        expect(() => applySplit([S(1, 'Wow.')], 0, { wordIndex: 1, mode: 'keepBoth', splitSeconds: 1.2 })).toThrow();
    });
});

describe('구간 재전사 범위', () => {
    it('떨어진 두 문장을 골라도 처음~끝 한 구간(사이 문장 포함)', () => {
        expect(rangeFromSelection(DATA, [2, 0], 724)).toEqual({ start: 376.6, end: 388.5 });
    });
    it('마지막 문장까지 고르면 끝은 영상 끝', () => {
        expect(rangeFromSelection(DATA, [3], 724)).toEqual({ start: 388.5, end: 724 });
    });
    it('같은 시각으로 묶인 형제 문장까지 넓힌다', () => {
        const d = [S(1, 'a b'), S(5, 'c d'), S(5, 'e f'), S(9, 'g h')];
        expect(rangeFromSelection(d, [2], 20)).toEqual({ start: 5, end: 9 });
    });
    it('교체 대상은 시작 시각이 구간 안인 문장만 — 걸친 문장은 제외', () => {
        // 시작을 문장 A 중간(383.4)으로 옮기면 A(381.0 시작)는 교체하지 않는다
        expect(indicesInRange(DATA, 383.4, 388.5)).toEqual([2]);
        expect(indicesInRange(DATA, 381.0, 388.5)).toEqual([1, 2]);
        expect(rangeNeighbors(DATA, 383.4, 388.5)).toEqual({ prev: 1, next: 3 });
    });
    it('이웃에서 새어 나온 조각만 버린다 — 단어가 많이 겹치는 진짜 새 문장은 지킨다 (실측)', () => {
        // 구간 앞에서 시작해 걸친 문장 A의 꼬리가 새 결과 첫 줄로 딸려 온 경우 → 버림
        expect(isLeakedFrom('quay ra màu gì thì mình ăn màu đấy thôi.', A)).toBe(true);
        // 실측: 단어 80%가 앞 문장과 겹치지만 실제로 새로 말한 문장 → 지킴
        expect(isLeakedFrom('Màu gì, màu gì, đây?', 'Nào, bữa ăn thứ sáu(6) của chúng ta sẽ là màu gì nào?')).toBe(false);
        // 너무 짧은 조각(3글자 이하)은 우연히 들어 있을 수 있어 판단하지 않는다
        expect(isLeakedFrom('À.', 'Àlà')).toBe(false);
    });
    it('조정 범위 제한: 0 이상, 영상 끝 이하, 최소 0.5초', () => {
        expect(clampRange(-1, 5, 10)).toEqual({ start: 0, end: 5 });
        expect(clampRange(8, 12, 10)).toEqual({ start: 8, end: 10 });
        expect(clampRange(5, 5.2, 10)).toEqual({ start: 5, end: 5.5 });
        expect(clampRange(9.8, 10, 10)).toEqual({ start: 9.5, end: 10 });
    });
    it('교체: 구간 안 옛 문장을 빼고 새 문장을 시각 순으로 끼운다', () => {
        const fresh = [S(381.1, 'Ở đây thì mình có một cái vòng quay màu sắc.'), S(383.5, 'Quay ra màu gì thì mình ăn màu đấy thôi.')];
        const r = replaceRange(DATA, 381.0, 386.3, fresh);
        expect(r.removed.map(x => x.seconds)).toEqual([381.0]);
        expect(r.data.map(x => x.seconds)).toEqual([376.6, 381.1, 383.5, 386.3, 388.5]);
    });
});
