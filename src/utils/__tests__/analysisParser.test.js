import { describe, it, expect } from 'vitest';
import { splitBreakdown } from '../analysisParser';

// 실측 분석 줄(휴대폰 화면, "Ở đây thì mình có một cái vòng quay màu sắc…" 문장)
describe('분석 줄에서 요소 풀이 떼기', () => {
    it('줄 끝 괄호 풀이를 떼어낸다 (중첩 괄호 포함)', () => {
        expect(splitBreakdown('**Ở đây thì**: 여기서는 (Ở đây: 여기 + thì: ~라면)'))
            .toEqual(['**Ở đây thì**: 여기서는 ', '(Ở đây: 여기 + thì: ~라면)', '']);
        expect(splitBreakdown('**mình có một cái vòng quay màu sắc**: 저는 색깔 돌림판이 하나 있어요 (mình: 나 + có: 가지다 + một: 하나 + cái: 개(단위) + vòng quay: 돌림판 + màu sắc: 색깔)')[1])
            .toBe('(mình: 나 + có: 가지다 + một: 하나 + cái: 개(단위) + vòng quay: 돌림판 + màu sắc: 색깔)');
    });

    it('뜻에 붙은 짧은 괄호·숫자 병기는 풀이가 아니다', () => {
        expect(splitBreakdown('**cái**: 개(단위)')).toEqual(['**cái**: 개(단위)', '', '']);
        expect(splitBreakdown('**một nghìn(1.000)**: 천 동')).toEqual(['**một nghìn(1.000)**: 천 동', '', '']);
        expect(splitBreakdown('**bà**: 할머니 (친근한 호칭)')).toEqual(['**bà**: 할머니 (친근한 호칭)', '', '']);
    });

    it('뒤에 붙은 〔⚡실제 …〕는 꼬리로 떼고 풀이는 그대로 찾는다', () => {
        expect(splitBreakdown('**như lồn**: 형편없다 (như: ~같다 + lồn: 비속어) 〔⚡실제: 최악이다(욕설)〕'))
            .toEqual(['**như lồn**: 형편없다 ', '(như: ~같다 + lồn: 비속어)', ' 〔⚡실제: 최악이다(욕설)〕']);
    });

    it('세 조각을 이으면 항상 원래 줄이다', () => {
        for (const s of ['', '뜻만 있는 줄', '**a**: b (a: c) ', '(x: y)', '**a**: b (c: d', 'b (c: d))']) {
            expect(splitBreakdown(s).join('')).toBe(s);
        }
    });
});
