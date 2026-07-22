# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Media Analyzer (AI Shadowing Helper)** - Google Gemini AI 기반 오디오/비디오 분석 웹앱으로, 외국어 쉐도잉 학습을 위한 전사(transcription) 및 문장별 심층 분석 도구입니다. 주 타겟 언어는 베트남어-한국어이며, 다국어를 지원합니다.

## Commands

All commands run from this directory (`media-analyzer/`, the git repository root):

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (Vite)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm test           # vitest 1회 실행
npm run test:watch # vitest 감시 모드
npx vitest run src/utils/__tests__/speechSegments.test.js   # 파일 하나만
```

### 테스트 (`src/utils/__tests__/`)

순수 함수 유틸만 덮는다 — `speechSegments`(경계 계산), `mediaUtils`의 `graftSpeechEnds`(감지결과 구제), `clozeUtils`(출제), `analysisCoverage`(대본 검증). 재생 엔진·훅·서비스는 브라우저/타이밍 의존이라 여기서 못 잡는다(수동 확인 필요).

**테스트가 실제로 코드를 보는지 반드시 확인할 것.** 실제로 물린 적 있다:

- **사본을 import 하면 안 된다.** 예전 테스트가 스크래치패드 사본을 읽어서, 소스의 `SPEECH_TAIL_PAD`를 0.4→0.8로 바꿔도 그대로 통과했다. 반드시 상대경로로 실제 소스를 import 할 것.
- **단정에 상수를 그대로 쓰면 무의미해진다.** `validSpeechEnd(...10 + MIN_SPEECH_SEC)` 같은 단정은 기준을 되돌려도 같이 움직여 버그를 못 잡는다. **경계 회귀는 실측 사례를 숫자로 박아둘 것** (예: `{seconds:272.6, speechEnd:272.8}` = "À.", 04:32 구간).
- 검증 방법: 상수를 일부러 옛 값으로 되돌리고 `npm test`가 **실패하는지** 본다. 4개 변이(`SPEECH_TAIL_PAD`/`MIN_SPEECH_SEC`/`GAP_SKIP_MIN`/graft 덮어쓰기 가드)가 각각 잡히는 것을 확인해 뒀다.

**알려진 공백**: `gemini.js`의 응답 파서와 `useMediaAnalysis`의 감지 병합 로직은 함수로 분리돼 있지 않아 테스트가 없다. 예전엔 로직을 복제해 테스트했는데, 그건 사본을 검증하는 셈이라 폐기했다.

배포: **Vercel이 main 브랜치 푸시를 자동 배포한다.** `git push origin main`이 곧 배포다.
(`npm run deploy`는 안내 메시지만 출력하고 종료. `gh-pages` 브랜치는 옛 방식의 잔재 — 사용 안 함.)

## Architecture

### Two-Stage AI Pipeline (핵심 아키텍처)

분석은 2단계 파이프라인으로 처리됩니다:

- **Stage 1 (전사/Transcription)**: `services/gemini.js#extractTranscript` - 미디어 파일을 Gemini에 전송하여 타임스탬프 기반 전사. 스트리밍 응답을 증분 파싱하며, 환각(hallucination) 방지를 위한 3중 방어망(중복 감지, 역행 방지, 종료 마커 검증) 내장. 함수 시그니처는 `(file, apiKey, modelId, options)` — options 객체에 totalDuration, temperature, topP, signal, antiRecitation, chunkEnabled, chunkMinutes 등 포함.
- **Stage 2 (분석/Analysis)**: `services/gemini.js#analyzeBatchSentences` - 전사된 문장들을 25개씩 배칭하여 번역+의미 청크 분석. 동시 요청 수는 모델별 차등(Pro: 2, 기타: 3). 분석 결과 파싱 정규식은 `ANALYSIS_PREFIX_STRIP` 모듈 레벨 상수로 통합. 2.5 모델은 `thinkingBudget: 0`으로 불필요한 생각 토큰 절약. **주의: 9대 분석 규칙과 출력 형식 마커(`--- [INDEX] START/END ---`)는 반드시 user prompt에 포함해야 함. systemInstruction으로 옮기면 모델이 마커 형식을 따르지 않아 파싱 실패 발생.**

프롬프트는 `services/prompts.js`에 분리되어 있으며, 9대 분석 규칙(의미 청크 통합, 한자 병기 금지, 미니멀리즘 등)이 핵심입니다. Stage 1 프롬프트에는 번역 금지 규칙과 1줄 1문장 철칙이 포함됩니다.

### 대용량 파일 지원 (File API + 청크 분할)

- **File API 자동 전환**: `gemini.js#blobToGeminiPart` — 오디오 15MB 이하는 inlineData(base64), 초과 시 Gemini File API로 Google 서버에 업로드 후 URI 참조. `uploadToGemini`가 multipart REST 호출 + PROCESSING 상태 폴링 처리. 실패 시 inlineData 폴백.
- **청크 분할 전사**: 설정에서 활성화 가능 (기본 OFF). 긴 영상을 N분(5~30분, 기본 10분) 단위로 FFmpeg 분할 후 순차 전사. 30초 오버랩으로 경계 문장 유실 방지, `deduplicateOverlap`으로 중복 제거. `audioExtractor.js#splitAudio`가 무변환(copy) 분할 담당.
- **오디오 추출 분리**: `extractAudioBlob` (FFmpeg demux) → `blobToGeminiPart` (크기별 전달 방식 선택) 2단계로 분리되어 청크/단일 패스 모두 공유.

