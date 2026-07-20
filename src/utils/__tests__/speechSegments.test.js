// '대사만 재생'의 경계 계산 검증.
// 이 파일이 지키는 것: 대사가 잘리지 않을 것, 그러면서도 긴 무음은 건너뛸 것.
// 두 요구가 정반대라 상수 하나만 건드려도 한쪽이 무너진다 — 그래서 경계값을 촘촘히 본다.
//
// 단정에 숫자를 직접 쓰지 말 것. 반드시 SPEECH_TAIL_PAD 같은 상수를 참조한다.
// (예전에 0.4를 하드코딩해 뒀다가, 상수를 0.8로 바꿔도 테스트가 그대로 통과한 적이 있다.)
import { describe, it, expect } from 'vitest';
import {
    gapSkipTarget, trimmedLoopEnd, blockSpeechEnd, validSpeechEnd,
    GAP_SKIP_MIN, SPEECH_TAIL_PAD, MIN_SPEECH_SEC, MAX_SENTENCE_SEC,
} from '../speechSegments';

const PAD = SPEECH_TAIL_PAD;
const BUF = 0.3;   // bufferTime 기본값

// 실사용 데이터: 12:43 문장(763.7 시작, 768.9 대사끝) → 다음 문장 783.4 시작
const real = [
    { seconds: 763.7, speechEnd: 768.9, text: 'a' },
    { seconds: 783.4, speechEnd: 786, text: 'b' },
];
const SE = 768.9;

describe('gapSkipTarget — 실사용 재현(12:43 구간)', () => {
    it('대사 끝+여유 이후엔 다음 문장 직전으로 점프한다', () => {
        expect(gapSkipTarget(real, 0, 1, SE + PAD + 0.1, BUF)).toBeCloseTo(783.4 - BUF, 9);
    });

    it('건너뛰는 시간이 12초 이상 유지된다 (패딩을 올려도 기능이 죽지 않음)', () => {
        const now = SE + PAD + 0.1;
        expect(gapSkipTarget(real, 0, 1, now, BUF) - now).toBeGreaterThan(12);
    });

    it('대사가 아직 안 끝났으면 점프하지 않는다', () => {
        expect(gapSkipTarget(real, 0, 1, 766.0, BUF)).toBeNull();
    });

    it('점프한 뒤엔 다시 점프하지 않는다 (연쇄 점프 방지)', () => {
        const first = gapSkipTarget(real, 0, 1, SE + PAD + 0.1, BUF);
        expect(gapSkipTarget(real, 0, 1, first, BUF)).toBeNull();
    });

    it('목표를 이미 지났으면 점프하지 않는다', () => {
        expect(gapSkipTarget(real, 0, 1, 783.2, BUF)).toBeNull();
    });
});

describe('gapSkipTarget — 꼬리 보호 (대사 잘림 방지)', () => {
    it(`꼬리 여유(${PAD}초) 안에서는 점프하지 않는다`, () => {
        expect(gapSkipTarget(real, 0, 1, SE + PAD - 0.05, BUF)).toBeNull();
    });

    it('모델이 0.7초 일찍 답해도 그 대사는 잘리지 않는다', () => {
        // PAD가 0.4였을 땐 이 시점에 이미 점프해서 0.3초가 잘렸다.
        expect(PAD).toBeGreaterThan(0.7);
        expect(gapSkipTarget(real, 0, 1, SE + 0.7, BUF)).toBeNull();
    });

    it('경계 직전/직후가 정확히 갈린다', () => {
        expect(gapSkipTarget(real, 0, 1, SE + PAD - 1e-6, BUF)).toBeNull();
        expect(gapSkipTarget(real, 0, 1, SE + PAD, BUF)).toBeCloseTo(783.4 - BUF, 9);
    });
});

describe('gapSkipTarget — 패딩이 건너뛰기를 없애지 않는가', () => {
    // 점프 성립 조건은 gap > PAD + bufferTime + 0.05.
    // gap > GAP_SKIP_MIN 이 이미 필수이므로, 설정 슬라이더 전 범위에서 성립해야 한다.
    it('bufferTime 0.0~2.0 전 구간에서 gap 3.01초도 여전히 점프한다', () => {
        const d = [{ seconds: 10, speechEnd: 12 }, { seconds: 15.01 }];
        for (let bt = 0; bt <= 2.0001; bt += 0.1) {
            const buf = Math.round(bt * 10) / 10;
            expect(gapSkipTarget(d, 0, 1, 12 + PAD, buf), `bufferTime=${buf}`).not.toBeNull();
        }
    });

    it('상수 조합이 성립 조건을 만족한다 (설정 최대치에서도)', () => {
        const MAX_BUFFER = 2.0;   // SettingsModal 슬라이더 최대값
        expect(PAD + MAX_BUFFER + 0.05).toBeLessThan(GAP_SKIP_MIN);
    });
});

