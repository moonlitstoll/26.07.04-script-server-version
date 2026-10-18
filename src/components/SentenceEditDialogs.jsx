import { useState, useMemo } from 'react';
import { Play, Square, AlertTriangle, Scissors, AudioLines, FastForward } from 'lucide-react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { usePreviewPlayer } from '../hooks/usePreviewPlayer';
import {
    formatStamp, splitWords, sentenceEndOf, estimateSplitTime, splitTimeBounds,
    rangeFromSelection, indicesInRange, clampRange, LONG_RANGE_WARN_SEC,
} from '../utils/sentenceEdit';
import { speechEndEditBounds, initialSpeechEnd, speechEndSkipInfo } from '../utils/speechEndMerge';

const STEPS = [0.5, 0.1]; // 조정 단위(큰 이동, 미세 조정)
const PREVIEW_SEC = 3;

const Shell = ({ title, icon, onClose, children, footer }) => {
    useEscapeToClose(onClose);
    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 dark:bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="px-4 pt-4 pb-2 flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
                    {icon}{title}
                </div>
                <div className="px-4 pb-3 overflow-y-auto space-y-3">{children}</div>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 flex gap-2 rounded-b-2xl">{footer}</div>
            </div>
        </div>
    );
};

const PreviewButton = ({ preview, name, label, start, end }) => {
    if (!preview.available) return null;
    const on = preview.playing === name;
    return (
        <button
            type="button"
            onClick={() => preview.play(start, end, name)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40'}`}
        >
            {on ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />} {label}
        </button>
    );
};

// 시각 하나를 맞추는 줄: 큰 이동은 ±0.5초, 마무리는 ±0.1초. 범위 끝에서는 남은 만큼만 움직인다.
const StepButton = ({ label, delta, value, onChange, min, max }) => {
    const atEdge = delta < 0 ? value <= min + 1e-9 : value >= max - 1e-9;
    const next = Math.round(Math.min(max, Math.max(min, value + delta)) * 100) / 100;
    return (
        <button type="button" onClick={() => onChange(next)} disabled={atEdge}
            aria-label={`${label} ${Math.abs(delta)}초 ${delta < 0 ? '앞으로' : '뒤로'}`}
            className="w-9 h-9 shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums disabled:opacity-30">
            {delta < 0 ? '−' : '+'}{Math.abs(delta)}
        </button>
    );
};

const TimeAdjuster = ({ label, value, onChange, min, max }) => {
    const p = { label, value, onChange, min, max };
    return (
        <div className="flex items-center gap-1">
            <span className="w-8 shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
            {STEPS.map(d => <StepButton key={-d} delta={-d} {...p} />)}
            {/* nowrap: 글꼴을 Inter로 바꾼 뒤 휴대폰에서 "03:33.2 / 0"으로 두 줄로 꺾였다(사용자 캡처) */}
            <span className="flex-1 min-w-0 text-center font-mono text-[15px] font-bold text-slate-800 dark:text-slate-200 tabular-nums whitespace-nowrap">{formatStamp(value)}</span>
            {[...STEPS].reverse().map(d => <StepButton key={d} delta={d} {...p} />)}
        </div>
    );
};

// 창 맨 위에 '지금 다루는 문장' — 구간을 ±0.5초로 맞추는 동안 어느 문장인지 보여야 한다(대사 끝 맞추기 창과 같은 모양).
// 여러 문장이면 첫 문장 + 마지막 문장만(사이는 개수로).
const SentencePreview = ({ items }) => {
    if (!items || items.length === 0) return null;
    const first = items[0], last = items[items.length - 1];
    const between = items.length - 2;
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1">
            <div>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">{formatStamp(first.seconds)}</span>
                <p className="font-bold text-slate-800 dark:text-slate-200 leading-snug">{first.text}</p>
            </div>
            {items.length > 1 && (
                <>
                    {between > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">… 사이 {between}문장 …</p>}
                    <div>
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">{formatStamp(last.seconds)}</span>
                        <p className="font-bold text-slate-800 dark:text-slate-200 leading-snug">{last.text}</p>
                    </div>
                </>
            )}
        </div>
    );
};

const ModeOption = ({ checked, onClick, title, desc }) => (
    <button type="button" onClick={onClick}
        className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${checked ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-300 dark:ring-indigo-600' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
        <div className="flex items-center gap-2">
            <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${checked ? 'border-indigo-600 bg-indigo-600 shadow-[inset_0_0_0_2px_white]' : 'border-slate-300 dark:border-slate-600'}`} />
            <span className="font-bold text-sm text-slate-800 dark:text-slate-200">{title}</span>
        </div>
        {desc && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 ml-6 leading-snug">{desc}</p>}
    </button>
);

/**
 * "전사" 확인창 — 기존 '문장별로 다시'(기본)와 새 '한 구간으로 다시' 중 고른다.
 * 한 구간: 선택한 첫 문장 시작 ~ 마지막 문장 끝을 한 번에 다시 듣고, 시작 시각이 그 안인 문장을 전부 바꾼다.
 */
export function RetranscribeDialog({ data, selectedIdxs, duration, mediaUrl, playbackRate, onPausePlayer, onSentenceMode, onRangeMode, onClose }) {
    const idxs = useMemo(() => [...selectedIdxs], [selectedIdxs]);
    const initial = useMemo(() => rangeFromSelection(data, idxs, duration), [data, idxs, duration]);
    const [mode, setMode] = useState('sentence');
    const [range, setRange] = useState(() => initial || { start: 0, end: 1 });
    const preview = usePreviewPlayer(mediaUrl, { onStart: onPausePlayer, rate: playbackRate });

    const replaced = indicesInRange(data, range.start, range.end);
    const unselectedInside = replaced.filter(i => !selectedIdxs.has(i)).length;
    const len = range.end - range.start;
    const maxEnd = duration > 0 ? duration : range.end + 60;
    const setStart = (s) => setRange(r => clampRange(s, r.end, duration));
    const setEnd = (e) => setRange(r => clampRange(r.start, e, duration));
    const close = () => { preview.stop(); onClose(); };

    return (
        <Shell
            title="다시 전사" icon={<AudioLines size={18} className="text-indigo-600 dark:text-indigo-400" />} onClose={close}
            footer={<>
                <button onClick={close} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 font-bold hover:bg-white dark:hover:bg-slate-700 rounded-xl">취소</button>
                <button
                    onClick={() => { preview.stop(); if (mode === 'sentence') onSentenceMode(); else onRangeMode(range.start, range.end); }}
                    disabled={mode === 'range' && replaced.length === 0 && len <= 0}
                    className="flex-1 py-2.5 text-white font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-black/40 disabled:bg-slate-300 dark:disabled:bg-slate-600">
                    {mode === 'sentence' ? '전사 다시' : '구간 전사'}
                </button>
            </>}
        >
            <SentencePreview items={idxs.map(i => data[i]).filter(Boolean)} />
            <ModeOption checked={mode === 'sentence'} onClick={() => setMode('sentence')}
                title="문장별로 다시"
                desc={`선택한 ${idxs.length}개 문장을 하나씩 다시 듣고 전사합니다. 나머지 문장·타임라인은 그대로.`} />
            <ModeOption checked={mode === 'range'} onClick={() => setMode('range')}
                title="한 구간으로 다시"
                desc="처음~끝을 한 번에 다시 들어, 그 안의 문장을 통째로 새로 바꿉니다. 문장 경계가 틀렸거나 문장이 빠진 곳에." />

            {mode === 'range' && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 p-3 space-y-2.5">
                    <TimeAdjuster label="시작" value={range.start} onChange={setStart} min={0} max={range.end - 0.5} />
                    <TimeAdjuster label="끝" value={range.end} onChange={setEnd} min={range.start + 0.5} max={maxEnd} />
                    <div className="flex flex-wrap gap-1.5 justify-center">
                        <PreviewButton preview={preview} name="head" label={`시작 ${PREVIEW_SEC}초`} start={range.start} end={Math.min(range.end, range.start + PREVIEW_SEC)} />
                        <PreviewButton preview={preview} name="tail" label={`끝 ${PREVIEW_SEC}초`} start={Math.max(range.start, range.end - PREVIEW_SEC)} end={range.end} />
                        <PreviewButton preview={preview} name="all" label="전체" start={range.start} end={range.end} />
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                        {len.toFixed(1)}초 · 문장 <b>{replaced.length}개</b>를 새 결과로 교체
                        {unselectedInside > 0 && <> (고르지 않은 사이 문장 {unselectedInside}개 포함)</>}.
                        바뀐 문장은 휴지통에 보관되고, 새 문장은 자동으로 분석합니다.
                    </p>
                    {len > LONG_RANGE_WARN_SEC && (
                        <p className="flex gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400 leading-snug">
                            <AlertTriangle size={14} className="shrink-0 mt-px" />
                            3분이 넘는 구간입니다. 길수록 멀쩡하던 문장까지 바뀌고, 문장이 뭉치거나 빠질 수 있어요.
                        </p>
                    )}
                </div>
            )}
        </Shell>
    );
}

/**
 * 선택 모드 '대사만'(문장 1개) — AI에게 다시 듣게 하거나(기존, 짧은 클립 전송) 끝 시각을 직접 맞춘다(무료).
 * 직접 맞추기: ±0.5·±0.1초 + '끝 앞/뒤 3초' 미리 듣기, 아래 줄에 그 값이면 건너뛰는지 보여 준다.
 */
export function SpeechEndDialog({ data, idx, duration, mediaUrl, playbackRate, onPausePlayer, onDetect, onApply, onClose }) {
    const item = data[idx];
    const bounds = useMemo(() => speechEndEditBounds(data, idx, duration), [data, idx, duration]);
    const initial = useMemo(() => initialSpeechEnd(data, idx, duration), [data, idx, duration]);
    const [mode, setMode] = useState('manual');
    const [se, setSe] = useState(initial.value);
    const preview = usePreviewPlayer(mediaUrl, { onStart: onPausePlayer, rate: playbackRate });
    const info = speechEndSkipInfo(data, idx, se, duration);
    const close = () => { preview.stop(); onClose(); };
    const afterEnd = duration > 0 ? Math.min(duration, se + PREVIEW_SEC) : se + PREVIEW_SEC;

    return (
        <Shell
            title="대사 끝 맞추기" icon={<FastForward size={18} className="text-sky-600 dark:text-sky-400" />} onClose={close}
            footer={<>
                <button onClick={close} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 font-bold hover:bg-white dark:hover:bg-slate-700 rounded-xl">취소</button>
                <button
                    onClick={() => { preview.stop(); if (mode === 'manual') onApply(se); else onDetect(); }}
                    className="flex-1 py-2.5 text-white font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-black/40">
                    {mode === 'manual' ? '적용' : '대사만 다시'}
                </button>
            </>}
        >
            <SentencePreview items={[item]} />
            <ModeOption checked={mode === 'manual'} onClick={() => setMode('manual')}
                title="직접 맞추기 (무료)"
                desc="들어 보면서 대사가 끝나는 시각을 직접 정합니다." />
            <ModeOption checked={mode === 'ai'} onClick={() => setMode('ai')}
                title="AI가 다시 듣기"
                desc="이 문장 주변 오디오만 AI에게 다시 들려 끝을 찾습니다(몇 원). 못 찾으면 기존 값을 그대로 둡니다." />

            {mode === 'manual' && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 p-3 space-y-2.5">
                    {initial.estimated && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">끝 시각이 없어 글자 수로 어림했어요. 들어 보고 맞춰 주세요.</p>
                    )}
                    <TimeAdjuster label="끝" value={se} onChange={setSe} min={bounds.min} max={bounds.max} />
                    <div className="flex flex-wrap gap-1.5 justify-center">
                        <PreviewButton preview={preview} name="before" label={`끝 앞 ${PREVIEW_SEC}초`} start={Math.max(item.seconds, se - PREVIEW_SEC)} end={se} />
                        <PreviewButton preview={preview} name="after" label={`끝 뒤 ${PREVIEW_SEC}초`} start={se} end={afterEnd} />
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                        {info.kind === 'skip' && <>다음 문장({formatStamp(info.nextStart)})까지 <b>{info.gap.toFixed(1)}초를 건너뜁니다</b>. '끝 뒤'에 말소리가 없어야 해요.</>}
                        {info.kind === 'short' && <>다음 문장까지 간격이 {Math.max(0, info.gap).toFixed(1)}초라 건너뛰지 않고 그대로 재생합니다(3초 넘어야 건너뜀).</>}
                        {info.kind === 'wrap' && <>마지막 문장 — 끝 뒤 {info.gap.toFixed(1)}초를 건너뛰고 처음으로 돌아갑니다.</>}
                        {info.kind === 'end' && <>마지막 문장 — 남은 부분이 짧아 끝까지 재생합니다.</>}
                    </p>
                </div>
            )}
        </Shell>
    );
}

const SPLIT_MODES = [
    ['dropHead', '앞부분 삭제', '앞은 지우고 뒤만 남깁니다'],
    ['dropTail', '뒷부분 삭제', '뒤는 지우고 앞만 남깁니다'],
    ['keepBoth', '둘 다 남기고 나누기', '두 문장으로 나눕니다'],
];

/**
 * "나누기" 창 — 뒷부분이 시작될 단어를 탭하고, 앞/뒤 삭제 또는 둘로 나누기를 고른다.
 * 뒷부분이 남는 경우 그 시작 시각을 글자 수로 어림해 넣고, ±0.5초와 미리 듣기로 맞춘다.
 */
export function SplitDialog({ data, idx, duration, mediaUrl, playbackRate, onPausePlayer, onApply, onClose }) {
    const item = data[idx];
    const words = useMemo(() => splitWords(item?.text), [item]);
    const [cut, setCut] = useState(null); // 뒷부분이 시작되는 단어 인덱스(1..n-1)
    const [mode, setMode] = useState(null);
    const [t, setT] = useState(null);     // 뒷부분 시작 시각(조정값)
    const bounds = useMemo(() => splitTimeBounds(data, idx, duration), [data, idx, duration]);
    const preview = usePreviewPlayer(mediaUrl, { onStart: onPausePlayer, rate: playbackRate });

    const pickCut = (k) => {
        setCut(k);
        const est = estimateSplitTime(item.seconds, sentenceEndOf(data, idx, duration), item.text, k);
        setT(Math.min(bounds.max, Math.max(bounds.min, est)));
    };
    const needsTime = mode === 'dropHead' || mode === 'keepBoth';
    const close = () => { preview.stop(); onClose(); };
    const ready = cut != null && mode != null;

    return (
        <Shell
            title="문장 나누기" icon={<Scissors size={18} className="text-indigo-600 dark:text-indigo-400" />} onClose={close}
            footer={<>
                <button onClick={close} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 font-bold hover:bg-white dark:hover:bg-slate-700 rounded-xl">취소</button>
                <button
                    onClick={() => { preview.stop(); onApply({ wordIndex: cut, mode, splitSeconds: t }); }}
                    disabled={!ready}
                    // 못 누를 땐 흐린 글자 + 무엇을 더 골라야 하는지 글로 — 다크에서 slate-600 바탕의 흰 글자는 보통 버튼처럼 보였다
                    className={`flex-1 py-2.5 text-white font-bold rounded-xl shadow-lg disabled:bg-slate-200 dark:disabled:bg-slate-700/60 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed ${mode === 'keepBoth' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 dark:shadow-black/40' : 'bg-red-500 hover:bg-red-600 shadow-red-200 dark:shadow-black/40'}`}>
                    {ready ? SPLIT_MODES.find(m => m[0] === mode)[1] : cut == null ? '단어를 먼저 탭하세요' : '방식을 고르세요'}
                </button>
            </>}
        >
            <p className="text-xs text-slate-500 dark:text-slate-400">뒷부분이 <b>시작될 단어</b>를 탭하세요.</p>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-[17px] leading-[1.9] font-bold flex flex-wrap gap-x-1.5">
                {words.map((w, k) => {
                    const after = cut != null && k >= cut;
                    const dim = (after && mode === 'dropTail') || (!after && cut != null && mode === 'dropHead');
                    return (
                        <span key={k} className="inline-flex items-center">
                            {cut === k && <Scissors size={14} className="text-rose-500 dark:text-rose-400 mr-1 -ml-0.5" />}
                            <button
                                type="button"
                                disabled={k === 0}
                                onClick={() => pickCut(k)}
                                className={`rounded px-0.5 transition-colors ${after ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-200'} ${dim ? 'line-through opacity-40' : ''} ${k === 0 ? 'cursor-default' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                            >
                                {w}
                            </button>
                        </span>
                    );
                })}
            </div>

            {cut != null && (
                <div className="space-y-1.5">
                    {SPLIT_MODES.map(([m, title, desc]) => (
                        <ModeOption key={m} checked={mode === m} onClick={() => setMode(m)} title={title} desc={desc} />
                    ))}
                </div>
            )}

            {cut != null && needsTime && t != null && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 p-3 space-y-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        남는 뒷부분("{words.slice(cut, cut + 3).join(' ')}…")의 시작 시각 — 글자 수로 어림했어요. 들어보고 맞춰 주세요.
                    </p>
                    <TimeAdjuster label="시작" value={t} onChange={setT} min={bounds.min} max={bounds.max} />
                    <div className="flex justify-center">
                        <PreviewButton preview={preview} name="split" label={`여기서부터 ${PREVIEW_SEC}초`} start={t} end={t + PREVIEW_SEC} />
                    </div>
                </div>
            )}
            {mode && mode !== 'keepBoth' && (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">지운 부분은 휴지통에 보관돼요. 남은 문장은 자동으로 다시 분석합니다.</p>
            )}
        </Shell>
    );
}
