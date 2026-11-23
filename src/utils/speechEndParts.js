// 긴 대본의 대사 끝 감지를 몇 조각으로 나눈다 (2026-11-23).
//
// 왜: 524문장(28분)을 한 요청에 보내면 모델이 중간부터 번호를 헷갈려, 앞 문장의 끝 시각을 다음 번호에
// 적는다(실측: 최대 13칸 밀림). 병합이 그런 값을 '시작보다 이름'으로 버려서 판단 불가가 56~220개 나왔다
// (같은 대본, 회차마다 다름). 130문장씩 나누고 그 시간 구간의 소리만 잘라 보내자 0~1개로 줄었다
// (28분 베트남어·24분 영어 각 2회). 보내는 소리 길이의 합은 같아서 비용은 거의 같다.
import { MAX_SENTENCE_SEC } from './speechSegments';

export const SPEECH_PART_MAX = 130; // 한 요청에 넣는 문장 수 상한 — 이보다 많으면 나눈다
export const SPEECH_PART_PAD = 1.5; // 조각 앞뒤 여유(초)

/**
 * @param {Array<{index:number, seconds:number, text:string, nextStart:(number|null)}>} sentences 시각 순
 * @param {number} duration 영상 길이(초, 모르면 0)
 * @returns {null | Array<{winStart:number, winDur:number, items:Array<{index:number, seconds:number, text:string}>}>}
 *   null = 나누지 않는다(상한 이하). items의 seconds는 조각 기준(winStart를 뺀 값).
 */
export function planSpeechEndParts(sentences, duration = 0, max = SPEECH_PART_MAX) {
    const n = sentences?.length || 0;
    if (n <= max) return null;
    const count = Math.ceil(n / max);
    const size = Math.ceil(n / count); // 조각 크기를 고르게(524문장 → 105·105·105·105·104, 마지막 조각만 몇 문장 남지 않게)
    const parts = [];
    for (let a = 0; a < n; a += size) {
        const group = sentences.slice(a, a + size);
        const winStart = Math.max(0, Math.min(...group.map(s => s.seconds)) - SPEECH_PART_PAD);
        // 조각 안 문장의 끝이 들어올 수 있는 가장 늦은 곳: 각 문장의 다음 대사 시작(없으면 영상 끝)과
        // 병합이 받는 상한(시작 + MAX_SENTENCE_SEC) 중 이른 쪽
        let lastEnd = 0;
        for (const s of group) {
            const cap = s.seconds + MAX_SENTENCE_SEC;
            const next = Number.isFinite(s.nextStart) ? s.nextStart : (duration > 0 ? duration : cap);
            lastEnd = Math.max(lastEnd, Math.min(next, cap));
        }
        let winEnd = lastEnd + SPEECH_PART_PAD;
        if (duration > 0) winEnd = Math.min(winEnd, duration);
        parts.push({
            winStart,
            winDur: Math.max(0.1, winEnd - winStart),
            items: group.map(s => ({ index: s.index, seconds: Math.max(0, s.seconds - winStart), text: s.text })),
        });
    }
    return parts;
}

/**
 * 조각마다 detectPart(조각) → Map<index, 조각 기준 초>를 받아 전체 시각으로 되돌려 합친다.
 *  - 조각에 넣지 않은 번호로 온 답은 버린다(모델이 번호를 새로 매긴 경우 다른 조각 문장을 덮지 않게).
 *  - 한 조각이 실패하면(사용자 취소 제외) 그 조각 문장은 failedIndices에 넣고 나머지는 살린다 —
 *    호출부는 그 문장을 '판단 불가'로 표시하지 말고 미감지로 남겨야 한다(연결 문제는 다시 하면 된다).
 *  - 모든 조각이 실패하면 마지막 오류를 던진다(예전 한 번 요청과 같게).
 */
export async function runSpeechEndParts(parts, detectPart, { concurrency = 2, signal = null } = {}) {
    const out = new Map();
    const failed = new Set();
    let okParts = 0;
    let lastError = null;
    let next = 0;
    const worker = async () => {
        while (next < parts.length) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const p = parts[next++];
            const mine = new Set(p.items.map(it => it.index));
            try {
                const m = await detectPart(p);
                let hit = 0;
                for (const [i, v] of m) {
                    if (mine.has(i) && typeof v === 'number' && Number.isFinite(v)) { out.set(i, v + p.winStart); hit++; }
                }
                // 답은 왔는데 이 조각 번호가 하나도 없다(모델이 0부터 다시 매김) → 실패로 친다.
                // 성공으로 두면 그 조각 문장이 전부 '판단 불가'로 굳어 다시 감지 대상에서 빠진다(독립 검토)
                if (hit === 0) throw new Error(`조각 번호와 맞는 답이 없음 (받은 ${m.size}줄)`);
                okParts++;
            } catch (e) {
                if (e?.name === 'AbortError') throw e;
                lastError = e;
                for (const i of mine) failed.add(i);
                console.warn(`[SpeechEnd] 조각(${p.items.length}문장, ${Math.round(p.winStart)}초~) 실패 → 그 문장은 미감지로 둠:`, e?.message || e);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));
    if (okParts === 0) throw lastError || new Error('Speech-end detection failed');
    Object.defineProperty(out, 'failedIndices', { value: failed, enumerable: false });
    return out;
}