### Anti-RECITATION Mode (저작권 필터 회피)

`gemini.js#buildStage1Prompt` - 노래/연설 등 Gemini RECITATION 필터에 걸리는 콘텐츠를 위한 옵션 모드:
- **분절 기호 삽입**: 전사 본문의 단어 사이에 지정 기호(※ 등)를 N단어마다 삽입 → 연속 일치를 끊어 필터 우회
- **받아쓰기 재프레이밍**: 프롬프트를 "전사"가 아닌 "청취 받아쓰기 연습"으로 재정의
- 파싱 시 `makeMarkerStripper`로 기호 자동 제거 → 최종 대본에 흔적 없음
- 설정: `antiRecitation`(on/off), `markerChar`(기호 문자), `markerInterval`(삽입 간격)

### Audio Extraction

`utils/audioExtractor.js` - FFmpeg.wasm 싱글스레드:
- `extractOriginalAudio` — 비디오에서 오디오 트랙을 무변환(demuxing) 적출. SharedArrayBuffer 불필요. 실패 시 원본 파일 그대로 전송하는 폴백 존재.
- `splitAudio` — 오디오 Blob을 시간 기준으로 청크 분할 (무변환 copy). 청크 분할 전사에서 사용.

### 학습 기능 (가리기 학습/클로즈 + 오답 복습)

Stage 2가 만든 **의미 청크**(`item.analysis`의 `**원어 청크**: 뜻` 줄)를 재료로 하는 학습 드릴. 상단 툴바 토글로 켠다. 이 앱만의 자산인 '한 번에 따라 말하는 덩어리(청크)' 데이터가 빈칸의 재료다.

- **파싱/출제**: `utils/analysisParser.js#parseChunks`가 analysis 문자열을 `[{chunk, meaning}]`로. `utils/clozeUtils.js#buildCloze`가 시드(`idx + round + difficulty`) 기반 `mulberry32` 난수로 가릴 청크 선택 — **초급 1~2개 / 중급 절반 이상~(N-1)개 / 고급 전체 / 회상 전체+번역 단서**, 초·중급은 최소 1청크 문맥 유지. 시드 덕에 토글을 껐다 켜도 같은 문제, '새 문제'(`drillRound++`)나 난이도 변경 때만 재섞임. 회상 모드는 `buildCloze`의 `recall` 플래그로 `ClozeDrill`이 번역 단서 박스를 렌더(뜻→원어 산출 연습) — 단서 박스는 stopPropagation 필수(안 하면 onJump로 정답 음성 누설).
- **드릴 UI**: `components/ClozeDrill.jsx` — 빈칸 탭→공개(채점 없음, 공개된 청크 다시 탭하면 재가리기 토글), 전부 공개되면 알았음/몰랐음 자가표시. `TranscriptItem`이 `drillMode`일 때 원문/분석 대신 `ClozeDrill`을 렌더하므로 정답지(분석)가 자동으로 숨겨짐. round/difficulty 변경 시 `key`로 remount해 공개/표시 상태 초기화.
- **오답 복습**: '몰랐음'=오답. 문장 앞 ❗배지 + '오답만 보기' 토글(오답 문장만 렌더 + 반복 강제 ON + 하단 이전/다음이 오답만 순회·순환). `App.jsx`의 `goNext`/`goPrev`가 `mistakeOnly`면 `wrongIndices`(**원래 인덱스**)만 순회하고, 키보드 ←/→와 MediaSession도 동일 함수를 경유(3경로 동기화). '새 문제'는 `clearFile`로 이 영상 오답 기록도 초기화.
- **주의 — 리뷰로 확정·수정된 4대 함정**: ①걸러진 목록에서 원래 인덱스 보존(`return null`), ②오답0/정복 화면 탈출 경로('오답만 보기' 버튼은 `mistakeOnly`인 동안 유지 + 정복 화면 '돌아가기' 버튼 + 파일 전환 시 리셋), ③키보드/버튼/MediaSession 동일 네비게이션, ④점프 시 반복 타겟 재조준(`jumpToSentence`가 `loopTargetIdxRef` 갱신).

### 대본 정확도 자기 검증 (커버리지 검사 + 전사의심)

- **분석 커버리지 검사(비용 0)**: `utils/analysisCoverage.js#checkAnalysisCoverage` — 원문 단어↔청크 대조(규칙 9)와 뭉침(문장 전체=1청크 또는 10단어↑ 청크, 숫자 병기 청크는 길이 검사 제외) 감지. **뭉침 길이 기준이 느슨한(10) 이유: 공식 예시에 7단어 청크가 있고, 베트남어 띄어쓰기는 음절 단위라 겹단어가 2칸으로 세어져 부풀려짐(실사용 오탐 2건으로 8→10 완화). 심한 뭉침은 문장전체=1청크 검사와 분석 시점 60% 편중 자동재분할이 담당.** TranscriptItem 헤더 배지(누락 N/뭉침/분석 깨짐) → 탭 시 확인창 후 1문장 재분석. 옛 캐시에도 소급 표시.
- **전사의심(규칙 15, 선택 출력)**: Stage 2가 문맥상 오전사 의심 문장에 `[전사의심] 이유` 한 줄 추가 → 파서가 `transcriptSuspect`로 추출(없으면 빈 값, 옛 캐시 완전 호환 → **ANALYSIS_VERSION 불변**). 배지 탭 → 확인창 후 그 구간만 재전사. **주의: 새 문장 필드는 `sanitizeData`(mediaUtils)의 반환 객체에 명시적으로 넣어야 캐시 재로드에서 살아남는다** (화이트리스트 방식이라 빠지면 유실).

