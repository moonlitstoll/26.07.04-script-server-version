import { useRef, useEffect, useLayoutEffect, useMemo, useState, memo } from 'react';
import {
    Play, Repeat, Clock, Loader2, Check, AlertTriangle, RotateCcw, Volume2, ChevronDown, ChevronUp, FastForward
} from 'lucide-react';
import ClozeDrill from './ClozeDrill';
import GlossText from './GlossText';
import { checkAnalysisCoverage, coverageTitle } from '../utils/analysisCoverage';
import { splitBreakdown, tidyGlosses } from '../utils/analysisParser';
import { buildCloze, marksForLines } from '../utils/clozeUtils';

// **굵게** 표시 → 초록 청크
// 베트남어는 굵기를 낮게 둔다(문장 medium, 초록 청크 semibold — 2026-11-17). bold·extrabold에서는 획이 두꺼워
// ể·ắ·ử처럼 표시가 겹친 글자의 틈이 메워져 휴대폰에서 성조가 안 보였다. 다시 굵게 올리지 말 것.
const renderBold = (s, keyPrefix) => s.split(/(\*\*.*?\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? <strong key={`${keyPrefix}-${i}`} className="text-emerald-800 dark:text-emerald-300 font-semibold">{part.slice(2, -2)}</strong>
        : part
);

// 분석 줄의 앞 청크를 그린다. 가리기에서는 가려졌던 단어만 살구색 글자(나머지는 초록 그대로).
const renderChunkLine = (main, keyPrefix, segments) => {
    const m = segments && main.match(/^(\s*)\*\*(.+?)\*\*/);
    if (!m) return renderBold(main, keyPrefix);
    return (
        <>
            {m[1]}
            <strong className="text-emerald-800 dark:text-emerald-300 font-semibold">
                {segments.map((s, i) => (
                    <span key={i} className={s.hidden ? 'text-[#a84f29] dark:text-[#f6c5a8]' : undefined}>{i > 0 ? ' ' : ''}{s.text}</span>
                ))}
            </strong>
            {renderBold(main.slice(m[0].length), keyPrefix)}
        </>
    );
};

// [안전망] 모델이 긴 문장을 안 쪼개고 통째로 1청크로 낸 경우, 분석에서 그 '문장 전체 반복 볼드'를
// 지워 카드 위 문장과 중복되지 않게 한다. (자동 재시도가 실패한 최후 케이스 대비)
// [폐지된 기능] 💡 재사용 문형 태그 제거 — 기존 분석에 남아있어도 표시에서 숨긴다.
//  ⚡실제 태그(〔⚡…〕)는 유지. 앞의 공백까지 함께 제거해 어색한 간격이 안 남게 한다.
const stripPatternTags = (s) => (s || '').replace(/\s*〔💡[^〕]*〕/g, '');

const _normWords = (t) => (t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const dedupeSentenceInAnalysis = (analysis, sentence) => {
    if (!analysis || !sentence) return analysis;
    const sw = _normWords(sentence);
    if (sw.length < 6) return analysis;
    return analysis.split('\n').map(line => {
        const m = line.match(/^\s*\*\*(.+?)\*\*\s*:?\s*/);
        if (!m) return line;
        const cw = new Set(_normWords(m[1]));
        const covered = cw.size ? sw.filter(w => cw.has(w)).length / sw.length : 0;
        return covered >= 0.8 ? line.slice(m[0].length) : line; // 문장 전체 반복 볼드 제거, 뜻/풀이만 남김
    }).join('\n');
};

// 휴대폰 탭 영역: 보이는 크기는 그대로 두고 투명한 가상요소로 위아래를 넓힌다(카드 높이가 안 늘게).
// 타임스탬프 16px + 위아래 12px = 40px, 배지 16px + 위아래 10px = 36px.
const HIT_TS = "relative before:content-[''] before:absolute before:-inset-x-1 before:-inset-y-3";
// div에 role=button을 줄 때 키보드(Enter·Space)도 탭처럼 — 화면 읽기 기능·키보드만 쓰는 사용자용
const onKeyActivate = (fn) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
};
const HIT_BADGE = "relative before:content-[''] before:absolute before:-inset-x-0.5 before:-inset-y-2.5";

const TranscriptItem = memo(({
    item, idx, isActive, isGlobalLooping, manualScrollNonce,
    seekTo, jumpToSentence,
    isLooping, showAnalysis, showBreakdown = false,
    selectMode = false, isSelected = false, onToggleSelect,
    onRetryAnalysis, onCoverageRetry, onRetranscribe,
    speechEndMissing = false, onSpeechEndFix,
    drillMode = false, difficulty = 'easy', drillRound = 0,
    inLoopGroup = false, groupLoopOn = false
}) => {
    const itemRef = useRef(null);

    // [정확도 검증 배지] 비용 0의 코드 검사 — 분석 커버리지(규칙 9/13 위반) + 전사의심(규칙 15).
    // item 객체가 바뀔 때만 재계산 (memo 카드라 재생 틱마다 돌지 않음).
    const coverage = useMemo(() => checkAnalysisCoverage(item), [item]);

    // 분석 줄 → [청크·뜻, 괄호 풀이, 꼬리]. 풀이가 한 줄도 없으면 탭·화살표 없음.
    const analysisLines = useMemo(() => {
        if (!item.analysis || typeof item.analysis !== 'string') return [];
        return stripPatternTags(dedupeSentenceInAnalysis(item.analysis, item.text)).replace(/\\n/g, '\n')
            .split('\n').filter(l => l.trim()).map(l => splitBreakdown(tidyGlosses(l, { hideAddedNote: true, fixArrows: true })));
    }, [item.analysis, item.text]);
    const hasBreakdown = analysisLines.some(([, b]) => b);

    // 가리기 문제. 문장 칸과 해설 칸이 같은 문제를 봐야 가려졌던 단어를 해설에서 짚을 수 있다.
    const drill = useMemo(
        () => (drillMode ? buildCloze(item, idx, drillRound, difficulty) : null),
        [drillMode, item, idx, drillRound, difficulty]
    );
    const hiddenMarks = useMemo(
        () => (drill ? marksForLines(analysisLines.map(([main]) => main), drill.chunkMarks) : []),
        [drill, analysisLines]
    );

    // 괄호 풀이 카드별 펼침: 눈 버튼(showBreakdown)이 전체 기본값, 분석 칸을 탭하면 이 카드만 반대로 뒤집는다.
    const [flipped, setFlipped] = useState(false);
    // 눈 버튼으로 전체를 바꾸면 카드별 예외는 초기화(모든 카드가 새 기본값을 따르게)
    const [prevShowBreakdown, setPrevShowBreakdown] = useState(showBreakdown);
    if (prevShowBreakdown !== showBreakdown) {
        setPrevShowBreakdown(showBreakdown);
        setFlipped(false);
    }
    const breakdownOpen = showBreakdown !== flipped;

    // 문장을 고르는 중에는 재생 문장을 따라 화면을 옮기지 않는다 — 고르려던 문장이 손 밑에서 달아난다(2026-11-19 점검, 화면 재현).
    // 직접 옮긴 것(◀▶·'그 문장 보기')만 따라간다. ref로 읽는 이유: deps에 넣으면 고르기를 켜고 끌 때마다 화면이 재생 문장으로 튄다.
    const selectModeRef = useRef(selectMode);
    useLayoutEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);

    // 1. Focus Lock: Conditional Anchoring
    const prevActiveRef = useRef(isActive);
    const prevNonceRef = useRef(manualScrollNonce);

    useEffect(() => {
        const becameActive = isActive && !prevActiveRef.current;
        const isManualJump = manualScrollNonce !== prevNonceRef.current;

        prevActiveRef.current = isActive;
        prevNonceRef.current = manualScrollNonce;

        const isAutoAdvancing = isActive && !isGlobalLooping;

        // manualScrollNonce는 '활성 문장'에만 내려오므로 저절로 넘어온 문장도 값이 바뀐 것으로 보인다 →
        // 고르는 중에는 방금(1.5초 안) 누른 이동인지까지 본다. nonce 값이 누른 시각이다.
        const recentJump = isManualJump && Date.now() - manualScrollNonce < 1500;
        const shouldScroll = isActive && (selectModeRef.current
            ? recentJump
            : (becameActive || isManualJump || isAutoAdvancing));

        if (shouldScroll && itemRef.current) {
            itemRef.current.scrollIntoView({
                behavior: 'auto',
                block: 'start'
            });
        }
    }, [isActive, manualScrollNonce, isGlobalLooping]);

    // 2. Resize Stabilization
    useLayoutEffect(() => {
        if (isActive && itemRef.current && !selectModeRef.current) {
            itemRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
    }, [showAnalysis, showBreakdown, flipped, isActive]);

    // 번역·분석 칸. 일반 화면은 문장 아래에 늘 두고, 가리기에서는 답을 연 뒤에 같은 것을 보여 준다
    // (2026-11-18 사용자 요청: 가리기에서도 문장 전체 해설이 일반 화면과 똑같이).
    // 가리기에서는 답을 연 카드에만 그려지므로 눈 꺼짐이어도 보인다. 번역은 눈이 켜져 있으면 문장 위 단서로
    // 이미 떠 있고, 눈 꺼짐에서 문장을 눌렀을 때만 여기 상자로 나온다(문장 위치가 밀리지 않게).
    const explanation = (
        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${drillMode || showAnalysis ? 'max-h-[2000px] opacity-100 mt-0.5 pt-1 border-t border-slate-100 dark:border-slate-700' : 'max-h-0 opacity-0 mt-0 pt-0'}`}>

            {/* Stage 2 실패 상태: 분석이 끝났는데도 실패로 남은 문장 → 다시 시도 */}
            {!item.isAnalyzed && item.analysisFailed ? (
                <div className="py-3 px-3 my-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 min-w-0">
                        <AlertTriangle size={15} className="shrink-0 text-amber-500 dark:text-amber-400" />
                        <span className="text-[13px] font-bold leading-tight">이 문장 분석에 실패했어요</span>
                    </div>
                    {onRetryAnalysis && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onRetryAnalysis(idx); }}
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 dark:bg-amber-500/25 dark:hover:bg-amber-500/40 dark:text-amber-100 dark:border dark:border-amber-600 transition-colors"
                        >
                            <RotateCcw size={13} /> 다시 시도
                        </button>
                    )}
                </div>
            ) : !item.isAnalyzed ? (
                /* Stage 2 Loading State */
                <div className="py-4 px-2 space-y-3 animate-pulse">
                    <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded-md w-3/4" />
                    <div className="space-y-2">
                        <div className="h-3 bg-slate-50 dark:bg-slate-900 rounded-md w-full" />
                        <div className="h-3 bg-slate-50 dark:bg-slate-900 rounded-md w-5/6" />
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                        <Clock size={12} className="animate-spin" /> Analyzing Sentence Details...
                    </div>
                </div>
            ) : null}

            {/* Translation — 제목 줄 없이 파란 상자로만 구분 (휴대폰 세로 공간 절약). 탭하면 원문처럼 문장 시작으로 */}
            {(drillMode ? !showAnalysis : showAnalysis) && item.translation && (
                <div
                    onClick={() => jumpToSentence(idx)}
                    className="rounded-xl px-2.5 py-1 border transition-colors duration-300 mb-1 bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-100 dark:border-indigo-900 cursor-pointer"
                >
                    <p className="text-slate-700 dark:text-slate-300 text-[16px] leading-[1.5] whitespace-pre-line font-medium">
                        {item.translation?.replace(/\\n/g, '\n')}
                    </p>
                </div>
            )}

            {/* Analysis — 제목 줄·테두리 없이 폭을 넓게. 청크와 뜻은 진하게, 괄호 속 요소 풀이는 흐리게.
                풀이는 기본 접힘이라 휴대폰에서 문장 하나가 한 화면에 들어온다. 분석 칸 아무 곳이나 탭하면
                이 카드의 풀이 전체가 펼침/접힘(재생 위치는 그대로). 표시는 오른쪽 아래 화살표 하나뿐. */}
            {analysisLines.length > 0 && (
                <div
                    onClick={hasBreakdown ? () => setFlipped(f => !f) : undefined}
                    onKeyDown={hasBreakdown ? onKeyActivate(() => setFlipped(f => !f)) : undefined}
                    role={hasBreakdown ? 'button' : undefined}
                    tabIndex={hasBreakdown ? 0 : undefined}
                    aria-expanded={hasBreakdown ? breakdownOpen : undefined}
                    aria-label={hasBreakdown ? (breakdownOpen ? '단어 풀이 접기' : '단어 풀이 펼치기') : undefined}
                    title={hasBreakdown ? (breakdownOpen ? '탭하면 풀이 접기' : '탭하면 단어 풀이 펼치기') : undefined}
                    className={`px-1 space-y-0.5 text-slate-800 dark:text-slate-200 text-[16px] leading-[1.5] ${hasBreakdown ? 'cursor-pointer' : ''}`}
                >
                    {analysisLines.map(([main, breakdown, tail], li) => (
                        <p key={li} className="font-medium">
                            {renderChunkLine(main, `m${li}`, hiddenMarks[li])}
                            {breakdown && breakdownOpen && (
                                <span className="text-slate-600 dark:text-slate-300 font-normal"><GlossText text={breakdown} keyPrefix={`b${li}`} renderText={renderBold} /></span>
                            )}
                            {tail}
                            {/* 화살표는 마지막 줄 오른쪽 끝에 띄운다 — 따로 한 줄을 차지하면 카드마다 빈 행이 생긴다 */}
                            {hasBreakdown && li === analysisLines.length - 1 && (
                                <span aria-hidden="true" className="float-right mt-1 text-slate-300 dark:text-slate-600">
                                    {breakdownOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </span>
                            )}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div
            ref={itemRef}
            data-idx={idx}
            className={`
        group relative transition-all duration-300 ease-out mb-1 rounded-xl border border-l-[4px] p-2 sm:px-4 sm:py-3
        ${isSelected
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-l-indigo-500 border-t-indigo-200 dark:border-t-indigo-800 border-r-indigo-200 dark:border-r-indigo-800 border-b-indigo-200 dark:border-b-indigo-800 ring-2 ring-indigo-300 dark:ring-indigo-600 shadow-md z-10'
                    : isActive
                        ? 'bg-transparent border-l-purple-700 dark:border-l-purple-400 border-t-slate-100 dark:border-t-slate-700 border-r-slate-100 dark:border-r-slate-700 border-b-slate-100 dark:border-b-slate-700 shadow-md z-10'
                        : inLoopGroup
                            ? 'bg-amber-50/40 dark:bg-amber-950/25 border-l-amber-400 border-t-amber-100 dark:border-t-amber-900 border-r-amber-100 dark:border-r-amber-900 border-b-amber-100 dark:border-b-amber-900'
                            : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 opacity-90'}
      `}
        >
            {/* 선택 모드: 카드 전체를 탭하면 선택/해제 (내부 버튼 클릭 차단) */}
            {selectMode && (
                <div
                    onClick={() => onToggleSelect && onToggleSelect(idx)}
                    onKeyDown={onKeyActivate(() => onToggleSelect && onToggleSelect(idx))}
                    className="absolute inset-0 z-30 cursor-pointer rounded-xl"
                    role="button"
                    tabIndex={0}
                    aria-label={isSelected ? '이 문장 선택 해제' : '이 문장 선택'}
                    aria-pressed={isSelected}
                >
                    <div className={`absolute top-2 right-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'}`}>
                        {isSelected && <Check size={14} className="stroke-[3]" />}
                    </div>
                </div>
            )}

            {/* 재전사 진행 오버레이 */}
            {item.isRetranscribing && (
                <div className="absolute inset-0 z-40 rounded-xl bg-white/70 dark:bg-slate-800/70 backdrop-blur-[1px] flex items-center justify-center">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-bold shadow">
                        <Loader2 size={14} className="animate-spin" /> 다시 전사 중...
                    </div>
                </div>
            )}

            <div>
                {/* Header: Timestamp & Looping Indicator — 휴대폰에서 세로 공간을 덜 쓰게 낮게 */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            // 반복 중엔(한 문장·묶음 모두) seekTo가 아니라 jumpToSentence로 간다.
                            // seekTo는 반복 기준(앵커)을 안 옮기므로, 다른 문장의 ▶를 누르면
                            // 옛 구간이 계속 반복되거나 누르자마자 그 처음으로 되감긴다.
                            // 한 문장 반복도 같았다 — 이웃(2초 안) 문장의 ▶는 0.25초 나오다 되감겼다(2026-11-19 점검, 화면 재현).
                            onClick={() => ((groupLoopOn || isGlobalLooping) ? jumpToSentence(idx) : seekTo(item.seconds))}
                            className={`
                  ${HIT_TS} flex items-center gap-1 px-1.5 py-0 leading-4 rounded-full text-[11px] font-bold font-mono tracking-wide transition-all
                  ${isActive ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-200 border border-purple-200 dark:border-purple-800' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}
                `}
                        >
                            <Play size={9} fill="currentColor" /> {item.timestamp}
                        </button>

                        {item.speaker && (
                            <span className={`px-1.5 py-0 leading-4 rounded-lg text-[9px] font-black uppercase tracking-tighter border ${isActive
                                ? 'bg-purple-600 text-white border-purple-700 dark:border-purple-400 shadow-sm'
                                : 'bg-slate-800 dark:bg-slate-200 text-slate-200 dark:text-slate-800 border-slate-900 dark:border-slate-300 opacity-80'
                                }`}>
                                {item.speaker}
                            </span>
                        )}

                        {/* [A1] 분석 커버리지 위반 배지 — 탭하면 이 문장만 재분석 (App이 확인창을 띄움) */}
                        {!drillMode && coverage && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onCoverageRetry && onCoverageRetry(idx); }}
                                title={coverageTitle(coverage)}
                                className={`${HIT_BADGE} inline-flex items-center gap-1 px-1.5 py-0 leading-4 rounded-md text-[11px] font-bold border bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors`}
                            >
                                <AlertTriangle size={11} />
                                {coverage.kind === 'no-chunks' ? '분석 깨짐' : coverage.missing.length > 0 ? `누락 ${coverage.missing.length}` : coverage.oversplit ? '과분할' : '뭉침'}
                            </button>
                        )}
                        {/* [B3] 전사의심 배지 — 분석 AI가 문맥상 오전사를 신고한 문장. 탭하면 이 구간만 재전사 */}
                        {!drillMode && item.transcriptSuspect && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onRetranscribe && onRetranscribe(idx); }}
                                title={`전사(받아쓰기) 오류 의심: ${item.transcriptSuspect} — 탭하면 이 구간만 다시 전사`}
                                className={`${HIT_BADGE} inline-flex items-center gap-1 px-1.5 py-0 leading-4 rounded-md text-[11px] font-bold border bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors`}
                            >
                                <Volume2 size={11} /> 전사의심
                            </button>
                        )}
                        {/* '대사만' 끝 시각 없음 — 이 문장 뒤는 건너뛰지 않는다. 탭하면 '대사 끝 맞추기' 창 */}
                        {!drillMode && speechEndMissing && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onSpeechEndFix && onSpeechEndFix(idx); }}
                                title="'대사만'에서 이 문장의 대사 끝을 몰라 뒤를 건너뛰지 않습니다 — 탭하면 대사 끝 맞추기"
                                className={`${HIT_BADGE} inline-flex items-center gap-1 px-1.5 py-0 leading-4 rounded-md text-[11px] font-bold border bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors`}
                            >
                                <FastForward size={11} /> 대사 끝 없음
                            </button>
                        )}
                    </div>

                    {isLooping && (
                        <div title="반복 중" aria-label="반복 중" className={`flex items-center px-1 py-0.5 rounded-md animate-pulse border z-10 ${isActive ? 'bg-purple-50/50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 border-purple-100 dark:border-purple-900' : 'bg-amber-50/50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900'}`}>
                            <Repeat size={10} className="stroke-[3]" />
                        </div>
                    )}
                </div>
                {drillMode ? (
                    <ClozeDrill
                        key={`cloze-${difficulty}-${drillRound}`}
                        item={item}
                        drill={drill}
                        showTranslation={showAnalysis}
                        allOpen={showAnalysis && showBreakdown}
                        onJump={() => jumpToSentence(idx)}
                        explanation={explanation}
                    />
                ) : (
                <>
                <div
                    onClick={() => jumpToSentence(idx)}
                    onKeyDown={onKeyActivate(() => jumpToSentence(idx))}
                    role="button"
                    tabIndex={0}
                    aria-label={`${item.timestamp}부터 재생`}
                    className={`
            text-lg sm:text-xl md:text-2xl leading-snug cursor-pointer transition-all duration-300 mb-0.5 px-1 font-medium
            ${isActive ? 'text-black dark:text-white' : 'text-slate-900 dark:text-slate-100'}
          `}
                >
                    {item.text.split(/(?<=[.!?])\s+/).filter(Boolean).map((segment, i, arr) => (
                        <span key={i}>
                            {segment}
                            {i < arr.length - 1 && <br />}
                        </span>
                    ))}
                </div>

                {explanation}
                </>
                )}

            </div>
        </div>
    );
});

export default TranscriptItem;
