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
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">열린 대본이 없어요</h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">파일을 올리거나 목록에서 고르세요.</p>
                </div>
                <div className="bg-slate-50/50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-2 text-left">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider text-center">지금 쓰는 모델</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300"><span className="font-bold text-indigo-600 dark:text-indigo-400">1단계</span> (받아쓰기): {stage1Model}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300"><span className="font-bold text-purple-600 dark:text-purple-300">2단계</span> (번역·풀이): {stage2Model}</p>
                    <button
                        onClick={onOpenSettings}
                        className="w-full mt-2 px-4 py-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-xl transition-all"
                    >
                        모델 바꾸기
                    </button>
                </div>
                <button
                    onClick={onOpenHistory}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-100 dark:shadow-black/40"
                >
                    목록에서 고르기
                </button>
            </div>
        </div>
    </div>
);

export default NoActiveFile;
