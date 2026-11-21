// 문장별 분석 모델 정하기 (순수 함수 — 단위 테스트 有)
//
// 2단계 분석은 한 번 부를 때 모델 하나를 받는다. 그런데 분석이 도는 중에 문장을 고치면(다시 전사·삭제 등) 새 분석이
// 시작되면서 '아직 안 끝난 나머지 문장 전부'가 새 분석의 모델로 돌았다 — 첫 분석(2단계 모델) 중 한 문장을 다시 전사하면
// 남은 문장이 전부 재분석 모델로, 재분석 중 다른 문장을 지우면 재분석하던 문장이 2단계 모델로(2026-11-19 점검, 화면 재현).
// 더 비싼 모델이면 비용이 모르게 늘고, 싼 모델이면 사용자가 고른 재분석 품질이 안 나온다.
// 그래서 중단된 분석이 맡고 있던 문장은 그 모델을 기억했다가 이어받는 분석이 그대로 쓴다.
import { lineKey } from './liveMerge';

/**
 * 이번 분석이 맡을 문장들의 모델을 정한다.
 * @param {Array} transcript 대본
 * @param {number[]} pending 이번 분석이 맡는 문장 번호
 * @param {Map<string,string>|null|undefined} carry 앞 분석이 끝내지 못하고 남긴 '문장 열쇠 → 모델'
 *        (끝낸 문장은 앞 분석이 지워 둔다 — 그 문장을 다시 분석하라고 하면 이번 모델로 돈다)
 * @param {string} currentModel 이번 분석이 받은 모델
 * @returns {Map<string,string>} 문장 열쇠 → 모델
 */
export function pickLineModels(transcript, pending, carry, currentModel) {
    const out = new Map();
    for (const i of pending) {
        const d = transcript[i];
        if (!d) continue;
        const k = lineKey(d);
        out.set(k, carry?.get(k) || currentModel);
    }
    return out;
}

/**
 * 기억에 '그때의 설정'을 붙여 둔다 / 지금 설정과 같을 때만 기억을 돌려준다.
 * 분석이 끊긴 뒤 사용자가 모델을 바꾸거나 Claude 키를 지웠으면 기억을 버리고 지금 설정을 따라야 한다 —
 * 안 그러면 바꾼 뒤에도 옛 모델로 요청이 나간다(2026-11-21 독립 검토에서 재현).
 */
export const stampCarry = (lineModel, settings) => Object.assign(new Map(lineModel), { settings });
export const usableCarry = (carry, settings) => (carry && carry.settings === settings ? carry : null);

/**
 * 문장 번호들을 모델별로 나눈 뒤 size개씩 묶는다. 각 묶음(배열)에 .model이 붙는다.
 * firstModel 묶음이 맨 앞(사용자가 방금 시킨 일을 먼저), 나머지는 모델이 처음 나온 순서. 묶음 안은 원래 순서.
 */
export function batchesByModel(indices, modelOf, size, firstModel = null) {
    const groups = new Map();
    if (firstModel) groups.set(firstModel, []);
    for (const i of indices) {
        const m = modelOf(i);
        if (!groups.has(m)) groups.set(m, []);
        groups.get(m).push(i);
    }
    const batches = [];
    for (const [model, list] of groups) {
        for (let i = 0; i < list.length; i += size) {
            const b = list.slice(i, i + size);
            b.model = model;
            batches.push(b);
        }
    }
    return batches;
}
