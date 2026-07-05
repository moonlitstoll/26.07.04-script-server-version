import { useState, useRef, useEffect, useCallback } from 'react';

const ACTION_GUARD_MS = 1500;   // 수동 점프 후 하이라이트 보호 시간
const SYNC_INTERVAL_MS = 100;   // 재생 위치 동기화 주기

export const useAudioPlayer = ({ activeFile, bufferTime = 0.3 }) => {
    const [activeSentenceIdx, setActiveSentenceIdx] = useState(-1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(parseFloat(localStorage.getItem('miniapp_playback_rate')) || 1.0);
    const [isGlobalLoopActive, setIsGlobalLoopActive] = useState(localStorage.getItem('miniapp_loop_active') === 'true');
    const [isPlaying, setIsPlaying] = useState(false);
    const [manualScrollNonce, setManualScrollNonce] = useState(0);

    const videoRef = useRef(null);
    const activeIdxRef = useRef(-1);
    const isGlobalLoopActiveRef = useRef(isGlobalLoopActive);
    const loopTargetIdxRef = useRef(null); // [Phase 4] 루프 고정 타겟 인덱스
    const lastActionTimeRef = useRef(0); // [4차 수정] 시간 기반 의도 보호 가드

    // <video>가 실제로 마운트된 시점을 상태로 추적 → 싱크 엔진/복원이 비디오 준비 후 확실히 실행
    // (첫 로드에서 비디오가 늦게 붙어 리스너가 안 달리던 경합 방지)
    const [videoNode, setVideoNode] = useState(null);
    const pendingSeekRef = useRef(null); // 비디오 준비 전 예약된 seek 시각(초)
    const attachVideo = useCallback((node) => {
        videoRef.current = node;
        setVideoNode(node);
    }, []);

    const triggerManualScroll = useCallback(() => setManualScrollNonce(Date.now()), []);

    useEffect(() => {
        isGlobalLoopActiveRef.current = isGlobalLoopActive;
    }, [isGlobalLoopActive]);

    const mediaUrl = activeFile?.url || null;
    const isAnalyzing = activeFile?.isAnalyzing || false;

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate, mediaUrl, isAnalyzing]);

    const handleRateChange = (rate) => {
        setPlaybackRate(rate);
        localStorage.setItem('miniapp_playback_rate', rate.toString());
    };

    const seekTo = useCallback((s) => {
        const v = videoRef.current;
        if (v) {
            triggerManualScroll();
            lastActionTimeRef.current = Date.now();
            setIsPlaying(true);

            const targetTime = Math.max(0, Math.min(s, v.duration || 999999));
            v.currentTime = targetTime;

            v.play().catch((err) => {
                if (err.name !== 'AbortError') {
                    console.error('[Player] seekTo play() failed:', err);
                    setIsPlaying(false);
                }
            });
        }
    }, [triggerManualScroll]);

    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        lastActionTimeRef.current = Date.now();

        if (v.paused) {
            // 재생 시작 직전, 예약된 복원 위치가 있으면 먼저 이동 (모바일: 메타데이터 지연 대응)
            if (pendingSeekRef.current != null && v.readyState >= 1) {
                try { v.currentTime = pendingSeekRef.current; } catch { /* noop */ }
                pendingSeekRef.current = null;
            }
            setIsPlaying(true);
            v.play().catch((err) => {
                if (err.name !== 'AbortError') {
                    console.error('[Player] togglePlay play() failed:', err);
                    setIsPlaying(false);
                }
            });
        } else {
            setIsPlaying(false);
            v.pause();
        }
    }, []);

    const toggleLoop = useCallback(() => {
        triggerManualScroll();
        setIsGlobalLoopActive(prev => {
            const next = !prev;
            localStorage.setItem('miniapp_loop_active', next.toString());
            if (next) {
                // 루프가 켜질 때 현재 인덱스를 고정
                loopTargetIdxRef.current = activeIdxRef.current;
            }
            if (videoRef.current) {
                // [Phase 4] 한곡 반복 수정: 한문장 반복이 켜지면 네이티브 루프(한곡 반복)는 꺼야 함
                videoRef.current.loop = !next;
            }
            return next;
        });
    }, [triggerManualScroll]);

    const jumpToSentence = useCallback((index) => {
        if (activeFile?.data && index >= 0 && index < activeFile.data.length) {
            triggerManualScroll();
            // Global Loop 루프 타겟 업데이트
            loopTargetIdxRef.current = index;
            seekTo(Math.max(0, activeFile.data[index].seconds - bufferTime));
        }
    }, [seekTo, activeFile, triggerManualScroll, bufferTime]);

    const handlePrev = useCallback((currentIndex) => {
        if (activeFile?.data?.length) {
            const prevIndex = (currentIndex - 1 + activeFile.data.length) % activeFile.data.length;
            jumpToSentence(prevIndex);
        }
    }, [jumpToSentence, activeFile]);

    const handleNext = useCallback((currentIndex) => {
        if (activeFile?.data?.length) {
            const nextIndex = (currentIndex + 1) % activeFile.data.length;
            jumpToSentence(nextIndex);
        }
    }, [jumpToSentence, activeFile]);

    // ABSOLUTE TRACKING ENGINE (Float Comparison)
    // INVINCIBLE TRACKING ENGINE (Mathematical Absolute Comparison)
    const findActiveIndex = useCallback((currentSeconds, data) => {
        if (!data || data.length === 0) return 0;
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].startSeconds <= currentSeconds) return i;
        }
        return 0;
    }, []);

    // High-Resolution Sync Engine (Absolute Tracking)
    // videoNode는 deps에만 두어 '비디오 마운트 시 재실행' 트리거로 쓰고, 실제 요소는 ref로 읽는다.
    useEffect(() => {
        const v = videoRef.current;
        if (!v || !activeFile?.data) return;

        // [Phase 4] 한곡 반복 수정: 한문장 반복이 꺼져있을 때만 전체 반복(native loop) 활성화
        v.loop = !isGlobalLoopActive;

        const runSync = () => {
            if (!v) return;
            const now = v.currentTime;
            setCurrentTime(now);

            const data = activeFile.data;
            if (!data || data.length === 0) return;

            const actualIdx = findActiveIndex(now, data);

            // [추가] Action Guard: 수동 점프 직후 1.5초간 하이라이트 강제 고정
            // 점프 시 Math.max(0, seconds - bufferTime)으로 가기 때문에, 실제 index 구간에 진입하기 전까지 하이라이트를 유지함
            const timeSinceAction = Date.now() - lastActionTimeRef.current;
            const isWithinActionGuard = timeSinceAction < ACTION_GUARD_MS;
            const targetIdx = loopTargetIdxRef.current;

            let finalIdx = actualIdx;
            if (isWithinActionGuard && targetIdx !== null && data[targetIdx]) {
                const item = data[targetIdx];
                const bufferStart = Math.max(0, item.seconds - (bufferTime + 0.2)); // 약간의 마진 포함
                const itemEnd = data[targetIdx + 1] ? data[targetIdx + 1].seconds : (v.duration || 999999);

                // 현재 재생 위치가 타겟 문장의 버퍼 구간~끝 구간 내에 있다면 하이라이트 고정
                if (now >= bufferStart && now < itemEnd) {
                    finalIdx = targetIdx;
                }
            }

            // Loop Handling (Global Mode)
            if (isGlobalLoopActiveRef.current) {
                // [Phase 4] 루프 락(Loop Lock): 지정된 loopTargetIdxRef를 기반으로 반복 처리
                let loopIdx = loopTargetIdxRef.current;

                // 만약 타겟이 없으면 현재 실시간 인덱스로 초기화
                if (loopIdx === null) {
                    loopIdx = actualIdx;
                    loopTargetIdxRef.current = actualIdx;
                }

                if (data[loopIdx]) {
                    const item = data[loopIdx];
                    const start = Math.max(0, item.seconds - bufferTime);
                    const nextItem = data[loopIdx + 1];
                    // [Phase 4] 조기 종료 버그 수정: 5초 제한을 제거하고 실제 다음 문장 시작 전(+버퍼 버퍼)까지 재생
                    const end = nextItem
                        ? nextItem.seconds + bufferTime
                        : (v.duration ? v.duration + bufferTime : 999999);

                    // [Phase 4] 수동 시크(Seek) 대응: 사용자가 루프 범위 밖으로 강제 이동했다면 루프 타겟 재설정
                    if (v.currentTime < start - 2.0 || v.currentTime > end + 2.0) {
                        loopTargetIdxRef.current = actualIdx;
                        return;
                    }

                    // 1. 루프 범위 체크 및 되돌리기
                    if (v.currentTime >= end - 0.1 || v.ended) {
                        // [4차 수정] 루프 재시작 시에도 버퍼 시간 보호
                        lastActionTimeRef.current = Date.now();
                        setIsPlaying(true);

                        v.currentTime = start;
                        v.play().catch((err) => {
                            if (err.name !== 'AbortError') {
                                console.error('[Player] loop restart play() failed:', err);
                                setIsPlaying(false);
                            }
                        });
                        return;
                    }

                    // 2. 루프 중 UI 하이라이트 강제 고정 (버퍼 구간에서도 해당 문장이 활성 상태로 보이게 함)
                    if (activeIdxRef.current !== loopIdx) {
                        activeIdxRef.current = loopIdx;
                        setActiveSentenceIdx(loopIdx);
                    }
                }
            } else {
                // 루프가 아닐 때만 정상 실시간 인덱스 업데이트
                if (finalIdx !== activeIdxRef.current) {
                    activeIdxRef.current = finalIdx;
                    setActiveSentenceIdx(finalIdx);
                    // 루프가 꺼져있을 때도 타겟 인덱스는 현재 위치를 따라가게 함
                    // 단, 가드 중에는 수동 설정된 값을 덮어쓰지 않도록 함
                    if (!isWithinActionGuard) {
                        loopTargetIdxRef.current = finalIdx;
                    }
                }
            }
        };

        let pulseId = null;
        const managePulse = () => {
            if (!v.paused && !pulseId) {
                pulseId = setInterval(runSync, SYNC_INTERVAL_MS);
            } else if (v.paused && pulseId) {
                clearInterval(pulseId);
                pulseId = null;
            }
        };
        const handlePlay = () => { runSync(); managePulse(); };
        const handlePause = () => { managePulse(); };
        const handleLoadedMetadata = () => { setDuration(v.duration); };

        // 1. Event Listeners (Optimized)
        v.addEventListener('timeupdate', runSync);
        v.addEventListener('seeked', runSync);
        v.addEventListener('playing', handlePlay);
        v.addEventListener('pause', handlePause);
        v.addEventListener('ended', handlePause);
        v.addEventListener('loadedmetadata', handleLoadedMetadata);

        // Init pulse based on current state
        managePulse();
        // Fallback for already loaded metadata
        if (v.readyState >= 1) setDuration(v.duration);

        return () => {
            v.removeEventListener('timeupdate', runSync);
            v.removeEventListener('seeked', runSync);
            v.removeEventListener('playing', handlePlay);
            v.removeEventListener('pause', handlePause);
            v.removeEventListener('ended', handlePause);
            v.removeEventListener('loadedmetadata', handleLoadedMetadata);
            if (pulseId) clearInterval(pulseId);
        };
    }, [activeFile, findActiveIndex, isGlobalLoopActive, bufferTime, videoNode]);

    // 예약된 seek을 비디오가 준비되는 대로 적용 (늦게 마운트되거나 모바일서 메타데이터가 늦어도 유실 없음)
    const applyPendingSeek = useCallback(() => {
        const v = videoRef.current;
        if (v == null || pendingSeekRef.current == null) return;
        const doSeek = () => {
            const t = pendingSeekRef.current;
            if (t == null) return;
            try { v.currentTime = t; } catch { /* noop */ }
            setCurrentTime(t);
            pendingSeekRef.current = null;
            v.removeEventListener('loadedmetadata', doSeek);
            v.removeEventListener('canplay', doSeek);
            v.removeEventListener('loadeddata', doSeek);
        };
        if (v.readyState >= 1) doSeek();             // 이미 준비됨 → 즉시
        else {
            // 준비되는 즉시 seek (모바일 대응: 여러 이벤트 중 먼저 오는 것에 반응)
            v.addEventListener('loadedmetadata', doSeek);
            v.addEventListener('canplay', doSeek);
            v.addEventListener('loadeddata', doSeek);
        }
    }, []);

    // 비디오 요소가 (재)마운트되면 예약된 seek 적용
    useEffect(() => { if (videoNode) applyPendingSeek(); }, [videoNode, applyPendingSeek]);

    // [위치 복원] 저장된 문장으로 재생 커서·하이라이트를 맞춘다(정지 유지, 자동재생 안 함).
    // 스크롤은 App(대본 컨테이너)에서 담당. 데이터가 마운트된 뒤 호출되어야 함.
    const restoreTo = useCallback((idx, seconds) => {
        loopTargetIdxRef.current = idx;
        lastActionTimeRef.current = Date.now();
        activeIdxRef.current = idx;
        setActiveSentenceIdx(idx);
        if (typeof seconds !== 'number') return;
        // 비디오가 아직 안 붙었어도 seek을 예약 → 마운트되면 자동 적용
        pendingSeekRef.current = Math.max(0, seconds - bufferTime);
        applyPendingSeek();
    }, [bufferTime, applyPendingSeek]);

    const resetPlayerState = useCallback(() => {
        setActiveSentenceIdx(-1);
        activeIdxRef.current = -1; // CRITICAL: Reset the ref so the engine detects the first update
        setCurrentTime(0);
        setIsPlaying(false);
        // isGlobalLoopActive stays as is (Global Setting)
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
    }, []);

    return {
        videoRef,
        attachVideo,
        activeSentenceIdx,
        currentTime,
        duration,
        playbackRate,
        isGlobalLoopActive,
        isPlaying,
        manualScrollNonce,
        activeIdxRef,
        lastActionTimeRef,
        triggerManualScroll,
        handleRateChange,
        seekTo,
        togglePlay,
        toggleLoop,
        jumpToSentence,
        handlePrev,
        handleNext,
        resetPlayerState,
        restoreTo
    };
};