### 대사만 재생 (Speech-Only Loop)

- **데이터**: 문장 필드 `speechEnd`(대사 실제 끝 시각, 초) — `gemini.js#detectSpeechEnds`가 기존 대본+오디오를 보내 끝 시각만 받는 **완전 별도 패스**로 취득(Stage 1/2 형식 불변). `useMediaAnalysis#detectSpeechEndsForFile`이 실행: 최신 상태에 병합(감지 중 Stage 2 진행분 안 덮음), 문장별 seconds 일치 검사, 시작+MIN_SPEECH_SEC(0.05s)/지속 MAX_SENTENCE_SEC(60s)/영상 길이 클램프. `sanitizeData`가 숫자일 때만 통과. **주의: `endSeconds`(seconds+3 조작값)와 별개 필드 — endSeconds는 여전히 신뢰 금지.**
- **엔진**: `utils/speechSegments.js` 순수 함수가 유일한 경계 계산원 — **간격 3초(GAP_SKIP_MIN) 초과일 때만 건너뜀**(겹치는 대사·짧은 정적은 그대로 이어 재생 = 병합 로직 불필요), 끝쪽 패딩은 **설정값**(`speechTailPad`, 기본 `SPEECH_TAIL_PAD` = 0.5, 슬라이더 0.2~0.9). **이 값이 곧 '대사 잘림 안전 여유'다** — 건너뛰기는 정확히 `대사끝 + PAD`에서 발동하므로 모델이 그보다 이르게 답한 만큼 대사가 잘린다. `GAP_SKIP_MIN`(3초)은 *어디를* 건너뛸지 고르는 기준일 뿐 잘림 여유가 아니다(혼동 주의 — 실제로 한 번 헷갈려서 "여유 3.4초"라고 잘못 설명한 적 있음).

- **이력**: 0.4 → 0.8(예방적 인상) → 0.5 + 설정 노출(2026-07). 잘림 실측 사례가 없는데 고정값을 보수적으로 잡아둘 이유가, 사용자가 직접 듣고 올릴 수 있게 된 시점에 약해졌다.
- **슬라이더 상한 0.9는 임의값이 아니라 산술적 천장**: 점프 조건이 `gap > tailPad + bufferTime + 0.05`이고 `gap > 3` 필수 + bufferTime 최대 2.0 → `0.9+2.0+0.05 = 2.95 < 3.0`. 넘기면 그 구간의 건너뛰기가 **조용히** 사라진다. `TAIL_PAD_MIN/MAX`는 speechSegments가 단일 출처이고 SettingsModal이 import해 쓴다(하드코딩 금지). 테스트가 이 불변식을 직접 단정한다.
- **`clampTailPad`를 반드시 통과시킬 것**: bufferTime의 `Number.isFinite` 패턴은 '유효한 0 존중'이 목적이라 범위 검사가 없다. 여기선 0(대사 끝나자마자 잘림)이나 큰 값(건너뛰기 소멸)이 모두 불법이라, 로드 시점과 순수 함수 내부 양쪽에서 clamp한다.
- **⚠️ 이름 충돌 주의**: useAudioPlayer에는 이미 `tailPad`라는 **다른** 지역 변수가 두 곳 있다(`Math.max(bufferTime, 0.35)`, 묶음/한문장 반복의 일반 끝 경계). speechOnly와 무관하게 **모든 사용자**에게 적용되는 값이라, 둘을 섞으면 대사만 재생을 안 쓰는 사용자의 반복 경계까지 바뀐다. 그래서 prop 이름은 `speechTailPad`로 분리했다.
- **deps에 넣는다**(`bufferTime`과 동급): 설정창에서만 바뀌는 값이라 재부착 빈도가 낮다. 재생 중 자주 토글되는 `loopGroupSize`/`speechOnly`는 반대로 ref로 읽는다(deps 금지) — 성격이 다르니 같이 취급하지 말 것.
- **⚠️ 단위 테스트만으로는 배선을 못 잡는다**: 두 순수 함수가 `tailPad = SPEECH_TAIL_PAD` 기본 파라미터를 쓰므로, useAudioPlayer가 설정값을 안 넘겨도 테스트는 **전부 통과한다**(실측 확인: 4개 호출부에서 인자를 지워도 81건 통과). 배선 변경 시엔 브라우저에서 값이 엔진까지 도달하는지 직접 확인할 것.
- **브라우저 검증 방법(정착)**: ① 탭이 **hidden이면 미디어가 안 붙는다**(`readyState:0`, `duration:null`) — 먼저 클릭해 `visibilityState:'visible'`로 만들 것. ② 미디어 파일 없이도 검증 가능하다: `ffmpeg -f lavfi -i anullsrc -t <길이>`로 무음 파일을 만들고, 캐시 키(`gemini_analysis_<name>_<size>`)에서 이름·크기를 파싱해 그 크기로 패딩한 `File`을 `DataTransfer`로 file input에 주입하면 캐시된 대본이 그대로 붙는다. ③ **점프 시각은 `v.currentTime`을 폴링해 재지 말 것** — 읽기가 지연돼 실제보다 이르게 보인다(0.9초 이르게 나와 '대사 잘림'으로 오진할 뻔했다). `HTMLMediaElement.prototype.currentTime`의 **setter를 감싸서** 실제 호출 시각을 기록하는 게 유일하게 믿을 수 있다.

