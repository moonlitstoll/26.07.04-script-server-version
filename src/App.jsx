import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  AlertCircle, RotateCcw, Wand2, X, Check, Languages, Trash2, LifeBuoy, EyeOff, AlertTriangle, Shuffle
} from 'lucide-react';
import { useSettings } from './hooks/useSettings';
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
import { getPassphrase, setPassphrase as persistPassphrase } from './services/cloudSync';
import { getLastPos, setLastPos } from './utils/viewPosition';
import { getTrash, clearTrash } from './utils/trashUtils';
import { parseCacheEntry, isCacheStale } from './utils/cacheUtils';


const App = () => {
  const { config, updateField } = useSettings();

  // 기기 간 동기화용 비밀 암호
  const [passphrase, setPassphraseState] = useState(() => getPassphrase());
  const { apiKey, stage1Model, stage2Model, stage3Model, bufferTime, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, realignEnabled } = config;

  // Multi-file state
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(true);
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
  const showToast = useCallback((opts) => setToastState(opts), []);

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

  const toggleGlobalAnalysis = useCallback(() => setShowAnalysis(prev => !prev), []);
  const stage2AbortRef = useRef(null);

  // Derived active file
  const activeFile = files.find(f => f.id === activeFileId);
  const transcriptData = useMemo(() => activeFile?.data || [], [activeFile?.data]);
  const mediaUrl = activeFile?.url || null;
  const isAnalyzing = activeFile?.isAnalyzing || false;

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

  // Hooks
  const {
    videoRef, attachVideo, activeSentenceIdx, currentTime, duration, playbackRate, isGlobalLoopActive, isPlaying,
    manualScrollNonce, handleRateChange, seekTo, togglePlay, toggleLoop, setLoopActive, jumpToSentence,
    handlePrev, handleNext, resetPlayerState, activeIdxRef, lastActionTimeRef, restoreTo
  } = useAudioPlayer({ activeFile, bufferTime });

  // ─── 가리기 학습(클로즈) + 오답 복습 ───
  const [drillMode, setDrillMode] = useState(false);
  const [difficulty, setDifficulty] = useState('easy'); // 'easy' | 'mid' | 'hard'
  const [drillRound, setDrillRound] = useState(0);       // '새 문제' 누를 때마다 +1 → 시드 변경(껐다 켜도 유지)
  const [mistakeOnly, setMistakeOnly] = useState(false);
  const prevLoopRef = useRef(false);                     // 오답 모드 진입 전 반복 상태 (복원용)

  const learnFileKey = activeFile?.file ? `${activeFile.file.name}_${activeFile.file.size}` : null;
  const { mark: markProgress, wrongIndices, isWrong, clearFile: clearLearnProgress } = useLearningProgress(learnFileKey, transcriptData);

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
      if (cur < 0) { jumpToSentence(0); return; }               // [함정 #6] 미재생 → 첫 문장(건너뜀 방지)
      handleNext(cur);
    }
  }, [mistakeOnly, wrongIndices, jumpToSentence, handleNext, activeIdxRef, transcriptData.length]);

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
      if (cur < 0) { jumpToSentence(0); return; }               // 미재생 → 첫 문장
      handlePrev(cur);
    }
  }, [mistakeOnly, wrongIndices, jumpToSentence, handlePrev, activeIdxRef, transcriptData.length]);

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

  // [함정 #8] 잠금화면/알림(MediaSession)의 이전·다음도 오답 인식 네비게이션으로 통일.
  // useAudioPlayer의 기본 등록 이후 App이 덮어써 최종 승자가 된다.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, h) => { try { ms.setActionHandler(a, h); } catch { /* 미지원 무시 */ } };
    set('previoustrack', () => goPrev());
    set('nexttrack', () => goNext());
  }, [goPrev, goNext]);

  // 대본 스크롤 컨테이너 (위치 저장/복원용)
  const scrollContainerRef = useRef(null);
  const restoredForRef = useRef(null);   // 위치 복원을 이미 처리한 activeFile.id
  const scrollRafRef = useRef(0);
  const activeFileRef = useRef(activeFile);
  // 렌더 직후 동기화(이벤트 핸들러가 최신 activeFile을 보도록) — 전환 시 지연 방지
  useLayoutEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  const refreshCacheKeysRef = useRef(null);

  const { isDragging, onDragOver, onDragLeave, onDrop, processFiles, runStage2, retryAnalysis, retranscribeSentences, reanalyzeSentences, recoverGap, deleteSentences, restoreSentences, cancelStage1, stage2Progress } = useMediaAnalysis({
    setFiles, setActiveFileId, setIsSwitchingFile, resetPlayerState,
    refreshCacheKeys: () => refreshCacheKeysRef.current && refreshCacheKeysRef.current(),
    apiKey, stage1Model, stage2Model, stage3Model, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, realignEnabled, stage2AbortRef,
    showToast,
    onTrashChange: () => setTrashNonce(n => n + 1)
  });

  // [회귀방지] TranscriptItem(memo)에 넘길 콜백을 안정화 — 재생 중 currentTime 틱마다
  // 인라인 함수가 새로 생겨 모든 문장 카드가 리렌더되던 문제 방지. reanalyzeSentences는
  // 매 렌더 새 신원일 수 있어 ref로 최신값을 참조하고, 콜백 자체는 activeFileId에만 의존.
  const reanalyzeRef = useRef(reanalyzeSentences);
  useEffect(() => { reanalyzeRef.current = reanalyzeSentences; });
  const handleRetryOne = useCallback((i) => reanalyzeRef.current(activeFileId, [i]), [activeFileId]);

  const { cacheKeys, deleteLocal, deleteServer, clearLocalCache,
    loadCache, refreshCacheKeys, cloudItems, cloudStatus, refreshCloud, loadCloud, localVideoIds, cloudDownload } = useMediaCache({
    files, setFiles, setActiveFileId, setShowSettings, setShowCacheHistory, setIsSwitchingFile,
    resetPlayerState, runStage2, apiKey, stage2Model, stage2AbortRef, showConfirm, showToast
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

  // 선택 구간 전사부터 다시 (Phase 1 + Phase 2). 설정의 Stage 1/2 모델 사용.
  const confirmRetranscribe = () => {
    if (!activeFile || selectedIdxs.size === 0) return;
    const idxs = [...selectedIdxs];
    const fileId = activeFile.id;
    showConfirm({
      message: `선택한 ${idxs.length}개 문장의 해당 구간 오디오만 다시 듣고 전사합니다. (전사 후 분석도 새로) 나머지 문장·타임라인은 그대로 유지됩니다. 진행할까요?`,
      confirmText: '전사 다시',
      danger: false,
      onConfirm: () => {
        retranscribeSentences(fileId, idxs);
        exitSelectMode();
      },
    });
  };

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
  // 확인창 없이 바로 삭제 — 6초 '실행취소' 토스트 + 휴지통으로 복구 가능하므로 별도 확인 불필요.
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
    if (files.some(f => f.isAnalyzing)) {
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
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-3 px-5 py-3 bg-slate-900/90 text-white rounded-2xl shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-sm font-bold whitespace-nowrap">
            영상 받는 중{cloudDownload.percent != null ? ` ${cloudDownload.percent}%` : '...'}
          </span>
        </div>
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
  if (!passphrase) {
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
        onLockVault={lockVault}
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
      className="flex flex-col h-screen bg-[#F8FAFC] text-slate-800 overflow-hidden font-sans animate-in fade-in duration-700 relative"
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm flex items-center justify-center p-10 border-4 border-indigo-500 border-dashed m-4 rounded-3xl pointer-events-none">
          <h2 className="text-4xl font-bold text-indigo-600 animate-bounce">Drop to Add Files</h2>
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
      />

      {/* [자동 업데이트] 새 번들 배포 감지 → 새로고침 안내 (모바일 stale 번들 방지) */}
      {updateReady && (
        <div className="flex-none flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs sm:text-sm">
          <RotateCcw size={14} className="shrink-0" />
          <span className="flex-1 min-w-0 truncate font-medium">새 버전이 나왔어요. 새로고침하면 최신 기능이 적용됩니다.</span>
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-bold hover:bg-indigo-50 transition-colors"
          >
            새로고침
          </button>
        </div>
      )}

      {/* [캐시 버저닝] 옛 규칙으로 분석된 파일 → 최신 규칙으로 재분석 권장 배너 */}
      {isStaleAnalysis && !isAnalyzing && !isSwitchingFile && (
        <div className="flex-none flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs sm:text-sm">
          <RotateCcw size={14} className="shrink-0" />
          <span className="flex-1 min-w-0 truncate font-medium">분석 규칙이 업데이트됐어요. 재분석하면 청크 분할이 개선됩니다.</span>
          <button
            onClick={confirmReanalyzeAll}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold transition-colors"
          >
            전체 재분석
          </button>
        </div>
      )}

      {/* [재분석 진행] 전체 스피너가 없는 백그라운드 분석(재분석·이어서분석) 중 상단에 진행률 표시 */}
      {stage2Progress && stage2Progress.fileId === activeFileId && !isAnalyzing && !isSwitchingFile && (
        <div className="flex-none flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs sm:text-sm">
          <div className="w-3.5 h-3.5 shrink-0 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
          <span className="flex-1 min-w-0 truncate font-medium">
            분석 중… {stage2Progress.done}/{stage2Progress.total}
          </span>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {activeFile ? (
          <div className="flex flex-col h-full">
            {/* 구간 다시 전사 툴바 */}
            {!isAnalyzing && !isSwitchingFile && !activeFile.error && transcriptData.length > 0 && (
              <div className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
                <div className="max-w-6xl mx-auto px-3 md:px-6 py-1 flex items-center justify-between gap-1.5">
                  {!selectMode ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => setSelectMode(true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition-colors"
                      >
                        <Wand2 size={13} /> 재전사/분석
                      </button>
                      <button
                        onClick={() => setShowTrash(true)}
                        title="삭제한 문장 복구 (휴지통)"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold text-slate-500 bg-white hover:bg-slate-50 border border-slate-200 transition-colors"
                      >
                        <Trash2 size={13} /> 휴지통{trashItems.length > 0 ? ` (${trashItems.length})` : ''}
                      </button>

                      {/* 🙈 가리기 학습 (클로즈) */}
                      <button
                        onClick={() => setDrillMode(d => !d)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold border transition-colors ${drillMode ? 'bg-indigo-600 text-white border-indigo-600' : 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border-indigo-100'}`}
                      >
                        <EyeOff size={13} /> 가리기
                      </button>
                      {drillMode && (
                        <>
                          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                            {[['easy', '초급'], ['mid', '중급'], ['hard', '고급']].map(([v, label]) => (
                              <button
                                key={v}
                                onClick={() => setDifficulty(v)}
                                className={`px-2 py-0.5 text-xs font-bold transition-colors ${difficulty === v ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => { setDrillRound(r => r + 1); clearLearnProgress(); }}
                            title="빈칸을 새로 섞고 이 영상의 오답 표시를 초기화합니다"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold text-slate-500 bg-white hover:bg-slate-50 border border-slate-200 transition-colors"
                          >
                            <Shuffle size={13} /> 새 문제
                          </button>
                        </>
                      )}

                      {/* ❗ 오답만 보기 (오답 있을 때 표시 — 모드 중엔 0개여도 유지해 빠져나갈 수 있게) */}
                      {(wrongIndices.length > 0 || mistakeOnly) && (
                        <button
                          onClick={toggleMistakeOnly}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold border transition-colors ${mistakeOnly ? 'bg-amber-500 text-white border-amber-500' : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'}`}
                        >
                          <AlertTriangle size={13} /> 오답 ({wrongIndices.length})
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className="text-xs font-bold text-slate-600 shrink min-w-0 truncate">
                        {selectedIdxs.size > 0
                          ? `${selectedIdxs.size}개 선택`
                          : '문장 선택'}
                      </span>
                      <div className="flex items-center gap-1 overflow-x-auto">
                        <button
                          onClick={exitSelectMode}
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
                        >
                          <X size={14} /> 취소
                        </button>
                        <button
                          onClick={confirmDelete}
                          disabled={selectedIdxs.size === 0}
                          title="선택한 문장을 대본에서 삭제 (중복·불필요 정리)"
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 size={14} /> 삭제
                        </button>
                        <button
                          onClick={confirmRecover}
                          disabled={selectedIdxs.size !== 1}
                          title="문장 1개 선택 후 사용 — 그 앞·뒤 이웃 사이 빈칸에서 실수로 지워진 문장 복구 (선택 문장 유지·자동 분석)"
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <LifeBuoy size={14} /> 복구
                        </button>
                        <button
                          onClick={confirmReanalyze}
                          disabled={selectedIdxs.size === 0}
                          title="전사(문장·타임스탬프)는 그대로 두고 번역·분석만 다시"
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Languages size={14} /> 분석
                        </button>
                        <button
                          onClick={confirmRetranscribe}
                          disabled={selectedIdxs.size === 0}
                          title="해당 구간 오디오를 다시 들어 전사부터 새로 (분석도 자동)"
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                          <Check size={14} /> 전사
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            <div ref={scrollContainerRef} onScroll={onTranscriptScroll} className="flex-1 w-full overflow-y-auto bg-[#F8FAFC]" onClick={() => { setShowSpeedMenu(false); }}>
              <div className="max-w-6xl mx-auto px-2 md:px-6 pb-32">
                {isAnalyzing || isSwitchingFile ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-6">
                    <div className="relative w-20 h-20">
                      <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    </div>
                    <div className="text-center">
                      <h3 className="text-lg font-bold text-slate-900">Analyzing {activeFile.file.name}...</h3>
                      <p className="text-slate-500">
                        {transcriptData.length > 0
                          ? `Applying 9 Principles & Deep Scan (${analyzedCount}/${transcriptData.length})`
                          : "Extracting timeline using Gemini 2.5..."
                        }
                      </p>
                    </div>
                    {isAnalyzing && (
                      <button
                        onClick={() => cancelStage1(activeFile.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-slate-500 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all"
                      >
                        <X size={16} /> 전사 중단
                      </button>
                    )}
                  </div>
                ) : activeFile.error ? (
                  <div className="max-w-xl mx-auto p-6 bg-red-50 text-red-600 rounded-2xl border border-red-100 text-center">
                    <AlertCircle size={32} className="mx-auto mb-3 text-red-500" />
                    <h3 className="font-bold text-lg mb-1">Analysis Failed</h3>
                    <p>{activeFile.error}</p>
                    <button
                      onClick={() => retryAnalysis(activeFile.id)}
                      className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100"
                    >
                      <RotateCcw size={16} />
                      다시 시도
                    </button>
                  </div>
                ) : transcriptData.length === 0 ? (
                  <div className="text-center py-20 text-slate-400">
                    <p>Analysis complete but no text found.</p>
                  </div>
                ) : (
                  <div key={activeFileId} className="space-y-1 min-h-[200px] relative">
                    <ErrorBoundary>
                      {mistakeOnly && wrongIndices.length === 0 ? (
                        <div className="text-center py-20">
                          <div className="text-4xl mb-3">🎉</div>
                          <p className="text-slate-600 font-bold">이 영상의 오답을 다 맞혔어요!</p>
                          <button
                            onClick={toggleMistakeOnly}
                            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100"
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
                              toggleGlobalAnalysis={toggleGlobalAnalysis}
                              selectMode={selectMode}
                              isSelected={selectedIdxs.has(idx)}
                              onToggleSelect={toggleSelectIdx}
                              onRetryAnalysis={handleRetryOne}
                              drillMode={drillMode}
                              difficulty={difficulty}
                              drillRound={drillRound}
                              onMarkAnswer={markAnswer}
                              isWrong={isWrong(idx)}
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
              currentSentenceIdx={activeSentenceIdx}
              showAnalysis={showAnalysis}
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
          onLockVault={lockVault}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Cache History Modal */}
      {showCacheHistory && (
        <CacheHistoryModal
          cacheKeys={cacheKeys}
          files={files}
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

      {overlays}
    </div>
  );
};

export default App;
