// 번역/분석 표시 3단계 — 하단 눈 버튼과 키보드 B가 누를 때마다 이 순서로 돈다(2026-09).
//   folded(기본): 번역·분석 보임, 괄호 속 단어 풀이는 접힘 "(…)"
//   open        : 괄호 풀이까지 전부 펼침
//   hidden      : 번역·분석 전부 숨김(원문만)
// 접힘을 기본·첫 단계로 둔 이유: 휴대폰에서 문장 하나가 한 화면에 들어오고, 풀이는 한 번 누르면 바로 보인다.
// 저장은 기존 두 설정(showAnalysis, showBreakdown)을 그대로 쓴다 — 옛 저장값도 그대로 읽힌다.

export function analysisViewOf({ showAnalysis, showBreakdown }) {
    if (!showAnalysis) return 'hidden';
    return showBreakdown ? 'open' : 'folded';
}

// 다음 단계의 설정값. hidden → folded로 돌아올 때는 풀이를 접힌 상태로 되돌린다.
export function nextAnalysisView(current) {
    switch (analysisViewOf(current)) {
        case 'folded': return { showAnalysis: true, showBreakdown: true };
        case 'open': return { showAnalysis: false, showBreakdown: true };
        default: return { showAnalysis: true, showBreakdown: false };
    }
}
