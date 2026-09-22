// Stage 1 전사 스트림 '끊김 감지 + 이어받기' 검증.
//
// 실측 사례(2026-09): 노래 "Vạn Sự Như Ý"(4:05)를 전사하다 구글 서버 과부하로 스트림이 도중에 닫혔는데
// 예전 코드는 이를 '정상 완료'로 보고 2:18.6 "A a"까지만 저장했다(오류 표시 없음). 끊기지 않은 실행은
// 3:51의 [END_OF_AUDIO]까지 62줄이 나온다. 아래 줄·시각은 그 실측 결과에서 가져왔다.
//
// 같은 노래에서 두 가지가 더 실측됐다: ①반복 루프 — 2:18 "A a"를 쓰다 " a ※ a ※ …"가 줄바꿈 없이
// 131,131자(출력 한도, 약 250초)까지 이어짐 ②저작권 차단(RECITATION) — 받은 가사까지 전부 버려짐.
//
// 앞부분은 순수 함수, 뒷부분은 gemini.js의 '실제' 이어받기 루프(transcribeWithResume)를
// 가짜 모델로 돌린다 — 사본이 아니라 실제 소스를 import 한다(CLAUDE.md 테스트 규칙).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    isStreamComplete, isResumableStreamError, planResume, spliceResume,
    isRecitationBlock, isRunawayRepeat, incompleteNotice, recitationBlockedMessage,
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
    it('안전 차단 등 SDK ResponseError는 여기서 이어받지 않는다 (저작권 차단은 isRecitationBlock이 따로 살린다)', () => {
        expect(isResumableStreamError(Object.assign(new Error('blocked due to SAFETY'), { response: {} }))).toBe(false);
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
    it('다시 받은 "버렸던 줄"은 원래 시각을 쓴다 (실측: 클립 첫 줄이 클립 0초로 찍혀 2:15.36 → 2:15.06)', () => {
        const p = planResume([...BEFORE_CUT.slice(0, 2), line(135.36, 'Nhớ chọn đúng người mình thương.')], 0, SONG_END);
        const out = spliceResume(p, [line(135.06, 'Nhớ chọn đúng người mình thương.'), line(138.5, 'A a')]);
        expect(out.map(l => l.seconds)).toEqual([130.7, 133.4, 135.36, 138.5]);
    });
});

// 실측 반복 꼬리: 2:18 "A a"를 쓰다가 이 조각이 줄바꿈 없이 131,131자까지 이어졌다
const LOOP_OBSERVED_CHARS = 131131;
const LOOP_UNIT = ' a ※';

describe('반복 루프 판정', () => {
    it('실측 꼬리(" a ※ a ※ …")가 2000자를 넘으면 루프', () => {
        expect(isRunawayRepeat('[02:18.60] [남자] || A ※' + LOOP_UNIT.repeat(1000))).toBe(true);
    });
    it('노래의 짧은 되풀이 줄(la la …, 기호 포함 수백 자)은 루프가 아니다', () => {
        expect(isRunawayRepeat('[01:10.00] [여자] || ' + 'la ※ '.repeat(60))).toBe(false);
    });
    it('길어도 서로 다른 단어가 많으면(되풀이 아님) 루프가 아니다', () => {
        expect(isRunawayRepeat(Array.from({ length: 400 }, (_, i) => `câu${i}`).join(' '))).toBe(false);
    });
});

// SDK가 차단된 조각에서 던지는 오류와 같은 모양
const blockError = (reason) => Object.assign(
    new Error(`[GoogleGenerativeAI Error]: Candidate was blocked due to ${reason}`),
    { response: { candidates: [{ finishReason: reason }] } });

describe('저작권 차단 판정', () => {
    it('SDK가 던지는 RECITATION 차단을 알아본다', () => {
        expect(isRecitationBlock(blockError('RECITATION'))).toBe(true);
    });
    it('안전 차단·서버 오류·연결 끊김은 저작권 차단이 아니다', () => {
        expect(isRecitationBlock(blockError('SAFETY'))).toBe(false);
        expect(isRecitationBlock(Object.assign(new Error('x'), { status: 503 }))).toBe(false);
        expect(isRecitationBlock(new Error('[GoogleGenerativeAI Error]: Error reading from the stream'))).toBe(false);
    });
});

