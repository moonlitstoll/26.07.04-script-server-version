import { useState, useCallback } from 'react';
import { clampLoopGroupSize } from '../utils/loopGroups';
import { SPEECH_TAIL_PAD, clampTailPad } from '../utils/speechSegments';

const DEFAULTS = {
    apiKey: '',
    stage1Model: 'gemini-2.5-flash',
    stage2Model: 'gemini-2.5-flash',
    stage3Model: 'gemini-2.5-pro', // 재전사/재분석 전용 (기본은 정밀 모델 Pro)
    bufferTime: 0.3,
    temperature: 0.5,
    topP: 0.7,
    antiRecitation: false,
    markerChar: '\u203B', // ※
    markerInterval: 2,
    chunkEnabled: false,
    chunkMinutes: 10,
    realignEnabled: true,
    loopGroupSize: 1,   // 묶음 반복: 한 번에 반복할 문장 수 (1 = 기존 한 문장 반복)
    speechOnlyEnabled: false, // 대사만 재생: 재생·반복 중 대사 끝~다음 대사 사이 긴 배경음악/무음 건너뛰기
    speechAutoDetect: false,  // 전사+분석 완료 후 대사 구간 감지 자동 실행 (감지 1회 비용 추가)
    // 대사만 재생에서 대사 끝 뒤에 더 듣는 여유(초). 기본값 출처는 speechSegments 하나뿐이다.
    speechTailPad: SPEECH_TAIL_PAD,
    // ─── 학습 화면 상태 (툴바에서 조작하지만 '마지막 설정'으로 유지되는 게 이로운 것들) ───
    // 유지하지 않는 것과의 경계: 오답만 보기·선택 모드·모달 열림은 유지하면 앱이 이상한 화면으로
    // 시작한다(대본이 사라지거나 파괴적 모드로 진입). 그래서 여기 넣지 않았다 — 의도적 제외다.
    difficulty: 'easy',   // 가리기 난이도. 학습자의 실력 수준이라 안정적 선호값이다.
    showAnalysis: true,   // 번역/분석 표시. 끈 채로 열려도 원문은 보이므로 혼란이 없다.
    drillRound: 0,        // 빈칸 섞기 시드. 화면에 드러나지 않지만, 리셋되면 '새 문제'를
                          // 다시 눌러야 하고 그 버튼이 오답 기록까지 지운다(강제 교환).
};

// 가리기 난이도 허용값. 오염된 문자열이 buildCloze로 흘러들면 출제가 깨지므로 화이트리스트로 막는다.
const DIFFICULTIES = ['easy', 'mid', 'hard', 'recall'];

const STORAGE_KEYS = {
    apiKey: 'miniapp_gemini_key',
    stage1Model: 'miniapp_stage1_model',
    stage2Model: 'miniapp_stage2_model',
    stage3Model: 'miniapp_stage3_model',
    bufferTime: 'miniapp_buffer_time',
    temperature: 'miniapp_temperature',
    topP: 'miniapp_top_p',
    antiRecitation: 'miniapp_anti_recitation',
    markerChar: 'miniapp_marker_char',
    markerInterval: 'miniapp_marker_interval',
    chunkEnabled: 'miniapp_chunk_enabled',
    chunkMinutes: 'miniapp_chunk_minutes',
    realignEnabled: 'miniapp_realign_enabled',
    loopGroupSize: 'miniapp_loop_group_size',
    speechOnlyEnabled: 'miniapp_speech_only',
    speechAutoDetect: 'miniapp_speech_auto_detect',
    speechTailPad: 'miniapp_speech_tail_pad',
    difficulty: 'miniapp_drill_difficulty',
    showAnalysis: 'miniapp_show_analysis',
    drillRound: 'miniapp_drill_round',
};

