// 지원 Gemini 모델의 단일 출처(Single Source of Truth).
// 화면 표시(SettingsModal), Stage 2 동시성(useMediaAnalysis),
// 유효성 검사(gemini.js)가 모두 이 목록을 참조한다. 모델 추가/변경 시 여기만 수정.
//
// 필드:
//  - id: Gemini API 모델 ID
//  - name: 셀렉터에 표시되는 전체 이름
//  - shortName: 비교표에 표시되는 짧은 이름
//  - badge: 셀렉터 뱃지 라벨 ('' 이면 없음)
//  - stage2Concurrency: Stage 2(분석) 동시 요청 수
//  - info: 비교표용 { s1(전사등급), s2(분석등급), rpm, rpd, desc }

export const MODELS = [
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        shortName: '2.5 Flash',
        badge: '추천',
        stage2Concurrency: 3,
        info: { s1: 'A', s2: 'A', rpm: '1K', rpd: '10K', desc: '만능형 기본값. 전사/분석 균형' },
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        shortName: '2.5 Pro',
        badge: '최고품질',
        stage2Concurrency: 2,
        info: { s1: 'S', s2: 'S', rpm: '150', rpd: '1K', desc: '최고 품질. 긴 영상엔 한도 주의' },
    },
    {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        shortName: '2.5 Flash Lite',
        badge: '대량처리',
        stage2Concurrency: 3,
        info: { s1: 'B+', s2: 'A', rpm: '4K', rpd: '무제한', desc: '대량 배치에 최적. RPM 넉넉' },
    },
    {
        id: 'gemini-2-flash',
        name: 'Gemini 2 Flash',
        shortName: '2 Flash',
        badge: '',
        stage2Concurrency: 3,
        info: { s1: 'A-', s2: 'B+', rpm: '2K', rpd: '무제한', desc: '안정적 폴백용' },
    },
    {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        shortName: '3.5 Flash',
        badge: '최신',
        stage2Concurrency: 3,
        info: { s1: '?', s2: 'A+', rpm: '1K', rpd: '10K', desc: '최신 모델. 전사 안정성 미검증' },
    },
];

// gemini.js 유효성 검사용 ID 목록
export const MODEL_IDS = MODELS.map(m => m.id);

// 잘못된/미지정 모델일 때의 기본값
export const DEFAULT_MODEL_ID = 'gemini-2.5-flash';

// Stage 2(분석) 동시 요청 수 — 모델별 차등 (Pro는 RPM 한도가 낮아 2)
export function getStage2Concurrency(modelId) {
    const m = MODELS.find(x => x.id === modelId);
    return m ? m.stage2Concurrency : 3;
}
