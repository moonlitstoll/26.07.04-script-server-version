import {
    Upload, Volume2, Settings, Star, Smartphone, HardDrive, Cloud
} from 'lucide-react';
import SettingsModal from './SettingsModal';
import { getCacheDisplayName } from '../utils/cacheStatus';
import { readRecent, sortByRecent } from '../utils/recentOpen';

const favIdFromKey = (key) => key.replace('gemini_analysis_', '');
const favIdFromItem = (item) => `${item.name}_${item.size}`;

const EmptyState = ({
    isDragging, onDragOver, onDragLeave, onDrop,
    processFiles,
    showSettings, setShowSettings,
    config, updateField, onLockVault,
    cacheKeys, loadCache, deleteLocal, deleteServer, clearLocalCache, localVideoIds = new Set(),
    isFavorite = () => false, toggleFavorite = () => {},
    cloudItems = [], cloudStatus = null, loadCloud
}) => {
    // 즐겨찾기 우선 정렬: 별표한 항목을 맨 위로. 각 묶음 안에서는 마지막으로 열었거나 별을 누른 영상이 맨 위.
    const recent = readRecent();
    const favKeys = sortByRecent(cacheKeys.filter(k => isFavorite(favIdFromKey(k))), favIdFromKey, recent);
    const restKeys = sortByRecent(cacheKeys.filter(k => !isFavorite(favIdFromKey(k))), favIdFromKey, recent);

    // 클라우드 항목 중 로컬에 없는 것(로컬에 있으면 로컬 행으로 표시됨)을 즐겨찾기/일반으로 분리.
    // → 홈 화면도 목록(History)과 동일하게 클라우드 전용 항목까지 모두 노출.
    const localIdSet = new Set(cacheKeys.map(favIdFromKey));
    const cloudOnlyItems = (cloudItems || []).filter(it => !localIdSet.has(favIdFromItem(it)));
    const favCloudItems = sortByRecent(cloudOnlyItems.filter(it => isFavorite(favIdFromItem(it))), favIdFromItem, recent);
    const restCloudItems = sortByRecent(cloudOnlyItems.filter(it => !isFavorite(favIdFromItem(it))), favIdFromItem, recent);
    const hasAnyItems = cacheKeys.length > 0 || cloudOnlyItems.length > 0;
    // id → 클라우드 항목 (로컬 행에서 서버 삭제 버튼 표시 여부 판단)
    const cloudById = new Map((cloudItems || []).map(it => [favIdFromItem(it), it]));

    // 로컬/서버 삭제 버튼 (카드 우측 인라인 — 아이콘만, 컴팩트)
    const renderDeleteButtons = (recForDelete, localHere, cloudItem) => {
        if (!localHere && !cloudItem) return null;
        return (
            <div className="flex items-center gap-0.5 shrink-0">
                {localHere && (
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteLocal(recForDelete); }}
                        className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-all"
                        title="이 기기에서 삭제 (로컬 캐시)"
                    >
                        <HardDrive size={15} />
                    </button>
                )}
                {cloudItem && (
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteServer(recForDelete); }}
                        className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-all"
                        title="서버에서 삭제 (모든 기기)"
                    >
                        <Cloud size={15} />
                    </button>
                )}
            </div>
        );
    };

    const renderStar = (id) => {
        const fav = isFavorite(id);
        return (
            <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
                className={`shrink-0 p-1.5 rounded-lg transition-all ${fav ? 'text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40' : 'text-slate-300 dark:text-slate-600 hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'}`}
                title={fav ? '즐겨찾기 해제' : '즐겨찾기'}
            >
                <Star size={16} className={fav ? 'fill-current' : ''} />
            </button>
        );
    };

    // 로컬 캐시 항목 1행 (이 기기에 저장됨 → 초록 테두리) — 1줄 컴팩트
    const renderRow = (key) => {
        const id = favIdFromKey(key);
        const display = getCacheDisplayName(key).replace(/\.[^.]+$/, '');
        const cloudItem = cloudById.get(id) || null;
        const recForDelete = { displayName: display, localKey: key, cloudItem };
        return (
            <div
                key={key}
                onClick={() => loadCache(key)}
                className="flex items-center gap-2.5 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 px-3 py-2 rounded-xl shadow-sm hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-50 dark:hover:shadow-black/40 transition-all cursor-pointer text-left"
            >
                <div className="shrink-0 w-7 h-7 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg flex items-center justify-center text-emerald-500 dark:text-emerald-400">
                    <Volume2 size={15} />
                </div>
                <span className="flex-1 min-w-0 text-sm font-bold text-slate-700 dark:text-slate-300 break-words leading-snug">{display}</span>
                {renderStar(id)}
                {renderDeleteButtons(recForDelete, true, cloudItem)}
            </div>
        );
    };

    // 클라우드 즐겨찾기 항목 1행 (다른 기기에서 별표한 것) — 1줄 컴팩트
    const renderCloudRow = (item) => {
        const id = favIdFromItem(item);
        const display = (item.name || 'Untitled').replace(/\.[^.]+$/, '');
        const localHere = localVideoIds.has(id);
        const recForDelete = { displayName: display, localKey: null, cloudItem: item };
        const borderCls = localHere
            ? 'border-emerald-300 dark:border-emerald-700 hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-emerald-50 dark:hover:shadow-black/40'
            : 'border-slate-100 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-sky-50 dark:hover:shadow-black/40';
        return (
            <div
                key={item.folder}
                onClick={() => loadCloud && loadCloud(item)}
                className={`flex items-center gap-2.5 bg-white dark:bg-slate-800 border px-3 py-2 rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer text-left ${borderCls}`}
            >
                <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${localHere ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 dark:text-emerald-400' : 'bg-sky-50 dark:bg-sky-950/40 text-sky-500 dark:text-sky-400'}`}>
                    {localHere ? <Volume2 size={15} /> : <Smartphone size={15} />}
                </div>
                <span className="flex-1 min-w-0 text-sm font-bold text-slate-700 dark:text-slate-300 break-words leading-snug">{display}</span>
                {renderStar(id)}
                {renderDeleteButtons(recForDelete, localHere, item)}
            </div>
        );
    };

    return (
        <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className="min-h-screen bg-[#F8FAFC] dark:bg-slate-900 flex flex-col items-center justify-center p-4 relative"
        >
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm flex items-center justify-center p-10 border-4 border-indigo-500 border-dashed m-4 rounded-3xl">
                    <h2 className="text-4xl font-bold text-indigo-600 dark:text-indigo-400 animate-bounce">Drop Files Here!</h2>
                </div>
            )}

            <button onClick={() => setShowSettings(true)} aria-label="설정 열기" className="absolute top-6 right-6 p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                <Settings size={24} />
            </button>

            {showSettings && (
                <SettingsModal
                    config={config}
                    updateField={updateField}
                    onLockVault={onLockVault}
                    onClose={() => setShowSettings(false)}
                />
            )}

            <div className="max-w-xl w-full text-center space-y-4 animate-in fade-in zoom-in duration-500">
                <div className="flex items-center justify-center gap-2.5">
                    <div className="inline-flex items-center justify-center p-2 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl ring-1 ring-indigo-100 dark:ring-indigo-900">
                        <Volume2 size={22} className="text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                        Media<span className="text-indigo-600 dark:text-indigo-400">Smart</span> Analyzer
                    </h1>
                </div>

                {!config.apiKey && (
                    <button
                        onClick={() => setShowSettings(true)}
                        className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-all text-left"
                    >
                        <Settings size={18} className="shrink-0 text-amber-500 dark:text-amber-400" />
                        <span className="text-sm font-bold leading-tight">Gemini API 키를 먼저 설정하세요 — 클릭해서 설정 열기</span>
                    </button>
                )}

                <div className="group relative flex items-center gap-3.5 px-5 py-3.5 rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-white dark:hover:bg-slate-700 bg-white/60 dark:bg-slate-800/60 text-left">
                    <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => processFiles(e.target.files)} accept="audio/*,video/*" />
                    <div className="shrink-0 p-2.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl group-hover:scale-110 transition-transform">
                        <Upload size={22} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base leading-tight">파일 업로드 (Drag & Drop)</h3>
                        <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">클릭하거나 끌어놓기 · 여러 파일 지원</p>
                    </div>
                </div>

                {/* Cached Transcripts Section */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2.5 text-sm flex items-center justify-center gap-2">
                        <Settings size={14} className="text-indigo-500 dark:text-indigo-400" />
                        최근 작업 히스토리
                    </h4>
                    {/* 클라우드 조회 상태 (동기화 확인용) */}
                    {cloudStatus && (cloudStatus.error || cloudStatus.count > 0) && (
                        <div className={`mb-2 mx-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${cloudStatus.error ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400' : 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400'}`}>
                            <Cloud size={12} />
                            {cloudStatus.error ? `클라우드 오류: ${cloudStatus.error}`
                                : `클라우드 ${cloudStatus.count}개 (다른기기 ${cloudOnlyItems.length}개)`}
                        </div>
                    )}
                    <div className="space-y-1.5 max-h-[calc(100vh-320px)] min-h-[45vh] overflow-y-auto mb-3 pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                        {!hasAnyItems ? (
                            <div className="bg-slate-50/50 dark:bg-slate-900/50 rounded-2xl p-8 border border-slate-100 dark:border-slate-700">
                                <p className="text-sm text-slate-400 dark:text-slate-500">저장된 기록이 없습니다.</p>
                            </div>
                        ) : (
                            <>
                                {(favKeys.length > 0 || favCloudItems.length > 0) && (
                                    <div className="flex items-center justify-center gap-1.5 text-amber-500 dark:text-amber-400 pt-1 pb-0.5">
                                        <Star size={12} className="fill-current" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider">즐겨찾기</span>
                                    </div>
                                )}
                                {favKeys.map(renderRow)}
                                {favCloudItems.map(renderCloudRow)}
                                {restKeys.map(renderRow)}
                                {restCloudItems.map(renderCloudRow)}
                            </>
                        )}
                    </div>
                    {cacheKeys.length > 0 && clearLocalCache && (
                        <button
                            onClick={clearLocalCache}
                            className="text-xs font-bold text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center gap-1 mx-auto"
                        >
                            <HardDrive size={12} /> 이 기기 캐시 비우기
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EmptyState;
