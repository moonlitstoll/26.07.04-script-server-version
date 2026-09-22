// 지원 Gemini 모델의 단일 출처(Single Source of Truth).
// 화면 표시(SettingsModal), Stage 2 동시성(useMediaAnalysis),
// 유효성 검사(gemini.js)가 모두 이 목록을 참조한다. 모델 추가/변경 시 여기만 수정.
//
// 필드:
//  - id: Gemini API 모델 ID
//  - name: 셀렉터에 표시되는 전체 이름
//  - shortName: 비교표에 표시되는 짧은 이름
//  - badge: 셀렉터 뱃지 라벨 ('' 이면 없음)
//  - notice: (선택) 뱃지 옆 경고 문구. 고르기 전에 알아야 할 것(예: 요금)
//  - stage2Concurrency: Stage 2(분석) 동시 요청 수
//  - thinkingLevel: (3.x 전용) 생각 단계. 3.x는 2.5의 thinkingBudget:0 대신 이 값으로 가장 낮게 내린다.
//    모델마다 허용 단계가 다르다(3.7/3.8은 'minimal' 없음 → 'low'). 없으면 모델 기본값.
//
// [2026-09 실측] 3.8 Flash·3.5 Flash Lite는 전사에서 여러 문장을 한 줄로 뭉쳐(최대 56~57단어)
// '1줄 1문장' 규칙을 어겨 제외했다(Lite는 시각도 ~9초 어긋남). 목록이 전사·분석·재전사 공용이라
// 분석만 잘하는 모델을 넣으면 전사용으로 잘못 고를 수 있다.
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
        // 2026-09 실측(2분 30초 영상): 3.6 Flash 47원 vs 2.5 Pro 299원. 생각 기능을 끌 수 없어 토큰도 1.6배.
        notice: '비쌈 · 3.6의 약 6배',
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
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        shortName: '3.5 Flash',
        badge: '',
        stage2Concurrency: 3,
        thinkingLevel: 'minimal',
        info: { s1: 'A', s2: 'A+', rpm: '1K', rpd: '10K', desc: '전사 2~3배 빠름. 숫자 병기 규칙 준수' },
    },
    {
        id: 'gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        shortName: '3.6 Flash',
        badge: '최신',
        stage2Concurrency: 3,
        thinkingLevel: 'minimal',
        info: { s1: 'A', s2: 'A+', rpm: '?', rpd: '?', desc: '실측 최상. 전사 빠르고 문장 분리 정확' },
    },
];

// gemini.js 유효성 검사용 ID 목록
export const MODEL_IDS = MODELS.map(m => m.id);

// 잘못된/미지정 모델일 때의 기본값
export const DEFAULT_MODEL_ID = 'gemini-2.5-flash';

// Stage 2(분석) 기본 동시 요청 수 (모델 미지정 시 폴백)
export const DEFAULT_STAGE2_CONCURRENCY = 3;

// Stage 2(분석) 동시 요청 수 — 모델별 차등 (Pro는 RPM 한도가 낮아 2)
export function getStage2Concurrency(modelId) {
    const m = MODELS.find(x => x.id === modelId);
    return m ? m.stage2Concurrency : DEFAULT_STAGE2_CONCURRENCY;
}

// 3.x 생각 단계 (없으면 null)
export function getThinkingLevel(modelId) {
    const m = MODELS.find(x => x.id === modelId);
    return m?.thinkingLevel || null;
}
