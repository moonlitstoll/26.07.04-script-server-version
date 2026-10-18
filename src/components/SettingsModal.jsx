import { useState, useEffect, useRef } from 'react';
import {
    Settings, X, Check, Info, Lock, HardDrive, Trash2, ChevronDown, ExternalLink
} from 'lucide-react';
import { MODELS, modelsForStage, isClaudeModel } from '../constants/models';
import { SPEECH_TAIL_PAD, TAIL_PAD_MIN, TAIL_PAD_MAX } from '../utils/speechSegments';
import { mediaStore } from '../utils/MediaStore';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { THEME_OPTIONS } from '../utils/theme';

const MARKER_PRESETS = ['※', '#', '|', '·', '❖', '∂', '¤'];

const formatBytes = (b) => {
    if (!b || b <= 0) return '0 MB';
    const mb = b / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
};

const SettingsModal = ({ config, updateField, onLockVault, onClose }) => {
    const [showModelInfo, setShowModelInfo] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // 모달 열릴 때의 설정 스냅샷. Cancel 시 변경된 필드만 되돌린다.
    // (모든 설정은 updateField 즉시 localStorage에 저장되므로, 취소=스냅샷 복원)
    const initialConfigRef = useRef(config);
    const handleCancel = () => {
        const initial = initialConfigRef.current;
        Object.keys(initial).forEach(k => {
            if (config[k] !== initial[k]) updateField(k, initial[k]);
        });
        onClose();
    };

    // ESC / 배경 클릭은 "그냥 닫기(변경 유지)". 실수로 닫아도 값이 날아가지 않도록,
    // 되돌리기는 명시적인 Cancel 버튼에서만 수행한다.
    useEscapeToClose(onClose);

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

    // stage: 'stage1'|'stage2'|'stage3' — 단계마다 고를 수 있는 모델이 다르다(Claude는 2단계 분석만, models.js의 stages)
    const renderModelSelector = (label, colorClass, field, stage) => (
        <div className="space-y-2">
            <label className={`text-sm font-bold ${colorClass}`}>{label}</label>
            <div className="grid grid-cols-1 gap-1.5">
                {modelsForStage(stage).map(m => (
                    <button
                        key={m.id}
                        onClick={() => updateField(field, m.id)}
                        className={`flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-xl border transition-all ${config[field] === m.id
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold shadow-sm'
                            : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                    >
                        {/* 휴대폰에서 이름·표시가 글자 중간에서 끊기지 않게: 각 조각은 한 줄 고정,
                            자리가 모자라면 조각 단위로 아랫줄로 내려간다 */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                            <span className="text-sm whitespace-nowrap">{m.name}</span>
                            {m.badge && (
                                <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap ${
                                    m.badge === '추천' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' :
                                    m.badge === '최고품질' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' :
                                    m.badge === '대량처리' ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300' :
                                    m.badge === '최신' ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300' :
                                    m.badge === '저렴' ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300' :
                                    m.badge === '크레딧' ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300' :
                                    'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                }`}>{m.badge}</span>
                            )}
                            {m.notice && <span className="text-[11px] font-bold text-rose-500 dark:text-rose-400 whitespace-nowrap">{m.notice}</span>}
                        </div>
                        {config[field] === m.id && <Check size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-100 dark:bg-slate-700 p-2 rounded-xl">
                            <Settings size={20} className="text-slate-600 dark:text-slate-300" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">설정</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">키 · 화면 · 모델 · 재생</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="설정 닫기" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                        <X size={20} className="text-slate-500 dark:text-slate-400" />
                    </button>
                </div>

                <div className="p-4 sm:p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* API Key */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Gemini API Key</label>
                            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                                키 발급 <ExternalLink size={10} />
                            </a>
                        </div>
                        <div className="relative group">
                            <input
                                type="password"
                                value={config.apiKey}
                                onChange={(e) => updateField('apiKey', e.target.value)}
                                placeholder="API 키 붙여넣기"
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                            />
                            <Check className={`absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500 dark:text-emerald-400 transition-all ${config.apiKey.length > 20 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} size={18} />
                        </div>
                    </div>

                    {/* 화면 테마 — 고르면 바로 적용(미리보기처럼). Cancel이면 열 때 값으로 되돌아간다. */}
                    <div className="space-y-2 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300">화면 테마</label>
                        <div className="flex w-full rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                            {THEME_OPTIONS.map((v) => (
                                <button
                                    key={v}
                                    onClick={() => updateField('theme', v)}
                                    aria-pressed={config.theme === v}
                                    className={`flex-1 py-2 text-sm font-bold transition-colors ${config.theme === v
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                                >
                                    {{ system: '시스템', light: '라이트', dark: '다크' }[v]}
                                </button>
                            ))}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">시스템 = 휴대폰·PC의 다크 모드 설정을 따라갑니다.</p>
                    </div>

                    {/* Model Info Toggle */}
                    <div className="pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <button
                            onClick={() => setShowModelInfo(!showModelInfo)}
                            className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors mb-3"
                        >
                            <Info size={14} />
                            {showModelInfo ? '모델 비교표 닫기' : '모델 비교표 보기'}
                        </button>

                        {showModelInfo && (
                            <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden mb-4">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-[11px]">
                                        <thead>
                                            <tr className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">
                                                <th className="px-2 py-2 text-left">모델</th>
                                                <th className="px-1.5 py-2 text-center">전사</th>
                                                <th className="px-1.5 py-2 text-center">분석</th>
                                                <th className="px-1.5 py-2 text-center">RPM</th>
                                                <th className="px-1.5 py-2 text-center">RPD</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {MODELS.map((m, i) => (
                                                <tr key={m.id} className={`border-t border-slate-100 dark:border-slate-700 ${i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/50 dark:bg-slate-900/50'}`}>
                                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-300">{m.shortName}</td>
                                                    <td className={`px-1.5 py-1.5 text-center font-black ${m.info.s1 === 'S' ? 'text-emerald-700 dark:text-emerald-300' : m.info.s1 === 'A' || m.info.s1 === 'A+' ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>{m.info.s1}</td>
                                                    <td className={`px-1.5 py-1.5 text-center font-black ${m.info.s2 === 'S' ? 'text-emerald-700 dark:text-emerald-300' : m.info.s2 === 'A' || m.info.s2 === 'A+' ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>{m.info.s2}</td>
                                                    <td className="px-1.5 py-1.5 text-center text-slate-500 dark:text-slate-400">{m.info.rpm}</td>
                                                    <td className="px-1.5 py-1.5 text-center text-slate-500 dark:text-slate-400">{m.info.rpd}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700 space-y-1">
                                    {MODELS.map((m) => (
                                        <p key={m.id} className="text-[11px] text-slate-500 dark:text-slate-400">
                                            <span className="font-bold text-slate-500 dark:text-slate-400">{m.shortName}</span>: {m.info.desc}
                                        </p>
                                    ))}
                                </div>
                                <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700 bg-amber-50/50 dark:bg-amber-950/30">
                                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-bold">
                                        TIP: 긴 영상은 1단계 2.5 Flash + 2단계 2.5 Flash Lite 조합 추천
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stage 1 Model */}
                    <div className="space-y-3">
                        {renderModelSelector(
                            '1단계 — 받아쓰기(전사)',
                            'text-indigo-700 dark:text-indigo-300',
                            'stage1Model',
                            'stage1'
                        )}
                    </div>

                    {/* Stage 2 Model */}
                    <div className="space-y-3 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        {renderModelSelector(
                            '2단계 — 번역·풀이(분석)',
                            'text-purple-700 dark:text-purple-200',
                            'stage2Model',
                            'stage2'
                        )}
                        {/* Claude를 고르면 그 자리에 Claude 키 칸 — Gemini 키처럼 이 기기 브라우저에만 저장된다 */}
                        {isClaudeModel(config.stage2Model) && (
                            <div className="space-y-2 pt-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Claude API Key</label>
                                    <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                                        키 발급 <ExternalLink size={10} />
                                    </a>
                                </div>
                                <div className="relative group">
                                    <input
                                        type="password"
                                        value={config.claudeApiKey || ''}
                                        onChange={(e) => updateField('claudeApiKey', e.target.value.trim())}
                                        placeholder="sk-ant-..."
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                                    />
                                    <Check className={`absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500 dark:text-emerald-400 transition-all ${(config.claudeApiKey || '').startsWith('sk-ant-') ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} size={18} />
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                    새 영상의 번역·풀이(2단계)만 Claude가 합니다. 전사·재전사·재분석·대사 감지는 그대로 Gemini. 크레딧이 떨어지면 분석이 멈추고 안내가 뜹니다(Gemini로 자동 전환하지 않음). 키는 이 기기에만 저장됩니다.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Stage 3 Model — 재전사/재분석 전용 */}
                    <div className="space-y-3 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        {renderModelSelector(
                            '3단계 — 다시 받아쓰기 · 다시 분석',
                            'text-rose-700 dark:text-rose-300',
                            'stage3Model',
                            'stage3'
                        )}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed px-1">
                            구간 선택 후 <span className="font-bold text-slate-500 dark:text-slate-400">전사부터 다시 / 분석만 다시</span>를 실행할 때 쓰는 모델입니다. 기본은 2.5 Flash이고, 그래도 안 고쳐지는 문장에만 2.5 Pro를 쓰면 요금을 아낄 수 있습니다.
                        </p>
                    </div>

                    {/* Buffer Time */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-slate-700 dark:text-slate-300">재생 여유 시간</label>
                            <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-lg">{config.bufferTime.toFixed(1)}초</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="2.0"
                                step="0.1"
                                value={config.bufferTime}
                                onChange={(e) => updateField('bufferTime', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-bold px-1">
                                <span>빠르게 (0.0s)</span>
                                <span>0.3s</span>
                                <span>여유롭게 (2.0s)</span>
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            문장 이동 또는 반복 재생 시, 문장 앞뒤로 들리는 여유 시간입니다.
                        </p>
                    </div>

                    {/* 대사 꼬리 여유 (대사만 재생 전용) */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">대사 꼬리 여유</label>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">대사만 재생에서만 적용</span>
                            </div>
                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-lg">{config.speechTailPad.toFixed(1)}초</span>
                        </div>
                        <div className="px-1">
                            {/* min/max는 리터럴 대신 상수를 쓴다 — 상한은 임의값이 아니라
                                '건너뛰기가 죽지 않는 최대치'라서 speechSegments가 단일 출처여야 한다. */}
                            <input
                                type="range"
                                min={TAIL_PAD_MIN}
                                max={TAIL_PAD_MAX}
                                step="0.1"
                                value={config.speechTailPad}
                                onChange={(e) => updateField('speechTailPad', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                            />
                            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-bold px-1">
                                <span>많이 건너뜀 ({TAIL_PAD_MIN.toFixed(1)}s)</span>
                                <span>{SPEECH_TAIL_PAD.toFixed(1)}s</span>
                                <span>안전하게 ({TAIL_PAD_MAX.toFixed(1)}s)</span>
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            대사가 끝난 뒤 이만큼 더 듣고 나서 다음 대사로 건너뜁니다.
                            대사 끝이 잘려 들리면 올리고, 넘어가는 게 굼뜨면 내리세요.
                        </p>
                    </div>

                    {/* 대사 구간 자동 감지 ('대사만 재생'용 데이터를 전사 직후 자동 확보) */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">대사 구간 자동 감지</label>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">전사+분석이 끝나면 문장별 대사 끝 시각 감지를 자동 실행합니다. '대사만 재생'(반복 시 배경음악·무음 건너뛰기)을 바로 쓸 수 있게 됩니다. 영상당 감지 1회(전사 1회와 비슷한 비용)가 추가되며, 끄면 툴바 '대사만' 칩으로 필요할 때만 수동 실행합니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={config.speechAutoDetect}
                                onClick={() => updateField('speechAutoDetect', !config.speechAutoDetect)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${config.speechAutoDetect ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow transition-transform ${config.speechAutoDetect ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>
                    </div>

                    {/* 고급 설정 — 평소 접어 둔다. 키·테마·모델·재생 여유만 보이면 충분하고 아래는 바꿀 일이 드물다 */}
                    <div className="pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(v => !v)}
                            aria-expanded={showAdvanced}
                            className="w-full flex items-center justify-between gap-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        >
                            <span>고급 설정 <span className="font-medium text-slate-500 dark:text-slate-400">— 자유도 · 단어 폭 · 긴 영상 나누기 · 재청취 · 저작권 차단</span></span>
                            <ChevronDown size={16} className={`shrink-0 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                    {showAdvanced && (<>
                    {/* Temperature */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">받아쓰기 자유도 (temperature)</label>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">높을수록 유연한 해석</span>
                            </div>
                            <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-lg">{config.temperature.toFixed(2)}</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={config.temperature}
                                onChange={(e) => updateField('temperature', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-bold px-1">
                                <span>정밀 (0.0)</span>
                                <span>0.5</span>
                                <span>유연 (1.0)</span>
                            </div>
                        </div>
                    </div>

                    {/* TopP */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">단어 고르는 폭 (topP)</label>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">높을수록 풍부한 표현</span>
                            </div>
                            <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-lg">{config.topP.toFixed(2)}</span>
                        </div>
                        <div className="px-1">
                            <input
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={config.topP}
                                onChange={(e) => updateField('topP', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-bold px-1">
                                <span>집중 (0.0)</span>
                                <span>0.7</span>
                                <span>다양 (1.0)</span>
                            </div>
                        </div>
                    </div>

                    {/* Chunk Transcription */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">긴 영상 나눠 받아쓰기 (청크 분할)</label>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">긴 영상을 N분 단위로 나눠 전사합니다. 15분 이상 영상에서 전사 누락을 방지합니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={config.chunkEnabled}
                                onClick={() => updateField('chunkEnabled', !config.chunkEnabled)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${config.chunkEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow transition-transform ${config.chunkEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>

                        {config.chunkEnabled && (
                            <div className="space-y-3 pt-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">나누는 길이</label>
                                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-lg">{config.chunkMinutes}분</span>
                                </div>
                                <div className="px-1">
                                    <input
                                        type="range"
                                        min="5"
                                        max="30"
                                        step="5"
                                        value={config.chunkMinutes}
                                        onChange={(e) => updateField('chunkMinutes', parseInt(e.target.value, 10))}
                                        className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                    />
                                    <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-bold px-1">
                                        <span>5분</span>
                                        <span>10분</span>
                                        <span>20분</span>
                                        <span>30분</span>
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                    짧을수록 전사 정확도↑, 길수록 API 호출 횟수↓. 10분을 권장합니다.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Realign (정밀 타임스탬프) */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">정밀 타임스탬프 (재청취 정렬)</label>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">여러 문장이 한 타임스탬프로 뭉친 경우, 그 구간만 오디오를 다시 들어 문장별 실제 시각을 확보합니다. 문장별 하이라이트·구간반복이 정확해집니다. 뭉친 블록마다 API 호출이 한 번 더 들어갑니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={config.realignEnabled}
                                onClick={() => updateField('realignEnabled', !config.realignEnabled)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${config.realignEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow transition-transform ${config.realignEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>
                    </div>

                    {/* Anti-Recitation */}
                    <div className="space-y-4 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col pr-3">
                                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">저작권 차단 피하기 (RECITATION 방지)</label>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">노래/연설 등 저작권 차단 회피. 대사에 보이지 않는 분절 기호를 끼워 필터를 우회합니다. 최종 대본·타임라인엔 영향이 없습니다.</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={config.antiRecitation}
                                onClick={() => updateField('antiRecitation', !config.antiRecitation)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${config.antiRecitation ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
                            >
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow transition-transform ${config.antiRecitation ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </div>

                        {config.antiRecitation && (
                            <div className="space-y-4 pt-1">
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">분절 기호</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {MARKER_PRESETS.map((mk) => (
                                            <button
                                                key={mk}
                                                type="button"
                                                onClick={() => updateField('markerChar', mk)}
                                                className={`w-9 h-9 rounded-xl border text-base font-bold transition-all ${config.markerChar === mk
                                                    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
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
                                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-sm font-mono"
                                    />
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                        실제 가사/대사에 안 나오는 희귀 기호를 권장합니다. 흔한 글자(예: a, 1)를 넣으면 그 글자가 대본에서 지워질 수 있습니다.
                                    </p>
                                </div>

                                <div className="space-y-3 pt-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300">삽입 간격 (단어)</label>
                                        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-lg">{config.markerInterval}단어마다</span>
                                    </div>
                                    <div className="px-1">
                                        <input
                                            type="range"
                                            min="1"
                                            max="10"
                                            step="1"
                                            value={config.markerInterval}
                                            onChange={(e) => updateField('markerInterval', parseInt(e.target.value, 10))}
                                            className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                        />
                                        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-bold px-1">
                                            <span>촘촘 (1)</span>
                                            <span>2~3</span>
                                            <span>듬성 (10)</span>
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                        간격이 좁을수록 회피력↑(연속 일치를 더 잘게 끊음), 넓을수록 토큰 절약. 1~3단어를 권장합니다.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    </>)}

                    {/* 저장공간 */}
                    <div className="space-y-2 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300">
                                <HardDrive size={14} className="text-slate-500 dark:text-slate-400" /> 저장공간
                            </label>
                            {usage && (
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg">
                                    {formatBytes(usage.used)}{usage.quota ? ` / ${formatBytes(usage.quota)}` : ''} 사용
                                </span>
                            )}
                        </div>
                        {!confirmClear ? (
                            <button
                                type="button"
                                onClick={() => setConfirmClear(true)}
                                className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 dark:hover:text-amber-400 transition-all"
                            >
                                <Trash2 size={16} /> 영상 캐시 비우기
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setConfirmClear(false)}
                                    className="flex-1 px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                                >
                                    취소
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearVideoCache}
                                    disabled={clearing}
                                    className="flex-[2] px-4 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white dark:bg-amber-500/25 dark:hover:bg-amber-500/40 dark:text-amber-100 dark:border dark:border-amber-600 font-bold rounded-xl transition-all"
                                >
                                    {clearing ? '비우는 중...' : '정말 비우기 (되돌릴 수 없음)'}
                                </button>
                            </div>
                        )}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            기기에 저장된 영상 캐시를 모두 비웁니다. 대본·분석 기록은 유지되며, 클라우드 항목은 다시 열 때 재다운로드됩니다.
                        </p>
                    </div>

                    {/* 보관함 잠그기 / 암호 변경 */}
                    {onLockVault && (
                        <div className="space-y-2 pt-4 border-t border-slate-50 dark:border-slate-700/60">
                            <label className="text-sm font-bold text-slate-700 dark:text-slate-300">기기 간 공유 보관함</label>
                            <button
                                type="button"
                                onClick={onLockVault}
                                className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 transition-all"
                            >
                                <Lock size={16} /> 보관함 잠그기 / 암호 변경
                            </button>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                이 기기에 저장된 암호를 지우고 암호 입력창으로 돌아갑니다. 다른 암호를 넣어 다른 보관함으로 전환할 수 있어요. 클라우드에 저장된 대본은 지워지지 않습니다.
                            </p>
                        </div>
                    )}
                </div>

                <div className="p-4 sm:p-6 bg-slate-50 dark:bg-slate-900 flex gap-3">
                    <button
                        onClick={handleCancel}
                        className="flex-1 py-3 text-slate-600 dark:text-slate-300 font-bold hover:bg-white dark:hover:bg-slate-700 rounded-2xl transition-all"
                    >
                        바꾼 것 취소
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-[2] py-3 text-white font-bold rounded-2xl transition-all shadow-lg bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 dark:shadow-black/40"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
