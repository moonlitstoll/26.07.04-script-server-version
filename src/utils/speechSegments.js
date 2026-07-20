// '대사만 재생' 모드의 순수 계산 유틸.
// 전제: 문장별 speechEnd(대사가 실제로 끝나는 시각, 초)는 별도 감지 패스(detectSpeechEnds)가
// 채워 넣는 선택 필드다. 없거나 이상하면 모든 함수가 null을 반환해 기존 동작으로 폴백한다.
// — 반복 엔진(useAudioPlayer)·UI가 모두 이 파일만 참조한다 (경계 계산원 단일화, loopGroups와 같은 원칙).

// 이보다 긴 '대사 끝 ~ 다음 대사 시작' 간격만 건너뛴다.
// 겹치는 대사(간격 음수)나 짧은 정적은 그대로 재생 → 끊김/중복 없이 자연스럽게 이어진다.
export const GAP_SKIP_MIN = 3.0;
// 감지된 대사 끝 뒤에 듣는 여유(끝이 딱 잘리지 않게). 시작 쪽 여유는 기존 bufferTime이 담당.
// 이 값이 곧 '대사가 잘리지 않을 안전 여유'다 — 건너뛰기는 정확히 `대사끝 + PAD` 지점에서
// 발동하므로, 모델이 끝 시각을 이만큼보다 이르게 답하면 그 차이만큼 대사가 잘린다.
// (GAP_SKIP_MIN 3초는 '어디를 건너뛸지' 고르는 기준일 뿐 잘림 여유가 아니다 — 혼동 주의.)
//
// 이제 설정(miniapp_speech_tail_pad)으로 사용자가 조절한다. 아래는 인자를 안 넘겼을 때의 기본값.
// 0.4 → 0.8(예방적 인상) → 0.5(설정 노출과 함께 환원): 실측 잘림 사례가 없었는데도 고정값을
// 보수적으로 잡아둘 이유가, 사용자가 직접 듣고 올릴 수 있게 된 시점에 약해졌다.
export const SPEECH_TAIL_PAD = 0.5;

// 설정 슬라이더 허용 범위.
// 상한 0.9의 근거(임의값 아님): 점프 성립 조건이 `간격 > tailPad + bufferTime + 0.05`이고,
// 간격은 GAP_SKIP_MIN(3초) 초과가 이미 필수, bufferTime 슬라이더 최대는 2.0초다.
//   0.9 + 2.0 + 0.05 = 2.95 < 3.0  → 전 범위에서 건너뛰기가 항상 성립한다.
// 이보다 크게 잡으면 bufferTime을 높게 쓰는 사용자에게서 건너뛰기가 '조용히' 사라진다.
// (GAP_SKIP_MIN이나 bufferTime 최대값을 바꾸면 이 상한도 함께 재계산할 것 — 테스트가 지킨다.)
export const TAIL_PAD_MIN = 0.2;
export const TAIL_PAD_MAX = 0.9;

// 오염된 값(NaN/범위 밖)이 들어와도 허용 범위로 강제 → 경계 계산이 이상한 값을 보는 일이 없다.
// (loopGroups의 clampLoopGroupSize와 같은 방침)
export const clampTailPad = (n) => {
    const v = typeof n === 'number' ? n : parseFloat(n);
    if (!Number.isFinite(v)) return SPEECH_TAIL_PAD;
    return Math.min(TAIL_PAD_MAX, Math.max(TAIL_PAD_MIN, v));
};
// 한 문장이 이보다 길게 지속된다는 감지값은 오류로 간주(환각 방어).
export const MAX_SENTENCE_SEC = 60;

// item의 speechEnd가 신뢰할 수 있으면 그 값을, 아니면 null.
// 유효한 최소 지속시간. 예전엔 0.2초였는데, 한 음절 감탄사가 그 경계에 정확히 걸려 버려졌다.
// 실측: "À."(272.6초 시작)에 모델이 272.8초를 답했으나 `se <= seconds + 0.2`에 걸려 탈락 →
// 그 문장만 끝 시각이 없어져 뒤따르는 9.7초 무음이 건너뛰어지지 않았다.
// ("Wow." "Cay." "À." 처럼 0.3초짜리 문장은 이 대본에서 흔하다.)
// 이 가드의 원래 목적은 '끝이 시작보다 이르거나 같은' 말이 안 되는 값을 막는 것이므로 0.05로 충분하다.
export const MIN_SPEECH_SEC = 0.05;