useAudioPlayer는 N=1/묶음 끝 경계 당김 + 묶음 내부 `gapSkipTarget` 점프 + **일반 재생(비반복) 경로의 `gapSkipTarget` 점프**(2026-07 추가 — 그전엔 건너뛰기가 전부 `isGlobalLoopActiveRef` 안에만 있어 **반복을 켜야만** 동작했다) + **마지막 문장의 `wrapSkipTarget` 되감기**(2026-07 추가). 네 경로 모두 같은 순수 함수를 쓰므로 기준이 어긋날 수 없다.
- **마지막 문장 되감기 `wrapSkipTarget`**: 일반 재생의 건너뛰기는 `nm < data.length` 안에만 있어서 **마지막 문장은 판정 자체가 시작되지 않았다** — 대사가 끝나도 엔딩 음악을 끝까지 다 듣고서야 브라우저 기본 전체반복(`v.loop`)이 0초로 되감았다. `gapSkipTarget`과 합치지 말 것: 저쪽은 간격·도착지가 둘 다 다음 문장에서 나오는데 여기선 **간격은 파일 끝까지(`duration - 대사끝`), 도착지는 첫 문장 시작(-버퍼)**으로 서로 무관하다. 되감기 자체는 원래도 일어나므로 이 함수는 '언제, 어디로'만 앞당길 뿐 **반복 여부를 바꾸지 않는다**(문장 반복 ON이면 아예 이 경로를 안 탄다 — 거기선 `trimmedLoopEnd(…, nextStart=null)`이 이미 처리).
- **`target >= se` 방어는 정렬 깨진 데이터 전용**: 정상(정렬된) 데이터에서는 `target < data[0].seconds <= data[last].seconds < se`라 **도달 불가능한 줄**이다. 그래서 speechEnd가 무효인 입력으로 테스트하면 앞 가드에 먼저 걸려 **변이가 안 잡힌다**(실제로 겪음). 반드시 `data[0]`이 마지막 문장보다 뒤인 비정렬 배열로 단정할 것. **speechEnd 없는 문장은 문장별로 기존 동작 폴백. `speechOnlyRef`는 loopNRef와 같은 이유로 sync-effect deps 금지.**
- **최소 지속시간 `MIN_SPEECH_SEC`(0.05초)**: 예전엔 0.2초였는데 **한 음절 감탄사가 경계에 걸려 통째로 버려졌다**. 실측: "À."(272.6초 시작)에 모델이 272.8초를 답했으나 `se <= seconds + 0.2`에 탈락 → 그 문장만 끝 시각이 없어져 뒤따르는 9.7초 무음이 안 건너뛰어졌다("Wow." "Cay." 등 0.3초 문장이 흔하다). **`useMediaAnalysis`의 병합 검증과 `speechSegments.validSpeechEnd`가 같은 상수를 써야 한다** — 어긋나면 '저장은 됐는데 재생에서 무시' 또는 그 반대가 된다.
- **UI**: 툴바 '대사만' 칩 — 감지 전(회색, 탭=확인창→감지 1회), 감지 후(탭=토글, `miniapp_speech_only`), 감지 중 스피너. 칩 안 `!N` 배지는 미감지 문장 수(탭=그 문장들만 재감지, `onlyMissing`). 설정 '대사 구간 자동 감지'(`miniapp_speech_auto_detect`, 기본 OFF)를 켜면 전사+분석 **완료 후** 자동 실행(runFullAnalysis의 stage2Promise.then — 중단/전량 실패 시 미실행).
- **주의 — 부분 재감지 병합**: `onlyMissing`은 희소 인덱스만 보내므로, 병합 시 **`requested` 집합으로 교차 검사 필수**. 모델이 인덱스를 0,1,2로 재번호매김하면 이미 정상 감지된 문장이 오염된다. 판단 불가 구간은 `speechEndSkipped`로 표시해 배지·재요청에서 제외(sanitizeData 통과 필요).
- **주의 — 감지는 `isAnalyzing`을 세우지 않는다**(`speechDetectBusy`라는 별도 상태를 쓴다). 그래서 `isAnalyzing`을 조건으로 하는 모든 보호 장치를 **그냥 통과한다**: ①`loadCache`의 데이터 보존 가드, ②`handleHome`/`removeFile`의 경고창. 감지 관련 상태를 다룰 땐 두 조건을 항상 같이 검토할 것. `purgeLocal`(이 기기에서 삭제)에는 아직 감지 가드가 없다(알려진 한계 — 자체 확인창은 있음).
- **감지 결과 구제(`mediaUtils.js#graftSpeechEnds`)**: 완료된 대본을 다시 여는 유일한 경로인 `loadCache`는 항목 data를 localStorage 스냅샷으로 **통째 교체**한다. 저장이 실패했거나 저장 전에 전환하면 화면의 speechEnd가 그 한 줄에서 소멸했다(되돌릴 방법 없음 — `speechEndGraftRef`는 `runStage2` 안에서만 읽힌다). 지금은 교체 직전 메모리값을 이식한다. **규칙: 채우기만 하고 덮어쓰지 않는다(저장본 우선), `seconds`+`text`가 둘 다 같을 때만**(재전사된 문장에 옛 값이 붙는 오염 방지). Stage 2 재개 경로(`runStage2` 호출)에도 반드시 **이식본**을 넘길 것 — 안 그러면 Stage 2가 speechEnd 없는 스냅샷으로 되돌린다.
- **⚠️ 상태 업데이터 실행 타이밍에 의존하지 말 것** (실제로 물린 버그): `setFiles(prev => {... 값 꺼내기 ...})` 후 `await setTimeout(0)`으로 "이제 실행됐겠지" 하고 결과를 읽던 코드가 있었다. React 18은 자체 스케줄러(MessageChannel)로 업데이트를 처리하므로 **`setTimeout(0)`이 먼저 깨는 경우가 있다**. 그러면 `applied=0 / latestData=null`로 오판해 **오류 토스트를 띄우고 저장을 건너뛴 뒤, 잠시 후 업데이터가 실행돼 화면만 켜졌다** → "오류가 떴는데 칩은 초록, 다시 열면 사라짐"(간헐적, 재현율 3/3인 날도 있었다). **해법: 최신 사본 ref(App의 `filesRef`)에서 동기적으로 읽어 계산까지 끝내고, 상태에는 결과만 반영한다(업데이터는 순수하게 유지).**
- **⚠️ 음량(RMS) 기반 로컬 교차검증은 시도했다가 폐기 — 다시 하지 말 것**: 모델이 답한 끝 시각을 오디오 음량 곡선으로 보정하려 했으나 실측에서 **해로웠다**. 이 콘텐츠는 대사 없는 구간에도 배경음악이 대사와 비슷한 크기(-11~-17dB)로 계속 깔려서 음량만으로 말소리/음악을 구분할 수 없다. 결과: 한 음절 감탄사("À." 0.3초) 뒤 음악 3.6초를 대사로 오인해 연장했고, **건너뛰는 구간이 27곳 → 6곳으로 붕괴**했다. 조건을 좁혀도(모델 지속 1초 이하만 연장) 27 → 18로 3분의 1이 사라졌다. 개선하려면 음성/음악 판별(스펙트럼·변조 분석)이 필요하다.
- **주의 — 저장 실패는 반드시 성공 토스트보다 우선**: `persistCache`의 반환값(`{ok, reason, message}`)을 **검사하지 않으면 실패가 사용자에게 도달하지 못한다**. 토스트는 슬롯이 하나라 뒤에 오는 '완료' 토스트가 실패 경고를 덮어쓰고, 용량 경고는 `quotaWarnedRef`로 세션당 1회라 두 번째부터는 완전 무음이다. 분석이 끝난 대본은 그 뒤로 캐시에 쓰는 곳이 감지 저장 하나뿐이라, localStorage가 꽉 차면 **speechEnd만 조용히 사라지는** 형태로 나타난다(localStorage 한도 약 5MB, 10분 대본 ≈ 150~200KB).
- **주의 — `runStage2`의 2번째 인자는 '신원'이다**: `fileInfo`는 캐시 키·graft 키·클라우드 폴더 계산에만 쓰이고 바이트는 읽지 않는다. `materializeFile`이 만든 메모리 적재본(`new File([buf], ...)`)은 **size가 실제 읽은 바이트 수로 바뀌어** 온디맨드 파일(드라이브/OneDrive)에서 원본 보고 크기와 달라진다. 그걸 넘기면 전사·감지는 원본 키에, 분석은 다른 키에 저장돼 **캐시가 두 갈래로 쪼개진다**. 호출부는 항상 원본 신원(`sourceFile`/`targetFile`)을 넘길 것.

