import fs from 'fs';
import path from 'path';

const UA = 'D:/0. 클로드연습용/0. 개인용/26.07.08 대본 완성본/media-analyzer/.ua/intermediate';
const extract = JSON.parse(fs.readFileSync('D:/0. 클로드연습용/0. 개인용/26.07.08 대본 완성본/media-analyzer/.understand-anything/tmp/ua-file-extract-results-2.json', 'utf8'));

const batchImportData = {
  'src/constants/models.js': [],
  'src/hooks/useMediaAnalysis.js': [
    'src/constants/models.js', 'src/services/cloudSync.js', 'src/services/gemini.js',
    'src/utils/MediaStore.js', 'src/utils/cacheUtils.js', 'src/utils/materializeFile.js',
    'src/utils/mediaUtils.js', 'src/utils/trashUtils.js',
  ],
  'src/services/gemini.js': [
    'src/constants/models.js', 'src/services/prompts.js', 'src/utils/audioExtractor.js',
    'src/utils/languageUtils.js', 'src/utils/sentenceSplitter.js',
  ],
  'src/services/prompts.js': [],
  'src/utils/audioExtractor.js': [],
  'src/utils/cacheUtils.js': ['src/services/prompts.js', 'src/utils/cacheStatus.js'],
  'src/utils/languageUtils.js': [],
  'src/utils/materializeFile.js': [],
  'src/utils/sentenceSplitter.js': [],
  'src/utils/trashUtils.js': [],
};

const fileMeta = {
  'src/constants/models.js': {
    summary: 'Gemini 모델 ID·메타데이터 상수와 Stage 2 배치 동시성을 모델별로 반환하는 헬퍼를 정의한다.',
    tags: ['configuration', 'constants', 'gemini', 'model-selection'],
    complexity: 'simple',
  },
  'src/hooks/useMediaAnalysis.js': {
    summary: '미디어 업로드·Stage1/2 분석·캐시·클라우드 동기화·재전사·휴지통 연동을 캡슐화하는 핵심 React 훅으로 순차 분석 큐를 관리한다.',
    tags: ['hook', 'analysis-pipeline', 'state-management', 'queue'],
    complexity: 'complex',
    languageNotes: 'useRef 기반 AbortController와 analysisQueueRef로 다중 파일 직렬 분석을 구현.',
  },
  'src/services/gemini.js': {
    summary: 'Gemini API 2단계 파이프라인(전사·배치 분석)의 핵심 서비스로 File API 업로드, 청크 전사, 중복 제거, 재전사, 스트리밍 파싱을 담당한다.',
    tags: ['service', 'gemini-api', 'transcription', 'analysis'],
    complexity: 'complex',
    languageNotes: 'Stage1 스트리밍 응답 증분 파싱과 anti-recitation 마커 처리, 청크 오버랩 deduplicateOverlap 내장.',
  },
  'src/services/prompts.js': {
    summary: 'Stage1 전사·Stage2 배치 분석용 Gemini 프롬프트 문자열과 분석 버전 상수를 보관한다.',
    tags: ['prompts', 'gemini', 'configuration', 'analysis-rules'],
    complexity: 'simple',
  },
  'src/utils/audioExtractor.js': {
    summary: 'FFmpeg.wasm으로 오디오 추출·WAV 인코딩·청크 분할·구간 캡처·무음 스냅을 수행하는 브라우저 오디오 처리 유틸리티.',
    tags: ['utility', 'ffmpeg', 'audio', 'wasm'],
    complexity: 'complex',
  },
  'src/utils/cacheUtils.js': {
    summary: 'localStorage 기반 전사·분석 캐시 엔트리의 파싱·저장·버전 만료 검사를 제공한다.',
    tags: ['utility', 'cache', 'localStorage', 'persistence'],
    complexity: 'simple',
  },
  'src/utils/languageUtils.js': {
    summary: '전사 텍스트의 행 내 반복(환각) 축약과 한국어·베트남어 등 언어 감지 헬퍼를 제공한다.',
    tags: ['utility', 'language', 'hallucination-filter'],
    complexity: 'moderate',
  },
  'src/utils/materializeFile.js': {
    summary: 'iOS 등 환경에서 File/Blob을 분석 가능한 실제 바이트로 materialize하는 다중 전략 헬퍼.',
    tags: ['utility', 'file-io', 'ios-compat'],
    complexity: 'moderate',
  },
  'src/utils/sentenceSplitter.js': {
    summary: '전사 블록을 문장 단위로 분할·병합·미세 조각 통합·재분할하는 텍스트 후처리 유틸리티.',
    tags: ['utility', 'text-processing', 'transcription'],
    complexity: 'moderate',
  },
  'src/utils/trashUtils.js': {
    summary: '삭제된 문장을 파일별 localStorage 휴지통에 저장·복구·비우는 CRUD 헬퍼.',
    tags: ['utility', 'trash', 'localStorage', 'sentence-management'],
    complexity: 'simple',
  },
};

