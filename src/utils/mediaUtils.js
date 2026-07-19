import { parseTime } from './timeUtils';

// 종료 시각(endSeconds) 미지정 시 기본으로 채우는 구간 길이(초)
const DEFAULT_GAP_SEC = 3.0;
// startSeconds 오름차순 정렬 비교자
const byStart = (a, b) => a.startSeconds - b.startSeconds;

/**
 * Helper: Get Media Duration
 */
export const getMediaDuration = (file) => {
    return new Promise((resolve, reject) => {
        const media = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
        media.preload = 'metadata';
        media.onloadedmetadata = () => {
            // Delay revocation to ensure no active reads fail in the background logic
            setTimeout(() => window.URL.revokeObjectURL(media.src), 5000);
            resolve(media.duration);
        };
        media.onerror = () => {
            window.URL.revokeObjectURL(media.src);
            reject(new Error("Failed to load media metadata. The file may be corrupted or unsupported."));
        };
        media.src = URL.createObjectURL(file);
    });
};

/**
 * Helper: Sanitize & Sort Data
 * duration: 영상 총 길이(초). 0이면 보정 스킵.
 */
export const sanitizeData = (data, duration = 0) => {
    if (!Array.isArray(data)) {
        console.error("Data is not an array:", data);
        return [];
    }
    let result = data
        .filter(item => item && typeof item === 'object') // Filter null/non-objects
        .map(item => {
            // Map shortened keys back to original keys if present
            const timestamp = item.s || item.timestamp;
            const secondsValue = item.v !== undefined ? item.v : item.seconds;
            const endValue = item.e !== undefined ? item.e : item.endSeconds;
            const speaker = item.sp || item.speaker || "";
            let text = item.o || item.text || "(No text)";
            const translation = item.t || item.translation || "";

            // Handle patterns
            let patterns = item.p || item.patterns || [];
            if (Array.isArray(patterns)) {
                patterns = patterns.map(p => ({
                    term: p.t || p.term || "",
                    definition: p.d || p.definition || ""
                }));
            }

            // Handle words
            let words = item.w || item.words || [];
            if (Array.isArray(words)) {
                words = words.map(w => ({
                    word: w.w || w.word || "",
                    meaning: w.m || w.meaning || "",
                    func: w.f || w.func || ""
                }));
            }

            // MASTER SECOND ENGINE (Float Precision)
            // PRIORITIZE TIMESTAMP STRING to match user view exactly
            let startSeconds = 0;
            if (typeof timestamp === 'string' && timestamp.length > 0) {
                startSeconds = parseTime(timestamp);
            } else if (typeof secondsValue === 'number') {
                startSeconds = secondsValue;
            }
            startSeconds = isNaN(startSeconds) ? 0 : startSeconds;

            const seconds = startSeconds;
            let endSeconds = seconds + DEFAULT_GAP_SEC;
            if (typeof endValue === 'number') {
                endSeconds = endValue;
            }

            return {
                s: timestamp,
                timestamp,
                seconds,
                startSeconds, // Explicit float for sync
                endSeconds,
                speaker, // 화자 정보 포함
                o: text,
                text,
                translation,
                analysis: item.a || item.analysis || "",
                // 전사의심(규칙15) 플래그: 여기서 통과시키지 않으면 캐시 재로드 때 배지가 유실된다
                transcriptSuspect: item.transcriptSuspect || "",
                // 대사 끝 시각(감지 패스가 채움, 선택 필드) — 숫자일 때만 통과, 아니면 필드 자체를 만들지 않음
                ...(typeof item.speechEnd === 'number' && Number.isFinite(item.speechEnd) ? { speechEnd: item.speechEnd } : {}),
                isAnalyzed: item.isAnalyzed || !!(item.a || item.analysis)
            };
        })
        .filter(item => item.text && item.text.trim() !== "")
        .sort(byStart);

    // [자동 보정] AI가 HH:MM:SS 형태로 타임스탬프를 출력하여
    // 모든 startSeconds가 영상 길이를 초과하는 경우, 3파트 타임스탬프를 재해석
    if (duration > 0 && result.length > 0) {
        const nonZeroItems = result.filter(r => r.startSeconds > 0);
        const allExceed = nonZeroItems.length > 0 && nonZeroItems.every(r => r.startSeconds > duration);

        if (allExceed) {
            console.warn(`[SanitizeData] 모든 타임스탬프(${nonZeroItems[0].startSeconds}s~)가 영상 길이(${duration}s)를 초과. 3파트 재해석 시도...`);
            result = result.map(item => {
                const ts = String(item.timestamp || '');
                const parts = ts.replace(/[^\d:.]/g, '').split(':');
                if (parts.length === 3) {
                    // "00:51:50.00" → 실제 의미: 0분 51초 50센티초 = 51.50초
                    // parts[0]=HH(무시할 분), parts[1]=실제 초, parts[2]=소수점 이하
                    const mm = parseFloat(parts[0]) || 0;
                    const ss = parseFloat(parts[1]) || 0;
                    const cc = parseFloat(parts[2]) || 0;
                    const corrected = (mm * 60) + ss + (cc / 100);

                    // 보정된 타임스탬프 문자열도 업데이트
                    const correctedMin = Math.floor(corrected / 60);
                    const correctedSec = (corrected % 60).toFixed(2).padStart(5, '0');
                    const correctedTimestamp = `${String(correctedMin).padStart(2, '0')}:${correctedSec}`;

                    return {
                        ...item,
                        seconds: corrected,
                        startSeconds: corrected,
                        endSeconds: corrected + DEFAULT_GAP_SEC,
                        timestamp: correctedTimestamp,
                        s: correctedTimestamp
                    };
                }
                return item;
            }).sort(byStart);
            console.log(`[SanitizeData] 보정 완료. 첫 번째 항목: ${result[0]?.startSeconds}s, 마지막: ${result[result.length - 1]?.startSeconds}s`);
        }
    }

    return result;
};
