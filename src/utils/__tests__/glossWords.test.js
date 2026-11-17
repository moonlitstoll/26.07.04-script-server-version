import { describe, it, expect } from 'vitest';
import { splitGlossWords } from '../analysisParser';

// 괄호 안 단어 풀이에서 원어 단어만 골라낸다 — 화면에서 단어만 색을 달리 보여 주려고(2026-11-17).
const words = (s) => splitGlossWords(s).filter(p => p.word).map(p => p.text);
const joined = (s) => splitGlossWords(s).map(p => p.text).join('');

describe('단어 풀이에서 원어 단어 고르기', () => {
    it('"단어: 뜻 + 단어: 뜻"에서 단어만 고른다 (휴대폰 실측 줄)', () => {
        expect(words('(Và: 그리고 + đây: 여기 + là: ~이다)')).toEqual(['Và', 'đây', 'là']);
        expect(words('(Các bạn: 여러분 + có thể: ~할 수 있다 + thấy: 보다)')).toEqual(['Các bạn', 'có thể', 'thấy']);
    });

    it('숫자·기호를 같이 적은 단어는 괄호까지 한 단어다', () => {
        expect(words('(sau: ~후에 + ba(3): 셋 + thử thách: 도전)')).toEqual(['sau', 'ba(3)', 'thử thách']);
        expect(words('(hơn: ~이상 + phần trăm(%): 퍼센트)')).toEqual(['hơn', 'phần trăm(%)']);
        // 단어에 붙은 괄호 안의 쌍점(시각 표기)은 단어·뜻을 가르는 쌍점이 아니다
        expect(words('(lúc bảy giờ ba mươi(7:30): 7시 30분에)')).toEqual(['lúc bảy giờ ba mươi(7:30)']);
    });

    it('뜻 안의 괄호·〈〉·화살표·♪는 단어가 아니다', () => {
        expect(words('(búng tay: 튕기다〈튀기다·손〉 + cái: 개(단위))')).toEqual(['búng tay', 'cái']);
        expect(words('(Quay: 찍다←돌리다 + công viên: 공원♪)')).toEqual(['Quay', 'công viên']);
        expect(words('(ba: 셋(3) + thử thách: 도전)')).toEqual(['ba', 'thử thách']);
    });

    it('뜻 안의 괄호 속 "+"로는 나누지 않는다 (옛 저장본의 한자 풀이)', () => {
        expect(words('(xuất hiện: 출현(날 출 + 나타날 현) + rồi: 이미)')).toEqual(['xuất hiện', 'rồi']);
        expect(words('(búng tay: 튕기다(búng: 튀기다 + tay: 손))')).toEqual(['búng tay']);
    });

    it('공백 없이 붙은 "+"는 항목을 가르지 않는다 (18+)', () => {
        expect(words('(xem phim 18+: 성인 영화를 보다 + nhé: ~요)')).toEqual(['xem phim 18+', 'nhé']);
    });

    it('한 항목에 쌍점이 여러 개면 첫 쌍점 앞만 단어다', () => {
        expect(words('(giờ: 시간: 때 + này: 이)')).toEqual(['giờ', 'này']);
    });

    it('쌍점이 없거나 앞이 한글이면 고르지 않는다', () => {
        expect(words('(날 출 + 나타날 현)')).toEqual([]);
        expect(words('(참고: 구어체)')).toEqual([]);
        expect(words('(Và: 그리고 + 그냥 설명)')).toEqual(['Và']);
    });

    it('조각을 이으면 항상 원래 글자다', () => {
        for (const s of [
            '(Và: 그리고 + đây: 여기 + là: ~이다)',
            '(sau: ~후에 + ba(3): 셋 + thử thách: 도전) ',
            '(xuất hiện: 출현(날 출 + 나타날 현) + rồi: 이미)',
            '(날 출 + 나타날 현)',
            '(  Và :  그리고  +  đây: 여기 )',
            '(Và：그리고)',
            '괄호 없는 글',
            '(닫히지 않은 괄호',
            '',
        ]) expect(joined(s)).toBe(s);
    });

    it('단어 조각에는 앞뒤 공백이 들어가지 않는다', () => {
        expect(words('(  Và :  그리고  +  đây: 여기 )')).toEqual(['Và', 'đây']);
        expect(words('(Và：그리고)')).toEqual(['Và']);
    });

    it('괄호 묶음이 아니면 통째로 글자 한 조각', () => {
        expect(splitGlossWords('괄호 없는 글')).toEqual([{ word: false, text: '괄호 없는 글' }]);
        expect(splitGlossWords('')).toEqual([]);
        expect(splitGlossWords(undefined)).toEqual([]);
    });
});