const fnMeta = {
  'src/constants/models.js:getStage2Concurrency': { summary: '모델 ID에 따라 Stage2 동시 요청 수(Pro 2, 기타 3)를 반환한다.', tags: ['helper', 'concurrency', 'model-config'], complexity: 'simple' },
  'src/hooks/useMediaAnalysis.js:isLumpedAnalysis': { summary: '분석 문자열이 구버전 lumped 형식인지 판별해 재분할 필요 여부를 결정한다.', tags: ['validation', 'migration'], complexity: 'simple' },
  'src/hooks/useMediaAnalysis.js:useMediaAnalysis': { summary: '파일 업로드부터 Stage1/2 실행, 캐시·클라우드·재전사·휴지통까지 전체 미디어 분석 워크플로를 노출하는 메인 훅.', tags: ['hook', 'orchestration', 'analysis-pipeline'], complexity: 'complex' },
  'src/services/gemini.js:sentenceSim': { summary: '두 문장의 단어 겹침 비율로 유사도를 계산해 경계 중복 판별에 사용한다.', tags: ['similarity', 'deduplication'], complexity: 'simple' },
  'src/services/gemini.js:trimBoundaryOverlap': { summary: '청크 경계에서 이전·다음 블록과 겹치는 문장을 잘라 중복 전사를 제거한다.', tags: ['deduplication', 'chunking'], complexity: 'moderate' },
  'src/services/gemini.js:isBoundaryLeakFragment': { summary: '짧은 조각이 인접 블록 텍스트에 포함되는 경계 누수(fragment)인지 검사한다.', tags: ['validation', 'chunking'], complexity: 'simple' },
  'src/services/gemini.js:blobToInlinePart': { summary: 'Blob을 base64 inlineData Gemini Part로 변환한다.', tags: ['gemini-api', 'encoding'], complexity: 'simple' },
  'src/services/gemini.js:uploadToGemini': { summary: '15MB 초과 오디오를 Gemini File API multipart 업로드 후 PROCESSING 폴링으로 URI를 확보한다.', tags: ['gemini-api', 'file-upload'], complexity: 'moderate' },
  'src/services/gemini.js:extractAudioBlob': { summary: '미디어 파일에서 FFmpeg로 WAV 오디오 Blob을 추출하거나 실패 시 원본을 반환한다.', tags: ['audio', 'ffmpeg'], complexity: 'simple' },
  'src/services/gemini.js:blobToGeminiPart': { summary: '크기에 따라 inlineData 또는 File API 업로드 방식으로 Gemini Part를 생성한다.', tags: ['gemini-api', 'routing'], complexity: 'simple' },
  'src/services/gemini.js:deduplicateOverlap': { summary: '청크 오버랩 구간의 중복 타임스탬프 문장을 유사도 기반으로 병합·제거한다.', tags: ['deduplication', 'chunking'], complexity: 'moderate' },
  'src/services/gemini.js:buildStage1Prompt': { summary: '전사 옵션(길이, anti-recitation 마커, 받아쓰기 재프레이밍)을 반영한 Stage1 프롬프트를 조립한다.', tags: ['prompt', 'transcription'], complexity: 'moderate' },
  'src/services/gemini.js:transcribeStream': { summary: 'Gemini 스트리밍 전사 응답을 줄 단위 파싱하며 환각·역행·종료 마커 방어 로직을 적용한다.', tags: ['streaming', 'transcription', 'parsing'], complexity: 'complex' },
  'src/services/gemini.js:realignMergedBlocks': { summary: '병합된 전사 블록의 타임스탬프·텍스트 정렬을 재조정한다.', tags: ['alignment', 'post-processing'], complexity: 'moderate' },
  'src/services/gemini.js:retranscribeSegments': { summary: '지정 구간 윈도우별로 오디오를 캡처해 부분 재전사하고 결과를 기존 대본에 병합한다.', tags: ['retranscription', 'segment'], complexity: 'complex' },
  'src/services/gemini.js:extractTranscript': { summary: '단일/청크 분할 Stage1 전사 파이프라인 진입점으로 스트리밍·dedup·문장 분할까지 orchestrate한다.', tags: ['transcription', 'pipeline', 'entry-point'], complexity: 'complex' },
  'src/services/gemini.js:analyzeBatchSentences': { summary: '최대 25문장 배치로 Stage2 번역·의미 청크 분석을 병렬 요청하고 마커 형식 응답을 파싱한다.', tags: ['analysis', 'batching', 'gemini-api'], complexity: 'complex' },
  'src/utils/audioExtractor.js:getFFmpeg': { summary: 'FFmpeg.wasm 싱글톤 인스턴스를 lazy-load하고 코어·wasm URL을 설정한다.', tags: ['ffmpeg', 'singleton', 'wasm'], complexity: 'simple' },
  'src/utils/audioExtractor.js:encodeWAV': { summary: 'Float32 PCM 채널 데이터를 16-bit WAV ArrayBuffer로 인코딩한다.', tags: ['audio', 'encoding', 'wav'], complexity: 'simple' },
  'src/utils/audioExtractor.js:extractAudioWav': { summary: '미디어 파일을 디코드해 전체 길이 WAV Blob으로 변환한다.', tags: ['audio', 'extraction'], complexity: 'moderate' },
  'src/utils/audioExtractor.js:splitAudio': { summary: 'WAV Blob을 N분 단위 청크로 무변환(copy) 분할하고 30초 오버랩을 적용한다.', tags: ['chunking', 'audio'], complexity: 'moderate' },
  'src/utils/audioExtractor.js:parseWavHeader': { summary: 'WAV 헤더에서 샘플레이트·채널·비트 깊이 메타데이터를 파싱한다.', tags: ['wav', 'parsing'], complexity: 'simple' },
  'src/utils/audioExtractor.js:sliceWavBlob': { summary: 'WAV Blob에서 지정 샘플 구간만 잘라 새 WAV Blob을 생성한다.', tags: ['wav', 'slicing'], complexity: 'simple' },
  'src/utils/audioExtractor.js:extractSegmentWav': { summary: '시작·종료 초 기준으로 오디오 구간 WAV를 FFmpeg로 추출한다.', tags: ['segment', 'extraction'], complexity: 'moderate' },
  'src/utils/audioExtractor.js:snapSegmentToSilence': { summary: '구간 경계를 주변 무음 지점으로 스냅해 자연스러운 재전사 구간을 만든다.', tags: ['silence-detection', 'segment'], complexity: 'moderate' },
  'src/utils/audioExtractor.js:captureSegmentWav': { summary: '재생 중 ScriptProcessor로 실시간 PCM을 캡처해 구간 WAV를 생성한다(autoplay 차단 폴백 포함).', tags: ['capture', 'realtime', 'audio'], complexity: 'complex' },
  'src/utils/audioExtractor.js:extractOriginalAudio': { summary: '비디오에서 오디오 트랙만 demux하여 원본 코덱 Blob으로 추출한다.', tags: ['demux', 'video', 'audio'], complexity: 'moderate' },
  'src/utils/cacheUtils.js:isCacheStale': { summary: '캐시 엔트리의 ANALYSIS_VERSION이 현재 버전과 다르면 stale로 판정한다.', tags: ['cache', 'versioning'], complexity: 'simple' },
  'src/utils/cacheUtils.js:parseCacheEntry': { summary: 'localStorage JSON을 파싱해 transcript·메타·캐시 상태를 정규화된 객체로 반환한다.', tags: ['cache', 'parsing'], complexity: 'simple' },
  'src/utils/cacheUtils.js:saveCacheEntry': { summary: '전사·분석 결과를 gemini_analysis 키로 localStorage에 저장하고 quota 초과 시 경고한다.', tags: ['cache', 'persistence'], complexity: 'simple' },
  'src/utils/languageUtils.js:collapseConsecutiveRepeats': { summary: '토큰 시퀀스에서 연속 반복 n-gram을 축약해 환각성 반복을 제거한다.', tags: ['hallucination-filter', 'text-processing'], complexity: 'moderate' },
  'src/utils/languageUtils.js:analyzeIntraLineRepetition': { summary: '한 줄 전사 텍스트 내 반복 패턴을 감지·축약해 Stage1 파싱 품질을 높인다.', tags: ['hallucination-filter', 'transcription'], complexity: 'simple' },
  'src/utils/languageUtils.js:detectLanguage': { summary: '한글·베트남어 정규식으로 텍스트 주 언어를 ko/vi/unknown 중 하나로 추정한다.', tags: ['language-detection', 'i18n'], complexity: 'simple' },
  'src/utils/materializeFile.js:viaFileReader': { summary: 'FileReader로 File을 ArrayBuffer로 읽어 새 File 객체를 생성한다.', tags: ['file-io', 'fallback'], complexity: 'simple' },
  'src/utils/materializeFile.js:viaObjectUrl': { summary: 'Object URL fetch로 Blob 바이트를 materialize하는 전략.', tags: ['file-io', 'fetch'], complexity: 'simple' },
  'src/utils/materializeFile.js:materializeFile': { summary: '여러 전략을 순차 시도해 분석 가능한 File/Blob을 보장하고 iOS 대기 콜백을 지원한다.', tags: ['file-io', 'ios-compat', 'entry-point'], complexity: 'moderate' },
  'src/utils/sentenceSplitter.js:splitIntoSentences': { summary: '마침표·물음표·느낌표 기준으로 텍스트를 문장 배열로 분할한다.', tags: ['text-processing', 'sentence'], complexity: 'simple' },
  'src/utils/sentenceSplitter.js:groupSentences': { summary: '짧은 문장들을 인접 그룹으로 묶어 의미 단위 블록을 만든다.', tags: ['text-processing', 'grouping'], complexity: 'simple' },
  'src/utils/sentenceSplitter.js:mergeTinyFragments': { summary: '너무 짧은 전사 조각을 인접 문장과 병합해 가독성을 높인다.', tags: ['text-processing', 'merge'], complexity: 'moderate' },
  'src/utils/sentenceSplitter.js:splitMergedSentences': { summary: '한 줄에 합쳐진 다중 문장을 다시 개별 항목으로 분리한다.', tags: ['text-processing', 'split'], complexity: 'simple' },
  'src/utils/trashUtils.js:sentenceKey': { summary: '초·텍스트 앞 24자로 문장의 안정적인 휴지통 키를 생성한다.', tags: ['identifier', 'trash'], complexity: 'simple' },
  'src/utils/trashUtils.js:getTrash': { summary: '파일명·크기별 localStorage 휴지통 항목 배열을 로드한다.', tags: ['trash', 'localStorage'], complexity: 'simple' },
  'src/utils/trashUtils.js:addToTrash': { summary: '삭제 문장을 휴지통에 추가하고 중복 키를 dedupe한다.', tags: ['trash', 'crud'], complexity: 'simple' },
  'src/utils/trashUtils.js:removeFromTrash': { summary: '휴지통에서 특정 문장 키를 제거(복구)한다.', tags: ['trash', 'crud'], complexity: 'simple' },
  'src/utils/trashUtils.js:clearTrash': { summary: '파일별 휴지통 localStorage 키를 삭제한다.', tags: ['trash', 'cleanup'], complexity: 'simple' },
};

