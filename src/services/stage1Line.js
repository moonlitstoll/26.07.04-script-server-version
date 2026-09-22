// Stage 1 전사 응답의 한 줄 형식 인식 — 순수 모듈(테스트 대상).
// 형식: [MM:SS.ms] [Speaker A] || 대사   (프롬프트 규칙 8이 MM:SS.ms를 지시)
//
// 시각 칸은 시:분:초(HH:MM:SS.ms)도 받는다. 프롬프트는 MM:SS.ms를 지시하지만 모델이 1분이 넘으면
// [00:01:04.47]처럼 시(時)를 붙여 쓰는 이탈이 실측됐다(2026-09, gemini-3.6-flash).
// 예전 패턴은 콜론 하나(\d+:[0-9.]+)만 받아 앞의 "00:01"만 시각으로 읽었다 → 1분 이후 문장이 전부
// '1초'가 되어 역행 보정으로 57초 근처에 몰리고, 대본에 "04.47] [Speaker D] ||" 조각이 섞였다.
export const LINE_REGEX = /^[\s\-*>#]*(?:\[)?(\d+:[0-9.]+(?::[0-9.]+)?)(?:\])?\s*(?:\[([^\]]+)\])?\s*(?:\|\||-\s*|\||:)?\s*(.+)/;

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
