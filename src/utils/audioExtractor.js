import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;
let isLoading = false;

// 싱글스레드 코어 (SharedArrayBuffer 불필요). CDN에서 받아 blob URL로 로드해
// 배포 환경(Vercel 등)에서 코어 미해석으로 인한 FS error를 방지한다.
const FFMPEG_CORE_VERSION = '0.12.6';

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
        const baseURL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
        // 코어/wasm을 명시적으로 로드 (toBlobURL로 same-origin blob 변환 → CSP/코어 해석 문제 회피)
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
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
    // 원본이 주로 AAC를 포함하므로, 컨테이너만 m4a 또는 aac로 변경하여 빼냅니다.
    const outputName = `output_${Date.now()}.aac`;

    try {
        // 1. 메모리에 파일 쓰기
        await ffmpeg.writeFile(inputName, await fetchFile(file));

        // 2. 무변환(Demuxing) 추출 실행 
        // -vn : 비디오 트랙 무시
        // -acodec copy : 오디오 트랙 압축 해제 없이(재인코딩 없이) 그냥 복사해서 빼냄
        await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'copy', outputName]);

        // 3. 적출된 결과 읽기
        const data = await ffmpeg.readFile(outputName);
        return new Blob([data.buffer], { type: 'audio/aac' });
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
