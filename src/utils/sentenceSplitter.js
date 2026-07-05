// [Stage 1 후처리] 여러 문장이 한 항목(타임스탬프)에 뭉쳐 나온 경우 문장별로 분할.
// 모델이 "1줄 1문장" 철칙을 어겨도 여기서 확실히 쪼갠다. 너무 짧은 문장은 인접
// 문장과 병합(최대 5개)하여 자잘한 파편을 막는다.
//
// [타임라인 정책] 원래 타임스탬프가 하나뿐인 병합 블록은, 쪼갠 문장들이 모두 그 블록의
// '실제 시작 시각'을 공유한다. 시각을 지어내지(추정하지) 않으므로 타임라인이 절대 틀리지
// 않는다. 대신 한 블록 안 문장들은 문장별 정밀 이동이 아니라 블록 단위로 이동한다.

const MERGE_MIN_LEN = 15;   // 이 글자 수 미만이면 "너무 짧은 문장"으로 보고 인접과 병합
const MAX_MERGE = 5;        // 병합 상한(문장 개수)

// 종결부호(.?!… 및 CJK 변형) 뒤 공백을 경계로 분리. 숫자 사이 소수점(3.5)은 뒤에
// 공백이 없어 분리되지 않는다.
export const splitIntoSentences = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    const parts = trimmed.split(/(?<=[.?!…。？！])\s+(?=\S)/);
    return parts.map(s => s.trim()).filter(Boolean);
};

// 짧은 문장을 인접 문장과 greedy 병합. 각 그룹은 누적 길이가 MERGE_MIN_LEN 이상이거나
// 문장 수가 MAX_MERGE에 도달하면 확정된다. 마지막 자투리가 너무 짧으면 직전 그룹에 흡수.
export const groupSentences = (sentences) => {
    const groups = [];
    let cur = [];
    let curLen = 0;
    for (const s of sentences) {
        cur.push(s);
        curLen += s.length;
        if (curLen >= MERGE_MIN_LEN || cur.length >= MAX_MERGE) {
            groups.push(cur);
            cur = [];
            curLen = 0;
        }
    }
    if (cur.length) {
        const prev = groups[groups.length - 1];
        if (curLen < MERGE_MIN_LEN && prev && prev.length + cur.length <= MAX_MERGE) {
            prev.push(...cur);
        } else {
            groups.push(cur);
        }
    }
    return groups.map(g => g.join(' '));
};

// [Stage 1 후처리 ②] splitMergedSentences와 '반대' 방향 정리.
// "À.", "ở." 처럼 감탄사/추임새 한 음절이 '별도 타임스탬프 줄'로 흩어져 나온 경우,
// 인접한 파편끼리 한 항목으로 병합해 자잘한 카드 난립을 막는다.
//  - 대상: 단어 2개 이하인 항목만("Phát.", "Uầy, sướng." 등) → 3단어 이상 정상 문장은 불변
//  - 시간 간격이 TINY_GAP_SEC를 넘으면 서로 다른 발화로 보고 합치지 않음
//  - 병합 항목은 '첫 파편의 타임스탬프/시각'을 유지(시각 추정 없음)
const TINY_GAP_SEC = 4;    // 인접 파편으로 볼 최대 시간 간격(초)
const TINY_MAX = 6;        // 한 번에 합칠 상한(개수)

const tinyWords = (t) => (t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
// 초단문 파편 판정: 단어 2개 이하(감탄사·짧은 반응 등)
const isTinyFragment = (t) => {
    const w = tinyWords(t).length;
    return w >= 1 && w <= 2;
};

export const mergeTinyFragments = (matches) => {
    if (!Array.isArray(matches) || matches.length < 2) return matches;
    const out = [];
    let i = 0;
    while (i < matches.length) {
        const item = matches[i];
        if (!isTinyFragment(item.text ?? item.o ?? '')) { out.push(item); i++; continue; }

        // 연속 파편 run 수집 (시간 간격/개수 제한)
        const run = [item];
        let j = i + 1;
        while (j < matches.length && run.length < TINY_MAX) {
            const nxt = matches[j];
            if (!isTinyFragment(nxt.text ?? nxt.o ?? '')) break;
            const gap = (nxt.seconds ?? 0) - (run[run.length - 1].seconds ?? 0);
            if (gap > TINY_GAP_SEC) break;
            run.push(nxt);
            j++;
        }

        if (run.length >= 2) {
            const merged = run.map(r => (r.text ?? r.o ?? '').trim()).filter(Boolean).join(' ');
            out.push({ ...run[0], o: merged, text: merged }); // 첫 파편 시각 유지
        } else {
            out.push(item);
        }
        i = j;
    }
    return out;
};

// 전사 항목 배열을 받아, 여러 문장이 뭉친 항목을 문장별 항목으로 분할한다.
// 쪼갠 문장들은 원본 항목의 타임스탬프/시각을 그대로 공유한다(시각을 지어내지 않음).
// 입력 순서를 보존하므로 이후 정렬(안정 정렬)에서도 문장 순서가 유지된다.
export const splitMergedSentences = (matches) => {
    if (!Array.isArray(matches) || matches.length === 0) return matches;
    const out = [];

    for (const item of matches) {
        const groups = groupSentences(splitIntoSentences(item.text ?? item.o ?? ''));

        // 분할할 게 없으면(문장 1개) 원본 그대로 유지
        if (groups.length <= 1) {
            out.push(item);
            continue;
        }

        // 블록의 실제 시각을 공유한 채 텍스트만 문장별로 분리
        for (const g of groups) {
            out.push({ ...item, o: g, text: g });
        }
    }

    return out;
};
