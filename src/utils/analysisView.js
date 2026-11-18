// 번역/분석 표시 3단계 — 하단 눈 버튼과 키보드 B가 누를 때마다 이 순서로 돈다(2026-09).
//   folded(기본): 번역·분석 보임, 괄호 속 단어 풀이는 접힘(분석 칸 오른쪽 아래 화살표)
//   open        : 괄호 풀이까지 전부 펼침
//   hidden      : 번역·분석 전부 숨김(원문만)
// 접힘을 기본·첫 단계로 둔 이유: 휴대폰에서 문장 하나가 한 화면에 들어오고, 풀이는 한 번 누르면 바로 보인다.
// 저장은 기존 두 설정(showAnalysis, showBreakdown)을 그대로 쓴다 — 옛 저장값도 그대로 읽힌다.
//
// 가리기에서도 같은 버튼·같은 순서를 쓰되 뜻은 난이도 사다리다(2026-11-18 사용자 요청, '번역 보기'를 대체):
//   hidden: 빈칸 문장만 → folded: 문장 위에 번역 → open: 모든 카드의 정답·해설
// 가리기의 상태는 저장하지 않고 App이 따로 들고 있어, 일반 화면의 눈 상태를 건드리지 않는다.

// 가리기를 켜거나 새 문제가 나올 때의 시작점. open에서 시작하면 정답이 처음부터 다 보인다.
// showBreakdown이 true인 이유: 버튼으로 hidden에 오면 늘 이 값이다(문장을 눌러 연 해설은 풀이까지 펼쳐진다).
export const DRILL_VIEW_START = Object.freeze({ showAnalysis: false, showBreakdown: true });

const BUTTON_TEXT = {
    hidden: { title: '번역/분석 숨김 — 탭하면 다시 보기', label: '번역/분석 보기' },
    folded: { title: '단어 풀이 접힘 — 탭하면 풀이 펼치기', label: '단어 풀이 펼치기' },
    open: { title: '단어 풀이 펼침 — 탭하면 번역/분석 숨기기', label: '번역/분석 숨기기' },
};
const DRILL_BUTTON_TEXT = {
    hidden: { title: '문장만 — 탭하면 번역 보기', label: '번역 보기' },
    folded: { title: '번역 보임 — 탭하면 정답·해설 열기', label: '정답·해설 모두 열기' },
    open: { title: '정답·해설 열림 — 탭하면 문장만', label: '정답·해설 모두 가리기' },
};

// 하단 버튼의 안내 문구. 휴대폰에서는 누르면 말풍선으로 뜨므로 가리기에서는 가리기 뜻으로 보여 준다.
export function analysisButtonText(view, drillMode = false) {
    return (drillMode ? DRILL_BUTTON_TEXT : BUTTON_TEXT)[analysisViewOf(view)];
}

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