describe('gapSkipTarget — 안전 조건', () => {
    it('간격이 기준 이하면 점프하지 않는다', () => {
        const d = [{ seconds: 10, speechEnd: 12 }, { seconds: 14.5 }];   // 2.5초 간격
        expect(gapSkipTarget(d, 0, 1, 12.5, BUF)).toBeNull();
    });

    it('간격이 정확히 기준값이면 점프하지 않는다 (초과일 때만)', () => {
        const d = [{ seconds: 10, speechEnd: 12 }, { seconds: 12 + GAP_SKIP_MIN }];
        expect(gapSkipTarget(d, 0, 1, 12 + PAD, BUF)).toBeNull();
    });

    it('대사 끝 데이터가 없으면 점프하지 않는다 (기존 동작 폴백)', () => {
        expect(gapSkipTarget([{ seconds: 10 }, { seconds: 30 }], 0, 1, 15, BUF)).toBeNull();
    });

    it('겹치는 대사(간격 음수)는 점프하지 않는다', () => {
        expect(gapSkipTarget([{ seconds: 10, speechEnd: 35 }, { seconds: 30 }], 0, 1, 20, BUF)).toBeNull();
    });

    it('잘못된 입력에도 터지지 않는다', () => {
        expect(gapSkipTarget(real, 0, 99, 769.5, BUF)).toBeNull();
        expect(gapSkipTarget(null, 0, 1, 769.5, BUF)).toBeNull();
        expect(gapSkipTarget(undefined, 0, 1, 769.5, BUF)).toBeNull();
    });

    it('점프 목표는 음수가 되지 않는다', () => {
        const r = gapSkipTarget([{ seconds: 0, speechEnd: 0.1 }, { seconds: 5 }], 0, 1, 1, 0.3);
        if (r !== null) expect(r).toBeGreaterThanOrEqual(0);
    });
});

describe('trimmedLoopEnd — 반복 끝 경계', () => {
    it('긴 간격이면 대사끝+패딩으로 당긴다', () => {
        expect(trimmedLoopEnd(10, 15)).toBeCloseTo(10 + PAD, 9);
    });

    it('마지막 문장(다음 없음)도 대사끝+패딩', () => {
        expect(trimmedLoopEnd(10, null)).toBeCloseTo(10 + PAD, 9);
    });

    it('정확히 기준 간격이면 당기지 않는다', () => {
        expect(trimmedLoopEnd(10, 10 + GAP_SKIP_MIN)).toBeNull();
    });

    it('짧은 간격은 당기지 않는다', () => {
        expect(trimmedLoopEnd(10, 11)).toBeNull();
    });

    it('겹침(음수 간격)은 당기지 않는다', () => {
        expect(trimmedLoopEnd(1035, 1032)).toBeNull();
    });

    it('speechEnd가 없으면 당기지 않는다', () => {
        expect(trimmedLoopEnd(null, 20)).toBeNull();
        expect(trimmedLoopEnd(undefined, 20)).toBeNull();
        expect(trimmedLoopEnd(NaN, 20)).toBeNull();
    });

    it('반복 끝이 다음 문장 시작을 침범하지 않는다', () => {
        // 간격이 기준을 겨우 넘는 최악의 경우에도 끝 경계 < 다음 문장 시작이어야 한다.
        const nextStart = 13.01;
        const end = trimmedLoopEnd(10, nextStart);
        expect(end).not.toBeNull();
        expect(end).toBeLessThan(nextStart);
    });
});

describe('validSpeechEnd — 감지값 검증', () => {
    // 실측 회귀: "À." (272.6초 시작, 모델 답 272.8초 = 지속 0.2초).
    // 기준이 0.2초였을 때 이 문장이 정확히 경계에 걸려 탈락했고, 그 결과 04:32~04:56 구간에서
    // 뒤따르는 9.4초 무음을 못 건너뛰었다. 숫자를 상수로 쓰지 말 것 —
    // MIN_SPEECH_SEC를 참조하면 기준을 되돌려도 테스트가 같이 움직여 버그를 못 잡는다.
    it('한 음절 감탄사(0.2초)도 유효하다 — 04:32 회귀 방지', () => {
        expect(validSpeechEnd({ seconds: 272.6, speechEnd: 272.8 })).toBeCloseTo(272.8, 9);
    });

    it('기준이 0.2초 이상으로 되돌아가지 않는다', () => {
        // "Wow." "Cay." 같은 0.2~0.3초 문장이 이 대본에 흔하다.
        expect(MIN_SPEECH_SEC).toBeLessThan(0.2);
    });

    it('시작보다 이르거나 사실상 0길이면 무효', () => {
        expect(validSpeechEnd({ seconds: 10, speechEnd: 10 })).toBeNull();
        expect(validSpeechEnd({ seconds: 10, speechEnd: 9 })).toBeNull();
        expect(validSpeechEnd({ seconds: 10, speechEnd: 10 + MIN_SPEECH_SEC })).toBeNull();
    });

    it('비정상적으로 긴 지속시간은 무효 (환각 방어)', () => {
        expect(validSpeechEnd({ seconds: 10, speechEnd: 10 + MAX_SENTENCE_SEC + 1 })).toBeNull();
    });

    it('숫자가 아니거나 유한하지 않으면 무효', () => {
        expect(validSpeechEnd({ seconds: 10, speechEnd: '12' })).toBeNull();
        expect(validSpeechEnd({ seconds: 10, speechEnd: NaN })).toBeNull();
        expect(validSpeechEnd({ seconds: 10, speechEnd: Infinity })).toBeNull();
        expect(validSpeechEnd({ seconds: 10 })).toBeNull();
        expect(validSpeechEnd(null)).toBeNull();
    });
});

describe('blockSpeechEnd — 같은 시각 형제 문장', () => {
    it('블록 구성원 중 가장 늦은 끝을 쓴다', () => {
        const d = [{ seconds: 5, speechEnd: 6 }, { seconds: 5, speechEnd: 8 }];
        expect(blockSpeechEnd(d, 0)).toBeCloseTo(8, 9);
        expect(blockSpeechEnd(d, 1)).toBeCloseTo(8, 9);
    });

    it('블록에 유효값이 하나도 없으면 null', () => {
        expect(blockSpeechEnd([{ seconds: 5 }, { seconds: 5 }], 0)).toBeNull();
    });

    it('잘못된 입력에도 터지지 않는다', () => {
        expect(blockSpeechEnd(null, 0)).toBeNull();
        expect(blockSpeechEnd([{ seconds: 5 }], 99)).toBeNull();
    });
});
