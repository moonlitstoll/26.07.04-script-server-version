// Stage 1 전사 스트림의 '끝까지 받았는지' 판정과 이어받기 계획·병합 — 순수 모듈(테스트 대상).
//
// 배경(2026-09 실측): 구글 서버가 과부하(503)일 때 전사 스트림을 도중에 끊는다. 끊기는 방식은 셋이다.
//   ① 연결 리셋       → SDK가 "Error reading from the stream"을 던진다(예전엔 전사 전체 실패)
//   ② 조용히 닫힘     → SDK가 '정상 종료'로 알린다
//   ③ 스트림 안 오류  → {"error":…} 조각이 text() ""로 삼켜진 뒤 정상 종료
// ②③은 예전 코드가 '다 받았다'로 보고 절반짜리 대본을 저장했다(노래 4:05 중 2:18에서 멈춤, 오류 표시 없음).
// 정상 완료는 마지막 조각에 finishReason STOP이 붙는다 — 이게 없으면 끊긴 것이다.
//
// 서버 끊김 말고도 '끝까지 못 받는' 경우가 둘 더 있어 같은 이어받기로 처리한다.
//   ④ 반복 루프   → 모델이 같은 말을 끝없이 쓴다. 토큰은 계속 와서 멈춤 감시에 안 걸린다(isRunawayRepeat)
//   ⑤ 저작권 차단 → RECITATION. 예전엔 받은 가사까지 전부 버렸다(isRecitationBlock)

import { formatClock } from '../utils/timeUtils';

export const RESUME_MAX_ATTEMPTS = 3;        // 이어받기 최대 횟수(첫 요청 제외)
export const RESUME_PAD_SEC = 0.3;           // 이어받는 클립 앞 여유(첫 단어 잘림 방지)
export const RESUME_MIN_REMAIN_SEC = 1.0;    // 남은 소리가 이보다 짧으면 이어받을 게 없다
export const SEAM_DUP_WINDOW_SEC = 2.0;      // 이음매 직후 이 안에서 '이미 가진 문장'이 또 나오면 되풀이로 본다
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = 180000; // 첫 조각 대기(Pro는 답 전에 오래 생각한다)
export const STREAM_IDLE_TIMEOUT_MS = 60000;         // 조각 사이 최대 공백 — 넘으면 멈춤으로 본다
export const LOOP_LINE_MAX_CHARS = 2000;     // 줄바꿈 없이 이보다 길어지는 줄은 반복 루프인지 본다
export const LOOP_MAX_DISTINCT_WORDS = 30;   // 그 줄 끝 LOOP_LINE_MAX_CHARS자 안의 서로 다른 단어가 이 이하면 루프
export const LOOP_DUP_LINES = 50;            // 같은 줄이 연달아 이만큼 버려지면 루프

const REASON_KO = {
    cut: '연결이 닫힘',
    stall: '응답 멈춤',
    network: '연결 끊김',
    server: '서버 과부하',
    MAX_TOKENS: '출력 길이 한도',
};

const incompleteMessage = (reason) => {
    if (reason === 'RECITATION') return '저작권 필터(RECITATION)에 걸려 응답이 중간에 막혔어요.';
    if (reason === 'loop') return 'AI가 같은 말을 끝없이 되풀이해 중간에 끊었어요. 다시 시도해 주세요.';
    return `구글 서버 응답이 중간에 끊겼어요(${REASON_KO[reason] || reason}). 잠시 후 다시 시도해 주세요.`;
};

// 스트림이 끝까지 오지 않았다는 신호. 받은 데까지(partial)를 들고 있어 호출부가 이어받을 수 있다.
export class StreamIncompleteError extends Error {
    constructor(reason, partial = [], cause = null) {
        super(incompleteMessage(reason));
        this.name = 'StreamIncompleteError';
        this.reason = reason;
        this.partial = partial;
        this.cause = cause;
    }
}

// 오류 없이 끝난 스트림이 정말 '다 받은' 건지.
//  - finishReason STOP: 모델이 스스로 끝냈다(정상)
//  - endedByMarker: [END_OF_AUDIO]를 90% 이후에 받아 우리가 먼저 끊었다(정상)
//  - 그 외(없음=조용히 닫힘, MAX_TOKENS, OTHER 등): 끝까지 안 왔다
export function isStreamComplete({ finishReason = null, endedByMarker = false } = {}) {
    return endedByMarker || finishReason === 'STOP';
}

