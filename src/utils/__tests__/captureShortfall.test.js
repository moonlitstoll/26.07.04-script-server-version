import { describe, it, expect } from 'vitest';
import { captureShortfall, CAPTURE_SLACK_SEC } from '../audioExtractor';

const base = { startSec: 10, dur: 8, mediaDur: 100 };

describe('captureShortfall — 실시간 녹음이 끊겼는지', () => {
    it('끝까지 받았으면 멀쩡하다', () => {
        expect(captureShortfall({ ...base, gotSec: 8, playedSec: 8 })).toBeNull();
    });
    it('처리 단위 한두 개만큼 모자란 것은 정상이다', () => {
        expect(captureShortfall({ ...base, gotSec: 8 - 0.18, playedSec: 8 - 0.1 })).toBeNull();
    });
    it('받은 소리가 모자라면 끊긴 것이다(화면 꺼짐 등으로 소리 처리가 멈춤)', () => {
        const cut = captureShortfall({ ...base, gotSec: 3, playedSec: 8 });
        expect(cut).toEqual({ wantSec: 8, gotSec: 3, playedSec: 8 });
    });
    it('길이는 다 찼어도 재생이 덜 나아갔으면 끊긴 것이다(전화 등으로 재생만 멈춰 무음이 채워짐)', () => {
        expect(captureShortfall({ ...base, gotSec: 8, playedSec: 3 })).not.toBeNull();
    });
    it('여유보다 조금 더 모자라면 끊긴 것으로 본다', () => {
        expect(captureShortfall({ ...base, gotSec: 8 - CAPTURE_SLACK_SEC - 0.05, playedSec: 8 })).not.toBeNull();
        expect(captureShortfall({ ...base, gotSec: 8 - CAPTURE_SLACK_SEC + 0.05, playedSec: 8 })).toBeNull();
    });
    it('파일 끝에 걸린 구간은 파일 끝까지만 받으면 된다', () => {
        expect(captureShortfall({ startSec: 95, dur: 8, mediaDur: 100, gotSec: 5, playedSec: 5 })).toBeNull();
        expect(captureShortfall({ startSec: 95, dur: 8, mediaDur: 100, gotSec: 2, playedSec: 2 })).not.toBeNull();
    });
    it('파일 길이를 모르면 구간 길이를 기준으로 본다', () => {
        expect(captureShortfall({ startSec: 10, dur: 8, mediaDur: NaN, gotSec: 8, playedSec: 8 })).toBeNull();
        expect(captureShortfall({ startSec: 10, dur: 8, mediaDur: Infinity, gotSec: 4, playedSec: 4 })).not.toBeNull();
    });
    it('긴 구간은 여유를 조금 더 주되(3%) 1초를 넘기지 않는다', () => {
        expect(captureShortfall({ startSec: 0, dur: 25, mediaDur: 600, gotSec: 24.3, playedSec: 24.3 })).toBeNull();   // 여유 0.75초
        expect(captureShortfall({ startSec: 0, dur: 60, mediaDur: 600, gotSec: 59.1, playedSec: 59.1 })).toBeNull();   // 여유 1초(상한)
        expect(captureShortfall({ startSec: 0, dur: 60, mediaDur: 600, gotSec: 58.5, playedSec: 60 })).not.toBeNull();
        expect(captureShortfall({ startSec: 0, dur: 180, mediaDur: 600, gotSec: 180, playedSec: 176 })).not.toBeNull(); // 3분 구간에 4초 멈춤
    });
});
