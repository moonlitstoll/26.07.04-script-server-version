// Stage 1 전사 스트림의 '끝까지 받았는지' 판정과 이어받기 계획·병합 — 순수 모듈(테스트 대상).
//
// 배경(2026-09 실측): 구글 서버가 과부하(503)일 때 전사 스트림을 도중에 끊는다. 끊기는 방식은 셋이다.
//   ① 연결 리셋       → SDK가 "Error reading from the stream"을 던진다(예전엔 전사 전체 실패)
//   ② 조용히 닫힘     → SDK가 '정상 종료'로 알린다
//   ③ 스트림 안 오류  → {"error":…} 조각이 text() ""로 삼켜진 뒤 정상 종료
// ②③은 예전 코드가 '다 받았다'로 보고 절반짜리 대본을 저장했다(노래 4:05 중 2:18에서 멈춤, 오류 표시 없음).
// 정상 완료는 마지막 조각에 finishReason STOP이 붙는다 — 이게 없으면 끊긴 것이다.

export const RESUME_MAX_ATTEMPTS = 3;        // 이어받기 최대 횟수(첫 요청 제외)
export const RESUME_PAD_SEC = 0.3;           // 이어받는 클립 앞 여유(첫 단어 잘림 방지)
export const RESUME_MIN_REMAIN_SEC = 1.0;    // 남은 소리가 이보다 짧으면 이어받을 게 없다
export const SEAM_DUP_WINDOW_SEC = 2.0;      // 이음매 직후 이 안에서 '이미 가진 문장'이 또 나오면 되풀이로 본다
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = 180000; // 첫 조각 대기(Pro는 답 전에 오래 생각한다)
export const STREAM_IDLE_TIMEOUT_MS = 60000;         // 조각 사이 최대 공백 — 넘으면 멈춤으로 본다

const REASON_KO = {
    cut: '연결이 닫힘',
    stall: '응답 멈춤',
    network: '연결 끊김',
    server: '서버 과부하',
    MAX_TOKENS: '출력 길이 한도',
};

// 스트림이 끝까지 오지 않았다는 신호. 받은 데까지(partial)를 들고 있어 호출부가 이어받을 수 있다.
export class StreamIncompleteError extends Error {
    constructor(reason, partial = [], cause = null) {
        super(`구글 서버 응답이 중간에 끊겼어요(${REASON_KO[reason] || reason}). 잠시 후 다시 시도해 주세요.`);
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
//  - SDK ResponseError(err.response 있음): RECITATION·SAFETY 차단 → 기존 오류 안내로
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
export function spliceResume(plan, cont) {
    const tailNorms = new Set(plan.keep.slice(-2).map(m => normText(m.text)).filter(Boolean));
    const add = (cont || []).filter(m =>
        !(tailNorms.has(normText(m.text)) && m.seconds < plan.resumeAt + SEAM_DUP_WINDOW_SEC));
    if (add.length === 0) return [...plan.keep, ...plan.dropped];
    return [...plan.keep, ...add].sort(byTime);
}
