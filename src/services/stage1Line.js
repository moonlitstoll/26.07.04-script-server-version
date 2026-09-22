// Stage 1 전사 응답의 한 줄 형식 인식 — 순수 모듈(테스트 대상).
// 형식: [MM:SS.ms] [Speaker A] || 대사   (프롬프트 규칙 8이 MM:SS.ms를 지시)
//
// 시각 칸은 시:분:초(HH:MM:SS.ms)도 받는다. 프롬프트는 MM:SS.ms를 지시하지만 모델이 1분이 넘으면
// [00:01:04.47]처럼 시(時)를 붙여 쓰는 이탈이 실측됐다(2026-09, gemini-3.6-flash).
// 예전 패턴은 콜론 하나(\d+:[0-9.]+)만 받아 앞의 "00:01"만 시각으로 읽었다 → 1분 이후 문장이 전부
// '1초'가 되어 역행 보정으로 57초 근처에 몰리고, 대본에 "04.47] [Speaker D] ||" 조각이 섞였다.
export const LINE_REGEX = /^[\s\-*>#]*(?:\[)?(\d+:[0-9.]+(?::[0-9.]+)?)(?:\])?\s*(?:\[([^\]]+)\])?\s*(?:\|\||-\s*|\||:)?\s*(.+)/;

// [숫자 병기 폭주 정리] 프롬프트 규칙 6은 소리 내어 말한 숫자에만 `소리나는말(원본)`을 붙이게 한다
// (예: "một nghìn(1.000)"). 그런데 모델이 이걸 모든 단어로 번지게 쓴 대본이 실측됐다(2026-09, 2.5 Flash,
// 16분 영상 전체):
//   "Hôm nay(1) là(1) còn(1) thừa(1) một(1) nghìn(1.000) mình(1.000) không(1.000) mua(1.000) cơm(1.000)."
// 같은 설정으로 전체 2회를 다시 돌렸을 때는 재현되지 않았다. 다만 그 씨앗으로 보이는
// "Năm(5) nghìn(1.000) một(1) túi riêng."(한 번 붙일 괄호를 단어마다 붙임)은 한 줄 나왔다.
// 모델은 자기가 쓴 앞 줄을 보고 다음 줄을 써서, 이런 버릇이 생기면 뒤 문장으로 번진다.
//
// 판정: 바로 이어진 단어 RUNAWAY_ANNOTATION_RUN개 이상에 '똑같은' 숫자 괄호가 붙으면 폭주로 본다.
// 정상 병기는 숫자 덩어리 끝에 한 번씩이라 같은 값이 연달아 붙지 않는다.
// 폭주한 줄은 숫자 괄호를 전부 지운다. 제대로 된 병기도 같이 지워지지만, 말한 단어는 그대로 남는다.
// 기호 병기(trên(/) 등)는 이 폭주와 무관해 건드리지 않는다.
export const RUNAWAY_ANNOTATION_RUN = 3;
const NUM_ANNOT_AT_END = /\((\d[\d.,]*)\)[.,!?;:…"'”’)\]]*$/u;
const NUM_ANNOT = /\(\d[\d.,]*\)/g;

export function stripRunawayNumberAnnotations(text) {
    if (!text || !text.includes('(')) return text;
    let run = 0;
    let prev = null;
    let runaway = false;
    for (const token of text.split(/\s+/)) {
        const value = token.match(NUM_ANNOT_AT_END)?.[1] ?? null;
        run = value !== null && value === prev ? run + 1 : (value !== null ? 1 : 0);
        prev = value;
        if (run >= RUNAWAY_ANNOTATION_RUN) { runaway = true; break; }
    }
    if (!runaway) return text;
    return text.replace(NUM_ANNOT, '').replace(/\s{2,}/g, ' ').trim();
}

// LINE_REGEX가 잡은 시각 문자열 → 초. [HH:]MM:SS.ms 또는 초 단위 숫자.
export function lineTimeToSeconds(rawTimeStr) {
    const timeParts = String(rawTimeStr).replace(/[^\d:.]/g, '').split(':').reverse();
    if (timeParts.length >= 2) {
        const ss = parseFloat(timeParts[0]) || 0;
        const mm = parseFloat(timeParts[1]) || 0;
        const hh = parseFloat(timeParts[2]) || 0;
        return (hh * 3600) + (mm * 60) + ss;
    }
    return parseFloat(timeParts[0]) || 0;
}
