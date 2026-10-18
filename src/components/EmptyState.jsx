import {
    Upload, Volume2, Settings, Star, Cloud, Trash2, BookOpen
} from 'lucide-react';
import SettingsModal from './SettingsModal';
import TranscriptRow from './TranscriptRow';
import { getCacheDisplayName, getCacheStatus, isVideoName, cloudStatusOf } from '../utils/cacheStatus';
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

    // 로컬 캐시 항목 1행 — 기록 창과 같은 부품(TranscriptRow), 완료/멈춤 배지·문장 수가 여기서도 보인다
    const renderRow = (key) => {
        const id = favIdFromKey(key);
        const name = getCacheDisplayName(key);
        const display = name.replace(/\.[^.]+$/, '');
        const cloudItem = cloudById.get(id) || null;
        const recForDelete = { displayName: display, localKey: key, cloudItem };
        return (
            <TranscriptRow
                key={key}
                display={display}
                kind={isVideoName(name) ? 'video' : 'audio'}
                localHere
                status={getCacheStatus(key)}
                fav={isFavorite(id)}
                onOpen={() => loadCache(key)}
                onToggleFav={() => toggleFavorite(id)}
                onDeleteLocal={() => deleteLocal(recForDelete)}
                onDeleteServer={cloudItem ? () => deleteServer(recForDelete) : undefined}
            />
        );
    };

    // 클라우드 전용 항목 1행 (다른 기기에서 올린 것)
    const renderCloudRow = (item) => {
        const id = favIdFromItem(item);
        const display = (item.name || '이름 없음').replace(/\.[^.]+$/, '');
        const localHere = localVideoIds.has(id);
        const recForDelete = { displayName: display, localKey: null, cloudItem: item };
        return (
            <TranscriptRow
                key={item.folder}
                display={display}
                kind={localHere ? (isVideoName(item.name) ? 'video' : 'audio') : 'cloud'}
                localHere={localHere}
                status={cloudStatusOf(item)}
                fav={isFavorite(id)}
                onOpen={() => loadCloud && loadCloud(item)}
                onToggleFav={() => toggleFavorite(id)}
                onDeleteLocal={localHere ? () => deleteLocal(recForDelete) : undefined}
                onDeleteServer={() => deleteServer(recForDelete)}
            />
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
                    <h2 className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">여기에 놓으세요</h2>
                </div>
            )}

            <button onClick={() => setShowSettings(true)} aria-label="설정 열기" title="설정" className="absolute top-6 right-6 p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
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
                        <span className="text-sm font-bold leading-tight">Gemini API 키를 먼저 넣어 주세요 — 누르면 설정이 열립니다</span>
                    </button>
                )}

                <div className="group relative flex items-center gap-3.5 px-5 py-3.5 rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-white dark:hover:bg-slate-700 bg-white/60 dark:bg-slate-800/60 text-left">
                    <input type="file" multiple aria-label="파일 올리기" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => processFiles(e.target.files)} accept="audio/*,video/*" />
                    <div className="shrink-0 p-2.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl group-hover:scale-110 transition-transform">
                        <Upload size={22} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800 dark:text-slate-200 text-base leading-tight">영상·소리 파일 올리기</h2>
                        <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">탭해서 고르거나 끌어다 놓기 · 여러 개 가능</p>
                    </div>
                </div>

                {/* Cached Transcripts Section */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
                    <h2 className="font-bold text-slate-800 dark:text-slate-200 mb-2.5 text-sm flex items-center justify-center gap-2">
                        <BookOpen size={14} className="text-indigo-500 dark:text-indigo-400" />
                        저장된 대본
                    </h2>
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
                            // 처음 쓰는 사람용 안내 — 몇 분 걸리고 돈이 든다는 걸 올리기 전에 알린다
                            <div className="bg-slate-50/50 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 text-left space-y-2">
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">처음이세요? 이렇게 시작해요</p>
                                <ol className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-1.5 list-decimal list-inside">
                                    <li>오른쪽 위 톱니(설정)에서 <b>Gemini API 키</b>를 넣어요. 구글에서 무료로 받을 수 있어요.</li>
                                    <li>위의 <b>'영상·소리 파일 올리기'</b>로 파일을 올려요. 받아쓰기와 번역에 <b>몇 분</b> 걸리고, 10분 영상에 <b>100원 안팎</b>의 요금이 들어요.</li>
                                    <li>끝나면 대본이 여기 저장돼요. 문장을 탭하면 그 자리부터 들리고, 아래 플레이어로 반복해요.</li>
                                </ol>
                            </div>
                        ) : (
                            <>
                                {(favKeys.length > 0 || favCloudItems.length > 0) && (
                                    <div className="flex items-center justify-center gap-1.5 text-amber-700 dark:text-amber-400 pt-1 pb-0.5">
                                        <Star size={12} className="fill-current" />
                                        <span className="text-[11px] font-bold tracking-wider">즐겨찾기</span>
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
                            className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center gap-1 mx-auto"
                        >
                            <Trash2 size={12} /> 이 기기의 대본 전부 지우기
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EmptyState;
