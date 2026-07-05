import {
    Upload, Volume2, Settings, Star, Smartphone, HardDrive, Cloud
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
    cacheKeys, loadCache, deleteLocal, deleteServer, clearLocalCache, localVideoIds = new Set(),
    isFavorite = () => false, toggleFavorite = () => {},
    cloudItems = [], loadCloud
}) => {
    // 즐겨찾기 우선 정렬: 별표한 항목을 맨 위로
    const favKeys = cacheKeys.filter(k => isFavorite(favIdFromKey(k)));
    const restKeys = cacheKeys.filter(k => !isFavorite(favIdFromKey(k)));

    // 클라우드 항목 중 로컬에 없는 것(로컬에 있으면 로컬 행으로 표시됨)을 즐겨찾기/일반으로 분리.
    // → 홈 화면도 목록(History)과 동일하게 클라우드 전용 항목까지 모두 노출.
    const localIdSet = new Set(cacheKeys.map(favIdFromKey));
    const cloudOnlyItems = (cloudItems || []).filter(it => !localIdSet.has(favIdFromItem(it)));
    const favCloudItems = cloudOnlyItems.filter(it => isFavorite(favIdFromItem(it)));
    const restCloudItems = cloudOnlyItems.filter(it => !isFavorite(favIdFromItem(it)));
    const hasAnyItems = cacheKeys.length > 0 || cloudOnlyItems.length > 0;
    // id → 클라우드 항목 (로컬 행에서 서버 삭제 버튼 표시 여부 판단)
    const cloudById = new Map((cloudItems || []).map(it => [favIdFromItem(it), it]));

    // 로컬/서버 삭제 버튼 (카드 하단 공통 — 라벨 포함, 모바일에서도 항상 보임)
    const renderDeleteButtons = (recForDelete, localHere, cloudItem) => {
        if (!localHere && !cloudItem) return null;
        return (
            <div className="flex items-center justify-end gap-1.5 mt-2 pt-2 border-t border-slate-100">
                {localHere && (
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteLocal(recForDelete); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="이 기기에서 삭제 (로컬 캐시)"
                    >
                        <HardDrive size={14} /> 기기에서 삭제
                    </button>
                )}
                {cloudItem && (
                    <button
                        onClick={(e) => { e.stopPropagation(); deleteServer(recForDelete); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="서버에서 삭제 (모든 기기)"
                    >
                        <Cloud size={14} /> 서버에서 삭제
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
                className={`shrink-0 p-2 rounded-xl transition-all ${fav ? 'text-amber-400 hover:bg-amber-50' : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50'}`}
                title={fav ? '즐겨찾기 해제' : '즐겨찾기'}
            >
                <Star size={18} className={fav ? 'fill-current' : ''} />
            </button>
        );
    };

    // 로컬 캐시 항목 1행 (이 기기에 저장됨 → 초록 테두리)
    const renderRow = (key) => {
        const id = favIdFromKey(key);
        const display = getCacheDisplayName(key).replace(/\.[^.]+$/, '');
        const cloudItem = cloudById.get(id) || null;
        const recForDelete = { displayName: display, localKey: key, cloudItem };
        return (
            <div
                key={key}
                onClick={() => loadCache(key)}
                className="flex flex-col bg-white border border-emerald-300 p-3 rounded-2xl shadow-sm hover:border-emerald-400 hover:shadow-md hover:shadow-emerald-50 transition-all cursor-pointer text-left"
            >
                <div className="flex items-start gap-3 min-w-0">
                    <div className="shrink-0 w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500">
                        <Volume2 size={17} />
                    </div>
                    <span className="flex-1 min-w-0 text-sm font-bold text-slate-700 break-words leading-snug">{display}</span>
                    {renderStar(id)}
                </div>
                {renderDeleteButtons(recForDelete, true, cloudItem)}
            </div>
        );
    };

    // 클라우드 즐겨찾기 항목 1행 (다른 기기에서 별표한 것 — 처음 화면 즐겨찾기에만 노출)
    const renderCloudRow = (item) => {
        const id = favIdFromItem(item);
        const display = (item.name || 'Untitled').replace(/\.[^.]+$/, '');
        const localHere = localVideoIds.has(id);
        const recForDelete = { displayName: display, localKey: null, cloudItem: item };
        const borderCls = localHere
            ? 'border-emerald-300 hover:border-emerald-400 hover:shadow-emerald-50'
            : 'border-slate-100 hover:border-sky-300 hover:shadow-sky-50';
        return (
            <div
                key={item.folder}
                onClick={() => loadCloud && loadCloud(item)}
                className={`flex flex-col bg-white border p-3 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer text-left ${borderCls}`}
            >
                <div className="flex items-start gap-3 min-w-0">
                    <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${localHere ? 'bg-emerald-50 text-emerald-500' : 'bg-sky-50 text-sky-500'}`}>
                        {localHere ? <Volume2 size={17} /> : <Smartphone size={17} />}
                    </div>
                    <span className="flex-1 min-w-0 text-sm font-bold text-slate-700 break-words leading-snug">{display}</span>
                    {renderStar(id)}
                </div>
                {renderDeleteButtons(recForDelete, localHere, item)}
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
                        {!hasAnyItems ? (
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
                                {restCloudItems.map(renderCloudRow)}
                            </>
                        )}
                    </div>
                    {cacheKeys.length > 0 && clearLocalCache && (
                        <button
                            onClick={clearLocalCache}
                            className="text-xs font-bold text-slate-400 hover:text-emerald-600 transition-colors flex items-center gap-1 mx-auto"
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
