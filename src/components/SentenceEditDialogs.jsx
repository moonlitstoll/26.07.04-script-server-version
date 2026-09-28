import { useState, useMemo } from 'react';
import { Minus, Plus, Play, Square, AlertTriangle, Scissors, AudioLines } from 'lucide-react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { usePreviewPlayer } from '../hooks/usePreviewPlayer';
import {
    formatStamp, splitWords, sentenceEndOf, estimateSplitTime, splitTimeBounds,
    rangeFromSelection, indicesInRange, clampRange, LONG_RANGE_WARN_SEC,
} from '../utils/sentenceEdit';

const STEP = 0.5;
const PREVIEW_SEC = 3;

const Shell = ({ title, icon, onClose, children, footer }) => {
    useEscapeToClose(onClose);
    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="px-4 pt-4 pb-2 flex items-center gap-2 text-slate-800 font-bold">
                    {icon}{title}
                </div>
                <div className="px-4 pb-3 overflow-y-auto space-y-3">{children}</div>
                <div className="p-3 bg-slate-50 flex gap-2 rounded-b-2xl">{footer}</div>
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
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}
        >
            {on ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />} {label}
        </button>
    );
};

// 시각 하나를 ±0.5초로 맞추는 줄
const TimeAdjuster = ({ label, value, onChange, min, max }) => (
    <div className="flex items-center gap-2">
        <span className="w-9 shrink-0 text-xs font-bold text-slate-500">{label}</span>
        <button type="button" onClick={() => onChange(Math.max(min, value - STEP))} disabled={value - STEP < min - 1e-9}
            aria-label={`${label} 0.5초 앞으로`}
            className="w-9 h-9 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-600 disabled:opacity-30">
            <Minus size={16} />
        </button>
        <span className="flex-1 text-center font-mono text-lg font-bold text-slate-800 tabular-nums">{formatStamp(value)}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + STEP))} disabled={value + STEP > max + 1e-9}
            aria-label={`${label} 0.5초 뒤로`}
            className="w-9 h-9 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-600 disabled:opacity-30">
            <Plus size={16} />
        </button>
    </div>
);

