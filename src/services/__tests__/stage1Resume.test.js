// Stage 1 전사 스트림 '끊김 감지 + 이어받기' 검증.
//
// 실측 사례(2026-09): 노래 "Vạn Sự Như Ý"(4:05)를 전사하다 구글 서버 과부하로 스트림이 도중에 닫혔는데
// 예전 코드는 이를 '정상 완료'로 보고 2:18.6 "A a"까지만 저장했다(오류 표시 없음). 끊기지 않은 실행은
// 3:51의 [END_OF_AUDIO]까지 62줄이 나온다. 아래 줄·시각은 그 실측 결과에서 가져왔다.
//
// 앞부분은 순수 함수, 뒷부분은 gemini.js의 '실제' 이어받기 루프(transcribeWithResume)를
// 가짜 모델로 돌린다 — 사본이 아니라 실제 소스를 import 한다(CLAUDE.md 테스트 규칙).
import { describe, it, expect } from 'vitest';
import {
    isStreamComplete, isResumableStreamError, planResume, spliceResume,
    StreamIncompleteError, RESUME_MAX_ATTEMPTS,
} from '../stage1Resume';
import { transcribeWithResume } from '../gemini';

const SONG_END = 245.85;
const line = (seconds, text) => ({ seconds, text });

// 실측 대본 일부 (끊기지 않은 실행)
const BEFORE_CUT = [
    line(130.7, 'Đã yêu hết lòng thì đừng vấn vương.'),
    line(133.4, 'Muốn cho một mai sung sướng.'),
    line(135.3, 'Nhớ chọn đúng người mình thương.'),
    line(138.6, 'A a'),
];

describe('끝까지 받았는지 판정', () => {
    it('finishReason STOP이면 완료', () => {
        expect(isStreamComplete({ finishReason: 'STOP' })).toBe(true);
    });
    it('90% 이후 [END_OF_AUDIO]로 먼저 끊었으면 완료', () => {
        expect(isStreamComplete({ endedByMarker: true })).toBe(true);
    });
    it('완료 표시 없이 닫힌 스트림은 끊긴 것 (실측 사례의 원인)', () => {
        expect(isStreamComplete({ finishReason: null })).toBe(false);
    });
    it('출력 한도(MAX_TOKENS)·기타 사유도 끝까지 온 게 아니다', () => {
        expect(isStreamComplete({ finishReason: 'MAX_TOKENS' })).toBe(false);
        expect(isStreamComplete({ finishReason: 'OTHER' })).toBe(false);
    });
});

