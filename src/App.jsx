import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileAudio, FileVideo, Settings, Home,
  X, Check, AlertCircle,
  Plus
} from 'lucide-react';
import { useMediaAnalysis } from './hooks/useMediaAnalysis';
import { useMediaCache } from './hooks/useMediaCache';
import { useAudioPlayer } from './hooks/useAudioPlayer';

// Components
import ErrorBoundary from './components/ErrorBoundary';
import TranscriptItem from './components/TranscriptItem';
import SettingsModal from './components/SettingsModal';
import CacheHistoryModal from './components/CacheHistoryModal';
import PlayerControls from './components/PlayerControls';
import EmptyState from './components/EmptyState';


const App = () => {
  const [apiKey, setApiKey] = useState(localStorage.getItem('miniapp_gemini_key') || import.meta.env.VITE_GEMINI_API_KEY || '');
  const [stage1Model, setStage1Model] = useState(localStorage.getItem('miniapp_stage1_model') || 'gemini-2.5-flash');
  const [stage2Model, setStage2Model] = useState(localStorage.getItem('miniapp_stage2_model') || 'gemini-2.5-flash');
  const [bufferTime, setBufferTime] = useState(parseFloat(localStorage.getItem('miniapp_buffer_time')) || 0.3);
  const [temperature, setTemperature] = useState(parseFloat(localStorage.getItem('miniapp_temperature')) || 0.5);
  const [topP, setTopP] = useState(parseFloat(localStorage.getItem('miniapp_top_p')) || 0.7);

  // Multi-file state
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showCacheHistory, setShowCacheHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSwitchingFile, setIsSwitchingFile] = useState(false);

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

  const { isDragging, onDragOver, onDragLeave, onDrop, processFiles, runStage2 } = useMediaAnalysis({
    setFiles, setActiveFileId, setIsSwitchingFile, resetPlayerState,
    refreshCacheKeys: () => refreshCacheKeysRef.current && refreshCacheKeysRef.current(),
    apiKey, stage1Model, stage2Model, temperature, topP, stage2AbortRef
  });

  const { cacheKeys, deleteCache, clearAllCache, loadCache, refreshCacheKeys } = useMediaCache({
    files, setFiles, setActiveFileId, setShowSettings, setShowCacheHistory, setIsSwitchingFile,
    resetPlayerState, runStage2, apiKey, stage2Model, stage2AbortRef
  });

  useEffect(() => {
    refreshCacheKeysRef.current = refreshCacheKeys;
  }, [refreshCacheKeys]);

  const saveConfiguration = (key, s1Model, s2Model, buffer, temp, p) => {
    localStorage.setItem('miniapp_gemini_key', key);
    localStorage.setItem('miniapp_stage1_model', s1Model);
    localStorage.setItem('miniapp_stage2_model', s2Model);
    localStorage.setItem('miniapp_buffer_time', buffer.toString());
    localStorage.setItem('miniapp_temperature', temp.toString());
    localStorage.setItem('miniapp_top_p', p.toString());
    setApiKey(key);
    setStage1Model(s1Model);
    setStage2Model(s2Model);
    setBufferTime(buffer);
    setTemperature(temp);
    setTopP(p);
    setShowSettings(false);
  };

  useEffect(() => {
    if (showSettings || showCacheHistory) refreshCacheKeys();
  }, [showSettings, showCacheHistory, refreshCacheKeys]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!mediaUrl || !activeFile?.data?.length) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const data = activeFile.data;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'Enter':
          e.preventDefault();
          toggleLoop();
          break;
        case 'KeyB':
          e.preventDefault();
          toggleGlobalAnalysis();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (data.length > 0) {
            const idx = activeIdxRef.current !== null ? activeIdxRef.current : 0;
            const prevIdx = Math.max(0, idx - 1);
            if (prevIdx !== idx) jumpToSentence(prevIdx);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (data.length > 0) {
            const idx = activeIdxRef.current !== null ? activeIdxRef.current : 0;
            const nextIdx = Math.min(data.length - 1, idx + 1);
            if (nextIdx !== idx) jumpToSentence(nextIdx);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (videoRef.current) {
            lastActionTimeRef.current = Date.now();
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (videoRef.current) {
            lastActionTimeRef.current = Date.now();
            videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mediaUrl, activeFile, togglePlay, toggleLoop, toggleGlobalAnalysis, jumpToSentence, activeIdxRef, lastActionTimeRef, videoRef]);

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

  // ─── Empty State ───
  if (files.length === 0) {
    return (
      <EmptyState
        isDragging={isDragging}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        processFiles={processFiles}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        apiKey={apiKey}
        setApiKey={setApiKey}
        stage1Model={stage1Model}
        setStage1Model={setStage1Model}
        stage2Model={stage2Model}
        setStage2Model={setStage2Model}
        bufferTime={bufferTime}
        setBufferTime={setBufferTime}
        temperature={temperature}
        setTemperature={setTemperature}
        topP={topP}
        setTopP={setTopP}
        saveConfiguration={saveConfiguration}
        cacheKeys={cacheKeys}
        loadCache={loadCache}
        deleteCache={deleteCache}
        clearAllCache={clearAllCache}
      />
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
      <header className="relative z-50 bg-white/80 border-b border-slate-100 flex-none h-14 sm:h-16 flex items-center justify-between px-3 sm:px-6">
        <button
          onClick={() => { setFiles([]); setActiveFileId(null); resetPlayerState(); }}
          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
          title="Go to Home"
        >
          <Home size={20} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="relative">
            <button
              onClick={() => setShowCacheHistory(true)}
              className="w-full text-center px-4 py-1.5 hover:bg-slate-50 rounded-xl transition-colors group"
            >
              {activeFile ? (
                <div className="flex items-center justify-center gap-2 text-slate-900">
                  {activeFile.file.type.startsWith('video') ? (
                    <FileVideo size={16} className={`shrink-0 ${isAnalyzing || isSwitchingFile ? 'text-slate-400 animate-pulse' : 'text-indigo-600'}`} />
                  ) : (
                    <FileAudio size={16} className={`shrink-0 ${isAnalyzing || isSwitchingFile ? 'text-slate-400 animate-pulse' : 'text-indigo-600'}`} />
                  )}
                  <span className={`text-base font-bold truncate group-hover:text-indigo-700 transition-colors ${isAnalyzing || isSwitchingFile ? 'text-slate-500 italic' : ''}`}>
                    {isAnalyzing
                      ? `Extracting Transcript...`
                      : (activeFile?.data && activeFile.data.some(d => !d.isAnalyzed)
                        ? `Analyzing Details (${activeFile.data.filter(d => d.isAnalyzed).length}/${activeFile.data.length})`
                        : activeFile?.file?.name || "Ready")
                    }
                  </span>
                </div>
              ) : (
                <span className="text-base font-bold text-slate-400">Select File...</span>
              )}
            </button>
          </div>
        </div>

        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
        >
          <Settings size={20} />
        </button>
      </header>

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
              activeSentenceIdx={activeSentenceIdx}
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
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="max-w-md w-full p-8 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-center space-y-4">
                <div className="inline-flex p-4 bg-slate-50 rounded-2xl text-slate-400">
                  <FileAudio size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">No active file</h3>
                  <p className="text-slate-500 mt-1">Upload or select a file to start the analysis.</p>
                </div>
                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 space-y-2 text-left">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Current Models</p>
                  <p className="text-sm text-slate-600"><span className="font-bold text-indigo-600">Stage 1</span> (전사): {stage1Model}</p>
                  <p className="text-sm text-slate-600"><span className="font-bold text-purple-600">Stage 2</span> (분석): {stage2Model}</p>
                  <button
                    onClick={() => setShowSettings(true)}
                    className="w-full mt-2 px-4 py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all"
                  >
                    모델 설정 변경
                  </button>
                </div>
                <button
                  onClick={() => setShowCacheHistory(true)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100"
                >
                  Select from List
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          apiKey={apiKey}
          setApiKey={setApiKey}
          stage1Model={stage1Model}
          setStage1Model={setStage1Model}
          stage2Model={stage2Model}
          setStage2Model={setStage2Model}
          bufferTime={bufferTime}
          setBufferTime={setBufferTime}
          temperature={temperature}
          setTemperature={setTemperature}
          topP={topP}
          setTopP={setTopP}
          saveConfiguration={saveConfiguration}
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
          onClose={() => setShowCacheHistory(false)}
        />
      )}

    </div>
  );
};

export default App;
