import { useRef, useEffect } from 'react';
import {
    Play, Pause, Eye, EyeOff, Repeat, AlertCircle,
    SkipBack, SkipForward
} from 'lucide-react';
import { formatClock } from '../utils/timeUtils';

// 재생 속도 프리셋 (0.5x ~ 2.0x, 0.1 간격)
const PLAYBACK_RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];

// 컨트롤 바는 모든 크기를 min(Nvw, 최대px)로 잡는다.
// 브라우저 확대(110% 등)를 하면 CSS 뷰포트 폭이 줄어드는데, px 고정값이면
// 바 전체 폭이 화면을 넘겨 마지막 버튼(반복)이 잘려 나간다. vw 비례로 두면
// 확대 시 버튼·썸네일·간격이 함께 축소돼 어떤 배율에서도 한 줄에 다 들어온다.
// 아이콘도 같이 줄여야 하므로 lucide의 size 대신 클래스로 지정(SVG 속성보다 CSS가 우선).
const ICON_SM = 'w-[min(4.2vw,16px)] h-[min(4.2vw,16px)]';
const ICON_MD = 'w-[min(4.8vw,18px)] h-[min(4.8vw,18px)]';
const ICON_LG = 'w-[min(5.3vw,20px)] h-[min(5.3vw,20px)]';

