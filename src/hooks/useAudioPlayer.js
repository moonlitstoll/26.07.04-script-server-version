import { useState, useRef, useEffect, useCallback } from 'react';
import { slidingGroupBounds, clampLoopGroupSize } from '../utils/loopGroups';
import { blockSpeechEnd, trimmedLoopEnd, gapSkipTarget } from '../utils/speechSegments';

const ACTION_GUARD_MS = 1500;   // 수동 점프 후 하이라이트 보호 시간
const SYNC_INTERVAL_MS = 100;   // 재생 위치 동기화 주기
const MAX_SEEK_FALLBACK = 999999; // duration 미확정 시 상한 폴백(초)
const READY_EVENTS = ['loadedmetadata', 'canplay', 'loadeddata']; // 준비 완료 감지(먼저 오는 것에 반응)

// v.play() 공통 에러 처리: AbortError는 무시, 그 외엔 로그 + 재생상태 해제.
function safePlay(v, setIsPlaying, label) {
    v.play().catch((err) => {
        if (err.name !== 'AbortError') {
            console.error(`[Player] ${label} play() failed:`, err);
            setIsPlaying(false);
        }
    });
}

export const useAudioPlayer = ({ activeFile, bufferTime = 0.3, loopGroupSize = 1, speechOnly = false }) => {
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

    // ── 묶음 반복(N문장) ─────────────────────────────────────────────
    // loopTargetIdxRef는 '반복할 문장'이자 '묶음을 고르는 기준 문장'이다.
    // 화면(카드 띠)이 반응해야 하므로 상태로도 미러링한다. setAnchor를 유일한 창구로 쓴다.
    const [loopAnchorIdx, setLoopAnchorIdx] = useState(-1);
    const setAnchor = useCallback((i) => {
        const v = (typeof i === 'number' && i >= 0) ? i : -1;
        loopTargetIdxRef.current = (i === null || i === undefined) ? null : i;
        setLoopAnchorIdx(prev => (prev === v ? prev : v));   // 10Hz 싱크에서 불필요한 리렌더 방지
    }, []);

    const loopN = clampLoopGroupSize(loopGroupSize);

    // 묶음 경계는 slidingGroupBounds(순수 함수)로 엔진이 매 틱 직접 계산한다.
    // (고정 표 방식과 달리 '표와 대본이 어긋나는' 상태 자체가 없다)
    // 싱크 엔진(100ms)은 N을 ref로만 읽는다 — deps에 넣으면 리스너가 재부착되며 재생이 끊긴다.
    const loopNRef = useRef(loopN);

    // N이 바뀌면 지금 재생 중인 문장부터 묶음을 다시 잡는다
    // (안 하면 옛 앵커 기준이 남아 엉뚱한 구간을 반복하거나 이탈 감지에 걸려 한 틱 튄다).
    useEffect(() => {
        loopNRef.current = loopN;
        const cur = activeIdxRef.current;
        if (cur >= 0) setAnchor(cur);
    }, [loopN, setAnchor]);

    // '대사만 재생' — 싱크 엔진은 ref로만 읽는다 (loopN과 같은 이유: deps에 넣으면 토글마다
    // 미디어 리스너가 재부착되며 재생이 끊긴다). speechEnd가 없는 문장은 엔진이 문장별로 폴백.
    const speechOnlyRef = useRef(speechOnly);
    useEffect(() => { speechOnlyRef.current = speechOnly; }, [speechOnly]);

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

            const targetTime = Math.max(0, Math.min(s, v.duration || MAX_SEEK_FALLBACK));
            v.currentTime = targetTime;

            safePlay(v, setIsPlaying, 'seekTo');
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
            safePlay(v, setIsPlaying, 'togglePlay');
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
                setAnchor(activeIdxRef.current);
            }
            if (videoRef.current) {
                // [Phase 4] 한곡 반복 수정: 한문장 반복이 켜지면 네이티브 루프(한곡 반복)는 꺼야 함
                videoRef.current.loop = !next;
            }
            return next;
        });
    }, [triggerManualScroll, setAnchor]);

    // 문장 반복을 특정 값으로 설정 (toggleLoop의 '값 지정' 버전).
    // 오답 모드 진입 시 반복 강제 ON, 이탈 시 이전 상태 복원에 사용.
    const setLoopActive = useCallback((val) => {
        setIsGlobalLoopActive(prev => {
            if (prev === val) return prev;
            localStorage.setItem('miniapp_loop_active', val.toString());
            if (val) setAnchor(activeIdxRef.current);
            if (videoRef.current) videoRef.current.loop = !val;
            return val;
        });
    }, [setAnchor]);

    const jumpToSentence = useCallback((index) => {
        if (activeFile?.data && index >= 0 && index < activeFile.data.length) {
            triggerManualScroll();
            // Global Loop 루프 타겟 업데이트 (묶음 반복에선 '어느 묶음을 반복할지'를 정하는 기준)
            setAnchor(index);
            seekTo(Math.max(0, activeFile.data[index].seconds - bufferTime));
        }
    }, [seekTo, activeFile, triggerManualScroll, bufferTime, setAnchor]);

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

    // 현재 재생 시각(초)에 해당하는 문장 인덱스: 뒤에서부터 startSeconds<=now인 첫 인덱스를 찾는다.
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
                const itemEnd = data[targetIdx + 1] ? data[targetIdx + 1].seconds : (v.duration || MAX_SEEK_FALLBACK);

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
                if (loopIdx === null || !data[loopIdx]) {
                    loopIdx = actualIdx;
                    setAnchor(actualIdx);
                }

                // ── 묶음 반복(N≥2): 앵커 문장부터 N문장을 반복한다(앵커 슬라이딩).
                //    N=1이면 이 블록을 절대 타지 않는다(slidingGroupBounds도 null 반환)
                //    → 아래 기존 한 문장 반복 코드가 그대로 돌아간다(회귀 0).
                if (loopNRef.current > 1) {
                    const g = slidingGroupBounds(data, loopIdx, loopNRef.current);
                    const first = g && data[g.start];
                    const last = g && data[g.end];

                    if (first && last) {
                        const start = Math.max(0, first.seconds - bufferTime);
                        // 끝 경계: 묶음 마지막 문장의 '형제'를 모두 건너뛴 진짜 다음 문장 (한 문장 반복과 같은 규칙)
                        let nb = g.end + 1;
                        while (nb < data.length && data[nb].seconds <= last.seconds) nb++;
                        const nextItem = data[nb];
                        const tailPad = Math.max(bufferTime, 0.35);
                        let end = nextItem
                            ? nextItem.seconds + tailPad
                            : (v.duration ? v.duration + bufferTime : MAX_SEEK_FALLBACK);

                        // [대사만 재생] 묶음 끝: 마지막 문장의 대사 끝이 감지돼 있고 다음 문장까지
                        // 간격이 길면 그 지점에서 되감는다. 감지값이 없거나 간격이 짧으면 기존 경계 유지.
                        if (speechOnlyRef.current) {
                            const t = trimmedLoopEnd(blockSpeechEnd(data, g.end), nextItem ? nextItem.seconds : null);
                            if (t !== null && t > start + 0.5) end = Math.min(end, t);
                        }

                        if (end > start) {
                            // 수동 시크로 묶음 밖에 나갔으면 지금 위치의 묶음으로 재조준
                            if (v.currentTime < start - 2.0 || v.currentTime > end + 2.0) {
                                if (loopTargetIdxRef.current !== actualIdx) setAnchor(actualIdx);
                                return;
                            }

                            if (v.currentTime >= end - 0.1 || v.ended) {
                                lastActionTimeRef.current = Date.now();
                                setIsPlaying(true);
                                v.currentTime = start;
                                safePlay(v, setIsPlaying, 'group loop restart');
                                return;
                            }

                            // [대사만 재생] 묶음 내부: 지금 문장의 대사가 끝났고 다음 묶음 내
                            // 문장까지 간격이 길면 그 문장 시작(-버퍼)으로 점프. 조건 판정은
                            // gapSkipTarget(순수 함수)이 전담 — 겹침/짧은 간격/재귀 점프 방어 포함.
                            if (speechOnlyRef.current && !v.paused) {
                                const m = Math.min(Math.max(finalIdx, g.start), g.end);
                                let nm = m + 1;
                                while (nm < data.length && data[nm].seconds <= data[m].seconds) nm++;
                                if (nm <= g.end) {
                                    const target = gapSkipTarget(data, m, nm, v.currentTime, bufferTime);
                                    if (target !== null) {
                                        lastActionTimeRef.current = Date.now();
                                        v.currentTime = target;
                                        safePlay(v, setIsPlaying, 'gap skip');
                                        return;
                                    }
                                }
                            }

                            // 하이라이트: 묶음 안에서 '지금 나오는 문장'을 따라가되 묶음 밖으로는 못 나간다.
                            //   되감기 직후엔 재생 위치가 첫 문장보다 bufferTime만큼 앞이라 actualIdx가
                            //   이전 문장을 가리키는데, 이 clamp가 그걸 묶음 첫 문장으로 끌어올린다.
                            //   (한 문장 반복의 '하이라이트 고정'이 하던 일과 같은 역할)
                            const shown = Math.min(Math.max(finalIdx, g.start), g.end);
                            if (activeIdxRef.current !== shown) {
                                activeIdxRef.current = shown;
                                setActiveSentenceIdx(shown);
                            }
                            return;
                        }
                    }
                    // 묶음 계산 실패(데이터 전환 중 등) → 아래 한 문장 반복으로 폴백
                }

                if (data[loopIdx]) {
                    const item = data[loopIdx];
                    const start = Math.max(0, item.seconds - bufferTime);
                    // [A] 같은 시각(블록) 형제 문장을 건너뛰고, '실제로 더 뒤에 있는' 다음 문장을 끝 경계로 삼는다.
                    //   (다음 항목이 현재와 같은 seconds면 끝≈시작이 되어 대사가 끝나기 전에 즉시 반복되던 버그 방지)
                    let nb = loopIdx + 1;
                    while (nb < data.length && data[nb].seconds <= item.seconds) nb++;
                    const nextItem = data[nb];
                    // [A] 꼬리 여유: 타임스탬프가 실제 대사 끝보다 이르게 찍혀도 잘리지 않게 최소 0.35초 확보.
                    //   (다음 문장이 끝에 섞이는 걸 줄이려 0.5→0.35로 축소)
                    const tailPad = Math.max(bufferTime, 0.35);
                    // [Phase 4] 조기 종료 버그 수정: 5초 제한을 제거하고 실제 다음 문장 시작 전(+꼬리 여유)까지 재생
                    let end = nextItem
                        ? nextItem.seconds + tailPad
                        : (v.duration ? v.duration + bufferTime : MAX_SEEK_FALLBACK);

                    // [대사만 재생] 대사 끝이 감지돼 있고 다음 문장까지 간격이 길면(배경음악 구간)
                    // 대사 끝(+여유)에서 바로 되감는다. 감지값 없음/짧은 간격/겹침 → 기존 경계 그대로.
                    if (speechOnlyRef.current) {
                        const t = trimmedLoopEnd(blockSpeechEnd(data, loopIdx), nextItem ? nextItem.seconds : null);
                        if (t !== null && t > start + 0.5) end = Math.min(end, t);
                    }

                    // [Phase 4] 수동 시크(Seek) 대응: 사용자가 루프 범위 밖으로 강제 이동했다면 루프 타겟 재설정
                    if (v.currentTime < start - 2.0 || v.currentTime > end + 2.0) {
                        if (loopTargetIdxRef.current !== actualIdx) setAnchor(actualIdx);
                        return;
                    }

                    // 1. 루프 범위 체크 및 되돌리기
                    if (v.currentTime >= end - 0.1 || v.ended) {
                        // [4차 수정] 루프 재시작 시에도 버퍼 시간 보호
                        lastActionTimeRef.current = Date.now();
                        setIsPlaying(true);

                        v.currentTime = start;
                        safePlay(v, setIsPlaying, 'loop restart');
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
                        setAnchor(finalIdx);
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
        // setAnchor는 안정 참조(useCallback []) — deps에 있어도 리스너가 재부착되지 않는다.
        // loopGroupSize는 절대 deps에 넣지 말 것(ref로 읽는다): 넣으면 N을 바꿀 때마다
        // 미디어 리스너가 통째로 재부착되고 v.loop이 재설정돼 재생이 끊긴다.
    }, [activeFile, findActiveIndex, isGlobalLoopActive, bufferTime, videoNode, setAnchor]);

    // ─────────────────────────────────────────────────────────────
    // MediaSession: 알림/잠금화면에 '이전/다음 문장' 버튼만 추가한다.
    //  - play/pause는 등록하지 않는다 → 크롬 기본 재생 동작을 그대로 유지
    //    (과거 play/pause를 덮어썼다가 백그라운드에서 '타임라인만 흐르고 소리 없음' 회귀 발생).
    //  - setPositionState/playbackState도 등록하지 않는다(가짜 재생 표시 방지).
    //  - prev/next 핸들러는 알림 버튼 탭(=사용자 제스처)으로 실행되므로 백그라운드에서도
    //    seek+play가 정상 동작한다. 최신 인덱스는 activeIdxRef.current에서 읽는다.
    // ─────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        const ms = navigator.mediaSession;

        try {
            ms.metadata = new window.MediaMetadata({
                title: activeFile?.file?.name || 'Media Analyzer',
                artist: 'AI Shadowing Helper',
            });
        } catch { /* MediaMetadata 미지원 시 무시 */ }

        const safeSet = (action, handler) => {
            try { ms.setActionHandler(action, handler); } catch { /* 미지원 액션 무시 */ }
        };
        safeSet('previoustrack', () => handlePrev(Math.max(0, activeIdxRef.current)));
        safeSet('nexttrack', () => handleNext(Math.max(0, activeIdxRef.current)));

        return () => {
            ['previoustrack', 'nexttrack'].forEach(a => {
                try { ms.setActionHandler(a, null); } catch { /* noop */ }
            });
        };
    }, [activeFile, handlePrev, handleNext]);

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
            READY_EVENTS.forEach(ev => v.removeEventListener(ev, doSeek));
        };
        if (v.readyState >= 1) doSeek();             // 이미 준비됨 → 즉시
        else {
            // 준비되는 즉시 seek (모바일 대응: 여러 이벤트 중 먼저 오는 것에 반응)
            READY_EVENTS.forEach(ev => v.addEventListener(ev, doSeek));
        }
    }, []);

    // 비디오 요소가 (재)마운트되면 예약된 seek 적용
    useEffect(() => { if (videoNode) applyPendingSeek(); }, [videoNode, applyPendingSeek]);

    // [위치 복원] 저장된 문장으로 재생 커서·하이라이트를 맞춘다(정지 유지, 자동재생 안 함).
    // 스크롤은 App(대본 컨테이너)에서 담당. 데이터가 마운트된 뒤 호출되어야 함.
    const restoreTo = useCallback((idx, seconds) => {
        setAnchor(idx);
        lastActionTimeRef.current = Date.now();
        activeIdxRef.current = idx;
        setActiveSentenceIdx(idx);
        if (typeof seconds !== 'number') return;
        // 비디오가 아직 안 붙었어도 seek을 예약 → 마운트되면 자동 적용
        pendingSeekRef.current = Math.max(0, seconds - bufferTime);
        applyPendingSeek();
    }, [bufferTime, applyPendingSeek, setAnchor]);

    const resetPlayerState = useCallback(() => {
        setActiveSentenceIdx(-1);
        activeIdxRef.current = -1; // CRITICAL: Reset the ref so the engine detects the first update
        // 파일이 바뀌면 이전 파일의 반복 기준 인덱스를 버린다. 안 지우면 새 파일에서
        // 엉뚱한 문장이 반복 기준이 되고, 묶음 띠도 엉뚱한 곳에 그려진다.
        setAnchor(null);
        setCurrentTime(0);
        setIsPlaying(false);
        // isGlobalLoopActive stays as is (Global Setting)
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
    }, [setAnchor]);

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
        // 묶음 반복: 기준 문장(앵커). 묶음 경계는 App이 slidingGroupBounds로 직접 계산한다.
        // loopTargetIdxRef는 '동기' 값 — 연타 시 React 상태(loopAnchorIdx)는 커밋이 늦어 같은 자리에 머문다.
        loopAnchorIdx,
        loopTargetIdxRef,
        triggerManualScroll,
        handleRateChange,
        seekTo,
        togglePlay,
        toggleLoop,
        setLoopActive,
        jumpToSentence,
        handlePrev,
        handleNext,
        resetPlayerState,
        restoreTo
    };
};
