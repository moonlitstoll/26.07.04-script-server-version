import { useMemo } from 'react';
import {
    X, Upload, Search, FileVideo, Clock, Star, Trash2
} from 'lucide-react';
import TranscriptRow from './TranscriptRow';
import { getCacheStatus, getCacheDisplayName, isVideoName, cloudStatusOf } from '../utils/cacheStatus';
import { readRecent, sortByRecent } from '../utils/recentOpen';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

// 즐겨찾기/통합 식별자: "{name}_{size}" (로컬 캐시 키/클라우드 항목 공통)
const favIdFromKey = (key) => key.replace('gemini_analysis_', '');
const favIdFromItem = (item) => `${item.name}_${item.size}`;
const stripExt = (n) => (n || '').replace(/\.[^.]+$/, '');

const CacheHistoryModal = ({
    cacheKeys, files, activeFile, activeFileId, searchQuery, setSearchQuery,
    loadCache, deleteLocal, deleteServer, clearLocalCache, localVideoIds = new Set(),
    runningKeys = new Set(), // `${name}_${size}` — 지금 전사·분석이 도는 영상(배지 깜박임은 이때만)
    processFiles, removeFile,
    setActiveFileId, cloudItems = [], loadCloud,
    isFavorite = () => false, toggleFavorite = () => {}, onClose
}) => {
    useEscapeToClose(onClose);
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
            const name = rec.localKey ? getCacheDisplayName(rec.localKey) : (rec.cloudItem?.name || '이름 없음');
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

    // 각 묶음 안에서는 마지막으로 열었거나 별을 누른 영상이 맨 위(기록 없으면 위의 기본 순서).
    // 별을 누르면 isFavorite가 바뀌어 다시 계산된다.
    const [favRecords, restRecords] = useMemo(() => {
        const recent = readRecent();
        return [
            sortByRecent(records.filter(r => isFavorite(r.id)), r => r.id, recent),
            sortByRecent(records.filter(r => !isFavorite(r.id)), r => r.id, recent),
        ];
    }, [records, isFavorite]);

    // 통합 항목 1행 — 첫 화면과 같은 부품(TranscriptRow)
    const renderRecordRow = (rec) => {
        const display = stripExt(rec.name);
        const isActive = activeFile?.file?.name === rec.name;
        // 로컬에 영상(또는 로컬 대본)이 있으면 = 이 기기에 다운로드됨 → 초록 테두리
        const localHere = localVideoIds.has(rec.id) || !!rec.localKey;
        const status = rec.localKey
            ? getCacheStatus(rec.localKey, { running: runningKeys.has(rec.localKey.replace(/^gemini_analysis_/, '')) })
            : cloudStatusOf(rec.cloudItem);
        const recForDelete = { displayName: display, localKey: rec.localKey, cloudItem: rec.cloudItem };
        return (
            <TranscriptRow
                key={rec.id}
                display={display}
                kind={localHere ? (isVideoName(rec.name) ? 'video' : 'audio') : 'cloud'}
                active={isActive}
                localHere={localHere}
                status={status}
                fav={isFavorite(rec.id)}
                onOpen={() => { if (rec.localKey) loadCache(rec.localKey); else loadCloud && loadCloud(rec.cloudItem); }}
                onToggleFav={() => toggleFavorite(rec.id)}
                onDeleteLocal={localHere ? () => deleteLocal(recForDelete) : undefined}
                onDeleteServer={rec.cloudItem ? () => deleteServer(recForDelete) : undefined}
            />
        );
    };

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            {/* 높이: 휴대폰 90vh, PC 80vh(예전 95vh는 PC에서 과했다). 폭 상한은 대본 화면과 같은 3xl */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-3xl h-[90vh] sm:h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-3 px-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0 bg-white dark:bg-slate-800 z-10">
                    <h2 className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
                        <Clock size={18} className="text-indigo-500 dark:text-indigo-400" /> 저장된 대본
                    </h2>
                    <button onClick={onClose} aria-label="닫기" className="p-2 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-500 dark:hover:text-red-400 rounded-xl transition-colors">
                        <X size={24} className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400" />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50 dark:bg-slate-900/50">
                    {/* Controls Area — 검색이 주, 올리기는 보조(첫 화면에 큰 올리기 박스가 따로 있다). 대본 화면에서 새 파일을
                        올릴 수 있는 유일한 길이라 없애지는 않았다 */}
                    <div className="p-3 sm:p-4 flex items-center gap-2">
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                            <input
                                type="text"
                                placeholder="대본 이름으로 찾기"
                                aria-label="대본 이름으로 찾기"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all shadow-sm"
                            />
                        </div>
                        <label
                            htmlFor="manager-file-upload"
                            className="shrink-0 inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-sm font-bold cursor-pointer transition-colors"
                        >
                            <Upload size={16} /> 새 파일
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

                    {analyzingFiles.length === 0 && records.length === 0 ? (
                        <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                            <Clock size={48} className="mx-auto mb-4 opacity-20" />
                            <p className="text-lg font-medium">저장된 대본이 없어요</p>
                            <p className="text-sm">파일을 올리면 여기에 쌓입니다</p>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 space-y-1.5">
                            {/* 1. Analyzing Files */}
                            {analyzingFiles.map(f => {
                                const isActive = activeFileId === f.id;
                                return (
                                    <div
                                        key={f.id}
                                        onClick={() => { setActiveFileId(f.id); onClose(); }}
                                        className={`group flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${isActive
                                            ? 'bg-indigo-100 dark:bg-indigo-900/50 border-indigo-300 dark:border-indigo-700 shadow-md'
                                            : 'bg-indigo-50/50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/30 hover:border-indigo-300 dark:hover:border-indigo-700'}`}
                                    >
                                        <div className="flex items-center gap-4 min-w-0 flex-1">
                                            <div className={`p-2.5 rounded-xl ${isActive ? 'bg-indigo-600 text-white' : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'} animate-pulse`}>
                                                <FileVideo size={20} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[15px] font-bold break-words leading-snug text-indigo-900 dark:text-indigo-100">{stripExt(f.file.name)}</p>
                                                <p className={`text-xs font-medium mt-0.5 animate-pulse ${isActive ? 'text-indigo-700 dark:text-indigo-300' : 'text-indigo-600 dark:text-indigo-400'}`}>
                                                    {f.data && f.data.length > 0
                                                        ? `분석 중 (${f.data.filter(d => d.isAnalyzed).length}/${f.data.length})`
                                                        : '받아쓰는 중…'
                                                    }
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 pl-4 border-l border-indigo-100 dark:border-indigo-900 ml-4">
                                            <div className="hidden sm:flex items-center gap-2 mr-2">
                                                <div className={`w-2 h-2 rounded-full animate-ping ${isActive ? 'bg-indigo-700' : 'bg-indigo-500'}`} />
                                                <span className={`text-xs font-bold ${isActive ? 'text-indigo-700 dark:text-indigo-300' : 'text-indigo-500 dark:text-indigo-400'}`}>진행 중</span>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); removeFile(f.id, e); }}
                                                className="p-2.5 text-indigo-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-all"
                                                title="분석 중단"
                                                aria-label="분석 중단"
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
                                    <div className="flex items-center gap-2 px-1 text-amber-700 dark:text-amber-400">
                                        <Star size={14} className="fill-current" />
                                        <span className="text-[11px] font-bold tracking-wider">즐겨찾기</span>
                                    </div>
                                </div>
                            )}
                            {favRecords.map(renderRecordRow)}

                            {/* 3. 나머지 (즐겨찾기 제외) */}
                            {favRecords.length > 0 && restRecords.length > 0 && (
                                <div className="pt-3 pb-1">
                                    <span className="text-[11px] font-bold tracking-wider text-slate-500 dark:text-slate-400 px-1">나머지</span>
                                </div>
                            )}
                            {restRecords.map(renderRecordRow)}

                            {/* 이 기기 캐시 비우기 — 지우는 버튼은 맨 아래 작은 글씨로(예전엔 제목 자리에 있어 눈에 먼저 들어왔다) */}
                            {cacheKeys.length > 0 && clearLocalCache && (
                                <div className="pt-4 pb-2 text-center">
                                    <button
                                        onClick={clearLocalCache}
                                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                    >
                                        <Trash2 size={12} /> 이 기기의 대본 전부 지우기
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CacheHistoryModal;
