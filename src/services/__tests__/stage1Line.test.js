import { describe, it, expect } from 'vitest';
import { LINE_REGEX, lineTimeToSeconds } from '../stage1Line';

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