// export: 저장값 파싱 규칙(기본값·화이트리스트·범위)을 테스트가 직접 검증하기 위함.
// 앱 코드에서는 useSettings 초기화에만 쓴다.
export function loadFromStorage() {
    return {
        apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || import.meta.env.VITE_GEMINI_API_KEY || DEFAULTS.apiKey,
        stage1Model: localStorage.getItem(STORAGE_KEYS.stage1Model) || DEFAULTS.stage1Model,
        stage2Model: localStorage.getItem(STORAGE_KEYS.stage2Model) || DEFAULTS.stage2Model,
        stage3Model: localStorage.getItem(STORAGE_KEYS.stage3Model) || DEFAULTS.stage3Model,
        // parseFloat(...) || DEFAULT 패턴은 저장값 0을 falsy로 삼켜 기본값으로 되돌린다.
        // Number.isFinite로 검사해 유효한 0(예: bufferTime 0 = 여유 없이 시작)을 존중한다.
        bufferTime: (() => { const n = parseFloat(localStorage.getItem(STORAGE_KEYS.bufferTime)); return Number.isFinite(n) ? n : DEFAULTS.bufferTime; })(),
        temperature: (() => { const n = parseFloat(localStorage.getItem(STORAGE_KEYS.temperature)); return Number.isFinite(n) ? n : DEFAULTS.temperature; })(),
        topP: (() => { const n = parseFloat(localStorage.getItem(STORAGE_KEYS.topP)); return Number.isFinite(n) ? n : DEFAULTS.topP; })(),
        antiRecitation: localStorage.getItem(STORAGE_KEYS.antiRecitation) === 'true',
        markerChar: localStorage.getItem(STORAGE_KEYS.markerChar) || DEFAULTS.markerChar,
        markerInterval: localStorage.getItem(STORAGE_KEYS.markerInterval) !== null
            ? parseInt(localStorage.getItem(STORAGE_KEYS.markerInterval), 10)
            : DEFAULTS.markerInterval,
        chunkEnabled: localStorage.getItem(STORAGE_KEYS.chunkEnabled) === 'true',
        chunkMinutes: localStorage.getItem(STORAGE_KEYS.chunkMinutes) !== null
            ? parseInt(localStorage.getItem(STORAGE_KEYS.chunkMinutes), 10)
            : DEFAULTS.chunkMinutes,
        realignEnabled: localStorage.getItem(STORAGE_KEYS.realignEnabled) !== null
            ? localStorage.getItem(STORAGE_KEYS.realignEnabled) === 'true'
            : DEFAULTS.realignEnabled,
        // 오염된 값(NaN/범위 밖)이 들어와도 허용 범위(LOOP_GROUP_MIN~MAX)로 강제 → 묶음 로직이 이상한 N을 보는 일이 없다
        loopGroupSize: localStorage.getItem(STORAGE_KEYS.loopGroupSize) !== null
            ? clampLoopGroupSize(localStorage.getItem(STORAGE_KEYS.loopGroupSize))
            : DEFAULTS.loopGroupSize,
        speechOnlyEnabled: localStorage.getItem(STORAGE_KEYS.speechOnlyEnabled) === 'true',
        speechAutoDetect: localStorage.getItem(STORAGE_KEYS.speechAutoDetect) === 'true',
        // bufferTime의 Number.isFinite 패턴을 그대로 쓰면 안 된다 — 그건 '유효한 0 존중'이 목적이라
        // 범위 검사가 없다. 여기선 0이나 5 같은 값이 통과하면 재생 엔진이 조용히 망가지므로
        // (0 = 대사 끝나자마자 잘림, 큰 값 = 건너뛰기 자체가 사라짐) 허용 범위로 강제한다.
        speechTailPad: localStorage.getItem(STORAGE_KEYS.speechTailPad) !== null
            ? clampTailPad(localStorage.getItem(STORAGE_KEYS.speechTailPad))
            : DEFAULTS.speechTailPad,
        // 오염값은 조용히 기본값으로. 모르는 난이도가 buildCloze에 들어가면 출제가 깨진다.
        difficulty: DIFFICULTIES.includes(localStorage.getItem(STORAGE_KEYS.difficulty))
            ? localStorage.getItem(STORAGE_KEYS.difficulty)
            : DEFAULTS.difficulty,
        // 기본값이 true라 `=== 'true'`를 쓰면 안 된다(키가 없을 때 false로 뒤집힘).
        showAnalysis: localStorage.getItem(STORAGE_KEYS.showAnalysis) !== null
            ? localStorage.getItem(STORAGE_KEYS.showAnalysis) === 'true'
            : DEFAULTS.showAnalysis,
        drillRound: (() => {
            const n = parseInt(localStorage.getItem(STORAGE_KEYS.drillRound), 10);
            return Number.isFinite(n) && n >= 0 ? n : DEFAULTS.drillRound;
        })(),
    };
}

export const useSettings = () => {
    const [config, setConfig] = useState(loadFromStorage);

    // value에 함수를 넘기면 이전 값을 받아 계산한다(setState와 동일한 규약).
    //   updateField('showAnalysis', prev => !prev)
    // 이게 필요한 이유: 토글 콜백이 현재 값을 클로저로 잡으면 deps에 값을 넣어야 하고,
    // 그러면 콜백 참조가 매번 바뀌어 memo된 TranscriptItem들이 재생 틱마다 리렌더된다.
    // 함수형 업데이트를 쓰면 콜백을 deps 없이 안정 참조로 유지할 수 있다.
    const updateField = useCallback((field, value) => {
        setConfig(prev => {
            const nextValue = typeof value === 'function' ? value(prev[field]) : value;
            if (STORAGE_KEYS[field]) {
                // 저장 실패로 앱이 죽으면 안 된다 — 화면 상태는 그대로 반영하고 경고만 남긴다.
                // (localStorage는 대본 캐시가 5MB 한도를 쓰므로 실제로 꽉 찰 수 있고,
                //  사파리 프라이빗 모드에서는 setItem 자체가 예외를 던진다.)
                try {
                    localStorage.setItem(STORAGE_KEYS[field], String(nextValue));
                } catch (e) {
                    console.warn(`[Settings] '${field}' 저장 실패 — 이번 세션에만 적용됩니다.`, e);
                }
            }
            return { ...prev, [field]: nextValue };
        });
    }, []);

    return { config, updateField };
};
