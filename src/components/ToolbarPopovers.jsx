import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, Trash2, FastForward, Shuffle } from 'lucide-react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { placePopoverLeft, DRILL_LEVELS } from '../utils/toolbarMenu';
import { LOOP_GROUP_MIN, LOOP_GROUP_MAX } from '../utils/loopGroups';
import { RATE_MIN, RATE_MAX, RATE_PRESETS, stepRate, fmtRate } from '../utils/playbackRates';

// 상단 툴바 칩에서 여는 팝오버들(묶음 문장 수·가리기 난이도·고치기 메뉴).
// 툴바 안에 띄우면 안 되는 이유 두 가지:
//  ① 칩 행이 overflow-x-auto → absolute 팝오버가 행 높이에서 잘린다
//  ② 툴바 래퍼의 backdrop-blur가 fixed의 containing block이 돼 좌표가 툴바 기준으로 틀어진다
// → body 포털 + fixed로 띄우고, 앵커(누른 칩) 좌표는 열 때 한 번 계산해 받는다.
// 가로 위치는 그려진 패널 폭을 재서 정한다(재기 전 한 프레임은 숨김) — 상태 대신 DOM에 직접 쓴다.
// placement: 'below'(툴바 칩 — 칩 아래) | 'above'(플레이어 버튼 — 화면 바닥에 있으니 위로). above는 anchor.top이 필요하다.
const AnchoredPopover = ({ anchor, align = 'center', placement = 'below', label, onClose, className = '', children }) => {
  useEscapeToClose(onClose); // 조건부 마운트라 열려 있을 때만 ESC 스택에 올라간다
  const panelRef = useRef(null);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const left = placePopoverLeft({
      anchorLeft: anchor.left, anchorRight: anchor.right,
      width: el.offsetWidth, viewport: window.innerWidth || 360, align,
    });
    el.style.left = `${left}px`;
    el.style.visibility = 'visible';
  }, [anchor, align]);
  const vertical = placement === 'above'
    ? { bottom: (window.innerHeight || 800) - anchor.top + 6 }
    : { top: anchor.bottom + 6 };
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        className={`fixed z-[61] max-w-[calc(100vw-16px)] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg ${className}`}
        style={{ left: 0, ...vertical, visibility: 'hidden' }}
      >
        {children}
      </div>
    </>,
    document.body
  );
};

// 묶음 반복 문장 수 프리셋 — 숫자를 탭하면 −/+ 연타 없이 바로 고른다 (1↔20 왕복이 탭 1번).
const LOOP_PRESETS = [1, 2, 3, 5, 10, 15, 20];
const STEP_BTN = 'w-10 h-10 rounded-lg flex items-center justify-center text-lg font-black text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-50 dark:disabled:hover:bg-slate-900';

// 묶음: −/+ 한 칸씩(창 유지) + 프리셋(고르면 닫힘). 툴바 칩이 36px로 커지면서 −/+를 칩 안에 둘 자리가 없어 여기로 옮겼다.
export const LoopPopover = ({ anchor, current, onPick, onClose }) => (
  <AnchoredPopover anchor={anchor} label="묶음 문장 수" onClose={onClose} className="p-2">
    <div className="flex items-center justify-between gap-2 mb-2">
      <button
        onClick={() => onPick(current - 1)}
        disabled={current <= LOOP_GROUP_MIN}
        aria-label="묶음 문장 수 줄이기"
        className={STEP_BTN}
      >
        −
      </button>
      <span className="text-sm font-bold text-slate-600 dark:text-slate-300 tabular-nums">한 번에 {current}문장</span>
      <button
        onClick={() => onPick(current + 1)}
        disabled={current >= LOOP_GROUP_MAX}
        aria-label="묶음 문장 수 늘리기"
        className={STEP_BTN}
      >
        +
      </button>
    </div>
    <div className="flex flex-wrap justify-center items-center gap-1">
      {LOOP_PRESETS.map((v) => (
        <button
          key={v}
          onClick={() => { onPick(v); onClose(); }}
          aria-label={`묶음 ${v}문장`}
          className={`w-10 h-10 rounded-lg text-[13px] font-black tabular-nums transition-colors ${v === current ? 'bg-amber-500 text-white dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-amber-500' : 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-950/40'}`}
        >
          {v}
        </button>
      ))}
    </div>
  </AnchoredPopover>
);