const PlayerControls = ({
    attachVideo, mediaUrl, isPlaying, currentTime, duration,
    playbackRate, isGlobalLoopActive, currentSentenceIdx,
    showAnalysis, showSpeedMenu,
    togglePlay, seekTo, handlePrev, handleNext,
    handleRateChange, toggleLoop,
    setShowAnalysis, setShowSpeedMenu,
    processFiles
}) => {
    // 백그라운드 연속재생: 소리는 <audio>가 담당(videoRef가 여기 붙음).
    // 크롬은 <video>를 화면 꺼짐 시 자동 정지시키나 <audio>는 계속 재생하므로,
    // 재생/클럭을 오디오로 옮기고 <video>는 음소거 시각 프리뷰로만 쓴다.
    const visualVideoRef = useRef(null);

    // 뮤트 프리뷰 영상: 재생/정지 따라감 (백그라운드에선 재생 안 함)
    useEffect(() => {
        const vid = visualVideoRef.current;
        if (!vid) return;
        if (isPlaying && vid.paused && !document.hidden) vid.play().catch(() => { /* noop */ });
        else if (!isPlaying && !vid.paused) vid.pause();
    }, [isPlaying, mediaUrl]);

    // 화면 꺼짐 시 뮤트 프리뷰 정지 / 복귀 시 재개 (소리는 <audio>가 계속 냄)
    useEffect(() => {
        const onVis = () => {
            const vid = visualVideoRef.current;
            if (!vid) return;
            if (document.hidden) { try { vid.pause(); } catch { /* noop */ } }
            else if (isPlaying) vid.play().catch(() => { /* noop */ });
        };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, [isPlaying]);

    // 뮤트 프리뷰: 큰 드리프트(시크 등)만 오디오 위치로 보정 (미세 드리프트는 무시)
    useEffect(() => {
        const vid = visualVideoRef.current;
        if (!vid) return;
        if (Math.abs((vid.currentTime || 0) - currentTime) > 0.4) {
            try { vid.currentTime = currentTime; } catch { /* noop */ }
        }
    }, [currentTime]);

    return (
        <div className="flex-none bg-white/95 backdrop-blur-md border-t border-slate-200 z-50 shadow-lg pb-safe">
            <div className="max-w-5xl mx-auto flex flex-row items-stretch h-[85px] sm:h-[100px]">

                {/* 사운드+클럭 드라이버: 오디오 요소(화면 꺼져도 자동정지 안 됨).
                    display:none은 피하고 sr-only로 렌더 트리에 유지. */}
                {mediaUrl && <audio ref={attachVideo} src={mediaUrl} className="sr-only" />}

                {/* Left: Video Thumbnail or Recovery UI */}
                <div className="relative bg-black w-[min(26vw,140px)] shrink-0 overflow-hidden group border-r border-slate-100 flex items-center justify-center">
                    {mediaUrl ? (
                        <>
                            <video
                                ref={visualVideoRef}
                                src={mediaUrl}
                                className="w-full h-full object-contain"
                                onClick={togglePlay}
                                playsInline
                                muted
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
                    <div className="w-full px-2 sm:px-3 pt-2 pb-1 flex items-center gap-[min(2vw,8px)] text-[10px] sm:text-xs font-mono font-bold text-slate-500">
                        <span className="w-[min(9.5vw,36px)] shrink-0 text-indigo-600 text-right">
                            {formatClock(currentTime)}
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

                        <span className="w-[min(9.5vw,36px)] shrink-0 text-left">{duration ? formatClock(duration) : "00:00"}</span>
                    </div>

                    {/* Row 2: Control Buttons */}
                    <div className="flex items-center justify-between px-2 pl-1 py-1 gap-[min(1vw,4px)]">

                        {/* Speed & Analysis */}
                        <div className="flex items-center gap-[min(1vw,4px)]">
                            <div className="relative">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); }}
                                    aria-label={`재생 속도 ${playbackRate.toFixed(1)}x`}
                                    aria-expanded={showSpeedMenu}
                                    className={`
                    flex items-center justify-center gap-0.5 px-[min(1.5vw,6px)] rounded-lg font-bold transition-all border
                    text-[min(2.9vw,11px)] min-w-[min(10vw,44px)] min-h-[min(11vw,44px)]
                    ${showSpeedMenu ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}
                  `}
                                >
                                    {playbackRate.toFixed(1)}x
                                </button>
                                {showSpeedMenu && (
                                    <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-xl border border-slate-100 p-2 z-[60] w-48">
                                        <div className="grid grid-cols-4 gap-1">
                                            {PLAYBACK_RATES.map(rate => (
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
                                className={`flex items-center justify-center shrink-0 min-w-[min(10vw,44px)] min-h-[min(11vw,44px)] rounded-lg border transition-all ${showAnalysis ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-white text-slate-400 border-slate-200'}`}
                            >
                                {showAnalysis ? <Eye className={ICON_SM} /> : <EyeOff className={ICON_SM} />}
                            </button>
                        </div>

                        {/* Main Controls */}
                        <div className="flex items-center gap-[min(1.2vw,6px)]">
                            <button onClick={() => handlePrev(currentSentenceIdx)} aria-label="이전 문장" className="flex items-center justify-center shrink-0 min-w-[min(10vw,44px)] min-h-[min(11vw,44px)] text-slate-400 hover:text-indigo-600 transition-colors">
                                <SkipBack className={`${ICON_MD} fill-current`} />
                            </button>

                            <button
                                onClick={togglePlay}
                                aria-label={isPlaying ? '일시정지' : '재생'}
                                className="w-[min(11vw,44px)] h-[min(11vw,44px)] shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-lg shadow-indigo-200 transition-transform active:scale-95"
                            >
                                {isPlaying
                                    ? <Pause className={ICON_LG} fill="currentColor" />
                                    : <Play className={`${ICON_LG} ml-0.5`} fill="currentColor" />}
                            </button>

                            <button onClick={() => handleNext(currentSentenceIdx)} aria-label="다음 문장" className="flex items-center justify-center shrink-0 min-w-[min(10vw,44px)] min-h-[min(11vw,44px)] text-slate-400 hover:text-indigo-600 transition-colors">
                                <SkipForward className={`${ICON_MD} fill-current`} />
                            </button>
                        </div>

                        {/* Right: Loop Only */}
                        <div className="flex items-center gap-[min(1vw,4px)]">
                            <button
                                onClick={toggleLoop}
                                aria-label={isGlobalLoopActive ? '문장 반복 끄기' : '문장 반복 켜기'}
                                aria-pressed={isGlobalLoopActive}
                                className={`flex items-center justify-center shrink-0 min-w-[min(10vw,44px)] min-h-[min(11vw,44px)] rounded-lg border transition-all ${isGlobalLoopActive ? 'bg-amber-50 text-amber-600 border-amber-200 shadow-sm' : 'bg-white text-slate-400 border-slate-200'}`}
                                title="Toggle Global Sentence Loop"
                            >
                                <Repeat className={`${ICON_SM} ${isGlobalLoopActive ? 'animate-pulse' : ''}`} />
                            </button>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};

export default PlayerControls;
