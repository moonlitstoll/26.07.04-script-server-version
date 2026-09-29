// '대사만' 감지(detectSpeechEndsForFile)의 계산 부분 — 어떤 문장을 요청할지, 모델 답을 대본에 어떻게 합칠지.
// 순수 모듈(테스트 대상). 예전엔 useMediaAnalysis 안에 인라인이라 테스트가 없었다(CLAUDE.md '알려진 공백').
import { validSpeechEnd, MIN_SPEECH_SEC, MAX_SENTENCE_SEC } from './speechSegments';

/**
 * 감지를 요청할 문장 고르기.
 *  - indices(선택 재감지): 그 인덱스만. 이미 감지됐어도 포함해 덮어쓴다(부정확한 걸 고치는 게 목적).
 *    같은 seconds를 공유하는 형제 문장(분할된 한 덩어리)도 함께 넣는다 — blockSpeechEnd가 형제 중 최댓값으로
 *    묶어 쓰므로, 한 형제만 고치면 다른 형제의 옛 값이 남아 블록 건너뛰기가 안 바뀔 수 있다.
 *  - onlyMissing: 유효 speechEnd가 없고 '아직 포기 표시도 안 된' 문장만.
 *    (speechEndSkipped = 이미 시도했는데 모델이 판단 못 한 구간 → 반복 요청해봐야 비용만 든다)
 *  - 둘 다 없으면 전체.
 * @returns {{ sentences: Array<{index, seconds, text}>, selective: boolean }}
 */
export function selectSpeechEndTargets(data, { onlyMissing = false, indices = null } = {}) {
    const idxSet = Array.isArray(indices) ? new Set(indices) : (indices instanceof Set ? indices : null);
    let effIdxSet = idxSet;
    if (idxSet) {
        const selSecs = new Set([...idxSet].map(i => data[i]?.seconds).filter(v => typeof v === 'number'));
        effIdxSet = new Set(idxSet);
        data.forEach((d, i) => { if (selSecs.has(d.seconds)) effIdxSet.add(i); });
    }
    const sentences = data
        .map((d, i) => ({ index: i, seconds: d.seconds, text: d.text, done: validSpeechEnd(d) !== null || !!d.speechEndSkipped }))
        .filter(s => effIdxSet ? effIdxSet.has(s.index) : (!onlyMissing || !s.done))
        .map(({ index, seconds, text }) => ({ index, seconds, text }));
    return { sentences, selective: !!idxSet };
}

// 각 문장의 '다음 대사 시작'(자기보다 시각이 큰 첫 문장) — 선택 재감지 클립의 끝 경계로 쓴다.
export function withNextStarts(data, sentences) {
    const allStarts = data.map(d => d.seconds);
    const nextStartOf = (sec) => {
        let best = null;
        for (const t of allStarts) if (t > sec && (best === null || t < best)) best = t;
        return best;
    };
    return sentences.map(s => ({ ...s, nextStart: nextStartOf(s.seconds) }));
}

/**
 * 모델 답(ends: Map<index, 초>)을 최신 대본(current)에 합친다.
 *  - 이번에 '요청한'(requested) 인덱스만 건드린다 — onlyMissing은 희소 인덱스([3],[17],[42]…)를 보내는데
 *    모델이 0,1,2…로 재번호매김하면 키가 요청과 무관해진다. 그대로 적용하면 이미 정상 감지된 문장이 오염된다.
 *  - 요청 당시 사본(snapshot)과 seconds가 다른 문장(감지 중 재전사·삭제됨)은 건너뛴다.
 *  - 값이 안 왔거나(모델 SKIP·누락) 기준 밖이면 speechEndSkipped 표시(기존 값은 유지).
 *    기준은 speechSegments.validSpeechEnd와 같다 — 어긋나면 '저장은 됐는데 재생에서 무시'가 된다.
 *  - 영상 길이(duration > 0)를 넘는 값은 길이로 자른다.
 * @returns {{ merged: Array, applied: number, secondsMismatch: number, grafts: Array<[number, number]> }}
 *   grafts = [문장 seconds, speechEnd] — 호출부가 speechEndGraftRef에 기록(진행 중인 Stage 2 덮어쓰기 대비)
 */
export function mergeSpeechEnds(current, snapshot, requested, ends, duration = 0) {
    let applied = 0;
    let secondsMismatch = 0;
    const grafts = [];
    const merged = current.map((d, i) => {
        if (!requested.has(i)) return d;
        if (!snapshot[i] || snapshot[i].seconds !== d.seconds) { secondsMismatch++; return d; }
        let se = ends.get(i);
        if (typeof se !== 'number' || !Number.isFinite(se)) {
            // 안 하면 감지 불가 구간이 영원히 미감지로 집계돼 배지가 안 사라지고, 재감지마다 비용이 반복된다
            return d.speechEndSkipped ? d : { ...d, speechEndSkipped: true };
        }
        if (duration > 0) se = Math.min(se, duration);
        if (se <= d.seconds + MIN_SPEECH_SEC || se - d.seconds > MAX_SENTENCE_SEC) {
            return d.speechEndSkipped ? d : { ...d, speechEndSkipped: true };
        }
        applied++;
        grafts.push([d.seconds, se]);
        const next = { ...d, speechEnd: se };
        delete next.speechEndSkipped; // 재시도로 성공하면 포기 표시 해제
        return next;
    });
    return { merged, applied, secondsMismatch, grafts };
}
