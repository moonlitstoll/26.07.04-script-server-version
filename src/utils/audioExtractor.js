import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpegInstance = null;
let isLoading = false;

/**
 * FFmpeg 싱글 스레드 인스턴스 반환 
 * (SharedArrayBuffer가 필요 없는 100% 안전한 코어로 구동)
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
        // 기본 모듈 로드 (core-mt 제외, 보안 정책 충돌 제로)
        await ffmpeg.load();
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

/**
 * [RECITATION 회피] 오디오의 피치(음높이)만 반음 단위로 변조하여 적출합니다.
 * 단어/속도는 그대로 유지하고 음높이만 바꿔 원본 녹음 지문(fingerprint)을 흐립니다.
 * 무변환 복사가 불가능하므로 디코딩 + 필터 + AAC 재인코딩을 거칩니다.
 *
 * 필터 체인 원리 (샘플레이트 비의존):
 *   aresample=44100        → 입력을 44100Hz로 표준화
 *   asetrate=44100*ratio   → 샘플레이트를 재라벨링(리샘플 X) → 피치+속도 동시 상승
 *   atempo=1/ratio         → 속도만 원복(피치는 유지)
 *   aresample=44100        → 최종 44100Hz로 정리
 *
 * @param {File} file - 입력 비디오/오디오 파일
 * @param {number} semitones - 피치 이동 반음 수 (양수=올림, 음수=내림)
 * @returns {Promise<Blob>} - 피치가 변조된 AAC 오디오
 */
export async function extractPitchShiftedAudio(file, semitones = 2) {
    const ffmpeg = await getFFmpeg();

    const inputExt = file.name.split('.').pop() || 'mp4';
    const inputName = `input_${Date.now()}.${inputExt}`;
    const outputName = `output_${Date.now()}.aac`;

    // atempo는 0.5~2.0 범위만 허용 → 슬라이더 범위 내에서는 안전
    const audioFilter = buildPitchFilter(semitones);

    try {
        await ffmpeg.writeFile(inputName, await fetchFile(file));

        await ffmpeg.exec([
            '-i', inputName,
            '-vn',
            '-af', audioFilter,
            '-c:a', 'aac',
            '-b:a', '128k',
            outputName
        ]);

        const data = await ffmpeg.readFile(outputName);
        return new Blob([data.buffer], { type: 'audio/aac' });
    } catch (err) {
        console.error('FFmpeg pitch shift error:', err);
        throw new Error(`피치 시프트 적출 실패: ${err.message}`);
    } finally {
        try {
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);
        } catch (cleanupErr) {
            console.warn('FFmpeg cleanup:', cleanupErr);
        }
    }
}

/**
 * 피치 시프트 필터 체인 문자열 생성 (antiRecitation 전용).
 * @param {number} semitones - 반음 수
 * @returns {string} FFmpeg -af 필터 문자열
 */
function buildPitchFilter(semitones) {
    const ratio = Math.pow(2, semitones / 12);
    const targetRate = Math.round(44100 * ratio);
    const tempo = (1 / ratio).toFixed(6);
    return `aresample=44100,asetrate=${targetRate},atempo=${tempo},aresample=44100`;
}

/**
 * [RECITATION 회피 - 청크 분할] 오디오를 시간 세그먼트로 잘라 배열로 반환합니다.
 * 각 세그먼트는 재인코딩(샘플 정확 컷)을 거치며, offset(절대 시작 시각)을 함께 반환해
 * 전사 단계에서 0초 기준 타임스탬프를 절대 타임라인으로 복원할 수 있게 합니다.
 *
 * - 인접 세그먼트는 overlapSec 만큼 겹쳐서 경계 문장 누락을 방지(중복은 전사 후 dedup으로 제거).
 * - antiRecitation이 켜지면 피치 변조 필터를 동시에 적용.
 *
 * @param {File} file - 입력 비디오/오디오 파일
 * @param {object} opts - { totalDuration, segmentSec=60, overlapSec=3, antiRecitation=false, pitchSemitones=2 }
 * @returns {Promise<Array<{ blob: Blob, offset: number, segLen: number }>>}
 */
export async function extractAudioSegments(file, {
    totalDuration,
    segmentSec = 60,
    overlapSec = 3,
    antiRecitation = false,
    pitchSemitones = 2
} = {}) {
    const ffmpeg = await getFFmpeg();

    const inputExt = file.name.split('.').pop() || 'mp4';
    const inputName = `input_${Date.now()}.${inputExt}`;
    // 피치 변조는 선택 사항 — semitones 0이면 필터 없이 정확 컷만 수행(분절 기호 삽입이 주력 회피 수단)
    const audioFilter = (antiRecitation && pitchSemitones !== 0) ? buildPitchFilter(pitchSemitones) : null;

    const segments = [];
    try {
        await ffmpeg.writeFile(inputName, await fetchFile(file));

        const hasDuration = typeof totalDuration === 'number' && totalDuration > 0;
        const total = hasDuration ? totalDuration : segmentSec; // duration 미상 시 단일 패스 폴백
        let start = 0;
        let index = 0;

        while (start < total) {
            // 다음 세그먼트 시작과 overlapSec 만큼 겹치도록 끝에 여유를 둔다
            const segLen = segmentSec + overlapSec;
            const outputName = `seg_${Date.now()}_${index}.aac`;

            // -ss를 -i 뒤에 두어 정확 컷(디코딩 후 탐색). 재인코딩이므로 샘플 단위 정확.
            const args = ['-i', inputName, '-ss', String(start), '-t', String(segLen), '-vn'];
            if (audioFilter) args.push('-af', audioFilter);
            args.push('-c:a', 'aac', '-b:a', '128k', outputName);

            await ffmpeg.exec(args);

            let data = null;
            try {
                data = await ffmpeg.readFile(outputName);
            } catch (readErr) {
                console.warn(`[Segment] read failed at offset ${start}s:`, readErr);
            }

            // 영상 끝을 초과한 빈 세그먼트는 스킵 (AAC 헤더만 있는 미세 크기 방지)
            if (data && data.byteLength > 256) {
                segments.push({
                    blob: new Blob([data.buffer], { type: 'audio/aac' }),
                    offset: start,
                    segLen
                });
            }

            try { await ffmpeg.deleteFile(outputName); } catch { /* noop */ }

            start += segmentSec;
            index++;

            if (!hasDuration) break; // duration을 모르면 1회만 잘라 폴백
        }

        if (segments.length === 0) {
            throw new Error('유효한 세그먼트를 추출하지 못했습니다.');
        }
        return segments;
    } catch (err) {
        console.error('FFmpeg segment extraction error:', err);
        throw new Error(`세그먼트 적출 실패: ${err.message}`);
    } finally {
        try { await ffmpeg.deleteFile(inputName); } catch { /* noop */ }
    }
}
