import { Home, Settings, FileVideo, FileAudio, HelpCircle } from 'lucide-react';

// 작업 화면 상단 헤더: 홈 버튼 · 현재 파일명(클릭 시 히스토리) · 도움말 · 설정 버튼
const WorkspaceHeader = ({
    activeFile,
    isAnalyzing,
    isSwitchingFile,
    onHome,
    onOpenHistory,
    onOpenSettings,
    onShowShortcuts,
}) => {
    const busy = isAnalyzing || isSwitchingFile;

    return (
        <header className="relative z-50 bg-white/80 border-b border-slate-100 flex-none h-10 sm:h-11 flex items-center justify-between px-2 sm:px-4">
            <button
                onClick={onHome}
                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                title="Go to Home"
            >
                <Home size={18} />
            </button>

            <div className="flex-1 min-w-0">
                <div className="relative">
                    <button
                        onClick={onOpenHistory}
                        className="w-full text-center px-4 py-1 hover:bg-slate-50 rounded-lg transition-colors group"
                    >
                        {activeFile ? (
                            <div className="flex items-center justify-center gap-1.5 text-slate-900">
                                {activeFile.file.type.startsWith('video') ? (
                                    <FileVideo size={15} className={`shrink-0 ${busy ? 'text-slate-400 animate-pulse' : 'text-indigo-600'}`} />
                                ) : (
                                    <FileAudio size={15} className={`shrink-0 ${busy ? 'text-slate-400 animate-pulse' : 'text-indigo-600'}`} />
                                )}
                                <span className={`text-sm font-bold truncate group-hover:text-indigo-700 transition-colors ${busy ? 'text-slate-500 italic' : ''}`}>
                                    {isAnalyzing
                                        ? `Extracting Transcript...`
                                        : (activeFile?.data && activeFile.data.some(d => !d.isAnalyzed)
                                            ? `Analyzing Details (${activeFile.data.filter(d => d.isAnalyzed).length}/${activeFile.data.length})`
                                            : activeFile?.file?.name || "Ready")
                                    }
                                </span>
                            </div>
                        ) : (
                            <span className="text-sm font-bold text-slate-400">Select File...</span>
                        )}
                    </button>
                </div>
            </div>

            <div className="flex items-center">
                {onShowShortcuts && (
                    <button
                        onClick={onShowShortcuts}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        title="키보드 단축키 (?)"
                    >
                        <HelpCircle size={18} />
                    </button>
                )}
                <button
                    onClick={onOpenSettings}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                >
                    <Settings size={18} />
                </button>
            </div>
        </header>
    );
};

export default WorkspaceHeader;
