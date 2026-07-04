import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertCircle, RotateCcw
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


const App = () => {
  const { config, updateField } = useSettings();

  // 기기 간 동기화용 비밀 암호
  const [passphrase, setPassphraseState] = useState(() => getPassphrase());
  const { apiKey, stage1Model, stage2Model, bufferTime, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes } = config;

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
    videoRef, activeSentenceIdx, currentTime, duration, playbackRate, isGlobalLoopActive, isPlaying,
    manualScrollNonce, handleRateChange, seekTo, togglePlay, toggleLoop, jumpToSentence,
    handlePrev, handleNext, resetPlayerState, activeIdxRef, lastActionTimeRef
  } = useAudioPlayer({ activeFile, bufferTime });

  const refreshCacheKeysRef = useRef(null);

  const { isDragging, onDragOver, onDragLeave, onDrop, processFiles, runStage2, retryAnalysis } = useMediaAnalysis({
    setFiles, setActiveFileId, setIsSwitchingFile, resetPlayerState,
    refreshCacheKeys: () => refreshCacheKeysRef.current && refreshCacheKeysRef.current(),
    apiKey, stage1Model, stage2Model, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, stage2AbortRef,
    showToast
  });

  const { cacheKeys, deleteCache, clearAllCache, loadCache, refreshCacheKeys,
    cloudItems, refreshCloud, loadCloud, deleteCloud, cloudDownload } = useMediaCache({
    files, setFiles, setActiveFileId, setShowSettings, setShowCacheHistory, setIsSwitchingFile,
    resetPlayerState, runStage2, apiKey, stage2Model, stage2AbortRef, showConfirm, showToast
  });

  // 즐겨찾기 (기기 간 동기화)
  const { isFavorite, toggleFavorite } = useFavorites(passphrase);

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
        deleteCache={deleteCache}
        clearAllCache={clearAllCache}
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
            <div className="flex-1 w-full overflow-y-auto bg-[#F8FAFC]" onClick={() => { setShowSpeedMenu(false); }}>
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
              videoRef={videoRef}
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
          deleteCache={deleteCache}
          clearAllCache={clearAllCache}
          processFiles={processFiles}
          removeFile={removeFile}
          setActiveFileId={setActiveFileId}
          cloudItems={cloudItems}
          loadCloud={loadCloud}
          deleteCloud={deleteCloud}
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
