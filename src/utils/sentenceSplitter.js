// [Stage 1 후처리] 여러 문장이 한 항목(타임스탬프)에 뭉쳐 나온 경우 문장별로 분할.
// 모델이 "1줄 1문장" 철칙을 어겨도 여기서 확실히 쪼갠다. 너무 짧은 문장은 인접
// 문장과 병합(최대 5개)하여 자잘한 파편을 막는다. 원래 타임스탬프가 하나뿐이므로
// 쪼갠 문장들의 시각은 다음 항목까지의 구간을 글자 수 비례로 배분한다(단조 증가 보장).

const MERGE_MIN_LEN = 15;   // 이 글자 수 미만이면 "너무 짧은 문장"으로 보고 인접과 병합
const MAX_MERGE = 5;        // 병합 상한(문장 개수)
const DEFAULT_GAP_SEC = 3;  // 다음 항목이 없을 때 문장당 기본 간격(초)

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

// seconds 오름차순으로 정렬된 전사 항목 배열을 받아, 여러 문장이 뭉친 항목을 분할한다.
// duration: 영상 총 길이(초). 마지막 항목의 시각 배분 상한으로 사용(없으면 기본 간격).
export const splitMergedSentences = (matches, duration = 0) => {
    if (!Array.isArray(matches) || matches.length === 0) return matches;
    const out = [];

    for (let i = 0; i < matches.length; i++) {
        const item = matches[i];
        const groups = groupSentences(splitIntoSentences(item.text ?? item.o ?? ''));

        // 분할할 게 없으면(문장 1개) 원본 그대로 유지 → 실제 타임스탬프 보존
        if (groups.length <= 1) {
            out.push(item);
            continue;
        }

        const start = item.seconds;
        const next = matches[i + 1];
        let windowEnd;
        if (next && next.seconds > start) {
            windowEnd = next.seconds;
        } else if (duration > start) {
            windowEnd = Math.min(duration, start + groups.length * DEFAULT_GAP_SEC);
        } else {
            windowEnd = start + groups.length * DEFAULT_GAP_SEC;
        }
        const window = Math.max(0, windowEnd - start);

        const totalChars = groups.reduce((a, g) => a + g.length, 0) || 1;
        let acc = 0;
        for (let g = 0; g < groups.length; g++) {
            const t = start + window * (acc / totalChars); // 첫 그룹은 원래 시각(acc=0) 유지
            acc += groups[g].length;

            const mm = Math.floor(t / 60).toString().padStart(2, '0');
            const ss = (t % 60).toFixed(2).padStart(5, '0');
            const timeStr = `${mm}:${ss}`;

            out.push({
                ...item,
                s: timeStr,
                o: groups[g],
                timestamp: timeStr,
                seconds: t,
                startSeconds: t,
                text: groups[g],
            });
        }
    }

    return out;
};