export const validSpeechEnd = (item) => {
    if (!item) return null;
    const se = item.speechEnd;
    if (typeof se !== 'number' || !Number.isFinite(se)) return null;
    if (se <= item.seconds + MIN_SPEECH_SEC) return null;   // 시작보다 이르거나 사실상 0길이
    if (se - item.seconds > MAX_SENTENCE_SEC) return null;  // 비정상적으로 긴 지속시간
    return se;
};

// idx가 속한 형제 블록(같은 seconds 공유)의 대사 끝 = 구성원 중 가장 늦은 유효 끝 시각.
// 블록은 오디오상 한 덩어리라 개별 끝이 아니라 블록 전체의 끝을 써야 한다. 유효값 없으면 null.
export const blockSpeechEnd = (data, idx) => {
    if (!Array.isArray(data) || !data[idx]) return null;
    const t = data[idx].seconds;
    let s = idx; while (s > 0 && data[s - 1].seconds === t) s--;
    let e = idx; while (e + 1 < data.length && data[e + 1].seconds <= t) e++;
    let best = null;
    for (let i = s; i <= e; i++) {
        const se = validSpeechEnd(data[i]);
        if (se !== null && (best === null || se > best)) best = se;
    }
    return best;
};

// 반복의 끝 경계를 대사 끝으로 당길 수 있으면 그 값을, 아니면 null(기존 경계 유지).
//  - nextStart가 null(마지막 문장): 꼬리 음악/무음 제거 → 대사 끝 + 패딩
//  - 간격이 GAP_SKIP_MIN 초과일 때만 당김: 겹침(음수 간격)·짧은 정적은 null → 기존처럼 이어 재생
// tailPad: 설정값(useAudioPlayer가 speechTailPad로 넘긴다). 생략 시 기본 상수.
export const trimmedLoopEnd = (speechEnd, nextStart, tailPad = SPEECH_TAIL_PAD) => {
    if (typeof speechEnd !== 'number' || !Number.isFinite(speechEnd)) return null;
    const pad = clampTailPad(tailPad);
    if (nextStart == null) return speechEnd + pad;
    if (nextStart - speechEnd > GAP_SKIP_MIN) return speechEnd + pad;
    return null;
};

// [폐기된 시도 — 다시 만들지 말 것] '긴 건너뛰기 = 전사 누락 신호'로 보고 배지를 붙였다가 제거했다.
// 근거로 삼은 사례들이 실제 청취 확인에서 무너졌다: 12:05의 15.3초 건너뛰기는 그 구간에 대사가
// 정말 없어서(사용자 확인) 올바른 동작이었고, 나머지 근거도 '음량 곡선으로 말소리를 판별'한
// 같은 방법에서 나온 것이라 신뢰할 수 없었다. 이 영상들은 배경음악이 대사와 비슷한 크기라
// 음량만으로는 말소리/음악을 구분할 수 없다(같은 이유로 음량 기반 교차검증도 폐기했다).
// → 긴 건너뛰기 자체는 전사 누락의 근거가 되지 못한다. 다시 하려면 음성/음악 판별이 먼저다.

// 묶음 반복 중 '지금 문장(m)의 대사가 끝났고 다음 문장(nm)까지 간격이 길면' 건너뛸 목표 시각.
// 건너뛰지 않아야 하면 null. now는 현재 재생 시각, bufferTime은 시작 쪽 여유.
// tailPad: 끝쪽 여유(설정값). 생략 시 기본 상수.
export const gapSkipTarget = (data, m, nm, now, bufferTime, tailPad = SPEECH_TAIL_PAD) => {
    if (!Array.isArray(data) || !data[m] || !data[nm]) return null;
    const se = blockSpeechEnd(data, m);
    if (se === null) return null;
    const pad = clampTailPad(tailPad);
    const nextStart = data[nm].seconds;
    if (nextStart - se <= GAP_SKIP_MIN) return null;          // 짧은 간격/겹침: 그대로 재생
    const target = Math.max(0, nextStart - bufferTime);
    if (now < se + pad) return null;                          // 아직 대사(+여유)가 안 끝남
    if (now >= target - 0.05) return null;                    // 이미 목표 지점 근처/이후 (재귀 점프 방지)
    return target;
};