// 오류로 끊겼을 때 이어받을 가치가 있는지. 다시 보내도 같은 결과인 것은 제외한다.
//  - SDK ResponseError(err.response 있음): SAFETY 등 차단 → 기존 오류 안내로
//    (저작권 차단 RECITATION은 isRecitationBlock으로 따로 걸러 받은 데까지 살린다)
//  - HTTP 4xx(408·429 제외): 요청 자체 문제(키 오류 등)
export function isResumableStreamError(err) {
    if (!err) return false;
    if (err.response) return false;
    const status = typeof err.status === 'number' ? err.status : 0;
    if (status) return status === 408 || status === 429 || status >= 500;
    return true; // 상태코드 없음: 스트림 읽기 끊김·파싱 실패·네트워크
}

// 서버가 명시적으로 과부하·한도를 알린 경우만 기다렸다가 다시 보낸다(멈춤·연결 끊김은 바로).
export function isServerBusyError(err) {
    const status = typeof err?.status === 'number' ? err.status : 0;
    return status === 429 || status >= 500;
}

// 저작권 차단(RECITATION)인지. SDK는 차단된 조각에서 text()가 ResponseError를 던진다.
// 차단은 매번 나지 않는다(같은 노래·같은 설정 8회 중 2회) → 받은 데까지 두고 나머지를 다시 요청해 볼 가치가 있다.
// SAFETY·LANGUAGE 차단은 다시 보내도 같아 여기 넣지 않는다.
export function isRecitationBlock(err) {
    if (!err?.response) return false;
    const fr = err.response.candidates?.[0]?.finishReason;
    return fr === 'RECITATION' || /\bRECITATION\b/.test(String(err.message || ''));
}

// 줄바꿈 없이 길어지는 줄이 '같은 말의 끝없는 되풀이'인지.
// 실측(2026-09): 노래 2:18 "A a"를 쓰다가 " a ※ a ※ a …"가 131,131자(출력 한도)까지 이어졌다.
// 약 250초 기다리고 약 230원이 들었다. 토큰은 계속 와서 멈춤 감시에 안 걸린다.
// 정상 줄은 한 문장이라 길어야 수백 자다. 반복 없이 2000자를 넘는 줄도 원래 버린다(languageUtils의 BLOCKED).
// 길이만 보지 않는 이유: 반복이 아닌 긴 줄(형식 이탈 등)은 예전처럼 끝까지 받게 두기 위해서다.
export function isRunawayRepeat(tail) {
    if (!tail || tail.length <= LOOP_LINE_MAX_CHARS) return false;
    const words = tail.slice(-LOOP_LINE_MAX_CHARS).toLowerCase().split(/\s+/).filter(Boolean);
    return new Set(words).size <= LOOP_MAX_DISTINCT_WORDS;
}

// 끝내 다 못 받았을 때 전사 후 띄우는 안내. at = 못 받기 시작한 지점(초), reason = 마지막 실패 사유.
export function incompleteNotice({ at, reason }) {
    const t = formatClock(at);
    if (reason === 'RECITATION') {
        return `저작권 필터에 걸려 ${t} 이후 일부를 받지 못했어요. 그 부근 문장을 선택하고 '복구'를 눌러 다시 시도해 보세요.`;
    }
    if (reason === 'loop') {
        return `AI가 같은 말을 되풀이하는 오류로 ${t} 이후 일부를 받지 못했어요. 그 부근 문장을 선택하고 '복구'를 눌러 채워주세요.`;
    }
    return `구글 서버가 불안정해 ${t} 이후 일부를 받지 못했어요. 그 부근 문장을 선택하고 '복구'를 눌러 채워주세요.`;
}

