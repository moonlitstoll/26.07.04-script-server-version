import { describe, it, expect } from 'vitest';
import { splitGlossPairs, splitGlossWords } from '../analysisParser';

// 괄호 안 단어 풀이를 "단어: 뜻 +" 묶음으로 나눈다 — 화면에서 한 쌍이 줄 끝에서 갈라지지 않게 묶고,
// 쌍점·더하기 기호를 흐리게 보여 주려고(2026-11-17).
const texts = (s) => splitGlossPairs(s).map(u => u.parts.map(p => p.text).join(''));
const afters = (s) => splitGlossPairs(s).map(u => u.after);
const marks = (s) => splitGlossPairs(s).flatMap(u => u.parts.filter(p => p.type === 'mark').map(p => p.text));
const joined = (s) => splitGlossPairs(s).map(u => u.parts.map(p => p.text).join('') + u.after).join('');

describe('단어 풀이를 쌍 묶음으로 나누기', () => {
    it('묶음은 "단어: 뜻 +"까지이고, 더하기 뒤 공백은 묶음 밖이다 (휴대폰 실측 줄)', () => {
        const s = '(Và: 그리고 + đây: 여기 + là: ~이다)';
        expect(texts(s)).toEqual(['(Và: 그리고 +', 'đây: 여기 +', 'là: ~이다)']);
        expect(afters(s)).toEqual([' ', ' ', '']);
    });

    it('묶음 안은 [글자, 단어, 쌍점, 글자, 더하기] 조각이다', () => {
        expect(splitGlossPairs('(Và: 그리고 + là: ~이다)')).toEqual([
            { parts: [
                { type: 'text', text: '(' }, { type: 'word', text: 'Và' }, { type: 'mark', text: ':' },
                { type: 'text', text: ' 그리고 ' }, { type: 'mark', text: '+' },
            ], after: ' ' },
            { parts: [
                { type: 'word', text: 'là' }, { type: 'mark', text: ':' }, { type: 'text', text: ' ~이다)' },
            ], after: '' },
        ]);
    });

    it('뜻 안의 괄호 속 "+"로는 묶음을 나누지 않는다', () => {
        expect(texts('(xuất hiện: 출현(날 출 + 나타날 현) + rồi: 이미)')).toEqual(['(xuất hiện: 출현(날 출 + 나타날 현) +', 'rồi: 이미)']);
        expect(marks('(xuất hiện: 출현(날 출 + 나타날 현) + rồi: 이미)')).toEqual([':', '+', ':']);
        expect(texts('(xem phim 18+: 성인 영화를 보다 + nhé: ~요)')).toEqual(['(xem phim 18+: 성인 영화를 보다 +', 'nhé: ~요)']);
    });

    it('쌍점 기호는 단어 바로 뒤의 첫 쌍점뿐이다', () => {
        expect(marks('(giờ: 시간: 때 + này: 이)')).toEqual([':', '+', ':']);
        expect(marks('(lúc bảy giờ ba mươi(7:30): 7시 30분에)')).toEqual([':']);
        expect(marks('(Và：그리고)')).toEqual(['：']);
    });

    it('단어가 없는 묶음은 쌍점을 기호로 떼지 않는다 (더하기는 뗀다)', () => {
        expect(splitGlossPairs('(참고: 구어체)')).toEqual([{ parts: [{ type: 'text', text: '(참고: 구어체)' }], after: '' }]);
        expect(splitGlossPairs('(날 출 + 나타날 현)')).toEqual([
            { parts: [{ type: 'text', text: '(날 출 ' }, { type: 'mark', text: '+' }], after: ' ' },
            { parts: [{ type: 'text', text: '나타날 현)' }], after: '' },
        ]);
    });

    it('단어 조각에는 앞뒤 공백이 들어가지 않는다', () => {
        const words = (s) => splitGlossPairs(s).flatMap(u => u.parts.filter(p => p.type === 'word').map(p => p.text));
        expect(words('(  Và :  그리고  +  đây: 여기 )')).toEqual(['Và', 'đây']);
        expect(words('(sau: ~후에 + ba(3): 셋 + thử thách: 도전)')).toEqual(['sau', 'ba(3)', 'thử thách']);
    });

    it('묶음과 사이 공백을 이으면 항상 원래 글자다', () => {
        for (const s of [
            '(Và: 그리고 + đây: 여기 + là: ~이다)',
            '(sau: ~후에 + ba(3): 셋 + thử thách: 도전) ',
            '(xuất hiện: 출현(날 출 + 나타날 현) + rồi: 이미)',
            '(날 출 + 나타날 현)',
            '(  Và :  그리고  +  đây: 여기 )',
            '(Và：그리고)',
            '( + Và: 그리고)',
            '(Và: 그리고 + )',
            '괄호 없는 글',
            '(닫히지 않은 괄호',
            '',
        ]) expect(joined(s)).toBe(s);
    });

    it('괄호 묶음이 아니면 통째로 글자 한 묶음', () => {
        expect(splitGlossPairs('괄호 없는 글')).toEqual([{ parts: [{ type: 'text', text: '괄호 없는 글' }], after: '' }]);
        expect(splitGlossPairs('')).toEqual([]);
        expect(splitGlossPairs(undefined)).toEqual([]);
    });

    it('단어 고르기(splitGlossWords)와 같은 단어를 고른다', () => {
        for (const s of [
            '(Và: 그리고 + đây: 여기 + là: ~이다)',
            '(búng tay: 튕기다〈튀기다·손〉 + cái: 개(단위))',
            '(Quay: 찍다←돌리다 + công viên: 공원♪)',
            '(참고: 구어체)',
            '(Và: 그리고 + 그냥 설명)',
        ]) {
            const a = splitGlossPairs(s).flatMap(u => u.parts.filter(p => p.type === 'word').map(p => p.text));
            const b = splitGlossWords(s).filter(p => p.word).map(p => p.text);
            expect(a).toEqual(b);
        }
    });
});
