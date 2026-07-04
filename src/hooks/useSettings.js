import { useState, useCallback } from 'react';

const DEFAULTS = {
    apiKey: '',
    stage1Model: 'gemini-2.5-flash',
    stage2Model: 'gemini-2.5-flash',
    bufferTime: 0.3,
    temperature: 0.5,
    topP: 0.7,
    antiRecitation: false,
    markerChar: '\u203B', // ※
    markerInterval: 2,
    chunkEnabled: false,
    chunkMinutes: 10,
    realignEnabled: true,
};

const STORAGE_KEYS = {
    apiKey: 'miniapp_gemini_key',
    stage1Model: 'miniapp_stage1_model',
    stage2Model: 'miniapp_stage2_model',
    bufferTime: 'miniapp_buffer_time',
    temperature: 'miniapp_temperature',
    topP: 'miniapp_top_p',
    antiRecitation: 'miniapp_anti_recitation',
    markerChar: 'miniapp_marker_char',
    markerInterval: 'miniapp_marker_interval',
    chunkEnabled: 'miniapp_chunk_enabled',
    chunkMinutes: 'miniapp_chunk_minutes',
    realignEnabled: 'miniapp_realign_enabled',
};

function loadFromStorage() {
    return {
        apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || import.meta.env.VITE_GEMINI_API_KEY || DEFAULTS.apiKey,
        stage1Model: localStorage.getItem(STORAGE_KEYS.stage1Model) || DEFAULTS.stage1Model,
        stage2Model: localStorage.getItem(STORAGE_KEYS.stage2Model) || DEFAULTS.stage2Model,
        bufferTime: parseFloat(localStorage.getItem(STORAGE_KEYS.bufferTime)) || DEFAULTS.bufferTime,
        temperature: parseFloat(localStorage.getItem(STORAGE_KEYS.temperature)) || DEFAULTS.temperature,
        topP: parseFloat(localStorage.getItem(STORAGE_KEYS.topP)) || DEFAULTS.topP,
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
