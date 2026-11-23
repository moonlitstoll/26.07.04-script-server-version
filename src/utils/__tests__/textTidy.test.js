// 받아쓰기 찌꺼기 정리 (2026-11-23) — 예시는 휴대폰 대본 실측 글자 그대로.
import { describe, it, expect } from 'vitest';
import { stripSameParen, tidyTranscriptText } from '../textTidy';
import { sanitizeData } from '../mediaUtils';

describe('같은 말 괄호 겹침 지우기', () => {
    it('실측: km(km)·Mon(Mon)·order(order)·YouTube(YouTube)·Go(go)', () => {
        expect(tidyTranscriptText('Luật một(1), mỗi km(km) đi được mình sẽ tích lũy một nghìn(1.000) vào tài khoản.'))
            .toBe('Luật một(1), mỗi km đi được mình sẽ tích lũy một nghìn(1.000) vào tài khoản.');
        expect(tidyTranscriptText('Mình chụp hình với Mon(Mon), gọi order(order) một bát phở bát đá sáu mươi lăm ca(65k).'))
            .toBe('Mình chụp hình với Mon, gọi order một bát phở bát đá sáu mươi lăm ca(65k).');
        expect(tidyTranscriptText('Không nhớ tên á nhưng mà coi chú ở YouTube(YouTube) à.')).toBe('Không nhớ tên á nhưng mà coi chú ở YouTube à.');
        expect(tidyTranscriptText('Go(go) thôi.')).toBe('Go thôi.');
    });
    it('진짜 병기는 그대로: một(1)·ca(65k)·lít(L)·phần trăm(%)', () => {
        const s = 'Một(1) cân bảy mươi nghìn(70.000), hai lít(2L), ca(65k), năm phần trăm(%).';
        expect(tidyTranscriptText(s)).toBe(s);
    });
    it('분석 글의 청크·풀이도 같이 정리한다', () => {
        expect(stripSameParen('**mỗi km(km) đi được**: 1km 갈 때마다 (mỗi: 매 + km(km): 킬로미터 + đi: 가다)'))
            .toBe('**mỗi km đi được**: 1km 갈 때마다 (mỗi: 매 + km: 킬로미터 + đi: 가다)');
    });
});

describe('문장 앞 말한 사람 표시 지우기', () => {
    it('실측: [Người nói] || 문장', () => {
        expect(tidyTranscriptText('[Người nói] || Khoảng mười(10) phút sau, cuối cùng thì cái xe của đoàn quay cũng tới nơi.'))
            .toBe('Khoảng mười(10) phút sau, cuối cùng thì cái xe của đoàn quay cũng tới nơi.');
    });
    it('문장 중간의 대괄호, 막대 없는 대괄호는 그대로', () => {
        expect(tidyTranscriptText('[Music] la la la')).toBe('[Music] la la la');
        expect(tidyTranscriptText('Anh nói [cười] || vậy đó')).toBe('Anh nói [cười] || vậy đó');
    });
    it('지우고 나서 비면 원래 글자를 둔다', () => {
        expect(tidyTranscriptText('[Người nói] ||')).toBe('[Người nói] ||');
    });
});

describe('sanitizeData가 열 때·저장할 때 정리한다', () => {
    it('저장본의 o/text·a/analysis를 정리한다', () => {
        const [r] = sanitizeData([{ s: '00:08.97', o: '[Người nói] || mỗi km(km) đi được', a: '**mỗi km(km) đi được**: 1km마다', isAnalyzed: true }]);
        expect(r.text).toBe('mỗi km đi được');
        expect(r.o).toBe('mỗi km đi được');
        expect(r.analysis).toBe('**mỗi km đi được**: 1km마다');
    });
});