const nodes = [];
const edges = [];

for (const [fp, meta] of Object.entries(fileMeta)) {
  nodes.push({
    id: `file:${fp}`,
    type: 'file',
    name: path.basename(fp),
    filePath: fp,
    summary: meta.summary,
    tags: meta.tags,
    complexity: meta.complexity,
    ...(meta.languageNotes ? { languageNotes: meta.languageNotes } : {}),
  });
}

for (const r of extract.results) {
  const funcs = r.functions || [];
  const exports = r.exports || [];
  for (const f of funcs) {
    const lines = f.endLine - f.startLine + 1;
    const isExported = exports.some((e) => e.name === f.name);
    if (lines < 10 && !isExported) continue;
    const key = `${r.path}:${f.name}`;
    const meta = fnMeta[key] || {
      summary: `${f.name} 함수.`,
      tags: ['utility'],
      complexity: lines >= 50 ? 'complex' : lines >= 20 ? 'moderate' : 'simple',
    };
    nodes.push({
      id: `function:${r.path}:${f.name}`,
      type: 'function',
      name: f.name,
      filePath: r.path,
      lineRange: [f.startLine, f.endLine],
      summary: meta.summary,
      tags: meta.tags,
      complexity: meta.complexity,
    });
    edges.push({ source: `file:${r.path}`, target: `function:${r.path}:${f.name}`, type: 'contains', direction: 'forward', weight: 1.0 });
    if (isExported) {
      edges.push({ source: `file:${r.path}`, target: `function:${r.path}:${f.name}`, type: 'exports', direction: 'forward', weight: 0.8 });
    }
  }
}

