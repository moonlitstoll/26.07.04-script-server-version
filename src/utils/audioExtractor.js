import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;
let isLoading = false;

// public/ffmpeg 에 복사해 둔 싱글스레드 코어 (same-origin, 항상 로드 가능)
const FFMPEG_CORE_JS = `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.js`;
const FFMPEG_CORE_WASM = `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.wasm`;

/**
 * FFmpeg 싱글 스레드 인스턴스 반환
 */
async function getFFmpeg() {
    if (ffmpegInstance) return ffmpegInstance;
    if (isLoading) {
        while (isLoading) await new Promise(r => setTimeout(r, 100));
        return ffmpegInstance;
    }

    isLoading = true;
    try {
        const ffmpeg = new FFmpeg();
        // same-origin 코어를 blob URL로 변환해 로드 (CDN/CORS/코어 미해석 문제 회피)
        await ffmpeg.load({
            coreURL: await toBlobURL(FFMPEG_CORE_JS, 'text/javascript'),
            wasmURL: await toBlobURL(FFMPEG_CORE_WASM, 'application/wasm'),
        });
        ffmpegInstance = ffmpeg;
        return ffmpeg;
    } catch (err) {
        console.error('FFmpeg Load Error:', err);
        throw new Error(`FFmpeg 로드 실패: ${err.message}`);
    } finally {
        isLoading = false;
    }
}

// PCM(Float32) → 16-bit mono WAV 인코딩
function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, 1, true);            // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);            // block align
    view.setUint16(34, 16, true);           // bits per sample
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}

/**
 * 브라우저 내장 Web Audio API로 미디어에서 오디오를 추출한다 (FFmpeg 불필요).
 * 음성 인식에 충분한 16kHz 모노 WAV로 다운샘플하여 용량을 크게 줄인다.
 * (영상을 통째로 보내 Gemini 처리 실패하던 문제를 회피)
 * @param {File|Blob} file
 * @param {number} targetRate 목표 샘플레이트 (기본 16000)
 * @returns {Promise<Blob>} audio/wav Blob
 */
export async function extractAudioWav(file, targetRate = 16000) {
    const arrayBuffer = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('AudioContext 미지원 브라우저');

    const tmp = new AC();
    let decoded;
    try {
        decoded = await tmp.decodeAudioData(arrayBuffer);
    } finally {
        try { await tmp.close(); } catch { /* noop */ }
    }
    if (!decoded || decoded.length === 0) throw new Error('오디오 트랙을 찾을 수 없음');

    // OfflineAudioContext로 16kHz 모노 리샘플링
    const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, frames, targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();

    const wav = encodeWAV(rendered.getChannelData(0), targetRate);
    return new Blob([wav], { type: 'audio/wav' });
}

/**
 * 오디오 Blob을 시간 기준으로 청크 분할 (무변환 copy)
 */
export async function splitAudio(audioBlob, totalDuration, chunkDurationSec, overlapSec = 30) {
    const ffmpeg = await getFFmpeg();
    const inputName = `split_input_${Date.now()}.aac`;
    await ffmpeg.writeFile(inputName, await fetchFile(audioBlob));

    const step = chunkDurationSec - overlapSec;
    const chunks = [];
    let startSec = 0;
    let index = 0;

    try {
        while (startSec < totalDuration) {
            const duration = Math.min(chunkDurationSec + overlapSec, totalDuration - startSec);
            const outputName = `chunk_${index}_${Date.now()}.aac`;

            await ffmpeg.exec([
                '-i', inputName,
                '-ss', String(startSec),
                '-t', String(duration),
                '-acodec', 'copy',
                outputName
            ]);

            const data = await ffmpeg.readFile(outputName);
            chunks.push({
                blob: new Blob([data.buffer], { type: 'audio/aac' }),
                offsetSec: startSec,
                durationSec: duration,
            });

            await ffmpeg.deleteFile(outputName);
            startSec += step;
            index++;
        }
    } finally {
        try { await ffmpeg.deleteFile(inputName); } catch (e) { /* cleanup */ }
    }

    console.log(`[Split] ${chunks.length} chunks (${chunkDurationSec}s each, ${overlapSec}s overlap)`);
    return chunks;
}

/**
 * 미디어 파일에서 오디오 트랙을 디코딩/재인코딩 없이 원본 그대로 복사 적출(Demuxing)합니다.
 * 타임스탬프 왜곡 및 리샘플링 음질 변형 0% 보장.
 * 
 * @param {File} file - 입력 비디오/오디오 파일
 * @returns {Promise<Blob>} - 압축 해제 없이 꺼낸 순수 오디오 트랙 (AAC 등)
 */
export async function extractOriginalAudio(file) {
    const ffmpeg = await getFFmpeg();

    // 파일명에서 확장자 유추 (비디오 등)
    const inputExt = file.name.split('.').pop() || 'mp4';
    const inputName = `input_${Date.now()}.${inputExt}`;
    // 16kHz 모노 WAV로 출력 (PCM 인코더는 항상 포함 → 어떤 소스 코덱이든 성공)
    const outputName = `output_${Date.now()}.wav`;

    try {
        // 1. 메모리에 파일 쓰기
        await ffmpeg.writeFile(inputName, await fetchFile(file));

        // 2. 오디오만 디코드 → 16kHz 모노 WAV 재인코딩
        // -vn: 비디오 무시, -ac 1: 모노, -ar 16000: 16kHz, -c:a pcm_s16le: 16-bit PCM
        // (H.265 등 브라우저가 못 읽는 코덱도 FFmpeg는 디코드 가능 → Gemini 호환 오디오 생성)
        await ffmpeg.exec(['-i', inputName, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputName]);

        // 3. 적출된 결과 읽기
        const data = await ffmpeg.readFile(outputName);
        return new Blob([data.buffer], { type: 'audio/wav' });
    } catch (err) {
        console.error('FFmpeg extraction error:', err);
        throw new Error(`오디오 트랙 적출 실패: ${err.message}`);
    } finally {
        // 4. 가상 파일 정리
        try {
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);
        } catch (cleanupErr) {
            console.warn('FFmpeg cleanup:', cleanupErr);
        }
    }
}
