import { describe, it, expect } from 'vitest';
import { rememberAudio, reusableAudio, forgetAudio, audioReuseKey, AUDIO_REUSE_MS } from '../audioReuse';

const FILE = { name: '5. Sống Sót 1 Tuần với Bữa Ăn 10K.mp4', size: 24560370 };
const UPLOADED = { fileData: { fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'audio/wav' } };
const T0 = 1_800_000_000_000;

describe('1단계 오디오 재사용 기록', () => {
    it('구글에 올린 오디오(fileData)는 기억하고 같은 신원으로 꺼낸다', () => {
        const c = new Map();
        rememberAudio(c, FILE, UPLOADED, 961.07, T0);
        expect(reusableAudio(c, { ...FILE }, T0 + 1000)).toMatchObject({ part: UPLOADED, duration: 961.07 });
    });
    it('요청에 직접 실은 오디오(inlineData)는 기억하지 않는다', () => {
        const c = new Map();
        rememberAudio(c, FILE, { inlineData: { data: 'AAAA', mimeType: 'audio/wav' } }, 60, T0);
        expect(reusableAudio(c, FILE, T0)).toBeNull();
    });
    it('이름이나 크기가 다르면 다른 영상', () => {
        const c = new Map();
        rememberAudio(c, FILE, UPLOADED, 961, T0);
        expect(reusableAudio(c, { ...FILE, size: FILE.size + 1 }, T0)).toBeNull();
        expect(reusableAudio(c, { ...FILE, name: '4.mp4' }, T0)).toBeNull();
    });
    it('46시간이 지나면 쓰지 않고 지운다(구글 보관 48시간)', () => {
        const c = new Map();
        rememberAudio(c, FILE, UPLOADED, 961, T0);
        expect(reusableAudio(c, FILE, T0 + 46 * 3600 * 1000)).not.toBeNull();
        expect(reusableAudio(c, FILE, T0 + 46 * 3600 * 1000 + 1)).toBeNull();
        expect(c.size).toBe(0);
        expect(AUDIO_REUSE_MS).toBe(46 * 3600 * 1000);
    });
    it('재사용이 실패하면 잊는다', () => {
        const c = new Map();
        rememberAudio(c, FILE, UPLOADED, 961, T0);
        forgetAudio(c, FILE);
        expect(reusableAudio(c, FILE, T0)).toBeNull();
    });
    it('신원 키는 캐시 키와 같은 모양(이름_크기)', () => {
        expect(audioReuseKey(FILE)).toBe('5. Sống Sót 1 Tuần với Bữa Ăn 10K.mp4_24560370');
        expect(audioReuseKey(null)).toBe('');
    });
});
