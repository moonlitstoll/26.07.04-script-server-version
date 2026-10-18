// 상단 툴바의 팝오버(묶음·가리기·고치기) 계산 — 화면 없이 테스트할 수 있게 순수 함수로 둔다.

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

// '⋯ 고치기' 메뉴 항목. 편집 기능은 공부 중엔 거의 안 쓰므로 툴바에서 빼고 여기로 모았다.
// '빠진 대사 끝 다시 감지'는 예전 '대사만' 칩 안의 !N 배지(칩 안의 두 번째 탭 자리)를 옮긴 것 —
// 감지 중이거나 빠진 문장이 없으면 보이지 않는다.
export function fixMenuItems({ trashCount = 0, missingSpeechEnds = 0, speechBusy = false } = {}) {
  const items = [
    { id: 'select', label: '문장 골라서 고치기', hint: '다시 전사·분석·삭제·나누기·복구' },
    { id: 'trash', label: trashCount > 0 ? `휴지통 (${trashCount})` : '휴지통', hint: '지운 문장 되살리기' },
  ];
  if (missingSpeechEnds > 0 && !speechBusy) {
    items.push({ id: 'detectMissing', label: `빠진 대사 끝 다시 감지 (${missingSpeechEnds})`, hint: '그 문장들만 · 오디오 1회 전송' });
  }
  return items;
}
