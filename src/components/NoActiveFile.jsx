import { FileAudio } from 'lucide-react';

// 작업 화면에서 활성 파일이 없을 때 보여주는 안내 카드
const NoActiveFile = ({ stage1Model, stage2Model, onOpenSettings, onOpenHistory }) => (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div className="flex-1 flex items-center justify-center p-10">
            <div className="max-w-md w-full p-8 bg-white dark:bg-slate-800 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center space-y-4">
                <div className="inline-flex p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl text-slate-400 dark:text-slate-500">
                    <FileAudio size={32} />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">No active file</h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Upload or select a file to start the analysis.</p>
                </div>
                <div className="bg-slate-50/50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2 text-left">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Current Models</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300"><span className="font-bold text-indigo-600 dark:text-indigo-400">Stage 1</span> (전사): {stage1Model}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300"><span className="font-bold text-purple-600 dark:text-purple-300">Stage 2</span> (분석): {stage2Model}</p>
                    <button
                        onClick={onOpenSettings}
                        className="w-full mt-2 px-4 py-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-xl transition-all"
                    >
                        모델 설정 변경
                    </button>
                </div>
                <button
                    onClick={onOpenHistory}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100 dark:shadow-black/40"
                >
                    Select from List
                </button>
            </div>
        </div>
    </div>
);

export default NoActiveFile;
