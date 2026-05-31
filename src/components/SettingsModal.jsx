import { useState, useEffect } from 'react';
import {
    Settings, X, Check, Info
} from 'lucide-react';

const MODELS = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: '추천' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', badge: '최고품질' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', badge: '대량처리' },
    { id: 'gemini-2-flash', name: 'Gemini 2 Flash', badge: '' },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', badge: '최신' },
];

const MODEL_INFO = [
    { name: '2.5 Flash', s1: 'A', s2: 'A', rpm: '1K', rpd: '10K', desc: '만능형 기본값. 전사/분석 균형' },
    { name: '2.5 Pro', s1: 'S', s2: 'S', rpm: '150', rpd: '1K', desc: '최고 품질. 긴 영상엔 한도 주의' },
    { name: '2.5 Flash Lite', s1: 'B+', s2: 'A', rpm: '4K', rpd: '무제한', desc: '대량 배치에 최적. RPM 넉넉' },
    { name: '2 Flash', s1: 'A-', s2: 'B+', rpm: '2K', rpd: '무제한', desc: '안정적 폴백용' },
    { name: '3.5 Flash', s1: '?', s2: 'A+', rpm: '1K', rpd: '10K', desc: '최신 모델. 전사 안정성 미검증' },
];

const SettingsModal = ({
    apiKey, setApiKey,
    stage1Model, setStage1Model,
    stage2Model, setStage2Model,
    bufferTime, setBufferTime,
    temperature, setTemperature,
    topP, setTopP,
    antiRecitation, setAntiRecitation,
    pitchSemitones, setPitchSemitones,
    chunkSplit, setChunkSplit,
    saveConfiguration, onClose
}) => {
    const [saveState, setSaveState] = useState('idle');
    const [showModelInfo, setShowModelInfo] = useState(false);

    useEffect(() => {
        if (saveState === 'saved') {
            const timer = setTimeout(() => setSaveState('idle'), 2000);
            return () => clearTimeout(timer);
        }
    }, [saveState]);

    const renderModelSelector = (label, colorClass, value, onChange) => (
        <div className="space-y-2">
            <label className={`text-sm font-bold ${colorClass}`}>{label}</label>
            <div className="grid grid-cols-1 gap-1.5">
                {MODELS.map(m => (
                    <button
                        key={m.id}
                        onClick={() => onChange(m.id)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${value === m.id
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold shadow-sm'
                            : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                            }`}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-sm">{m.name}</span>
                            {m.badge && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-tight ${
                                    m.badge === '추천' ? 'bg-indigo-100 text-indigo-600' :
                                    m.badge === '최고품질' ? 'bg-emerald-100 text-emerald-600' :
                                    m.badge === '대량처리' ? 'bg-amber-100 text-amber-600' :
                                    m.badge === '최신' ? 'bg-purple-100 text-purple-600' :
                                    'bg-slate-100 text-slate-500'
                                }`}>{m.badge}</span>
                            )}
                        </div>
                        {value === m.id && <Check size={14} className="text-indigo-600" />}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-100 p-2 rounded-xl">
                            <Settings size={20} className="text-slate-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900">Settings</h2>
                            <p className="text-xs text-slate-500 font-medium">Gemini AI & Model Configuration</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="설정 닫기" className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* API Key */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-slate-700">Gemini API Key</label>
                            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                                Get Key <X size={10} className="rotate-45" />
                            </a>
                        </div>
                        <div className="relative group">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="Enter your API key..."
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                            />
                            <Check className={`absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500 transition-all ${apiKey.length > 20 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} size={18} />
                        </div>
                    </div>

                    {/* Model Info Toggle */}
                    <div className="pt-4 border-t border-slate-50">
                        <button
                            onClick={() => setShowModelInfo(!showModelInfo)}
                            className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors mb-3"
                        >
                            <Info size={14} />
                            {showModelInfo ? '모델 비교표 닫기' : '모델 비교표 보기'}
                        </button>

                        {showModelInfo && (
                            <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden mb-4">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-[11px]">
                                        <thead>
                                            <tr className="bg-slate-100 text-slate-600 font-bold">
                                                <th className="px-2 py-2 text-left">모델</th>
                                                <th className="px-1.5 py-2 text-center">전사</th>
                                                <th className="px-1.5 py-2 text-center">분석</th>
                                                <th className="px-1.5 py-2 text-center">RPM</th>
                                                <th className="px-1.5 py-2 text-center">RPD</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {MODEL_INFO.map((m, i) => (
                                                <tr key={i} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                                    <td className="px-2 py-1.5 font-bold text-slate-700">{m.name}</td>
                                                    <td className={`px-1.5 py-1.5 text-center font-black ${m.s1 === 'S' ? 'text-emerald-600' : m.s1 === 'A' || m.s1 === 'A+' ? 'text-indigo-600' : 'text-slate-500'}`}>{m.s1}</td>
                                                    <td className={`px-1.5 py-1.5 text-center font-black ${m.s2 === 'S' ? 'text-emerald-600' : m.s2 === 'A' || m.s2 === 'A+' ? 'text-indigo-600' : 'text-slate-500'}`}>{m.s2}</td>
                                                    <td className="px-1.5 py-1.5 text-center text-slate-500">{m.rpm}</td>
                                                    <td className="px-1.5 py-1.5 text-center text-slate-500">{m.rpd}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="px-3 py-2 border-t border-slate-100 space-y-1">
                                    {MODEL_INFO.map((m, i) => (
                                        <p key={i} className="text-[10px] text-slate-400">
                                            <span className="font-bold text-slate-500">{m.name}</span>: {m.desc}
                                        </p>
                                    ))}
                                </div>
                                <div className="px-3 py-2 border-t border-slate-100 bg-amber-50/50">
                                    <p className="text-[10px] text-amber-600 font-bold">
                                        TIP: 긴 영상은 Stage 1에 2.5 Flash, Stage 2에 2.5 Flash Lite 조합 추천
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stage 1 Model */}
                    <div className="space-y-3">
                        {renderModelSelector(
                            'Stage 1 — 음성 전사 (Transcription)',
                            'text-indigo-700',
                            stage1Model,
                            setStage1Model
                        )}
                    </div>

                    {/* Stage 2 Model */}
                    <div className="space-y-3 pt-4 border-t border-slate-50">
                        {renderModelSelector(
                            'Stage 2 — 번역/분석 (Translation & Analysis)',
                            'text-purple-700',
                            stage2Model,
                            setStage2Model
                        )}
                    </div>

                    {/* Buffer Time */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-slate-700">재생 여유 시간 (Buffer)</label>
                            <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{bufferTime.toFixed(1)}초</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="2.0"
                                step="0.1"
                                value={bufferTime}
                                onChange={(e) => setBufferTime(parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-bold px-1">
                                <span>빠르게 (0.0s)</span>
                                <span>0.3s</span>
                                <span>여유롭게 (2.0s)</span>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                            문장 이동 또는 반복 재생 시, 문장 앞뒤로 들리는 여유 시간입니다.
                        </p>
                    </div>

                    {/* Temperature */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <label className="text-sm font-bold text-slate-700">전사 창의성 (Temperature)</label>
                                <span className="text-[10px] text-slate-400">높을수록 유연한 해석</span>
                            </div>
                            <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{temperature.toFixed(2)}</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={temperature}
                                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-bold px-1">
                                <span>정밀 (0.0)</span>
                                <span>0.5</span>
                                <span>유연 (1.0)</span>
                            </div>
                        </div>
                    </div>

                    {/* TopP */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <label className="text-sm font-bold text-slate-700">단어 선택 범위 (TopP)</label>
                                <span className="text-[10px] text-slate-400">높을수록 풍부한 표현</span>
                            </div>
                            <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{topP.toFixed(2)}</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={topP}
                                onChange={(e) => setTopP(parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-bold px-1">
                                <span>집중 (0.0)</span>
                                <span>0.7</span>
                                <span>다양 (1.0)</span>
                            </div>
                        </div>
                    </div>

                    {/* Anti-Recitation (RECITATION 필터 회피) */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700">RECITATION 방지 모드</label>
                                <span className="text-[10px] text-slate-400 leading-relaxed">노래/연설 등 저작권 차단 회피. 대사에 보이지 않는 분절 기호를 끼워 필터를 우회합니다. 최종 대본·타임라인엔 영향이 없습니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={antiRecitation}
                                onClick={() => setAntiRecitation(!antiRecitation)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${antiRecitation ? 'bg-indigo-600' : 'bg-slate-200'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${antiRecitation ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>

                        {antiRecitation && (
                            <div className="space-y-3 pt-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-slate-700">피치 이동 (선택, 보조)</label>
                                    <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">
                                        {pitchSemitones === 0 ? '0 (끔)' : (pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones) + ' 반음'}
                                    </span>
                                </div>
                                <div className="px-1">
                                    <input
                                        type="range"
                                        min="-5"
                                        max="5"
                                        step="1"
                                        value={pitchSemitones}
                                        onChange={(e) => setPitchSemitones(parseInt(e.target.value, 10))}
                                        className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                    />
                                    <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-bold px-1">
                                        <span>낮춤 (-5)</span>
                                        <span>0 (끔)</span>
                                        <span>높임 (+5)</span>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-relaxed">
                                    기본값 0(끔). 분절 기호만으로 회피가 안 될 때 ±2 반음 정도 보조로 켜세요. 0이 아니면 재인코딩으로 전처리 시간이 늘어납니다.
                                </p>

                                {/* 청크 분할 (피치 시프트로도 회피 안 될 때) */}
                                <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
                                    <div className="flex flex-col pr-3">
                                        <label className="text-sm font-bold text-slate-700">청크 분할 전사</label>
                                        <span className="text-[10px] text-slate-400 leading-relaxed">긴 영상을 60초 조각으로 잘라 병렬 전사. 회피력↑·장애 내성↑, 전처리 시간이 늘어납니다. 타임라인은 그대로 유지됩니다.</span>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={chunkSplit}
                                        onClick={() => setChunkSplit(!chunkSplit)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${chunkSplit ? 'bg-indigo-600' : 'bg-slate-200'}`}
                                    >
                                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${chunkSplit ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-6 bg-slate-50 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 text-slate-600 font-bold hover:bg-white rounded-2xl transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            saveConfiguration(apiKey, stage1Model, stage2Model, bufferTime, temperature, topP, antiRecitation, pitchSemitones, chunkSplit);
                            setSaveState('saved');
                        }}
                        className={`flex-[2] py-3 text-white font-bold rounded-2xl transition-all shadow-lg ${
                            saveState === 'saved'
                                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'
                                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                        }`}
                    >
                        {saveState === 'saved' ? '저장 완료!' : '현재 AI 설정값을 기본값으로 저장'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