// 가리기: 난이도 4단 + 새 문제. 예전엔 가리기를 켜면 이 5개가 툴바 한 줄에 붙어 칩이 10개가 됐다.
export const DrillPopover = ({ anchor, difficulty, onPickDifficulty, onNewRound, onClose }) => (
  <AnchoredPopover anchor={anchor} label="가리기 난이도" onClose={onClose} className="p-2">
    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {DRILL_LEVELS.map(([v, label]) => (
        <button
          key={v}
          onClick={() => { onPickDifficulty(v); onClose(); }}
          aria-pressed={difficulty === v}
          className={`min-w-14 h-10 px-2 text-[13px] font-bold transition-colors ${difficulty === v ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
        >
          {label}
        </button>
      ))}
    </div>
    <button
      onClick={() => { onNewRound(); onClose(); }}
      className="mt-2 w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-lg border text-[13px] font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700 transition-colors"
    >
      <Shuffle className="w-3.5 h-3.5" /> 새 문제
      <span className="font-normal text-xs text-slate-400 dark:text-slate-500">· 오답 표시도 지움</span>
    </button>
  </AnchoredPopover>
);

// 배속: 예전엔 0.5~2.0을 0.1 간격 16칸 격자로 다 깔았고(결정 지점에 16개), 스크롤 영역을 눌러야만 닫혔다.
// 지금은 자주 쓰는 6칸 + −/+ 0.1(창 유지), 다른 팝오버와 같은 틀이라 ESC·바깥 탭으로 닫힌다. 범위는 그대로 0.5~2.0.
export const SpeedPopover = ({ anchor, current, onPick, onClose }) => (
  <AnchoredPopover anchor={anchor} placement="above" align="start" label="재생 속도" onClose={onClose} className="p-2">
    <div className="flex items-center justify-between gap-2 mb-2">
      <button
        onClick={() => onPick(stepRate(current, -1))}
        disabled={current <= RATE_MIN}
        aria-label="배속 0.1 낮추기"
        className={STEP_BTN}
      >
        −
      </button>
      <span className="text-sm font-bold text-slate-600 dark:text-slate-300 tabular-nums">{fmtRate(current)}</span>
      <button
        onClick={() => onPick(stepRate(current, +1))}
        disabled={current >= RATE_MAX}
        aria-label="배속 0.1 높이기"
        className={STEP_BTN}
      >
        +
      </button>
    </div>
    <div className="flex items-center gap-1">
      {RATE_PRESETS.map((v) => (
        <button
          key={v}
          onClick={() => { onPick(v); onClose(); }}
          aria-label={`배속 ${fmtRate(v)}`}
          className={`w-11 h-10 rounded-lg text-[13px] font-black tabular-nums transition-colors ${Math.abs(v - current) < 0.001 ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950/40'}`}
        >
          {fmtRate(v).replace(/x$/, '')}
        </button>
      ))}
    </div>
  </AnchoredPopover>
);

const FIX_ICONS = { select: Wand2, trash: Trash2, detectMissing: FastForward };

// '⋯ 고치기' 메뉴 — 항목은 utils/toolbarMenu#fixMenuItems가 정한다.
export const FixMenuPopover = ({ anchor, items, onPick, onClose }) => (
  <AnchoredPopover anchor={anchor} align="end" label="고치기" onClose={onClose} className="w-64 p-1">
    {items.map((it) => {
      const Icon = FIX_ICONS[it.id];
      return (
        <button
          key={it.id}
          onClick={() => { onClose(); onPick(it.id); }}
          className="w-full min-h-11 flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          {Icon && <Icon className="w-4 h-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-700 dark:text-slate-300">{it.label}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{it.hint}</span>
          </span>
        </button>
      );
    })}
  </AnchoredPopover>
);
