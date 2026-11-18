// 상단 툴바의 팝오버(묶음·가리기)·고치기 줄 계산 — 화면 없이 테스트할 수 있게 순수 함수로 둔다.

// 팝오버의 왼쪽 좌표. 앵커(누른 칩) 기준으로 가운데(center) 또는 오른쪽 끝 맞춤(end)으로 놓고,
// 화면 밖으로 나가지 않게 좌우 여백(margin) 안으로 밀어 넣는다.
// 패널이 화면보다 넓으면 왼쪽 여백에 붙인다(오른쪽은 max-width가 막는다).
export function placePopoverLeft({ anchorLeft, anchorRight, width, viewport, align = 'center', margin = 8 }) {
  const want = align === 'end'
    ? anchorRight - width
    : align === 'start'
      ? anchorLeft
      : (anchorLeft + anchorRight) / 2 - width / 2;
  const max = viewport - margin - width;
  if (max < margin) return margin;
  return Math.min(Math.max(want, margin), max);
}

// 가리기 난이도 [저장값, 화면 이름] — 툴바 칩(지금 난이도 표시)과 팝오버가 같이 쓴다.
export const DRILL_LEVELS = [['easy', '초급'], ['mid', '중급'], ['hard', '고급'], ['recall', '회상']];

// 고치기 줄(문장 골라서 고치기) 오른쪽 끝에 '있을 때만' 붙는 버튼.
// 예전엔 툴바의 '⋯ 고치기' 메뉴에 [문장 골라서 고치기 / 휴지통 / 빠진 대사 끝 다시 감지]가 있었는데,
// 고치기를 두 번 눌러야 켜져서(사용자 2026-11-18) 툴바에는 고치기 버튼 하나만 두고 나머지를 이 줄로 옮겼다.
//  - 휴지통: 지운 문장이 있을 때만(비어 있으면 열어도 할 일이 없다). 지우는 곳과 되살리는 곳이 같은 줄.
//  - 빠진 대사: 대사 끝이 안 잡힌 문장이 있을 때만. 감지 중이면 숨긴다(두 번 누르기 방지).
//  - 문장을 하나라도 고른 동안은 둘 다 숨긴다. 둘은 '고른 문장'과 무관한 동작이고, 327px 폭에서
//    문장 1개를 고르면 '나누기'가 생겨 휴지통까지 두면 버튼 줄이 2줄 → 3줄(57 → 85px)로 늘었다(실측).
export function selectRowExtras({ trashCount = 0, missingSpeechEnds = 0, speechBusy = false, selectedCount = 0 } = {}) {
  const items = [];
  if (selectedCount > 0) return items;
  if (trashCount > 0) {
    items.push({ id: 'trash', label: `휴지통 ${trashCount}`, title: '지운 문장 되살리기' });
  }
  if (missingSpeechEnds > 0 && !speechBusy) {
    items.push({ id: 'detectMissing', label: `빠진 대사 ${missingSpeechEnds}`, title: '대사 끝이 안 잡힌 문장만 다시 감지 (오디오 1회 전송)' });
  }
  return items;
}
