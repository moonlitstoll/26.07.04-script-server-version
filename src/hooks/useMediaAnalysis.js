import { useState, useRef, useLayoutEffect } from 'react';
import { mediaStore } from '../utils/MediaStore';
import { getMediaDuration, sanitizeData } from '../utils/mediaUtils';
import { extractTranscript, analyzeBatchSentences, retranscribeSegments, deduplicateOverlap, detectSpeechEnds, detectSpeechEndsByClips, detectSpeechEndsInParts } from '../services/gemini';
import { SPEECH_PART_MAX } from '../utils/speechEndParts';
import { parseCacheEntry, saveCacheEntry, clearCacheIncomplete } from '../utils/cacheUtils';
import { ANALYSIS_VERSION } from '../services/prompts';
import { saveStatusOf } from '../utils/cacheStatus';
import { touchRecent } from '../utils/recentOpen';
import { uploadMedia as cloudUploadMedia, saveMeta as cloudSaveMeta } from '../services/cloudSync';
import { materializeFile } from '../utils/materializeFile';
import { getStage2Concurrency, isClaudeModel } from '../constants/models';
import { addToTrash, removeFromTrash, sentenceKey, getTrash, withTieHints, mergeRestored } from '../utils/trashUtils';
import { validSpeechEnd } from '../utils/speechSegments';
import { selectSpeechEndTargets, withNextStarts, mergeSpeechEnds, applyManualSpeechEnd, unresolvedSpeechEnds, freshSpeechEndTargets, alignSpeechEnds, speechEndMissingSet } from '../utils/speechEndMerge';
import { incompleteNotice } from '../services/stage1Resume';
import { rememberAudio, reusableAudio, forgetAudio } from '../utils/audioReuse';
import { applySplit, replaceRange, rangeNeighbors, indicesInRange, formatStamp } from '../utils/sentenceEdit';
import { lineKey, locateLines, replaceLines, revertEdit, restoreSpeechEnds, syncBusyFlags, mergeAnalysis, restorePrev, settlePrev } from '../utils/liveMerge';
import { isOffline, OFFLINE_MESSAGE } from '../utils/online';
import { pickLineModels, batchesByModel, stampCarry, usableCarry } from '../utils/lineModels';
import { missingWordCount, shouldAdoptMissingRetry, isLumpedAnalysis, shouldAdoptSplitRetry } from '../utils/analysisCoverage';