### 클라우드 동기화 — 현재 **꺼짐** (2026-07)

`services/cloudSync.js`의 `export const CLOUD_ENABLED = false`. 되돌리려면 이 한 줄만 `true`로. 서버 코드(`api/`, `lib/cloud.js`)와 UI는 그대로 살아 있다.

- **끈 이유**: Vercel 한도로 클라우드 목록·링크가 이미 동작 불능이었고(PC·폰 양쪽 클라우드 항목 0개 확인), 그 경로에서 데이터 유실 버그가 반복됨.
- **작동 원리(단일 초크포인트)**: `getPassphrase()`가 `''`을 반환 → `uploadMedia`/`saveMeta`/`listItems`/`getFavorites`/`saveFavorites`/`deleteItem`이 전부 기존 early-return으로 자동 정지 + App의 `passphrase` 상태가 `''`이라 즐겨찾기 동기화 effect와 `refreshCloud` 트리거가 실행되지 않음. `/api/*` 호출은 전부 cloudSync.js 안에만 있어 우회 경로 없음(검증 완료).
- **⚠️ 금지된 대안**: 함수마다 개별 가드를 넣으면 `getFavorites`가 `[]`를 반환하는 순간 `useFavorites`가 '서버에 별표 없음'으로 해석해 **로컬 즐겨찾기를 영구 삭제**한다.
- **부수 조치**: 암호 게이트 조건(`CLOUD_ENABLED && !passphrase`), `onLockVault={CLOUD_ENABLED ? lockVault : null}`(유령 버튼 숨김), `retryPendingUploads` 최상단 가드(빈 목록을 '전부 미업로드'로 오판해 저장된 영상 전체를 읽는 풀스캔 방지 — 모바일 프리징).
- 다시 켤 때는 아래 '클라우드 저장 규약'을 반드시 다시 읽을 것.

