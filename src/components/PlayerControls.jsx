import { useRef, useEffect, useState } from 'react';
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

// 영상 프리뷰 박스의 가로세로비.
// 박스를 정사각형으로 두면 가로 영상이 object-contain으로 위아래 검은 띠에 잘려
// 실제 그림이 박스의 절반밖에 안 됐다. 그래서 박스 자체를 영상 비율에 맞춘다.
// 가로 영상은 16:9까지 넓히고(띠 제거), 세로 영상은 정사각형까지만 좁힌다
// (그대로 두면 박스가 극단적으로 홀쭉해져 탭 영역이 사라짐).
const PREVIEW_ASPECT_MIN = 1;
const PREVIEW_ASPECT_MAX = 16 / 9;

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

    // 프리뷰 박스 비율: 영상 메타데이터를 읽어 실제 비율로 맞춘다.
    // 파일이 바뀌면 렌더 중에 기본값으로 되돌린다(effect+setState 대신 React 권장 패턴).
    const [previewAspect, setPreviewAspect] = useState(PREVIEW_ASPECT_MAX);
    const [aspectSrc, setAspectSrc] = useState(mediaUrl);
    if (aspectSrc !== mediaUrl) {
        setAspectSrc(mediaUrl);
        setPreviewAspect(PREVIEW_ASPECT_MAX);
    }
    const handleLoadedMetadata = (e) => {
        const v = e.currentTarget;
        if (!v.videoWidth || !v.videoHeight) return;   // 오디오 전용 파일
        const ratio = v.videoWidth / v.videoHeight;
        setPreviewAspect(Math.min(PREVIEW_ASPECT_MAX, Math.max(PREVIEW_ASPECT_MIN, ratio)));
    };

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
            <div className="max-w-5xl mx-auto flex flex-col h-[85px] sm:h-[100px]">

                {/* 사운드+클럭 드라이버: 오디오 요소(화면 꺼져도 자동정지 안 됨).
                    display:none은 피하고 sr-only로 렌더 트리에 유지. */}
                {mediaUrl && <audio ref={attachVideo} src={mediaUrl} className="sr-only" />}

                {/* Row 1: Progress Bar — 패널 전체 폭(영상 위까지)을 써서 탐색 정확도를 높인다 */}
                <div className="flex-none w-full px-2 sm:px-3 pt-1.5 pb-1 flex items-center gap-[min(2vw,8px)] text-[10px] sm:text-xs font-mono font-bold text-slate-500">
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

                {/* Row 2: 영상 프리뷰 + 컨트롤 버튼 */}
                <div className="flex-1 min-h-0 flex flex-row items-stretch">

                    {/* Left: Video Thumbnail or Recovery UI
                        박스 폭 = 높이 × 영상비율(aspectRatio) → 검은 띠 없이 남는 폭을 전부 그림에 쓴다.

                        상한 calc(66vw - 108px)이 반드시 필요하다: 이 폭은 바 높이에서 파생되므로
                        화면이 좁아져도 줄지 않는데, 버튼 행이 실제로 필요한 폭은 측정 결과
                        (0.335 × 화면폭 + 101px)이다. 상한이 없으면 크게 확대했을 때(240~280px)
                        박스가 버튼 자리를 먹어 반복 버튼이 다시 잘린다. 상한 = 남는 폭 - 여유 8px.
                        (Chrome은 aspect-ratio로 정해진 폭을 flex-shrink 대상으로 보지 않아
                         shrink에 기댈 수 없다. 그래서 max-width로 직접 막는다.) */}
                    <div
                        className={`relative bg-black h-full shrink-0 max-w-[calc(66vw_-_108px)] overflow-hidden group border-r border-slate-100 flex items-center justify-center ${mediaUrl ? '' : 'w-[min(26vw,120px)]'}`}
                        style={mediaUrl ? { aspectRatio: previewAspect } : undefined}
                    >
                        {mediaUrl ? (
                            <>
                                <video
                                    ref={visualVideoRef}
                                    src={mediaUrl}
                                    className="w-full h-full object-contain"
                                    onClick={togglePlay}
                                    onLoadedMetadata={handleLoadedMetadata}
                                    playsInline
                                    muted
                                />
                                {!isPlaying && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                                        <Play className={`${ICON_LG} text-white ml-0.5`} fill="white" />
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-1 text-center gap-1">
                                <AlertCircle className={`${ICON_SM} text-red-400`} />
                                <div className="text-[9px] font-bold text-slate-300 leading-tight">
                                    원본 파일 없음
                                </div>
                                <label className="px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-bold rounded cursor-pointer transition-colors">
                                    연결하기
                                    <input type="file" className="hidden" onChange={(e) => processFiles(e.target.files)} accept="audio/*,video/*" />
                                </label>
                            </div>
                        )}
                    </div>

                    {/* Right: Control Buttons — 필요한 폭은 무조건 확보(shrink 0), 남으면 늘어남 */}
                    <div className="flex-[1_0_auto] flex items-center justify-between px-2 pl-1 gap-[min(1vw,4px)]">

                        {/* Speed & Analysis */}
                        <div className="flex items-center gap-[min(1vw,4px)]">
                            <div className="relative">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); }}
                                    aria-label={`재생 속도 ${playbackRate.toFixed(1)}x`}
                                    aria-expanded={showSpeedMenu}
                                    className={`
                    flex items-center justify-center gap-0.5 px-[min(1.5vw,6px)] rounded-lg font-bold transition-all border
                    text-[min(2.9vw,11px)] min-w-[min(9vw,44px)] min-h-[min(11vw,44px)]
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
                                className={`flex items-center justify-center shrink-0 min-w-[min(9vw,44px)] min-h-[min(11vw,44px)] rounded-lg border transition-all ${showAnalysis ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-white text-slate-400 border-slate-200'}`}
                            >
                                {showAnalysis ? <Eye className={ICON_SM} /> : <EyeOff className={ICON_SM} />}
                            </button>
                        </div>

                        {/* Main Controls */}
                        <div className="flex items-center gap-[min(1.2vw,6px)]">
                            <button onClick={() => handlePrev(currentSentenceIdx)} aria-label="이전 문장" className="flex items-center justify-center shrink-0 min-w-[min(9vw,44px)] min-h-[min(11vw,44px)] text-slate-400 hover:text-indigo-600 transition-colors">
                                <SkipBack className={`${ICON_MD} fill-current`} />
                            </button>

                            <button
                                onClick={togglePlay}
                                aria-label={isPlaying ? '일시정지' : '재생'}
                                className="w-[min(10vw,44px)] h-[min(10vw,44px)] shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-lg shadow-indigo-200 transition-transform active:scale-95"
                            >
                                {isPlaying
                                    ? <Pause className={ICON_LG} fill="currentColor" />
                                    : <Play className={`${ICON_LG} ml-0.5`} fill="currentColor" />}
                            </button>

                            <button onClick={() => handleNext(currentSentenceIdx)} aria-label="다음 문장" className="flex items-center justify-center shrink-0 min-w-[min(9vw,44px)] min-h-[min(11vw,44px)] text-slate-400 hover:text-indigo-600 transition-colors">
                                <SkipForward className={`${ICON_MD} fill-current`} />
                            </button>
                        </div>

                        {/* Right: Loop Only */}
                        <div className="flex items-center gap-[min(1vw,4px)]">
                            <button
                                onClick={toggleLoop}
                                aria-label={isGlobalLoopActive ? '문장 반복 끄기' : '문장 반복 켜기'}
                                aria-pressed={isGlobalLoopActive}
                                className={`flex items-center justify-center shrink-0 min-w-[min(9vw,44px)] min-h-[min(11vw,44px)] rounded-lg border transition-all ${isGlobalLoopActive ? 'bg-amber-50 text-amber-600 border-amber-200 shadow-sm' : 'bg-white text-slate-400 border-slate-200'}`}
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
