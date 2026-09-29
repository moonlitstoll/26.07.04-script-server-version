// gemini.js에 남아 있던 테스트 없는 응답 해석 — 전사 줄 파서(transcribeStream 안 parseLine), 대사 끝 응답,
// 청크 겹침 중복 제거. 줄 파서는 클로저라 코드를 옮기지 않고, 가짜 모델로 '실제' 전사 루프를 돌려 결과를 본다
// (stage1Resume.test.js와 같은 방식 — 사본이 아니라 실제 소스를 import).
import { describe, it, expect } from 'vitest';
import { transcribeWithResume, parseSpeechEndResponse, deduplicateOverlap } from '../gemini';

const mmss = (s) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};
const L = (rel, text) => `[${mmss(rel)}] [남자] || ${text}\n`;

// 한 번에 끝까지 오는(STOP) 가짜 모델 — 줄 파서 규칙만 본다
function transcribe(body, { segStart = 0, segEnd = 60, hardLimit = segEnd } = {}) {
    const model = {
        async generateContentStream() {
            async function* gen() { yield { candidates: [{ finishReason: 'STOP' }], text: () => body }; }
            return { stream: gen(), response: Promise.resolve({}) };
        },
    };
    return transcribeWithResume(model, ['AUDIO', 'PROMPT'], {
        segStart, segEnd, hardLimit, backoffMs: () => 0, timeouts: { firstChunkMs: 1000, idleMs: 1000 },
    });
}
const rows = (out) => out.map(m => [Math.round(m.seconds * 100) / 100, m.text]);

describe('전사 줄 파서', () => {
    it('시각·본문을 읽고, 청크 시작(segStart)만큼 절대 시각으로 옮긴다', async () => {
        const out = await transcribe(L(2.5, 'Xin chào các bạn.'), { segStart: 600, segEnd: 1200 });
        expect(rows(out)).toEqual([[602.5, 'Xin chào các bạn.']]);
        expect(out[0].timestamp).toBe('10:02.50');
    });

    it('시각이 뒤로 가면 직전 줄 + 0.1초로 보정한다(순서가 뒤집히지 않게)', async () => {
        const out = await transcribe(L(5, 'Một hai ba.') + L(3, 'Bốn năm sáu.'));
        expect(rows(out)).toEqual([[5, 'Một hai ba.'], [5.1, 'Bốn năm sáu.']]);
    });

    it('바로 앞 줄과 같은 줄이 8초 안에 또 오면 버리고, 사이에 다른 줄이 끼거나 8초가 지나면 둔다(후렴)', async () => {
        const out = await transcribe(
            L(1, 'Happy New Year.') + L(2, 'Happy New Year.')      // 환각 반복 → 버림
            + L(4, 'Chúc mừng năm mới.') + L(6, 'Happy New Year.')  // A / B / A → 보존
            + L(20, 'Happy New Year.'),                              // 14초 뒤 → 보존
        );
        expect(rows(out)).toEqual([[1, 'Happy New Year.'], [4, 'Chúc mừng năm mới.'], [6, 'Happy New Year.'], [20, 'Happy New Year.']]);
    });

    it('영상 길이 + 5초를 넘는 줄은 환각으로 버린다', async () => {
        const out = await transcribe(L(24.9, 'Hết rồi.') + L(25.2, 'Không có thật.'), { segEnd: 20 });
        expect(rows(out)).toEqual([[24.9, 'Hết rồi.']]);
    });

    it('소리 설명·자막 표기 줄과 한 글자 줄은 버린다', async () => {
        const out = await transcribe(
            L(1, '[Music]') + L(2, '(tiếng cười)') + L(3, 'Nhạc') + L(4, 'A') + L(5, 'Được rồi, đi thôi.'),
        );
        expect(rows(out)).toEqual([[5, 'Được rồi, đi thôi.']]);
    });

    it('90%에 못 미친 [END_OF_AUDIO]는 무시하고 계속 받는다', async () => {
        const out = await transcribe(L(10, 'Một.') + '[00:11.00] [END_OF_AUDIO]\n' + L(40, 'Hai ba bốn.'), { segEnd: 60 });
        expect(rows(out)).toEqual([[10, 'Một.'], [40, 'Hai ba bốn.']]);
    });
});

describe('대사 끝 응답 해석', () => {
    it('모델이 형식을 살짝 벗어나도 받는다(모바일 실패 사례에서 강화)', () => {
        const m = parseSpeechEndResponse([
            '[3] 06:15.20',
            '[4] [06:16.5]',
            '[5] 1:06:15.2',   // H:MM:SS
            '[6] 375.2',       // 초 단위 숫자
            '[7] 375,5',       // 쉼표 소수점
            '[8] SKIP',
            '설명 문장은 무시',
        ].join('\n'));
        expect([...m.entries()]).toEqual([[3, 375.2], [4, 376.5], [5, 3975.2], [6, 375.2], [7, 375.5]]);
    });
});

describe('청크 겹침 중복 제거', () => {
    const S = (seconds, text) => ({ seconds, text });
    it('겹친 구간에서 두 번 받은 문장은 하나만 — 구두점만 달라도, 시각이 조금 달라도, 짧아도', () => {
        const out = deduplicateOverlap([
            S(598.2, 'Hôm nay mình sẽ đi ăn phở nhé.'),
            S(598.9, 'Hôm nay mình sẽ đi ăn phở nhé'),   // 다음 청크가 다시 받은 것
            S(600.3, 'Vâng.'),
            S(600.6, 'Vâng!'),                            // 짧은 말은 '완전 일치'로만 잡힌다
            S(601.0, 'Ngon quá trời luôn đó các bạn!'),
        ]);
        expect(out.map(s => s.seconds)).toEqual([598.2, 600.3, 601.0]);
    });
    it('짧은 다른 말, 20초 넘게 떨어진 같은 문장(후렴)은 지우지 않는다', () => {
        const out = deduplicateOverlap([
            S(10, 'Dạ.'), S(11, 'Dạ vâng.'),
            S(30, 'Chúc mừng năm mới an khang.'), S(55, 'Chúc mừng năm mới an khang.'),
        ]);
        expect(out.map(s => s.seconds)).toEqual([10, 11, 30, 55]);
    });
});
