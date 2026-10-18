import { Home, Settings, FileVideo, FileAudio, HelpCircle, SlidersHorizontal, ChevronDown } from 'lucide-react';

// 작업 화면 상단 헤더: 홈 버튼 · 현재 파일명(클릭 시 히스토리) · 툴바 열기 · 도움말 · 설정 버튼
const WorkspaceHeader = ({
    activeFile,
    isAnalyzing,
    isSwitchingFile,
    onHome,
    onOpenHistory,
    onOpenSettings,
    onShowShortcuts,
    onToggleToolbar,
    toolbarOpen,
    toolbarModesOn,
}) => {
    const busy = isAnalyzing || isSwitchingFile;

    return (
        <header className="relative z-50 bg-white/80 dark:bg-slate-900/80 border-b border-slate-100 dark:border-slate-700 flex-none h-10 sm:h-11 flex items-center justify-between px-2 sm:px-4">
            <button
                onClick={onHome}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-all"
                title="홈으로"
                aria-label="홈으로"
            >
                <Home size={18} />
            </button>

            <div className="flex-1 min-w-0">
                <div className="relative">
                    <button
                        onClick={onOpenHistory}
                        aria-label="대본 목록 열기"
                        className="w-full text-center px-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors group"
                    >
                        {activeFile ? (
                            <div className="flex items-center justify-center gap-1.5 text-slate-900 dark:text-slate-100">
                                {activeFile.file.type.startsWith('video') ? (
                                    <FileVideo size={15} className={`shrink-0 ${busy ? 'text-slate-400 dark:text-slate-500 animate-pulse' : 'text-indigo-600 dark:text-indigo-400'}`} />
                                ) : (
                                    <FileAudio size={15} className={`shrink-0 ${busy ? 'text-slate-400 dark:text-slate-500 animate-pulse' : 'text-indigo-600 dark:text-indigo-400'}`} />
                                )}
                                <span className={`text-sm font-bold truncate group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors ${busy ? 'text-slate-500 dark:text-slate-400 italic' : ''}`}>
                                    {isAnalyzing
                                        ? '받아쓰는 중…'
                                        // 실패로 끝난 문장(analysisFailed)은 '분석 중'으로 세지 않는다 — 예전엔 실패가 남은 채 끝나도
                                        // 이 문구가 계속 떠 진행 중처럼 보였다(점검 #13·#19). 실패 문장은 카드의 '다시 시도'가 알린다.
                                        : (activeFile?.data && activeFile.data.some(d => !d.isAnalyzed && !d.analysisFailed)
                                            ? `분석 중 (${activeFile.data.filter(d => d.isAnalyzed).length}/${activeFile.data.length})`
                                            : activeFile?.file?.name || '준비됨')
                                    }
                                </span>
                            </div>
                        ) : (
                            <span className="text-sm font-bold text-slate-400 dark:text-slate-500">파일을 고르세요</span>
                        )}
                    </button>
                </div>
            </div>

            <div className="flex items-center">
                {/* 툴바(가리기·묶음·대사만·오답·⋯) 열고 닫기 — 평소 숨김. 글자 칩('도구 ▾')으로 둔다 —
                    아이콘만 두면 옆의 ?·톱니와 같은 생김새라 '설정'으로 읽혔다(2차 점검).
                    숨긴 채 가리기·오답만·대사만이 켜져 있으면 오른쪽 위 점으로 알린다 */}
                {onToggleToolbar && (
                    <button
                        onClick={onToggleToolbar}
                        aria-pressed={!!toolbarOpen}
                        aria-label={toolbarOpen ? '도구 줄 숨기기' : '도구 줄 열기'}
                        title={toolbarOpen ? '도구 줄 숨기기' : '도구 줄 열기 (가리기·묶음·대사만·고치기)'}
                        className={`relative h-7 px-2 mr-0.5 inline-flex items-center gap-1 rounded-lg border text-xs font-bold transition-all ${toolbarOpen
                            ? 'text-white bg-indigo-600 border-indigo-600'
                            : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'}`}
                    >
                        <SlidersHorizontal size={13} />
                        도구
                        <ChevronDown size={12} className={`transition-transform ${toolbarOpen ? 'rotate-180' : ''}`} />
                        {!toolbarOpen && toolbarModesOn && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900">
                                <span className="sr-only">켜진 모드 있음</span>
                            </span>
                        )}
                    </button>
                )}
                {/* 키보드 단축키 도움말은 PC에서만 — 휴대폰엔 키보드가 없다 */}
                {onShowShortcuts && (
                    <button
                        onClick={onShowShortcuts}
                        className="hidden sm:inline-flex p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-all"
                        title="키보드 단축키 (?)"
                        aria-label="키보드 단축키"
                    >
                        <HelpCircle size={18} />
                    </button>
                )}
                <button
                    onClick={onOpenSettings}
                    title="설정"
                    aria-label="설정"
                    className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-all"
                >
                    <Settings size={18} />
                </button>
            </div>
        </header>
    );
};

export default WorkspaceHeader;