for (const [src, targets] of Object.entries(batchImportData)) {
  for (const t of targets) {
    edges.push({ source: `file:${src}`, target: `file:${t}`, type: 'imports', direction: 'forward', weight: 0.7 });
  }
}

const calls = [
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/constants/models.js:getStage2Concurrency'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/services/gemini.js:extractTranscript'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/services/gemini.js:analyzeBatchSentences'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/services/gemini.js:retranscribeSegments'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/services/gemini.js:deduplicateOverlap'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/cacheUtils.js:saveCacheEntry'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/cacheUtils.js:parseCacheEntry'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/materializeFile.js:materializeFile'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/trashUtils.js:addToTrash'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/trashUtils.js:removeFromTrash'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/trashUtils.js:sentenceKey'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/mediaUtils.js:getMediaDuration'],
  ['function:src/hooks/useMediaAnalysis.js:useMediaAnalysis', 'function:src/utils/mediaUtils.js:sanitizeData'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/utils/audioExtractor.js:splitAudio'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/utils/audioExtractor.js:extractAudioWav'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/utils/audioExtractor.js:extractOriginalAudio'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/services/gemini.js:deduplicateOverlap'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/services/gemini.js:transcribeStream'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/utils/sentenceSplitter.js:splitIntoSentences'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/utils/sentenceSplitter.js:groupSentences'],
  ['function:src/services/gemini.js:extractTranscript', 'function:src/utils/sentenceSplitter.js:mergeTinyFragments'],
  ['function:src/services/gemini.js:retranscribeSegments', 'function:src/utils/audioExtractor.js:extractSegmentWav'],
  ['function:src/services/gemini.js:retranscribeSegments', 'function:src/utils/audioExtractor.js:captureSegmentWav'],
  ['function:src/services/gemini.js:retranscribeSegments', 'function:src/utils/audioExtractor.js:snapSegmentToSilence'],
  ['function:src/services/gemini.js:retranscribeSegments', 'function:src/utils/sentenceSplitter.js:splitMergedSentences'],
  ['function:src/services/gemini.js:transcribeStream', 'function:src/utils/languageUtils.js:analyzeIntraLineRepetition'],
  ['function:src/services/gemini.js:blobToGeminiPart', 'function:src/services/gemini.js:uploadToGemini'],
  ['function:src/services/gemini.js:blobToGeminiPart', 'function:src/services/gemini.js:blobToInlinePart'],
  ['function:src/services/gemini.js:extractAudioBlob', 'function:src/utils/audioExtractor.js:extractAudioWav'],
  ['function:src/services/gemini.js:extractAudioBlob', 'function:src/utils/audioExtractor.js:extractOriginalAudio'],
  ['function:src/services/gemini.js:analyzeBatchSentences', 'function:src/constants/models.js:getStage2Concurrency'],
  ['function:src/utils/cacheUtils.js:parseCacheEntry', 'function:src/utils/cacheStatus.js:getCacheDisplayName'],
  ['function:src/utils/cacheUtils.js:isCacheStale', 'file:src/services/prompts.js'],
  ['function:src/services/gemini.js:buildStage1Prompt', 'file:src/services/prompts.js'],
  ['function:src/services/gemini.js:analyzeBatchSentences', 'file:src/services/prompts.js'],
  ['function:src/hooks/useMediaAnalysis.js:isLumpedAnalysis', 'file:src/services/prompts.js'],
];
for (const [s, t] of calls) {
  edges.push({ source: s, target: t, type: 'calls', direction: 'forward', weight: 0.8 });
}

edges.push({ source: 'file:src/services/gemini.js', target: 'file:src/services/prompts.js', type: 'depends_on', direction: 'forward', weight: 0.6 });

fs.mkdirSync(UA, { recursive: true });
const outPath = path.join(UA, 'batch-2.json');
fs.writeFileSync(outPath, JSON.stringify({ nodes, edges }, null, 2));

const importCount = edges.filter((e) => e.type === 'imports').length;
const expectedImports = Object.values(batchImportData).reduce((a, b) => a + b.length, 0);
console.log(JSON.stringify({ nodes: nodes.length, edges: edges.length, imports: importCount, expectedImports, path: outPath }));
