import { parseChunks, splitBreakdown, splitGlossWords } from './analysisParser';

// 시드 기반 난수 (재현성): 같은 (문장, 라운드, 난이도)면 항상 같은 문제.
// → 가리기 학습을 껐다 켜도 같은 빈칸 유지, '새 문제'(round++)나 난이도 변경 때만 새로 섞임.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 난이도별로 가릴 단어 비율. 예전엔 청크 개수로 정해서, 청크가 길거나 1개뿐인 문장은
// 초급도 대부분(실측 37~46%, 통째 가림 21~37%)이 가려졌다(2026-11-18).
export const DRILL_RATIOS = { easy: 0.25, mid: 0.5, hard: 0.75, full: 1 };
const DIFF_SEEDS = { easy: 1, mid: 2, hard: 3, full: 4 };

const tokensOf = (s) => s.split(/\s+/).filter(Boolean);
// 비교용 글자: "tư(24)"의 숫자 병기와 문장부호를 뗀다. 남는 게 없는 토큰("(1.000)", "-")은 단어가 아니다.
const wordKey = (t) => t.normalize('NFC').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^\p{L}\p{N}]/gu, '');

// 청크를 가리는 단위로 나눈다. 베트남어는 음절마다 띄어 쓰므로 그냥 띄어쓰기로 자르면
// "khẩu vị"가 반으로 갈린다 → 뜻풀이 괄호의 원어 단어(khẩu vị: 입맛)를 낱말 경계로 쓴다.
// 풀이에 없는 토큰은 한 음절씩 단위가 된다(옛 분석·한자 풀이도 그대로 동작).
function chunkUnits(tokens, meaning) {
    const keys = tokens.map(wordKey);
    const gloss = splitBreakdown(meaning || '')[1] || '';
    const glossWords = gloss ? splitGlossWords(gloss).filter(p => p.word).map(p => p.text) : [];
    const spans = [];
    let cursor = 0;
    for (const word of glossWords) {
        const wanted = tokensOf(word).map(wordKey).filter(Boolean);
        if (!wanted.length) continue;
        for (let i = cursor; i <= keys.length - wanted.length; i++) {
            if (wanted.every((k, j) => keys[i + j] === k)) {
                spans.push([i, i + wanted.length]);
                cursor = i + wanted.length;
                break;
            }
        }
    }
    const units = [];
    const addSingles = (from, to) => {
        for (let i = from; i < to; i++) if (keys[i]) units.push({ start: i, end: i + 1, words: 1 });
    };
    let at = 0;
    for (const [start, end] of spans) {
        addSingles(at, start);
        units.push({ start, end, words: end - start });
        at = end;
    }
    addSingles(at, keys.length);
    // 단어가 하나도 없는 청크("(1.000)")는 통째로 한 단위
    if (!units.length && tokens.length) units.push({ start: 0, end: tokens.length, words: 1 });
    return units;
}

// 목표 비율에 가장 가깝게, 넘치지 않도록 단위를 고른다. 일부만 가리는 난이도는 최소 1단어를 남긴다.
function pickUnits(units, ratio, rand) {
    const all = units.map((_, i) => i);
    if (ratio >= 1 || units.length === 1) return new Set(all);
    const total = units.reduce((n, u) => n + u.words, 0);
    const target = Math.min(total - 1, Math.max(1, Math.round(total * ratio)));
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    const hidden = new Set();
    let count = 0;
    for (const i of all) {
        if (count + units[i].words <= target) { hidden.add(i); count += units[i].words; }
        if (count >= target) break;
    }
    // 낱말이 전부 목표보다 길면 가장 짧은 낱말 하나만 가린다
    if (!hidden.size) hidden.add(all.reduce((best, i) => (units[i].words < units[best].words ? i : best), all[0]));
    return hidden;
}

// 한 문장의 빈칸 문제를 만든다.
//  초급·중급·고급은 단어의 약 25·50·75%, 전체는 100%를 가린다. 빈칸은 청크 안에서 이어진 단어끼리 묶는다.
//  전부 가려지면 '문장 통째 가림' → 아무 빈칸이나 탭해 한 번에 공개하는 흐름으로 처리한다.
//  번역 단서는 난이도와 별개의 설정이라 여기서 다루지 않는다(켜고 꺼도 빈칸이 바뀌지 않는다).
export function buildCloze(item, idx, round, difficulty) {
    const chunks = parseChunks(item);
    if (chunks.length === 0) {
        return { ok: false, parts: [], meanings: [], chunkCount: 0, wordCount: 0, hiddenWords: 0, wholeSentence: false };
    }
    const ratio = DRILL_RATIOS[difficulty] ?? DRILL_RATIOS.easy;
    const rand = mulberry32((idx + 1) * 100003 + round * 131 + (DIFF_SEEDS[difficulty] ?? DIFF_SEEDS.easy));

    const pieces = chunks.map((c, chunkIdx) => {
        const tokens = tokensOf(c.chunk);
        return { ...c, chunkIdx, tokens, units: chunkUnits(tokens, c.meaning) };
    });
    const units = pieces.flatMap(p => p.units.map(u => ({ ...u, chunkIdx: p.chunkIdx })));
    const hidden = pickUnits(units, ratio, rand);
    const wholeSentence = hidden.size >= units.length;
    const wordCount = units.reduce((n, u) => n + u.words, 0);
    const hiddenWords = units.reduce((n, u, i) => n + (hidden.has(i) ? u.words : 0), 0);

    const parts = [];
    const hiddenChunks = new Set();
    for (const p of pieces) {
        // 통째 가림은 문장부호·숫자 병기까지 청크째 가린다(답이 새지 않게)
        if (wholeSentence) {
            parts.push({ type: 'blank', answer: p.chunk });
            hiddenChunks.add(p.chunkIdx);
            continue;
        }
        const covered = new Array(p.tokens.length).fill(false);
        units.forEach((u, i) => {
            if (u.chunkIdx !== p.chunkIdx || !hidden.has(i)) return;
            for (let t = u.start; t < u.end; t++) covered[t] = true;
            hiddenChunks.add(p.chunkIdx);
        });
        for (let t = 0; t < p.tokens.length;) {
            let end = t;
            while (end < p.tokens.length && covered[end] === covered[t]) end++;
            const text = p.tokens.slice(t, end).join(' ');
            parts.push(covered[t] ? { type: 'blank', answer: text } : { type: 'text', value: text });
            t = end;
        }
    }
    // 전부 공개한 뒤 보여 줄 뜻: 가려진 단어가 들어 있던 청크의 줄
    const meanings = pieces.filter(p => hiddenChunks.has(p.chunkIdx)).map(p => ({ chunk: p.chunk, meaning: p.meaning }));

    return { ok: true, parts, meanings, chunkCount: chunks.length, wordCount, hiddenWords, wholeSentence };
}
