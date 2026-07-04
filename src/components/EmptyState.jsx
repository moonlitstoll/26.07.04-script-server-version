import {
    Upload, Volume2, Settings, Trash2, Star, Smartphone
} from 'lucide-react';
import SettingsModal from './SettingsModal';
import { getCacheDisplayName } from '../utils/cacheStatus';

const favIdFromKey = (key) => key.replace('gemini_analysis_', '');
const favIdFromItem = (item) => `${item.name}_${item.size}`;

const EmptyState = ({
    isDragging, onDragOver, onDragLeave, onDrop,
    processFiles,
    showSettings, setShowSettings,
    config, updateField, onLockVault,
    cacheKeys, loadCache, deleteCache, clearAllCache,
    isFavorite = () => false, toggleFavorite = () => {},
    cloudItems = [], loadCloud
}) => {
    // 즐겨찾기 우선 정렬: 별표한 항목을 맨 위로
    const favKeys = cacheKeys.filter(k => isFavorite(favIdFromKey(k)));
    const restKeys = cacheKeys.filter(k => !isFavorite(favIdFromKey(k)));

    // 클라우드 즐겨찾기 (로컬에 이미 있는 건 로컬 즐겨찾기로 표시되므로 제외)
    const localIdSet = new Set(cacheKeys.map(favIdFromKey));
    const favCloudItems = (cloudItems || []).filter(
        it => isFavorite(favIdFromItem(it)) && !localIdSet.has(favIdFromItem(it))
    );

    const renderRow = (key) => {
        const name = getCacheDisplayName(key).replace(/\.[^.]+$/, '');
        const fav = isFavorite(favIdFromKey(key));
        return (
            <div
                key={key}
                onClick={() => loadCache(key)}
                className="flex items-center justify-between bg-white border border-slate-100 p-4 rounded-2xl shadow-sm hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-50 transition-all cursor-pointer group/item"
            >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover/item:bg-indigo-50 group-hover/item:text-indigo-500 transition-colors shrink-0">
                        <Volume2 size={18} />
                    </div>
                    <span className="text-sm font-bold text-slate-700 line-clamp-3 break-all">{name}</span>
                </div>
                <div className="flex items-center shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(favIdFromKey(key)); }}
                        className={`p-2 rounded-xl transition-all ${fav ? 'text-amber-400 hover:bg-amber-50' : 'text-slate-300 opacity-0 group-hover/item:opacity-100 hover:text-amber-400 hover:bg-amber-50'}`}
                        title={fav ? '즐겨찾기 해제' : '즐겨찾기'}
                    >
                        <Star size={18} className={fav ? 'fill-current' : ''} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteCache(key); }}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover/item:opacity-100"
                        title="Delete"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>
        );
    };

    // 클라우드 즐겨찾기 항목 1행 (다른 기기에서 별표한 것 — 처음 화면 즐겨찾기에만 노출)
    const renderCloudRow = (item) => {
        const name = (item.name || 'Untitled').replace(/\.[^.]+$/, '');
        return (
            <div
                key={item.folder}
                onClick={() => loadCloud && loadCloud(item)}
                className="flex items-center justify-between bg-white border border-slate-100 p-4 rounded-2xl shadow-sm hover:border-sky-300 hover:shadow-md hover:shadow-sky-50 transition-all cursor-pointer group/item"
            >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center text-sky-500 shrink-0">
                        <Smartphone size={18} />
                    </div>
                    <span className="text-sm font-bold text-slate-700 line-clamp-3 break-all">{name}</span>
                </div>
                <div className="flex items-center shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(favIdFromItem(item)); }}
                        className="p-2 text-amber-400 hover:bg-amber-50 rounded-xl transition-all"
                        title="즐겨찾기 해제"
                    >
                        <Star size={18} className="fill-current" />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6 relative"
        >
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm flex items-center justify-center p-10 border-4 border-indigo-500 border-dashed m-4 rounded-3xl">
                    <h2 className="text-4xl font-bold text-indigo-600 animate-bounce">Drop Files Here!</h2>
                </div>
            )}

            <button onClick={() => setShowSettings(true)} aria-label="설정 열기" className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
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

            <div className="max-w-4xl w-full text-center space-y-10 animate-in fade-in zoom-in duration-500">
                <div className="space-y-4">
                    <div className="inline-flex items-center justify-center p-3 bg-indigo-50 rounded-2xl ring-1 ring-indigo-100 mb-2">
                        <Volume2 size={28} className="text-indigo-600" />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
                        Media<span className="text-indigo-600">Smart</span> Analyzer
                    </h1>
                </div>

                <div className="max-w-3xl mx-auto group relative flex items-center gap-6 p-10 rounded-3xl border-2 border-dashed transition-all duration-300 cursor-pointer border-slate-200 hover:border-indigo-300 hover:bg-white bg-white/60">
                    <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => processFiles(e.target.files)} accept="audio/*,video/*" />
                    <div className="w-full flex flex-col items-center gap-4">
                        <div className="p-4 bg-indigo-100 text-indigo-600 rounded-2xl group-hover:scale-110 transition-transform">
                            <Upload size={32} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-xl">Drag & Drop Multiple Files</h3>
                            <p className="text-slate-500 mt-2">or click to browse</p>
                        </div>
                    </div>
                </div>

                {/* Cached Transcripts Section (Restored) */}
                <div className="max-w-xl mx-auto pt-6 border-t border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-4 text-sm flex items-center justify-center gap-2">
                        <Settings size={14} className="text-indigo-500" />
                        최근 작업 히스토리
                    </h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto mb-4 pr-1 scrollbar-thin scrollbar-thumb-slate-200">
                        {cacheKeys.length === 0 && favCloudItems.length === 0 ? (
                            <div className="bg-slate-50/50 rounded-2xl p-8 border border-slate-100">
                                <p className="text-sm text-slate-400">저장된 기록이 없습니다.</p>
                            </div>
                        ) : (
                            <>
                                {(favKeys.length > 0 || favCloudItems.length > 0) && (
                                    <div className="flex items-center justify-center gap-1.5 text-amber-500 pt-1 pb-0.5">
                                        <Star size={12} className="fill-current" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider">즐겨찾기</span>
                                    </div>
                                )}
                                {favKeys.map(renderRow)}
                                {favCloudItems.map(renderCloudRow)}
                                {restKeys.map(renderRow)}
                            </>
                        )}
                    </div>
                    {cacheKeys.length > 0 && (
                        <button
                            onClick={clearAllCache}
                            className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1 mx-auto"
                        >
                            <Trash2 size={12} /> 히스토리 전체 삭제
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EmptyState;
