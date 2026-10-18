// 지원 모델의 단일 출처(Single Source of Truth) — Gemini + Claude.
// 화면 표시(SettingsModal), Stage 2 동시성(useMediaAnalysis),
// 유효성 검사(gemini.js·useSettings)가 모두 이 목록을 참조한다. 모델 추가/변경 시 여기만 수정.
//
// 필드:
//  - id: API 모델 ID (Gemini 또는 Claude)
//  - provider: 'gemini'(기본) | 'claude'. Claude는 소리를 못 받아(2026-10-17 실측: audio/document/image 블록·
//    파일 API 참조 전부 400, 코드 실행 상자엔 받아쓰기 프로그램 없음+인터넷 차단) 글자만 다루는 2단계 분석 전용.
//  - stages: 이 모델을 고를 수 있는 단계 목록. 없으면 전 단계(stage1·stage2·stage3). Claude는 ['stage2']만 —
//    3단계(재전사·재분석)는 한 칸이 소리(재전사)와 글자(재분석)를 겸해서 Gemini로 둔다.
//  - name: 셀렉터에 표시되는 전체 이름
//  - shortName: 비교표에 표시되는 짧은 이름
//  - badge: 셀렉터 뱃지 라벨 ('' 이면 없음)
//  - notice: (선택) 뱃지 옆 경고 문구. 고르기 전에 알아야 할 것(예: 요금)
//  - stage2Concurrency: Stage 2(분석) 동시 요청 수
//  - thinkingLevel: (3.x 전용) 생각 단계. 3.x는 2.5의 thinkingBudget:0 대신 이 값으로 가장 낮게 내린다.
//    모델마다 허용 단계가 다르다(3.7/3.8은 'minimal' 없음 → 'low'). 없으면 모델 기본값.
//
// [2026-09 실측, 2분 30초 베트남어 영상] 목록이 전사·분석·재전사 공용이라, 분석만 잘하는 모델을
// 넣으면 전사용으로 잘못 고를 수 있다. 그래서 전사에서 문제가 난 모델은 뺐다.
//  - 3.8 Flash·3.5 Flash Lite: 여러 문장을 한 줄로 뭉침(최대 56~57단어). Lite는 시각도 ~9초 어긋남.
//  - 3.6 Flash: 5회 중 4회 뭉침(최대 37~55단어), 온도 1.0에선 3회 중 1회 오디오에 없는 말 8줄을 지어냄.
//    1분 이후 [HH:MM:SS.ms]로 쓰는 형식 이탈도 있었다(stage1Line.js가 이제 읽는다).
//  - 3.5 Flash: 어느 단계에서도 2.5 Flash보다 나은 점이 없는데 요금은 약 3배.
//  - 남긴 3.1 Flash Lite: 전사 5회 모두 안정, 문장 시작 오차 보통 0.1초(2.5 Flash 0.1~0.2초).
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
        // 2026-09 실측(10분 영상 환산): 2.5 Flash 약 210원 vs 2.5 Pro 약 1,670원. 생각 기능을 끌 수 없어 토큰도 1.6배.
        notice: '비쌈 · 8배', // 휴대폰 한 줄에 들어가게 짧게(기준: 2.5 Flash)
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
        id: 'gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash Lite',
        shortName: '3.1 Flash Lite',
        badge: '저렴',
        stage2Concurrency: 3,
        thinkingLevel: 'minimal', // 실측: minimal에서 생각 토큰 0, 400 오류 없음
        info: { s1: 'A', s2: 'A', rpm: '?', rpd: '?', desc: '시작 시각 가장 정확. 전사 요금 2.5 Flash의 약 절반' },
    },
    {
        // [2026-10-17 비교 시험] Circle K 25문장 + Gara 25문장 × 3회, 지시문 동일: 실패 0, 빠진 단어 0, 뭉침 0,
        // 풀이 누락 0, 슬랭(cành=천 동) 정답+⚡. Haiku는 뭉침 47/150·슬랭 오역, Opus는 2.4배 비싸고 전사의심만
        // 더 많음, Fable은 6배 비싸고 뭉침 10 → Sonnet 하나만 넣었다. 영상 1개(165문장) 약 $0.47(Flash $0.06).
        // 생각 단계는 끈다(thinking between_tools — 'disabled'는 400). temperature 등 샘플링 값은 보내지 않는다
        // (기본값이 아니면 400). 요금은 매달 받는 Max 요금제 API 크레딧에서 나간다.
        id: 'claude-sonnet-5-5',
        provider: 'claude',
        stages: ['stage2'],
        name: 'Claude Sonnet 5.5',
        shortName: 'Sonnet 5.5',
        badge: '크레딧',
        notice: '분석만 · 2.5 Flash의 8배',
        stage2Concurrency: 2, // 새 계정은 분당 요청 한도가 낮을 수 있어 Gemini(3)보다 하나 적게
        info: { s1: '-', s2: 'S', rpm: '50', rpd: '-', desc: '2단계 분석 전용. 단어 빠짐·뭉침 0(시험). 전사·재전사 불가' },
    },
];

// 유효성 검사용 ID 목록(전체). 단계별 목록은 modelsForStage / modelIdsForStage.
export const MODEL_IDS = MODELS.map(m => m.id);

export const providerOf = (modelId) => MODELS.find(m => m.id === modelId)?.provider || 'gemini';
export const isClaudeModel = (modelId) => providerOf(modelId) === 'claude';

// gemini.js가 Gemini API에 넘길 수 있는 ID만 — Claude ID가 전사 경로로 새어 들면 404가 난다
export const GEMINI_MODEL_IDS = MODELS.filter(m => m.provider !== 'claude').map(m => m.id);

// 단계('stage1'|'stage2'|'stage3')에서 고를 수 있는 모델 목록. stages가 없는 모델은 전 단계.
export function modelsForStage(stage) {
    return MODELS.filter(m => !m.stages || m.stages.includes(stage));
}
export const modelIdsForStage = (stage) => modelsForStage(stage).map(m => m.id);

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
