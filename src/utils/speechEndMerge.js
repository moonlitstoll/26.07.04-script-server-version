// '대사만' 감지(detectSpeechEndsForFile)의 계산 부분 — 어떤 문장을 요청할지, 모델 답을 대본에 어떻게 합칠지.
// 순수 모듈(테스트 대상). 예전엔 useMediaAnalysis 안에 인라인이라 테스트가 없었다(CLAUDE.md '알려진 공백').
import { validSpeechEnd, blockSpeechEnd, MIN_SPEECH_SEC, MAX_SENTENCE_SEC, GAP_SKIP_MIN } from './speechSegments';

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

// ─── 대사 끝 직접 맞추기 (선택 모드 '대사만' → 직접 맞추기) ─────────────────
// AI가 끝을 못 찾은(판단 불가) 문장이나 틀리게 찾은 문장을 사용자가 ±버튼·미리 듣기로 맞춘다.

// 같은 시각으로 묶인 형제 문장(블록) 범위 — blockSpeechEnd와 같은 기준
function blockRange(data, idx) {
    const t = data[idx].seconds;
    let lo = idx; while (lo > 0 && data[lo - 1].seconds === t) lo--;
    let hi = idx; while (hi + 1 < data.length && data[hi + 1].seconds === t) hi++;
    return [lo, hi];
}

// 다음 대사 시작(자기보다 시각이 큰 첫 문장). 없으면 null(마지막 문장)
export function nextSpeechStart(data, idx) {
    for (let j = idx + 1; j < data.length; j++) if (data[j].seconds > data[idx].seconds) return data[j].seconds;
    return null;
}

// 맞출 수 있는 범위: 시작 직후 ~ min(시작 + MAX_SENTENCE_SEC, 영상 끝). validSpeechEnd를 통과하는 범위와 같다.
export function speechEndEditBounds(data, idx, duration = 0) {
    const start = data[idx].seconds;
    const min = Math.round((start + 0.1) * 100) / 100;
    let max = start + MAX_SENTENCE_SEC;
    if (duration > 0) max = Math.min(max, duration);
    return { min, max: Math.max(min, max) };
}

/**
 * 창을 열 때의 처음 값. 끝 시각이 있으면(블록 기준) 그 값.
 * 없으면 글자 수로 어림한다 — 다음 문장 시작에서 출발하면 '음악뿐인 11초'를 −0.5로 20번 넘게 눌러야 한다(실측 v1b "Ai.").
 * 베트남어는 음절마다 띄어 쓰므로 단어 수 ≈ 음절 수, 음절당 0.25초(최소 0.6초). 다음 문장 시작을 넘지 않는다.
 * @returns {{ value: number, estimated: boolean }}
 */
export function initialSpeechEnd(data, idx, duration = 0) {
    const { min, max } = speechEndEditBounds(data, idx, duration);
    const clamp = (v) => Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
    const known = blockSpeechEnd(data, idx);
    if (known !== null) return { value: clamp(known), estimated: false };
    const it = data[idx];
    const words = (it.text || '').split(/\s+/).filter(Boolean).length;
    let v = it.seconds + Math.max(0.6, words * 0.25);
    const next = nextSpeechStart(data, idx);
    if (next !== null) v = Math.min(v, next);
    return { value: clamp(v), estimated: true };
}

/**
 * 이 끝 시각이면 재생이 어떻게 되는지(창 아래 안내 문구용). 엔진(gapSkipTarget·wrapSkipTarget)과 같은 3초 기준.
 * @returns {{ kind: 'skip'|'short'|'wrap'|'end', gap: number, nextStart: number|null }}
 *   skip = 다음 문장까지 건너뜀 / short = 간격이 짧아 그대로 재생 / wrap = 마지막 문장, 남은 꼬리를 건너뛰고 처음으로 / end = 마지막 문장, 꼬리가 짧음
 */
export function speechEndSkipInfo(data, idx, se, duration = 0) {
    const nextStart = nextSpeechStart(data, idx);
    if (nextStart === null) {
        const gap = duration > 0 ? duration - se : 0;
        return { kind: gap > GAP_SKIP_MIN ? 'wrap' : 'end', gap, nextStart };
    }
    const gap = nextStart - se;
    return { kind: gap > GAP_SKIP_MIN ? 'skip' : 'short', gap, nextStart };
}

/**
 * 직접 맞춘 끝 시각을 넣는다. 같은 시각의 형제 문장 전부에 같은 값 — blockSpeechEnd가 형제 중 가장 늦은 값을 쓰므로
 * 하나만 바꾸면 다른 형제의 옛 값(더 늦은 값)이 이겨 건너뛰기가 안 바뀐다. 판단 불가 표시는 지운다.
 * @returns {{ data: Array, changed: Array<number> }}
 */
export function applyManualSpeechEnd(data, idx, se) {
    const [lo, hi] = blockRange(data, idx);
    const v = Math.round(se * 100) / 100;
    const changed = [];
    const out = data.map((d, i) => {
        if (i < lo || i > hi) return d;
        changed.push(i);
        const next = { ...d, speechEnd: v };
        delete next.speechEndSkipped;
        return next;
    });
    return { data: out, changed };
}

// 끝 시각을 알면 이 문장 뒤를 건너뛸 '수도' 있는 자리인가 — 다음 문장(마지막이면 영상 끝)까지 3초를 넘어야 한다.
// 대사 끝은 시작보다 뒤이므로 간격은 '다음 시작 − 이 문장 시작'보다 클 수 없다. 이게 3초 이하면 끝을 알아도 소용없다.
// (실측 5번 영상 판단 불가 5개는 전부 다음 문장이 0.6~2.5초 뒤라 여기 해당 — 배지를 달면 고칠 것도 없는 잡음)
function couldSkipAfter(data, i, duration) {
    const next = nextSpeechStart(data, i);
    if (next === null) return !(duration > 0) || duration - data[i].seconds > GAP_SKIP_MIN;
    return next - data[i].seconds > GAP_SKIP_MIN;
}

// 카드의 '대사 끝 없음' 배지를 달 문장 — 이 영상에 감지를 한 번이라도 했을 때만(안 했으면 전부 없으니 배지 무의미).
// 판단 불가든 아직 감지 안 됨(재전사로 새로 생긴 문장 등)이든, 재생에서 '이 문장 뒤를 못 건너뜀'은 같다. 기준은 블록 끝.
export function speechEndMissingSet(data, duration = 0) {
    const out = new Set();
    if (!Array.isArray(data) || !data.some(d => typeof d.speechEnd === 'number')) return out;
    data.forEach((_, i) => { if (blockSpeechEnd(data, i) === null && couldSkipAfter(data, i, duration)) out.add(i); });
    return out;
}

// 끝 시각을 못 찾아(판단 불가) 비어 있는 문장 인덱스 — 감지 완료 안내에 개수·첫 문장을 보여 주는 데 쓴다.
// 옛 값이 남아 있거나 형제 문장이 끝을 갖고 있으면(블록 끝이 있음), 또는 건너뛸 자리가 아니면 세지 않는다.
export function unresolvedSpeechEnds(data, duration = 0) {
    const out = [];
    data.forEach((d, i) => { if (d.speechEndSkipped && blockSpeechEnd(data, i) === null && couldSkipAfter(data, i, duration)) out.push(i); });
    return out;
}