// 저작권 차단으로 한 줄도 못 받았을 때의 오류 안내. 사용자가 바꿀 수 있는 실제 설정만 권한다.
// (예전 문구는 목록에 없는 모델 "1.5 Pro"를 권했다)
// 간격을 2로 권하는 근거: 같은 노래로 잰 결과 간격 7은 8회 중 2회 차단, 1·2는 10회 중 0회였다(2026-09).
export function recitationBlockedMessage({ antiRecitation = false, markerInterval = 2 } = {}) {
    const tip = !antiRecitation
        ? "설정에서 'RECITATION 방지 모드'를 켜고 다시 시도해 보세요."
        : markerInterval > 2
            ? `설정의 '삽입 간격'을 ${markerInterval}단어에서 2단어로 줄이고 다시 시도해 보세요.`
            : "차단은 매번 나지 않으니 잠시 후 '다시 시도'를 눌러 보세요.";
    return `[오류: 저작권 필터] 노래 가사·연설처럼 이미 알려진 내용과 똑같아 구글 AI가 받아쓰기를 막았습니다. ${tip}`;
}

const byTime = (a, b) => a.seconds - b.seconds;

// 끊긴 지점에서 어디부터 다시 받을지. 마지막으로 '온전히 받은 줄'의 시작부터 다시 듣는다.
// 그 줄은 버리고(dropped) 새로 받는다 — 줄의 시작은 문장 경계라 이음매가 깨끗하다.
// 이어받기가 아무것도 못 가져오면 dropped를 되살려 받은 것을 잃지 않는다.
// 남은 소리가 없거나(끝 근처) 전체 길이를 모르면 null.
export function planResume(lines, segStart, segEnd) {
    if (!(segEnd > 0)) return null;
    const sorted = [...lines].sort(byTime);
    const last = sorted[sorted.length - 1];
    const resumeAt = last ? Math.max(segStart, last.seconds) : segStart;
    if (segEnd - resumeAt < RESUME_MIN_REMAIN_SEC) return null;
    const keep = sorted.filter(m => m.seconds < resumeAt);
    const dropped = sorted.filter(m => m.seconds >= resumeAt);
    return {
        resumeAt,
        keep,
        dropped,
        // 모델에게 '바로 앞 문장(다시 쓰지 말 것)'으로 알려줄 문맥
        context: keep.slice(-2).map(m => m.text).filter(Boolean),
    };
}

const normText = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// 이어받은 줄을 붙인다.
// 이음매 되풀이 제거: 모델이 문맥으로 알려준 앞 문장을 클립 첫머리에 또 적는 경우가 있다 →
// '이미 가진 마지막 두 줄'과 같은 말이 이음매 직후(SEAM_DUP_WINDOW_SEC 안)에 나오면 버린다.
// 시각 조건을 같이 거는 이유: 노래 후렴처럼 같은 말이 '제 시각에' 다시 나오는 건 지키기 위해.
//
// 다시 받은 '버렸던 줄'은 원래 시각을 쓴다. 모델은 클립의 첫 줄을 클립 0초로 적어서, 앞 여유
// (RESUME_PAD_SEC)만큼 실제보다 이르게 찍힌다(실측: 2:15.36 → 2:15.06, 3:33.83 → 3:33.53).
// 이어받기가 같은 줄에서 겹치면 0.3초씩 계속 당겨졌다(3:33.58 → 3:32.98). 원래 시각은 전체 오디오를
// 들은 첫 요청이 찍은 값이라 더 정확하다.
export function spliceResume(plan, cont) {
    const tailNorms = new Set(plan.keep.slice(-2).map(m => normText(m.text)).filter(Boolean));
    let add = (cont || []).filter(m =>
        !(tailNorms.has(normText(m.text)) && m.seconds < plan.resumeAt + SEAM_DUP_WINDOW_SEC));
    const orig = plan.dropped[0];
    if (orig) {
        const same = add.findIndex(m => normText(m.text) === normText(orig.text)
            && Math.abs(m.seconds - orig.seconds) < SEAM_DUP_WINDOW_SEC);
        if (same >= 0) {
            add = add.map((m, i) => (i === same
                ? { ...m, seconds: orig.seconds, startSeconds: orig.startSeconds ?? orig.seconds, s: orig.s ?? m.s, timestamp: orig.timestamp ?? m.timestamp }
                : m));
        }
    }
    if (add.length === 0) return [...plan.keep, ...plan.dropped];
    return [...plan.keep, ...add].sort(byTime);
}
