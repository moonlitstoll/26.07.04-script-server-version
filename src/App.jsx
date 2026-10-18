import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  AlertCircle, RotateCcw, X, Check, Languages, Trash2, LifeBuoy, EyeOff, AlertTriangle, Repeat, FastForward, Loader2, Scissors, ChevronDown, MoreHorizontal
} from 'lucide-react';
import { clampLoopGroupSize, slidingGroupBounds } from './utils/loopGroups';
import { fixMenuItems, DRILL_LEVELS } from './utils/toolbarMenu';
import { validSpeechEnd } from './utils/speechSegments';
import { speechEndMissingSet } from './utils/speechEndMerge';
import { nextAnalysisView } from './utils/analysisView';

// 상단 툴바 칩 공통 크기 — 높이 24px(h-6) 고정, 글자·간격만 min(Nvw, 최대px).
// 툴바는 대본이 한 줄이라도 더 보이게 최대한 얇게 둔다(사용자 결정 2026-10-18: 누르기 편함보다 대본 면적).
// 한때 36px로 키웠다가 툴바가 31→45px로 두꺼워져 되돌렸다. 지금 툴바 전체 ≈29px(칩 24 + 위아래 2 + 선 1).
// 보이는 칩을 가리기·묶음·대사만·오답 4개로 줄이고 편집 기능은 '⋯ 고치기' 메뉴로 옮겨
// 390px 폭에서 가리기를 켜도 한 줄에 들어온다. 그보다 좁은 화면만 가로 스와이프(⋯ 버튼은 늘 보임).
// 아이콘은 lucide size 대신 클래스로 지정(SVG 속성보다 CSS가 우선).
const CHIP_BASE = 'shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-[min(0.9vw,4px)] px-[min(1.6vw,6px)] text-[min(3.1vw,13px)] font-bold transition-colors';
const CHIP = `${CHIP_BASE} h-6 rounded-lg border`;
// 선택 모드 줄 버튼도 같은 높이 — 모드를 바꿔도 툴바 높이가 안 튄다
const SEL_BTN = 'shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-lg text-xs font-bold';
const CHIP_ICON = 'w-[min(3.4vw,14px)] h-[min(3.4vw,14px)] shrink-0';
// 칩을 눌렀을 때 팝오버 앵커로 쓸 좌표(열 때 1회 스냅샷)
const anchorOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; };

// 분석 진행 띠의 글 — 지난 시간과 '지금 뭘 하는지'(재시도·자동 교정). 숫자만 있으면 묶음 하나가 재시도 중일 때
// 몇 분씩 멈춘 것처럼 보여 사용자가 고장으로 오해했다(2026-10-18 휴대폰 보고: 230/255에서 한참 그대로).
const Stage2ProgressText = ({ progress }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.floor((now - (progress.startedAt || now)) / 1000));
  const elapsed = sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
  return (
    <span className="flex-1 min-w-0 truncate font-medium">
      분석 중… {progress.done}/{progress.total} · {elapsed}
      {progress.note && <span className="ml-2 font-normal opacity-80">{progress.note}</span>}
    </span>
  );
};

import { useSettings } from './hooks/useSettings';
import { useTheme } from './hooks/useTheme';
import { useMediaAnalysis } from './hooks/useMediaAnalysis';
import { useMediaCache } from './hooks/useMediaCache';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useFavorites } from './hooks/useFavorites';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useLearningProgress } from './hooks/useLearningProgress';

// Components
import ErrorBoundary from './components/ErrorBoundary';
import TranscriptItem from './components/TranscriptItem';
import SettingsModal from './components/SettingsModal';
import CacheHistoryModal from './components/CacheHistoryModal';
import PlayerControls from './components/PlayerControls';
import EmptyState from './components/EmptyState';
import ConfirmModal from './components/ConfirmModal';
import Toast from './components/Toast';
import PassphraseGate from './components/PassphraseGate';
import WorkspaceHeader from './components/WorkspaceHeader';
import NoActiveFile from './components/NoActiveFile';
import ShortcutsHelp from './components/ShortcutsHelp';
import TrashModal from './components/TrashModal';
import { LoopPopover, DrillPopover, FixMenuPopover } from './components/ToolbarPopovers';
import { RetranscribeDialog, SplitDialog, SpeechEndDialog } from './components/SentenceEditDialogs';
import { getPassphrase, setPassphrase as persistPassphrase, CLOUD_ENABLED } from './services/cloudSync';
import { getLastPos, setLastPos } from './utils/viewPosition';
import { mediaStore } from './utils/MediaStore';
import { getTrash, clearTrash } from './utils/trashUtils';
import { parseCacheEntry, isCacheStale } from './utils/cacheUtils';


