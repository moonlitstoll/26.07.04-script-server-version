import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  AlertCircle, RotateCcw, Wand2, X, Check, Languages, Sparkles
} from 'lucide-react';
import { useSettings } from './hooks/useSettings';
import { useMediaAnalysis } from './hooks/useMediaAnalysis';
import { useMediaCache } from './hooks/useMediaCache';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useFavorites } from './hooks/useFavorites';

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
import { getPassphrase, setPassphrase as persistPassphrase } from './services/cloudSync';
import { getLastPos, setLastPos } from './utils/viewPosition';


const App = () => {
  const { config, updateField } = useSettings();

  // 기기 간 동기화용 비밀 암호
  const [passphrase, setPassphraseState] = useState(() => getPassphrase());
  const { apiKey, stage1Model, stage2Model, bufferTime, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, realignEnabled } = config;

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
  // 고급(Pro+정밀추론) 토글 — 켜면 아래 재분석/재전사가 최고 품질로 동작
  const [advancedMode, setAdvancedMode] = useState(false);
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
  const transcriptData = activeFile?.data || [];
  const mediaUrl = activeFile?.url || null;
  const isAnalyzing = activeFile?.isAnalyzing || false;

  // Hooks
  const {
    videoRef, attachVideo, activeSentenceIdx, currentTime, duration, playbackRate, isGlobalLoopActive, isPlaying,
    manualScrollNonce, handleRateChange, seekTo, togglePlay, toggleLoop, jumpToSentence,
    handlePrev, handleNext, resetPlayerState, activeIdxRef, lastActionTimeRef, restoreTo
  } = useAudioPlayer({ activeFile, bufferTime });

  // 대본 스크롤 컨테이너 (위치 저장/복원용)
  const scrollContainerRef = useRef(null);
  const restoredForRef = useRef(null);   // 위치 복원을 이미 처리한 activeFile.id
  const scrollRafRef = useRef(0);
  const activeFileRef = useRef(activeFile);
  // 렌더 직후 동기화(이벤트 핸들러가 최신 activeFile을 보도록) — 전환 시 지연 방지
  useLayoutEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  const refreshCacheKeysRef = useRef(null);

  const { isDragging, onDragOver, onDragLeave, onDrop, processFiles, runStage2, retryAnalysis, retranscribeSentences, reanalyzeSentences } = useMediaAnalysis({
    setFiles, setActiveFileId, setIsSwitchingFile, resetPlayerState,
    refreshCacheKeys: () => refreshCacheKeysRef.current && refreshCacheKeysRef.current(),
    apiKey, stage1Model, stage2Model, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, realignEnabled, stage2AbortRef,
    showToast
  });

  const { cacheKeys, deleteLocal, deleteServer, clearLocalCache,
    loadCache, refreshCacheKeys, cloudItems, refreshCloud, loadCloud, localVideoIds, cloudDownload } = useMediaCache({
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

  const advNote = advancedMode ? ' (고급: Gemini 2.5 Pro + 정밀추론 — 느리지만 정확)' : '';

  // 선택 구간 전사부터 다시 (Phase 1 + Phase 2). 고급 토글 시 Pro로.
  const confirmRetranscribe = () => {
    if (!activeFile || selectedIdxs.size === 0) return;
    const idxs = [...selectedIdxs];
    const fileId = activeFile.id;
    const hq = advancedMode;
    showConfirm({
      message: `선택한 ${idxs.length}개 문장의 해당 구간 오디오만 다시 듣고 전사합니다. (전사 후 분석도 새로) 나머지 문장·타임라인은 그대로 유지됩니다.${advNote} 진행할까요?`,
      onConfirm: () => {
        retranscribeSentences(fileId, idxs, { highQuality: hq });
        exitSelectMode();
      },
    });
  };

  // 선택 구간 분석만 다시 (Phase 2만 — 전사는 보존). 고급 토글 시 Pro+정밀추론.
  const confirmReanalyze = () => {
    if (!activeFile || selectedIdxs.size === 0) return;
    const idxs = [...selectedIdxs];
    const fileId = activeFile.id;
    const hq = advancedMode;
    showConfirm({
      message: `선택한 ${idxs.length}개 문장의 번역·분석만 다시 합니다. 전사(문장·타임스탬프)는 그대로 유지됩니다.${advNote} 진행할까요?`,
      onConfirm: () => {
        reanalyzeSentences(fileId, idxs, { highQuality: hq });
        exitSelectMode();
      },
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
          onConfirm={() => { confirmState.onConfirm(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          onClose={() => setToastState(null)}
        />
      )}
      {cloudDownload && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-3 px-5 py-3 bg-slate-900/90 text-white rounded-2xl shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-sm font-bold whitespace-nowrap">
            영상 받는 중{cloudDownload.percent != null ? ` ${cloudDownload.percent}%` : '...'}
          </span>
        </div>
      )}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
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

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {activeFile ? (
          <div className="flex flex-col h-full">
            {/* 구간 다시 전사 툴바 */}
            {!isAnalyzing && !isSwitchingFile && !activeFile.error && transcriptData.length > 0 && (
              <div className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
                <div className="max-w-6xl mx-auto px-3 md:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
                  {!selectMode ? (
                    <button
                      onClick={() => setSelectMode(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition-colors"
                    >
                      <Wand2 size={14} /> 구간 다시 전사 / 분석
                    </button>
                  ) : (
                    <>
                      <span className="text-xs font-bold text-slate-600 shrink-0">
                        {selectedIdxs.size > 0
                          ? `${selectedIdxs.size}개 문장 선택됨`
                          : '고칠 문장을 탭하세요'}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 고급 토글: 켜면 아래 두 동작이 Pro+정밀추론으로 */}
                        <button
                          onClick={() => setAdvancedMode(v => !v)}
                          title="켜면 아래 '분석만 다시'·'전사부터 다시'가 Gemini 2.5 Pro + 정밀추론으로 실행됩니다 (정확·느림)"
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${advancedMode
                            ? 'text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 border-transparent shadow-sm'
                            : 'text-slate-500 bg-white border-slate-200 hover:bg-slate-50'}`}
                        >
                          <Sparkles size={14} /> 고급 {advancedMode ? 'ON' : 'OFF'}
                        </button>
                        <span className="w-px h-5 bg-slate-200" />
                        <button
                          onClick={exitSelectMode}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
                        >
                          <X size={14} /> 취소
                        </button>
                        <button
                          onClick={confirmReanalyze}
                          disabled={selectedIdxs.size === 0}
                          title="전사(문장·타임스탬프)는 그대로 두고 번역·분석만 다시"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Languages size={14} /> 분석만 다시{advancedMode && <Sparkles size={11} />}
                        </button>
                        <button
                          onClick={confirmRetranscribe}
                          disabled={selectedIdxs.size === 0}
                          title="해당 구간 오디오를 다시 들어 전사부터 새로 (분석도 자동)"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                          <Check size={14} /> 전사부터 다시{advancedMode && <Sparkles size={11} />}
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
                        {activeFile.data && activeFile.data.length > 0
                          ? `Applying 8 Principles & Deep Scan (${activeFile.data.filter(d => d.isAnalyzed).length}/${activeFile.data.length})`
                          : "Extracting timeline using Gemini 2.5..."
                        }
                      </p>
                    </div>
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
                  <div key={activeFileId} className="space-y-2 min-h-[200px] relative">
                    <ErrorBoundary>
                      {transcriptData.map((item, idx) => {
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
                          />
                        );
                      })}
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
              handlePrev={handlePrev}
              handleNext={handleNext}
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
