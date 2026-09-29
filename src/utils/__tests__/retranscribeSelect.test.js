import { describe, it, expect } from 'vitest';
import { selectWindowSentences } from '../../services/gemini';

// 실측 화면(2026-09, "1 Tiếng Ăn 1 Lần tại Circle K" 6:21~6:30)
const A = 'Ở đây thì mình có một cái vòng quay màu sắc, quay ra màu gì thì mình ăn màu đấy thôi.';
const NAO = 'Nào, bữa ăn thứ sáu(6) của chúng ta sẽ là màu gì nào?';
const MAU = 'Màu gì, màu gì, đây?';
const L = (seconds, text) => ({ seconds, text, o: text });
const texts = (r) => r.clean.map(s => s.text);

describe('구간 재전사 — 이웃 조각 거르기', () => {
    // 구간 = "Màu gì…" 문장(388.5~392), 앞 이웃 = "Nào…" 문장
    const bounds = { blockStart: 388.5, blockEnd: 392, winStart: 386.5, winEnd: 395 };
    const lines = [L(388.3, 'sẽ là màu gì nào?'), L(388.5, MAU)];

    it('실측: 앞 문장과 단어 80%가 겹치는 진짜 새 문장은 지키고, 앞 문장에 통째로 든 조각만 버린다', () => {
        const w = { recover: true, prevText: NAO, nextText: '', dropLeakedFrom: [NAO] };
        expect(texts(selectWindowSentences(lines, w, bounds))).toEqual([MAU]);
    });

    it('같은 입력을 기존 복구 규칙(단어 70% 겹침)으로 거르면 진짜 문장까지 사라진다 — 구간 재전사가 따로 규칙을 쓰는 이유', () => {
        const w = { recover: true, prevText: NAO, nextText: '', dropSimilarTo: [NAO] };
        expect(texts(selectWindowSentences(lines, w, bounds))).toEqual([]);
    });

    it('짧은 진짜 문장("Lục, xanh.")이 이웃과 단어가 겹쳐도 구간 재전사에선 남는다(복구에선 경계 파편으로 버림)', () => {
        const prev = 'Màu xanh lục, đẹp quá.';
        const one = [L(390, 'Lục, xanh.')];
        const b = { blockStart: 389.8, blockEnd: 392, winStart: 387.8, winEnd: 395 };
        expect(texts(selectWindowSentences(one, { recover: true, prevText: prev, dropLeakedFrom: [prev] }, b))).toEqual(['Lục, xanh.']);
        expect(texts(selectWindowSentences(one, { recover: true, prevText: prev }, b))).toEqual([]);
    });
});

describe('복구 모드 — 시각 규칙', () => {
    it('구간 안(시작-0.3 ~ 끝-0.05)만 받고, 남아 있는 이웃 시작과 0.35초 이내면 파편으로 버린다', () => {
        const lines = [
            L(376.0, A),                                              // 구간 시작 0.3초보다 앞 → 제외
            L(381.2, 'Nào, bữa ăn thứ sáu(6) của chúng ta.'),         // 채택
            L(383.9, 'Quay ra màu gì thì mình ăn màu đấy thôi nhé.'), // 이웃 시작(384.2)과 0.3초 → 파편
            L(385.97, 'Hôm nay ăn gì đây các bạn ơi?'),               // 끝(386)-0.05 이후 → 제외
        ];
        const w = { recover: true, boundaryTimes: [384.2] };
        const r = selectWindowSentences(lines, w, { blockStart: 381, blockEnd: 386, winStart: 379, winEnd: 389 });
        expect(texts(r)).toEqual(['Nào, bữa ăn thứ sáu(6) của chúng ta.']);
    });
});

describe('교체 모드(문장별 다시)', () => {
    it('앞·뒤 이웃이 딸려 와도 대상 원문과 가장 닮은 줄만 남긴다', () => {
        const lines = [L(386.0, NAO), L(388.5, 'Màu gì, màu gì, đây vậy?'), L(391.0, 'Màu xanh lá cây nhé các bạn.')];
        const w = { selfText: MAU, prevText: NAO, nextText: 'Màu xanh lá cây nhé các bạn.' };
        const r = selectWindowSentences(lines, w, { blockStart: 388.5, blockEnd: 391, winStart: 386.5, winEnd: 394 });
        expect(texts(r)).toEqual(['Màu gì, màu gì, đây vậy?']);
    });

    it('첫 줄 머리에 붙은 앞 문장 꼬리는 단어 단위로 잘라낸다', () => {
        const lines = [L(388.4, 'màu gì nào? Màu gì, màu gì, đây?')];
        const w = { selfText: MAU, prevText: NAO, nextText: '' };
        const r = selectWindowSentences(lines, w, { blockStart: 388.5, blockEnd: 391, winStart: 386.5, winEnd: 394 });
        expect(texts(r)).toEqual([MAU]);
    });
});