describe('사용자 안내 문구', () => {
    it('끝까지 못 받은 사유를 맞게 알린다 (예전엔 전부 "구글 서버가 불안정해")', () => {
        expect(incompleteNotice({ at: 138.6, reason: 'RECITATION' })).toMatch(/^저작권 필터에 걸려 02:18 이후/);
        expect(incompleteNotice({ at: 135.3, reason: 'loop' })).toMatch(/같은 말을 되풀이하는 오류로 02:15 이후/);
        expect(incompleteNotice({ at: 138.6, reason: 'cut' })).toMatch(/^구글 서버가 불안정해 02:18 이후/);
    });
    it('저작권 차단 오류는 목록에 없는 모델("1.5 Pro")을 권하지 않는다', () => {
        for (const o of [{}, { antiRecitation: true, markerInterval: 7 }, { antiRecitation: true, markerInterval: 2 }]) {
            expect(recitationBlockedMessage(o)).not.toMatch(/1\.5/);
        }
    });
    it('방지 모드가 꺼져 있으면 켜라고, 켜져 있으면 간격을 줄이라고 안내한다', () => {
        expect(recitationBlockedMessage({ antiRecitation: false })).toMatch(/'RECITATION 방지 모드'를 켜고/);
        expect(recitationBlockedMessage({ antiRecitation: true, markerInterval: 7 })).toMatch(/7단어에서 2단어로/);
        expect(recitationBlockedMessage({ antiRecitation: true, markerInterval: 2 })).toMatch(/다시 시도/);
    });
    it('안내가 가리키는 설정 이름이 설정 창에 실제로 있다', () => {
        const modal = readFileSync(new URL('../../components/SettingsModal.jsx', import.meta.url), 'utf8');
        expect(modal).toContain('RECITATION 방지 모드');
        expect(modal).toContain('삽입 간격');
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
//        | { blocked } 차단된 조각(text()가 던짐) | { repeat, times } 같은 조각을 times번(반복 루프)
//  script.sent: 받는 쪽이 실제로 가져간 글자 수 — 반복 루프를 '얼마나 빨리' 끊었는지 재는 데 쓴다
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
                    if (st.blocked) {
                        const finishReason = st.blocked.response?.candidates?.[0]?.finishReason || 'RECITATION';
                        yield { candidates: [{ finishReason }], text: () => { throw st.blocked; } };
                        continue;
                    }
                    if (st.repeat) {
                        for (let i = 0; i < st.times; i++) {
                            script.sent = (script.sent || 0) + st.repeat.length;
                            yield { candidates: [{}], text: () => st.repeat };
                        }
                        continue;
                    }
                    script.sent = (script.sent || 0) + (st.text || '').length;
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

describe('실제 파서 — 숫자 병기 폭주 정리 (stage1Line.js)', () => {
    it('실측 사례: 단어마다 "(1)"이 붙어 온 줄은 괄호를 지워 저장한다', async () => {
        const t = setup([{ steps: [{
            text: L(421.07, 'Hôm nay(1) là(1) còn(1) thừa(1) một(1) nghìn(1.000) mình(1.000) không(1.000) mua(1.000) cơm(1.000).')
                + L(428.28, 'Thế nên là mình quyết định rút một nghìn(1.000) ra để mua cái miếng bí này của bà mình.'),
            finish: 'STOP',
        }] }], { segEnd: 961.07, hardLimit: 961.07 });
        const out = await t.run();
        expect(out.map(m => m.text)).toEqual([
            'Hôm nay là còn thừa một nghìn mình không mua cơm.',
            'Thế nên là mình quyết định rút một nghìn(1.000) ra để mua cái miếng bí này của bà mình.', // 정상 병기는 그대로
        ]);
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

// 반복 루프 실측(2026-09, 간격 1·2): 2:15.3 줄 다음 "A a"(2:18)를 쓰다가 " a ※ a ※ …"가
// 줄바꿈 없이 131,131자(65,538토큰, 약 250초)까지 이어지고 출력 한도(MAX_TOKENS)로 끝났다.
const LOOP_CHUNK = LOOP_UNIT.repeat(16); // 64자씩 흘려보냄
const loopFirstScript = () => ({ steps: [
    { text: L(130.7, BEFORE_CUT[0].text) + L(133.4, BEFORE_CUT[1].text) + L(135.3, BEFORE_CUT[2].text) + '[02:18.60] [남자] || A ※' },
    { repeat: LOOP_CHUNK, times: Math.ceil(LOOP_OBSERVED_CHARS / LOOP_CHUNK.length) },
    { finish: 'MAX_TOKENS' },
] });
// 이어받기는 마지막 온전한 줄 2:15.3의 0.3초 앞(135.0초)부터 — 시각은 클립 기준
const LOOP_CONT_STEPS = [
    { text: L(0.3, 'Nhớ chọn đúng người mình thương.') + L(3.6, 'A a') + L(7.3, 'Mình kết duyên do ông trời.') },
    { text: L(11.3, 'A a') + L(15.0, 'Nguyện một lòng với nhau hỡi người ơi.') + L(82.4, 'Tằng tằng') },
    { text: '[01:56.70] [END_OF_AUDIO]\n', finish: 'STOP' },
];
const FULL_AFTER_RESUME = [130.7, 133.4, 135.3, 138.6, 142.3, 146.3, 150, 217.4];

describe('실제 이어받기 루프 — 반복 루프', () => {
    it('실측 사례: " a ※ a ※ …"가 끝없이 이어지면 출력 한도까지 기다리지 않고 끊어 2:15.3부터 이어받는다', async () => {
        const first = loopFirstScript();
        const t = setup([first, { steps: LOOP_CONT_STEPS }]);
        const out = await t.run();
        expect(secs(out)).toEqual(FULL_AFTER_RESUME);
        // 실측은 131,131자(약 250초)를 다 기다렸다 — 그 3%(약 8초) 안에서 끊었는지
        expect(first.sent).toBeLessThan(LOOP_OBSERVED_CHARS * 0.03);
        expect(t.model.calls[0].opts.signal.aborted).toBe(true); // 연결도 끊어 서버가 계속 쓰지 않게
        expect(t.cuts[0].start).toBeCloseTo(135.0, 5);
        expect(t.incompletes).toHaveLength(0);
    });

    it('같은 줄을 줄바꿈하며 끝없이 되풀이해도 곧 끊고 이어받는다 (가정 사례)', async () => {
        // 옛 연속 중복 방어망이 줄은 걸러 줬지만, 스트림은 출력 한도까지 계속 받았다
        const repeatLine = L(138.6, 'A a');
        const first = { steps: [
            FIRST_CUT_STEPS[0], { text: L(135.3, BEFORE_CUT[2].text) },
            { repeat: repeatLine, times: 6000 },
            { finish: 'MAX_TOKENS' },
        ] };
        const t = setup([first, { steps: CONT_OK_STEPS }]);
        const out = await t.run();
        expect(secs(out)).toEqual(FULL_AFTER_RESUME);
        expect(first.sent).toBeLessThan(repeatLine.length * 6000 * 0.03);
        expect(t.model.calls[0].opts.signal.aborted).toBe(true);
    });

    it('반복이 아닌 긴 줄은 끊지 않는다 (형식을 어겨 여러 문장을 한 줄에 쓴 경우 등)', async () => {
        const longLine = Array.from({ length: 400 }, (_, i) => `câu${i}`).join(' '); // 서로 다른 단어 400개
        const t = setup([{ steps: [
            { text: L(0, 'Xin chào.') + '[00:03.20] [남자] || ' + longLine.slice(0, 1200) },
            { text: longLine.slice(1200, 2400) }, // 줄바꿈 없이 2400자를 넘김
            { text: longLine.slice(2400) + '\n' + L(9.0, 'Tạm biệt.'), finish: 'STOP' },
        ] }]);
        const out = await t.run();
        expect(t.model.calls).toHaveLength(1);
        expect(t.model.calls[0].opts.signal.aborted).toBe(false);
        expect(out.map(m => m.text)).toContain('Tạm biệt.');
    });

    it('같은 줄이 몇십 번 이어지는 정도(구호·후렴)는 반복 루프로 보지 않는다 (가정 사례)', async () => {
        const chant = Array.from({ length: 20 }, (_, i) => L(10 + i * 2, 'Hey!')).join('');
        const t = setup([{ steps: [{ text: L(0, 'Xin chào.') + chant + L(60, 'Tạm biệt.'), finish: 'STOP' }] }]);
        const out = await t.run();
        expect(t.model.calls).toHaveLength(1);
        expect(out.map(m => m.text)).toEqual(['Xin chào.', 'Hey!', 'Tạm biệt.']); // 되풀이 줄은 예전처럼 하나만
    });

    it('이어받아도 매번 루프에 빠지면 받은 데까지 저장하고 "같은 말 되풀이" 사유로 알린다', async () => {
        // 이어받은 클립(135.0초~)에서도 3.6초(=2:18.6) "A a"에서 다시 루프
        const loopAgain = () => ({ steps: [
            { text: L(0.3, BEFORE_CUT[2].text) + '[00:03.60] [남자] || A ※' },
            { repeat: LOOP_CHUNK, times: 2000 },
            { finish: 'MAX_TOKENS' },
        ] });
        const t = setup([loopFirstScript(), loopAgain(), loopAgain(), loopAgain()]);
        const out = await t.run();
        expect(secs(out)).toEqual([130.7, 133.4, 135.3]);
        expect(t.model.calls).toHaveLength(1 + RESUME_MAX_ATTEMPTS);
        expect(t.incompletes).toHaveLength(1);
        expect(t.incompletes[0].reason).toBe('loop');
        expect(t.incompletes[0].at).toBeCloseTo(135.3, 5);
    });
});

describe('실제 이어받기 루프 — 같은 줄에서 이어받기가 겹칠 때', () => {
    it('실측 사례(방지 모드 끔): 3:33.58 줄 뒤 "tằng tằng …" 루프가 매번 나도 그 줄 시각이 당겨지지 않는다', async () => {
        // 실측: 매번 그 줄을 클립 0초로 다시 적어 3:33.58 → 3:33.28 → 3:32.98로 0.3초씩 당겨졌다
        const lastLine = 'Vạn sự như ý vui cười đẹp xinh.';
        const loopTail = { repeat: ' tằng'.repeat(12), times: 3000 };
        const first = { steps: [
            { text: L(208.7, 'Xung quanh là lá hoa hát câu tâm tình.') + L(211.9, 'Nắng mỉm cười lung linh.') + L(213.58, lastLine) + '[03:37.20] [남자] || Tằng tằng' },
            loopTail, { finish: 'MAX_TOKENS' },
        ] };
        const again = () => ({ steps: [
            { text: L(0, lastLine) + '[00:03.92] [남자] || Tằng tằng' }, // 클립 0초 = 213.28초
            loopTail, { finish: 'MAX_TOKENS' },
        ] });
        const t = setup([first, again(), again(), again()]);
        const out = await t.run();
        expect(out.at(-1).text).toBe(lastLine);
        expect(out.at(-1).seconds).toBeCloseTo(213.58, 5);
        expect(t.cuts.map(c => Math.round(c.start * 100) / 100)).toEqual([213.28, 213.28, 213.28]);
        expect(t.incompletes).toHaveLength(1);
        expect(t.incompletes[0]).toMatchObject({ reason: 'loop' });
        expect(t.incompletes[0].at).toBeCloseTo(213.58, 5);
    });
});

describe('실제 이어받기 루프 — 저작권 차단(RECITATION)', () => {
    it('도중에 차단되면 받은 가사는 두고, 차단된 곳부터 다시 받아 채운다 (예전엔 전부 버림)', async () => {
        const t = setup([{ steps: [...FIRST_CUT_STEPS, { blocked: blockError('RECITATION') }] }, { steps: CONT_OK_STEPS }]);
        const out = await t.run();
        expect(secs(out)).toEqual(FULL_AFTER_RESUME);
        expect(t.cuts[0].start).toBeCloseTo(138.3, 5);
        expect(t.model.calls).toHaveLength(2);
        expect(t.incompletes).toHaveLength(0);
    });

    it('다시 받아도 계속 차단되면 받은 데까지 저장하고 "저작권 필터" 사유로 알린다', async () => {
        const blockedNow = { steps: [{ blocked: blockError('RECITATION') }] };
        const t = setup([{ steps: [...FIRST_CUT_STEPS, { blocked: blockError('RECITATION') }] }, blockedNow, blockedNow, blockedNow]);
        const out = await t.run();
        expect(secs(out)).toEqual([130.7, 133.4, 135.3, 138.6]);
        expect(t.model.calls).toHaveLength(1 + RESUME_MAX_ATTEMPTS);
        expect(t.incompletes).toEqual([{ at: 138.6, reason: 'RECITATION' }]);
    });

    it('시작하자마자 차단되면 같은 요청을 다시 보내 본다 (차단은 매번 나지 않는다)', async () => {
        const t = setup([{ steps: [{ blocked: blockError('RECITATION') }] }, { steps: [{ text: L(0, 'Xin chào.'), finish: 'STOP' }] }]);
        const out = await t.run();
        expect(secs(out)).toEqual([0]);
        expect(t.model.calls[1].parts).toBe(t.firstParts);
    });

    it('끝내 한 줄도 못 받으면 저작권 차단 오류로 알린다', async () => {
        const b = { steps: [{ blocked: blockError('RECITATION') }] };
        const t = setup([b, b, b, b]);
        await expect(t.run()).rejects.toThrow(/RECITATION/);
        expect(t.model.calls).toHaveLength(1 + RESUME_MAX_ATTEMPTS);
    });
});

describe('실제 이어받기 루프 — 이어받으면 안 되는 경우', () => {
    it('안전 차단(SAFETY)은 다시 보내도 같아 예전처럼 바로 오류로 알린다', async () => {
        const t = setup([{ steps: [{ text: L(0, 'Xin chào.') }, { blocked: blockError('SAFETY') }] }]);
        await expect(t.run()).rejects.toThrow(/SAFETY/);
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
