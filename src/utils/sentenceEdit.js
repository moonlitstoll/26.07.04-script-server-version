// 대본 문장 편집 계산 — 문장 나누기(일부 삭제)와 구간 재전사의 범위 계산. 순수 모듈(테스트 대상).
//
// 저장 형식 주의(mediaUtils.sanitizeData): 시각은 문자열 `s`/`timestamp`가 숫자 `seconds`보다 우선이고,
// 본문은 `o`가 `text`보다, 분석은 `a`가 `analysis`보다 우선이다. 그래서 바꿀 때는 짝을 함께 바꾼다.
// isAnalyzed는 analysis가 남아 있으면 다시 true가 되므로, 재분석할 문장은 analysis/a를 비워야 한다.

// 초 → "MM:SS.ss" (전사가 만드는 형식과 같다: transcribeStream)
export function formatStamp(sec) {
    const t = Math.max(0, sec);
    const mm = Math.floor(t / 60).toString().padStart(2, '0');
    const ss = (t - Math.floor(t / 60) * 60).toFixed(2).padStart(5, '0');
    return `${mm}:${ss}`;
}

export const splitWords = (text) => (text || '').split(/\s+/).filter(Boolean);

// 다시 분석해야 하는 상태로(번역·분석·전사의심 비움)
const unanalyzed = (item) => ({
    ...item, translation: '', analysis: '', a: '', t: '', transcriptSuspect: '', isAnalyzed: false, analysisFailed: false,
});
const withText = (item, text) => ({ ...item, text, o: text });
const withStart = (item, sec) => {
    const stamp = formatStamp(sec);
    return { ...item, seconds: sec, startSeconds: sec, s: stamp, timestamp: stamp };
};
// 대사 끝 시각이 더는 맞지 않을 때(끝이 잘린 문장) — '대사만' 칩의 !N으로 다시 감지할 수 있게 비운다
const withoutSpeechEnd = (item) => {
    const next = { ...item };
    delete next.speechEnd;
    delete next.speechEndSkipped;
    return next;
};

// 문장 idx의 '말이 끝나는 곳' 추정: 대사 끝 시각(감지됨) > 다음 문장 시작 > 영상 끝 > 시작+3초
export function sentenceEndOf(data, idx, duration = 0) {
    const it = data[idx];
    if (!it) return 0;
    if (typeof it.speechEnd === 'number' && it.speechEnd > it.seconds) return it.speechEnd;
    for (let j = idx + 1; j < data.length; j++) {
        if (data[j].seconds > it.seconds) return data[j].seconds;
    }
    return duration > it.seconds ? duration : it.seconds + 3;
}

// 나눌 곳(wordIndex번째 단어 앞)의 시각을 글자 수 비율로 어림한다.
// 공백을 빼고 센다 — 베트남어는 음절마다 띄어 써서 공백까지 세면 짧은 음절이 많은 쪽이 부풀려진다.
export function estimateSplitTime(start, end, text, wordIndex) {
    const words = splitWords(text);
    if (!(end > start) || words.length < 2) return start;
    const k = Math.min(Math.max(1, wordIndex), words.length - 1);
    const len = (ws) => ws.join('').length;
    const ratio = len(words.slice(0, k)) / Math.max(1, len(words));
    return start + (end - start) * ratio;
}

// 나눈 뒷부분 시작 시각의 허용 범위 — 앞 문장 시작과 '다음 문장 시작' 사이(순서가 뒤바뀌지 않게)
export function splitTimeBounds(data, idx, duration = 0) {
    const it = data[idx];
    let next = duration > it.seconds ? duration : it.seconds + 60;
    for (let j = idx + 1; j < data.length; j++) {
        if (data[j].seconds > it.seconds) { next = data[j].seconds; break; }
    }
    return { min: it.seconds + 0.05, max: Math.max(it.seconds + 0.05, next - 0.05) };
}

/**
 * 문장 하나를 wordIndex번째 단어 앞에서 나눈다.
 *  mode 'dropHead' : 앞부분 삭제 → 뒷부분만 남고 시작이 splitSeconds로 옮겨진다
 *  mode 'dropTail' : 뒷부분 삭제 → 앞부분만 남는다(대사 끝 시각은 비움)
 *  mode 'keepBoth' : 둘 다 남긴다 → 두 문장
 * 남는 문장은 모두 '다시 분석' 상태. 지운 조각은 trashed로 돌려준다(휴지통 보관용, 역시 미분석).
 * @returns {{ data: Array, trashed: Array, changed: Array<number> }} changed = 새 data에서 바뀐 문장 인덱스
 */
