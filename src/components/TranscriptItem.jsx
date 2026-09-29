import { useRef, useEffect, useLayoutEffect, useMemo, useState, memo } from 'react';
import {
    Play, Repeat, Clock, Loader2, Check, AlertTriangle, RotateCcw, Volume2, ChevronDown, ChevronUp
} from 'lucide-react';
import ClozeDrill from './ClozeDrill';
import { checkAnalysisCoverage, coverageTitle } from '../utils/analysisCoverage';
import { splitBreakdown } from '../utils/analysisParser';

// **굵게** 표시 → 초록 굵은 청크
const renderBold = (s, keyPrefix) => s.split(/(\*\*.*?\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? <strong key={`${keyPrefix}-${i}`} className="text-emerald-800 font-extrabold">{part.slice(2, -2)}</strong>
        : part
);

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

const TranscriptItem = memo(({
    item, idx, isActive, isGlobalLooping, manualScrollNonce,
    seekTo, jumpToSentence,
    isLooping, showAnalysis, showBreakdown = false,
    selectMode = false, isSelected = false, onToggleSelect,
    onRetryAnalysis, onCoverageRetry, onRetranscribe,
    drillMode = false, difficulty = 'easy', drillRound = 0, onMarkAnswer, isWrong = false,
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
            .split('\n').filter(l => l.trim()).map(splitBreakdown);
    }, [item.analysis, item.text]);
    const hasBreakdown = analysisLines.some(([, b]) => b);

    // 괄호 풀이 카드별 펼침: 눈 버튼(showBreakdown)이 전체 기본값, 분석 칸을 탭하면 이 카드만 반대로 뒤집는다.
    const [flipped, setFlipped] = useState(false);
    // 눈 버튼으로 전체를 바꾸면 카드별 예외는 초기화(모든 카드가 새 기본값을 따르게)
    const [prevShowBreakdown, setPrevShowBreakdown] = useState(showBreakdown);
    if (prevShowBreakdown !== showBreakdown) {
        setPrevShowBreakdown(showBreakdown);
        setFlipped(false);
    }
    const breakdownOpen = showBreakdown !== flipped;

    // 1. Focus Lock: Conditional Anchoring
    const prevActiveRef = useRef(isActive);
    const prevNonceRef = useRef(manualScrollNonce);

    useEffect(() => {
        const becameActive = isActive && !prevActiveRef.current;
        const isManualJump = manualScrollNonce !== prevNonceRef.current;

        prevActiveRef.current = isActive;
        prevNonceRef.current = manualScrollNonce;

        const isAutoAdvancing = isActive && !isGlobalLooping;

        const shouldScroll = isActive && (becameActive || isManualJump || isAutoAdvancing);

        if (shouldScroll && itemRef.current) {
            itemRef.current.scrollIntoView({
                behavior: 'auto',
                block: 'start'
            });
        }
    }, [isActive, manualScrollNonce, isGlobalLooping]);

    // 2. Resize Stabilization
    useLayoutEffect(() => {
        if (isActive && itemRef.current) {
            itemRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
    }, [showAnalysis, showBreakdown, flipped, isActive]);

    return (
        <div
            ref={itemRef}
            data-idx={idx}
            className={`
        group relative transition-all duration-300 ease-out mb-1 rounded-xl border border-l-[4px] p-2 sm:px-4 sm:py-3
        ${isSelected
                    ? 'bg-indigo-50 border-l-indigo-500 border-t-indigo-200 border-r-indigo-200 border-b-indigo-200 ring-2 ring-indigo-300 shadow-md z-10'
                    : isActive
                        ? 'bg-transparent border-l-purple-700 border-t-slate-100 border-r-slate-100 border-b-slate-100 shadow-md z-10'
                        : inLoopGroup
                            ? 'bg-amber-50/40 border-l-amber-400 border-t-amber-100 border-r-amber-100 border-b-amber-100'
                            : 'bg-white border-slate-100 opacity-90'}
      `}
        >
            {/* 선택 모드: 카드 전체를 탭하면 선택/해제 (내부 버튼 클릭 차단) */}
            {selectMode && (
                <div
                    onClick={() => onToggleSelect && onToggleSelect(idx)}
                    className="absolute inset-0 z-30 cursor-pointer rounded-xl"
                    role="button"
                    aria-pressed={isSelected}
                >
                    <div className={`absolute top-2 right-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'}`}>
                        {isSelected && <Check size={14} className="stroke-[3]" />}
                    </div>
                </div>
            )}

            {/* 재전사 진행 오버레이 */}
            {item.isRetranscribing && (
                <div className="absolute inset-0 z-40 rounded-xl bg-white/70 backdrop-blur-[1px] flex items-center justify-center">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-bold shadow">
                        <Loader2 size={14} className="animate-spin" /> 다시 전사 중...
                    </div>
                </div>
            )}

            <div>
                {/* Header: Timestamp & Looping Indicator — 휴대폰에서 세로 공간을 덜 쓰게 낮게 */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {isWrong && (
                            <span title="이 문장을 몰랐어요 (오답)" className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-600 border border-amber-300 text-[10px] font-black">
                                !
                            </span>
                        )}
                        <button
                            // 묶음 반복 중엔 seekTo가 아니라 jumpToSentence로 간다.
                            // seekTo는 반복 기준(앵커)을 안 옮기므로, 다른 묶음의 ▶를 누르면
                            // 옛 묶음이 계속 반복되거나 누르자마자 묶음 처음으로 되감긴다.
                            onClick={() => (groupLoopOn ? jumpToSentence(idx) : seekTo(item.seconds))}
                            className={`
                  flex items-center gap-1 px-1.5 py-0 leading-4 rounded-full text-[10px] font-bold font-mono tracking-wide transition-all
                  ${isActive ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}
                `}
                        >
                            <Play size={8} fill="currentColor" /> {item.timestamp}
                        </button>

                        {item.speaker && (
                            <span className={`px-1.5 py-0 leading-4 rounded-lg text-[9px] font-black uppercase tracking-tighter border ${isActive
                                ? 'bg-purple-600 text-white border-purple-700 shadow-sm'
                                : 'bg-slate-800 text-slate-200 border-slate-900 opacity-80'
                                }`}>
                                {item.speaker}
                            </span>
                        )}

                        {/* [A1] 분석 커버리지 위반 배지 — 탭하면 이 문장만 재분석 (App이 확인창을 띄움) */}
                        {!drillMode && coverage && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onCoverageRetry && onCoverageRetry(idx); }}
                                title={coverageTitle(coverage)}
                                className="inline-flex items-center gap-1 px-1.5 py-0 leading-4 rounded-md text-[9px] font-bold border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors"
                            >
                                <AlertTriangle size={9} />
                                {coverage.kind === 'no-chunks' ? '분석 깨짐' : coverage.missing.length > 0 ? `누락 ${coverage.missing.length}` : '뭉침'}
                            </button>
                        )}
                        {/* [B3] 전사의심 배지 — 분석 AI가 문맥상 오전사를 신고한 문장. 탭하면 이 구간만 재전사 */}
                        {!drillMode && item.transcriptSuspect && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onRetranscribe && onRetranscribe(idx); }}
                                title={`전사(받아쓰기) 오류 의심: ${item.transcriptSuspect} — 탭하면 이 구간만 다시 전사`}
                                className="inline-flex items-center gap-1 px-1.5 py-0 leading-4 rounded-md text-[9px] font-bold border bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 transition-colors"
                            >
                                <Volume2 size={9} /> 전사의심
                            </button>
                        )}
                    </div>

                    {isLooping && (
                        <div title="반복 중" aria-label="반복 중" className={`flex items-center px-1 py-0.5 rounded-md animate-pulse border z-10 ${isActive ? 'bg-purple-50/50 text-purple-600 border-purple-100' : 'bg-amber-50/50 text-amber-600 border-amber-100'}`}>
                            <Repeat size={10} className="stroke-[3]" />
                        </div>
                    )}
                </div>
                {drillMode ? (
                    <ClozeDrill
                        key={`cloze-${difficulty}-${drillRound}`}
                        item={item}
                        idx={idx}
                        difficulty={difficulty}
                        round={drillRound}
                        onMark={(known) => onMarkAnswer && onMarkAnswer(idx, known)}
                        onJump={() => jumpToSentence(idx)}
                    />
                ) : (
                <>
                <div
                    onClick={() => jumpToSentence(idx)}
                    className={`
            text-lg sm:text-xl md:text-2xl leading-snug cursor-pointer transition-all duration-300 mb-0.5 px-1 font-bold
            ${isActive ? 'text-black' : 'text-slate-900'}
          `}
                >
                    {item.text.split(/(?<=[.!?])\s+/).filter(Boolean).map((segment, i, arr) => (
                        <span key={i}>
                            {segment}
                            {i < arr.length - 1 && <br />}
                        </span>
                    ))}
                </div>

                {/* Detailed Analysis Section */}
                <div className={`overflow-hidden transition-all duration-500 ease-in-out ${showAnalysis ? 'max-h-[2000px] opacity-100 mt-0.5 pt-1 border-t border-slate-100' : 'max-h-0 opacity-0 mt-0 pt-0'}`}>

                    {/* Stage 2 실패 상태: 분석이 끝났는데도 실패로 남은 문장 → 다시 시도 */}
                    {!item.isAnalyzed && item.analysisFailed ? (
                        <div className="py-3 px-3 my-1 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-amber-700 min-w-0">
                                <AlertTriangle size={15} className="shrink-0 text-amber-500" />
                                <span className="text-[13px] font-bold leading-tight">이 문장 분석에 실패했어요</span>
                            </div>
                            {onRetryAnalysis && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onRetryAnalysis(idx); }}
                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors"
                                >
                                    <RotateCcw size={13} /> 다시 시도
                                </button>
                            )}
                        </div>
                    ) : !item.isAnalyzed ? (
                        /* Stage 2 Loading State */
                        <div className="py-4 px-2 space-y-3 animate-pulse">
                            <div className="h-4 bg-slate-100 rounded-md w-3/4" />
                            <div className="space-y-2">
                                <div className="h-3 bg-slate-50 rounded-md w-full" />
                                <div className="h-3 bg-slate-50 rounded-md w-5/6" />
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                                <Clock size={12} className="animate-spin" /> Analyzing Sentence Details...
                            </div>
                        </div>
                    ) : null}

                    {/* Translation — 제목 줄 없이 파란 상자로만 구분 (휴대폰 세로 공간 절약). 탭하면 원문처럼 문장 시작으로 */}
                    {showAnalysis && item.translation && (
                        <div
                            onClick={() => jumpToSentence(idx)}
                            className="rounded-xl px-2.5 py-1 border transition-colors duration-300 mb-1 bg-indigo-50/80 border-indigo-100 cursor-pointer"
                        >
                            <p className="text-slate-700 text-[16px] leading-[1.5] whitespace-pre-line font-medium">
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
                            title={hasBreakdown ? (breakdownOpen ? '탭하면 풀이 접기' : '탭하면 단어 풀이 펼치기') : undefined}
                            className={`relative px-1 space-y-0.5 text-slate-800 text-[16px] leading-[1.5] ${hasBreakdown ? 'cursor-pointer pb-3' : ''}`}
                        >
                            {analysisLines.map(([main, breakdown, tail], li) => (
                                <p key={li} className="font-medium">
                                    {renderBold(main, `m${li}`)}
                                    {breakdown && breakdownOpen && (
                                        <span className="text-slate-500 font-normal">{renderBold(breakdown, `b${li}`)}</span>
                                    )}
                                    {tail}
                                </p>
                            ))}
                            {hasBreakdown && (
                                <span aria-hidden="true" className="absolute right-0 bottom-0 text-slate-300">
                                    {breakdownOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                </>
                )}

            </div>
        </div>
    );
});

export default TranscriptItem;
