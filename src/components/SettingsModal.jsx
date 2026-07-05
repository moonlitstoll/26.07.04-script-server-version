import { useState, useEffect } from 'react';
import {
    Settings, X, Check, Info, Lock, HardDrive, Trash2
} from 'lucide-react';
import { MODELS } from '../constants/models';
import { mediaStore } from '../utils/MediaStore';

const MARKER_PRESETS = ['※', '#', '|', '·', '❖', '∂', '¤'];

const formatBytes = (b) => {
    if (!b || b <= 0) return '0 MB';
    const mb = b / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
};

const SettingsModal = ({ config, updateField, onLockVault, onClose }) => {
    const [showModelInfo, setShowModelInfo] = useState(false);

    // 저장공간 사용량 + 영상 캐시 비우기
    const [usage, setUsage] = useState(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const [clearing, setClearing] = useState(false);

    const refreshUsage = async () => {
        try {
            if (navigator.storage?.estimate) {
                const { usage: used, quota } = await navigator.storage.estimate();
                setUsage({ used, quota });
            }
        } catch { /* 미지원 브라우저 */ }
    };
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                if (navigator.storage?.estimate) {
                    const { usage: used, quota } = await navigator.storage.estimate();
                    if (alive) setUsage({ used, quota });
                }
            } catch { /* 미지원 브라우저 */ }
        })();
        return () => { alive = false; };
    }, []);

    const handleClearVideoCache = async () => {
        setClearing(true);
        try { await mediaStore.clearAll(); } catch (e) { console.warn('영상 캐시 비우기 실패:', e); }
        setClearing(false);
        setConfirmClear(false);
        refreshUsage();
    };

    const renderModelSelector = (label, colorClass, field) => (
        <div className="space-y-2">
            <label className={`text-sm font-bold ${colorClass}`}>{label}</label>
            <div className="grid grid-cols-1 gap-1.5">
                {MODELS.map(m => (
                    <button
                        key={m.id}
                        onClick={() => updateField(field, m.id)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${config[field] === m.id
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
                        {config[field] === m.id && <Check size={14} className="text-indigo-600" />}
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
                                value={config.apiKey}
                                onChange={(e) => updateField('apiKey', e.target.value)}
                                placeholder="Enter your API key..."
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                            />
                            <Check className={`absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500 transition-all ${config.apiKey.length > 20 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} size={18} />
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
                                            {MODELS.map((m, i) => (
                                                <tr key={m.id} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                                    <td className="px-2 py-1.5 font-bold text-slate-700">{m.shortName}</td>
                                                    <td className={`px-1.5 py-1.5 text-center font-black ${m.info.s1 === 'S' ? 'text-emerald-600' : m.info.s1 === 'A' || m.info.s1 === 'A+' ? 'text-indigo-600' : 'text-slate-500'}`}>{m.info.s1}</td>
                                                    <td className={`px-1.5 py-1.5 text-center font-black ${m.info.s2 === 'S' ? 'text-emerald-600' : m.info.s2 === 'A' || m.info.s2 === 'A+' ? 'text-indigo-600' : 'text-slate-500'}`}>{m.info.s2}</td>
                                                    <td className="px-1.5 py-1.5 text-center text-slate-500">{m.info.rpm}</td>
                                                    <td className="px-1.5 py-1.5 text-center text-slate-500">{m.info.rpd}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="px-3 py-2 border-t border-slate-100 space-y-1">
                                    {MODELS.map((m) => (
                                        <p key={m.id} className="text-[10px] text-slate-400">
                                            <span className="font-bold text-slate-500">{m.shortName}</span>: {m.info.desc}
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
                            'stage1Model'
                        )}
                    </div>

                    {/* Stage 2 Model */}
                    <div className="space-y-3 pt-4 border-t border-slate-50">
                        {renderModelSelector(
                            'Stage 2 — 번역/분석 (Translation & Analysis)',
                            'text-purple-700',
                            'stage2Model'
                        )}
                    </div>

                    {/* Stage 3 Model — 재전사/재분석 전용 */}
                    <div className="space-y-3 pt-4 border-t border-slate-50">
                        {renderModelSelector(
                            'Stage 3 — 재전사 · 재분석 (Re-do)',
                            'text-rose-700',
                            'stage3Model'
                        )}
                        <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                            구간 선택 후 <span className="font-bold text-slate-500">전사부터 다시 / 분석만 다시</span>를 실행할 때 쓰는 모델입니다. 잘못된 부분을 정밀하게 고칠 때 고품질 모델(예: 2.5 Pro)을 권장합니다.
                        </p>
                    </div>

                    {/* Buffer Time */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-slate-700">재생 여유 시간 (Buffer)</label>
                            <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{config.bufferTime.toFixed(1)}초</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="2.0"
                                step="0.1"
                                value={config.bufferTime}
                                onChange={(e) => updateField('bufferTime', parseFloat(e.target.value))}
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
                            <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{config.temperature.toFixed(2)}</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={config.temperature}
                                onChange={(e) => updateField('temperature', parseFloat(e.target.value))}
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
                            <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{config.topP.toFixed(2)}</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={config.topP}
                                onChange={(e) => updateField('topP', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-bold px-1">
                                <span>집중 (0.0)</span>
                                <span>0.7</span>
                                <span>다양 (1.0)</span>
                            </div>
                        </div>
                    </div>

                    {/* Chunk Transcription */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700">청크 분할 전사</label>
                                <span className="text-[10px] text-slate-400 leading-relaxed">긴 영상을 N분 단위로 나눠 전사합니다. 15분 이상 영상에서 전사 누락을 방지합니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={config.chunkEnabled}
                                onClick={() => updateField('chunkEnabled', !config.chunkEnabled)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${config.chunkEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.chunkEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>

                        {config.chunkEnabled && (
                            <div className="space-y-3 pt-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-slate-700">청크 길이</label>
                                    <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{config.chunkMinutes}분</span>
                                </div>
                                <div className="px-1">
                                    <input
                                        type="range"
                                        min="5"
                                        max="30"
                                        step="5"
                                        value={config.chunkMinutes}
                                        onChange={(e) => updateField('chunkMinutes', parseInt(e.target.value, 10))}
                                        className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                    />
                                    <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-bold px-1">
                                        <span>5분</span>
                                        <span>10분</span>
                                        <span>20분</span>
                                        <span>30분</span>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-relaxed">
                                    짧을수록 전사 정확도↑, 길수록 API 호출 횟수↓. 10분을 권장합니다.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Realign (정밀 타임스탬프) */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700">정밀 타임스탬프 (재청취 정렬)</label>
                                <span className="text-[10px] text-slate-400 leading-relaxed">여러 문장이 한 타임스탬프로 뭉친 경우, 그 구간만 오디오를 다시 들어 문장별 실제 시각을 확보합니다. 문장별 하이라이트·구간반복이 정확해집니다. 뭉친 블록마다 API 호출이 한 번 더 들어갑니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={config.realignEnabled}
                                onClick={() => updateField('realignEnabled', !config.realignEnabled)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${config.realignEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.realignEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>
                    </div>

                    {/* Anti-Recitation */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700">RECITATION 방지 모드</label>
                                <span className="text-[10px] text-slate-400 leading-relaxed">노래/연설 등 저작권 차단 회피. 대사에 보이지 않는 분절 기호를 끼워 필터를 우회합니다. 최종 대본·타임라인엔 영향이 없습니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={config.antiRecitation}
                                onClick={() => updateField('antiRecitation', !config.antiRecitation)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${config.antiRecitation ? 'bg-indigo-600' : 'bg-slate-200'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.antiRecitation ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>

                        {config.antiRecitation && (
                            <div className="space-y-4 pt-1">
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-700">분절 기호</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {MARKER_PRESETS.map((mk) => (
                                            <button
                                                key={mk}
                                                type="button"
                                                onClick={() => updateField('markerChar', mk)}
                                                className={`w-9 h-9 rounded-xl border text-base font-bold transition-all ${config.markerChar === mk
                                                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm'
                                                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                            >
                                                {mk}
                                            </button>
                                        ))}
                                    </div>
                                    <input
                                        type="text"
                                        value={config.markerChar}
                                        onChange={(e) => updateField('markerChar', e.target.value)}
                                        maxLength={8}
                                        placeholder="직접 입력 (예: ※)"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-sm font-mono"
                                    />
                                    <p className="text-[10px] text-slate-400 leading-relaxed">
                                        실제 가사/대사에 안 나오는 희귀 기호를 권장합니다. 흔한 글자(예: a, 1)를 넣으면 그 글자가 대본에서 지워질 수 있습니다.
                                    </p>
                                </div>

                                <div className="space-y-3 pt-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-bold text-slate-700">삽입 간격 (단어)</label>
                                        <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{config.markerInterval}단어마다</span>
                                    </div>
                                    <div className="px-1">
                                        <input
                                            type="range"
                                            min="1"
                                            max="10"
                                            step="1"
                                            value={config.markerInterval}
                                            onChange={(e) => updateField('markerInterval', parseInt(e.target.value, 10))}
                                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                        />
                                        <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-bold px-1">
                                            <span>촘촘 (1)</span>
                                            <span>2~3</span>
                                            <span>듬성 (10)</span>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-relaxed">
                                        간격이 좁을수록 회피력↑(연속 일치를 더 잘게 끊음), 넓을수록 토큰 절약. 1~3단어를 권장합니다.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 저장공간 */}
                    <div className="space-y-2 pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                                <HardDrive size={14} className="text-slate-400" /> 저장공간
                            </label>
                            {usage && (
                                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                                    {formatBytes(usage.used)}{usage.quota ? ` / ${formatBytes(usage.quota)}` : ''} 사용
                                </span>
                            )}
                        </div>
                        {!confirmClear ? (
                            <button
                                type="button"
                                onClick={() => setConfirmClear(true)}
                                className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600 transition-all"
                            >
                                <Trash2 size={16} /> 영상 캐시 비우기
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setConfirmClear(false)}
                                    className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all"
                                >
                                    취소
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearVideoCache}
                                    disabled={clearing}
                                    className="flex-[2] px-4 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold rounded-xl transition-all"
                                >
                                    {clearing ? '비우는 중...' : '정말 비우기 (되돌릴 수 없음)'}
                                </button>
                            </div>
                        )}
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                            기기에 저장된 영상 캐시를 모두 비웁니다. 대본·분석 기록은 유지되며, 클라우드 항목은 다시 열 때 재다운로드됩니다.
                        </p>
                    </div>

                    {/* 보관함 잠그기 / 암호 변경 */}
                    {onLockVault && (
                        <div className="space-y-2 pt-4 border-t border-slate-50">
                            <label className="text-sm font-bold text-slate-700">기기 간 공유 보관함</label>
                            <button
                                type="button"
                                onClick={onLockVault}
                                className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-all"
                            >
                                <Lock size={16} /> 보관함 잠그기 / 암호 변경
                            </button>
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                                이 기기에 저장된 암호를 지우고 암호 입력창으로 돌아갑니다. 다른 암호를 넣어 다른 보관함으로 전환할 수 있어요. 클라우드에 저장된 대본은 지워지지 않습니다.
                            </p>
                        </div>
                    )}
                </div>

                <div className="p-6 bg-slate-50 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 text-slate-600 font-bold hover:bg-white rounded-2xl transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-[2] py-3 text-white font-bold rounded-2xl transition-all shadow-lg bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"
                    >
                        현재 AI 설정값을 기본값으로 저장
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
