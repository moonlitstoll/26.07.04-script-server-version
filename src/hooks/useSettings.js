import { useState, useCallback } from 'react';

const DEFAULTS = {
    apiKey: '',
    stage1Model: 'gemini-2.5-flash',
    stage2Model: 'gemini-2.5-flash',
    bufferTime: 0.3,
    temperature: 0.5,
    topP: 0.7,
    antiRecitation: false,
    pitchSemitones: 2,
    chunkSplit: false,
};

const STORAGE_KEYS = {
    apiKey: 'miniapp_gemini_key',
    stage1Model: 'miniapp_stage1_model',
    stage2Model: 'miniapp_stage2_model',
    bufferTime: 'miniapp_buffer_time',
    temperature: 'miniapp_temperature',
    topP: 'miniapp_top_p',
    antiRecitation: 'miniapp_anti_recitation',
    pitchSemitones: 'miniapp_pitch_semitones',
    chunkSplit: 'miniapp_chunk_split',
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
        pitchSemitones: localStorage.getItem(STORAGE_KEYS.pitchSemitones) !== null
            ? parseInt(localStorage.getItem(STORAGE_KEYS.pitchSemitones), 10)
            : DEFAULTS.pitchSemitones,
        chunkSplit: localStorage.getItem(STORAGE_KEYS.chunkSplit) === 'true',
    };
}

export const useSettings = () => {
    const [config, setConfig] = useState(loadFromStorage);

    const saveConfiguration = useCallback((newConfig) => {
        localStorage.setItem(STORAGE_KEYS.apiKey, newConfig.apiKey);
        localStorage.setItem(STORAGE_KEYS.stage1Model, newConfig.stage1Model);
        localStorage.setItem(STORAGE_KEYS.stage2Model, newConfig.stage2Model);
        localStorage.setItem(STORAGE_KEYS.bufferTime, newConfig.bufferTime.toString());
        localStorage.setItem(STORAGE_KEYS.temperature, newConfig.temperature.toString());
        localStorage.setItem(STORAGE_KEYS.topP, newConfig.topP.toString());
        localStorage.setItem(STORAGE_KEYS.antiRecitation, newConfig.antiRecitation.toString());
        localStorage.setItem(STORAGE_KEYS.pitchSemitones, newConfig.pitchSemitones.toString());
        localStorage.setItem(STORAGE_KEYS.chunkSplit, newConfig.chunkSplit.toString());
        setConfig(newConfig);
    }, []);

    const updateField = useCallback((field, value) => {
        setConfig(prev => {
            const next = { ...prev, [field]: value };
            if (STORAGE_KEYS[field]) {
                localStorage.setItem(STORAGE_KEYS[field], String(value));
            }
            return next;
        });
    }, []);

    return { config, saveConfiguration, updateField };
};
