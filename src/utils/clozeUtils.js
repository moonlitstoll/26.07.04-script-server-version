import { parseChunks } from './analysisParser';

// 시드 기반 난수 (재현성): 같은 (문장, 라운드, 난이도)면 항상 같은 문제.
// → 가리기 학습을 껐다 켜도 같은 빈칸 유지, '새 문제'(round++)나 난이도 변경 때만 새로 섞임.
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const diffSeed = (d) => (d === 'easy' ? 1 : d === 'mid' ? 2 : 3);

// N개 인덱스 중 k개를 (시드) 랜덤으로 고른다.
function pickK(N, k, rand) {
    const idxs = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    return new Set(idxs.slice(0, Math.min(k, N)));
}

// 한 문장의 빈칸 문제를 만든다.
//  난이도별 가리는 정도: 초급=1개 랜덤, 중급=랜덤 여러 개(청크수의 ~60% 상한 내), 고급=전체
//  청크가 1개뿐이면(또는 전부 가려지면) '문장 통째 가림' → 자가채점 흐름으로 처리
export function buildCloze(item, idx, round, difficulty) {
    const chunks = parseChunks(item);
    const N = chunks.length;
    if (N === 0) {
        return { ok: false, parts: [], chunkCount: 0, hiddenCount: 0, wholeSentence: false };
    }
    const rand = mulberry32((idx + 1) * 100003 + round * 131 + diffSeed(difficulty));

    let hidden;
    if (N === 1 || difficulty === 'hard') {
        hidden = new Set(chunks.map((_, i) => i)); // 통째
    } else if (difficulty === 'easy') {
        hidden = new Set([Math.floor(rand() * N)]); // 1개
    } else { // mid
        const maxHide = Math.max(1, Math.round(N * 0.6));
        const k = 1 + Math.floor(rand() * maxHide); // 1 ~ maxHide
        hidden = pickK(N, k, rand);
    }

    const wholeSentence = hidden.size >= N;
    const parts = chunks.map((c, i) => hidden.has(i)
        ? { type: 'blank', answer: c.chunk, meaning: c.meaning }
        : { type: 'text', value: c.chunk });

    return { ok: true, parts, chunkCount: N, hiddenCount: hidden.size, wholeSentence };
}
