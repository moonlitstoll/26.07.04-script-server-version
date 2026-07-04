import { useRef, useEffect, useLayoutEffect, memo } from 'react';
import {
    Play, Repeat, Clock, Languages, BookOpen
} from 'lucide-react';

const TranscriptItem = memo(({
    item, idx, isActive, isGlobalLooping, manualScrollNonce,
    seekTo, jumpToSentence,
    isLooping, showAnalysis
}) => {
    const itemRef = useRef(null);

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
    }, [showAnalysis, isActive]);

    return (
        <div
            ref={itemRef}
            data-idx={idx}
            className={`
        group relative transition-all duration-300 ease-out mb-2 rounded-xl border border-l-[4px] p-2.5 sm:px-4 sm:py-5
        ${isActive
                    ? 'bg-transparent border-l-purple-700 border-t-slate-100 border-r-slate-100 border-b-slate-100 shadow-md z-10'
                    : 'bg-white border-slate-100 opacity-90'}
      `}
        >

            <div>
                {/* Header: Timestamp & Looping Indicator */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => seekTo(item.seconds)}
                            className={`
                  flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wide transition-all
                  ${isActive ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}
                `}
                        >
                            <Play size={8} fill="currentColor" /> {item.timestamp}
                        </button>

                        {item.speaker && (
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-tighter border ${isActive
                                ? 'bg-purple-600 text-white border-purple-700 shadow-sm'
                                : 'bg-slate-800 text-slate-200 border-slate-900 opacity-80'
                                }`}>
                                {item.speaker}
                            </span>
                        )}
                    </div>

                    {isLooping && (
                        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-tight animate-pulse border z-10 ${isActive ? 'bg-purple-50/50 text-purple-600 border-purple-100' : 'bg-amber-50/50 text-amber-600 border-amber-100'}`}>
                            <Repeat size={8} className="stroke-[3]" /> LOOPING
                        </div>
                    )}
                </div>
                <div
                    onClick={() => jumpToSentence(idx)}
                    className={`
            text-xl sm:text-2xl md:text-3xl leading-snug cursor-pointer transition-all duration-300 mb-1 px-1 font-bold
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
                <div className={`overflow-hidden transition-all duration-500 ease-in-out ${showAnalysis ? 'max-h-[2000px] opacity-100 mt-1 pt-1 border-t border-slate-100' : 'max-h-0 opacity-0 mt-0 pt-0'}`}>

                    {/* Stage 2 Loading State */}
                    {!item.isAnalyzed && (
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
                    )}

                    {/* Translation */}
                    {showAnalysis && item.translation && (
                        <div className={`rounded-xl px-3 py-2 border transition-colors duration-300 mb-2 ${showAnalysis ? 'bg-indigo-50/80 border-indigo-100' : 'bg-slate-50/50 border-slate-100'}`}>
                            <div className="flex items-center gap-1.5 text-indigo-600 font-bold text-[11px] uppercase tracking-wider mb-0.5">
                                <Languages size={12} /> Translation
                            </div>
                            <p className="text-slate-700 text-base leading-snug whitespace-pre-line font-medium">
                                {item.translation?.replace(/\\n/g, '\n')}
                            </p>
                        </div>
                    )}

                    {/* Light JSON Analysis Content */}
                    {item.analysis && (
                        <div>
                            <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-[11px] uppercase tracking-wider mb-1 px-1">
                                <BookOpen size={12} /> Detailed Analysis
                            </div>
                            <div className="p-3 bg-white border border-emerald-100 rounded-xl">
                                <p className="text-slate-800 text-[15px] sm:text-[16px] leading-[1.6] whitespace-pre-line font-medium">
                                    {typeof item.analysis === 'string'
                                        ? item.analysis.replace(/\\n/g, '\n').split(/(\*\*.*?\*\*)/).map((part, i) =>
                                            part.startsWith('**') && part.endsWith('**')
                                                ? <strong key={i} className="text-emerald-800 font-extrabold">{part.slice(2, -2)}</strong>
                                                : part
                                        )
                                        : null
                                    }
                                </p>
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
});

export default TranscriptItem;