const ModeOption = ({ checked, onClick, title, desc }) => (
    <button type="button" onClick={onClick}
        className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${checked ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
        <div className="flex items-center gap-2">
            <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${checked ? 'border-indigo-600 bg-indigo-600 shadow-[inset_0_0_0_2px_white]' : 'border-slate-300'}`} />
            <span className="font-bold text-sm text-slate-800">{title}</span>
        </div>
        {desc && <p className="text-xs text-slate-500 mt-0.5 ml-6 leading-snug">{desc}</p>}
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
            title="다시 전사" icon={<AudioLines size={18} className="text-indigo-600" />} onClose={close}
            footer={<>
                <button onClick={close} className="flex-1 py-2.5 text-slate-600 font-bold hover:bg-white rounded-xl">취소</button>
                <button
                    onClick={() => { preview.stop(); if (mode === 'sentence') onSentenceMode(); else onRangeMode(range.start, range.end); }}
                    disabled={mode === 'range' && replaced.length === 0 && len <= 0}
                    className="flex-1 py-2.5 text-white font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 disabled:bg-slate-300">
                    {mode === 'sentence' ? '전사 다시' : '구간 전사'}
                </button>
            </>}
        >
            <ModeOption checked={mode === 'sentence'} onClick={() => setMode('sentence')}
                title="문장별로 다시"
                desc={`선택한 ${idxs.length}개 문장을 하나씩 다시 듣고 전사합니다. 나머지 문장·타임라인은 그대로.`} />
            <ModeOption checked={mode === 'range'} onClick={() => setMode('range')}
                title="한 구간으로 다시"
                desc="처음~끝을 한 번에 다시 들어, 그 안의 문장을 통째로 새로 바꿉니다. 문장 경계가 틀렸거나 문장이 빠진 곳에." />

            {mode === 'range' && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
                    <TimeAdjuster label="시작" value={range.start} onChange={setStart} min={0} max={range.end - 0.5} />
                    <TimeAdjuster label="끝" value={range.end} onChange={setEnd} min={range.start + 0.5} max={maxEnd} />
                    <div className="flex flex-wrap gap-1.5 justify-center">
                        <PreviewButton preview={preview} name="head" label={`시작 ${PREVIEW_SEC}초`} start={range.start} end={Math.min(range.end, range.start + PREVIEW_SEC)} />
                        <PreviewButton preview={preview} name="tail" label={`끝 ${PREVIEW_SEC}초`} start={Math.max(range.start, range.end - PREVIEW_SEC)} end={range.end} />
                        <PreviewButton preview={preview} name="all" label="전체" start={range.start} end={range.end} />
                    </div>
                    <p className="text-xs text-slate-600 leading-snug">
                        {len.toFixed(1)}초 · 문장 <b>{replaced.length}개</b>를 새 결과로 교체
                        {unselectedInside > 0 && <> (고르지 않은 사이 문장 {unselectedInside}개 포함)</>}.
                        바뀐 문장은 휴지통에 보관되고, 새 문장은 자동으로 분석합니다.
                    </p>
                    {len > LONG_RANGE_WARN_SEC && (
                        <p className="flex gap-1.5 text-xs font-bold text-rose-600 leading-snug">
                            <AlertTriangle size={14} className="shrink-0 mt-px" />
                            3분이 넘는 구간입니다. 길수록 멀쩡하던 문장까지 바뀌고, 문장이 뭉치거나 빠질 수 있어요.
                        </p>
                    )}
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
            title="문장 나누기" icon={<Scissors size={18} className="text-indigo-600" />} onClose={close}
            footer={<>
                <button onClick={close} className="flex-1 py-2.5 text-slate-600 font-bold hover:bg-white rounded-xl">취소</button>
                <button
                    onClick={() => { preview.stop(); onApply({ wordIndex: cut, mode, splitSeconds: t }); }}
                    disabled={!ready}
                    className={`flex-1 py-2.5 text-white font-bold rounded-xl shadow-lg disabled:bg-slate-300 disabled:shadow-none ${mode === 'keepBoth' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-red-500 hover:bg-red-600 shadow-red-200'}`}>
                    {mode ? SPLIT_MODES.find(m => m[0] === mode)[1] : '적용'}
                </button>
            </>}
        >
            <p className="text-xs text-slate-500">뒷부분이 <b>시작될 단어</b>를 탭하세요.</p>
            <div className="rounded-xl border border-slate-200 p-3 text-[17px] leading-[1.9] font-bold flex flex-wrap gap-x-1.5">
                {words.map((w, k) => {
                    const after = cut != null && k >= cut;
                    const dim = (after && mode === 'dropTail') || (!after && cut != null && mode === 'dropHead');
                    return (
                        <span key={k} className="inline-flex items-center">
                            {cut === k && <Scissors size={14} className="text-rose-500 mr-1 -ml-0.5" />}
                            <button
                                type="button"
                                disabled={k === 0}
                                onClick={() => pickCut(k)}
                                className={`rounded px-0.5 transition-colors ${after ? 'bg-indigo-100 text-indigo-800' : 'text-slate-800'} ${dim ? 'line-through opacity-40' : ''} ${k === 0 ? 'cursor-default' : 'hover:bg-slate-100'}`}
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
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                    <p className="text-xs text-slate-500">
                        남는 뒷부분("{words.slice(cut, cut + 3).join(' ')}…")의 시작 시각 — 글자 수로 어림했어요. 들어보고 맞춰 주세요.
                    </p>
                    <TimeAdjuster label="시작" value={t} onChange={setT} min={bounds.min} max={bounds.max} />
                    <div className="flex justify-center">
                        <PreviewButton preview={preview} name="split" label={`여기서부터 ${PREVIEW_SEC}초`} start={t} end={t + PREVIEW_SEC} />
                    </div>
                </div>
            )}
            {mode && mode !== 'keepBoth' && (
                <p className="text-xs text-slate-500 leading-snug">지운 부분은 휴지통에 보관돼요. 남은 문장은 자동으로 다시 분석합니다.</p>
            )}
        </Shell>
    );
}