export function applySplit(data, idx, { wordIndex, mode, splitSeconds }) {
    const it = data[idx];
    const words = splitWords(it?.text ?? it?.o);
    if (!it || words.length < 2) throw new Error('나눌 수 없는 문장입니다(단어가 2개 이상이어야 함).');
    const k = Math.min(Math.max(1, wordIndex), words.length - 1);
    const headText = words.slice(0, k).join(' ');
    const tailText = words.slice(k).join(' ');
    const t = Number.isFinite(splitSeconds) ? splitSeconds : it.seconds;

    const head = unanalyzed(withText(it, headText));
    const tail = unanalyzed(withStart(withText(it, tailText), t));

    let pieces; let trashed;
    if (mode === 'dropHead') { pieces = [tail]; trashed = [withoutSpeechEnd(head)]; }
    else if (mode === 'dropTail') { pieces = [withoutSpeechEnd(head)]; trashed = [withoutSpeechEnd(tail)]; }
    else if (mode === 'keepBoth') { pieces = [withoutSpeechEnd(head), tail]; trashed = []; }
    else throw new Error(`알 수 없는 나누기 방식: ${mode}`);

    const out = [...data.slice(0, idx), ...pieces, ...data.slice(idx + 1)];
    return { data: out, trashed, changed: pieces.map((_, i) => idx + i) };
}

// ─── 구간 재전사 ───────────────────────────────────────────────

// 같은 시각으로 묶인 형제 문장(블록)까지 넓힌 인덱스 범위
function blockBounds(data, i) {
    const t = data[i].seconds;
    let lo = i; while (lo > 0 && data[lo - 1].seconds === t) lo--;
    let hi = i; while (hi < data.length - 1 && data[hi + 1].seconds === t) hi++;
    return [lo, hi];
}

/**
 * 선택한 문장들로 기본 구간을 잡는다: 첫 문장 시작 ~ 마지막 문장이 끝나는 곳(다음 문장 시작, 없으면 영상 끝).
 * 떨어진 문장을 골라도 처음~끝 한 구간(사이 문장 포함).
 */
export function rangeFromSelection(data, indices, duration = 0) {
    const valid = [...new Set(indices)].filter(i => i >= 0 && i < data.length).sort((a, b) => a - b);
    if (valid.length === 0) return null;
    const lo = blockBounds(data, valid[0])[0];
    const hi = blockBounds(data, valid[valid.length - 1])[1];
    const start = data[lo].seconds;
    let end = null;
    for (let j = hi + 1; j < data.length; j++) {
        if (data[j].seconds > data[hi].seconds) { end = data[j].seconds; break; }
    }
    if (end == null) end = duration > data[hi].seconds ? duration : data[hi].seconds + 8;
    return { start, end };
}

// 교체 대상: 시작 시각이 [start, end) 안인 문장(구간 밖에서 시작해 걸친 문장은 건드리지 않는다)
export function indicesInRange(data, start, end) {
    const out = [];
    data.forEach((d, i) => { if (d.seconds >= start && d.seconds < end) out.push(i); });
    return out;
}

// 구간 재전사 결과 중 '이웃 문장에서 새어 나온 조각'인지: 글자만 남겨 비교해 이웃 안에 통째로 들어 있으면 조각.
// 단어 겹침 비율로 판정하면 안 된다 — 실측(2026-09): "Màu gì, màu gì, đây?"가 바로 앞 문장
// "Nào, … sẽ là màu gì nào?"와 단어 80%가 겹쳐 진짜 새 문장인데도 버려졌다(짧은 되풀이 문장·노래 후렴에 흔함).
const lettersOnly = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function isLeakedFrom(text, neighbor, minChars = 4) {
    const a = lettersOnly(text);
    const b = lettersOnly(neighbor);
    if (a.length < minChars || !b) return false;
    return b.includes(a);
}

// 구간 바로 앞·뒤 이웃(경계 파편 정리·중복 차단용)
export function rangeNeighbors(data, start, end) {
    let prev = -1; let next = -1;
    data.forEach((d, i) => {
        if (d.seconds < start) prev = i;
        else if (d.seconds >= end && next === -1) next = i;
    });
    return { prev, next };
}

// 시작·끝 조정의 허용 범위: 0 ~ 영상 끝, 시작 < 끝(최소 0.5초)
export const RANGE_MIN_SEC = 0.5;
export function clampRange(start, end, duration = 0) {
    const maxEnd = duration > 0 ? duration : Infinity;
    let s = Math.max(0, start);
    let e = Math.min(maxEnd, end);
    if (e - s < RANGE_MIN_SEC) {
        if (s + RANGE_MIN_SEC <= maxEnd) e = s + RANGE_MIN_SEC;
        else s = Math.max(0, e - RANGE_MIN_SEC);
    }
    return { start: s, end: e };
}

export const LONG_RANGE_WARN_SEC = 180; // 3분 넘으면 확인창에 경고

/**
 * 구간의 옛 문장을 새 문장으로 바꾼다. 시작 시각이 [start, end) 안인 옛 문장이 교체 대상.
 * @returns {{ data: Array, removed: Array }} removed = 휴지통으로 보낼 옛 문장
 */
export function replaceRange(data, start, end, fresh) {
    const idxs = new Set(indicesInRange(data, start, end));
    const removed = data.filter((_, i) => idxs.has(i));
    const kept = data.filter((_, i) => !idxs.has(i));
    const merged = [...kept, ...(fresh || [])].sort((a, b) => a.seconds - b.seconds);
    return { data: merged, removed };
}