### 클라우드 저장 규약 (다시 켤 때 — 데이터 유실 방지)

- **`saveMeta(fileInfo, data, status, mediaUrl, duration)`**: `data`를 `undefined`로 넘기면 서버가 **data.json을 건드리지 않는다**(메타만 갱신). 오래된 스냅샷을 들고 있는 호출(예: 영상 업로드 완료 콜백)은 **절대 data를 넘기지 말 것** — 그 사이 저장된 분석·speechEnd가 통째로 지워진다. `status`도 `undefined`면 기존 값 유지.
- **`api/save-meta.js`**: 기존 meta를 읽지 못하면 meta.json을 **덮어쓰지 않고 503**을 반환한다(강행 시 mediaUrl이 null로 소실 → 전 기기 재생 불가, 복구 경로 없음).
- **CDN 스테일**: Vercel Blob 공개 URL은 같은 경로에 덮어써도 CDN이 옛 본문을 내려준다. **모든 blob 읽기에 유일 쿼리 캐시버스트 + `put`에 `cacheControlMaxAge: 60`** (즐겨찾기 풀림·감지 결과 소실이 전부 이 원인이었다).
- **`api/list.js`는 부분 실패를 `failed`로 보고**하고, `listItems`가 `items.partial`로 표시한다. `retryPendingUploads`는 `partial`이면 **반드시 보류** — 빠진 항목을 '미업로드'로 오판하면 옛 로컬 대본이 최신 클라우드 대본을 덮어쓴다.
- **`loadCache`는 로컬 미디어가 없으면 클라우드 `mediaUrl`로 스트리밍 폴백**한다. 클라우드 대본도 재분석·감지 시 로컬 캐시 행이 생기므로(persistCache), 이 폴백이 없으면 '소리 없는 대본'으로 고착된다. 반대로 **`loadCloud`에서 대본을 로컬 캐시에 저장하면 안 된다**(재생 불가 고착 + 타 기기 갱신 영구 차단 — 적대 검증에서 확인).
- **Toast**: `onClose`는 컴포넌트 내부에서 ref로 고정하고 effect deps는 `[duration]`만. App이 인라인 화살표를 넘기는데 재생 중 100ms마다 리렌더되므로, deps에 넣으면 타이머가 영원히 리셋된다(토스트가 안 사라짐).
- **주의 — Stage 2 덮어쓰기 경합**: runStage2는 시작 스냅샷(workingData)을 통째로 상태/캐시에 덮어쓴다. 분석 중 감지가 채운 speechEnd는 `speechEndGraftRef`(동기 ref, key `${name}_${size}|${seconds}`)를 통해 updateGlobalState가 덮어쓰기 직전 이식해 보존한다. **문장별 새 필드를 추가하면 같은 경합을 반드시 검토할 것.**

### 재생 링크(blob URL) 수명 관리 — 검은 화면 방지

blob URL은 '업로드 때 고른 File'을 가리키는 **임시 링크**다. 모바일에서 메모리 회수·백그라운드 복귀 후 무효가 되는데, 무효가 돼도 문자열은 남아 앱이 '미디어 있음'으로 판단 → PlayerControls가 플레이스홀더 대신 **검은 박스**를 그리고 재생만 안 된다.

- **자가 복구**: `<audio onError>` → `App.handleMediaError`가 IndexedDB 원본으로 새 URL을 발급해 갈아끼운다. **파일당 최대 2회**(`mediaRecoverRef` Map)로 error→복구→error 무한루프 차단.
- **loadCache는 낡은 URL을 재사용하지 않는다** — 저장소 원본으로 매번 새로 발급. **옛 URL 회수는 5초 지연**(즉시 회수하면 새 src 교체 전 찰나에 error가 나 자가복구가 헛돈다).
- **중복 항목 금지**: 같은 파일을 다시 열면 append가 아니라 기존 항목 갱신. 예전엔 쌓인 항목들이 **같은 URL 문자열을 공유**해, 하나를 X로 닫으면 `removeFile`의 revoke가 나머지까지 검은 화면으로 만들었다. 분석 중(`isAnalyzing`) 항목은 data를 덮지 말고 url만 갱신할 것.
- `resetPlayerState`는 **duration도 반드시 0으로** — 안 그러면 죽은 미디어에 옛 총 시간이 남아 정상처럼 보인다.

### Data Flow & State Management

