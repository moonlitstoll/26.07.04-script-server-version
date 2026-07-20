// 설정 저장값 파싱 규칙 검증 (loadFromStorage).
//
// 이 파일이 지키는 것: 저장소가 비었거나 오염됐을 때도 앱이 정상 기본값으로 뜬다는 것.
// 설정은 앱 시작 시 단 한 번 읽히므로, 여기서 잘못된 값이 새어 나가면
// 재생 엔진·출제 로직이 이상한 값을 들고 조용히 오동작한다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadFromStorage } from '../useSettings';
import { SPEECH_TAIL_PAD, TAIL_PAD_MIN, TAIL_PAD_MAX } from '../../utils/speechSegments';

// node 환경에는 localStorage가 없으므로 최소 스텁을 깐다.
const store = new Map();
beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    });
});

describe('저장값이 없을 때 — 기본값', () => {
    it('가리기 난이도는 초급', () => {
        expect(loadFromStorage().difficulty).toBe('easy');
    });

    it('번역/분석은 보이는 상태로 시작한다', () => {
        // 기본값이 true라 `=== 'true'` 패턴을 쓰면 키가 없을 때 false로 뒤집힌다.
        expect(loadFromStorage().showAnalysis).toBe(true);
    });

    it('빈칸 섞기 회차는 0', () => {
        expect(loadFromStorage().drillRound).toBe(0);
    });

    it('대사 꼬리 여유는 speechSegments의 기본 상수를 따른다', () => {
        expect(loadFromStorage().speechTailPad).toBe(SPEECH_TAIL_PAD);
    });
});

describe('저장값이 있을 때 — 그대로 복원', () => {
    it('마지막에 고른 난이도로 시작한다', () => {
        for (const d of ['easy', 'mid', 'hard', 'recall']) {
            store.set('miniapp_drill_difficulty', d);
            expect(loadFromStorage().difficulty).toBe(d);
        }
    });

    it('분석을 꺼둔 채로 종료하면 꺼진 채로 열린다', () => {
        store.set('miniapp_show_analysis', 'false');
        expect(loadFromStorage().showAnalysis).toBe(false);
        store.set('miniapp_show_analysis', 'true');
        expect(loadFromStorage().showAnalysis).toBe(true);
    });

    it('빈칸 회차가 유지된다 ("새 문제"를 다시 눌러 오답을 버리지 않아도 되게)', () => {
        store.set('miniapp_drill_round', '7');
        expect(loadFromStorage().drillRound).toBe(7);
    });

    it('꼬리 여유가 유지된다', () => {
        store.set('miniapp_speech_tail_pad', '0.7');
        expect(loadFromStorage().speechTailPad).toBeCloseTo(0.7, 9);
    });
});

describe('저장값이 오염됐을 때 — 조용히 안전값으로', () => {
    it('모르는 난이도는 기본값으로 되돌린다 (buildCloze가 깨지지 않게)', () => {
        for (const bad of ['expert', '', 'EASY', 'null', '3']) {
            store.set('miniapp_drill_difficulty', bad);
            expect(loadFromStorage().difficulty, `입력=${JSON.stringify(bad)}`).toBe('easy');
        }
    });

    it('분석 표시에 이상한 문자열이 오면 false로 본다 (true만 참)', () => {
        store.set('miniapp_show_analysis', 'yes');
        expect(loadFromStorage().showAnalysis).toBe(false);
    });

    it('회차가 음수/문자열/NaN이면 0으로', () => {
        for (const bad of ['-3', 'abc', '', 'NaN']) {
            store.set('miniapp_drill_round', bad);
            expect(loadFromStorage().drillRound, `입력=${JSON.stringify(bad)}`).toBe(0);
        }
    });

    it('꼬리 여유는 허용 범위로 강제된다', () => {
        store.set('miniapp_speech_tail_pad', '999');
        expect(loadFromStorage().speechTailPad).toBe(TAIL_PAD_MAX);
        store.set('miniapp_speech_tail_pad', '0');
        expect(loadFromStorage().speechTailPad).toBe(TAIL_PAD_MIN);
        store.set('miniapp_speech_tail_pad', 'abc');
        expect(loadFromStorage().speechTailPad).toBe(SPEECH_TAIL_PAD);
    });
});

describe('유지하지 않기로 한 것들은 config에 없다', () => {
    // 이것들은 저장하면 앱이 이상한 화면으로 시작한다(대본이 사라지거나 파괴적 모드 진입).
    // 실수로 추가되는 것을 막기 위해 명시적으로 단정한다 — 근거는 CLAUDE.md 참고.
    it('오답만 보기 / 선택 모드 / 모달 열림 / 가리기 on-off 는 설정이 아니다', () => {
        const cfg = loadFromStorage();
        for (const k of ['mistakeOnly', 'selectMode', 'showTrash', 'showSettings', 'drillMode', 'searchQuery']) {
            expect(cfg, `${k}가 config에 들어옴`).not.toHaveProperty(k);
        }
    });
});
