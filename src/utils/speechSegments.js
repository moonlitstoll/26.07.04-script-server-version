// '대사만 재생' 모드의 순수 계산 유틸.
// 전제: 문장별 speechEnd(대사가 실제로 끝나는 시각, 초)는 별도 감지 패스(detectSpeechEnds)가
// 채워 넣는 선택 필드다. 없거나 이상하면 모든 함수가 null을 반환해 기존 동작으로 폴백한다.
// — 반복 엔진(useAudioPlayer)·UI가 모두 이 파일만 참조한다 (경계 계산원 단일화, loopGroups와 같은 원칙).

// 이보다 긴 '대사 끝 ~ 다음 대사 시작' 간격만 건너뛴다.
// 겹치는 대사(간격 음수)나 짧은 정적은 그대로 재생 → 끊김/중복 없이 자연스럽게 이어진다.
export const GAP_SKIP_MIN = 3.0;
// 감지된 대사 끝 뒤에 듣는 여유(끝이 딱 잘리지 않게). 시작 쪽 여유는 기존 bufferTime이 담당.
export const SPEECH_TAIL_PAD = 0.4;
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
export const trimmedLoopEnd = (speechEnd, nextStart) => {
    if (typeof speechEnd !== 'number' || !Number.isFinite(speechEnd)) return null;
    if (nextStart == null) return speechEnd + SPEECH_TAIL_PAD;
    if (nextStart - speechEnd > GAP_SKIP_MIN) return speechEnd + SPEECH_TAIL_PAD;
    return null;
};

// [전사 누락 의심] 건너뛰는 무음이 이보다 길면 '대본이 대사를 빠뜨렸을 가능성'을 표시한다.
//
// 근거(실측): 이 앱은 대본에 없는 구간을 '대사 없음'으로 보고 건너뛰므로, **전사가 놓친 대사일수록
// 더 확실히 안 들리게 된다**. 실사용 검증에서 긴 건너뛰기 상위 구간을 오디오로 대조한 결과:
//   12:05(15.3초) → 12:11~12:21에 대사 10초가 대본에 통째로 없음
//   04:42(12.8초) → 그 시각엔 소리가 없고, 실제 대사는 04:33~04:36에 있었음(타임스탬프 어긋남)
//   04:33( 9.4초) → 대본은 0.3초짜리 "À."인데 실제 말소리는 3.9초
//   12:44(14.4초) → 정상(사용자 확인) ← 오탐도 나온다. 그래서 '의심' 표시일 뿐 자동 수정은 하지 않는다.
// 8초로 잡으면 14분 영상에서 6곳 정도가 걸린다(그중 1곳 오탐) — 사용자가 확인할 만한 분량.
export const LONG_SKIP_SUSPECT_SEC = 8.0;

// idx 문장 뒤에 '의심스러울 만큼 긴' 건너뛰기가 있으면 그 초를, 아니면 null.
// 감지값이 없으면 판단 자체가 불가하므로 null(배지 없음).
export const longSkipGap = (data, idx) => {
    if (!Array.isArray(data) || !data[idx]) return null;
    const se = blockSpeechEnd(data, idx);
    if (se === null) return null;
    const t = data[idx].seconds;
    let j = idx + 1;
    while (j < data.length && data[j].seconds <= t) j++;   // 형제 블록(같은 시각) 건너뜀
    if (j >= data.length) return null;                      // 마지막 문장 뒤는 대상 아님
    const gap = data[j].seconds - se;
    return gap > LONG_SKIP_SUSPECT_SEC ? gap : null;
};

// 묶음 반복 중 '지금 문장(m)의 대사가 끝났고 다음 문장(nm)까지 간격이 길면' 건너뛸 목표 시각.
// 건너뛰지 않아야 하면 null. now는 현재 재생 시각, bufferTime은 시작 쪽 여유.
export const gapSkipTarget = (data, m, nm, now, bufferTime) => {
    if (!Array.isArray(data) || !data[m] || !data[nm]) return null;
    const se = blockSpeechEnd(data, m);
    if (se === null) return null;
    const nextStart = data[nm].seconds;
    if (nextStart - se <= GAP_SKIP_MIN) return null;          // 짧은 간격/겹침: 그대로 재생
    const target = Math.max(0, nextStart - bufferTime);
    if (now < se + SPEECH_TAIL_PAD) return null;              // 아직 대사(+여유)가 안 끝남
    if (now >= target - 0.05) return null;                    // 이미 목표 지점 근처/이후 (재귀 점프 방지)
    return target;
};
