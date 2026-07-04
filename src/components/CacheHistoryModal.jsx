import { useMemo, useState } from 'react';
import {
    X, Upload, Search, FileVideo, BookOpen, Check, Clock, Trash2, Smartphone, Star, MoreVertical
} from 'lucide-react';
import { getCacheStatus, getCacheDisplayName } from '../utils/cacheStatus';

// 즐겨찾기/통합 식별자: "{name}_{size}" (로컬 캐시 키/클라우드 항목 공통)
const favIdFromKey = (key) => key.replace('gemini_analysis_', '');
const favIdFromItem = (item) => `${item.name}_${item.size}`;
const stripExt = (n) => (n || '').replace(/\.[^.]+$/, '');

const CacheHistoryModal = ({
    cacheKeys, files, activeFile, activeFileId, searchQuery, setSearchQuery,
    loadCache, deleteRecording, clearAllCache, processFiles, removeFile,
    setActiveFileId, cloudItems = [], loadCloud,
    isFavorite = () => false, toggleFavorite = () => {}, onClose
}) => {
    const [menuOpenId, setMenuOpenId] = useState(null);

    const analyzingFiles = useMemo(() => files.filter(f => f.isAnalyzing), [files]);

    // 로컬 + 클라우드를 "{name}_{size}" 기준으로 하나로 병합 (같은 녹음은 한 줄)
    const records = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const map = new Map();
        cacheKeys.forEach(key => {
            const id = favIdFromKey(key);
            map.set(id, { id, localKey: key, cloudItem: null });
        });
        (cloudItems || []).forEach(it => {
            const id = favIdFromItem(it);
            const ex = map.get(id);
            if (ex) ex.cloudItem = it;
            else map.set(id, { id, localKey: null, cloudItem: it });
        });

        const arr = [];
        for (const rec of map.values()) {
            const name = rec.localKey ? getCacheDisplayName(rec.localKey) : (rec.cloudItem?.name || 'Untitled');
            if (q && !name.toLowerCase().includes(q)) continue;
            arr.push({ ...rec, name });
        }
        // 로컬에 있는 것 우선 → 이름순
        arr.sort((a, b) => {
            const al = a.localKey ? 0 : 1, bl = b.localKey ? 0 : 1;
            if (al !== bl) return al - bl;
            return a.name.localeCompare(b.name);
        });
        return arr;
    }, [cacheKeys, cloudItems, searchQuery]);

    const favRecords = useMemo(() => records.filter(r => isFavorite(r.id)), [records, isFavorite]);
    const restRecords = useMemo(() => records.filter(r => !isFavorite(r.id)), [records, isFavorite]);

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

    // 통합 항목 1행
    const renderRecordRow = (rec) => {
        const hasLocal = !!rec.localKey;
        const hasCloud = !!rec.cloudItem;
        const display = stripExt(rec.name);
        const isActive = activeFile?.file?.name === rec.name;

        // 상태 뱃지
        let statusText, statusCls, progressText = null;
        if (hasLocal) {
            const s = getCacheStatus(rec.localKey);
            statusText = s.statusText; statusCls = s.badgeColor; progressText = s.progressText;
        } else {
            const done = rec.cloudItem.status === 'completed';
            statusText = done ? '분석 완료' : '전사 완료';
            statusCls = done ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600';
        }

        // 저장 위치 뱃지
        const where = hasLocal && hasCloud
            ? { text: '이 기기 · 클라우드', cls: 'bg-indigo-50 text-indigo-500' }
            : hasCloud
                ? { text: '클라우드', cls: 'bg-sky-50 text-sky-500' }
                : { text: '이 기기만', cls: 'bg-amber-50 text-amber-600' };

        const open = () => { if (hasLocal) loadCache(rec.localKey); else loadCloud && loadCloud(rec.cloudItem); };

        return (
            <div
                key={rec.id}
                onClick={open}
                className={`group flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all mb-2 ${isActive
                    ? 'bg-indigo-50 border-indigo-200 shadow-md shadow-indigo-100'
                    : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}
            >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className={`p-2.5 rounded-xl ${isActive ? 'bg-indigo-600 text-white' : hasLocal ? 'bg-slate-100 text-slate-500' : 'bg-sky-50 text-sky-500'}`}>
                        {isActive ? <Check size={20} /> : hasLocal ? <BookOpen size={20} /> : <Smartphone size={20} />}
                    </div>
                    <div className="min-w-0">
                        <p className={`text-base font-bold line-clamp-3 break-all ${isActive ? 'text-indigo-900' : 'text-slate-700'}`}>{display}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] tracking-tight ${statusCls}`}>{statusText}</span>
                            {progressText && <span className="text-[10px] font-medium text-slate-400">{progressText}</span>}
                            <span className={`px-2 py-0.5 rounded-full text-[10px] tracking-tight ${where.cls}`}>{where.text}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1 pl-2 border-l border-slate-100/50 ml-2">
                    {renderStar(rec.id)}
                    <div className="relative">
                        <button
                            onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === rec.id ? null : rec.id); }}
                            className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
                            title="삭제 옵션"
                        >
                            <MoreVertical size={20} />
                        </button>
                        {menuOpenId === rec.id && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); }} />
                                <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-white rounded-xl shadow-xl border border-slate-100 py-1 overflow-hidden">
                                    {hasLocal && hasCloud && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); deleteRecording({ displayName: display, localKey: rec.localKey, cloudItem: rec.cloudItem }, 'local'); }}
                                            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 text-left"
                                        >
                                            <Trash2 size={15} /> 이 기기에서 내리기
                                        </button>
                                    )}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); deleteRecording({ displayName: display, localKey: rec.localKey, cloudItem: rec.cloudItem }, hasCloud ? 'all' : 'local'); }}
                                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 text-left"
                                    >
                                        <Trash2 size={15} /> {hasCloud ? '완전 삭제 (모든 기기)' : '삭제'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
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

                    {analyzingFiles.length === 0 && records.length === 0 ? (
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
                                                <p className="text-base font-bold line-clamp-3 break-all text-indigo-900">{stripExt(f.file.name)}</p>
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

                            {/* 2. 즐겨찾기 */}
                            {favRecords.length > 0 && (
                                <div className="pt-3 pb-1">
                                    <div className="flex items-center gap-2 px-1 text-amber-500">
                                        <Star size={14} className="fill-current" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider">즐겨찾기</span>
                                    </div>
                                </div>
                            )}
                            {favRecords.map(renderRecordRow)}

                            {/* 3. 라이브러리 (즐겨찾기 제외) */}
                            {favRecords.length > 0 && restRecords.length > 0 && (
                                <div className="pt-3 pb-1">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">라이브러리</span>
                                </div>
                            )}
                            {restRecords.map(renderRecordRow)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CacheHistoryModal;