// 저장 안내의 용량 글자. 예전 toFixed(0)은 1MB 미만이 "(0MB)"로 나와 고장처럼 읽혔다.
const mbText = (bytes) => bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))}KB`
    : `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)}MB`;

// 인덱스 범위 [from, to]의 문장 텍스트를 순서대로 수집(빈 문자열 제외). 앞뒤 문맥 문장 추출용.
const collectTexts = (data, from, to) => {
    const out = [];
    for (let j = Math.max(0, from); j <= Math.min(data.length - 1, to); j++) {
        const t = data[j].text || '';
        if (t) out.push(t);
    }
    return out;
};

export const useMediaAnalysis = ({
    setFiles,
    setActiveFileId,
    setIsSwitchingFile,
    resetPlayerState,
    refreshCacheKeys,
    apiKey,
    claudeApiKey, // 2단계 모델이 Claude일 때만 쓰는 키(없으면 분석을 시작하지 않고 안내)
    stage1Model,
    stage2Model,
    stage3Model, // 다시 받아쓰기(재전사) 전용 모델 — 소리를 듣는 일만. 번역·풀이(분석·재분석)는 전부 stage2Model(2026-11-23)
    temperature,
    topP,
    antiRecitation,
    markerChar,
    markerInterval,
    chunkEnabled,
    chunkMinutes,
    realignEnabled,
    speechAutoDetect, // 전사+분석 완료 후 대사 구간 감지 자동 실행 (설정, 기본 꺼짐)
    stage2AbortRef,
    stage2ActiveRef, // Map<fileId, 실행중 개수> — loadCache의 Stage 2 재시작 방지용
    filesRef,        // 최신 files 사본(App 소유). setFiles 업데이터 실행 타이밍에 의존하지 않기 위함
    showToast,
    onTrashChange,
    onRevealSentence // (fileId, idx) — 감지 완료 안내의 [그 문장 보기]: 그 문장으로 이동 + 선택
}) => {
    const [isDragging, setIsDragging] = useState(false);
    // 백그라운드 Stage 2(재분석 등) 진행 표시: null 또는 { fileId, done, total }.
    // 최초 전체분석은 isAnalyzing 전체 스피너가 있으므로, 이 배너는 그 외(재분석/이어서 분석)에서 사용.
    const [stage2Progress, setStage2Progress] = useState(null);
    // [대사 끝 감지] 진행 중인 파일 id (칩 스피너 표시용). null = 유휴.
    const [speechDetectBusy, setSpeechDetectBusy] = useState(null);
    const speechBusyRef = useRef(false); // 중복 실행 가드는 ref로 (자동 실행 경로의 stale closure 방지)
    // [대사 끝 감지 결과의 동기 사본] key: `${name}_${size}|${seconds}` → speechEnd(초).
    // Stage 2가 자기 스냅샷으로 상태/캐시를 통째로 덮어쓸 때, 그 사이 감지가 채운 speechEnd가
    // 지워지지 않도록 덮어쓰기 직전에 여기서 이식한다(상태는 지연 갱신이라 ref가 필요).
    const speechEndGraftRef = useRef(new Map());
    // 다시 전사·복구로 새로 생겨 대사 끝을 찾아야 할 문장: fileId → { seconds:Set, data:그 편집 직후 대본 }
    const pendingSpeechEndRef = useRef(new Map());
    // [대사 끝 자동 찾기] 설정 값의 최신 사본 — 분석이 끝난 '나중에' 읽으므로 그때의 설정을 본다
    const speechAutoRef = useRef(speechAutoDetect);
    useLayoutEffect(() => { speechAutoRef.current = speechAutoDetect; });
    const autoSpeechTriedRef = useRef(new Set()); // 이번 실행에서 자동 찾기를 건 파일(이름_크기) — 실패 비용 반복 방지
    const autoSpeechQueueRef = useRef(new Map());  // 다른 감지가 도는 동안 차례를 기다리는 파일
    // 1단계가 구글 파일 저장소에 올린 전체 오디오(utils/audioReuse) — '대사만' 감지가 다시 올리지 않고 재사용
    const stage1AudioRef = useRef(new Map());
    const stage1AbortRef = useRef(null);
    // 중단 채널(stage1AbortRef)은 하나뿐이다. 지금 그 채널을 쥔 '첫 전사'의 fileId(다시 전사가 쥐고 있으면 null) —
    // '전사 중단'이 다른 파일의 전사를 끊지 않게 한다.
    const stage1OwnerRef = useRef(null);
    // fileId → '전사 중단'을 누른 횟수. 첫 전사는 시작할 때 이 값을 기억하고, 요청을 보내기 전에 값이 바뀌었으면 멈춘다 —
    // 시작 직후(파일 읽는 중)에는 아직 끊을 요청이 없어서, 예전엔 '취소했습니다'라고 보여 주고 전사는 그대로 나갔다(2026-11-21 재현).
    const stage1GenRef = useRef(new Map());
    // `이름_크기` → fileId: 첫 전사가 돌고 있거나 줄 서 있는 파일. 같은 파일을 또 올리면 새로 전사하지 않고 여기에 붙는다.
    const stage1RunRef = useRef(new Map()); // `이름_크기` → 그 표시를 건 실행(아래 runFullAnalysis). 자기 표시만 지우게
    const stage1KeysRef = useRef(new Map());
    // [다시 전사 줄 세우기] 다시 전사·복구·구간 전사는 한 번에 하나씩 돈다. 예전엔 두 번째를 누르면 첫 번째가 말없이 취소됐다.
    const retranscribeQueueRef = useRef(Promise.resolve());
    const retranscribeJobsRef = useRef(new Map()); // 작업 번호 → { fileId, keys:Set<lineKey> } — 아직 안 끝난 작업이 맡은 문장
    const retranscribeSeqRef = useRef(0);
    const retranscribeEpochRef = useRef(0); // 도는 작업이 중단되면 올린다 → 기다리던 작업도 시작하지 않는다
    const stage2ModelRef = useRef(new Map()); // fileId → 마지막으로 돈 분석의 모델(멈췄다가 이을 때 같은 모델로)
    // fileId → Map(문장 열쇠 → 모델): 지금 도는(또는 방금 중단된) 분석이 아직 못 끝낸 문장의 모델(utils/lineModels)
    const stage2CarryRef = useRef(new Map());
    const analysisQueueRef = useRef([]);   // 순차 분석 대기 파일 목록
    const queueRunningRef = useRef(false);  // 큐 워커 실행 중 여부
    const stage2RunIdRef = useRef(0); // 최신 Stage 2 실행만 진행배너를 정리(옛 실행이 새 배너를 지우지 않게)
    const quotaWarnedRef = useRef(false); // 용량 경고 세션당 1회만(반복 저장 스팸 방지)
    const unsavedRef = useRef(new Map()); // `${name}_${size}` → 저장에 실패한 마지막 내용 { fileInfo, data, status, extra }
    const [unsavedKeys, setUnsavedKeys] = useState(() => new Set()); // 화면 띠 표시용(위 Map의 키)

    // saveCacheEntry 래퍼: 저장 실패 시 사용자에게 명시적으로 알림('조용한 실패' 제거).
    // 용량 초과면 "오래된 기록 삭제" 안내, 그 외는 일반 에러 알림. 성공 시 경고 플래그 해제.
    /**
     * [실체 확보 3단 폴백] 캐시에서 복원한 항목의 `f.file`은 실제 파일이 아니라
     * `{name, type, size}` 자리표시자일 수 있다(loadCache). 그걸 그대로 오디오 처리에 넘기면
     * `createObjectURL`이 "Overload resolution failed"로, FileReader가 "not of type 'Blob'"으로 터진다.
     * → Blob 여부를 먼저 검사하고, 자리표시자면 IndexedDB(원본 저장소) → 재생 URL(fetch) 순으로
     *   진짜 바이트를 확보한다. 못 구하면 null (호출부가 안내 후 중단).
     *
     * ⚠️ 감지·재전사·구간복구가 **모두** 이 함수를 써야 한다. 예전엔 감지에만 있어서,
     *    캐시로 연 대본에서 '구간 복구'가 조용히 실패했다(실측 확인).
     */
    const resolveRealFile = async (targetFile, targetUrl, label) => {
        const isRealBlob = (b) => typeof Blob !== 'undefined' && b instanceof Blob && b.size > 0;
        if (!targetFile) return null;
        if (isRealBlob(targetFile)) {
            try {
                return await materializeFile(targetFile, {
                    onWait: (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중...', type: 'success' }); }
                });
            } catch (e) {
                console.warn(`[${label}] 메모리 적재 실패 → 원본으로 진행:`, e.message);
                return targetFile; // 원본도 Blob이므로 그대로 시도할 가치가 있다
            }
        }
        try {
            const stored = await mediaStore.getFileFlexible(targetFile.name, targetFile.size);
            if (isRealBlob(stored)) {
                console.log(`[${label}] IndexedDB에서 원본 확보`);
                return new File([stored], targetFile.name || 'media', { type: stored.type || targetFile.type || 'application/octet-stream' });
            }
        } catch (e) { console.warn(`[${label}] IndexedDB 조회 실패:`, e); }
        if (targetUrl) {
            try {
                const res = await fetch(targetUrl);
                const blob = await res.blob();
                if (isRealBlob(blob)) {
                    console.log(`[${label}] 재생 URL에서 원본 확보`);
                    return new File([blob], targetFile.name || 'media', { type: blob.type || targetFile.type || 'application/octet-stream' });
                }
            } catch (e) { console.warn(`[${label}] 재생 URL 읽기 실패:`, e); }
        }
        return null;
    };

    // 지금 대본(최신 사본). 편집·작업 결과는 번호가 아니라 여기서 문장을 다시 찾아 넣는다(utils/liveMerge).
    const liveEntry = (fileId) => (filesRef?.current || []).find(p => p.id === fileId) || null;
    // 화면 상태는 다음 그리기 때 바뀌므로, 바로 이어 도는 작업(줄 선 다음 전사 등)이 옛 대본을 읽지 않게 사본도 같이 바꾼다.
    const commitData = (fileId, data) => {
        if (filesRef?.current) filesRef.current = filesRef.current.map(p => (p.id === fileId ? { ...p, data } : p));
        setFiles(prev => prev.map(p => (p.id === fileId ? { ...p, data } : p)));
    };
    // 이 파일에서 아직 안 끝난 다시 전사 작업이 맡은 문장들
    const busyKeysOf = (fileId) => {
        const keys = new Set();
        for (const job of retranscribeJobsRef.current.values()) {
            if (job.fileId === fileId) for (const k of job.keys) keys.add(k);
        }
        return keys;
    };

    // 저장에 실패한 대본은 마지막으로 저장하려던 내용을 들고 있는다(unsavedRef) — 화면에 '저장 안 됨' 띠를 계속 띄우고,
    // 공간이 생기면(다른 대본 삭제) 다시 저장한다. 예전엔 2.5초 안내 한 번뿐이라 화면엔 분석이 다 된 것처럼 보이고
    // 다시 열면 사라져 있었다(2026-11-19 재현: 화면 4/4, 저장본 1/4).
    const markSaved = (key, ok, pending) => {
        if (ok) unsavedRef.current.delete(key); else unsavedRef.current.set(key, pending);
        setUnsavedKeys(prev => {
            if (prev.has(key) === !ok) return prev;
            const next = new Set(prev);
            if (ok) next.delete(key); else next.add(key);
            return next;
        });
    };
    const persistCache = (fileInfo, data, status, extra) => {
        const res = saveCacheEntry(fileInfo, data, status, extra);
        const key = fileInfo && fileInfo.name ? `${fileInfo.name}_${fileInfo.size}` : null;
        if (res && res.ok) {
            quotaWarnedRef.current = false;
            if (key) markSaved(key, true);
            return res;
        }
        // 앞서 보관한 부가 정보('끝까지 못 받음' 표시 등)는 이번 저장이 따로 말하지 않으면 그대로 이어 간다
        if (key && res) markSaved(key, false, { fileInfo, data, status, extra: { ...(unsavedRef.current.get(key)?.extra || {}), ...(extra || {}) } });
        if (res && res.reason === 'quota') {
            if (!quotaWarnedRef.current) {
                quotaWarnedRef.current = true;
                if (showToast) showToast({
                    message: '저장 공간이 꽉 차서 저장하지 못했어요. 목록에서 안 쓰는 대본을 지우면 자동으로 다시 저장합니다. (그 전에 새로고침하면 방금 바뀐 내용이 사라져요)',
                    type: 'error',
                    duration: 10000,
                });
            }
        } else if (res && showToast) {
            showToast({ message: '분석 결과 저장 실패: ' + (res.message || '알 수 없는 오류'), type: 'error' });
        }
        return res;
    };

    /**
     * STAGE 2: FULL BATCH ANALYSIS
     */
    // [주의] fileInfo는 '신원'(name/size)으로만 쓰인다 — 캐시 키·graft 키·클라우드 폴더 계산.
    // 실제 바이트는 읽지 않으므로, 호출부는 반드시 '원본 신원'을 넘겨야 한다.
    // materializeFile이 만든 메모리 적재본(new File([buf], ...))은 size가 '실제 읽은 바이트 수'로
    // 바뀌어, 온디맨드 파일(드라이브/OneDrive)에서 원본 보고 크기와 달라질 수 있다. 그걸 넘기면
    // 전사·감지는 원본 키에, 분석은 다른 키에 저장돼 캐시가 두 갈래로 쪼개진다.
    // [실행 중 표시] 호출 전후로 stage2ActiveRef를 갱신하는 얇은 래퍼.
    // loadCache가 '이 파일 분석이 지금 돌고 있나'를 보고 재시작을 건너뛰는 데 쓴다
    // (재시작하면 runStage2 첫 줄의 abort가 진행 중이던 요청을 죽여 중복 비용이 든다).
    // finally로 감싸 예외·중단에도 표시가 남지 않게 한다.
    const runStage2 = async (fileId, ...rest) => {
        const m = stage2ActiveRef?.current;
        if (m) m.set(fileId, (m.get(fileId) || 0) + 1);
        stage2ModelRef.current.set(fileId, rest[3]); // rest = [fileInfo, transcript, apiKey, modelId, opts]
        let res = null;
        try {
            res = await runStage2Inner(fileId, ...rest);
            return res;
        } finally {
            if (m) {
                const n = (m.get(fileId) || 1) - 1;
                if (n > 0) m.set(fileId, n); else m.delete(fileId);
            }
            // 분석이 끝까지 돌았으면(끊기지 않았고 전부 실패도 아니면) 대사 끝 자동 찾기 — 어느 경로의 분석이든.
            // 전량 실패(success 0)면 API 자체가 아픈 상태라 감지까지 얹지 않는다.
            // '전부 실패'는 이번 실행에 성공이 0이고 결과 대본에 분석된 문장도 없을 때만 — 매번 실패하는 문장 하나만
            // 다시 돌린 실행(total 1, success 0)까지 막으면 그 대본은 영영 자동 감지가 안 걸린다(독립 검토)
            const anyDone = Array.isArray(res?.data) && res.data.some(d => d.isAnalyzed);
            if (res && !res.aborted && (res.total === 0 || res.success > 0 || anyDone)) {
                autoSpeechEnds(rest[0], { fileId, data: Array.isArray(res.data) && res.data.length ? res.data : null });
            }
        }
    };

    const runStage2Inner = async (fileId, fileInfo, transcript, currentApiKey, currentModelId, opts = {}) => {
        // reportPartialFail: 부분 실패 시 이 함수가 직접 토스트를 띄울지. 재분석(원본 복원 로직)에서는 false로 두고 호출부가 처리.
        const { reportPartialFail = true } = opts;
        console.log(`[Stage 2] Starting FULL BATCH Analysis for file ${fileId}...`);

        if (stage2AbortRef.current) stage2AbortRef.current.abort();
        stage2AbortRef.current = new AbortController();
        const { signal } = stage2AbortRef.current;

        const pendingIndices = transcript
            .map((item, idx) => ({ item, idx }))
            .filter(x => !x.item.isAnalyzed)
            .map(x => x.idx);
        const owned = new Set(pendingIndices);
        // [문장별 모델] 앞 분석이 끝내지 못한 문장은 그 분석의 모델로 이어 간다. 이번에 새로 맡은 문장만 받은 모델(currentModelId)로 돈다.
        // 예전엔 전부 받은 모델로 돌아, 첫 분석 중 한 문장을 다시 전사하면 남은 문장 전체가 재분석 모델로 넘어갔다.
        // 기억은 '그때 설정'과 지금 설정이 같을 때만 쓴다 — 끊긴 뒤 사용자가 모델을 바꿨거나 Claude 키를 지웠으면 지금 설정을 따른다.
        // (끊긴 분석의 기억이 남아, 모델을 바꾼 뒤에도 옛 모델로 요청이 나갔다 — 2026-11-21 독립 검토에서 실행 재현)
        const settingsNow = `${stage2Model}|${claudeApiKey ? 1 : 0}`; // 분석 모델은 2단계 설정만 따른다(3단계는 받아쓰기 전용)
        const lineModel = pickLineModels(transcript, pendingIndices, usableCarry(stage2CarryRef.current.get(fileId), settingsNow), currentModelId);
        const modelAt = (idx) => lineModel.get(lineKey(transcript[idx])) || currentModelId;
        const modelsUsed = [...new Set(pendingIndices.map(modelAt))];
        if (pendingIndices.length > 0) stage2CarryRef.current.set(fileId, stampCarry(lineModel, settingsNow));
        else stage2CarryRef.current.delete(fileId);
        const carry = stage2CarryRef.current.get(fileId) || null; // 끝낸 문장은 여기서 지운다

        // [지금 대본에 넣기] 분석은 시작할 때 뜬 사본(workingData)으로 일하지만, 화면·저장에는 사본을 통째로 쓰지 않고
        // 이 실행이 맡은 문장의 번역·분석만 '지금 대본'에 넣는다(utils/liveMerge#mergeAnalysis).
        // 예전엔 묶음이 끝날 때마다 사본으로 덮어써서, 분석이 도는 사이 휴지통에서 되살린 문장이 사라지고(휴지통에도 없음)
        // 감지가 붙인 '판단 불가' 표시가 지워졌다(2026-11-19 점검, PC 재현).
        // published = 마지막으로 화면·저장에 쓴 대본. 호출부에 돌려주고, 저장도 이것으로 한다.
        // [화면 사본 맞추기] 호출부는 방금 이 대본(transcript)을 화면 상태에 넣고 분석을 부른다. 그런데 화면 사본(filesRef)은
        // 다음 그리기 뒤에야 바뀌므로, 첫 묶음이 그 전에 끝나면 옛 사본(막 올린 파일이면 빈 대본)에 결과를 넣게 된다 —
        // 결과가 화면에 안 나오고 빈 대본이 저장될 수 있었다(2026-11-21 시험에서 재현). 그래서 시작할 때 사본을 먼저 맞춘다.
        if (filesRef?.current && liveEntry(fileId) && liveEntry(fileId).data !== transcript) {
            filesRef.current = filesRef.current.map(p => (p.id === fileId ? { ...p, data: transcript } : p));
        }
        let published = transcript;
        // detached = 결과를 쓸 곳이 없다(대본이 지워졌거나, 같은 파일을 새로 전사하는 중). 그동안은 저장도 하지 않는다 —
        // 예전엔 시작 때 사본을 그대로 저장해서, 지운 대본이 되살아나거나 그사이 바뀐 저장본을 덮어썼다.
        let detached = false;
        const fileKey = `${fileInfo.name}_${fileInfo.size}`;
        // 이 대본이 지금 열려 있는 항목. 홈으로 나갔다 다시 열면 번호(id)가 바뀌므로 파일(이름·크기)로도 찾는다.
        const openEntry = () => liveEntry(fileId)
            || (filesRef?.current || []).find(p => p.file && `${p.file.name}_${p.file.size}` === fileKey) || null;
        const updateGlobalState = (data) => {
            const entry = openEntry();
            if (entry) {
                // 다시 연 항목이 새로 전사되는 중이면 이 실행의 결과는 옛 대본의 것이다
                if (!Array.isArray(entry.data) || (entry.id !== fileId && entry.isAnalyzing)) { detached = true; return null; }
                detached = false;
                // '다시 전사 중' 표시는 지금 도는 작업 기준으로 맞춘다(끝난 작업의 표시가 남지 않게)
                published = syncBusyFlags(mergeAnalysis(entry.data, data, owned), busyKeysOf(entry.id));
                if (published !== entry.data) commitData(entry.id, published);
                return published.length > 0 ? published : null; // 빈 대본은 저장하지 않는다(안전장치)
            }
            // 대본이 닫혀 있으면(홈으로 나감) 저장본에 넣는다. 저장에 실패해 보관 중인 내용이 있으면 그것에 넣는다.
            // 그사이 감지가 채운 대사 끝도 옮겨 온다.
            // 저장본은 정리(sanitizeData)하지 않고 그대로 쓴다 — 저장된 모양이 곧 화면에 있던 모양이라 문장을 그대로 짝지을 수 있다
            // (정리하면 시작 시각이 표시 문자열 기준으로 다시 계산돼, 방금 자르거나 다시 전사한 문장의 짝이 어긋난다).
            const base = unsavedRef.current.get(fileKey)?.data || parseCacheEntry(`gemini_analysis_${fileKey}`)?.rawData;
            if (!Array.isArray(base)) { detached = true; return null; }
            detached = false;
            const graft = speechEndGraftRef.current;
            published = syncBusyFlags(mergeAnalysis(base, data, owned).map(d => {
                if (typeof d.speechEnd === 'number') return d;
                const se = graft.get(`${fileKey}|${d.seconds}`);
                return typeof se === 'number' ? { ...d, speechEnd: se } : d;
            }), busyKeysOf(fileId));
            return published.length > 0 ? published : null;
        };

        if (pendingIndices.length === 0) return { total: 0, success: 0, failedIndices: [] };

        // [인터넷 없음] 요청을 보내지 않고 문장을 '분석 전' 그대로 둔다. 실패로 표시하지 않는 이유:
        // 실패 표시는 저장되고 자동으로 다시 돌지 않는다. 그대로 두면 인터넷이 될 때 대본을 열면 이어서 분석한다(loadCache).
        if (isOffline()) {
            if (showToast) showToast({ message: `${OFFLINE_MESSAGE}. 연결된 뒤 대본을 다시 열면 남은 ${pendingIndices.length}문장을 이어서 분석해요.`, type: 'error', duration: 8000 });
            return { total: pendingIndices.length, success: 0, failedIndices: [], aborted: true, data: transcript };
        }

        // [Claude 2단계] 호출부는 늘 Gemini 키를 넘긴다(1단계가 Gemini라 항상 있음). 고른 모델이 Claude면 여기서 Claude 키로
        // 바꿔 끼운다 — 키가 없으면 요청을 하나도 보내지 않고 실패 카드+안내(Gemini로 몰래 바꾸지 않는다, 사용자 결정 Q5).
        const useClaude = modelsUsed.some(isClaudeModel);
        if (useClaude && !claudeApiKey) {
            // 요청을 안 보내고 바로 끝나므로 '지금 대본'이 아직 이 대본으로 안 바뀌었을 수 있다(호출부가 방금 화면에 올림)
            // → 여기서는 받은 대본에 직접 표시한다. 재분석 중이던 문장은 실패 표시 대신 옛 분석으로 되돌린다.
            const failed = syncBusyFlags(transcript.map((d, i) => (owned.has(i) ? (restorePrev(d) || { ...d, analysisFailed: true }) : d)), busyKeysOf(fileId));
            commitData(fileId, failed);
            persistCache(fileInfo, failed, saveStatusOf(failed) === 'completed' ? 'completed' : 'partial');
            if (carry && stage2CarryRef.current.get(fileId) === carry) stage2CarryRef.current.delete(fileId);
            if (showToast) showToast({ message: '2단계 모델이 Claude인데 Claude 키가 없어요. 설정에서 키를 넣거나 2단계를 Gemini로 바꿔 주세요.', type: 'error', duration: 10000 });
            return { total: pendingIndices.length, success: 0, failedIndices: pendingIndices, keptOld: pendingIndices.filter(i => transcript[i]._prev), aborted: false, data: failed };
        }
        const keyFor = (modelId) => (isClaudeModel(modelId) ? claudeApiKey : currentApiKey);
        // 묶음이 사유를 달고 실패하면(Claude 키·크레딧) 마지막 사유를 안내 문구에 쓴다
        let failReason = '';
        const noteFailReason = (results) => {
            const r = (results || []).find(x => x?.failed && x.errorMessage);
            if (r) failReason = r.errorMessage;
        };

        // [진행 표시] 백그라운드 분석 시작 — 상단 배너용 (전체 스피너가 없는 재분석/이어서분석에서 노출)
        const myRun = ++stage2RunIdRef.current;
        setStage2Progress({ fileId, done: 0, total: pendingIndices.length, startedAt: Date.now(), note: '' });
        // 띠의 두 번째 줄 — 재시도·자동 교정처럼 숫자가 안 오르는 동안 '지금 뭘 하는지'. 묶음이 끝나면 비운다.
        const setNote = (note) => setStage2Progress(p => (p && p.fileId === fileId ? { ...p, note } : p));
        const onBatchStatus = (st) => {
            if (st.phase === 'wait') setNote(`재시도 ${st.attempt}/${st.maxAttempts} · ${st.reason} (${Math.max(1, Math.round(st.waitMs / 1000))}초 뒤)`);
            else if (st.attempt > 1) setNote(`재시도 ${st.attempt}/${st.maxAttempts} 요청 중`);
        };

        const BATCH_SIZE = 25;
        // 모델이 섞이면 가장 좁은 동시 실행 수에 맞춘다
        const CONCURRENCY = Math.min(...(modelsUsed.length ? modelsUsed : [currentModelId]).map(getStage2Concurrency));
        // 묶음은 모델별로 나눈다(각 묶음에 .model). 이번에 받은 모델의 묶음(사용자가 방금 시킨 문장)이 먼저 나간다.
        const batches = batchesByModel(pendingIndices, modelAt, BATCH_SIZE, currentModelId);

        console.log(`[Stage 2] Split into ${batches.length} batches (Max ${CONCURRENCY} concurrent).`);

        let workingData = JSON.parse(JSON.stringify(transcript));
        let totalSuccessCount = 0;

        // rolling 워커풀: 그룹 하드 장벽(Promise.all-per-group)을 제거 → 항상 CONCURRENCY개 배치가 in-flight.
        // 한 배치가 느려도(재시도/타임아웃) 다른 워커는 계속 다음 배치를 당겨 처리 → head-of-line blocking 제거.
        // 배치 간 의존성 없음(불변 text만 읽고 배타적 index에만 기록) → 완료 순서 무관, 프롬프트·출력 동일.
        let batchCursor = 0;

        const processBatch = async (batchIndices) => {
            const batchItems = batchIndices.map(idx => ({ index: idx, text: workingData[idx].text }));
            // 분석 정확도용 앞뒤 문맥(대상 제외, 최대 CONTEXT_EACH씩). 참고용으로만 전달.
            const CONTEXT_EACH = 5;
            const targetSet = new Set(batchIndices);
            const ctxSet = new Set();
            for (const idx of batchIndices) {
                for (let d = 1; d <= CONTEXT_EACH; d++) {
                    if (idx - d >= 0) ctxSet.add(idx - d);
                    if (idx + d < workingData.length) ctxSet.add(idx + d);
                }
            }
            for (const t of targetSet) ctxSet.delete(t);
            const contextItems = [...ctxSet].sort((a, b) => a - b)
                .slice(0, 40) // 폭주 방지 상한
                .map(idx => ({ index: idx, text: workingData[idx].text }));
            try {
                const results = await analyzeBatchSentences(batchItems, keyFor(batchIndices.model), batchIndices.model, signal, contextItems, false, true, onBatchStatus);
                noteFailReason(results);
                if (results && !signal.aborted) {
                    let groupSuccess = 0;
                    results.forEach(res => {
                        if (res && res.translation && !res.failed) {
                            workingData[res.index] = {
                                ...workingData[res.index],
                                translation: res.translation,
                                analysis: res.analysis,
                                transcriptSuspect: res.transcriptSuspect || '', // 규칙15: 없으면 빈 값(배지 없음)
                                av: ANALYSIS_VERSION, // 이 문장을 분석한 규칙 버전(cacheUtils#analysisVersionOf)
                                isAnalyzed: true
                            };
                            if (carry) carry.delete(lineKey(transcript[res.index])); // 끝낸 문장: 다음에 다시 분석하라면 그때 모델로
                            groupSuccess++;
                        }
                    });
                    totalSuccessCount += groupSuccess;
                    const shown = updateGlobalState(workingData); // null = 쓸 곳 없음(지워진 대본) → 저장도 안 함
                    setStage2Progress(p => ({ ...(p || {}), fileId, done: totalSuccessCount, total: pendingIndices.length, note: '' }));
                    // 상태는 묶음 수가 아니라 실제 분석된 문장으로 — 예전엔 0문장 성공 묶음도 성공으로 세어, 마지막 묶음 뒤
                    // 마무리 저장까지(점검 실측 약 33초) 빈 문장이 있는데도 'completed'로 저장돼 있었다(그사이 중단되면 그대로 남음)
                    if (shown) persistCache(fileInfo, shown, saveStatusOf(shown));
                    if (refreshCacheKeys) refreshCacheKeys();
                }
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.error(`[Stage 2] Batch failed:`, e);
            }
        };

        const runBatchWorker = async () => {
            while (!signal.aborted) {
                const bi = batchCursor++;
                if (bi >= batches.length) break;
                await processBatch(batches[bi]);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => runBatchWorker()));

        // [뭉침 자동 교정 — 검증형 재시도] 뭉친 문장을 '강제 분할'로 재분석하되,
        // 결과가 '더 잘 쪼개졌을 때만' 채택하고, 여전히 뭉치면 최대 MAX_SPLIT_RETRIES회까지 재시도(퇴행 방지).
        const MAX_SPLIT_RETRIES = 3;
        let didRetry = false;
        for (let round = 0; round < MAX_SPLIT_RETRIES && !signal.aborted; round++) {
            const lumped = pendingIndices.filter(idx => {
                const d = workingData[idx];
                return d && d.isAnalyzed && isLumpedAnalysis(d.text, d.analysis);
            });
            if (lumped.length === 0) break;
            didRetry = true;
            console.log(`[Stage 2] 뭉침 ${lumped.length}개 (라운드 ${round + 1}/${MAX_SPLIT_RETRIES}) → 강제 분할 재분석(배치)`);
            setNote(`뭉친 문장 ${lumped.length}개 다시 분석 (${round + 1}/${MAX_SPLIT_RETRIES})`);

            // [비용 절감] 뭉친 문장을 문장당 개별 호출하지 않고 BATCH_SIZE 단위로 묶어 forceSplit 재분석
            //  → 대형 프롬프트 프리픽스 재전송이 L회 → ⌈L/BATCH_SIZE⌉회로 감소. 파싱은 INDEX별 독립,
            //    'better' 가드(더 잘 쪼개졌을 때만 채택)는 그대로라 퇴행 없음(품질 동등 이상).
            const splitBatches = batchesByModel(lumped, modelAt, BATCH_SIZE, currentModelId);

            let splitCursor = 0;
            const processSplitBatch = async (idxGroup) => {
                const batchItems = idxGroup.map(idx => ({ index: idx, text: workingData[idx].text }));
                try {
                    // 문맥 생략(속도) + forceSplit=true 로 강제 분할 요청
                    const results = await analyzeBatchSentences(batchItems, keyFor(idxGroup.model), idxGroup.model, signal, [], true, true, onBatchStatus);
                    if (results && !signal.aborted) {
                        results.forEach(res => {
                            if (res && res.translation && !res.failed) {
                                const prev = workingData[res.index];
                                // 나빠진 것 없이 나아졌을 때만 채택 (analysisCoverage.js#shouldAdoptSplitRetry)
                                if (shouldAdoptSplitRetry(prev.text, prev.analysis, res.analysis)) {
                                    workingData[res.index] = {
                                        ...prev,
                                        translation: res.translation,
                                        analysis: res.analysis,
                                        transcriptSuspect: res.transcriptSuspect || '',
                                        av: ANALYSIS_VERSION,
                                        isAnalyzed: true
                                    };
                                }
                            }
                        });
                        updateGlobalState(workingData);
                    }
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    console.warn('[Stage 2] 강제 분할 재분석 실패:', e);
                }
            };
            const runSplitWorker = async () => {
                while (!signal.aborted) {
                    const si = splitCursor++;
                    if (si >= splitBatches.length) break;
                    await processSplitBatch(splitBatches[si]);
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, splitBatches.length) }, () => runSplitWorker()));
        }
        // [누락 자동 재시도 (2026-10)] 모델이 청크 하나를 통째로 건너뛰어 원문 단어가 빠진 문장을 한 번 더 요청한다.
        // 앱이 잘라 먹는 게 아니라 응답 원문부터 빠져 있는 것(실측: 저장 청크 수 < 응답 청크 수인 문장 0개,
        // 누락 배지 3~16%/실행). 문맥 없이 작은 묶음으로 다시 보내면 대개 채워진다. 채택은 '빠진 단어가 줄었을 때만'
        // (shouldAdoptMissingRetry — 문장 전체 1청크 결과는 거부). 최대 2라운드.
        const MAX_MISSING_RETRIES = 2;
        for (let round = 0; round < MAX_MISSING_RETRIES && !signal.aborted; round++) {
            const missingIdx = pendingIndices.filter(idx => {
                const d = workingData[idx];
                return d && d.isAnalyzed && missingWordCount(d.text, d.analysis) > 0;
            });
            if (missingIdx.length === 0) break;
            didRetry = true;
            console.log(`[Stage 2] 누락 ${missingIdx.length}개 (라운드 ${round + 1}/${MAX_MISSING_RETRIES}) → 재분석(배치)`);
            setNote(`빠진 단어 ${missingIdx.length}문장 다시 분석 (${round + 1}/${MAX_MISSING_RETRIES})`);
            const missBatches = batchesByModel(missingIdx, modelAt, BATCH_SIZE, currentModelId);
            let missCursor = 0;
            const processMissBatch = async (idxGroup) => {
                const batchItems = idxGroup.map(idx => ({ index: idx, text: workingData[idx].text }));
                try {
                    const results = await analyzeBatchSentences(batchItems, keyFor(idxGroup.model), idxGroup.model, signal, [], false, true, onBatchStatus);
                    if (results && !signal.aborted) {
                        results.forEach(res => {
                            if (res && res.translation && !res.failed) {
                                const prev = workingData[res.index];
                                if (shouldAdoptMissingRetry(prev.text, prev.analysis, res.analysis)) {
                                    workingData[res.index] = {
                                        ...prev,
                                        translation: res.translation,
                                        analysis: res.analysis,
                                        transcriptSuspect: res.transcriptSuspect || '',
                                        av: ANALYSIS_VERSION,
                                        isAnalyzed: true
                                    };
                                }
                            }
                        });
                        updateGlobalState(workingData);
                    }
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    console.warn('[Stage 2] 누락 재분석 실패:', e);
                }
            };
            const runMissWorker = async () => {
                while (!signal.aborted) {
                    const mi = missCursor++;
                    if (mi >= missBatches.length) break;
                    await processMissBatch(missBatches[mi]);
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missBatches.length) }, () => runMissWorker()));
        }

        if (didRetry && !signal.aborted) {
            const shown = updateGlobalState(workingData); // 그사이 다른 저장(복구·감지)이 있었으면 그 위에 넣는다
            if (shown) persistCache(fileInfo, shown, saveStatusOf(shown));
        }

        // 끝까지 돌았으면 문장별 모델 기억을 지운다. 중단됐으면 남겨 둔다 — 이어받는 분석이 남은 문장을 같은 모델로 돈다.
        if (!signal.aborted && carry && stage2CarryRef.current.get(fileId) === carry) stage2CarryRef.current.delete(fileId);

        // 이 실행이 최신일 때만 진행배너 정리 (옛 실행이 새 배너를 지우지 않게)
        if (stage2RunIdRef.current === myRun) setStage2Progress(null);

        // 최종적으로 여전히 미분석인 대상 = 실패 문장
        const failedIndices = pendingIndices.filter(idx => !workingData[idx].isAnalyzed);

        // [실패 표시] 분석이 끝났는데도 미분석으로 남은 문장에 analysisFailed 플래그를 단다.
        // → 무한 로딩 스피너 대신, 문장 카드에 '분석 실패 · 다시 시도' UI가 뜬다.
        // (취소/파일전환으로 중단된 경우는 실패가 아니므로 제외)
        // 재분석 중이던 문장(옛 분석을 _prev로 들고 있음)은 실패 표시 대신 옛 분석으로 되돌린다 — 예전엔 재분석 함수만
        // 옛 분석을 들고 있어서, 재분석이 다른 편집으로 끊기고 이어진 분석이 실패하면 옛 분석이 사라졌다.
        const keptOld = [];
        if (!signal.aborted && failedIndices.length > 0) {
            failedIndices.forEach(idx => {
                const back = restorePrev(workingData[idx]);
                if (back) keptOld.push(idx);
                workingData[idx] = back || { ...workingData[idx], analysisFailed: true };
            });
            const shown = updateGlobalState(workingData);
            // 'partial' = 끝났는데 실패 문장이 남음 → 기록 창 배지 '일부 실패'(cacheStatusOf). 열면 남은 문장을 이어서 분석
            if (shown) {
                const endStatus = saveStatusOf(shown);
                persistCache(fileInfo, shown, endStatus === 'analyzing' ? 'partial' : endStatus);
            }
        }
        const allKeptOld = keptOld.length > 0 && keptOld.length === failedIndices.length;
        // 안내의 [다시 시도]: 누를 때 지금 대본에서 그 문장들을 다시 찾는다(그사이 문장 수가 바뀌면 번호가 밀린다)
        const failedLines = failedIndices.map(i => workingData[i]);
        const retryFailed = () => {
            const at = locateLines(liveEntry(fileId)?.data || [], failedLines);
            if (at.length > 0) reanalyzeSentences(fileId, at);
        };

        if (!signal.aborted && totalSuccessCount === 0 && pendingIndices.length > 0) {
            console.error('[Stage 2] All batches failed.');
            // 원인은 오류 응답만이 아니다 — 응답 형식이 깨져도(마커 없음) 여기로 온다. 예전 문구 'API 오류… 모델을 확인'은
            // 그런 경우 엉뚱한 안내였다(점검 #20). 사실만 알리고 다시 시도 버튼을 준다.
            // Claude 키·크레딧처럼 조치할 사유가 있으면 그 문구를 앞세운다(다시 시도도 2단계 모델로 돈다 — 크레딧 문구가 2단계를 Gemini로 바꾸라고 안내)
            if (showToast) showToast({
                message: allKeptOld
                    ? `${failReason ? failReason + ' ' : ''}${keptOld.length}개 문장 재분석 실패 — 기존 분석을 유지했어요.`
                    : failReason
                    ? `${failReason} (${failedIndices.length || pendingIndices.length}개 문장 분석 안 됨)`
                    : `${failedIndices.length || pendingIndices.length}개 문장을 분석하지 못했어요. 잠시 후 다시 시도해 주세요.`,
                type: 'error',
                ...(failedIndices.length ? { action: { label: '다시 시도', onClick: retryFailed } } : {}),
                duration: failReason ? 12000 : 8000,
            });
        } else if (!signal.aborted && reportPartialFail && failedIndices.length > 0 && totalSuccessCount > 0) {
            // [부분 실패 알림] 일부 배치만 실패 → 조용히 두지 말고 개수 표시 + 재시도 제공
            if (showToast) showToast({
                message: failReason
                    ? `${failReason} (${failedIndices.length}개 문장 분석 안 됨, 나머지는 완료)`
                    : `${failedIndices.length}개 문장 분석 실패. 나머지는 완료됐어요.`,
                type: 'error',
                action: { label: '실패분 재시도', onClick: retryFailed },
                duration: 8000,
            });
        }

        // 클라우드에 최종 분석 결과 반영 (best-effort, mediaUrl은 서버가 기존 값 보존)
        if (!signal.aborted && totalSuccessCount > 0 && !detached) {
            cloudSaveMeta(fileInfo, published, saveStatusOf(published), null, 0)
                .catch(e => console.warn('[Cloud] 분석 결과 저장 실패:', e));
        }

        console.log(`[Stage 2] Finished. Analyzed: ${totalSuccessCount}/${pendingIndices.length}`);
        // data = 이 실행이 마지막으로 화면·캐시에 쓴 대본. keptOld = 실패했지만 옛 분석으로 되돌린 문장(failedIndices에도 들어 있다)
        return { total: pendingIndices.length, success: totalSuccessCount, failedIndices, keptOld, aborted: signal.aborted, data: published };
    };

    /**
     * Stage 1 실행 공통 로직
     */
    // identity: 캐시 신원(원본 파일). file은 메모리 적재본이라 크기가 다를 수 있다(runStage2의 fileInfo 주의와 같은 이유)
    const runStage1 = async (fileId, file, precomputedDuration = null, identity = file) => {
        // 기존 Stage 1 중단
        if (stage1AbortRef.current) stage1AbortRef.current.abort();
        stage1AbortRef.current = new AbortController();
        stage1OwnerRef.current = fileId; // '전사 중단'은 이 파일 것일 때만 이 채널을 끊는다
        const { signal } = stage1AbortRef.current;

        // 호출부에서 이미 계산했으면 재사용, 아니면 여기서 계산 (중복 계산 방지)
        let fileDuration = precomputedDuration;
        if (fileDuration == null) {
            fileDuration = 0;
            try { fileDuration = await getMediaDuration(file); } catch (e) { console.warn("Failed to get media duration:", e); }
        }
        console.log(`[Stage 1] Real duration for ${file.name}: ${fileDuration}s (Temp: ${temperature}, TopP: ${topP})`);

        // 스트림이 끊겨(서버·반복 루프·저작권 차단) 자동 이어받기로도 끝까지 못 받은 지점(가장 이른 곳)과 사유.
        // 전사가 끝난 뒤 한 번 알린다 — 예전엔 이 경우가 '정상 완료'로 조용히 저장돼,
        // 노래 뒷부분이 빠진 걸 사용자가 직접 발견해야 했다.
        let incomplete = null;
        const rawData = await extractTranscript(file, apiKey, stage1Model, {
            onIncomplete: (info) => { if (!incomplete || info.at < incomplete.at) incomplete = info; },
            onAudioUploaded: (part) => rememberAudio(stage1AudioRef.current, identity, part, fileDuration),
            totalDuration: fileDuration,
            onProgress: (incrementalData) => {
                setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data: incrementalData } : p));
            },
            temperature,
            topP,
            signal,
            antiRecitation,
            markerChar,
            markerInterval,
            chunkEnabled,
            chunkMinutes,
            realignEnabled,
        });

        if (!rawData) throw new Error("Received empty data from Stage 1 API");

        const data = sanitizeData(rawData, fileDuration);
        if (data.length === 0) throw new Error("Stage 1 extraction returned no valid text data.");

        if (incomplete && showToast) {
            showToast({ message: incompleteNotice(incomplete), type: 'error', duration: 12000 });
        }

        // incomplete = 끝까지 못 받은 지점 { at, reason }(없으면 null). 안내는 12초 뒤 사라지므로 호출부가 대본에 표시를 남긴다.
        return { data, incomplete };
    };

    // Stage1 전사 → 캐시/클라우드 저장 → Stage2 분석까지, 한 파일의 전체 파이프라인.
    // 신규 업로드(processFiles)와 재시도(retryAnalysis)가 공유한다.
    //  - saveMedia: 원본을 IndexedDB에 저장 (재생 복원용)
    //  - syncCloud: 원본 영상 업로드 + 대본 저장 (다른 기기 열람용)
    // [같은 파일 표시] 전사가 끝나 저장될 때까지 `이름_크기 → fileId`를 걸어 둔다. 그사이 같은 파일을 또 올리면(홈으로 나갔다 오거나
    // 목록에서 다시 올림) processFiles가 새 전사를 시작하지 않고 이 전사에 붙는다 — 예전엔 전사가 두 번 나갔다(2026-11-21 재현).
    const runFullAnalysis = async (fileId, sourceFile, opts = {}) => {
        const runKey = `${sourceFile.name}_${sourceFile.size}`;
        const run = {};
        stage1KeysRef.current.set(runKey, fileId);
        stage1RunRef.current.set(runKey, run);
        // 자기가 건 표시일 때만 지운다. 취소 → '다시 시도'는 같은 fileId로 새 실행이 표시를 다시 거는데, 취소된 앞 실행이
        // 뒤늦게 끝나며 그 표시를 지워 같은 파일을 또 올리면 전사가 두 번 나갔다(2026-11-21 독립 검토에서 실행 재현).
        const release = () => {
            if (stage1RunRef.current.get(runKey) !== run) return;
            stage1RunRef.current.delete(runKey);
            if (stage1KeysRef.current.get(runKey) === fileId) stage1KeysRef.current.delete(runKey);
        };
        try {
            return await runFullAnalysisInner(fileId, sourceFile, opts, release);
        } finally {
            release();
        }
    };

    const runFullAnalysisInner = async (fileId, sourceFile, { saveMedia = false, syncCloud = false, awaitStage2 = false, gen: startGen } = {}, release = () => {}) => {
        // 시작한 뒤 '전사 중단'을 눌렀으면 전사 요청을 보내기 전에 멈춘다(파일 읽기·길이 재기 사이에 눌린 경우)
        // startGen: 호출부가 더 일찍(버튼을 누른 순간) 읽어 둔 값 — '다시 시도'는 여기 오기 전에 기다림이 있다
        const gen = startGen ?? (stage1GenRef.current.get(fileId) || 0);
        const stopIfCancelled = () => {
            if ((stage1GenRef.current.get(fileId) || 0) !== gen) throw new DOMException('Aborted', 'AbortError');
        };
        stopIfCancelled();
        // 인터넷이 없으면 소리 꺼내기(32MB 도구 내려받기)부터 헛돈다 → 바로 안내. 실패 화면이 이 문구를 제목으로 쓴다(failureNotice).
        if (isOffline()) throw new Error(OFFLINE_MESSAGE);
        if (!apiKey) throw new Error("Please set Gemini API Key in Settings.");
        // 2단계가 Claude인데 키가 없으면 전사(비용)부터 쓰지 말고 여기서 멈춘다
        if (isClaudeModel(stage2Model) && !claudeApiKey) throw new Error("2단계 모델이 Claude인데 Claude 키가 없어요. 설정에서 Claude 키를 넣거나 2단계를 Gemini로 바꿔 주세요.");

        // 전사(분석)용으로만 파일을 메모리에 적재 시도 (클라우드/온디맨드 파일 대응).
        // 재생 URL과 state의 원본 file은 그대로 유지 → 재생은 원본으로 정상 동작. 실패 시 원본 폴백.
        let fileForAnalysis = sourceFile;
        try {
            fileForAnalysis = await materializeFile(sourceFile, {
                onWait: (n) => { if (n === 1 && showToast) showToast({ message: '파일 불러오는 중...', type: 'success' }); }
            });
        } catch (e) {
            console.warn('[Stage 1] 메모리 적재 실패 → 원본 파일로 진행:', e.message);
            fileForAnalysis = sourceFile;
        }
        stopIfCancelled();

        // 미디어 길이는 한 번만 계산해 Stage 1 전사와 클라우드 메타에서 공유 (중복 계산 제거)
        let duration = 0;
        try { duration = await getMediaDuration(fileForAnalysis); } catch (e) { console.warn("Failed to get media duration:", e); }

        stopIfCancelled(); // 바로 아래 runStage1이 중단 채널을 만든다 — 그 뒤로는 '전사 중단'이 채널을 끊는다
        const { data, incomplete } = await runStage1(fileId, fileForAnalysis, duration, sourceFile);

        // 끝까지 못 받았으면 그 지점을 대본에 남긴다(화면 띠 + 저장) — 예전엔 12초 안내가 지나가면 '완료된 대본'과 구별이 안 됐다
        setFiles(prev => prev.map(p => p.id === fileId ? { ...p, data, isAnalyzing: false, incomplete: incomplete || null } : p));

        persistCache(sourceFile, data, 'extracted', { incomplete: incomplete || null });
        release(); // 저장됐다 — 이제 같은 파일을 올리면 저장된 대본을 연다
        if (refreshCacheKeys) refreshCacheKeys();

        // [자동 감지 옵션] 전사+분석이 '완료된 뒤' 대사 구간 감지를 자동 실행 (설정, 기본 꺼짐).
        // 완료 후에 돌리는 이유: 분석과 병행하면 API 동시 부하 + 결과 덮어쓰기 경합 창이 넓어진다.
        // 중단(aborted)이나 전량 실패 시엔 실행하지 않는다 — 취소한 파일에 감지 비용을 쓰지 않기 위함.
        // 신원은 sourceFile로 고정 — 이 위의 persistCache(sourceFile)·감지 저장과 같은 캐시 키를 쓴다
        // 자동 감지는 이제 runStage2 래퍼가 분석이 끝날 때 건다(autoSpeechEnds). 예전엔 여기 한 곳에서만 걸어서,
        // 이 분석이 다시 시도·홈 → 다시 열기·편집으로 끊기면 아무 표시 없이 영영 안 찾았다.
        const stage2Promise = runStage2(fileId, sourceFile, data, apiKey, stage2Model);

        if (saveMedia) {
            try {
                // 캐시/클라우드 메타는 sourceFile 신원으로 저장되므로 미디어도 동일 신원으로 저장해야
                // 나중에 loadCache가 name_size로 찾을 수 있다 (온디맨드 파일 크기 불일치 방지)
                await mediaStore.saveFile(fileForAnalysis, { name: sourceFile.name, size: sourceFile.size });
            } catch (storageError) {
                console.warn("Failed to save media file to store", storageError);
            }
        }

        if (syncCloud) {
            // 클라우드 동기화 (best-effort): 원본 영상 업로드 + 대본 저장 → 다른 기기서 열람 가능
            (async () => {
                try {
                    let mediaUrl = null;
                    try {
                        mediaUrl = await cloudUploadMedia(fileForAnalysis);
                    } catch (e) {
                        console.warn('[Cloud] 영상 업로드 실패:', e);
                    }
                    // [중요] 여기서 data를 보내면 안 된다.
                    // 대용량 업로드는 수 분이 걸리는데 그 사이 Stage 2(분석)와 대사 구간 감지가
                    // 이미 최신 결과를 클라우드에 저장한다. data는 Stage 1 시점 스냅샷에 고정돼
                    // 있으므로(runStage2가 깊은 복사로 작업) 그걸 다시 올리면 분석·speechEnd가
                    // 통째로 지워지고 status도 'extracted'로 되돌아간다.
                    // → 업로드 완료 시엔 mediaUrl만 갱신한다(data 생략 = 서버가 data.json 보존).
                    await cloudSaveMeta(sourceFile, undefined, undefined, mediaUrl, duration);
                } catch (e) {
                    console.warn('[Cloud] 대본 저장 실패:', e);
                }
            })();
        }

        // 순차 큐: 다음 파일로 넘어가기 전에 이 파일의 Stage2까지 완료 대기 (공유 abort ref 충돌 방지)
        if (awaitStage2) { try { await stage2Promise; } catch { /* 개별 실패는 runStage2가 처리 */ } }
    };

    // 순차 분석 큐: 여러 파일을 동시에 올려도 하나씩 '끝까지'(Stage1+Stage2) 처리한다.
    // (이전엔 파일마다 공유 abort ref를 새로 잡아 뒤 파일이 앞 파일을 중단시켜, 사실상
    //  한 파일만 완료되고 나머지는 스피너로 갇혔다. 큐로 직렬화해 모두 완료시킨다.)
    const processAnalysisQueue = async () => {
        if (queueRunningRef.current) return;      // 워커 중복 실행 방지
        queueRunningRef.current = true;
        try {
            while (analysisQueueRef.current.length > 0) {
                const fItem = analysisQueueRef.current.shift();
                try {
                    await runFullAnalysis(fItem.id, fItem.file, { saveMedia: true, syncCloud: true, awaitStage2: true });
                } catch (err) {
                    if (err.name === 'AbortError') {
                        // 큐 처리 중 외부(재분석/재전사/취소 등)가 공유 abort ref를 건드려 중단된 경우:
                        // 무한 스피너로 방치하지 말고, 아직 분석 중이면 재시도 가능한 상태로 전환한다.
                        setFiles(prev => prev.map(p => (p.id === fItem.id && p.isAnalyzing)
                            ? { ...p, isAnalyzing: false, error: "분석이 중단됐어요. 다시 시도할 수 있습니다." }
                            : p));
                        continue;
                    }
                    console.error("Analysis Error", err);
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
                }
            }
        } finally {
            queueRunningRef.current = false;
        }
    };

    const processFiles = async (fileList) => {
        setIsDragging(false);
        if (!fileList || fileList.length === 0) return;

        setIsSwitchingFile(true);
        if (resetPlayerState) resetPlayerState();

        console.log("[Upload] Processing files...", fileList);

        // [같은 파일] 지금 첫 전사가 돌고 있거나 줄 서 있는 파일을 또 올리면 새로 전사하지 않는다(비용 두 번).
        // 그 전사의 항목이 화면에 있으면 그리로 가고, 없으면(홈으로 나갔다 옴) 같은 번호로 항목을 다시 만든다 —
        // 돌고 있는 전사가 그 번호로 진행 상황과 결과를 넣는다.
        const order = [];      // 올린 순서대로의 항목 번호(화면에 띄울 순서)
        const newFiles = [];
        const reopened = [];
        let joined = 0;
        for (const file of Array.from(fileList)) {
            const runId = stage1KeysRef.current.get(`${file.name}_${file.size}`);
            if (runId) {
                joined++;
                order.push(runId);
                const open = (filesRef?.current || []).some(p => p.id === runId) || reopened.some(p => p.id === runId);
                if (!open) reopened.push({ id: runId, file, url: URL.createObjectURL(file), data: [], isAnalyzing: true, error: null });
                continue;
            }
            const item = {
                id: crypto.randomUUID(),
                file,
                url: URL.createObjectURL(file), // 재생은 항상 원본 파일로 (원래 동작 보존)
                data: [],
                isAnalyzing: true,
                error: null
            };
            newFiles.push(item);
            order.push(item.id);
        }
        if (joined > 0 && showToast) showToast({ message: '이미 전사 중인 파일이에요. 새로 시작하지 않고 진행 중인 전사를 이어서 보여 드려요.', type: 'success' });

        setFiles(prev => [...prev, ...reopened.filter(r => !prev.some(p => p.id === r.id)), ...newFiles]);
        // 목록 정렬: 방금 올린(연) 영상이 맨 위. 여러 개면 첫 파일이 가장 위(화면에 먼저 뜨는 파일)
        newFiles.slice().reverse().forEach((f, i) => touchRecent(`${f.file.name}_${f.file.size}`, Date.now() + i));

        if (order.length > 0) {
            setActiveFileId(order[0]);
        }
        setIsSwitchingFile(false);

        // fire-and-forget: 각 파일을 병렬로 독립 처리 (개별 try/catch로 에러 격리)
        newFiles.forEach(async (fItem) => {
            try {
                // 이미 분석된 캐시가 있으면 Stage 1/2 없이 즉시 복원
                const cacheKey = `gemini_analysis_${fItem.file.name}_${fItem.file.size}`;
                const cacheEntry = parseCacheEntry(cacheKey);
                if (cacheEntry) {
                    console.log("Using cached analysis for", fItem.file.name);
                    let cacheDuration = 0;
                    try { cacheDuration = await getMediaDuration(fItem.file); } catch (e) { console.warn("Failed to get cached media duration:", e); }
                    // settlePrev: 재분석이 끝나기 전에 닫혀 비어 있는 문장은 옛 분석으로 되돌린다
                    const data = settlePrev(sanitizeData(cacheEntry.rawData, cacheDuration));
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, data, isAnalyzing: false, isFromCache: true, incomplete: cacheEntry.metadata?.incomplete || null } : p));
                    // 분석이 덜 끝난 대본이면 남은 문장을 이어서 분석한다 — 목록에서 열 때(loadCache)와 같은 동작.
                    // 예전엔 여기서 끝나 '파일을 다시 올리면' 남은 분석이 영영 안 돌았다(2026-10-11 점검 #19).
                    // 같은 영상이 다른 항목으로 열려 전사·분석 중이면 건너뛴다 — runStage2 첫 줄의 abort가 그쪽 배치를
                    // 죽이고 같은 문장을 중복 분석하게 된다(loadCache의 재시작 방지와 같은 이유).
                    const idKey = `${fItem.file.name}_${fItem.file.size}`;
                    const sameFileBusy = (filesRef?.current || []).some(p => p.id !== fItem.id && p.file
                        && `${p.file.name}_${p.file.size}` === idKey && (p.isAnalyzing || stage2ActiveRef?.current?.get(p.id)));
                    const pending = data.filter(d => !d.isAnalyzed).length;
                    if (pending > 0 && apiKey && !sameFileBusy) {
                        console.log(`[Upload] 캐시 대본에 미분석 ${pending}문장 → Stage 2 이어서`);
                        runStage2(fItem.id, fItem.file, data, apiKey, stage2Model);
                    } else if (pending === 0 && !sameFileBusy) {
                        // 분석이 다 끝난 대본인데 대사 끝을 한 번도 안 찾았으면 지금 찾는다(목록에서 열 때와 같은 동작)
                        autoSpeechEnds(fItem.file, { fileId: fItem.id, data });
                    }
                    // 캐시된 대본이 있어도 미디어가 IndexedDB에 없으면 (재)저장 → 새로고침 후에도 재생 복원.
                    // (사이트 데이터 삭제 등으로 미디어 스토어가 비면, '연결하기'/재업로드 한 번으로 다시 채워짐)
                    // 진단용 토스트로 저장 성공/실패를 화면에 노출 (콘솔 없이도 원인 파악)
                    try {
                        const existing = await mediaStore.getFileFlexible(fItem.file.name, fItem.file.size);
                        if (existing) {
                            if (showToast) showToast({ message: `영상 이미 저장됨 (${mbText(fItem.file.size)}) — 새로고침 유지 정상`, type: 'success' });
                        } else if (!fItem.file.size) {
                            if (showToast) showToast({ message: '영상 저장 불가: 빈 파일(0바이트) — 온디맨드/클라우드 파일일 수 있음', type: 'error' });
                        } else {
                            await mediaStore.saveFile(fItem.file, { name: fItem.file.name, size: fItem.file.size });
                            if (showToast) showToast({ message: `영상 저장 완료 (${mbText(fItem.file.size)}) — 이제 새로고침해도 유지`, type: 'success' });
                        }
                    } catch (e) {
                        console.warn("캐시 히트 미디어 저장 실패:", e);
                        if (showToast) showToast({ message: `영상 저장 실패: ${e.name || ''} ${e.message || e}`, type: 'error' });
                    }
                    return;
                }

                // 캐시 없음 → 순차 큐에 넣고 워커 가동 (여러 파일이 서로를 중단시키지 않게 하나씩 완료)
                stage1KeysRef.current.set(`${fItem.file.name}_${fItem.file.size}`, fItem.id); // 줄 서 있는 동안에도 같은 파일 표시
                analysisQueueRef.current.push(fItem);
                processAnalysisQueue();
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("Analysis Error", err);
                setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
            }
        });
    };

    const retryAnalysis = async (fileId) => {
        const gen = stage1GenRef.current.get(fileId) || 0; // 누른 순간의 취소 세대 — 아래 기다림 사이에 '전사 중단'을 누르면 전사를 보내지 않는다
        // 인터넷이 없으면 아래에서 대본을 비우기 전에 멈춘다
        if (isOffline()) { if (showToast) showToast({ message: OFFLINE_MESSAGE, type: 'error' }); return; }
        // 기존 Stage 2 중단
        if (stage2AbortRef.current) stage2AbortRef.current.abort();

        // [경합 제거] 업데이터 안에서 값을 꺼내고 setTimeout(0)으로 기다리면, React 18 스케줄러가
        // 그보다 늦게 돌 때 값이 비어 조용히 return 한다(버튼을 눌러도 아무 일이 없음).
        const targetFile = (filesRef?.current || []).find(p => p.id === fileId)?.file || null;
        setFiles(prev => prev.map(p => p.id === fileId ? { ...p, error: null, data: [], isAnalyzing: true } : p));

        await new Promise(r => setTimeout(r, 0));
        if (!targetFile) { console.warn('[Retry] 대상 파일 없음', { fileId }); return; }

        try {
            // 영상이 이 기기에 아직 저장돼 있지 않으면 이번에 저장한다. 첫 시도는 전사가 성공한 뒤에 저장하는데,
            // 전사가 실패하면 저장까지 못 가서, 예전엔 다시 시도로 성공해도 영상 없는 대본(새로고침하면 소리 없음)이 됐다.
            let saveMedia = false;
            try {
                saveMedia = typeof Blob !== 'undefined' && targetFile instanceof Blob && targetFile.size > 0
                    && !(await mediaStore.getFile(targetFile.name, targetFile.size));
            } catch (e) { console.warn('[Retry] 저장된 영상 확인 실패:', e); }
            await runFullAnalysis(fileId, targetFile, { saveMedia, gen });
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error("Retry Analysis Error", err);
            setFiles(prev => prev.map(p => p.id === fileId ? { ...p, error: "Analysis failed: " + err.message, isAnalyzing: false } : p));
        }
    };

    // 다시 전사가 결과 없이 끝났을 때, 시작하며 멈춰 둔 분석을 다시 켠다.
    // 예전엔 남은 문장이 '분석 중' 표시만 단 채 멈춰 있었다(대본을 다시 열어야 이어짐, 2026-11-19 재현).
    // 그사이 다른 분석이 새로 시작됐으면(중단 채널이 새것) 건드리지 않는다 — 다시 부르면 도는 요청을 끊어 비용이 두 번 든다.
    const resumeAnalysis = (fileId, targetFile, model) => {
        if (!apiKey) return;
        if (stage2AbortRef.current && !stage2AbortRef.current.signal.aborted) return;
        const live = liveEntry(fileId)?.data;
        if (!Array.isArray(live) || !live.some(d => !d.isAnalyzed && !d.analysisFailed)) return;
        runStage2(fileId, targetFile, live, apiKey, model || stage2Model);
    };

    /**
     * [재전사 계열 공통 뼈대] 문장별 재전사·빈칸 복구·구간 재전사가 똑같이 하던 앞뒤 처리.
     *  누를 때: API 키 확인 → 지금 대본 읽기 → 기능별 사전 검사(prepare) → 진행 중인 분석 멈춤 → 대상 문장 '다시 전사 중' 표시 → 줄 서기
     *  차례가 오면: 대본을 다시 읽고 대상 문장을 시각·글자로 다시 찾음 → Stage 1 중단 채널 교체 → 원본 미디어 확보 → 기능별 본문(work)
     *  끝날 때: work가 ctx.land(대본)으로 결과를 반영하거나 ctx.fail()로 표시를 지우고 멈춰 둔 분석을 이어 간다.
     * 한 번에 하나만 돈다. 도는 중에 또 누르면 취소하지 않고 줄을 세운다(둘 다 '다시 전사 중' 표시).
     *  - picked: 사용자가 고른 문장 번호(누른 시점). 기다리는 사이 번호가 밀려도 다시 찾아 prepare·work에 넘긴다.
     *  - prepare(currentData, pickedNow): 부작용 전 검사. falsy면 조용히 중단. 반환값은 isTarget·work에 prep으로 전달.
     *  - isTarget(d, i, prep): '다시 전사 중' 표시할 문장
     *  - work(ctx): 결과는 시작 때 사본(currentData)이 아니라 '지금 대본'(ctx.live())에 넣어야 한다 —
     *    전사는 20~60초가 걸려 그사이 사용자가 다른 문장을 지우거나 자른다.
     */
    const runRetranscribeJob = (fileId, { label, failPrefix, missingToast = null, picked = [], prepare = () => ({}), isTarget }, work) => {
        if (isOffline()) { if (showToast) showToast({ message: OFFLINE_MESSAGE, type: 'error' }); return; }
        if (!apiKey) {
            if (showToast) showToast({ message: '설정에서 Gemini API 키를 먼저 입력하세요.', type: 'error' });
            return;
        }
        // 최신 사본(filesRef)에서 동기적으로 읽는다 — setFiles 업데이터 안에서 값을 꺼내면 늦게 돌 때 조용히 실패했다
        const base = liveEntry(fileId);
        const targetFile = base?.file || null;
        const requestData = base?.data || null;
        if (!targetFile || !Array.isArray(requestData) || requestData.length === 0) {
            console.warn(`[${label}] 대상 파일/데이터 없음`, { fileId });
            if (missingToast && showToast) showToast({ message: missingToast, type: 'error' });
            return;
        }
        const prep0 = prepare(requestData, picked);
        if (!prep0) return;

        const jobId = ++retranscribeSeqRef.current;
        const job = { fileId, keys: new Set(requestData.filter((d, i) => isTarget(d, i, prep0)).map(lineKey)) };
        retranscribeJobsRef.current.set(jobId, job);
        const pickedItems = picked.map(i => requestData[i]).filter(Boolean);
        const epoch = retranscribeEpochRef.current;

        // 진행 중인 분석을 멈춘다(결과를 넣은 뒤 다시 돌린다). 결과 없이 끝나면 같은 모델로 이어 간다.
        const resumeModel = stage2ActiveRef?.current?.get(fileId) ? stage2ModelRef.current.get(fileId) : null;
        if (stage2AbortRef.current) stage2AbortRef.current.abort();

        // 대상 문장에 '다시 전사 중' 표시
        commitData(fileId, syncBusyFlags(requestData, busyKeysOf(fileId)));

        // 이 작업의 표시만 지운다. 아직 안 끝난 다른 작업의 문장은 그대로 둔다.
        const clearFlag = () => {
            retranscribeJobsRef.current.delete(jobId);
            const cur = liveEntry(fileId)?.data;
            if (!Array.isArray(cur)) return;
            const next = syncBusyFlags(cur, busyKeysOf(fileId));
            if (next !== cur) commitData(fileId, next);
        };
        const fail = () => { clearFlag(); resumeAnalysis(fileId, targetFile, resumeModel); };
        // 결과 반영: 정리(sanitizeData)한 대본을 화면·사본에 넣고 돌려준다. 다른 작업의 '다시 전사 중' 표시는 남긴다.
        const landWith = (duration) => (rawData) => {
            retranscribeJobsRef.current.delete(jobId);
            const clean = syncBusyFlags(sanitizeData(rawData, duration), busyKeysOf(fileId));
            commitData(fileId, clean);
            return clean;
        };

        const execute = async () => {
            // 앞 작업이 중단됐으면(다른 영상의 전사가 시작됨 등) 기다리던 작업도 시작하지 않는다 — 시작하면 그 전사를 끊는다
            if (epoch !== retranscribeEpochRef.current) {
                fail();
                if (showToast) showToast({ message: '앞선 전사가 중단돼 기다리던 다시 전사도 취소했어요. 다시 눌러 주세요.', type: 'error' });
                return;
            }
            const entry = liveEntry(fileId);
            const currentData = entry?.data;
            if (!entry || !Array.isArray(currentData) || currentData.length === 0) { retranscribeJobsRef.current.delete(jobId); return; }
            // 기다리는 사이 앞 작업이 문장 수를 바꿨을 수 있다 → 고른 문장을 시각·글자로 다시 찾는다
            const pickedNow = locateLines(currentData, pickedItems);
            const prep = pickedItems.length > 0 && pickedNow.length === 0 ? null : prepare(currentData, pickedNow);
            if (!prep) {
                fail();
                if (showToast) showToast({ message: '고치려던 문장이 그사이 바뀌어 다시 전사를 건너뛰었어요.', type: 'error' });
                return;
            }
            const targetUrl = entry.url || null;

            // 재전사도 Stage 1 계열 → 같은 abort 채널 사용 (새 영상 전사가 시작되면 함께 취소됨)
            if (stage1AbortRef.current) stage1AbortRef.current.abort();
            stage1AbortRef.current = new AbortController();
            stage1OwnerRef.current = null; // 첫 전사가 아니다 — 첫 전사 화면의 '전사 중단'이 이 작업을 끊지 않는다
            const { signal } = stage1AbortRef.current;

            try {
                // 온디맨드/클라우드 파일 + 캐시 복원 자리표시자 대응 (3단 폴백) — 예전엔 자리표시자를 그대로 넘겨
                // createObjectURL이 터지고 복구가 조용히 실패했다
                const fileForAnalysis = await resolveRealFile(targetFile, targetUrl, label);
                if (!fileForAnalysis) {
                    fail();
                    if (showToast) showToast({ message: '원본 미디어를 읽을 수 없어요. 하단의 "연결하기"로 원본 파일을 연결한 뒤 다시 시도해 주세요.', type: 'error' });
                    return;
                }
                let duration = 0;
                try { duration = await getMediaDuration(fileForAnalysis); } catch (e) { console.warn('duration 계산 실패:', e); }

                await work({
                    targetFile, targetUrl, currentData, fileForAnalysis, duration, signal, prep, fail,
                    live: () => liveEntry(fileId)?.data || currentData, // 대본이 닫혔으면 시작 때 사본(예전과 같은 동작)
                    land: landWith(duration),
                });
            } catch (err) {
                const aborted = err.name === 'AbortError';
                if (aborted) retranscribeEpochRef.current++;
                fail();
                if (aborted) {
                    if (showToast) showToast({ message: '다시 전사가 중단됐어요. 다시 눌러 주세요.', type: 'error' });
                    return;
                }
                console.error(`[${label}] 실패`, err);
                if (showToast) showToast({ message: `${failPrefix}: ` + err.message, type: 'error' });
            }
        };
        const turn = retranscribeQueueRef.current.then(execute);
        retranscribeQueueRef.current = turn.catch(() => {});
        return turn;
    };

    /**
     * [구간 선택 재전사]
     * 사용자가 고른 문장들의 시간대 오디오만 다시 전사하고, 그 자리에 교체한다.
     * 나머지 문장의 타임스탬프·분석은 그대로 보존된다(타임라인 최대 보존).
     * 새로 나온 문장은 미분석 상태로 넣고 runStage2가 그것들만 분석한다.
     */
    const retranscribeSentences = (fileId, indices) => runRetranscribeJob(fileId, {
        label: 'Retranscribe',
        failPrefix: '재전사 실패',
        picked: [...(indices || [])],
        prepare: (currentData, pickedNow) => {
            const sortedIdx = [...new Set(pickedNow || [])]
                .filter(i => i >= 0 && i < currentData.length)
                .sort((a, b) => a - b);
            return sortedIdx.length ? { sortedIdx } : null;
        },
        isTarget: (d, i, { sortedIdx }) => sortedIdx.includes(i),
    }, async ({ targetFile, targetUrl, currentData, fileForAnalysis, duration, signal, fail, live, land, prep: { sortedIdx } }) => {
        // 선택 문장을 '블록'(동일 시각으로 뭉친 연속 구간) 단위로 정규화.
        // 블록 시각 공유로 여러 문장이 같은 seconds를 가지면, 한 개만 교체 시 형제 문장이
        // 남아 중복이 생기므로 그 블록 전체를 통째로 교체한다. (보통은 lo===hi인 단일 문장)
        const grabTexts = (from, to) => collectTexts(currentData, from, to);
        const blockMap = new Map(); // lo -> { lo, hi, start, end }
        for (const i of sortedIdx) {
            const t = currentData[i].seconds;
            let lo = i; while (lo > 0 && currentData[lo - 1].seconds === t) lo--;
            let hi = i; while (hi < currentData.length - 1 && currentData[hi + 1].seconds === t) hi++;
            if (blockMap.has(lo)) continue;
            // 블록 끝(배타적 경계) = 다음(더 큰) 시각, 없으면 영상 끝
            let end = duration > t ? duration : t + 8;
            let nextIdx = -1;
            for (let j = hi + 1; j < currentData.length; j++) {
                if (currentData[j].seconds > t) { end = currentData[j].seconds; nextIdx = j; break; }
            }
            // 경계 겹침/딸려온 이웃 판별용 텍스트
            const prevText = lo > 0 ? (currentData[lo - 1].text || '') : '';
            const nextText = nextIdx >= 0 ? (currentData[nextIdx].text || '') : '';
            // 대상 블록 자신의 (기존) 텍스트 — 재전사 결과 중 '진짜 대상 문장'을 골라내는 기준
            const selfText = currentData.slice(lo, hi + 1).map(d => d.text || '').join(' ');
            // 프롬프트 문맥용 앞뒤 2문장 (경계 파편 차단)
            const contextBefore = grabTexts(lo - 2, lo - 1);
            const contextAfter = nextIdx >= 0 ? grabTexts(nextIdx, nextIdx + 1) : [];
            blockMap.set(lo, { lo, hi, start: t, end, prevText, nextText, selfText, contextBefore, contextAfter });
        }
        const blocks = [...blockMap.values()].sort((a, b) => a.lo - b.lo);
        const windows = blocks.map(b => ({ start: b.start, end: b.end, prevText: b.prevText, nextText: b.nextText, selfText: b.selfText, contextBefore: b.contextBefore, contextAfter: b.contextAfter }));

        // [속도·효율] 선택 구간이 한데 모여 있으면(유니온 ≤120초) 복구처럼 오디오 1회추출 후
        //  슬라이스 + 병렬 전사로 대폭 단축. 멀리 흩어져 유니온이 과대하면 기존 안전 방식 폴백.
        const unionSpan = windows.length
            ? Math.max(...windows.map(w => w.end)) - Math.min(...windows.map(w => w.start))
            : 0;
        const useSingleExtract = windows.length > 1 && unionSpan > 0 && unionSpan <= 120;

        const perWindow = await retranscribeSegments(fileForAnalysis, apiKey, stage3Model, windows, {
            totalDuration: duration,
            temperature,
            topP,
            signal,
            antiRecitation,
            markerChar,
            markerInterval,
            mediaSrc: targetUrl, // 실시간 캡처용(모바일 대응). 실패 시 전체추출 폴백
            singleExtract: useSingleExtract, // 모여 있을 때만 1회추출(유니온 과대 방지)
            concurrency: 3,                  // 유니온 추출 성공 시에만 병렬(실패 시 자동 순차)
        });

        // 결과는 '지금 대본'에 넣는다 — 전사하는 동안 지운 문장·맞춘 대사 끝을 되돌리지 않는다(utils/liveMerge)
        let failedCount = 0;
        let firstError = null;
        const mergeBlocks = [];
        blocks.forEach((b, k) => {
            const fresh = perWindow[k]?.sentences;
            if (fresh && fresh.length > 0) {
                mergeBlocks.push({ old: currentData.slice(b.lo, b.hi + 1), fresh }); // 새 문장은 isAnalyzed:false 상태
            } else {
                failedCount++; // 실패 → 원본 유지
                if (!firstError && perWindow[k]?.error) firstError = perWindow[k].error;
            }
        });
        if (mergeBlocks.length === 0) {
            fail();
            if (showToast) showToast({
                message: `재전사 실패: ${firstError || '결과 없음'}`,
                type: 'error'
            });
            return;
        }
        const before = live();
        const { data: newData, placed, skipped } = replaceLines(before, mergeBlocks);
        if (placed.length === 0) {
            // 전사하는 사이 사용자가 그 문장을 지우거나 잘랐다 — 손본 쪽을 남긴다
            fail();
            if (showToast) showToast({ message: '그 문장을 그사이 직접 고쳐서 다시 전사 결과는 넣지 않았어요.', type: 'error', duration: 6000 });
            return;
        }
        const cleanData = land(newData);

        persistCache(targetFile, cleanData, saveStatusOf(cleanData));
        if (refreshCacheKeys) refreshCacheKeys();

        const replacedCount = mergeBlocks.length - skipped;
        const notes = [
            failedCount ? `${failedCount}개는 실패로 원본 유지` : '',
            skipped ? `${skipped}개는 그사이 직접 고쳐서 건너뜀` : '',
        ].filter(Boolean).join(', ');
        if (showToast) showToast({
            message: `${replacedCount}개 구간 재전사 완료${notes ? `, ${notes}` : ''}. 분석 진행 중...`,
            type: 'success'
        });
        queueFreshSpeechEnds(fileId, targetFile, before, cleanData, placed, duration);
        // 새로 들어온(미분석) 문장만 분석 (재전사 흐름 — 받아쓰기는 3단계, 분석은 2단계 모델)
        runStage2(fileId, targetFile, cleanData, apiKey, stage2Model); // 신원=targetFile (이 위의 persistCache와 동일 키)
    });

    /**
     * [구간 선택 분석만 다시 - Phase 2 재실행]
     * 선택 문장의 전사(문장·타임스탬프)는 그대로 두고, 번역/분석만 지우고 다시 분석한다.
     * 오디오 재전사가 없어(텍스트만 전송) 빠르고 타임라인이 완전히 보존된다.
     */
    const reanalyzeSentences = async (fileId, indices) => {
        if (isOffline()) { if (showToast) showToast({ message: OFFLINE_MESSAGE, type: 'error' }); return; }
        if (!apiKey) {
            if (showToast) showToast({ message: '설정에서 Gemini API 키를 먼저 입력하세요.', type: 'error' });
            return;
        }
        if (!indices || indices.length === 0) return;

        // 진행 중인 Stage 2 중단 (재분석으로 재개)
        if (stage2AbortRef.current) stage2AbortRef.current.abort();

        const idxSet = new Set(indices);
        // 경합 제거 — 최신 사본(filesRef)에서 동기적으로 계산하고 상태엔 결과만 반영한다.
        // (예전엔 setFiles 업데이터 안에서 값을 꺼낸 뒤 setTimeout(0)을 기다렸는데, 업데이터가 늦게 돌면 조용히 아무것도 안 했다)
        const base = (filesRef?.current || []).find(p => p.id === fileId);
        const targetFile = base?.file || null;
        if (!targetFile || !Array.isArray(base?.data)) return;
        // 선택 문장만 미분석 상태로 리셋 (전사 텍스트·타임스탬프는 유지).
        // 옛 분석은 문장 안(_prev)에 넣어 둔다 → 재분석이 실패하거나 끊기면 분석(runStage2)·대본 열기가 그걸로 되돌린다.
        // 예전엔 이 함수만 들고 있어서, 재분석 중 다른 문장을 지우면(분석이 새로 시작됨) 옛 분석을 되찾을 길이 없었다.
        const resetData = base.data.map((d, i) => {
            if (!idxSet.has(i)) return d;
            // analysisFailed 해제 → 재시도 동안은 실패 UI가 아니라 로딩 스피너로 표시
            const next = { ...d, translation: '', analysis: '', a: '', transcriptSuspect: '', isAnalyzed: false, analysisFailed: false };
            delete next.av;
            // 전사의심 플래그도 함께 보관 — 실패 복원 시 배지 유지. 이미 재분석 중이던 문장(미분석 + _prev)은 그 _prev를 그대로 둔다.
            if (d.isAnalyzed) next._prev = { text: d.text, translation: d.translation, analysis: d.analysis, a: d.a, transcriptSuspect: d.transcriptSuspect || '', ...(d.av !== undefined ? { av: d.av } : {}) };
            return next;
        });
        const pickedLines = resetData.filter((_, i) => idxSet.has(i));
        commitData(fileId, resetData);

        // [원본 소실 방지] 지워진 버전을 여기서 따로 저장하지는 않는다. 다른 저장(묶음 완료·편집)에 섞여 저장돼도
        // 옛 분석이 문장 안에 같이 저장되므로, 도중에 탭이 닫히면 다시 열 때 옛 분석으로 되돌아간다(settlePrev).
        if (refreshCacheKeys) refreshCacheKeys();

        if (showToast) showToast({ message: `${idxSet.size}개 문장 분석을 다시 진행 중...`, type: 'success' });
        // 미분석(리셋된) 문장만 다시 분석 (재분석 → 2단계 모델. 2026-11-23 전엔 3단계(Flash)라 청크가 길게 뭉쳤다 — 같은 200문장 뭉침 Flash 32·20 vs Claude 7·5).
        // reportPartialFail:false — 일부 실패 안내는 아래에서 직접 한다(중복 토스트 방지).
        const result = await runStage2(fileId, targetFile, resetData, apiKey, stage2Model, { reportPartialFail: false });
        if (!result) return;
        // 안내의 [다시 시도]: 누를 때 지금 대본에서 그 문장들을 다시 찾는다
        const retry = (lines) => () => {
            const at = locateLines(liveEntry(fileId)?.data || [], lines);
            if (at.length > 0) reanalyzeSentences(fileId, at);
        };

        if (result.aborted) {
            // 도중에 끊겼다. 곧바로 다른 분석이 이 대본을 맡았으면(문장 삭제 뒤 이어 분석 등) 그쪽이 남은 문장을 처리한다.
            // 아무도 안 맡았으면(다시 전사 시작·다른 영상 분석·실행취소) 고른 문장을 옛 분석으로 되돌린다 — 안 그러면 빈 채로 남는다.
            if (stage2ActiveRef?.current?.get(fileId)) return;
            const live = liveEntry(fileId)?.data;
            if (!Array.isArray(live)) return;
            const at = new Set(locateLines(live, pickedLines));
            const back = [];
            const restored = live.map((d, i) => {
                if (!at.has(i) || d.isAnalyzed) return d;
                const old = restorePrev(d);
                if (old) back.push(old);
                return old || d;
            });
            if (back.length === 0) return;
            // 옛 분석으로 되돌린 문장은 더는 '하다 만 문장'이 아니다 → 모델 기억에서 뺀다
            const carried = stage2CarryRef.current.get(fileId);
            if (carried) for (const d of back) carried.delete(lineKey(d));
            commitData(fileId, restored);
            persistCache(targetFile, restored, saveStatusOf(restored));
            if (refreshCacheKeys) refreshCacheKeys();
            if (showToast) showToast({
                message: `재분석이 중단돼 ${back.length}개 문장은 기존 분석을 유지했어요.`,
                type: 'error',
                action: { label: '다시 시도', onClick: retry(back) },
                duration: 8000,
            });
            return;
        }

        // 실패한 문장은 runStage2가 옛 분석으로 되돌려 저장까지 했다(keptOld) — 여기서는 알리기만 한다.
        const kept = (result.keptOld || []).map(i => resetData[i]).filter(Boolean);
        if (kept.length > 0 && showToast) showToast({
            message: `${kept.length}개 문장 재분석 실패 — 기존 분석을 유지했어요.`,
            type: 'error',
            action: { label: '다시 시도', onClick: retry(kept) },
            duration: 8000,
        });
    };

    /**
     * [대사 끝 시각 감지] '대사만 재생' 모드용 1회성 패스.
     * 오디오+대본을 보내 문장별 speechEnd(대사가 실제로 끝나는 시각)를 받아 캐시에 저장한다.
     * Stage 1/2 파이프라인·전역 abort 채널을 일절 건드리지 않는다(큐 간섭 없음).
     * 병합은 스냅샷이 아니라 '최신 상태' 위에 한다 — 감지가 도는 몇 분 사이 Stage 2가
     * 분석을 채워 넣어도 덮어쓰지 않고, 문장별 seconds 일치 검사로 인덱스 어긋남도 방어.
     */
    // indices: 특정 문장 인덱스만 재감지(선택 재감지 A2). 넘기면 onlyMissing은 무시하고 그 문장들만
    //   — 이미 감지됐어도(부정확·포기) 포함해 새 값으로 덮어쓴다. 오디오는 문장별 클립만 전송(비용 비례).
    // baseData: 방금 고친 대본(filesRef는 화면 반영 뒤에야 바뀐다). silent: 자동 실행 — 결과는 카드 배지로 보이므로
    //   안내를 띄우지 않는다. 저장 실패 안내만은 그대로 띄운다(안 보이면 결과가 조용히 사라진다).
    const detectSpeechEndsForFile = async (fileId, { onlyMissing = false, indices = null, baseData = null, silent = false } = {}) => {
        const toast = (t) => { if (!silent && showToast) showToast(t); };
        if (isOffline()) { toast({ message: OFFLINE_MESSAGE, type: 'error' }); return false; }
        if (!apiKey) {
            toast({ message: '설정에서 Gemini API 키를 먼저 입력하세요.', type: 'error' });
            return false;
        }
        if (speechBusyRef.current) return false; // 중복 실행 방지 (ref — 자동 실행 경로의 stale state 회피)
        // 사용자가 직접 감지를 시작했으면 그 파일의 자동 감지 대기는 지운다(끝난 뒤 또 걸리지 않게)
        if (!silent) {
            const f0 = (filesRef?.current || []).find(p => p.id === fileId)?.file;
            if (f0?.name) { const k0 = `${f0.name}_${f0.size}`; autoSpeechQueueRef.current.delete(k0); autoSpeechTriedRef.current.add(k0); }
        }

        // [경합 제거] 예전엔 setFiles 업데이터 안에서 값을 꺼내고 setTimeout(0)으로 '실행됐겠지' 하고
        // 기다렸다. React 18은 자체 스케줄러(MessageChannel)로 업데이트를 처리하므로 setTimeout(0)이
        // 먼저 깨는 경우가 있고, 그러면 값이 비어 있는 채로 진행돼 조용히 실패했다. 최신 사본(ref)에서
        // 동기적으로 읽는다.
        const base0 = (filesRef?.current || []).find(p => p.id === fileId);
        const targetFile = base0?.file || null;
        const targetUrl = base0?.url || null;
        const snapshot = baseData || base0?.data || null;
        if (!targetFile || !Array.isArray(snapshot) || snapshot.length === 0) {
            console.warn('[SpeechEnd] 대상 파일을 찾지 못해 중단', { fileId, 목록수: (filesRef?.current || []).length });
            return false;
        }

        speechBusyRef.current = true;
        setSpeechDetectBusy(fileId);
        try {
            // 요청할 문장 고르기(선택 재감지 = 형제 포함 / onlyMissing = 미감지·미포기만) — utils/speechEndMerge
            const { sentences, selective } = selectSpeechEndTargets(snapshot, { onlyMissing, indices });
            if (sentences.length === 0) {
                toast({ message: selective ? '선택한 문장을 찾지 못했어요.' : '더 감지할 문장이 없어요. (남은 문장은 소리로 끝을 판단하기 어려운 구간이에요)', type: selective ? 'error' : 'success' });
                return !selective;
            }

            let duration = 0;
            let ends = null;
            // 전체/누락 감지: 1단계가 구글에 올린 같은 오디오가 있으면 그걸 쓴다 — 원본 다시 읽기·길이 계산·
            // 오디오 추출·업로드를 통째로 건너뛴다(utils/audioReuse). 실패하면(46시간 안에 지워졌거나 오류) 예전 방식으로.
            // 문장이 많으면(130개 초과) 조각으로 나눠 구간 소리만 보낸다 — 한 번에 보내면 모델이 번호를 헷갈려
            // 판단 불가가 수십~수백 개 나왔다(utils/speechEndParts). 조각은 소리를 잘라야 해서 1단계 업로드는 못 쓴다.
            const inParts = !selective && sentences.length > SPEECH_PART_MAX;
            const reuse = (selective || inParts) ? null : reusableAudio(stage1AudioRef.current, targetFile);
            if (reuse) {
                duration = reuse.duration || 0;
                try {
                    ends = await detectSpeechEnds(null, apiKey, stage1Model, sentences, { mediaPartOverride: reuse.part });
                } catch (e) {
                    if (e?.name === 'AbortError') throw e;
                    console.warn('[SpeechEnd] 1단계 오디오 재사용 실패 → 다시 올려서 감지:', e?.message || e);
                    forgetAudio(stage1AudioRef.current, targetFile);
                    ends = null;
                }
            }
            if (!ends) {
                const fileForAnalysis = await resolveRealFile(targetFile, targetUrl, 'SpeechEnd');
                if (!fileForAnalysis) {
                    toast({ message: '원본 미디어를 읽을 수 없어요. 하단의 "연결하기"로 원본 파일을 연결한 뒤 다시 시도해 주세요.', type: 'error' });
                    return false;
                }
                try { duration = await getMediaDuration(fileForAnalysis); } catch { /* 0이면 상한 클램프 생략 */ }
                // 선택 재감지는 클립만(비용 비례), 전체/누락 감지는 오디오 통째(기존).
                if (selective) {
                    ends = await detectSpeechEndsByClips(fileForAnalysis, apiKey, stage1Model, withNextStarts(snapshot, sentences), { mediaSrc: targetUrl, duration });
                } else if (inParts) {
                    ends = await detectSpeechEndsInParts(fileForAnalysis, apiKey, stage1Model, withNextStarts(snapshot, sentences), { duration });
                } else {
                    ends = await detectSpeechEnds(fileForAnalysis, apiKey, stage1Model, sentences);
                }
            }

            // 자동 실행에서 답이 하나도 없으면(연결 실패 등) '판단 불가'로 표시하지 않고 그대로 둔다 — 배지가 남아 다시 할 수 있다
            if (silent && ends.size === 0) {
                console.warn('[SpeechEnd] 자동 감지 응답 없음', { fileId, 요청수: sentences.length });
                return false;
            }

            // 최신 상태에 병합. 채택 조건(환각 방어): 시작+MIN_SPEECH_SEC 이후, MAX_SENTENCE_SEC 이내, 영상 길이 이내.
            // 스냅샷과 seconds가 다른 문장(감지 중 재전사/삭제됨)은 건너뛴다.
            // [필수 가드] 이번에 '요청한' 인덱스만 병합한다.
            // onlyMissing이면 희소 인덱스([3],[17],[42]…)를 보내는데, 모델이 규칙 5의 '순서대로 출력'을
            // 0,1,2…로 재번호매김하면 ends의 키가 요청과 무관해진다. 그대로 적용하면 이미 정상 감지된
            // 앞쪽 문장들의 speechEnd가 엉뚱한 값으로 덮어쓰이고 캐시·클라우드에 영속된다.
            // [시도했다가 폐기한 접근 — 다시 하지 말 것] 오디오 음량(RMS) 곡선으로 모델 답을
            // 교차검증해 보았으나 실측에서 해로웠다. 이 콘텐츠는 대사가 없는 구간에도 배경음악이
            // 대사와 비슷한 크기로 계속 깔려서, 음량만으로는 말소리와 음악을 구분할 수 없다.
            // 결과: 한 음절 감탄사("À." 0.3초)를 뒤따르는 음악 3.6초까지 대사로 오인해 연장했고,
            // 건너뛰는 구간이 27곳 → 6곳으로 급감했다. 조건을 좁혀도(모델 지속 1초 이하만 연장)
            // 27 → 18로 3분의 1이 사라졌다. 음성/음악 판별(스펙트럼·변조 분석) 없이는 불가능하다.

            // 실패한 조각의 문장은 요청하지 않은 것으로 친다 — 넣으면 '판단 불가'로 굳어 다시 감지 대상에서 빠진다.
            // 미감지로 남으면 안내의 '빠진 N개 재시도'·!N 배지로 다시 할 수 있다.
            const failedIdx = ends.failedIndices;
            const requested = new Set(sentences.filter(s => !failedIdx?.has(s.index)).map(s => s.index));
            let applied = 0; let latestData = null;
            let secondsMismatch = 0; // 진단용 관측값
            // [경합 제거] 병합을 업데이터 밖에서 동기적으로 끝낸다. 예전엔 업데이터 안에서
            // applied/latestData를 채우고 setTimeout(0)으로 기다렸는데, 업데이터가 그보다
            // 늦게 실행되면 '응답은 왔는데 0건'으로 오판해 오류 토스트를 띄우고 저장을 건너뛰었다.
            // (그 뒤 업데이터가 실행돼 화면만 켜지므로 "오류가 떴는데 켜지고 다시 열면 사라짐"이 됐다)
            const baseEntry = (filesRef?.current || []).find(p => p.id === fileId);
            const seenIds = (filesRef?.current || []).map(x => x.id);
            if (baseEntry) {
                // 병합 규칙(요청한 인덱스만 · 시각 일치 검사 · 채택 기준 · 포기 표시)은 utils/speechEndMerge
                // 감지는 수십 초가 걸려 그동안 문장이 지워지거나 고쳐질 수 있다 → 번호 대신 시각·글자로 자리를 찾는다.
                // 예전엔 자동 감지만 이렇게 하고, 직접 누른 전체 감지는 번호로 맞춰서 문장 하나만 지워도
                // 그 뒤 문장의 결과가 전부 버려졌다(2026-11-19 재현: 4문장 중 1개만 반영).
                const a = alignSpeechEnds(baseEntry.data, snapshot, requested, ends);
                const r = mergeSpeechEnds(baseEntry.data, baseEntry.data, a.requested, a.ends, duration);
                applied = r.applied;
                secondsMismatch = r.secondsMismatch;
                // 동기 사본(graft ref)에도 기록 — 진행 중인 Stage 2가 스냅샷으로 덮어써도 이식돼 살아남는다
                for (const [sec, se] of r.grafts) speechEndGraftRef.current.set(`${targetFile.name}_${targetFile.size}|${sec}`, se);
                const merged = r.merged;
                latestData = merged;
                // 계산이 끝난 결과만 반영한다. 사본(filesRef)도 같이 바꿔, 바로 뒤에 끝나는 분석 묶음이 옛 대본에 결과를 넣지 않게 한다
                commitData(fileId, merged);
            }

            // 모델이 요청한 문장에 답은 했는데 값이 전부 기준 밖(대개 시작 시각을 되풀이 = 끝을 못 찾음)이면 오류가 아니라
            // '판단 불가' 결과다 — 저장하고 아래 안내(그 문장 보기·직접 맞추기)로 보낸다. 예전엔 오류 토스트 + 저장 안 함이라
            // "잠시 후 다시 시도"를 해도 같은 답이 오고, 다시 열면 !N 배지가 되살아났다.
            const answeredButUnresolved = [...requested].some(i => ends.has(i));
            if (!latestData || (applied === 0 && !answeredButUnresolved)) {
                // 실패 원인을 남긴다 — '응답은 왔는데 한 건도 반영 안 됨'은 원인이 여러 갈래라
                // (대상 파일 소실 / 문장 시각 어긋남 / 값 전부 탈락) 로그 없이는 사후 추적이 불가능하다.
                console.warn('[SpeechEnd] 병합 0건 · ' + JSON.stringify({
                    대상파일찾음: !!latestData, fileId, 현재파일ids: seenIds,
                    모델응답수: ends.size, 요청수: requested.size,
                    스냅샷문장수: snapshot.length, 시각불일치: secondsMismatch,
                }));
                toast({ message: '대사 구간을 감지하지 못했어요. 잠시 후 다시 시도해 주세요.', type: 'error' });
                return false;
            }
            const status = saveStatusOf(latestData);
            // [중요] 저장 결과를 반드시 검사한다. 예전엔 반환값을 버리고 곧바로 '감지 완료' 성공
            // 토스트를 띄웠는데, 토스트는 슬롯이 하나라 persistCache가 띄운 실패 경고를 덮어썼다.
            // 게다가 용량 경고는 세션당 1회(quotaWarnedRef)라 두 번째부터는 완전 무음 →
            // 사용자는 '완료'만 보고 대본을 옮겼다가, 돌아와서 감지 결과가 사라진 걸 발견하게 된다.
            // (로컬 캐시가 유일한 영속 경로다. 여기 실패 = 다음 방문에 확실히 유실)
            const saved = persistCache(targetFile, latestData, status);
            if (refreshCacheKeys) refreshCacheKeys();
            // 클라우드 저장은 CLOUD_ENABLED=false로 꺼져 있어 조용히 early-return 한다.
            // (예전엔 여기 실패 시 빨간 토스트를 띄웠는데, 로컬 저장이 이미 끝난 뒤라 문구가
            //  사실과 반대였고 '감지 완료' 성공 토스트와 동시에 떴다 → 제거. 다른 5개 클라우드
            //  호출부와 동일하게 console.warn만 남긴다.)
            cloudSaveMeta(targetFile, latestData, status, null, duration)
                .catch(e => console.warn('[SpeechEnd] 클라우드 반영 실패:', e));

            if (!saved || !saved.ok) {
                if (showToast) showToast({
                    message: saved && saved.reason === 'quota'
                        ? '⚠️ 저장 공간이 꽉 차 감지 결과를 저장하지 못했어요. 목록(휴지통·저장 기록)에서 오래된 대본을 지운 뒤 다시 시도해 주세요. — 지금 화면에서는 동작하지만, 다른 대본에 갔다 오면 사라집니다.'
                        : `⚠️ 감지 결과를 저장하지 못했어요 (${(saved && saved.message) || '알 수 없는 오류'}). 다른 대본에 갔다 오면 사라집니다.`,
                    type: 'error',
                    duration: 12000,
                });
                return true; // 감지 자체는 성공(화면엔 반영됨) — 재시도 루프를 유발하지 않는다
            }
            // 미감지 문장이 남았으면 '그 문장들만' 재감지하는 액션 제공 (기감지분은 안 건드림)
            const remaining = latestData.filter(d => validSpeechEnd(d) === null && !d.speechEndSkipped).length;
            // 판단 불가(끝을 못 찾아 비어 있는) 문장 — 예전엔 안내에 안 보여 '전체 N문장 완료'로만 떴다
            const unresolved = unresolvedSpeechEnds(latestData, duration);
            const unresolvedNote = unresolved.length > 0 ? ` · ${unresolved.length}개는 대사 끝을 못 찾아 그 뒤를 안 건너뜁니다` : '';
            if (showToast && !silent) {
                if (selective) {
                    // 선택 재감지: 고른 문장만 다시 잰 것 — 전체 개수/미감지 배지 문구를 쓰지 않는다.
                    // 판단 불가(SKIP)로 안 바뀐 문장은 '기존값 유지'임을 솔직히 알린다(확인창의 '교체' 약속 보정).
                    const kept = sentences.length - applied;
                    showToast({
                        message: kept > 0
                            ? `선택 ${sentences.length}개 중 ${applied}개 반영 · ${kept}개는 판단 불가로 기존값 유지`
                            : `선택한 ${sentences.length}개 문장의 대사 끝을 다시 감지했어요.`,
                        type: 'success', duration: 10000,
                    });
                } else if (remaining > 0) {
                    showToast({
                        message: `대사 구간 감지 완료 (${applied}/${sentences.length}문장 · 미감지 ${remaining}개)${unresolvedNote}`,
                        type: 'success',
                        duration: 8000,
                        action: { label: `빠진 ${remaining}개 재시도`, onClick: () => detectSpeechEndsForFile(fileId, { onlyMissing: true }) },
                    });
                } else if (unresolved.length > 0) {
                    showToast({
                        message: `대사 구간 감지 완료 (${latestData.length}문장 중 ${latestData.length - unresolved.length}개)${unresolvedNote}`,
                        type: 'success',
                        duration: 15000, // 읽고 버튼을 누를 시간(10초는 실측에서 누르기 전에 닫혔다)
                        ...(onRevealSentence ? { action: { label: '그 문장 보기', onClick: () => onRevealSentence(fileId, unresolved[0], latestData[unresolved[0]]) } } : {}),
                    });
                } else {
                    showToast({
                        message: `대사 구간 감지 완료 (전체 ${latestData.length}문장)`,
                        type: 'success',
                    });
                }
            }
            return true;
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('[SpeechEnd] 감지 실패:', e);
                toast({ message: `대사 구간 감지 실패: ${e.message || e}`, type: 'error' });
            }
            return false;
        } finally {
            speechBusyRef.current = false;
            setSpeechDetectBusy(null);
            flushFreshSpeechEnds(); // 감지하는 동안 또 고친 문장이 있으면 이어서
            // 자동 찾기를 기다리던 대본이 있으면 이어서(감지는 한 번에 하나)
            for (const [k, info] of autoSpeechQueueRef.current) {
                if (speechBusyRef.current) break;
                autoSpeechQueueRef.current.delete(k);
                autoSpeechEnds(info);
            }
        }
    };

    /**
     * [대사 끝 자동 찾기] 설정이 켜져 있고, 그 대본의 분석이 끝났고, 대사 끝을 한 번도 찾은 적 없으면 찾는다.
     * 예전엔 '처음 전사한 그 실행의 분석이 끊기지 않고 끝났을 때' 한 곳에서만 걸었다. 다시 시도·홈 → 다시 열기·편집으로
     * 분석이 끊기면 아무 표시 없이 영영 안 찾아 '대사만' 칩이 회색으로 남았다
     * (휴대폰 실측 2026-11-22: 분석 도중 홈 → 목록에서 다시 열기 → 169/169 분석 완료, 감지 요청 0).
     * 부르는 곳: runStage2 래퍼(분석이 끝날 때, 경로 무관), loadCache·loadCloud(분석이 이미 끝난 대본을 열 때).
     *  - 대본은 파일 신원(이름_크기)으로 찾는다 — 다시 열면 화면 항목 번호가 바뀐다. fileId가 화면에 있으면 그것.
     *  - data: 방금 쓴 대본(filesRef는 다음 그리기 뒤에야 바뀐다). 주면 그것으로 판단한다.
     *  - 대사 끝 값이나 '판단 불가' 표시가 하나라도 있으면 이미 찾은 대본이다(빠진 문장은 '빠진 대사'로 사용자가 고른다).
     *  - 이번 실행에서 한 번 건 파일은 다시 안 건다(실패해도 비용이 되풀이되지 않게). 화면에 없으면 걸지 않고 다음에 열 때 건다.
     */
    const autoSpeechEnds = (fileInfo, { fileId = null, data = null } = {}) => {
        if (!speechAutoRef.current || !fileInfo?.name || !apiKey) return;
        if (isOffline()) return; // 인터넷이 없으면 조용히 넘긴다 — 다음에 열거나 분석이 끝날 때 다시
        const key = `${fileInfo.name}_${fileInfo.size}`;
        if (autoSpeechTriedRef.current.has(key)) return;
        const list = filesRef?.current || [];
        const entry = (fileId && list.find(p => p.id === fileId))
            || list.find(p => p.file?.name === fileInfo.name && p.file?.size === fileInfo.size);
        if (!entry) return;                                // 화면에 없다 — 다음에 열 때 다시
        // 부르는 쪽이 방금 쓴 대본(data)을 주면 그걸 믿는다(화면 사본은 한 박자 늦어 '전사 중'·오류가 남아 있을 수 있다)
        if (!data && (entry.isAnalyzing || entry.error)) return;
        if (stage2ActiveRef?.current?.get(entry.id)) return; // 그 대본 분석이 아직 돈다 — 끝나면 다시 불린다
        const snap = data || entry.data;
        if (!Array.isArray(snap) || snap.length === 0) return;
        if (snap.some(d => typeof d.speechEnd === 'number' || d.speechEndSkipped)) return; // 이미 한 번 찾았다
        if (speechBusyRef.current) { autoSpeechQueueRef.current.set(key, fileInfo); return; }
        autoSpeechTriedRef.current.add(key);
        autoSpeechQueueRef.current.delete(key);
        console.log(`[SpeechEnd] 자동 찾기 시작: ${fileInfo.name}`);
        // 자동 실행은 안내를 띄우지 않는다(결과는 칩·카드 배지로 보인다. 다른 대본을 보는 중에 오류 안내가 뜨지 않게).
        // 값을 못 얻고 끝나면(연결 실패, 대본을 닫음 등) '시도함'을 지워 다음에 열 때 다시 건다
        detectSpeechEndsForFile(entry.id, { ...(data ? { baseData: data } : {}), silent: true })
            .then((ok) => { if (!ok) autoSpeechTriedRef.current.delete(key); })
            .catch(() => autoSpeechTriedRef.current.delete(key));
    };

    // 기다리는 새 문장의 대사 끝을 찾는다. 감지는 한 번에 하나라, 도는 중이면 끝날 때 다시 불린다.
    const flushFreshSpeechEnds = () => {
        const pending = pendingSpeechEndRef.current;
        for (const [fileId, job] of pending) {
            if (speechBusyRef.current) return;
            pending.delete(fileId);
            const indices = [];
            job.data.forEach((d, i) => { if (job.seconds.has(d.seconds) && typeof d.speechEnd !== 'number') indices.push(i); });
            if (indices.length > 0) detectSpeechEndsForFile(fileId, { indices, baseData: job.data, silent: true });
        }
    };

    /**
     * [다시 전사 뒤 대사 끝 자동 감지] 다시 전사·복구는 문장을 새 객체로 바꿔 대사 끝이 비고, 그러면 '대사만'이 그 뒤를
     * 못 건너뛴다(휴대폰 실측 2026-11-19: 04:53.00 → 없음). 새 문장만 짧은 구간을 들려 다시 찾는다.
     * before: 고치기 전 대본 / after: sanitizeData를 거친 고친 뒤 대본 / fresh: 새로 받은 문장.
     * runStage2보다 먼저 불러야 한다 — 같은 시각의 옛 감지값이 분석 저장 때 새 문장에 다시 붙지 않게 지운다.
     */
    const queueFreshSpeechEnds = (fileId, targetFile, before, after, fresh, duration) => {
        const idxs = freshSpeechEndTargets(before, after, sanitizeData(fresh, duration));
        if (idxs.length === 0) return;
        const pending = pendingSpeechEndRef.current;
        const job = pending.get(fileId) || { seconds: new Set(), data: after };
        job.data = after;
        for (const i of idxs) {
            job.seconds.add(after[i].seconds);
            speechEndGraftRef.current.delete(`${targetFile.name}_${targetFile.size}|${after[i].seconds}`);
        }
        pending.set(fileId, job);
        flushFreshSpeechEnds();
    };

    /**
     * [빈칸 구간 복구]
     * 실수로 문장을 지워 빈칸이 생긴 경우, 선택한 '앵커' 문장 1개는 그대로 두고
     * 그 옆 빈칸 구간만 다시 들어(raw 모드) 삭제됐던 문장을 복구한다.
     *  - direction 'both'(기본): 앞 이웃 ~ 뒤 이웃 전체를 한 번에 확인(어느 쪽이 지워졌든 복구)
     *  - direction 'forward' : 앵커 ~ 다음 살아있는 문장 사이(뒤 빈칸)
     *  - direction 'backward': 이전 살아있는 문장 ~ 앵커 사이(앞 빈칸, 맨 앞 포함)
     * 앵커/이웃 문장은 유지(분석 보존)하고, 복구된 문장만 실측 시각으로 삽입 → 자동 재분석(Stage 3).
     */
    const recoverGap = (fileId, anchorIndex, direction = 'both') => runRetranscribeJob(fileId, {
        label: 'Recover',
        failPrefix: '구간 복구 실패',
        // 여기서 조용히 return 하면 '복구 버튼이 먹통'이 된다
        missingToast: '대상 대본을 찾지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
        picked: [anchorIndex],
        // at = 앵커의 지금 번호(차례를 기다리는 사이 밀렸으면 다시 찾은 값)
        prepare: (currentData, [at]) => {
            if (at === null || at === undefined || at < 0 || at >= currentData.length) return null;
            return { anchorSec: currentData[at].seconds, at };
        },
        // 로딩 표시: 앵커와 같은 시각(블록) 문장에 스피너
        isTarget: (d, i, { anchorSec }) => d.seconds === anchorSec,
    }, async ({ targetFile, targetUrl, currentData, fileForAnalysis, duration, signal, fail, live, land, prep: { anchorSec, at } }) => {
        // 앵커 블록(동일 시각) 경계
        let lo = at; while (lo > 0 && currentData[lo - 1].seconds === anchorSec) lo--;
        let hi = at; while (hi < currentData.length - 1 && currentData[hi + 1].seconds === anchorSec) hi++;
        const sBlockText = currentData.slice(lo, hi + 1).map(d => d.text || '').join(' ');

        // 앞/뒤 이웃(살아있는 문장) 탐색
        let prevIdx = -1;
        for (let j = lo - 1; j >= 0; j--) { if (currentData[j].seconds < anchorSec) { prevIdx = j; break; } }
        let nextIdx = -1;
        for (let j = hi + 1; j < currentData.length; j++) { if (currentData[j].seconds > anchorSec) { nextIdx = j; break; } }
        const pSec = prevIdx >= 0 ? currentData[prevIdx].seconds : 0;
        const pText = prevIdx >= 0 ? (currentData[prevIdx].text || '') : '';
        const nSec = nextIdx >= 0 ? currentData[nextIdx].seconds : (duration > anchorSec ? duration : anchorSec + 8);
        const nText = nextIdx >= 0 ? (currentData[nextIdx].text || '') : '';

        // 방향별 구간(빈칸) 및 유지 경계 문장 계산.
        //  - 'both'(기본): 앞 이웃 ~ 뒤 이웃 전체를 한 번에(앵커는 가운데서 유지)
        //  - 'backward': 앞 이웃 ~ 앵커  /  'forward': 앵커 ~ 뒤 이웃
        //  dropSimilarTo: 유지되는 경계 문장(앞/앵커/뒤)과 겹치는 재전사본 제거 → 중복 방지
        let winStart, winEnd, prevText, nextText, dropList;
        if (direction === 'backward') {
            winStart = pSec; winEnd = anchorSec;
            prevText = pText; nextText = sBlockText;
            dropList = [pText, sBlockText];
        } else if (direction === 'forward') {
            winStart = anchorSec; winEnd = nSec;
            prevText = sBlockText; nextText = nText;
            dropList = [sBlockText, nText];
        } else {
            winStart = pSec; winEnd = nSec;
            prevText = pText; nextText = nText;
            dropList = [pText, sBlockText, nText];
        }

        if (winEnd - winStart < 0.5) {
            fail();
            if (showToast) showToast({ message: '복구할 구간이 없습니다.', type: 'error' });
            return;
        }

        // 긴 빈칸을 한 번에 재전사하면 Gemini가 문장을 덜 쪼개거나(언더세그멘테이션)
        // 실시간 캡처가 중간에 끊겨 일부만 잡힌다 → 구간을 서브창으로 분할해 순차 재전사 후 합침.
        // 짧은 구간(임계값 이하)은 지금처럼 한 번에 처리한다.
        const dropSimilarTo = dropList.filter(Boolean);

        // 프롬프트 문맥용 앞뒤 2문장 (경계 파편 차단) — 빈칸 양쪽의 살아있는 이웃 기준
        const grabTexts = (from, to) => collectTexts(currentData, from, to);
        const anchorTexts = grabTexts(lo, hi);
        let contextBefore, contextAfter;
        if (direction === 'backward') {
            contextBefore = prevIdx >= 0 ? grabTexts(prevIdx - 1, prevIdx) : [];
            contextAfter = anchorTexts;
        } else if (direction === 'forward') {
            contextBefore = anchorTexts;
            contextAfter = nextIdx >= 0 ? grabTexts(nextIdx, nextIdx + 1) : [];
        } else {
            contextBefore = prevIdx >= 0 ? grabTexts(prevIdx - 1, prevIdx) : [];
            contextAfter = nextIdx >= 0 ? grabTexts(nextIdx, nextIdx + 1) : [];
        }
        // 근접 가드용: 빈칸 양쪽 살아있는 이웃 문장의 시작 시각 (파편 시각 제거)
        const boundaryTimes = [
            prevIdx >= 0 ? pSec : null,
            nextIdx >= 0 ? nSec : null,
        ].filter(v => v != null);

        const SUB_LEN = 22;          // 서브창 길이(초) — 무음 스냅이 경계를 방어하므로 크게(호출↓·토큰↓)
        const SUB_OVERLAP = 2.5;     // 오버랩(초) — 무음 스냅 덕에 축소 가능(중복 전송↓)
        const SPLIT_THRESHOLD = 25;  // 이 길이 넘으면 분할
        const windows = [];
        if (winEnd - winStart > SPLIT_THRESHOLD) {
            const step = SUB_LEN - SUB_OVERLAP;
            for (let s = winStart; s < winEnd - 0.5; s += step) {
                const e = Math.min(s + SUB_LEN, winEnd);
                windows.push({ start: s, end: e, prevText, nextText, recover: true, dropSimilarTo, contextBefore, contextAfter, boundaryTimes });
                if (e >= winEnd) break;
            }
        } else {
            windows.push({ start: winStart, end: winEnd, prevText, nextText, recover: true, dropSimilarTo, contextBefore, contextAfter, boundaryTimes });
        }

        const perWindow = await retranscribeSegments(fileForAnalysis, apiKey, stage3Model, windows, {
            totalDuration: duration,
            temperature,
            topP,
            signal,
            antiRecitation,
            markerChar,
            markerInterval,
            mediaSrc: targetUrl,
            singleExtract: true, // 유니온 오디오 1회 추출 후 슬라이스 → 실시간 캡처 대기 제거
            concurrency: 3,      // 서브창 병렬 전사 → 순차 대비 대폭 단축
        });

        // 서브창 결과를 모두 합치고 오버랩 중복 제거 → 빈칸 전체를 원래 밀도로 복구
        const merged = perWindow.flatMap(r => r?.sentences || []);
        const fresh = deduplicateOverlap(merged);
        if (!fresh || fresh.length === 0) {
            fail();
            const firstErr = perWindow.find(r => r?.error)?.error;
            if (showToast) showToast({
                message: `복구할 내용이 없습니다 (${firstErr || '전사된 내용 없음'}).`,
                type: 'error'
            });
            return;
        }

        // 기존 문장은 그대로 유지하고, 복구된(실측 시각) 문장만 삽입 → 정렬. '지금 대본'에 넣는다(그사이 한 편집 유지)
        const before = live();
        const cleanData = land([...before, ...fresh]);

        persistCache(targetFile, cleanData, saveStatusOf(cleanData));
        if (refreshCacheKeys) refreshCacheKeys();

        if (showToast) showToast({ message: `${fresh.length}개 문장 복구 완료. 분석 진행 중...`, type: 'success' });
        queueFreshSpeechEnds(fileId, targetFile, before, cleanData, fresh, duration);
        // 새로 들어온(미분석) 문장만 분석 (복구 흐름 — 받아쓰기는 3단계, 분석은 2단계 모델)
        runStage2(fileId, targetFile, cleanData, apiKey, stage2Model); // 신원=targetFile (이 위의 persistCache와 동일 키)
    });

    /**
     * [구간 선택 삭제]
     * 선택한 문장(카드)들을 대본에서 제거한다. 중복·불필요 문장 정리용.
     * 로컬 캐시 + 클라우드에 반영해 다른 기기에서도 사라지게 한다.
     */
    const deleteSentences = async (fileId, indices) => {
        if (!indices || indices.length === 0) return;
        const idxSet = new Set(indices);
        // 경합 제거 — 최신 사본(filesRef)에서 동기적으로 계산(reanalyzeSentences 주석 참조)
        const base = (filesRef?.current || []).find(p => p.id === fileId);
        const targetFile = base?.file || null;
        const prevData = base?.data || null; // 실행취소용 삭제 전 스냅샷
        if (!targetFile || !Array.isArray(prevData)) return;
        const deletedItems = prevData.filter((_, i) => idxSet.has(i));
        const newData = prevData.filter((_, i) => !idxSet.has(i));

        // 분석이 도는 중이면 먼저 멈춘다 — 분석은 시작 때 사본을 들고 있다가 묶음마다 통째로 덮어써서,
        // 안 멈추면 지운 문장이 다음 묶음이 끝날 때 되살아나 저장까지 된다. 남은 미분석 문장은 아래에서 이어서 분석.
        const wasAnalyzing = !!stage2ActiveRef?.current?.get(fileId);
        if (wasAnalyzing && stage2AbortRef.current) stage2AbortRef.current.abort();
        commitData(fileId, newData);

        // 휴지통에 보관 (10초 실행취소가 지나도 나중에 복구 가능)
        if (targetFile.name) {
            // 같은 시각으로 묶인 문장은 묶음 안 순서를 같이 적어 둔다 → 되살릴 때 제자리(trashUtils#withTieHints)
            addToTrash(targetFile.name, targetFile.size, withTieHints(prevData, deletedItems, getTrash(targetFile.name, targetFile.size)));
            if (onTrashChange) onTrashChange();
        }
        persistEdit(targetFile, newData);

        if (showToast) showToast({
            message: `${idxSet.size}개 문장 삭제됨`,
            type: 'success',
            action: { label: '실행취소', onClick: makeEditUndo(fileId, targetFile, { removed: deletedItems, before: prevData }, deletedItems, '삭제를 취소했습니다.') },
            duration: 10000, // 되돌릴 시간 여유
        });
        if (wasAnalyzing && apiKey && newData.some(d => !d.isAnalyzed && !d.analysisFailed)) {
            runStage2(fileId, targetFile, newData, apiKey, stage2Model);
        }
    };

    /**
     * [휴지통 복구] 휴지통의 문장들을 대본에 다시 넣는다.
     * 타임스탬프 기준 정렬이라 원래 위치로 복원된다. 이미 있는(중복) 문장은 건너뛴다.
     */
    const restoreSentences = async (fileId, items) => {
        if (!items || items.length === 0) return;
        // 경합 제거 — retryAnalysis 주석 참조
        const resBase = (filesRef?.current || []).find(p => p.id === fileId);
        const targetFile = resBase?.file || null;
        const curData = resBase?.data || null;
        await new Promise(r => setTimeout(r, 0));
        if (!targetFile || !Array.isArray(curData)) { console.warn('[Restore] 대상 파일/데이터 없음', { fileId }); return; }

        const existing = new Set(curData.map(sentenceKey));
        const toAdd = items.filter(it => !existing.has(sentenceKey(it)));
        const merged = mergeRestored(curData, toAdd); // 같은 시각 묶음은 지울 때 적어 둔 순서 자리에, 나머지는 뒤에(아래 정렬이 제자리로)
        const clean = syncBusyFlags(sanitizeData(merged, 0), busyKeysOf(fileId)); // 시각 기준 재정렬 → 원위치 복원
        commitData(fileId, clean);

        const status = saveStatusOf(clean);
        persistCache(targetFile, clean, status);
        if (refreshCacheKeys) refreshCacheKeys();
        cloudSaveMeta(targetFile, clean, status, null, 0).catch(e => console.warn('[Cloud] 복구 반영 실패:', e));

        if (targetFile.name) {
            removeFromTrash(targetFile.name, targetFile.size, items);
            if (onTrashChange) onTrashChange();
        }
        if (showToast) showToast({ message: `${toAdd.length}개 문장 복구됨`, type: 'success' });
        // 분석 없이 보관된 문장(나누기로 잘라낸 조각 등)은 복구 즉시 분석한다 — 안 하면 스피너만 돈다
        if (apiKey && toAdd.some(it => !it.isAnalyzed)) runStage2(fileId, targetFile, clean, apiKey, stage2Model);
    };

    // 편집(나누기·구간 재전사) 결과를 화면·캐시·클라우드에 반영
    const persistEdit = (targetFile, data) => {
        const status = saveStatusOf(data);
        persistCache(targetFile, data, status);
        if (refreshCacheKeys) refreshCacheKeys();
        cloudSaveMeta(targetFile, data, status, null, 0).catch(e => console.warn('[Cloud] 반영 실패:', e));
    };

    // 편집 실행취소: 그 편집만 되돌린다(utils/liveMerge). change = { removed, added, before } 또는 { ends }(대사 끝 맞추기).
    // 예전엔 편집 전 대본 사본으로 통째로 되돌려서, 편집과 실행취소 사이에 끝난 다시 전사 결과가 같이 사라지고
    // 사본에 찍혀 있던 '다시 전사 중' 표시가 되살아나 그 카드를 못 누르게 됐다.
    // (재분석은 먼저 멈춘다 — 안 멈추면 끝난 배치가 되돌린 대본을 자기 스냅샷으로 다시 덮어쓴다)
    const makeEditUndo = (fileId, targetFile, change, trashed, message) => () => {
        const live = liveEntry(fileId)?.data;
        if (!Array.isArray(live)) {
            if (showToast) showToast({ message: '대본이 닫혀 있어 되돌리지 못했어요.', type: 'error' });
            return;
        }
        if (stage2AbortRef.current) stage2AbortRef.current.abort();
        const data = change.ends ? restoreSpeechEnds(live, change.ends) : revertEdit(live, change);
        // 되돌려 없어진 문장의 대사 끝은 찾지 않는다(기다리던 자동 감지에서 뺀다)
        const pend = pendingSpeechEndRef.current.get(fileId);
        if (pend) for (const a of change.added || []) pend.seconds.delete(a.seconds);
        commitData(fileId, data);
        persistEdit(targetFile, data);
        if (targetFile.name && trashed.length) {
            removeFromTrash(targetFile.name, targetFile.size, trashed);
            if (onTrashChange) onTrashChange();
        }
        if (showToast) showToast({ message, type: 'success' });
        // 멈춘 재분석에 다른 문장(편집과 무관한 미분석분)이 있었으면 이어서
        if (apiKey && data.some(d => !d.isAnalyzed && !d.analysisFailed)) runStage2(fileId, targetFile, data, apiKey, stage2Model);
    };

    /**
     * [문장 나누기] 한 문장을 단어 사이에서 나눠 앞/뒤를 지우거나 두 문장으로 만든다(utils/sentenceEdit).
     * 남은 문장은 다시 분석하고, 지운 조각은 휴지통에 보관한다. 10초 실행취소는 원래 문장·분석을 그대로 되돌린다.
     */
    const splitSentence = (fileId, idx, { wordIndex, mode, splitSeconds }) => {
        const base = (filesRef?.current || []).find(p => p.id === fileId);
        const targetFile = base?.file || null;
        const prevData = base?.data || null;
        if (!targetFile || !Array.isArray(prevData) || !prevData[idx]) return;

        let result;
        try {
            result = applySplit(prevData, idx, { wordIndex, mode, splitSeconds });
        } catch (e) {
            if (showToast) showToast({ message: e.message, type: 'error' });
            return;
        }
        // 끝이 잘려 대사 끝 시각을 비운 문장에 옛 감지값이 다시 붙지 않게(runStage2의 이식) 동기 사본에서도 뺀다
        const graft = speechEndGraftRef.current;
        if (targetFile.name) {
            for (const i of result.changed) {
                const d = result.data[i];
                if (typeof d.speechEnd !== 'number') graft.delete(`${targetFile.name}_${targetFile.size}|${d.seconds}`);
            }
        }
        const clean = syncBusyFlags(sanitizeData(result.data, 0), busyKeysOf(fileId));
        if (stage2AbortRef.current) stage2AbortRef.current.abort();
        commitData(fileId, clean);
        // 자른 조각(정리된 대본 기준 — 시각이 소수 둘째 자리로 맞춰진다)
        const pieceKeys = new Set(sanitizeData(result.changed.map(i => result.data[i]), 0).map(lineKey));
        const pieces = clean.filter(d => pieceKeys.has(lineKey(d)));
        if (targetFile.name && result.trashed.length) {
            addToTrash(targetFile.name, targetFile.size, result.trashed);
            if (onTrashChange) onTrashChange();
        }
        persistEdit(targetFile, clean);

        const label = mode === 'dropHead' ? '앞부분을 지웠어요' : mode === 'dropTail' ? '뒷부분을 지웠어요' : '두 문장으로 나눴어요';
        if (showToast) showToast({
            message: `${label}. 다시 분석 중...`,
            type: 'success',
            action: { label: '실행취소', onClick: makeEditUndo(fileId, targetFile, { removed: [prevData[idx]], added: pieces, before: prevData }, result.trashed, '자르기를 취소했습니다.') },
            duration: 10000,
        });
        // 끝이 잘려 대사 끝이 빈 조각은 다시 찾는다. 예전엔 비운 채로 둬서 '대사만'이 그 뒤를 못 건너뛰었다(2026-11-19 재현).
        // 건너뛸 자리일 때만('대사 끝 없음' 배지가 붙는 문장과 같은 기준) — 바로 다음 문장이 이어지면 찾아도 쓸 데가 없다.
        const missing = speechEndMissingSet(clean, 0);
        const needEnd = clean.filter((d, i) => missing.has(i) && pieceKeys.has(lineKey(d)));
        if (needEnd.length > 0) queueFreshSpeechEnds(fileId, targetFile, prevData, clean, needEnd, 0);
        if (apiKey) runStage2(fileId, targetFile, clean, apiKey, stage2Model);
    };

    /**
     * [대사 끝 직접 맞추기] 고치기 줄 '대사 끝' → 끝 직접 맞추기. AI를 부르지 않고 사용자가 맞춘 끝 시각을 넣는다.
     * 같은 시각의 형제 문장 전부에 넣고 판단 불가 표시를 지운다(speechEndMerge#applyManualSpeechEnd). 10초 실행취소.
     */
    const setSpeechEndManual = (fileId, idx, se) => {
        const base = (filesRef?.current || []).find(p => p.id === fileId);
        const targetFile = base?.file || null;
        const prevData = base?.data || null;
        if (!targetFile || !Array.isArray(prevData) || !prevData[idx] || !Number.isFinite(se)) return;
        const { data: next, changed } = applyManualSpeechEnd(prevData, idx, se);
        // 분석이 도는 중이면 멈췄다가 이어서 돌린다 — 분석은 시작 때 사본으로 통째로 덮어쓰고, 이식(speechEndGraftRef)은
        // '끝 시각이 빈 문장'만 채우므로 옛 감지값이 있던 문장은 맞춘 값이 다음 묶음 때 옛 값으로 되돌아간다.
        const wasAnalyzing = !!stage2ActiveRef?.current?.get(fileId);
        if (wasAnalyzing && stage2AbortRef.current) stage2AbortRef.current.abort();
        commitData(fileId, next);
        persistEdit(targetFile, next);
        if (showToast) showToast({
            message: `대사 끝을 ${formatStamp(se)}로 맞췄어요.`,
            type: 'success',
            action: { label: '실행취소', onClick: makeEditUndo(fileId, targetFile, { ends: changed.map(i => prevData[i]) }, [], '대사 끝 맞추기를 취소했습니다.') },
            duration: 10000,
        });
        if (wasAnalyzing && apiKey && next.some(d => !d.isAnalyzed && !d.analysisFailed)) {
            runStage2(fileId, targetFile, next, apiKey, stage2Model);
        }
    };

    /**
     * [구간 재전사] 지정한 시각 구간 [start, end)를 한 번에 다시 듣고, 시작 시각이 그 안인 문장을 전부 새 결과로 바꾼다.
     * 구간 밖에서 시작해 걸친 문장은 그대로 두고, 새 결과에 딸려 온 그 문장 조각은 지운다(retranscribeSegments 복구 모드).
     * 바뀐 옛 문장은 휴지통에 보관, 새 문장은 자동 분석. 새 결과가 없으면 옛 문장을 그대로 둔다.
     */
    const retranscribeRange = (fileId, start, end) => runRetranscribeJob(fileId, {
        label: 'RangeRetranscribe',
        failPrefix: '구간 재전사 실패',
        prepare: (currentData) => (end > start ? { replacedIdx: new Set(indicesInRange(currentData, start, end)) } : null),
        isTarget: (d, i, { replacedIdx }) => replacedIdx.has(i),
    }, async ({ targetFile, targetUrl, currentData, fileForAnalysis, duration, signal, fail, live, land }) => {
        const { prev, next } = rangeNeighbors(currentData, start, end);
        const prevText = prev >= 0 ? (currentData[prev].text || '') : '';
        const nextText = next >= 0 ? (currentData[next].text || '') : '';
        const [perWindow] = await retranscribeSegments(fileForAnalysis, apiKey, stage3Model, [{
            start, end,
            recover: true, // 구간 안 문장을 유사도로 거르지 않고 전량 채택
            prevText, nextText,
            // 구간 앞에서 시작해 걸친 문장·바로 뒤 문장에서 새어 나온 조각은 버린다(구간 밖 문장은 건드리지 않음).
            // 기존 복구의 dropSimilarTo(단어 70% 겹침)는 진짜 새 문장까지 버려서 쓰지 않는다(실측).
            dropLeakedFrom: [prevText, nextText].filter(Boolean),
            contextBefore: prev >= 0 ? collectTexts(currentData, prev - 1, prev) : [],
            contextAfter: next >= 0 ? collectTexts(currentData, next, next + 1) : [],
        }], {
            totalDuration: duration, temperature, topP, signal, antiRecitation, markerChar, markerInterval,
            mediaSrc: targetUrl,
        });

        const fresh = perWindow?.sentences;
        if (!fresh || fresh.length === 0) {
            fail();
            if (showToast) showToast({ message: `구간 재전사 실패 — 원래 문장을 그대로 뒀어요. (${perWindow?.error || '결과 없음'})`, type: 'error', duration: 8000 });
            return;
        }

        // '지금 대본'의 그 구간을 바꾼다(전사하는 동안 구간 밖에서 한 편집 유지)
        const before = live();
        const { data: merged, removed } = replaceRange(before, start, end, fresh);
        const clean = land(merged);
        if (targetFile.name && removed.length) {
            addToTrash(targetFile.name, targetFile.size, removed);
            if (onTrashChange) onTrashChange();
        }
        persistEdit(targetFile, clean);
        if (showToast) showToast({
            message: `구간 재전사 완료: ${removed.length}개 → ${fresh.length}개 문장. 분석 진행 중...`,
            type: 'success',
            action: { label: '실행취소', onClick: makeEditUndo(fileId, targetFile, { removed, added: sanitizeData(fresh, duration), before }, removed, '구간 재전사를 취소했습니다.') },
            duration: 10000,
        });
        queueFreshSpeechEnds(fileId, targetFile, before, clean, fresh, duration);
        runStage2(fileId, targetFile, clean, apiKey, stage2Model);
    });

    // '끝까지 못 받음' 띠를 닫는다(화면 + 저장된 표시).
    const dismissIncomplete = (fileId) => {
        const entry = liveEntry(fileId);
        setFiles(prev => prev.map(p => (p.id === fileId ? { ...p, incomplete: null } : p)));
        if (!entry?.file) return;
        clearCacheIncomplete(entry.file);
        // 저장 실패로 보관 중인 내용에도 반영한다 — 안 하면 나중에 다시 저장될 때 표시가 되살아난다
        const stash = unsavedRef.current.get(`${entry.file.name}_${entry.file.size}`);
        if (stash) stash.extra = { ...(stash.extra || {}), incomplete: null };
    };

    // 저장에 실패했던 대본을 다시 저장한다. 띠의 [다시 저장]과, 다른 대본을 지워 공간이 생겼을 때(silent) 부른다.
    // 대본이 열려 있으면 지금 대본을, 닫혀 있으면 마지막으로 저장하려던 내용을 쓴다.
    const retryUnsaved = ({ silent = false } = {}) => {
        if (unsavedRef.current.size === 0) return;
        quotaWarnedRef.current = silent; // 직접 눌렀을 때만 실패 안내를 다시 띄운다
        let saved = 0;
        for (const [key, pending] of [...unsavedRef.current]) {
            const open = (filesRef?.current || []).find(p => p.file && `${p.file.name}_${p.file.size}` === key);
            const useLive = open && !open.isAnalyzing && Array.isArray(open.data) && open.data.length > 0;
            const data = useLive ? open.data : pending.data;
            const res = persistCache(pending.fileInfo, data, useLive ? saveStatusOf(data) : pending.status, pending.extra);
            if (res && res.ok) saved++;
        }
        if (saved > 0) {
            if (refreshCacheKeys) refreshCacheKeys();
            if (showToast) showToast({ message: saved > 1 ? `저장 안 됐던 대본 ${saved}개를 저장했어요.` : '저장 안 됐던 대본을 저장했어요.', type: 'success' });
        }
    };

    // 대본을 지웠으면 '저장 안 됨' 기록도 지운다 — 안 지우면 공간이 생겼을 때 지운 대본을 다시 저장해 되살린다.
    const forgetUnsaved = (fileKey) => markSaved(fileKey, true); // fileKey = `이름_크기`

    // 진행 중인 Stage1 전사를 사용자가 취소.
    // abort 후 해당 파일을 취소 상태로 전환 → 무한 스피너 대신 재시도 가능한 에러 카드 노출.
    // [시작 전·줄 서 있을 때] 아직 끊을 요청이 없다 → 횟수를 올려 두면 그 전사가 요청을 보내기 전에 스스로 멈춘다(runFullAnalysisInner).
    //   줄에서도 뺀다. 예전엔 '취소했습니다'만 보이고 전사는 그대로 나가 대본까지 저장됐다.
    // [다른 파일] 중단 채널은 하나라, 그 채널을 쥔 전사가 이 파일일 때만 끊는다 — 예전엔 줄 서 있는 파일에서 누르면
    //   돌고 있던 다른 파일의 전사가 끊기고, 정작 누른 파일은 나중에 전사됐다(2026-11-21 재현).
    const cancelStage1 = (fileId) => {
        stage1GenRef.current.set(fileId, (stage1GenRef.current.get(fileId) || 0) + 1);
        analysisQueueRef.current = analysisQueueRef.current.filter(x => x.id !== fileId);
        for (const [k, id] of stage1KeysRef.current) if (id === fileId) stage1KeysRef.current.delete(k);
        if (stage1OwnerRef.current === fileId && stage1AbortRef.current) stage1AbortRef.current.abort();
        setFiles(prev => prev.map(p => p.id === fileId
            ? { ...p, isAnalyzing: false, error: "전사를 취소했습니다. 다시 시도할 수 있습니다." }
            : p));
    };

    // 드래그앤드롭 핸들러
    const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = (e) => {
        if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
            setIsDragging(false);
        }
    };
    const onDrop = (e) => {
        e.preventDefault();
        processFiles(e.dataTransfer.files);
    };

    return { autoSpeechEnds, unsavedKeys, retryUnsaved, forgetUnsaved, dismissIncomplete, processFiles, runStage2, retryAnalysis, retranscribeSentences, retranscribeRange, splitSentence, setSpeechEndManual, reanalyzeSentences, recoverGap, deleteSentences, restoreSentences, cancelStage1, isDragging, onDragOver, onDragLeave, onDrop, stage2Progress, detectSpeechEndsForFile, speechDetectBusy };
};
