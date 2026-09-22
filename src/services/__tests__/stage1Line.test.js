import { describe, it, expect } from 'vitest';
import { LINE_REGEX, lineTimeToSeconds, stripRunawayNumberAnnotations } from '../stage1Line';

const parse = (line) => {
    const m = line.match(LINE_REGEX);
    return m ? { sec: lineTimeToSeconds(m[1]), speaker: m[2], text: m[3].trim() } : null;
};

describe('Stage 1 줄 형식 인식', () => {
    it('지시한 형식 [MM:SS.ms] [화자] || 대사', () => {
        expect(parse('[00:05.30] [Speaker B] || Vì đây là Hải Phòng các bạn ạ.'))
            .toEqual({ sec: 5.3, speaker: 'Speaker B', text: 'Vì đây là Hải Phòng các bạn ạ.' });
        expect(parse('[02:27.50] [Speaker A] || Xét về độ ngon thì')?.sec).toBeCloseTo(147.5);
    });

    // 실측 이탈(2026-09, gemini-3.6-flash): 1분이 넘자 시(時)를 붙여 [00:01:04.47]로 출력.
    // 예전 패턴은 "00:01"만 시각으로 읽어 1초가 됐고, 대본에 "04.47] [Speaker D] ||"가 섞였다.
    it('[HH:MM:SS.ms] — 1분 넘는 줄에 시를 붙인 이탈', () => {
        const r = parse('[00:01:04.47] [Speaker D] || Rút kinh nghiệm lần sau ăn ở');
        expect(r.sec).toBeCloseTo(64.47);
        expect(r.speaker).toBe('Speaker D');
        expect(r.text).toBe('Rút kinh nghiệm lần sau ăn ở');
    });

    it('[HH:MM:SS.ms] — 1시간 넘는 시각', () => {
        expect(parse('[01:02:03.5] [A] || Xin chào')?.sec).toBeCloseTo(3723.5);
    });

    it('앞자리 0 없는 [M:SS.ms]', () => {
        expect(parse('[1:04.47] [A] || Cay cấp độ không(0).')?.sec).toBeCloseTo(64.47);
    });

    it('대사 안의 콜론·숫자는 시각으로 먹지 않는다', () => {
        const r = parse('[00:12.00] [A] || Tỉ số 2:1 nhé');
        expect(r.sec).toBeCloseTo(12);
        expect(r.text).toBe('Tỉ số 2:1 nhé');
    });

    it('시각 없는 줄은 무시', () => {
        expect(parse('Không có thời gian ở đây')).toBeNull();
    });
});

// 실측(2026-09, 휴대폰 화면): 16분 영상 전체 대본의 문장마다 숫자 괄호가 모든 단어로 번졌다
describe('숫자 병기 폭주 정리', () => {
    it('실측 사례: 단어마다 붙은 "(1)"·"(1.000)"을 지운다', () => {
        expect(stripRunawayNumberAnnotations('Hôm nay(1) là(1) còn(1) thừa(1) một(1) nghìn(1.000) mình(1.000) không(1.000) mua(1.000) cơm(1.000).'))
            .toBe('Hôm nay là còn thừa một nghìn mình không mua cơm.');
        expect(stripRunawayNumberAnnotations('Nhưng mà(1) bà(1) mình(1) cứ(1) gạ(1) gẫm(1) rủ(1) dê(1) mình(1) là(1) mày(1) mua(1) miếng(1) bí(1) đi(1) bà(1) bán(1) rẻ(1) cho(1).'))
            .toBe('Nhưng mà bà mình cứ gạ gẫm rủ dê mình là mày mua miếng bí đi bà bán rẻ cho.');
        expect(stripRunawayNumberAnnotations('Thế nên(1) là(1) mình(1) quyết(1) định(1) rút(1) một(1) nghìn(1.000) ra(1.000) để(1.000) mua(1.000) cái(1.000) miếng(1.000) bí(1.000) này(1.000) của(1.000) bà(1.000)'))
            .toBe('Thế nên là mình quyết định rút một nghìn ra để mua cái miếng bí này của bà');
    });

    it('정상 병기는 그대로 둔다 (같은 영상을 다시 전사한 실측 줄)', () => {
        const ok = [
            'Đây là mười nghìn(10.000) và trong bảy(7) ngày tới mình sẽ dùng nó để sống sót qua mười bốn(14) bữa ăn.',
            'Luật một(1) không tiêu quá mười nghìn(10.000) một(1) bữa.',
            'Mình mua thêm một(1) quả trứng với cà chua hết bốn nghìn(4.000).',
            'Hôm nay là còn thừa một nghìn(1.000), mình không mua cơm.',
            'Năm(5) nghìn(1.000) một(1) túi riêng.', // 단어마다 붙은 씨앗이지만 값이 이어지지 않아 폭주는 아님
            'Tổng điểm được năm phẩy sáu sáu(5,66) trên(/) mười(10).', // 프롬프트 예시
        ];
        for (const s of ok) expect(stripRunawayNumberAnnotations(s)).toBe(s);
    });
});
