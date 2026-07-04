import { useMemo } from 'react';
import {
    X, Upload, Search, FileVideo, BookOpen, Check, Clock, Trash2, Cloud, Smartphone, Star
} from 'lucide-react';
import { getCacheStatus, getCacheDisplayName } from '../utils/cacheStatus';

// 즐겨찾기 식별자: "{name}_{size}" (로컬 캐시 키/클라우드 항목 공통)
const favIdFromKey = (key) => key.replace('gemini_analysis_', '');
const favIdFromItem = (item) => `${item.name}_${item.size}`;

const CacheHistoryModal = ({
    cacheKeys, files, activeFile, activeFileId, searchQuery, setSearchQuery,
    loadCache, deleteCache, clearAllCache, processFiles, removeFile,
    setActiveFileId, cloudItems = [], loadCloud, deleteCloud,
    isFavorite = () => false, toggleFavorite = () => {}, onClose
}) => {
    const analyzingFiles = useMemo(() => files.filter(f => f.isAnalyzing), [files]);
    const sortedFilteredCacheKeys = useMemo(() =>
        cacheKeys
            .filter(key => key.toLowerCase().includes(searchQuery.toLowerCase()))
            .sort().reverse(),
        [cacheKeys, searchQuery]
    );

    // 로컬에 이미 있는 항목은 클라우드 섹션에서 제외 (중복 방지)
    const localKeySet = useMemo(() =>
        new Set(cacheKeys.map(k => k.replace('gemini_analysis_', ''))),
        [cacheKeys]
    );
    const cloudOnlyItems = useMemo(() =>
        (cloudItems || [])
            .filter(it => !localKeySet.has(`${it.name}_${it.size}`))
            .filter(it => (it.name || '').toLowerCase().includes(searchQuery.toLowerCase()))
            .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)),
        [cloudItems, localKeySet, searchQuery]
    );

    // 즐겨찾기 / 일반 분리
    const favLocalKeys = useMemo(() => sortedFilteredCacheKeys.filter(k => isFavorite(favIdFromKey(k))), [sortedFilteredCacheKeys, isFavorite]);
    const restLocalKeys = useMemo(() => sortedFilteredCacheKeys.filter(k => !isFavorite(favIdFromKey(k))), [sortedFilteredCacheKeys, isFavorite]);
    const favCloudItems = useMemo(() => cloudOnlyItems.filter(it => isFavorite(favIdFromItem(it))), [cloudOnlyItems, isFavorite]);
    const restCloudItems = useMemo(() => cloudOnlyItems.filter(it => !isFavorite(favIdFromItem(it))), [cloudOnlyItems, isFavorite]);
    const hasFavorites = favLocalKeys.length > 0 || favCloudItems.length > 0;

    // 별표 버튼 (행 우측 공통)
    const renderStar = (id) => {
        const fav = isFavorite(id);
        return (
            <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
                className={`p-2.5 rounded-xl transition-all ${fav ? 'text-amber-400 hover:bg-amber-50' : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50'}`}
                title={fav ? '즐겨찾기 해제' : '즐겨찾기'}
            >
                <Star size={20} className={fav ? 'fill-current' : ''} />
            </button>
        );
    };

    // 로컬 캐시 항목 1행
    const renderCachedRow = (key) => {
        const name = getCacheDisplayName(key);
        const isActiveCached = activeFile?.file?.name === name;
        const { statusText, badgeColor, progressText } = getCacheStatus(key);
        return (
            <div
                key={key}
                className={`group flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all mb-2 ${isActiveCached
                    ? 'bg-indigo-50 border-indigo-200 shadow-md shadow-indigo-100'
                    : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}
                onClick={() => loadCache(key)}
            >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className={`p-2.5 rounded-xl ${isActiveCached ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {isActiveCached ? <Check size={20} /> : <BookOpen size={20} />}
                    </div>
                    <div className="min-w-0">
                        <p className={`text-base font-bold line-clamp-3 break-all ${isActiveCached ? 'text-indigo-900' : 'text-slate-700'}`}>{name.replace(/\.[^.]+$/, '')}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] tracking-tight ${badgeColor}`}>{statusText}</span>
                            {progressText && (
                                <span className="text-[10px] font-medium text-slate-400">{progressText}</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1 pl-2 border-l border-slate-100/50 ml-2">
                    {renderStar(favIdFromKey(key))}
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteCache(key); }}
                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="Delete Analysis"
                    >
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>
        );
    };

    // 클라우드(다른 기기) 항목 1행
    const renderCloudRow = (item) => {
        const displayName = (item.name || 'Untitled').replace(/\.[^.]+$/, '');
        const isDone = item.status === 'completed';
        return (
            <div
                key={item.folder}
                onClick={() => loadCloud && loadCloud(item)}
                className="group flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all mb-2 bg-white border-slate-200 hover:border-sky-300 hover:bg-sky-50/40"
            >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="p-2.5 rounded-xl bg-sky-50 text-sky-500">
                        <Smartphone size={20} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-base font-bold line-clamp-3 break-all text-slate-700">{displayName}</p>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] tracking-tight ${isDone ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                {isDone ? '분석 완료' : '전사 완료'}
                            </span>
                            <span className="text-[10px] font-medium text-slate-400">
                                {item.mediaUrl ? '영상 포함' : '대본만'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1 pl-2 border-l border-slate-100/50 ml-2">
                    {renderStar(favIdFromItem(item))}
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteCloud && deleteCloud(item); }}
                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="클라우드에서 삭제"
                    >
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[95vh] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
                <div className="p-3 px-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white z-10">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={clearAllCache}
                            aria-label="전체 기록 삭제"
                            className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors text-sm font-bold"
                        >
                            <Trash2 size={16} /> Clear All History
                        </button>
                    </div>
                    <button onClick={onClose} aria-label="닫기" className="p-2 hover:bg-red-50 hover:text-red-500 rounded-xl transition-colors">
                        <X size={24} className="text-slate-400 hover:text-red-500" />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50">

                    {/* Controls Area */}
                    <div className="p-3 sm:p-4 space-y-3">
                        {/* Upload Button */}
                        <div className="relative">
                            <label
                                htmlFor="manager-file-upload"
                                className="flex items-center justify-center gap-3 w-full p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl cursor-pointer shadow-lg shadow-indigo-200 transition-all group"
                            >
                                <div className="p-2 bg-white/20 rounded-lg group-hover:scale-110 transition-transform">
                                    <Upload size={24} />
                                </div>
                                <div>
                                    <span className="block text-lg font-bold">Upload New File</span>
                                    <span className="text-xs text-indigo-200">Audio or Video support</span>
                                </div>
                            </label>
                            <input
                                id="manager-file-upload"
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                    const selectedFiles = e.target.files;
                                    if (selectedFiles && selectedFiles.length > 0) {
                                        processFiles(selectedFiles);
                                        e.target.value = '';
                                        onClose();
                                    }
                                }}
                                accept="audio/*,video/*"
                            />
                        </div>

                        {/* Search Bar */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                            <input
                                type="text"
                                placeholder="Search analysis history..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-12 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-sm"
                            />
                        </div>
                    </div>

                    {analyzingFiles.length === 0 && sortedFilteredCacheKeys.length === 0 && cloudOnlyItems.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Clock size={48} className="mx-auto mb-4 opacity-20" />
                            <p className="text-lg font-medium">No history found</p>
                            <p className="text-sm">Upload a file to start analyzing</p>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 space-y-2">
                            {/* 1. Analyzing Files */}
                            {analyzingFiles.map(f => {
                                const isActive = activeFileId === f.id;
                                return (
                                    <div
                                        key={f.id}
                                        onClick={() => { setActiveFileId(f.id); onClose(); }}
                                        className={`group flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${isActive
                                            ? 'bg-indigo-100 border-indigo-300 shadow-md'
                                            : 'bg-indigo-50/50 border-indigo-200 hover:bg-indigo-100/50 hover:border-indigo-300'}`}
                                    >
                                        <div className="flex items-center gap-4 min-w-0 flex-1">
                                            <div className={`p-2.5 rounded-xl ${isActive ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-600'} animate-pulse`}>
                                                <FileVideo size={20} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-base font-bold line-clamp-3 break-all text-indigo-900">{f.file.name.replace(/\.[^.]+$/, '')}</p>
                                                <p className={`text-xs font-medium mt-0.5 animate-pulse ${isActive ? 'text-indigo-700' : 'text-indigo-600'}`}>
                                                    {f.data && f.data.length > 0
                                                        ? `Analyzing (${f.data.filter(d => d.isAnalyzed).length}/${f.data.length})...`
                                                        : "Extracting Transcript..."
                                                    }
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 pl-4 border-l border-indigo-100 ml-4">
                                            <div className="hidden sm:flex items-center gap-2 mr-2">
                                                <div className={`w-2 h-2 rounded-full animate-ping ${isActive ? 'bg-indigo-700' : 'bg-indigo-500'}`} />
                                                <span className={`text-xs font-bold ${isActive ? 'text-indigo-700' : 'text-indigo-500'}`}>Processing</span>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); removeFile(f.id, e); }}
                                                className="p-2.5 text-indigo-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                                title="Cancel Analysis"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* 2. 즐겨찾기 (로컬 + 클라우드) */}
                            {hasFavorites && (
                                <div className="pt-3 pb-1">
                                    <div className="flex items-center gap-2 px-1 text-amber-500">
                                        <Star size={14} className="fill-current" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider">즐겨찾기</span>
                                    </div>
                                </div>
                            )}
                            {favLocalKeys.map(renderCachedRow)}
                            {favCloudItems.map(renderCloudRow)}

                            {/* 3. Cached Files (즐겨찾기 제외) */}
                            {restLocalKeys.map(renderCachedRow)}

                            {/* 4. Cloud Files (즐겨찾기 제외) */}
                            {restCloudItems.length > 0 && (
                                <div className="pt-3 pb-1">
                                    <div className="flex items-center gap-2 px-1 text-slate-400">
                                        <Cloud size={14} />
                                        <span className="text-[11px] font-bold uppercase tracking-wider">다른 기기 (클라우드)</span>
                                    </div>
                                </div>
                            )}
                            {restCloudItems.map(renderCloudRow)}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default CacheHistoryModal;