- **State**: `App.jsx`가 최상위 상태 관리 (files 배열, activeFileId 등)
- **묶음 반복 프리셋**: 툴바 묶음 칩의 숫자 탭 → `LoopPresetPopover`(App.jsx 모듈 레벨)가 [1,2,3,5,10,15,20] 프리셋 표시. **툴바가 overflow-x-auto + backdrop-blur(fixed의 containing block)라 반드시 body 포털(createPortal)로 띄워야 함** — 툴바 안에 absolute/fixed로 넣으면 잘리거나 좌표가 틀어짐.
- **Settings**: `hooks/useSettings.js` - 모든 설정을 하나의 `config` 객체로 관리. `updateField(field, value)`로 개별 필드 업데이트 시 localStorage에 **즉시** 동기화(모든 값이 즉시 영속됨). `value`에 함수를 넘기면 이전 값을 받는다(`updateField('showAnalysis', prev => !prev)`) — **토글 콜백은 반드시 이 형태로 쓸 것.** 현재 값을 클로저로 잡으면 deps에 넣어야 하고, 그러면 콜백 참조가 매번 바뀌어 memo된 `TranscriptItem`들이 재생 틱마다 전부 리렌더된다. `setItem`은 try/catch로 감싸 저장 실패해도 화면 상태는 유지된다(캐시가 5MB를 채우면 실제로 던진다).
  - **⚠️ 무엇을 config에 넣을지의 경계**: 툴바에서 조작해도 '마지막 설정'으로 유지되는 게 이로운 것만 넣는다(난이도·분석표시·회차·묶음N·대사만). **유지하면 안 되는 것**: `mistakeOnly`(켜진 채 열리면 대본 대부분이 사라지고 반복 강제 ON + 묶음 잠금, 오답 0이면 '정복 화면'으로 시작 — 왜 대본이 없는지 알 수 없다), `selectMode`(파괴적 편집 모드 + selectedIdxs가 대본별 인덱스라 오염), 모달 열림 상태, 검색어. 이건 실수가 아니라 설계다 — 파일 전환 시 강제 해제 코드(App.jsx의 '가짜 정복 화면/데드락 방지')와 같은 이유. `drillMode`(가리기 on/off)도 일부러 뺐다: 저장된 난이도가 '고급/회상'이면 켜진 채 열릴 때 문장이 통째로 가려진다. 테스트가 이 제외 목록을 단정한다. 설정 항목: apiKey, stage1Model, stage2Model, stage3Model(재전사/재분석 전용), bufferTime, temperature, topP, antiRecitation, markerChar, markerInterval, chunkEnabled, chunkMinutes, realignEnabled. **즉시 영속되므로 SettingsModal의 'Cancel'은 진입 시 스냅샷을 떠 변경 필드만 되돌린다(그냥 닫으면 유지).**
- **Custom Hooks**: `useMediaAnalysis` (파일 업로드/분석/취소, **순차 분석 큐**), `useMediaCache` (캐시 로드/삭제, Stage 2 abort 연동), `useAudioPlayer` (재생 제어, 싱크 엔진, `setLoopActive`로 반복 강제/복원), `useLearningProgress` (알았음/몰랐음 저장), `useKeyboardShortcuts`, `useEscapeToClose` (모달 ESC 닫기 — 겹친 모달은 LIFO 스택으로 최상위 하나만)
- **Cache**: localStorage에 `gemini_analysis_{파일명}_{크기}` 키로 전사+분석 결과 저장. `utils/cacheUtils.js`의 `parseCacheEntry`/`saveCacheEntry`로 통합 관리. Stage 1 완료 시 중간 저장 후 Stage 2 진행.
- **Media Storage**: IndexedDB (`MediaStore.js`) - 원본 미디어 파일 blob 저장. 캐시 로드 시 미디어 복원에 사용.
- **순차 분석 큐**: 여러 파일 동시 업로드 시 `useMediaAnalysis`의 `analysisQueueRef`+`processAnalysisQueue`가 하나씩 끝까지(Stage1+Stage2) 직렬 처리(캐시 히트는 큐 밖에서 즉시 복원). `runFullAnalysis({awaitStage2:true})`로 다음 파일 전에 Stage2 완료 대기. **주의: `stage1AbortRef`/`stage2AbortRef`는 여전히 전역 공유라, 큐 진행 중 대화형 편집(reanalyze/retranscribe/recoverGap/retry/cancelStage1)이 큐가 처리 중인 다른 파일을 중단시킬 수 있음(파일별 AbortController 미도입 — 알려진 한계). 큐 워커는 AbortError 시 무한 스피너 대신 재시도 카드로 전환.**
- **⚠️ `f.isAnalyzing`은 '전사(Stage 1) 중'만 뜻한다** — `runFullAnalysis`가 Stage 1 직후 `isAnalyzing: false`로 내리고 **그 다음에** Stage 2를 시작한다. 그래서 "분석 중이면 보호"류의 조건을 `isAnalyzing`으로 쓰면 정작 Stage 2 구간을 못 지킨다(`loadCache`의 데이터 보존 가드가 실제로 그 상태였음). Stage 2 진행 여부는 **`stage2ActiveRef`(App 소유, `Map<fileId, 실행중 개수>`)**로 판별한다 — `runStage2`가 얇은 래퍼로 호출 전 +1 / `finally`에서 -1 한다. 개수로 세는 이유: 같은 파일에 재분석 등이 겹쳐 돌 때 안쪽 실행이 끝나며 바깥 표시를 지우는 것을 막기 위함.
- **`loadCache`는 Stage 2가 도는 중이면 재개를 건너뛴다** — 안 그러면 `runStage2` 첫 줄의 `abort()`가 진행 중이던 배치를 죽이고 마지막 저장 지점부터 다시 돌아 **동시 2~3배치 × 25문장이 중복 분석**된다(비용). `loadCloud`에는 같은 가드가 없다(매번 새 `cloud-` id라 카운터로 판별 불가 — 클라우드를 다시 켤 때 함께 손볼 것).
- **Learning Progress**: `useLearningProgress`가 문장별 알았음/몰랐음을 localStorage(`miniapp_learn_progress`)에 저장. 키는 배열 인덱스가 아니라 **안정 ID(`${seconds}|${text 앞 24자}`)** — 문장 삭제/복구로 인덱스가 밀려도 올바른 문장에 매핑(오답노트·SRS 확장 대비). `wrongIndices`/`isWrong`는 현재 대본에서 매번 재계산.
- **Stage 2 실패 문장**: 분석 실패 문장은 `analysisFailed` 플래그가 붙어 `TranscriptItem`이 무한 스피너 대신 '다시 시도' UI를 렌더(`reanalyzeSentences`로 그 문장만 재분석).