describe('이어받을 가치가 있는 오류인지', () => {
    it('스트림 읽기 끊김·네트워크 오류는 이어받는다', () => {
        expect(isResumableStreamError(new Error('[GoogleGenerativeAI Error]: Error reading from the stream'))).toBe(true);
    });
    it('서버 과부하·한도(5xx, 429)는 이어받는다', () => {
        expect(isResumableStreamError(Object.assign(new Error('x'), { status: 503 }))).toBe(true);
        expect(isResumableStreamError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    });
    it('저작권·안전 차단(SDK ResponseError)은 다시 보내도 같다 → 이어받지 않는다', () => {
        expect(isResumableStreamError(Object.assign(new Error('blocked due to RECITATION'), { response: {} }))).toBe(false);
    });
    it('요청 자체 오류(400 키 오류 등)는 이어받지 않는다', () => {
        expect(isResumableStreamError(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
        expect(isResumableStreamError(Object.assign(new Error('x'), { status: 403 }))).toBe(false);
    });
});

describe('이어받기 계획', () => {
    it('실측 사례: 마지막으로 받은 줄 "A a"(138.6)의 시작부터 다시 듣는다', () => {
        const plan = planResume(BEFORE_CUT, 0, SONG_END);
        expect(plan.resumeAt).toBe(138.6);
        expect(plan.keep.map(l => l.seconds)).toEqual([130.7, 133.4, 135.3]);
        expect(plan.dropped.map(l => l.text)).toEqual(['A a']);
        // 모델에게 '다시 쓰지 말 앞 문장'으로 알려줄 직전 두 줄
        expect(plan.context).toEqual(['Muốn cho một mai sung sướng.', 'Nhớ chọn đúng người mình thương.']);
    });
    it('한 줄도 못 받았으면 구간 처음부터', () => {
        const plan = planResume([], 0, SONG_END);
        expect(plan.resumeAt).toBe(0);
        expect(plan.keep).toEqual([]);
    });
    it('끝까지 1초도 안 남았으면 이어받을 게 없다', () => {
        expect(planResume([line(245.2, 'Tằng tằng')], 0, SONG_END)).toBeNull();
    });
    it('전체 길이를 모르면(0) 이어받을 수 없다', () => {
        expect(planResume(BEFORE_CUT, 0, 0)).toBeNull();
    });
});

describe('이어받은 줄 붙이기', () => {
    const plan = planResume(BEFORE_CUT, 0, SONG_END);

    it('모델이 첫머리에 앞 문장을 되풀이하면 버리고, 빠졌던 가사를 채운다', () => {
        const cont = [
            line(138.3, 'Nhớ chọn đúng người mình thương.'), // 문맥 문장 되풀이 → 제거
            line(138.6, 'A a'),
            line(142.3, 'Mình kết duyên do ông trời.'),      // 예전 결과에 없던 가사
            line(146.3, 'A a'),
        ];
        const out = spliceResume(plan, cont);
        expect(out.map(l => l.seconds)).toEqual([130.7, 133.4, 135.3, 138.6, 142.3, 146.3]);
    });
    it('같은 말이라도 이음매에서 먼 제 시각이면 지킨다 (노래 후렴 반복)', () => {
        const cont = [line(138.6, 'A a'), line(160.0, 'Nhớ chọn đúng người mình thương.')];
        expect(spliceResume(plan, cont).map(l => l.seconds)).toContain(160.0);
    });
    it('이어받기가 아무것도 못 가져오면 버렸던 줄을 되살린다 (받은 것은 잃지 않는다)', () => {
        expect(spliceResume(plan, []).map(l => l.seconds)).toEqual([130.7, 133.4, 135.3, 138.6]);
    });
});

// ─── 실제 이어받기 루프 (gemini.js) ───────────────────────────────

const mmss = (s) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};
const L = (rel, text) => `[${mmss(rel)}] [남자] || ${text}\n`;

// 가짜 구글 모델: 호출마다 준비된 대본(steps)을 스트림으로 흘려보낸다.
//  step: { text, finish } 조각 | { error } 던지기 | { inband } 스트림 안 오류 조각 | { hang } 끊길 때까지 멈춤
function fakeModel(scripts) {
    const calls = [];
    return {
        calls,
        async generateContentStream(parts, opts = {}) {
            const script = scripts[calls.length] || { steps: [] };
            calls.push({ parts, opts });
            if (script.throwOnStart) throw script.throwOnStart;
            const signal = opts.signal;
            async function* gen() {
                for (const st of script.steps) {
                    if (st.hang) {
                        await new Promise((_, rej) => {
                            if (signal?.aborted) return rej(new Error('[GoogleGenerativeAI Error]: Request aborted when reading from the stream'));
                            signal?.addEventListener('abort', () => rej(new Error('[GoogleGenerativeAI Error]: Request aborted when reading from the stream')), { once: true });
                        });
                    }
                    if (st.error) throw st.error;
                    if (st.inband) { yield { error: st.inband, text: () => '' }; continue; }
                    if (st.blocked) { yield { candidates: [{ finishReason: 'RECITATION' }], text: () => { throw st.blocked; } }; continue; }
                    yield { candidates: [st.finish ? { finishReason: st.finish } : {}], text: () => st.text || '' };
                }
            }
            return { stream: gen(), response: Promise.resolve({}) };
        },
    };
}

// 첫 요청: 2:18.6 "A a"까지 받고 다음 줄을 쓰던 중 닫힘 (미완성 줄 포함)
const FIRST_CUT_STEPS = [
    { text: L(130.7, BEFORE_CUT[0].text) + L(133.4, BEFORE_CUT[1].text) },
    { text: L(135.3, BEFORE_CUT[2].text) + L(138.6, 'A a') + '[02:22.30] [남자] || Mình kết du' },
];
// 이어받기 요청: 클립은 138.6 - 0.3 = 138.3초부터 → 시각은 클립 기준(0초 = 138.3초)
const CONT_OK_STEPS = [
    { text: L(0.0, 'Nhớ chọn đúng người mình thương.') + L(0.3, 'A a') + L(4.0, 'Mình kết duyên do ông trời.') },
    { text: L(8.0, 'A a') + L(11.7, 'Nguyện một lòng với nhau hỡi người ơi.') + L(79.1, 'Tằng tằng') },
    { text: '[01:53.40] [END_OF_AUDIO]\n', finish: 'STOP' },
];

function setup(scripts, extra = {}) {
    const model = fakeModel(scripts);
    const cuts = [];
    const incompletes = [];
    const opts = {
        segStart: 0,
        segEnd: SONG_END,
        hardLimit: SONG_END,
        cutAudio: async (start, dur) => { cuts.push({ start, dur }); return { fakeClip: start }; },
        makePart: async (blob) => ({ clipPart: blob.fakeClip }),
        onIncomplete: (info) => incompletes.push(info),
        backoffMs: () => 0,
        timeouts: { firstChunkMs: 1000, idleMs: 1000 },
        ...extra,
    };
    const firstParts = [{ fullAudio: true }, 'FIRST_PROMPT'];
    return { model, cuts, incompletes, run: () => transcribeWithResume(model, firstParts, opts), firstParts };
}

const secs = (out) => out.map(m => Math.round(m.seconds * 10) / 10);

describe('실제 이어받기 루프 — 끊기지 않으면 예전과 똑같다', () => {
    it('STOP으로 끝나면 요청 1번, 오디오를 다시 자르지 않는다', async () => {
        const t = setup([{ steps: [{ text: L(0, 'Xin chào.') + L(3.2, 'Tạm biệt.'), finish: 'STOP' }] }]);
        const out = await t.run();
        expect(secs(out)).toEqual([0, 3.2]);
        expect(t.model.calls).toHaveLength(1);
        expect(t.cuts).toHaveLength(0);
        expect(t.incompletes).toHaveLength(0);
    });

    it('정상 완료면 줄바꿈 없이 끝난 마지막 줄도 예전처럼 살린다', async () => {
        const t = setup([{ steps: [{ text: L(0, 'Xin chào.') + '[00:03.20] [남자] || Tạm biệt.', finish: 'STOP' }] }]);
        const out = await t.run();
        expect(out.map(m => m.text)).toEqual(['Xin chào.', 'Tạm biệt.']);
    });

    it('모델이 스스로 일찍 끝낸 경우(이른 END_OF_AUDIO + STOP)는 예전처럼 믿는다', async () => {
        const t = setup([{ steps: [{ text: L(0, 'Xin chào.') + '[02:00.00] [END_OF_AUDIO]\n', finish: 'STOP' }] }]);
        await t.run();
        expect(t.model.calls).toHaveLength(1);
    });

    it('90% 이후 END_OF_AUDIO면 그 자리에서 끝낸다 (뒤가 멈춰 있어도 기다리지 않음)', async () => {
        // 실측: 마지막 줄 3:49.70(=93%) 다음에 [03:51.70] [END_OF_AUDIO]
        const t = setup([{ steps: [{ text: L(229.7, 'Tằng tằng') + '[03:51.70] [END_OF_AUDIO]\n' }, { hang: true }] }],
            { timeouts: { firstChunkMs: 5000, idleMs: 5000 } });
        const out = await t.run();
        expect(secs(out)).toEqual([229.7]);
        expect(t.model.calls).toHaveLength(1);
    });

    it('마커와 같은 조각에 온 앞줄들도 빠짐없이 받는다', async () => {
        const t = setup([{ steps: [
            { text: L(0, 'Xin chào.') },
            { text: L(225.0, 'Vạn sự như ý.') + L(229.7, 'Tằng tằng') + '[03:51.70] [END_OF_AUDIO]\n' },
        ] }]);
        const out = await t.run();
        expect(secs(out)).toEqual([0, 225, 229.7]);
    });
});

describe('실제 이어받기 루프 — 끊겼을 때', () => {
    it('실측 사례: 조용히 닫힌 스트림을 2:18.6부터 이어받아 빠진 가사를 채운다', async () => {
        const t = setup([{ steps: FIRST_CUT_STEPS }, { steps: CONT_OK_STEPS }]);
        const out = await t.run();
        expect(secs(out)).toEqual([130.7, 133.4, 135.3, 138.6, 142.3, 146.3, 150, 217.4]);
        expect(out.map(m => m.text)).toContain('Mình kết duyên do ông trời.');
        // 미완성 줄("Mình kết du")은 잘린 글자라 버렸다
        expect(out.some(m => m.text === 'Mình kết du')).toBe(false);
        // 오디오는 138.3초부터 끝까지만 다시 보냈다
        expect(t.cuts).toHaveLength(1);
        expect(t.cuts[0].start).toBeCloseTo(138.3, 5);
        expect(t.cuts[0].dur).toBeCloseTo(SONG_END - 138.3, 5);
        expect(t.model.calls[1].parts[0].clipPart).toBeCloseTo(138.3, 5); // 잘라 온 클립을 보냈다
        // 이어받기 지시문에 '바로 앞 문장(다시 쓰지 말 것)'이 들어간다
        const prompt = t.model.calls[1].parts[1];
        expect(prompt).toContain('Nhớ chọn đúng người mình thương.');
        expect(prompt).toContain('다시 출력하지 마십시오');
        expect(t.incompletes).toHaveLength(0);
    });

    it('이어받은 첫 줄 머리에 앞 문장이 붙어 오면 잘라낸다 (실측: 1:17 이음매)', async () => {
        // 실측: 앞 문장 "Thôi xin hẹn năm sau." 다음, 이어받은 첫 줄이 앞 문장을 머리에 붙여 왔다
        const t = setup([
            { steps: [{ text: L(73.7, 'Bấm tắt cơn mưa nắng mới lên ngôi.') + L(76.2, 'Thôi xin hẹn năm sau.') + L(77.4, 'Trái tim không còn buồn đau.') }] },
            { steps: [{ text: L(0.0, 'Thôi xin hẹn năm sau trái tim không còn buồn đau.') + L(2.8, 'Mây đen vội đi chơi.'), finish: 'STOP' }] },
        ]);
        const out = await t.run();
        expect(out.map(m => m.text)).toEqual([
            'Bấm tắt cơn mưa nắng mới lên ngôi.',
            'Thôi xin hẹn năm sau.',
            'trái tim không còn buồn đau.',
            'Mây đen vội đi chơi.',
        ]);
    });

    it('스트림 안에 서버 오류 조각이 실려 오면 끊긴 것으로 보고 이어받는다', async () => {
        const t = setup([{ steps: [...FIRST_CUT_STEPS, { inband: { code: 503, message: 'overloaded' } }] }, { steps: CONT_OK_STEPS }]);
        const out = await t.run();
        expect(out.map(m => m.text)).toContain('Mình kết duyên do ông trời.');
        expect(t.model.calls).toHaveLength(2);
    });

    it('연결 리셋(읽기 오류)도 전사 실패로 끝내지 않고 이어받는다', async () => {
        const reset = new Error('[GoogleGenerativeAI Error]: Error reading from the stream');
        const t = setup([{ steps: [...FIRST_CUT_STEPS, { error: reset }] }, { steps: CONT_OK_STEPS }]);
        const out = await t.run();
        expect(out.map(m => m.text)).toContain('Mình kết duyên do ông trời.');
    });

    it('출력 한도(MAX_TOKENS)로 끝나도 이어받는다', async () => {
        const t = setup([{ steps: [FIRST_CUT_STEPS[0], { text: FIRST_CUT_STEPS[1].text, finish: 'MAX_TOKENS' }] }, { steps: CONT_OK_STEPS }]);
        const out = await t.run();
        expect(out.map(m => m.text)).toContain('Mình kết duyên do ông trời.');
    });

    it('도중에 멈추면(조각이 안 옴) 기다리다 끊고 이어받는다', async () => {
        const t = setup([{ steps: [...FIRST_CUT_STEPS, { hang: true }] }, { steps: CONT_OK_STEPS }],
            { timeouts: { firstChunkMs: 1000, idleMs: 40 } });
        const out = await t.run();
        expect(out.map(m => m.text)).toContain('Mình kết duyên do ông trời.');
        expect(t.model.calls[0].opts.signal.aborted).toBe(true); // 멈춘 연결은 실제로 끊었다
    });

    it('첫 응답이 아예 안 오면 첫 대기 시간 뒤 처음부터 다시', async () => {
        const t = setup([{ steps: [{ hang: true }] }, { steps: [{ text: L(0, 'Xin chào.'), finish: 'STOP' }] }],
            { timeouts: { firstChunkMs: 40, idleMs: 1000 } });
        const out = await t.run();
        expect(secs(out)).toEqual([0]);
        expect(t.model.calls[1].parts).toBe(t.firstParts); // 받은 게 없으면 원래 요청 그대로 재사용
    });

    it('시작부터 과부하(503)면 같은 요청을 다시 보낸다', async () => {
        const busy = Object.assign(new Error('[503 Service Unavailable] The model is overloaded'), { status: 503 });
        const t = setup([{ throwOnStart: busy }, { steps: [{ text: L(0, 'Xin chào.'), finish: 'STOP' }] }]);
        const out = await t.run();
        expect(secs(out)).toEqual([0]);
        expect(t.model.calls[1].parts).toBe(t.firstParts);
        expect(t.cuts).toHaveLength(0);
    });

    it(`${RESUME_MAX_ATTEMPTS}번 이어받아도 안 되면 받은 데까지 돌려주고 끊긴 지점을 알린다`, async () => {
        const cutNoProgress = { steps: [] }; // 이어받기마다 아무것도 없이 닫힘
        const t = setup([{ steps: FIRST_CUT_STEPS }, cutNoProgress, cutNoProgress, cutNoProgress, { steps: CONT_OK_STEPS }]);
        const out = await t.run();
        expect(secs(out)).toEqual([130.7, 133.4, 135.3, 138.6]); // 받은 것은 잃지 않는다
        expect(t.model.calls).toHaveLength(1 + RESUME_MAX_ATTEMPTS);
        expect(t.incompletes).toHaveLength(1);
        expect(t.incompletes[0].at).toBe(138.6);
    });

    it('한 줄도 못 받고 모두 실패하면 조용히 빈 결과가 아니라 오류로 알린다', async () => {
        const reset = new Error('[GoogleGenerativeAI Error]: Error reading from the stream');
        const fail = { steps: [{ error: reset }] };
        const t = setup([fail, fail, fail, fail]);
        await expect(t.run()).rejects.toThrow(/reading from the stream/);
    });
});

describe('실제 이어받기 루프 — 이어받으면 안 되는 경우', () => {
    it('저작권 차단(RECITATION)은 예전처럼 오류로 알린다 (다시 보내지 않음)', async () => {
        const blocked = Object.assign(new Error('Candidate was blocked due to RECITATION'), { response: {} });
        const t = setup([{ steps: [{ text: L(0, 'Xin chào.') }, { blocked }] }]);
        await expect(t.run()).rejects.toThrow(/RECITATION/);
        expect(t.model.calls).toHaveLength(1);
    });

    it('사용자가 중단하면 이어받지 않고 바로 멈춘다 (멈춘 연결도 즉시 끊김)', async () => {
        const user = new AbortController();
        const t = setup([{ steps: [{ text: L(0, 'Xin chào.') }, { hang: true }] }],
            { signal: user.signal, timeouts: { firstChunkMs: 5000, idleMs: 5000 } });
        setTimeout(() => user.abort(), 30);
        await expect(t.run()).rejects.toMatchObject({ name: 'AbortError' });
        expect(t.model.calls).toHaveLength(1);
    });

    it('끊김은 StreamIncompleteError로 표시되어 재정렬·재전사가 알아볼 수 있다', () => {
        const e = new StreamIncompleteError('cut', [line(1, 'a')]);
        expect(e.name).toBe('StreamIncompleteError');
        expect(e.partial).toHaveLength(1);
        expect(e.message).toMatch(/끊겼어요/);
    });
});
