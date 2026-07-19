import { useState, useCallback } from 'react';
import { clampLoopGroupSize } from '../utils/loopGroups';

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
    speechOnlyEnabled: false, // 대사만 재생: 반복 시 대사 끝~다음 대사 사이 긴 배경음악/무음 건너뛰기
};

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
};

function loadFromStorage() {
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
    };
}

export const useSettings = () => {
    const [config, setConfig] = useState(loadFromStorage);

    const updateField = useCallback((field, value) => {
        setConfig(prev => {
            const next = { ...prev, [field]: value };
            if (STORAGE_KEYS[field]) {
                localStorage.setItem(STORAGE_KEYS[field], String(value));
            }
            return next;
        });
    }, []);

    return { config, updateField };
};