### Component Props 패턴

- `SettingsModal`은 `{config, updateField, onLockVault, onClose}` props 수신 (개별 setter 대신 `updateField` 함수 사용)
- `EmptyState`도 동일하게 `{config, updateField}`로 설정을 전달
- `TranscriptItem`은 카드 내에서 문장 종결 부호(`.` `?` `!`) 기준 시각적 줄바꿈 처리. drill 관련 props(`drillMode/difficulty/drillRound/onMarkAnswer/isWrong`) 추가됨. **memo 컴포넌트이므로 App은 콜백을 안정 참조(useCallback/idx는 컴포넌트 내부에서 바인딩)로 넘겨 재생 중 currentTime 틱마다 전체 카드가 리렌더되지 않게 함.**
- **모달 공통**: `SettingsModal`/`CacheHistoryModal`/`TrashModal`/`ConfirmModal`은 `useEscapeToClose` + backdrop `onClick`(내용은 `stopPropagation`)로 ESC·배경 클릭 닫기. SettingsModal의 ESC/배경은 '유지', 명시적 Cancel만 스냅샷 복원.

### Key Utilities

- `utils/mediaUtils.js` - 미디어 길이 추출(getMediaDuration), 데이터 정규화(sanitizeData), 타임스탬프 자동 보정, 감지결과 구제(graftSpeechEnds)
  - **⚠️ `getMediaDuration`은 반드시 타임아웃이 있어야 한다**: 크롬은 **백그라운드 탭에서 미디어 엘리먼트의 메타데이터 로딩을 시작하지 않고**(0.2초짜리 무음 파일도 이벤트 0개 — 실측), 그렇게 걸린 로딩은 **탭을 앞으로 가져와도 되살아나지 않는다**(실측). 타임아웃이 없던 시절 Promise가 영영 미결로 남아 **전사 시작·감지·재전사·구간복구·대본열기가 오류 표시도 없이 스피너만 돌며 영구 정지**했다(이 함수는 8곳에서 await되는 단일 고장점). 호출부의 `try/catch`는 '거부'만 잡지 '안 끝남'은 못 잡는다. 지금은 타임아웃(보임 8초/숨김 1.5초) 후 **WebAudio(`decodeAudioData`)로 폴백**한다 — WebAudio는 같은 백그라운드 조건에서 정상 동작한다(6ms). 모바일은 화면 자동 잠금·앱 전환이 전부 백그라운드라 특히 잘 터졌다.
- `utils/languageUtils.js` - 행 내 반복 감지(`analyzeIntraLineRepetition`) - 환각 텍스트 필터링/축약
- `utils/timeUtils.js` - 시간 포맷 변환 (parseTime)
- `utils/cacheStatus.js` - 캐시 상태 판별(getCacheStatus), 표시명 추출(getCacheDisplayName)
- `utils/cacheUtils.js` - 캐시 엔트리 파싱(parseCacheEntry) 및 저장(saveCacheEntry)
- `utils/analysisParser.js` - 문장 analysis → 의미 청크 배열(parseChunks). 클로즈·향후 어휘 기능의 공용 부품
- `utils/clozeUtils.js` - 시드 난수(mulberry32) + 난이도별 가릴 청크 선택(buildCloze)

### Keyboard Shortcuts (구현: `hooks/useKeyboardShortcuts.js`, 표시: `components/ShortcutsHelp.jsx`)

Space: 재생/일시정지, Enter: 구간 반복, B: 분석 토글, ←/→: 문장 이동(**오답 모드에선 오답만 순회**), ↑/↓: 5초 탐색, `[`/`]`: 배속 -/+, `?`: 도움말 토글. **단축키를 추가하면 `ShortcutsHelp.jsx`의 목록도 함께 갱신할 것**(둘이 따로 관리됨). ←/→는 App의 `goPrev`/`goNext`에 위임(모드 인식).

## Configuration

- 모든 설정은 `useSettings` 훅에서 `config` 객체로 통합 관리
- localStorage 키는 `miniapp_` 접두사 사용 (예: `miniapp_gemini_key`, `miniapp_stage1_model`, `miniapp_anti_recitation`, `miniapp_chunk_enabled`, `miniapp_chunk_minutes`, `miniapp_loop_active`, `miniapp_playback_rate`). 학습 진행은 예외적으로 접두사 붙은 단일 키 `miniapp_learn_progress`에 `{ [fileKey]: { [stableId]: {status,seconds,miss,ts} } }` 구조로 저장. 캐시(`gemini_analysis_*`)만 접두사 없음.
- 지원 모델: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`, `gemini-2-flash`, `gemini-3.5-flash`
- Vite 설정에서 `@ffmpeg/ffmpeg`, `@ffmpeg/util`은 optimizeDeps에서 제외 (WASM)

## 작업 시작 전 룰

작업을 시작하기 전에 95% 확신이 들 때까지 저에게 추가 질문을 해주세요. 확신이 안 서면 코드를 작성하지 마세요.

## Language Note

코드 주석과 프롬프트는 한국어로 작성되어 있습니다. UI는 한영 혼용이며, 프롬프트 수정 시 9대 분석 규칙의 정합성에 특히 주의해야 합니다.
