import {
    Play, Pause, Eye, EyeOff, Repeat, AlertCircle,
    SkipBack, SkipForward
} from 'lucide-react';

const PlayerControls = ({
    attachVideo, mediaUrl, isPlaying, currentTime, duration,
    playbackRate, isGlobalLoopActive, currentSentenceIdx,
    showAnalysis, showSpeedMenu,
    togglePlay, seekTo, handlePrev, handleNext,
    handleRateChange, toggleLoop,
    setShowAnalysis, setShowSpeedMenu,
    processFiles
}) => {
    return (
        <div className="flex-none bg-white/95 backdrop-blur-md border-t border-slate-200 z-50 shadow-lg pb-safe">
            <div className="max-w-5xl mx-auto flex flex-row items-stretch h-[85px] sm:h-[100px]">

                {/* Left: Video Thumbnail or Recovery UI */}
                <div className="relative bg-black w-[110px] sm:w-[140px] shrink-0 overflow-hidden group border-r border-slate-100 flex items-center justify-center">
                    {mediaUrl ? (
                        <>
                            <video
                                ref={attachVideo}
                                src={mediaUrl}
                                className="w-full h-full object-contain"
                                onClick={togglePlay}
                                playsInline
                            />
                            {!isPlaying && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                                    <Play size={24} fill="white" className="text-white ml-0.5" />
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center p-2 text-center space-y-2">
                            <AlertCircle size={24} className="text-red-400" />
                            <div className="text-[10px] font-bold text-slate-300 leading-tight">
                                원본 파일을<br />찾을 수 없습니다
                            </div>
                            <label className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded cursor-pointer transition-colors">
                                연결하기
                                <input type="file" className="hidden" onChange={(e) => processFiles(e.target.files)} accept="audio/*,video/*" />
                            </label>
                        </div>
                    )}
                </div>

                {/* Right: Controls Column */}
                <div className="flex-1 flex flex-col justify-center min-w-0">

                    {/* Row 1: Progress Bar */}
                    <div className="w-full px-3 pt-2 pb-1 flex items-center gap-2 text-[10px] sm:text-xs font-mono font-bold text-slate-500">
                        <span className="w-9 shrink-0 text-indigo-600 text-right">
                            {new Date(Math.max(0, currentTime) * 1000).toISOString().slice(14, 19)}
                        </span>

                        <div
                            className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden cursor-pointer group relative"
                            onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                if (duration) {
                                    seekTo(((e.clientX - rect.left) / rect.width) * duration);
                                }
                            }}
                        >
                            <div className="absolute inset-0 w-full h-full hover:bg-slate-200/40 transition-colors" />
                            <div
                                className="h-full bg-indigo-500 rounded-full relative group-hover:bg-indigo-600 transition-all duration-300 shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                            />
                        </div>

                        <span className="w-9 shrink-0 text-left">{duration ? new Date(duration * 1000).toISOString().slice(14, 19) : "00:00"}</span>
                    </div>

                    {/* Row 2: Control Buttons */}
                    <div className="flex items-center justify-between px-3 pl-1 py-1 gap-1">

                        {/* Speed & Analysis */}
                        <div className="flex items-center gap-1">
                            <div className="relative">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); }}
                                    aria-label={`재생 속도 ${playbackRate.toFixed(1)}x`}
                                    aria-expanded={showSpeedMenu}
                                    className={`
                    flex items-center justify-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all min-w-[40px] border
                    ${showSpeedMenu ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}
                  `}
                                >
                                    {playbackRate.toFixed(1)}x
                                </button>
                                {showSpeedMenu && (
                                    <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-xl border border-slate-100 p-2 z-[60] w-48">
                                        <div className="grid grid-cols-4 gap-1">
                                            {[0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0].map(rate => (
                                                <button
                                                    key={rate}
                                                    onClick={(e) => { e.stopPropagation(); handleRateChange(rate); setShowSpeedMenu(false); }}
                                                    className={`py-1.5 rounded text-[10px] font-bold ${Math.abs(playbackRate - rate) < 0.01 ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                                                >
                                                    {rate.toFixed(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => setShowAnalysis(!showAnalysis)}
                                aria-label={showAnalysis ? '번역/분석 숨기기' : '번역/분석 보기'}
                                className={`p-1.5 rounded-lg border transition-all ${showAnalysis ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-white text-slate-400 border-slate-200'}`}
                            >
                                {showAnalysis ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                        </div>

                        {/* Main Controls */}
                        <div className="flex items-center gap-2">
                            <button onClick={() => handlePrev(currentSentenceIdx)} aria-label="이전 문장" className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors">
                                <SkipBack size={18} className="fill-current" />
                            </button>

                            <button
                                onClick={togglePlay}
                                aria-label={isPlaying ? '일시정지' : '재생'}
                                className="w-10 h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-lg shadow-indigo-200 transition-transform active:scale-95"
                            >
                                {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
                            </button>

                            <button onClick={() => handleNext(currentSentenceIdx)} aria-label="다음 문장" className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors">
                                <SkipForward size={18} className="fill-current" />
                            </button>
                        </div>

                        {/* Right: Loop Only */}
                        <div className="flex items-center gap-1">
                            <button
                                onClick={toggleLoop}
                                aria-label={isGlobalLoopActive ? '문장 반복 끄기' : '문장 반복 켜기'}
                                aria-pressed={isGlobalLoopActive}
                                className={`p-1.5 rounded-lg border transition-all ${isGlobalLoopActive ? 'bg-amber-50 text-amber-600 border-amber-200 shadow-sm' : 'bg-white text-slate-400 border-slate-200'}`}
                                title="Toggle Global Sentence Loop"
                            >
                                <Repeat size={16} className={isGlobalLoopActive ? 'animate-pulse' : ''} />
                            </button>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};

export default PlayerControls;