const App = () => {
  const { config, updateField } = useSettings();
  // 라이트/다크: 설정값을 <html>의 dark 클래스로 반영(시스템 모드면 기기 설정 변화도 따라감)
  useTheme(config.theme);

  // 기기 간 동기화용 비밀 암호
  const [passphrase, setPassphraseState] = useState(() => getPassphrase());
  const { apiKey, stage1Model, stage2Model, stage3Model, bufferTime, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, realignEnabled } = config;

  // Multi-file state
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  // 미디어 자가 복구 콜백이 최신 값을 stale closure 없이 읽기 위한 거울 ref
  const filesRef = useRef(files);
  const activeFileIdRef = useRef(activeFileId);
  useEffect(() => { filesRef.current = files; activeFileIdRef.current = activeFileId; });

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  // 번역/분석 표시 — config에 있어 마지막 설정이 유지된다(miniapp_show_analysis).
  // setter 모양을 유지해 PlayerControls 등 기존 호출부를 그대로 둔다. updateField가
  // 안정 참조(useCallback [])라 이 래퍼도 안정적 → memo된 카드가 재생 틱마다 리렌더되지 않는다.
  const showAnalysis = config.showAnalysis;
  const setShowAnalysis = useCallback((v) => updateField('showAnalysis', v), [updateField]);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showCacheHistory, setShowCacheHistory] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSwitchingFile, setIsSwitchingFile] = useState(false);

  // 구간 선택 재전사 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIdxs, setSelectedIdxs] = useState(() => new Set());
  // 삭제 문장 휴지통
  const [showTrash, setShowTrash] = useState(false);
  const [trashNonce, setTrashNonce] = useState(0);
  const [confirmState, setConfirmState] = useState(null);
  const [toastState, setToastState] = useState(null);

  const showConfirm = useCallback((opts) => setConfirmState(opts), []);
  // 토스트 자리는 하나. '실행취소' 버튼이 달린 토스트가 떠 있는 동안 뒤따르는 보통 안내(재분석 시작 등)가
  // 그걸 덮어 실행취소 기회가 사라졌다 → 버튼 달린 토스트는 오류 안내에만 밀린다.
  const showToast = useCallback((opts) => setToastState(prev =>
    (prev?.action && !opts?.action && opts?.type !== 'error') ? prev : opts
  ), []);

  // 보관함 잠그기: 이 기기에 저장된 암호를 지우고 암호 입력창으로 복귀 (클라우드 대본은 보존)
  const lockVault = useCallback(() => {
    showConfirm({
      message: "보관함을 잠글까요? 이 기기에 저장된 암호가 지워지고 암호 입력창으로 돌아갑니다. (클라우드에 저장된 대본은 지워지지 않습니다)",
      onConfirm: () => {
        persistPassphrase('');
        setPassphraseState('');
        setShowSettings(false);
      },
    });
  }, [showConfirm]);

  // 분석의 괄호 속 단어 풀이 전체 펼침/접힘(기본 접힘). 카드의 분석 칸을 탭하면 그 카드만 뒤집힌다.
  const showBreakdown = config.showBreakdown;
  // 하단 눈 버튼·키보드 B: 접힘 → 펼침 → 숨김 → 접힘 3단계 순환(utils/analysisView).
  // 두 설정을 함께 읽어야 해서 최신값을 ref로 본다 — 값을 deps에 넣으면 콜백 참조가 바뀌어
  // memo된 TranscriptItem이 재생 틱마다 리렌더된다(토글 콜백의 안정 참조 규칙과 같은 이유).
  const analysisViewRef = useRef({ showAnalysis, showBreakdown });
  useEffect(() => { analysisViewRef.current = { showAnalysis, showBreakdown }; }, [showAnalysis, showBreakdown]);
  const toggleGlobalAnalysis = useCallback(() => {
    const next = nextAnalysisView(analysisViewRef.current);
    analysisViewRef.current = next; // 연타해도 한 단계씩 넘어가게
    updateField('showBreakdown', next.showBreakdown);
    updateField('showAnalysis', next.showAnalysis);
  }, [updateField]);
  const stage2AbortRef = useRef(null);
  // 현재 Stage 2가 돌고 있는 파일: Map<fileId, 실행중인 개수>.
  // 왜 필요한가: loadCache는 미분석 문장이 남아 있으면 Stage 2를 새로 시작하는데,
  // runStage2는 첫 줄에서 기존 실행을 abort한다 → 분석 중인 대본을 목록에서 다시 탭하면
  // 진행 중이던 요청이 죽고 마지막 저장 지점부터 다시 돈다(중복 API 비용).
  // f.isAnalyzing으로는 판별할 수 없다 — 그 값은 '전사(Stage 1) 중'만 true이고
  // Stage 2가 시작되기 전에 이미 false로 내려간다.
  // 개수(Map)로 세는 이유: 같은 파일에 재분석 등이 겹쳐 돌 때 안쪽 실행이 끝나면서
  // 바깥 실행의 표시까지 지워버리는 것을 막기 위함.
  const stage2ActiveRef = useRef(new Map());

  // ─── [자가 복구] 재생 링크가 죽었을 때 저장소 원본으로 되살리기 ───
  // blob URL은 '업로드 때 고른 파일'을 가리키는 임시 링크라, 모바일에서 메모리 회수·백그라운드
  // 복귀 후 무효가 되는 일이 잦다. 무효가 돼도 문자열은 남아 화면엔 검은 영상만 뜨고 재생이 안 된다.
  // → 미디어 요소가 error를 내면 IndexedDB 원본으로 새 주소를 만들어 갈아끼운다.
  // 파일당 최대 2회까지만 시도한다 — 복구한 주소가 또 죽으면 원본 자체 문제이므로,
  // error→복구→error 무한 루프에 빠지지 않게 상한을 둔다.
  const mediaRecoverRef = useRef(new Map());
  const handleMediaError = useCallback(async () => {
    const f = filesRef.current.find(x => x.id === activeFileIdRef.current);
    if (!f?.file?.name) return;
    const key = `${f.file.name}_${f.file.size}`;
    const tries = mediaRecoverRef.current.get(key) || 0;
    if (tries >= 2) return;
    mediaRecoverRef.current.set(key, tries + 1);
    try {
      const blob = await mediaStore.getFileFlexible(f.file.name, f.file.size);
      if (!blob || !blob.size) {
        showToast({ message: '영상을 읽을 수 없어요. 하단 "연결하기"로 원본 파일을 다시 선택해 주세요.', type: 'error', duration: 7000 });
        return;
      }
      const fresh = URL.createObjectURL(blob);
      setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, url: fresh } : x)));
      console.log('[MediaRecover] 재생 링크가 끊겨 저장소 원본으로 재연결했습니다.');
    } catch (e) {
      console.warn('[MediaRecover] 복구 실패:', e);
      showToast({ message: '영상을 읽을 수 없어요. 하단 "연결하기"로 원본 파일을 다시 선택해 주세요.', type: 'error', duration: 7000 });
    }
  }, [showToast]);

  // Derived active file
  const activeFile = files.find(f => f.id === activeFileId);
  const transcriptData = useMemo(() => activeFile?.data || [], [activeFile?.data]);
  const mediaUrl = activeFile?.url || null;
  const isAnalyzing = activeFile?.isAnalyzing || false;
  // 분석/전환 중이 아니라 본문 콘텐츠를 보여줄 준비가 됐는지 (배너·툴바 게이팅 공통 조건)
  const contentReady = !isAnalyzing && !isSwitchingFile;
  // 툴바(가리기·묶음·대사만·오답·⋯)를 그릴 수 있는 상태인가 — 실제로 보이는지는 toolbarOpen/selectMode
  const toolbarAvailable = !!activeFile && contentReady && !activeFile.error && transcriptData.length > 0;

  // [캐시 버저닝] 활성 파일의 분석이 옛 규칙(낮은 version)으로 만들어졌는지 판정 → 재분석 권장 배너.
  //  분석 진행 정도(analyzedCount)가 바뀔 때만 캐시 메타를 다시 읽어 반응(재분석하면 배너 사라짐).
  const analyzedCount = transcriptData.filter(d => d.isAnalyzed).length;
  const isStaleAnalysis = useMemo(() => {
    if (!activeFile?.file?.name || transcriptData.length === 0) return false;
    if (analyzedCount === 0) return false; // 아직 분석 전이면 배너 불필요
    const key = `gemini_analysis_${activeFile.file.name}_${activeFile.file.size}`;
    const meta = parseCacheEntry(key)?.metadata;
    return meta ? isCacheStale(meta) : false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.id, analyzedCount, transcriptData.length]);

  // [자동 업데이트] 배포된 새 번들 감지 → 새로고침 안내 배너
  const updateReady = useAppUpdate();

  // ─── 가리기 학습(클로즈) + 오답 복습 ───
  // [주의] mistakeOnly는 useAudioPlayer보다 먼저 선언돼야 한다 — 아래 effLoopN이 이걸 읽는다.
  const [drillMode, setDrillMode] = useState(false);
  // 난이도·회차는 config에 있어 새로고침/앱 재시작 후에도 유지된다.
  // (가리기 모드 on/off는 일부러 휘발로 둔다 — '고급/회상'으로 저장된 채 켜져 열리면
  //  문장이 통째로 가려져 '대본이 안 보인다'가 되기 때문. 난이도 선택기는 drillMode일 때만
  //  렌더되므로, 저장된 난이도는 사용자가 가리기를 켤 때 칩 하이라이트로 바로 보인다.)
  const difficulty = config.difficulty;  // 'easy' | 'mid' | 'hard' | 'recall'(번역 단서→원어 산출)
  const drillRound = config.drillRound;  // '새 문제' 누를 때마다 +1 → 시드 변경(껐다 켜도 유지)
  const [mistakeOnly, setMistakeOnly] = useState(false);
  const prevLoopRef = useRef(false);                     // 오답 모드 진입 전 반복 상태 (복원용)

  // 오답 복습 중에는 묶음 반복을 강제로 1문장으로 낮춘다.
  // 오답 아닌 문장은 화면에서 아예 빠지는데(788행), 묶음 반복은 그 문장의 '소리'를 재생해버린다
  // → 오답 모드의 존재 이유(숨긴 문장 소리 안 새게)와 정면충돌. 설정값은 보존되고, 모드를 나가면 복구된다.
  const effLoopN = mistakeOnly ? 1 : clampLoopGroupSize(config.loopGroupSize);

  // Hooks
  const {
    videoRef, attachVideo, activeSentenceIdx, currentTime, duration, playbackRate, isGlobalLoopActive, isPlaying,
    manualScrollNonce, handleRateChange, seekTo, togglePlay, toggleLoop, setLoopActive, jumpToSentence,
    handlePrev, handleNext, resetPlayerState, activeIdxRef, lastActionTimeRef, restoreTo,
    loopAnchorIdx, loopTargetIdxRef
  } = useAudioPlayer({ activeFile, bufferTime, loopGroupSize: effLoopN, speechOnly: !!config.speechOnlyEnabled, speechTailPad: config.speechTailPad });

  // 묶음 크기 변경: 2 이상을 고르면 반복을 자동으로 켠다(안 켜면 "골랐는데 아무 일도 안 남"이 된다).
  const changeLoopGroupSize = useCallback((n) => {
    const v = clampLoopGroupSize(n);
    updateField('loopGroupSize', v);
    if (v > 1) setLoopActive(true);
  }, [updateField, setLoopActive]);

  // 툴바 팝오버(한 번에 하나): null=닫힘, { kind: 'loop'|'drill'|'fix', anchor: 누른 칩 좌표(열 때 1회 스냅샷) }
  const [toolbarPopover, setToolbarPopover] = useState(null);
  const closeToolbarPopover = useCallback(() => setToolbarPopover(null), []);
  // 툴바(칩 줄)는 평소 숨김 — 제목 줄 버튼으로 연다(사용자 결정: 작은 화면에 대본 한 줄이라도 더).
  // 일부러 저장하지 않는다: 한 번 열어 두고 잊으면 '평소 숨김'이 깨진다. 앱을 새로 열면 다시 숨김.
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const toggleToolbar = useCallback(() => setToolbarOpen(o => !o), []);

  // [대사만 재생] 이 파일에 대사 끝 시각(speechEnd) 데이터가 하나라도 있는가
  // (없으면 칩 탭 = 감지 실행, 있으면 칩 탭 = 켜기/끄기 토글. 엔진은 문장별로 알아서 폴백)
  const hasSpeechEnds = useMemo(
    () => transcriptData.some(d => typeof d.speechEnd === 'number'),
    [transcriptData]
  );
  // 유효한 감지값이 없는 문장 수 — 칩 배지(!N)로 표시, 탭하면 그 문장들만 재감지
  // speechEndSkipped(이미 시도했으나 모델이 판단 못 한 구간)는 제외 — 안 그러면 배지가 영원히 안 사라진다
  // 카드의 '대사 끝 없음' 배지(판단 불가 + 미감지, 블록 기준) — 탭하면 그 문장 직접 맞추기 창
  const speechEndMissingIdxs = useMemo(() => speechEndMissingSet(transcriptData, duration), [transcriptData, duration]);
  const missingSpeechEnds = useMemo(
    () => (hasSpeechEnds ? transcriptData.filter(d => validSpeechEnd(d) === null && !d.speechEndSkipped).length : 0),
    [transcriptData, hasSpeechEnds]
  );

  // 지금 반복 중인 묶음의 범위 (카드 띠 표시용). 묶음 반복이 꺼져 있으면 null.
  // 엔진·←/→와 같은 slidingGroupBounds를 쓰므로 띠와 실제 반복 구간이 어긋날 수 없다.
  const loopGroup = useMemo(() => {
    if (!isGlobalLoopActive || effLoopN <= 1 || loopAnchorIdx < 0 || loopAnchorIdx >= transcriptData.length) return null;
    return slidingGroupBounds(transcriptData, loopAnchorIdx, effLoopN);
  }, [isGlobalLoopActive, effLoopN, loopAnchorIdx, transcriptData]);

  const learnFileKey = activeFile?.file ? `${activeFile.file.name}_${activeFile.file.size}` : null;
  const { mark: markProgress, wrongIndices, isWrong, clearFile: clearLearnProgress } = useLearningProgress(learnFileKey, transcriptData);

  // 묶음 반복 중이면 ←/→는 '묶음 단위'로 움직인다(다음/이전 묶음의 첫 문장으로).
  // 기준은 반드시 앵커(loopTargetIdxRef, 동기 ref) — 하이라이트(activeSentenceIdx)를 쓰면
  // 묶음 [10~14]에서 12번을 듣던 중 →를 눌렀을 때 17로 튀어 15·16이 통째로 스킵된다.
  // 반환값 true = 묶음 이동을 처리했음(문장 단위 이동을 하지 말 것).
  const stepLoopGroup = useCallback((dir, cur) => {
    if (!isGlobalLoopActive || effLoopN <= 1 || transcriptData.length === 0) return false;
    const anchor = loopTargetIdxRef.current;
    const base = (typeof anchor === 'number' && anchor >= 0 && anchor < transcriptData.length)
      ? anchor
      : (cur >= 0 && cur < transcriptData.length ? cur : 0);
    const g = slidingGroupBounds(transcriptData, base, effLoopN);
    if (!g) return false;
    let target;
    if (dir > 0) {
      // 다음 묶음 = 지금 묶음 끝의 다음 문장부터. 대본 끝이면 처음으로 순환.
      target = g.end + 1 < transcriptData.length ? g.end + 1 : 0;
    } else if (g.start > 0) {
      // 이전 묶음 = 지금 묶음 시작에서 N문장 앞. (형제 블록에 걸리면
      // slidingGroupBounds가 알아서 블록 시작으로 당기므로 그대로 점프해도 안전)
      target = Math.max(0, g.start - effLoopN);
    } else {
      // 첫 묶음에서 ← = 마지막 묶음(대본 끝에서 N문장 앞)으로 순환
      target = Math.max(0, transcriptData.length - effLoopN);
    }
    jumpToSentence(target);
    return true;
  }, [isGlobalLoopActive, effLoopN, transcriptData, loopTargetIdxRef, jumpToSentence]);

  // [함정 #1] 화면은 걸러진 목록이지만 점프는 '원래 문장 번호'로. wrongIndices(원래 인덱스)를 그대로 사용.
  // [함정 #4] 반복 재조준은 jumpToSentence가 loopTargetIdxRef를 갱신하므로 자동 해결.
  const goNext = useCallback((fromArg) => {
    const cur = (typeof fromArg === 'number' && fromArg >= 0) ? fromArg : (activeIdxRef.current ?? -1);
    if (mistakeOnly) {
      if (wrongIndices.length === 0) return;
      if (cur < 0) { jumpToSentence(wrongIndices[0]); return; } // [함정 #6] 미재생 → 첫 오답
      const nx = wrongIndices.find(w => w > cur);
      jumpToSentence(nx !== undefined ? nx : wrongIndices[0]); // 없으면 순환(첫 오답)
    } else {
      if (transcriptData.length === 0) return;
      if (stepLoopGroup(1, cur)) return;                        // 묶음 반복 중 → 다음 묶음
      if (cur < 0) { jumpToSentence(0); return; }               // [함정 #6] 미재생 → 첫 문장(건너뜀 방지)
      handleNext(cur);
    }
  }, [mistakeOnly, wrongIndices, jumpToSentence, handleNext, activeIdxRef, transcriptData.length, stepLoopGroup]);

  const goPrev = useCallback((fromArg) => {
    const cur = (typeof fromArg === 'number' && fromArg >= 0) ? fromArg : (activeIdxRef.current ?? -1);
    if (mistakeOnly) {
      if (wrongIndices.length === 0) return;
      if (cur < 0) { jumpToSentence(wrongIndices[0]); return; } // 미재생 → 첫 오답
      let prev;
      for (let i = wrongIndices.length - 1; i >= 0; i--) { if (wrongIndices[i] < cur) { prev = wrongIndices[i]; break; } }
      jumpToSentence(prev !== undefined ? prev : wrongIndices[wrongIndices.length - 1]); // 없으면 순환(마지막 오답)
    } else {
      if (transcriptData.length === 0) return;
      if (stepLoopGroup(-1, cur)) return;                       // 묶음 반복 중 → 이전 묶음
      if (cur < 0) { jumpToSentence(0); return; }               // 미재생 → 첫 문장
      handlePrev(cur);
    }
  }, [mistakeOnly, wrongIndices, jumpToSentence, handlePrev, activeIdxRef, transcriptData.length, stepLoopGroup]);

  // 정답 후 자가표시 저장. 오답 모드에서 '알았음'이면 목록서 빠지므로 다음 오답으로 이동.
  // [함정 #5/#11] goNext(stale wrongIndices)로 자기 자신에 점프하는 문제 → idx 제외한 remaining으로 직접 계산.
  const markAnswer = useCallback((idx, known) => {
    markProgress(transcriptData[idx], known);
    if (known && mistakeOnly) {
      const remaining = wrongIndices.filter(w => w !== idx);
      if (remaining.length) {
        const nx = remaining.find(w => w > idx);
        jumpToSentence(nx !== undefined ? nx : remaining[0]);
      }
      // 남은 오답 없으면 점프하지 않음 → 정복 화면이 조용히 뜸
    }
  }, [markProgress, transcriptData, mistakeOnly, wrongIndices, jumpToSentence]);

  const toggleMistakeOnly = useCallback(() => {
    if (!mistakeOnly) {
      prevLoopRef.current = isGlobalLoopActive; // 진입 전 반복 상태 기억
      setMistakeOnly(true);
    } else {
      setMistakeOnly(false);
      setLoopActive(prevLoopRef.current);       // 이탈 시 원래 반복 상태 복원
    }
  }, [mistakeOnly, isGlobalLoopActive, setLoopActive]);

  // 오답 모드 동안 반복 강제 ON → 소리가 숨긴(오답 아닌) 문장으로 새지 않게.
  useEffect(() => {
    if (mistakeOnly && !isGlobalLoopActive) setLoopActive(true);
  }, [mistakeOnly, isGlobalLoopActive, setLoopActive]);

  // [함정 #2] 오답 모드 진입 시 현재 위치가 오답이 아니면 '절대 최근접' 오답으로 스냅 (진입 시 1회).
  useEffect(() => {
    if (!mistakeOnly || wrongIndices.length === 0) return;
    const cur = activeIdxRef.current ?? -1;
    if (!wrongIndices.includes(cur)) {
      const target = cur < 0
        ? wrongIndices[0]
        : wrongIndices.reduce((best, w) => Math.abs(w - cur) < Math.abs(best - cur) ? w : best, wrongIndices[0]);
      // [회귀방지] 일시정지 상태를 존중 — 자동 재생 없이 커서/하이라이트만 이동 (restoreTo).
      restoreTo(target, transcriptData[target]?.seconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mistakeOnly]);

  // [함정 #3/#9] 파일 전환 시 오답 모드 해제 + 반복 복원 (새 파일의 가짜 정복 화면/데드락 방지).
  useEffect(() => {
    if (mistakeOnly) {
      setMistakeOnly(false);
      setLoopActive(prevLoopRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId]);

  // [함정 #8] 잠금화면/알림(MediaSession)의 이전·다음도 화면 ◀▶와 같은 goPrev/goNext(오답 모드·묶음 반복 인식).
  // 등록은 여기 한 곳, 한 번만 — 핸들러는 ref로 최신 함수를 부른다. 예전엔 useAudioPlayer도 따로 등록해
  // 대본이 바뀔 때마다(분석 배치·편집) 그쪽이 다시 덮어써, 잠금화면 버튼만 오답·묶음을 무시했다.
  // 알림 버튼 탭은 사용자 제스처라 백그라운드에서도 seek+play가 정상 동작한다.
  const goPrevRef = useRef(goPrev);
  const goNextRef = useRef(goNext);
  useEffect(() => { goPrevRef.current = goPrev; goNextRef.current = goNext; }, [goPrev, goNext]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, h) => { try { ms.setActionHandler(a, h); } catch { /* 미지원 무시 */ } };
    set('previoustrack', () => goPrevRef.current());
    set('nexttrack', () => goNextRef.current());
    return () => { set('previoustrack', null); set('nexttrack', null); };
  }, []);

  // 대본 스크롤 컨테이너 (위치 저장/복원용)
  const scrollContainerRef = useRef(null);
  const restoredForRef = useRef(null);   // 위치 복원을 이미 처리한 activeFile.id
  const scrollRafRef = useRef(0);
  const activeFileRef = useRef(activeFile);
  // 렌더 직후 동기화(이벤트 핸들러가 최신 activeFile을 보도록) — 전환 시 지연 방지
  useLayoutEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  const refreshCacheKeysRef = useRef(null);

  // 감지 완료 안내의 [그 문장 보기] — 훅보다 아래에서 정의되는 선택 상태를 쓰므로 ref로 넘긴다
  const revealSentenceRef = useRef(null);
  const { isDragging, onDragOver, onDragLeave, onDrop, processFiles, runStage2, retryAnalysis, retranscribeSentences, retranscribeRange, splitSentence, setSpeechEndManual, reanalyzeSentences, recoverGap, deleteSentences, restoreSentences, cancelStage1, stage2Progress, detectSpeechEndsForFile, speechDetectBusy } = useMediaAnalysis({
    setFiles, setActiveFileId, setIsSwitchingFile, resetPlayerState,
    refreshCacheKeys: () => refreshCacheKeysRef.current && refreshCacheKeysRef.current(),
    apiKey, claudeApiKey: config.claudeApiKey, stage1Model, stage2Model, stage3Model, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, realignEnabled, speechAutoDetect: config.speechAutoDetect, stage2AbortRef, stage2ActiveRef, filesRef,
    showToast,
    onTrashChange: () => setTrashNonce(n => n + 1),
    onRevealSentence: (fileId, idx) => revealSentenceRef.current && revealSentenceRef.current(fileId, idx),
  });

  // [회귀방지] TranscriptItem(memo)에 넘길 콜백을 안정화 — 재생 중 currentTime 틱마다
  // 인라인 함수가 새로 생겨 모든 문장 카드가 리렌더되던 문제 방지. reanalyzeSentences는
  // 매 렌더 새 신원일 수 있어 ref로 최신값을 참조하고, 콜백 자체는 activeFileId에만 의존.
  const reanalyzeRef = useRef(reanalyzeSentences);
  useEffect(() => { reanalyzeRef.current = reanalyzeSentences; });
  const handleRetryOne = useCallback((i) => reanalyzeRef.current(activeFileId, [i]), [activeFileId]);

  // [정확도 배지] 커버리지 위반(A1)·전사의심(B3) 배지 탭 → 확인창 후 그 문장만 재처리.
  // 확인창을 거치는 이유: 배지는 헤더에 상시 노출이라 오탭 한 번이 곧 API 호출(비용)이기 때문.
  const retranscribeRef = useRef(retranscribeSentences);
  useEffect(() => { retranscribeRef.current = retranscribeSentences; });
  const handleCoverageRetry = useCallback((i) => {
    showConfirm({
      message: '이 문장만 다시 분석할까요? (문장 1개 분석 비용이 발생합니다)',
      confirmText: '재분석',
      danger: false,
      onConfirm: () => reanalyzeRef.current(activeFileId, [i]),
    });
  }, [activeFileId, showConfirm]);
  const handleRetranscribeOne = useCallback((i) => {
    showConfirm({
      message: '이 문장 구간의 오디오만 다시 전사할까요? (구간 오디오 전송 비용이 발생하고, 해당 구간이 새 전사 결과로 교체된 뒤 자동 재분석됩니다)',
      confirmText: '다시 전사',
      danger: false,
      onConfirm: () => retranscribeRef.current(activeFileId, [i]),
    });
  }, [activeFileId, showConfirm]);

  // [대사만 재생] 칩 동작: 감지 데이터 없으면 확인창 → 감지 1회 실행(성공 시 자동 켜기),
  // 있으면 켜기/끄기 토글만 (감지 결과는 캐시에 저장돼 있어 추가 비용 0).
  const handleSpeechOnlyChip = () => {
    if (speechDetectBusy) return;
    if (!hasSpeechEnds) {
      showConfirm({
        message: '대사 구간을 감지할까요? 오디오를 한 번 보내 문장마다 대사가 끝나는 시각을 알아냅니다. (전사 1회와 비슷한 비용 · 결과는 저장되어 계속 재사용)',
        confirmText: '감지 시작',
        danger: false,
        onConfirm: async () => {
          const ok = await detectSpeechEndsForFile(activeFileId);
          if (ok) updateField('speechOnlyEnabled', true);
        },
      });
      return;
    }
    updateField('speechOnlyEnabled', !config.speechOnlyEnabled);
  };

  // 미감지 문장만 재감지 (이미 감지된 문장은 안 건드림 — 부분 실패의 저비용 복구 경로)
  const handleDetectMissing = () => {
    if (speechDetectBusy) return;
    showConfirm({
      message: `아직 감지 안 된 ${missingSpeechEnds}개 문장만 다시 감지할까요? (이미 감지된 문장은 그대로 유지되고, 오디오 1회 전송 비용이 듭니다)`,
      confirmText: '재감지',
      danger: false,
      onConfirm: () => detectSpeechEndsForFile(activeFileId, { onlyMissing: true }),
    });
  };

  const { cacheKeys, deleteLocal, deleteServer, clearLocalCache,
    loadCache, refreshCacheKeys, cloudItems, cloudStatus, refreshCloud, loadCloud, localVideoIds, cloudDownload } = useMediaCache({
    files, setFiles, setActiveFileId, setShowSettings, setShowCacheHistory, setIsSwitchingFile,
    resetPlayerState, runStage2, apiKey, stage2Model, stage2AbortRef, stage2ActiveRef, filesRef, showConfirm, showToast
  });

  // 즐겨찾기 (기기 간 동기화)
  const { isFavorite, toggleFavorite } = useFavorites(passphrase);

  // 구간 선택 재전사: 문장 선택 토글 (memo된 TranscriptItem용 안정 핸들러)
  const toggleSelectIdx = useCallback((idx) => {
    setSelectedIdxs(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIdxs(new Set());
  }, []);

  // 파일이 바뀌면 선택 모드 해제 (렌더 중 상태 조정 — React 권장 패턴, 효과 아님)
  const [prevActiveIdForSelect, setPrevActiveIdForSelect] = useState(activeFileId);
  if (prevActiveIdForSelect !== activeFileId) {
    setPrevActiveIdForSelect(activeFileId);
    if (selectMode) setSelectMode(false);
    if (selectedIdxs.size > 0) setSelectedIdxs(new Set());
  }

  // 선택 구간 전사부터 다시 (Phase 1 + Phase 2). 설정의 Stage 3 모델 사용.
  // 확인창에서 '문장별로 다시'(기존, 기본값)와 '한 구간으로 다시'(시각 조정·미리 듣기) 중 고른다.
  // editDialog: null | { kind: 'retranscribe', fileId, idxs:Set } | { kind: 'split' | 'speechEnd', fileId, idx }
  const [editDialog, setEditDialog] = useState(null);
  const confirmRetranscribe = () => {
    if (!activeFile || selectedIdxs.size === 0) return;
    setEditDialog({ kind: 'retranscribe', fileId: activeFile.id, idxs: new Set(selectedIdxs) });
  };
  // 문장 나누기(일부 삭제) — 문장 1개를 골랐을 때만
  const confirmSplit = () => {
    if (!activeFile || selectedIdxs.size !== 1) return;
    setEditDialog({ kind: 'split', fileId: activeFile.id, idx: [...selectedIdxs][0] });
  };
  // 카드의 '대사 끝 없음' 배지 → 그 문장의 '대사 끝 맞추기' 창 (선택 모드를 거치지 않는다)
  const handleSpeechEndFix = useCallback((i) => {
    if (speechDetectBusy) return; // 감지 중엔 결과가 덮어쓸 수 있어 막는다(선택 모드 '대사만'과 같은 규칙)
    setEditDialog({ kind: 'speechEnd', fileId: activeFileId, idx: i });
  }, [activeFileId, speechDetectBusy]);
  // 감지 완료 안내의 [그 문장 보기]: 그 문장으로 이동하고 선택해 둔다 → 바로 '대사만'으로 직접 맞추기
  useEffect(() => {
    revealSentenceRef.current = (fileId, idx) => {
      if (activeFileRef.current?.id !== fileId || !activeFileRef.current?.data?.[idx]) return; // 그사이 다른 영상으로 옮겼으면 무시
      setSelectMode(true);
      setSelectedIdxs(new Set([idx]));
      jumpToSentence(idx);
    };
  });
  // 미리 듣기 전에 본 플레이어를 멈춘다(소리 겹침 방지)
  const pauseMainPlayer = useCallback(() => {
    const v = videoRef.current;
    if (v && !v.paused) togglePlay();
  }, [videoRef, togglePlay]);

  // 휴지통(삭제 문장) — 현재 파일 기준 (원시값 의존으로 컴파일러 경고 회피)
  const trashName = activeFile?.file?.name || '';
  const trashSize = activeFile?.file?.size || 0;
  const trashItems = useMemo(
    () => (trashName ? getTrash(trashName, trashSize) : []),
    // trashNonce: 삭제/복구 후 localStorage 재조회를 강제하는 트리거(의도된 의존)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trashName, trashSize, trashNonce]
  );

  const handleTrashRestore = (items) => {
    if (!activeFile) return;
    restoreSentences(activeFile.id, items);
  };

  const handleTrashClear = () => {
    if (!activeFile?.file?.name) return;
    showConfirm({
      message: '휴지통을 비울까요? 보관된 삭제 문장들이 영구 삭제되어 더는 복구할 수 없습니다.',
      onConfirm: () => {
        clearTrash(activeFile.file.name, activeFile.file.size);
        setTrashNonce(n => n + 1);
        setShowTrash(false);
      },
    });
  };

  // 선택 문장 삭제 (중복·불필요 정리)
  // 확인창 없이 바로 삭제 — 10초 '실행취소' 토스트 + 휴지통으로 복구 가능하므로 별도 확인 불필요.
  const confirmDelete = () => {
    if (!activeFile || selectedIdxs.size === 0) return;
    const idxs = [...selectedIdxs];
    const fileId = activeFile.id;
    deleteSentences(fileId, idxs);
    exitSelectMode();
  };

  // 빈칸 구간 복구 — 선택 문장은 그대로 두고, 그 앞·뒤 이웃 사이 빈칸에서 지워진 문장 복구
  const confirmRecover = () => {
    if (!activeFile || selectedIdxs.size !== 1) return;
    const anchorIndex = [...selectedIdxs][0];
    const fileId = activeFile.id;
    showConfirm({
      message: `선택한 문장은 그대로 두고, 그 앞·뒤 이웃 문장 사이에서 실수로 지워진 문장을 다시 듣고 복구합니다. (양쪽 자동 확인, 실측 시각·자동 분석) 진행할까요?`,
      confirmText: '복구',
      danger: false,
      onConfirm: () => {
        recoverGap(fileId, anchorIndex, 'both');
        exitSelectMode();
      },
    });
  };

  // 선택 구간 분석만 다시 (Phase 2만 — 전사는 보존). 설정의 Stage 2 모델 사용.
  const confirmReanalyze = () => {
    if (!activeFile || selectedIdxs.size === 0) return;
    const idxs = [...selectedIdxs];
    const fileId = activeFile.id;
    showConfirm({
      message: `선택한 ${idxs.length}개 문장의 번역·분석만 다시 합니다. 전사(문장·타임스탬프)는 그대로 유지됩니다. 진행할까요?`,
      confirmText: '분석 다시',
      danger: false,
      onConfirm: () => {
        reanalyzeSentences(fileId, idxs);
        exitSelectMode();
      },
    });
  };

  // 선택 문장의 '대사만'(대사 끝 시각)만 다시 감지 — 문장 글자·타임스탬프는 그대로.
  // 들어보니 대사만이 이상한(안 넘어가는) 문장만 골라 고칠 때. 그 문장 주변 오디오만 전송(비용 비례).
  const confirmDetectSpeech = () => {
    if (!activeFile || selectedIdxs.size === 0) return;
    if (speechDetectBusy) return; // 다른 감지 진행 중이면 무반응+선택소실이 되므로 차단(칩/배지 핸들러와 동일 패턴)
    const idxs = [...selectedIdxs];
    const fileId = activeFile.id;
    // 문장 1개면 'AI가 다시 듣기 / 직접 맞추기' 창 — 직접 맞추기는 ±버튼·미리 듣기로 끝 시각을 정한다(무료)
    if (idxs.length === 1) { setEditDialog({ kind: 'speechEnd', fileId, idx: idxs[0] }); return; }
    showConfirm({
      message: `선택한 ${idxs.length}개 문장의 '대사 끝나는 지점'만 다시 감지해 '대사만' 건너뛰기를 고칩니다. 문장 글자·번역·분석은 그대로예요. (그 구간 오디오만 전송, 감지되면 기존 값을 새로 바꿔요) 진행할까요?`,
      confirmText: '대사만 다시',
      danger: false,
      onConfirm: () => {
        detectSpeechEndsForFile(fileId, { indices: idxs });
        exitSelectMode();
      },
    });
  };

  // [캐시 버저닝] 낡은 분석을 최신 규칙으로 전체 재분석 (전사·타임스탬프는 보존, 분석만 다시).
  const confirmReanalyzeAll = () => {
    if (!activeFile || transcriptData.length === 0) return;
    const fileId = activeFile.id;
    const allIdxs = transcriptData.map((_, i) => i);
    showConfirm({
      message: `이 대본 전체(${allIdxs.length}개 문장)의 번역·분석을 최신 규칙으로 다시 합니다. 전사(문장·타임스탬프)는 그대로 유지됩니다. 진행할까요?`,
      confirmText: '전체 재분석',
      danger: false,
      onConfirm: () => reanalyzeSentences(fileId, allIdxs),
    });
  };

  useEffect(() => {
    refreshCacheKeysRef.current = refreshCacheKeys;
  }, [refreshCacheKeys]);


  useEffect(() => {
    if (showSettings || showCacheHistory) refreshCacheKeys();
    if (showCacheHistory) refreshCloud();
  }, [showSettings, showCacheHistory, refreshCacheKeys, refreshCloud]);

  // 암호가 설정되면 클라우드 보관함 목록을 미리 불러온다
  useEffect(() => {
    if (passphrase) refreshCloud();
  }, [passphrase, refreshCloud]);

  // [위치 기억 - 스크롤] 대본을 스크롤할 때 화면 맨 위 문장을 저장 (재생 안 해도 기록됨)
  const saveScrollPos = () => {
    const c = scrollContainerRef.current;
    const f = activeFileRef.current;
    if (!c || !f || f.isAnalyzing || !f.file?.name || !f.data?.length) return;
    // 복원이 끝난 파일만 저장 (전환 중 컨테이너 리셋으로 0이 덮어써지는 것 방지)
    if (restoredForRef.current !== f.id) return;
    const items = c.querySelectorAll('[data-idx]');
    if (!items.length) return;
    const cTop = c.getBoundingClientRect().top;
    let topIdx = 0;
    for (const el of items) {
      // 컨테이너 상단을 지나 걸쳐 있는 첫 아이템 = 지금 보고 있는 문장
      if (el.getBoundingClientRect().bottom > cTop + 8) { topIdx = Number(el.dataset.idx); break; }
    }
    const item = f.data[topIdx];
    if (item) setLastPos(f.file.name, f.file.size, topIdx, item.seconds);
  };

  const onTranscriptScroll = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      saveScrollPos();
    });
  };

  // (재생 하이라이트 기반 저장은 제거됨: activeFile 재생성 시 낡은 idx로 스크롤 저장을 덮어쓰는
  //  버그가 있었음. 재생 중엔 활성 문장 자동 스크롤 → onScroll → 스크롤 저장으로 이미 위치가 기록됨.)

  // [위치 복원] 대본이 렌더된 직후, 화면에 그리기 '전에' 저장 위치로 스크롤 (맨 위 깜빡임 방지)
  useLayoutEffect(() => {
    if (!activeFile || activeFile.isAnalyzing || isSwitchingFile) return;
    if (!activeFile.file?.name || !activeFile.data?.length) return;
    if (restoredForRef.current === activeFile.id) return;
    restoredForRef.current = activeFile.id;

    const pos = getLastPos(activeFile.file.name, activeFile.file.size);
    const item = pos ? activeFile.data[pos.idx] : null;
    if (!item) return;

    // 페인트 전에 동기적으로 스크롤 → 처음부터 그 위치에 그려짐(맨 위로 튀지 않음)
    const el = scrollContainerRef.current?.querySelector(`[data-idx="${pos.idx}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
    restoreTo(pos.idx, item.seconds);            // 재생 커서·하이라이트
  }, [activeFile, isSwitchingFile, restoreTo]);

  // Keyboard Shortcuts
  useKeyboardShortcuts({
    mediaUrl, activeFile, togglePlay, toggleLoop, toggleGlobalAnalysis,
    jumpToSentence, activeIdxRef, lastActionTimeRef, videoRef,
    onToggleHelp: () => setShowShortcuts(s => !s),
    playbackRate, handleRateChange,
    onPrevSentence: goPrev, onNextSentence: goNext,
  });

  const removeFile = (id, e) => {
    e.stopPropagation();
    // 대사 구간 감지 중인 항목을 닫으면, 감지가 끝났을 때 결과를 써넣을 항목이 사라져
    // 로컬 저장(persistCache)까지 통째로 건너뛴다 → 메모리·캐시 양쪽에서 전량 소실.
    // 감지는 isAnalyzing을 세우지 않아 다른 경고에 안 걸리므로 여기서 따로 확인한다.
    if (speechDetectBusy === id) {
      showConfirm({
        message: "대사 구간을 감지하는 중입니다. 지금 닫으면 감지 결과가 저장되지 않고 사라집니다 (오디오 전송 비용도 헛됩니다). 계속할까요?",
        danger: true,
        onConfirm: () => doRemoveFile(id),
      });
      return;
    }
    doRemoveFile(id);
  };

  const doRemoveFile = (id) => {
    if (activeFileId === id && stage2AbortRef.current) {
      stage2AbortRef.current.abort();
    }
    setFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove && fileToRemove.url) URL.revokeObjectURL(fileToRemove.url);
      const newFiles = prev.filter(f => f.id !== id);
      if (activeFileId === id) {
        setActiveFileId(newFiles.length > 0 ? newFiles[0].id : null);
      }
      return newFiles;
    });
  };

  // 홈으로: 분석 중이면 실수로 작업을 날리지 않도록 확인
  const handleHome = () => {
    const doHome = () => { setFiles([]); setActiveFileId(null); resetPlayerState(); };
    // 감지 중에도 경고한다 — 감지는 isAnalyzing을 세우지 않아 예전엔 경고 없이 조용히 날아갔다
    if (speechDetectBusy) {
      showConfirm({
        message: "대사 구간을 감지하는 중입니다. 지금 나가면 감지 결과가 저장되지 않고 사라집니다 (오디오 전송 비용도 헛됩니다). 계속할까요?",
        danger: true,
        onConfirm: doHome,
      });
    } else if (files.some(f => f.isAnalyzing)) {
      showConfirm({
        message: "분석이 진행 중입니다. 홈으로 나가면 현재 화면의 작업이 사라집니다. 계속할까요? (완료된 대본은 히스토리에 저장됩니다)",
        onConfirm: doHome,
      });
    } else {
      doHome();
    }
  };

  // Shared overlays for both Empty and Main states
  const overlays = (
    <>
      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          confirmText={confirmState.confirmText}
          danger={confirmState.danger}
          onConfirm={() => { confirmState.onConfirm(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          action={toastState.action}
          duration={toastState.duration}
          onClose={() => setToastState(null)}
        />
      )}
      {cloudDownload && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-3 px-5 py-3 bg-slate-900/90 dark:bg-slate-700/95 text-white rounded-2xl shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-sm font-bold whitespace-nowrap">
            영상 받는 중{cloudDownload.percent != null ? ` ${cloudDownload.percent}%` : '...'}
          </span>
        </div>
      )}
      {toolbarPopover?.kind === 'loop' && (
        <LoopPopover
          anchor={toolbarPopover.anchor}
          current={effLoopN}
          onPick={changeLoopGroupSize}
          onClose={closeToolbarPopover}
        />
      )}
      {toolbarPopover?.kind === 'drill' && (
        <DrillPopover
          anchor={toolbarPopover.anchor}
          difficulty={difficulty}
          onPickDifficulty={(v) => updateField('difficulty', v)}
          onNewRound={() => { updateField('drillRound', r => r + 1); clearLearnProgress(); }}
          onClose={closeToolbarPopover}
        />
      )}
      {toolbarPopover?.kind === 'fix' && (
        <FixMenuPopover
          anchor={toolbarPopover.anchor}
          items={fixMenuItems({ trashCount: trashItems.length, missingSpeechEnds, speechBusy: !!speechDetectBusy })}
          onPick={(id) => {
            if (id === 'select') setSelectMode(true);
            else if (id === 'trash') setShowTrash(true);
            else if (id === 'detectMissing') handleDetectMissing();
          }}
          onClose={closeToolbarPopover}
        />
      )}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
      {showTrash && (
        <TrashModal
          items={trashItems}
          onRestore={handleTrashRestore}
          onClear={handleTrashClear}
          onClose={() => setShowTrash(false)}
        />
      )}
    </>
  );

  // ─── 비밀 암호 게이트 (동기화 활성화 전 최초 1회) ───
  // 클라우드가 꺼져 있으면 암호가 필요 없으므로 게이트를 건너뛴다
  // (CLOUD_ENABLED=false면 getPassphrase가 항상 ''을 반환해 이 조건이 영원히 참이 된다).
  if (CLOUD_ENABLED && !passphrase) {
    return (
      <PassphraseGate onSubmit={(p) => { persistPassphrase(p); setPassphraseState(p); }} />
    );
  }

  // ─── Empty State ───
  if (files.length === 0) {
    return (
      <>
      <EmptyState
        isDragging={isDragging}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        processFiles={processFiles}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        config={config}
        updateField={updateField}
        onLockVault={CLOUD_ENABLED ? lockVault : null}
        cacheKeys={cacheKeys}
        loadCache={loadCache}
        deleteLocal={deleteLocal}
        deleteServer={deleteServer}
        clearLocalCache={clearLocalCache}
        localVideoIds={localVideoIds}
        isFavorite={isFavorite}
        toggleFavorite={toggleFavorite}
        cloudItems={cloudItems}
        cloudStatus={cloudStatus}
        loadCloud={loadCloud}
      />
      {overlays}
      </>
    );
  }

  // ─── Main Workspace ───
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="flex flex-col h-screen bg-[#F8FAFC] dark:bg-slate-900 text-slate-800 dark:text-slate-200 overflow-hidden font-sans animate-in fade-in duration-700 relative"
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm flex items-center justify-center p-10 border-4 border-indigo-500 border-dashed m-4 rounded-3xl pointer-events-none">
          <h2 className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">놓으면 파일이 추가됩니다</h2>
        </div>
      )}

      {/* Header */}
      <WorkspaceHeader
        activeFile={activeFile}
        isAnalyzing={isAnalyzing}
        isSwitchingFile={isSwitchingFile}
        onHome={handleHome}
        onOpenHistory={() => setShowCacheHistory(true)}
        onOpenSettings={() => setShowSettings(true)}
        onShowShortcuts={() => setShowShortcuts(true)}
        // 툴바를 그릴 수 있을 때만 버튼을 보인다. 선택 모드 중엔 편집 버튼 줄이 툴바 자리라 늘 열려 있다.
        onToggleToolbar={toolbarAvailable && !selectMode ? toggleToolbar : null}
        toolbarOpen={toolbarOpen}
        // 숨긴 채 화면을 바꾸는 모드가 켜져 있으면 버튼에 점 — '왜 대본이 가려졌지/줄었지'를 알 수 있게
        toolbarModesOn={drillMode || mistakeOnly || !!(config.speechOnlyEnabled && hasSpeechEnds)}
      />

      {/* [자동 업데이트] 새 번들 배포 감지 → 새로고침 안내 (모바일 stale 번들 방지) */}
      {updateReady && (
        <div className="flex-none flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs sm:text-sm">
          <RotateCcw size={14} className="shrink-0" />
          <span className="flex-1 min-w-0 font-medium leading-tight">새 버전이 나왔어요. 새로고침하면 최신 기능이 적용됩니다.</span>
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-bold hover:bg-indigo-50 transition-colors"
          >
            새로고침
          </button>
        </div>
      )}

      {/* [캐시 버저닝] 옛 규칙으로 분석된 파일 → 최신 규칙으로 재분석 권장 배너 */}
      {isStaleAnalysis && contentReady && (
        <div className="flex-none flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs sm:text-sm">
          <RotateCcw size={14} className="shrink-0" />
          <span className="flex-1 min-w-0 font-medium leading-tight">단어 풀이 모양이 바뀌었어요. 재분석하면 새 모양으로 보입니다.</span>
          <button
            onClick={confirmReanalyzeAll}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-500/25 dark:hover:bg-amber-500/40 dark:text-amber-100 dark:border dark:border-amber-600 font-bold transition-colors"
          >
            전체 재분석
          </button>
        </div>
      )}

      {/* [재분석 진행] 전체 스피너가 없는 백그라운드 분석(재분석·이어서분석) 중 상단에 진행률 표시 */}
      {stage2Progress && stage2Progress.fileId === activeFileId && contentReady && (
        <div className="flex-none flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm">
          <div className="w-3.5 h-3.5 shrink-0 border-2 border-emerald-300 dark:border-emerald-700 border-t-emerald-600 rounded-full animate-spin" />
          <Stage2ProgressText progress={stage2Progress} />
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {activeFile ? (
          <div className="flex flex-col h-full">
            {/* 구간 다시 전사 툴바 */}
            {toolbarAvailable && (toolbarOpen || selectMode) && (
              <div className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
                <div className="max-w-3xl mx-auto px-3 md:px-6 py-0.5 flex items-center justify-between gap-1.5">
                  {!selectMode ? (
                    <>
                    {/* 보이는 칩은 공부에 쓰는 4개(가리기·묶음·대사만·오답)뿐. 줄바꿈 금지(한 줄 고정) —
                        390px 폭이면 스크롤 없이 들어오고, 더 좁으면 이 줄만 가로 스와이프. */}
                    <div className="flex items-center gap-1 overflow-x-auto min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {/* 🙈 가리기 학습 (클로즈): 왼쪽 = 켜기/끄기, 켜져 있으면 오른쪽 = 난이도·새 문제 팝오버.
                          켜진 동안 왼쪽은 눈 아이콘만 — 옆의 난이도 이름이 '가리기 중'을 알려 주고, 그래야 오답 칩까지 한 줄에 든다 */}
                      <div className={`shrink-0 h-6 inline-flex items-stretch rounded-lg border overflow-hidden ${drillMode ? 'border-indigo-600' : 'border-indigo-100 dark:border-indigo-900'}`}>
                        <button
                          onClick={() => setDrillMode(d => !d)}
                          aria-pressed={drillMode}
                          aria-label={drillMode ? '가리기 끄기' : undefined}
                          className={`${CHIP_BASE} ${drillMode ? 'min-w-8 bg-indigo-600 text-white hover:bg-indigo-700' : 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'}`}
                        >
                          <EyeOff className={CHIP_ICON} />{!drillMode && ' 가리기'}
                        </button>
                        {drillMode && (
                          <button
                            onClick={(e) => setToolbarPopover({ kind: 'drill', anchor: anchorOf(e.currentTarget) })}
                            aria-label="가리기 난이도·새 문제"
                            aria-haspopup="dialog"
                            className={`${CHIP_BASE} border-l border-indigo-400 bg-indigo-600 text-white hover:bg-indigo-700`}
                          >
                            {DRILL_LEVELS.find(([v]) => v === difficulty)?.[1] || '초급'}
                            <ChevronDown className={CHIP_ICON} />
                          </button>
                        )}
                      </div>

                      {/* 🔁 묶음 반복: 한 번에 몇 문장을 묶어 반복할지 (1 = 기존 한 문장 반복).
                          탭 → 팝오버에서 −/+·프리셋. 오답 모드에선 잠금(숨긴 문장 소리가 새지 않도록) */}
                      <button
                        onClick={(e) => setToolbarPopover({ kind: 'loop', anchor: anchorOf(e.currentTarget) })}
                        disabled={mistakeOnly}
                        title={mistakeOnly
                          ? '오답 복습 중에는 한 문장씩 반복합니다 (숨긴 문장 소리가 새지 않도록)'
                          : '반복을 켰을 때 한 번에 반복할 문장 수 — 탭해서 고르기'}
                        aria-label="묶음 문장 수 바로 선택"
                        aria-haspopup="dialog"
                        className={`${CHIP} disabled:opacity-50 ${mistakeOnly
                          ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                          : effLoopN > 1
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-slate-500 dark:text-slate-400 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                      >
                        <Repeat className={`${CHIP_ICON} ${effLoopN > 1 && !mistakeOnly ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`} />
                        묶음
                        <span className={`font-black tabular-nums ${effLoopN > 1 && !mistakeOnly ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}>{effLoopN}</span>
                      </button>

                      {/* 🎧 대사만 재생: 반복 시 대사 끝~다음 대사 사이 긴 배경음악/무음 건너뛰기.
                          감지 데이터가 없으면 탭 = 감지 실행(확인창), 있으면 탭 = 켜기/끄기 */}
                      <button
                        onClick={handleSpeechOnlyChip}
                        disabled={speechDetectBusy === activeFileId}
                        aria-pressed={!!(config.speechOnlyEnabled && hasSpeechEnds)}
                        title={speechDetectBusy === activeFileId
                          ? '대사 구간 감지 중...'
                          : !hasSpeechEnds
                            ? '대사 구간을 감지하면, 재생 중 대사 사이 배경음악·무음을 건너뜁니다 (오디오 1회 전송)'
                            : config.speechOnlyEnabled
                              ? '대사만 재생 켜짐 — 탭하면 끄기'
                              : '재생·반복 중 대사 사이 긴 배경음악·무음 건너뛰기 — 탭하면 켜기'}
                        className={`${CHIP} relative ${config.speechOnlyEnabled && hasSpeechEnds
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : hasSpeechEnds
                            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border-emerald-200 dark:border-emerald-800'
                            : 'text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'}`}
                      >
                        {speechDetectBusy === activeFileId
                          ? <Loader2 className={`${CHIP_ICON} animate-spin`} />
                          : <FastForward className={CHIP_ICON} />} 대사만
                        {/* 미감지 잔여 표시 = 오른쪽 위 점(누르는 자리 아님 — 개수와 재감지는 '⋯ 고치기' 메뉴).
                            예전 !N 배지는 칩 안의 두 번째 탭 자리라 엄지로 못 골랐다 */}
                        {hasSpeechEnds && missingSpeechEnds > 0 && speechDetectBusy !== activeFileId && (
                          <span title={`${missingSpeechEnds}개 문장 미감지 — '⋯ 고치기'에서 그 문장들만 재감지`} className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500">
                            <span className="sr-only">{missingSpeechEnds}개 문장 미감지</span>
                          </span>
                        )}
                      </button>

                      {/* ❗ 오답만 보기 (오답 있을 때 표시 — 모드 중엔 0개여도 유지해 빠져나갈 수 있게) */}
                      {(wrongIndices.length > 0 || mistakeOnly) && (
                        <button
                          onClick={toggleMistakeOnly}
                          aria-pressed={mistakeOnly}
                          className={`${CHIP} ${mistakeOnly ? 'bg-amber-500 text-white border-amber-500 dark:bg-amber-500/30 dark:text-amber-100 dark:border-amber-500' : 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 border-amber-200 dark:border-amber-800'}`}
                        >
                          <AlertTriangle className={CHIP_ICON} /> 오답 {wrongIndices.length}
                        </button>
                      )}
                    </div>

                    {/* ⋯ 고치기: 재전사/분석(선택 모드)·휴지통·빠진 대사 끝 재감지. 스와이프 줄 밖이라 늘 보인다 */}
                    <button
                      onClick={(e) => setToolbarPopover({ kind: 'fix', anchor: anchorOf(e.currentTarget) })}
                      aria-label="고치기 메뉴"
                      aria-haspopup="dialog"
                      className={`${CHIP} min-w-8 px-[min(1.5vw,6px)] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700`}
                    >
                      <MoreHorizontal className="w-[min(4.2vw,16px)] h-[min(4.2vw,16px)]" />
                    </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 shrink min-w-0 truncate">
                        {selectedIdxs.size > 0
                          ? `${selectedIdxs.size}개 선택`
                          : '문장 선택'}
                      </span>
                      <div className="flex items-center gap-1 overflow-x-auto">
                        <button
                          onClick={exitSelectMode}
                          className={`${SEL_BTN} text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors`}
                        >
                          <X size={14} /> 취소
                        </button>
                        <button
                          onClick={confirmDelete}
                          disabled={selectedIdxs.size === 0}
                          title="선택한 문장을 대본에서 삭제 (중복·불필요 정리)"
                          className={`${SEL_BTN} text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                        >
                          <Trash2 size={14} /> 삭제
                        </button>
                        {selectedIdxs.size === 1 && (
                          <button
                            onClick={confirmSplit}
                            title="문장을 단어 사이에서 나눠 앞/뒷부분만 지우거나 두 문장으로 만들기"
                            className={`${SEL_BTN} text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-800 transition-colors`}
                          >
                            <Scissors size={14} /> 나누기
                          </button>
                        )}
                        <button
                          onClick={confirmRecover}
                          disabled={selectedIdxs.size !== 1}
                          title="문장 1개 선택 후 사용 — 그 앞·뒤 이웃 사이 빈칸에서 실수로 지워진 문장 복구 (선택 문장 유지·자동 분석)"
                          className={`${SEL_BTN} text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                        >
                          <LifeBuoy size={14} /> 복구
                        </button>
                        <button
                          onClick={confirmReanalyze}
                          disabled={selectedIdxs.size === 0}
                          title="전사(문장·타임스탬프)는 그대로 두고 번역·분석만 다시"
                          className={`${SEL_BTN} text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                        >
                          <Languages size={14} /> 분석
                        </button>
                        <button
                          onClick={confirmDetectSpeech}
                          disabled={selectedIdxs.size === 0 || speechDetectBusy === activeFileId}
                          title="선택 문장의 '대사 끝나는 지점'만 다시 감지 — 대사만이 안 넘어가는 문장 교정 (글자·분석 그대로, 그 구간 오디오만 전송)"
                          className={`${SEL_BTN} text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/50 border border-sky-200 dark:border-sky-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                        >
                          <FastForward size={14} /> 대사만
                        </button>
                        <button
                          onClick={confirmRetranscribe}
                          disabled={selectedIdxs.size === 0}
                          title="해당 구간 오디오를 다시 들어 전사부터 새로 (분석도 자동)"
                          className={`${SEL_BTN} text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors shadow-sm`}
                        >
                          <Check size={14} /> 전사
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            <div ref={scrollContainerRef} onScroll={onTranscriptScroll} className="flex-1 w-full overflow-y-auto bg-[#F8FAFC] dark:bg-slate-900" onClick={() => { setShowSpeedMenu(false); }}>
              {/* PC에서 카드가 1100px까지 늘어나 풀이 한 줄이 90자를 넘었다 → 3xl(768px). 툴바도 같은 폭 */}
              <div className="max-w-3xl mx-auto px-2 md:px-6 pb-32">
                {isAnalyzing || isSwitchingFile ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-6">
                    <div className="relative w-20 h-20">
                      <div className="absolute inset-0 border-4 border-indigo-100 dark:border-indigo-900 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    </div>
                    <div className="text-center">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Analyzing {activeFile.file.name}...</h3>
                      <p className="text-slate-500 dark:text-slate-400">
                        {/* isAnalyzing = 전사(Stage 1) 중. 받은 문장 수는 스트리밍으로 늘어난다 */}
                        {!isAnalyzing
                          ? '대본 여는 중...'
                          : transcriptData.length > 0
                            ? `전사 중... (${transcriptData.length}문장 받음)`
                            : '전사 중...'
                        }
                      </p>
                    </div>
                    {isAnalyzing && (
                      <button
                        onClick={() => cancelStage1(activeFile.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800 transition-all"
                      >
                        <X size={16} /> 전사 중단
                      </button>
                    )}
                  </div>
                ) : activeFile.error ? (
                  <div className="max-w-xl mx-auto p-6 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-2xl border border-red-100 dark:border-red-900 text-center">
                    <AlertCircle size={32} className="mx-auto mb-3 text-red-500 dark:text-red-400" />
                    <h3 className="font-bold text-lg mb-1">Analysis Failed</h3>
                    <p>{activeFile.error}</p>
                    <button
                      onClick={() => retryAnalysis(activeFile.id)}
                      className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100 dark:shadow-black/40"
                    >
                      <RotateCcw size={16} />
                      다시 시도
                    </button>
                  </div>
                ) : transcriptData.length === 0 ? (
                  <div className="text-center py-20 text-slate-400 dark:text-slate-500">
                    <p>Analysis complete but no text found.</p>
                  </div>
                ) : (
                  <div key={activeFileId} className="space-y-1 min-h-[200px] relative">
                    <ErrorBoundary>
                      {mistakeOnly && wrongIndices.length === 0 ? (
                        <div className="text-center py-20">
                          <div className="text-4xl mb-3">🎉</div>
                          <p className="text-slate-600 dark:text-slate-300 font-bold">이 영상의 오답을 다 맞혔어요!</p>
                          <button
                            onClick={toggleMistakeOnly}
                            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100 dark:shadow-black/40"
                          >
                            전체 대본으로 돌아가기
                          </button>
                        </div>
                      ) : (
                        transcriptData.map((item, idx) => {
                          // [함정 #1] 오답 모드: 원래 idx는 유지한 채 오답 아닌 문장만 렌더에서 제외
                          if (mistakeOnly && !isWrong(idx)) return null;
                          const isActive = idx === activeSentenceIdx;
                          const compositeKey = `${activeFileId}-${idx}-${item.seconds}`;
                          return (
                            <TranscriptItem
                              key={compositeKey}
                              item={item}
                              idx={idx}
                              isActive={isActive}
                              manualScrollNonce={isActive ? manualScrollNonce : 0}
                              seekTo={seekTo}
                              jumpToSentence={jumpToSentence}
                              toggleLoop={toggleLoop}
                              isLooping={isActive && isGlobalLoopActive}
                              isGlobalLooping={isGlobalLoopActive}
                              showAnalysis={showAnalysis}
                              showBreakdown={showBreakdown}
                              toggleGlobalAnalysis={toggleGlobalAnalysis}
                              selectMode={selectMode}
                              isSelected={selectedIdxs.has(idx)}
                              onToggleSelect={toggleSelectIdx}
                              onRetryAnalysis={handleRetryOne}
                              onCoverageRetry={handleCoverageRetry}
                              onRetranscribe={handleRetranscribeOne}
                              speechEndMissing={speechEndMissingIdxs.has(idx)}
                              onSpeechEndFix={handleSpeechEndFix}
                              drillMode={drillMode}
                              difficulty={difficulty}
                              drillRound={drillRound}
                              onMarkAnswer={markAnswer}
                              isWrong={isWrong(idx)}
                              inLoopGroup={!!loopGroup && idx >= loopGroup.start && idx <= loopGroup.end}
                              groupLoopOn={!!loopGroup}
                            />
                          );
                        })
                      )}
                    </ErrorBoundary>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Player Controls */}
            <PlayerControls
              attachVideo={attachVideo}
              mediaUrl={mediaUrl}
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              playbackRate={playbackRate}
              isGlobalLoopActive={isGlobalLoopActive}
              loopGroupSize={effLoopN}
              currentSentenceIdx={activeSentenceIdx}
              showAnalysis={showAnalysis}
              showBreakdown={showBreakdown}
              onCycleAnalysis={toggleGlobalAnalysis}
              showSpeedMenu={showSpeedMenu}
              togglePlay={togglePlay}
              seekTo={seekTo}
              handlePrev={goPrev}
              handleNext={goNext}
              handleRateChange={handleRateChange}
              toggleLoop={toggleLoop}
              setShowAnalysis={setShowAnalysis}
              setShowSpeedMenu={setShowSpeedMenu}
              processFiles={processFiles}
              onMediaError={handleMediaError}
            />
          </div>
        ) : (
          <NoActiveFile
            stage1Model={stage1Model}
            stage2Model={stage2Model}
            onOpenSettings={() => setShowSettings(true)}
            onOpenHistory={() => setShowCacheHistory(true)}
          />
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          config={config}
          updateField={updateField}
          onLockVault={CLOUD_ENABLED ? lockVault : null}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Cache History Modal */}
      {showCacheHistory && (
        <CacheHistoryModal
          cacheKeys={cacheKeys}
          files={files}
          runningKeys={new Set(files.filter(f => f.file?.name && (f.isAnalyzing || stage2ActiveRef.current.get(f.id))).map(f => `${f.file.name}_${f.file.size}`))}
          activeFile={activeFile}
          activeFileId={activeFileId}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          loadCache={loadCache}
          processFiles={processFiles}
          removeFile={removeFile}
          setActiveFileId={setActiveFileId}
          cloudItems={cloudItems}
          loadCloud={loadCloud}
          deleteLocal={deleteLocal}
          deleteServer={deleteServer}
          clearLocalCache={clearLocalCache}
          localVideoIds={localVideoIds}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          onClose={() => setShowCacheHistory(false)}
        />
      )}

      {editDialog?.kind === 'retranscribe' && activeFile?.id === editDialog.fileId && (
        <RetranscribeDialog
          data={activeFile.data}
          selectedIdxs={editDialog.idxs}
          duration={duration}
          mediaUrl={mediaUrl}
          playbackRate={playbackRate}
          onPausePlayer={pauseMainPlayer}
          onSentenceMode={() => { retranscribeSentences(editDialog.fileId, [...editDialog.idxs]); setEditDialog(null); exitSelectMode(); }}
          onRangeMode={(start, end) => { retranscribeRange(editDialog.fileId, start, end); setEditDialog(null); exitSelectMode(); }}
          onClose={() => setEditDialog(null)}
        />
      )}
      {editDialog?.kind === 'split' && activeFile?.id === editDialog.fileId && activeFile.data[editDialog.idx] && (
        <SplitDialog
          data={activeFile.data}
          idx={editDialog.idx}
          duration={duration}
          mediaUrl={mediaUrl}
          playbackRate={playbackRate}
          onPausePlayer={pauseMainPlayer}
          onApply={(opts) => { splitSentence(editDialog.fileId, editDialog.idx, opts); setEditDialog(null); exitSelectMode(); }}
          onClose={() => setEditDialog(null)}
        />
      )}
      {editDialog?.kind === 'speechEnd' && activeFile?.id === editDialog.fileId && activeFile.data[editDialog.idx] && (
        <SpeechEndDialog
          data={activeFile.data}
          idx={editDialog.idx}
          duration={duration}
          mediaUrl={mediaUrl}
          playbackRate={playbackRate}
          onPausePlayer={pauseMainPlayer}
          onDetect={() => { detectSpeechEndsForFile(editDialog.fileId, { indices: [editDialog.idx] }); setEditDialog(null); exitSelectMode(); }}
          onApply={(se) => { setSpeechEndManual(editDialog.fileId, editDialog.idx, se); setEditDialog(null); exitSelectMode(); }}
          onClose={() => setEditDialog(null)}
        />
      )}

      {overlays}
    </div>
  );
};

export default App;
