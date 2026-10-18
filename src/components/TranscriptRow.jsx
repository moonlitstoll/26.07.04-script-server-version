import { Star, Trash2, Cloud, FileAudio, FileVideo, Check } from 'lucide-react';

// 저장된 대본 한 줄 — 첫 화면(EmptyState)과 기록 창(CacheHistoryModal)이 같이 쓴다.
// 예전엔 두 곳이 따로 그려서 첫 화면은 이름만(전부 초록 테두리), 기록 창은 완료/멈춤·문장 수까지 보였다 —
// 분석이 멈춘 영상이 첫 화면에선 완료처럼 보였다(2차 점검 P1). 지금은 한 부품이라 정보가 같다.
//   kind: 'audio' | 'video' | 'cloud'(이 기기에 없고 서버에만)
//   status: { statusText, badgeColor, progressText } (cacheStatus.js 모양 — isVideoName·cloudStatusOf도 거기) — 없으면 배지 줄 생략
const ICON_BTN = 'p-1.5 rounded-lg transition-all';

export default function TranscriptRow({
    display, kind = 'audio', active = false, localHere = true, status = null,
    fav = false, onOpen, onToggleFav, onDeleteLocal, onDeleteServer,
}) {
    const border = active
        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 shadow-md shadow-indigo-100 dark:shadow-black/40'
        : localHere
            ? 'bg-white dark:bg-slate-800 border-emerald-300 dark:border-emerald-700 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/25'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-slate-50 dark:hover:bg-slate-700';
    const iconBox = active
        ? 'bg-indigo-600 text-white'
        : localHere
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
            : 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400';
    const Icon = active ? Check : kind === 'cloud' ? Cloud : kind === 'video' ? FileVideo : FileAudio;
    const iconTitle = active ? '지금 열림' : kind === 'cloud' ? '서버에만 있음 (열면 내려받음)' : kind === 'video' ? '영상' : '소리';

    return (
        <div
            onClick={onOpen}
            className={`group flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-all text-left ${border}`}
        >
            <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${iconBox}`} title={iconTitle}>
                <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold break-words leading-snug ${active ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-300'}`}>{display}</p>
                {status && (
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded-full text-[11px] tracking-tight ${status.badgeColor}`}>{status.statusText}</span>
                        {status.progressText && <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{status.progressText}</span>}
                    </div>
                )}
            </div>
            <div className="shrink-0 flex items-center gap-0.5">
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleFav && onToggleFav(); }}
                    className={`${ICON_BTN} ${fav ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40' : 'text-slate-300 dark:text-slate-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'}`}
                    title={fav ? '즐겨찾기 해제' : '즐겨찾기'}
                    aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기'}
                    aria-pressed={fav}
                >
                    <Star size={16} className={fav ? 'fill-current' : ''} />
                </button>
                {localHere && onDeleteLocal && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDeleteLocal(); }}
                        className={`${ICON_BTN} text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}
                        title="이 기기에서 삭제"
                        aria-label="이 기기에서 삭제"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
                {onDeleteServer && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDeleteServer(); }}
                        className={`${ICON_BTN} text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}
                        title="서버에서 삭제 (모든 기기)"
                        aria-label="서버에서 삭제"
                    >
                        <Cloud size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
