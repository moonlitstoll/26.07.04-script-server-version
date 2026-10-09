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

// 괄호 속 괄호 안전망 — 실측 이탈(2026-10-09, v4 시험 중 Vạn Sự Như Ý·Gara Hạnh Phúc)을 그대로 박아 둔다.
import { flattenNestedParens } from '../analysisParser';
describe('괄호 속 괄호 안전망', () => {
    it('뜻 뒤에 붙은 종류 꼬리표는 가운뎃점으로', () => {
        expect(flattenNestedParens('**Tằng... tằng**: 쨍... 쨍 (Tằng: 쨍(종소리))'))
            .toBe('**Tằng... tằng**: 쨍... 쨍 (Tằng: 쨍·종소리)');
        expect(flattenNestedParens('**Ai ơi**: 누구든 (Ai: 누구 + ơi: ~아(호격))'))
            .toBe('**Ai ơi**: 누구든 (Ai: 누구 + ơi: ~아·호격)');
    });
    it('뜻 앞머리 괄호(화살표 뒤)는 괄호만 벗긴다', () => {
        expect(flattenNestedParens('**bao cân căng**: 몇 킬로그램을? (bao: 몇 + cân: 킬로그램 + căng: 팽팽한→(무게를) 재다)'))
            .toBe('**bao cân căng**: 몇 킬로그램을? (bao: 몇 + cân: 킬로그램 + căng: 팽팽한→무게를 재다)');
    });
    it('괄호로 쓴 부품 풀이는 〈〉로', () => {
        expect(flattenNestedParens('**để mình búng tay**: 내가 손가락을 튕겨서 (để: ~하기 위해 + búng tay: 손가락을 튕기다(búng: 튀기다 + tay: 손) + nó: 그것)'))
            .toBe('**để mình búng tay**: 내가 손가락을 튕겨서 (để: ~하기 위해 + búng tay: 손가락을 튕기다〈튀기다·손〉 + nó: 그것)');
    });
    it('숫자·기호 병기는 그대로', () => {
        const a = '**hơn sáu trăm(600) km**: 600km가 넘는 (hơn: ~을 넘는 + sáu trăm(600): 600 + km: 킬로미터)';
        const b = '**300 m**: 300미터 (ba trăm(300): 삼백 + mét(m): 미터)';
        const c = '**mười trên(/) mười**: 10점 만점에 10점 (mười(10): 10 + trên(/): ~분의 + mười(10): 10)';
        expect(flattenNestedParens(a)).toBe(a);
        expect(flattenNestedParens(b)).toBe(b);
        expect(flattenNestedParens(c)).toBe(c);
    });
    it('풀이 묶음이 없거나 이미 바른 줄, ⚡ 꼬리는 그대로', () => {
        const ok = '**một chuyến xe từ thiện**: 자선 차량 한 대를 (một: 한 + chuyến: 편·차량 세는 말 + xe: 차 + từ thiện: 자선♪)';
        expect(flattenNestedParens(ok)).toBe(ok);
        expect(flattenNestedParens('**Vâng**: 네')).toBe('**Vâng**: 네');
        expect(flattenNestedParens('**bó tay**: 손 묶다 (bó: 묶다 + tay: 손(신체)) 〔⚡실제: 방법 없다〕'))
            .toBe('**bó tay**: 손 묶다 (bó: 묶다 + tay: 손·신체) 〔⚡실제: 방법 없다〕');
    });
});

describe('청크 뜻의 화살표 안전망', () => {
    it('청크 뜻에 온 화살표는 오른쪽 뜻만 남기고, 괄호 안 화살표는 그대로', () => {
        expect(flattenNestedParens('**đang chơi**: ~하는 중이다→운행하는 중이다 (đang: ~하는 중 + chơi: 놀다→운행하다)'))
            .toBe('**đang chơi**: 운행하는 중이다 (đang: ~하는 중 + chơi: 놀다→운행하다)');
        expect(flattenNestedParens('**ghé tới**: 들르다→비추다 (ghé: 들르다 + tới: 오다)'))
            .toBe('**ghé tới**: 비추다 (ghé: 들르다 + tới: 오다)');
    });
    it('풀이 묶음이 없는 줄에도 적용, 화살표 없으면 그대로', () => {
        expect(flattenNestedParens('**Chạy đi**: 달려→도망쳐')).toBe('**Chạy đi**: 도망쳐');
        const ok = '**Chạy mày đấy**: 너 도망쳐 (Chạy: 달리다→도망치다 + mày: 너 + đấy: ~야)';
        expect(flattenNestedParens(ok)).toBe(ok);
    });
});
