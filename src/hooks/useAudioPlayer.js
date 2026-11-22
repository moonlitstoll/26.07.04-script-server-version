import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { makeRemap } from '../utils/lineAnchors';
import { pickRecover } from '../utils/mediaRecover';
import { slidingGroupBounds, clampLoopGroupSize } from '../utils/loopGroups';
import { clampRate } from '../utils/playbackRates';
import { blockSpeechEnd, trimmedLoopEnd, gapSkipTarget, wrapSkipTarget, introSkipTarget, SPEECH_TAIL_PAD } from '../utils/speechSegments';

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

// speechTailPad: '대사만 재생'의 끝쪽 여유(설정값). bufferTime과 같은 성격의 설정이라
//   ref가 아니라 prop으로 직접 쓰고 deps에도 넣는다(아래 싱크 effect deps 주석 참고).
//   ⚠ 이름 주의: 이 훅 안에는 이미 `tailPad`라는 지역 변수가 두 곳(묶음/한문장 반복) 있는데
//   그건 speechOnly와 무관하게 모든 사용자에게 적용되는 `Math.max(bufferTime, 0.35)`로 완전히
//   다른 값이다. 섞으면 대사만 재생을 안 쓰는 사용자의 반복 끝 경계까지 바뀐다.
export const useAudioPlayer = ({ activeFile, bufferTime = 0.3, loopGroupSize = 1, speechOnly = false, speechTailPad = SPEECH_TAIL_PAD }) => {
    const [activeSentenceIdx, setActiveSentenceIdx] = useState(-1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(() => clampRate(parseFloat(localStorage.getItem('miniapp_playback_rate')) || 1.0));
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
    // ── 재생 링크 복구용 기록(utils/mediaRecover) ──
    // 링크가 죽어 App이 새 주소로 갈아끼우면 요소가 처음부터 다시 불러와져 자리가 0초로 돌아간다.
    // 그래서 '마지막 자리'와 '▶를 누른 시각'을 따로 적어 두었다가 새 주소가 준비되면 되돌린다.
    const lastPosRef = useRef(0);      // 마지막으로 확인한 재생 위치(초). 문장 ▶를 누르면 그 자리
    const lastSyncAtRef = useRef(0);   // 재생 위치가 마지막으로 나아간 시각(ms)
    const wantPlayAtRef = useRef(0);   // ▶를 마지막으로 누른 시각(ms). 멈춤을 누르면 0
    const recoverRef = useRef(null);   // 복구 중: { fileId, time, play } — 새 주소가 준비되면 적용하고 비운다
    const fileIdRef = useRef(null);
    useLayoutEffect(() => { fileIdRef.current = activeFile?.id ?? null; });
    const attachVideo = useCallback((node) => {
        videoRef.current = node;
        setVideoNode(node);
        // 요소가 떨어짐 = 재생 주소가 비워짐(복구 포기 등). 소리 낼 것이 없는데 버튼이 '재생 중'으로 남지 않게 한다.
        if (!node) { setIsPlaying(false); recoverRef.current = null; }
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
        const r = clampRate(rate); // 0.5~2.0 밖·깨진 값은 여기서 막는다(팝오버 −/+도 이 함수를 탄다)
        setPlaybackRate(r);
        localStorage.setItem('miniapp_playback_rate', r.toString());
    };

    const seekTo = useCallback((s) => {
        const v = videoRef.current;
        if (v) {
            triggerManualScroll();
            lastActionTimeRef.current = Date.now();
            setIsPlaying(true);

            const targetTime = Math.max(0, Math.min(s, v.duration || MAX_SEEK_FALLBACK));
            v.currentTime = targetTime;
            lastPosRef.current = targetTime;
            wantPlayAtRef.current = Date.now();
            // 링크를 갈아끼우는 중에 누른 문장: 옛 자리가 아니라 방금 누른 자리에서 틀어야 한다
            if (recoverRef.current) { recoverRef.current.time = targetTime; recoverRef.current.play = true; }

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
            wantPlayAtRef.current = Date.now();
            if (recoverRef.current) recoverRef.current.play = true;
            setIsPlaying(true);
            safePlay(v, setIsPlaying, 'togglePlay');
        } else {
            wantPlayAtRef.current = 0;
            if (recoverRef.current) recoverRef.current.play = false;
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
    // 묶음 문장 수를 2 이상으로 고르면 반복을 켜는 데 사용.
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

    // [번호 따라가기] 반복 기준(앵커)과 강조 표시는 '몇 번째 문장'으로 기억한다. 그사이 문장 수가 바뀌면
    // (앞 문장 삭제·실행취소·다시 전사) 같은 번호가 옆 문장을 가리켜 반복이 말없이 옆 문장으로 넘어갔다
    // (2026-11-19 점검, 화면 재현). 대본이 바뀌면 같은 문장의 새 번호로 옮긴다(utils/lineAnchors).
    // 아래 싱크 엔진(useEffect)보다 먼저 돌도록 layout effect.
    const anchorBaseRef = useRef({ id: null, data: null });
    const moveActive = useCallback((i) => {
        activeIdxRef.current = i;
        setActiveSentenceIdx(i);
    }, []);
    useLayoutEffect(() => {
        const id = activeFile?.id ?? null;
        const data = activeFile?.data ?? null;
        const base = anchorBaseRef.current;
        anchorBaseRef.current = { id, data };
        if (base.id !== id || base.data === data || !Array.isArray(base.data) || !Array.isArray(data)) return;
        const remap = makeRemap(base.data, data);
        const target = loopTargetIdxRef.current;
        if (typeof target === 'number' && target >= 0) {
            const j = remap(target);   // 그 문장이 없어졌으면 null → 엔진이 지금 재생 위치로 다시 잡는다
            if (j !== target) setAnchor(j);
        }
        const cur = activeIdxRef.current;
        if (cur >= 0) {
            let j = remap(cur);
            if (j === null) {
                const v = videoRef.current;
                j = data.length === 0 ? -1 : (v ? findActiveIndex(v.currentTime, data) : Math.min(cur, data.length - 1));
            }
            if (j !== cur) moveActive(j);
        }
    }, [activeFile, setAnchor, findActiveIndex, moveActive]);

    // High-Resolution Sync Engine (Absolute Tracking)
    // videoNode는 deps에만 두어 '비디오 마운트 시 재실행' 트리거로 쓰고, 실제 요소는 ref로 읽는다.
    useEffect(() => {
        const v = videoRef.current;
        if (!v || !activeFile?.data) return;

        // [Phase 4] 한곡 반복 수정: 한문장 반복이 꺼져있을 때만 전체 반복(native loop) 활성화
        v.loop = !isGlobalLoopActive;

        const runSync = () => {
            if (!v) return;
            // 아직 불러오지 못한 요소(readyState 0)의 위치는 뜻이 없는 0초다. 재생 링크를 갈아끼울 때 브라우저가
            // 그 0초로 timeupdate를 보내는데, 그걸 따라가면 복구가 되돌릴 자리를 잃고 강조·반복 기준이
            // 첫 문장으로 옮겨져 복구 뒤 엉뚱한 문장을 반복한다(독립 검토 지적, 화면 시험 M8).
            if (v.readyState === 0 || recoverRef.current) return;
            const now = v.currentTime;
            setCurrentTime(now);
            if (!v.paused && now !== lastPosRef.current) lastSyncAtRef.current = Date.now();
            lastPosRef.current = now;

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
                            const t = trimmedLoopEnd(blockSpeechEnd(data, g.end), nextItem ? nextItem.seconds : null, speechTailPad);
                            if (t !== null && t > start + 0.5) end = Math.min(end, t);
                        }

                        if (end > start) {
                            // 수동 시크로 묶음 밖에 나갔으면 지금 위치의 묶음으로 재조준
                            if (v.currentTime < start - 2.0 || v.currentTime > end + 2.0) {
                                if (loopTargetIdxRef.current !== actualIdx) setAnchor(actualIdx);
                                return;
                            }

                            // 멈춰 있을 땐 되감지 않는다(아래 한 문장 반복과 같은 이유)
                            if ((v.currentTime >= end - 0.1 && !v.paused) || v.ended) {
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
                                    const target = gapSkipTarget(data, m, nm, v.currentTime, bufferTime, speechTailPad);
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
                        const t = trimmedLoopEnd(blockSpeechEnd(data, loopIdx), nextItem ? nextItem.seconds : null, speechTailPad);
                        if (t !== null && t > start + 0.5) end = Math.min(end, t);
                    }

                    // [Phase 4] 수동 시크(Seek) 대응: 사용자가 루프 범위 밖으로 강제 이동했다면 루프 타겟 재설정
                    if (v.currentTime < start - 2.0 || v.currentTime > end + 2.0) {
                        if (loopTargetIdxRef.current !== actualIdx) setAnchor(actualIdx);
                        return;
                    }

                    // 1. 루프 범위 체크 및 되돌리기
                    // 멈춰 있을 땐 되감지 않는다 — 이 함수는 timeupdate에도 물려 있어, 되감기 직전(끝 0.1초 전~)에 누른
                    // 일시정지가 바로 되감기+재생으로 덮여 무시됐다(2026-11-21 휴대폰 확인 중 발견, PC 재현).
                    // 다시 틀면 그때 되감는다. 영상 끝(ended)은 멈춘 상태로 오므로 따로 본다.
                    if ((v.currentTime >= end - 0.1 && !v.paused) || v.ended) {
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
                // [대사만 재생 — 일반 재생] 반복을 켜지 않고 쭉 들을 때도 대사 끝~다음 대사 사이의
                // 긴 배경음악/무음을 건너뛴다. 판정은 반복 모드와 똑같이 gapSkipTarget이 전담하므로
                // 기준(3초 초과·꼬리 0.4초·재귀 점프 방어)이 두 경로에서 어긋날 일이 없다.
                // isWithinActionGuard: 사용자가 방금 수동으로 시크했다면 끌고 가지 않는다.
                if (speechOnlyRef.current && !v.paused && !isWithinActionGuard
                    && finalIdx >= 0 && data[finalIdx]) {
                    // 첫 문장보다 앞(영상 앞부분): 앞 문장이 없어 아래 판정이 시작되지 않는다.
                    // 끝에서 0초로 되감겼거나 처음 틀었을 때 앞 음악을 건너뛴다. 직접 옮긴 경우도
                    // 다른 빈 구간처럼 action guard(1.5초) 뒤에 건너뛴다(사용자 결정 2026-11-03).
                    if (now < data[0].seconds) {
                        const target = introSkipTarget(data, now, bufferTime);
                        if (target !== null) {
                            lastActionTimeRef.current = Date.now();
                            v.currentTime = target;
                            safePlay(v, setIsPlaying, 'intro skip (normal play)');
                            return;
                        }
                    }
                    let nm = finalIdx + 1;
                    while (nm < data.length && data[nm].seconds <= data[finalIdx].seconds) nm++;
                    if (nm < data.length) {
                        const target = gapSkipTarget(data, finalIdx, nm, v.currentTime, bufferTime, speechTailPad);
                        if (target !== null) {
                            lastActionTimeRef.current = Date.now();
                            v.currentTime = target;
                            safePlay(v, setIsPlaying, 'gap skip (normal play)');
                            return;
                        }
                    } else {
                        // 마지막 문장: 다음 문장이 없어 위 판정이 아예 시작되지 않는다.
                        // 그래서 대사가 끝나도 엔딩 음악을 끝까지 다 듣고서야 브라우저 기본
                        // 전체반복이 0초로 되감았다. 여기서 첫 문장으로 바로 되감는다.
                        const target = wrapSkipTarget(data, finalIdx, v.duration, v.currentTime, bufferTime, speechTailPad);
                        if (target !== null) {
                            lastActionTimeRef.current = Date.now();
                            v.currentTime = target;
                            safePlay(v, setIsPlaying, 'wrap skip (normal play)');
                            return;
                        }
                    }
                }

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
        // 재생 버튼 모양은 실제 재생 상태를 따라간다. 예전엔 앱이 누른 것만 반영해서, 앱 밖에서 멈추면
        // (이어폰 뽑기·알림창 버튼·전화·다른 앱 소리) 버튼이 '일시정지' 모양 그대로였다(2026-11-19 점검, 화면 재현).
        // 이벤트가 온 순간의 실제 상태(v.paused)를 본다 — 반복 되감기처럼 멈춤 직후 바로 다시 틀면 늦게 온 pause는 무시된다.
        const handlePlay = () => { if (!v.paused) setIsPlaying(true); runSync(); managePulse(); };
        const handlePause = () => { if (v.paused) setIsPlaying(false); managePulse(); };
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
        // speechTailPad는 반대로 deps에 넣는다 — bufferTime과 같은 '설정창에서만 바뀌는 값'이라
        // 재부착 빈도가 극히 낮고, 빼면 슬라이더를 움직여도 옛 클로저 값으로 계속 계산된다
        // (재생 중 자주 토글되는 loopGroupSize/speechOnly와는 성격이 다르다).
    }, [activeFile, findActiveIndex, isGlobalLoopActive, bufferTime, speechTailPad, videoNode, setAnchor]);

    // ─────────────────────────────────────────────────────────────
    // MediaSession: 알림/잠금화면의 제목만 여기서 정한다.
    //  - 이전/다음 버튼은 App이 한 곳에서 등록한다(화면 ◀▶와 같은 goPrev/goNext — 묶음 반복 인식).
    //    예전엔 여기서도 등록했는데, 이 effect가 대본이 바뀔 때마다(분석 배치·편집) 다시 돌며
    //    App의 등록을 덮어써 잠금화면 버튼만 묶음을 무시하고 한 문장씩 움직였다.
    //  - play/pause는 등록하지 않는다 → 크롬 기본 재생 동작을 그대로 유지
    //    (과거 play/pause를 덮어썼다가 백그라운드에서 '타임라인만 흐르고 소리 없음' 회귀 발생).
    //  - setPositionState/playbackState도 등록하지 않는다(가짜 재생 표시 방지).
    // ─────────────────────────────────────────────────────────────
    const mediaTitle = activeFile?.file?.name || 'Media Analyzer';
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: mediaTitle,
                artist: 'AI Shadowing Helper',
            });
        } catch { /* MediaMetadata 미지원 시 무시 */ }
    }, [mediaTitle]);

    // 예약된 seek을 비디오가 준비되는 대로 적용 (늦게 마운트되거나 모바일서 메타데이터가 늦어도 유실 없음)
    const applyPendingSeek = useCallback(() => {
        const v = videoRef.current;
        if (v == null || pendingSeekRef.current == null) return;
        const doSeek = () => {
            const t = pendingSeekRef.current;
            if (t == null) return;
            try { v.currentTime = t; } catch { /* noop */ }
            setCurrentTime(t);
            lastPosRef.current = t;
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

    // [재생 링크 복구] App이 새 주소로 갈아끼우기 직전에 부른다 — 듣던 자리·재생 여부를 적어 둔다.
    const prepareMediaRecover = useCallback(() => {
        const v = videoRef.current;
        const fileId = fileIdRef.current;
        const armed = recoverRef.current && recoverRef.current.fileId === fileId ? recoverRef.current : null;
        recoverRef.current = {
            fileId,
            ...pickRecover({
                armed, pendingSeek: pendingSeekRef.current, lastPos: lastPosRef.current,
                paused: v ? v.paused : true, lastSyncAt: lastSyncAtRef.current, wantPlayAt: wantPlayAtRef.current, now: Date.now(),
            }),
        };
    }, []);
    // 새 주소가 준비되면 적어 둔 자리로 되돌리고, 틀려던 것이었으면 이어서 튼다.
    // 같은 요소의 src만 바뀌므로(요소가 새로 붙지 않는다) 위의 '마운트 시 seek'은 돌지 않는다 → 주소 변화를 직접 본다.
    // 이 effect는 새 src가 붙은 뒤에 돌고, 그 시점엔 요소가 다시 불러오는 중이라 준비 이벤트를 기다리면 된다.
    useEffect(() => {
        const v = videoRef.current;
        const r = recoverRef.current;
        if (!r || !v) return;
        if (r.fileId !== fileIdRef.current) { recoverRef.current = null; return; }   // 그사이 다른 파일로 넘어감
        const off = () => READY_EVENTS.forEach(ev => v.removeEventListener(ev, go));
        function go() {
            off();
            const cur = recoverRef.current;
            if (!cur) return;
            recoverRef.current = null;
            pendingSeekRef.current = null;
            try { v.currentTime = cur.time; } catch { /* noop */ }
            lastPosRef.current = cur.time;
            setCurrentTime(cur.time);
            if (cur.play) {
                lastActionTimeRef.current = Date.now();
                setIsPlaying(true);
                safePlay(v, setIsPlaying, 'media recover');
            } else {
                // 다시 불러올 때 브라우저는 멈춤 상태로 바꾸면서 pause 이벤트는 보내지 않는다 —
                // 버튼이 '재생 중' 모양으로 남지 않게 직접 맞춘다.
                setIsPlaying(false);
            }
        }
        if (v.readyState >= 1) { go(); return; }   // 준비 이벤트가 이미 지나갔으면 바로
        READY_EVENTS.forEach(ev => v.addEventListener(ev, go));
        return off;
    }, [mediaUrl]);

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
        lastPosRef.current = 0; lastSyncAtRef.current = 0; wantPlayAtRef.current = 0; recoverRef.current = null;
        // 재생 길이도 반드시 초기화. 안 하면 이전 파일(또는 링크가 죽기 전)의 길이가 그대로 남아
        // 재생 불가 상태인데도 "14:04" 같은 총 시간이 표시돼 정상처럼 보인다.
        setDuration(0);
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
        handleRateChange,
        seekTo,
        togglePlay,
        toggleLoop,
        setLoopActive,
        jumpToSentence,
        handlePrev,
        handleNext,
        resetPlayerState,
        restoreTo,
        prepareMediaRecover
    };
};
