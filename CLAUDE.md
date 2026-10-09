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

순수 함수 유틸 위주 — `speechSegments`(경계 계산), `mediaUtils`의 `graftSpeechEnds`(감지결과 구제), `clozeUtils`(출제), `analysisCoverage`(대본 검증), `stage1Line`(전사 줄 형식·숫자 병기 폭주 정리), `stage1Resume`(스트림 끊김 판정·이어받기·반복 루프·저작권 차단, 가짜 모델로 `gemini.js`의 실제 루프까지), `sentenceEdit`(나누기·구간 재전사 계산), `analysisView`(눈 버튼 3단계), `analysisParser`(괄호 풀이 떼기), `speechEndMerge`(대사 끝 감지 대상 고르기·결과 합치기), `cacheStatus`(저장 상태 `saveStatusOf` — 문장 0개 = extracted). `src/services/__tests__/`에는 `stage1Line`·`stage1Resume`·`stage2Parser`와 `retranscribeSelect`(`gemini.js#selectWindowSentences` — 재전사·복구·구간 재전사가 받은 줄에서 구간 문장 고르기), `stage1Parsers`(전사 줄 파서 규칙 — 클로저라 옮기지 않고 가짜 모델로 실제 루프를 돌려 검증, 대사 끝 응답 해석, 청크 겹침 중복 제거). 재생 엔진·훅·서비스는 브라우저/타이밍 의존이라 여기서 못 잡는다(수동 확인 필요).

**테스트가 실제로 코드를 보는지 반드시 확인할 것.** 실제로 물린 적 있다:

- **사본을 import 하면 안 된다.** 예전 테스트가 스크래치패드 사본을 읽어서, 소스의 `SPEECH_TAIL_PAD`를 0.4→0.8로 바꿔도 그대로 통과했다. 반드시 상대경로로 실제 소스를 import 할 것.
- **단정에 상수를 그대로 쓰면 무의미해진다.** `validSpeechEnd(...10 + MIN_SPEECH_SEC)` 같은 단정은 기준을 되돌려도 같이 움직여 버그를 못 잡는다. **경계 회귀는 실측 사례를 숫자로 박아둘 것** (예: `{seconds:272.6, speechEnd:272.8}` = "À.", 04:32 구간).
- 검증 방법: 상수를 일부러 옛 값으로 되돌리고 `npm test`가 **실패하는지** 본다. 4개 변이(`SPEECH_TAIL_PAD`/`MIN_SPEECH_SEC`/`GAP_SKIP_MIN`/graft 덮어쓰기 가드)가 각각 잡히는 것을 확인해 뒀다.

**Stage 1 줄 형식 인식은 `services/stage1Line.js`(순수 모듈, 테스트 有)로 분리했다** — `LINE_REGEX`가 `[HH:MM:SS.ms]`도 받는다. 프롬프트는 `MM:SS.ms`를 지시하지만 3.6 Flash가 1분 이후 `[00:01:04.47]`로 쓰는 이탈이 실측됐고(3회 중 1회), 옛 패턴은 `00:01`만 읽어 1분 이후 문장이 전부 1초→57초 근처로 몰리고 대본에 `04.47] [Speaker D] ||`가 섞였다. 테스트는 옛 패턴으로 되돌리면 실패한다(확인함).

**숫자 병기 폭주 정리(`stage1Line.js#stripRunawayNumberAnnotations`, 파서 `parseLine`에서 호출)** — 모델이 규칙 6의 `소리나는말(원본)`을 모든 단어로 번지게 쓴 대본이 실측됐다(2026-09, 휴대폰: 2.5 Flash·방지 모드 켬·간격 8, 16분 영상 전체): `Hôm nay(1) là(1) còn(1) … một(1) nghìn(1.000) mình(1.000) không(1.000) …`. 같은 설정으로 전체 2회(연결 끊김 강제 1회 포함)·구간 10회를 다시 돌려도 재현되지 않았다. 다만 씨앗으로 보이는 `Năm(5) nghìn(1.000) một(1) túi riêng.`(한 번 붙일 괄호를 단어마다 붙임)이 한 줄 나왔다 — 모델이 자기가 쓴 앞 줄을 보고 쓰므로 이런 버릇이 뒤로 번진다. 판정: **바로 이어진 3단어 이상에 같은 숫자 괄호**가 붙으면 그 줄의 숫자 괄호를 전부 지운다(말한 단어는 남고, 기호 병기 `trên(/)`는 그대로). 정상 병기는 숫자 덩어리 끝에 한 번씩이라 같은 값이 연달아 붙지 않는다 — 실측 정상 대본 649줄(괄호 있는 줄 233개)에서 한 줄도 안 바뀌었다. 파서 호출을 빼면 1건, '같은 값' 조건을 빼면(괄호만 이어져도 폭주) 1건 실패한다(확인함). **이미 저장된 대본은 고쳐지지 않는다** — 그 영상은 새로 전사해야 한다.

**Stage 1 스트림 끊김 이어받기는 `services/stage1Resume.js`(순수) + `gemini.js#transcribeWithResume`(실제 루프, 테스트용 export)** — `__tests__/stage1Resume.test.js`가 **가짜 모델로 실제 루프를 돌린다**(gemini.js는 node에서 import 된다 — SDK·ffmpeg import에 부작용 없음 확인). 끊김 판정을 옛 동작('끝나면 다 받음')으로 되돌리면 5건, 멈춤 감시를 끄면 2건, 이음매 정리를 빼면 1건 실패한다(확인함). 반복 루프·저작권 차단도 같은 식으로 확인했다: 한 줄 루프 감지를 끄면 2건, 같은 줄 감지 1건, 루프 때 연결을 안 끊으면 2건, 단어 종류 조건을 빼면(길이만) 2건, 50줄→10줄이면 1건, 저작권 차단을 옛 동작(전부 버림)으로 되돌리면 4건, 버렸던 줄 시각 복원을 끄면 2건, 안내 문구 사유 구분을 끄면 1건 실패. 반복 루프 테스트는 **실측 131,131자 흐름을 그대로 재현**하고 '그 3% 안에서 끊었는지'를 잰다(결과 대본만 보면 옛 코드도 출력 한도 뒤 이어받아 같은 대본이 나와 통과해 버린다).

**응답 파서 테스트 공백은 2026-09에 메웠다.** 예전엔 로직을 복제해 테스트했는데, 그건 사본을 검증하는 셈이라 폐기했다. 줄 파서(`transcribeStream` 안 `parseLine`)는 스트림 상태(직전 줄·역행 기준)를 쥔 클로저라 **옮기지 않고** `transcribeWithResume`에 STOP으로 끝나는 가짜 모델을 물려 실제 루프로 검증한다(`stage1Parsers.test.js`) — 변이 14개(역행 보정·반복 창 8초·연속 중복·초과 여유 5초·화면 글자/괄호 설명 거르기·한 글자 줄·이른 종료 마커·청크 오프셋·H:MM:SS·쉼표 소수점·포함 판정 최소 길이·중복 창 20초·완전 일치)가 각각 실패함을 확인. '완전 일치'는 처음에 **안 잡혔다** — 긴 테스트 문장은 '포함' 판정이 먼저 걸러서, 12자 미만 짧은 말("Vâng.")로 보완했다.
- **2026-09에 메운 것**: 감지 병합(`utils/speechEndMerge.js`, 예전 `detectSpeechEndsForFile` 인라인)과 재전사 문장 고르기(`gemini.js#selectWindowSentences`, 예전 `retranscribeSegments` 인라인) — 코드는 그대로 옮기기만 했다(옮긴 블록을 원본과 diff해 주석 한 줄 위치 외 동일 확인). 변이 12개(요청 인덱스 가드·시각 일치 검사·영상 길이 자르기·포기 표시 해제·형제 확장·MIN_SPEECH_SEC 옛 값·통째 포함 거르기·구간 재전사의 짧은 파편 규칙 제외·근접 가드 0.35·끝 경계 여유·교체 모드 이웃 거르기·앞 꼬리 트림)가 각각 1건씩 실패하는 것을 확인했다. 첫 작성 때 '요청 인덱스 가드'는 **안 잡혔다** — 테스트의 엉뚱한 값(99초)이 60초 상한에 먼저 걸려서였다. 가드 테스트엔 다른 기준을 통과하는 그럴듯한 값을 쓸 것.

배포: **Vercel이 main 브랜치 푸시를 자동 배포한다.** `git push origin main`이 곧 배포다.
(`npm run deploy`는 안내 메시지만 출력하고 종료. `gh-pages` 브랜치는 옛 방식의 잔재 — 사용 안 함.)

## Architecture

### Two-Stage AI Pipeline (핵심 아키텍처)

분석은 2단계 파이프라인으로 처리됩니다:

- **Stage 1 (전사/Transcription)**: `services/gemini.js#extractTranscript` - 미디어 파일을 Gemini에 전송하여 타임스탬프 기반 전사. 스트리밍 응답을 증분 파싱하며, 환각(hallucination) 방지를 위한 3중 방어망(중복 감지, 역행 방지, 종료 마커 검증) 내장. 함수 시그니처는 `(file, apiKey, modelId, options)` — options 객체에 totalDuration, temperature, topP, signal, antiRecitation, chunkEnabled, chunkMinutes 등 포함.
- **Stage 2 (분석/Analysis)**: `services/gemini.js#analyzeBatchSentences` - 전사된 문장들을 25개씩 배칭하여 번역+의미 청크 분석. 동시 요청 수는 모델별 차등(Pro: 2, 기타: 3). 분석 결과 파싱 정규식은 `ANALYSIS_PREFIX_STRIP` 모듈 레벨 상수로 통합. 2.5 모델은 `thinkingBudget: 0`으로 불필요한 생각 토큰 절약. **주의: 9대 분석 규칙과 출력 형식 마커(`--- [INDEX] START/END ---`)는 반드시 user prompt에 포함해야 함. systemInstruction으로 옮기면 모델이 마커 형식을 따르지 않아 파싱 실패 발생.**

프롬프트는 `services/prompts.js`에 분리되어 있으며, 9대 분석 규칙(의미 청크 통합, 한자 병기 금지, 미니멀리즘 등)이 핵심입니다. Stage 1 프롬프트에는 번역 금지 규칙과 1줄 1문장 철칙이 포함됩니다.

### Stage 2 단어 풀이 표기 (v4, 2026-10)

괄호 안 단어 풀이 모양을 회화 공부용으로 통일했다(`prompts.js`의 규칙 5 + '[단어 풀이 표기 규칙] A~F', `ANALYSIS_VERSION` 3→4, 옛 영상엔 노란 안내 줄). 사용자와 하나씩 정한 결정:

- **모든 단어를 빠짐없이, 단어마다 뜻 하나.** 문법 단어(đang·của…)도 매번. 쉼표 나열 금지(말끝 표현 nhé/nhá도 어감 하나).
- **문맥 뜻←본뜻**: `chơi: 운행하다←놀다`, `gấu: 애인←곰`. 본뜻으로 짐작 안 될 때만, 한 번만, 괄호 안에서만. 처음엔 `놀다→운행하다`(본뜻 먼저)였는데 다른 표시(·보충, ♪, 〈〉)는 전부 '지금 뜻이 앞, 덧붙임이 뒤'라 화살표만 순서가 반대였다 — 사용자가 짚어 뒤집고 화살표 방향도 ←로(2026-10-09). 실측(Gara 50문장+2, 3회): ← 13개·→ 0·청크 뜻 화살표 0·겹침 0. 화살표 개수가 옛 모양보다 줄었다(실행당 ~12 → ~4 — `có: 있다→강조` 같은 군더더기가 빠지고 `도망치다←달리다`류만 남음). 가끔 `팽팽한←팽팽하다`(무의미)·`밀다←구르다·손`(부품을 〈〉 대신 화살표에) 같은 잡음. **청크 뜻(굵은 글씨 뒤)에 화살표 금지** — 첫 판에서 예시 단어 chơi가 든 문장이면 청크 뜻에 `~하는 중이다→운행하는 중이다`가 2/2회 나와 ❌/✅ 예시를 추가했다(이후 0). 안전망 `stripMainArrow`는 ←면 왼쪽, 옛 →면 오른쪽을 남긴다(← 무시 변이 1건 실패 확인). **앱 실제 흐름으로도 확인**(2026-10-09, PC 크롬에서 Gara 68문장을 열고 노란 안내 줄의 '전체 재분석' 버튼 → 저장본 검사): version 4·68/68·괄호 속 괄호 0·→ 0·청크 뜻 화살표 0·한자 뜻풀이 0·쉼표 0, ♪ 6·〈〉 5·⚡ 1(새 형식), ← 2(분석 함수를 직접 부를 때보다 적음 — 문맥 문장이 붙는 실제 흐름에선 모델이 화살표를 덜 씀). 청크 누락 2문장(#8 `ra bến xe được không`, #13 `đây à`)은 배지가 잡음. 재분석 전 옛 분석은 `miniapp_backup_gara_v3`(PC localStorage)에 남겨 둠.
- **소리 닮은 한자어는 ♪**: `từ thiện: 자선♪`, 자연스러운 말이 따로 있으면 `xuất hiện: 나타나다·출현♪`. 한국어 한자 뜻풀이(자비 자 + 착할 선)는 폐지 — 옛 출력엔 `Đàn ông: 남자 (사내 단 + 사내 웅)`처럼 한자어도 아닌 말에 지어낸 풀이까지 있었다. 일상에서 안 쓰는 한자어엔 금지(첫 판 `Cảm ơn: 감은♪` → 규칙 추가 후 사라짐. `Hân hoan: 흔환♪` 같은 건 가끔 남는다). 기호 결정 경위: 한자 '漢'은 사용자가 한자를 잘 몰라 탈락, 색칠은 어차피 ♪를 표시로 써야 해서 나중 일로 미룸.
- **합성어 부품은 〈〉, 베트남어 음절 순서**: `búng tay: 손가락 튕기다〈튀기다·손〉`. 부품마다 제 뜻이 있을 때만, ♪ 단어엔 안 씀. 가운뎃점은 이미 보충 설명용(`đứa: 명·아이 세는 말`)이라 부품엔 꺾쇠. 실측 순서 뒤집힘 0건(pháo hoa〈포·꽃〉, mặt trời〈얼굴·하늘〉 등).
- **고유명사는 한글 발음만**(`Hải Phòng: 하이퐁`), **괄호 속 괄호 금지**(숫자 병기 `mười(10)`는 예외).
- 화면 코드는 안 바꿨다. `splitBreakdown`은 줄 끝 괄호 묶음만 보고, 커버리지 배지는 굵은 청크 단어만 비교해 새 기호와 무관하다.
- **코드 안전망 `analysisParser.js#flattenNestedParens`** (`stage2Parser`가 새 응답의 [분석] 줄마다 호출 — 옛 캐시엔 안 씀): 풀이 안 괄호를 정한 모양으로(`쨍(종소리)`→`쨍·종소리`, `→(무게를) 재다`→`→무게를 재다`, `(búng: 튀기다 + tay: 손)`→`〈튀기다·손〉`, 숫자 병기 `sáu trăm(600)`·`mét(m)`은 보존) + 청크 뜻의 화살표는 오른쪽만(`들르다→비추다`→`비추다`). 옛 캐시에 쓰면 한자 뜻풀이 `(날 출 + 나타날 현)`이 〈〉로 바뀌어 오히려 깨지므로 표시 단계에서 부르지 말 것. 변이 6개(숫자 보존·부품 변환·앞머리 벗기기·가운뎃점·파서 호출·청크 화살표) 각각 실패 확인.
- **♪는 모델 판단이라 들쭉날쭉하고 일부 틀린다 — 지시를 세게 하면 더 나빠진다.** "두 음절 이상 단어는 하나씩 확인해 빠짐없이"로 바꿔 보니 같은 단어엔 꾸준히 붙었지만 틀린 짝(giúp đỡ→구제♪, vấn vương→번뇌♪, tâm tình→담정♪, mỹ mãn→미만♪)과 낯선 말(감은·안강·축인·공성)이 늘어 되돌렸다. 되돌린 문구로도 한자어가 많은 노래에선 틀린 ♪가 섞인다(thịnh vượng→성황♪, danh toại→명성♪). 틀린 것은 주로 `자연스러운 뜻·한자어♪` 꼴. 일상 대화(Gara)는 대부분 맞다.
- 실측 2(최종 문구 + 안전망, 각 3회): 모델 원문에서 괄호 속 괄호 0줄(지시문만으로 해결 — 안전망은 예비), 청크 뜻 화살표 원문 1줄(안전망이 지움), 쉼표 나열 0.
- **⚡(규칙 14)는 v4로 바꾼 뒤 통째로 빠지곤 했다 → 작성 예시에 ⚡ 문장(quẩy)을 넣어 고침.** 지어낸 슬랭 17·욕설 4·평범 5문장 × 3회: 예시 넣기 전엔 슬랭 ⚡가 0/9/17개(한 묶음 안에서 '이번엔 안 쓴다'로 통째 결정), 넣은 뒤 17/17/16·욕설 3/3/4·평범 오탐 0/0/0, 곰이 진짜 곰인 문장(sở thú)엔 안 붙음. ⚡ 없이도 뜻은 `gấu: 곰→애인`처럼 맞게 나오니 빠지는 건 '슬랭 표시+말투'뿐. 규칙 글을 늘리는 것보다 예시 한 줄이 잘 듣는다 — ♪처럼 지시를 세게 쓰면 오히려 틀린 게 늘었다. 예시 문장은 시험 문장과 다른 슬랭을 써야 시험이 오염되지 않는다.
- **⚡ 안에는 '그 표현(원어): 뜻'만** (2026-10-09, 사용자 결정 2단계): ① 옛 `〔⚡실제: 이성에게 관심 표현하다(슬랭)〕`는 5단어 청크에서 어느 말이 슬랭인지 안 보이고, v4에선 청크 뜻·→가 이미 실제 뜻을 적어 뜻이 중복됐다 → `〔⚡thả thính: 작업 걸다·슬랭〕`(실측 슬랭 17/17/17·욕설 4/4/4·오탐 0, 표현 이름이 문장 안에 62/65 — 나머지는 `Vờ cờ lờ`를 `VCL`로 적은 것). ② '슬랭'이란 꼬리표가 ⚡와 중복이라 **종류·말투 꼬리표 전부 제거** → `〔⚡thả thính: 작업 걸다〕`. 욕설엔 규칙 10의 문구 `(강조 비속어)`를 베껴 붙이기에 욕설 ❌/✅ 예시를 따로 넣어야 사라졌다(6/64 → 0/61). 최종 실측 슬랭 16/17/16·욕설 4/4/3·평범 오탐 0. 대가: 욕설인지 표시가 없어졌다(사용자가 알고 택함). 옛 캐시의 `⚡실제:` 꼬리는 그대로 보인다(화면은 〔⚡…〕 통째로만 다룸).
- **휴대폰에서 '단어마다 한 줄 + `,: ,` 줄' 깨짐 보고 (2026-10-09, Circle K 12분 영상 #163 "Cảm ơn những con người…" 33단어)**: PC에서 재현 실패. 원본 파일을 앱에 올려 전사→분석 실제 흐름(165문장, 2.5 Flash, 강제 분할 재분석 18문장 포함)을 돌려도 깨진 문장 0, 그 문장은 8청크 정상. 같은 25문장 묶음을 2.5 Pro·2.5 Flash Lite·3.1 Flash Lite로 돌려도 0, 그 문장 단독을 forceSplit으로 Lite 2종 × 3회 돌려도 8~10청크(평균 3~4단어)·구두점 청크 0. 휴대폰 설정은 1단계 2.5 Flash·2단계 **2.5 Flash Lite**, 대본을 지우고 새로 돌린 것, 깨진 문장은 '마지막 쪽 10~20%'. PC에서 같은 대본 165문장을 Lite로 전체 재분석(재분석 모델을 Lite로 바꿔 노란 줄 버튼)해도 깨짐 2/165(6단어 문장이 4청크로 나뉜 가벼운 것)·구두점 청크 0·#163은 9청크 — **여전히 재현 안 됨**. 가설: Lite가 묶음(25문장) 하나를 통째로 '단어마다 한 줄' 형식으로 답하는 확률적 실패(165문장 중 마지막 묶음 하나 = 15%, '마지막 쪽'과 일치). Lite는 풀이 괄호를 자주 생략한다(81줄/165문장, Flash는 0). PC 캐시는 Flash 분석본으로 되돌렸고 Lite 결과는 `miniapp_backup_circlek_lite`에 보관. **→ 같은 대본 7묶음을 Lite로 6회(42묶음·990문장) 돌리자 재현됐다**: 깨진 묶음 4/42, 문장 10/990, 그중 9개가 `**?**: ?`·`**,**: ,` 같은 **구두점만인 청크**(125번 묶음에서 6회 중 3회 — 같은 자리에서 반복) + 1개 과분할. 한 번 돌려서는 안 나오는 확률적 이탈이라 **최소 수십 묶음을 돌려야 보인다.** 규칙 13에 '구두점만인 청크 금지(❌ `**?**: ?`) + 한 단어 청크 줄줄이 금지' 두 줄을 넣고 같은 42묶음을 다시 돌리니 구두점 청크 0/990(남은 4건은 7단어 문장이 4청크로 나뉜 가벼운 것, 전부 같은 문장). 휴대폰의 '단어마다 한 줄' 극단형은 이 구두점 이탈의 심한 형태로 본다. 검사 기준으로 쓴 '깨짐' 판정: 구두점만인 청크가 있거나, 4청크↑ 중 1단어 청크가 절반↑.
- **청크 누락은 모델이 빠뜨리는 것이지 앱이 잘라 먹는 게 아니다 (2026-10-09 원인 조사)**: Circle K 165문장을 전체 재분석하면서 Gemini 응답 원문(fetch tee)과 저장본을 문장마다 비교 — 저장 청크 수 < 원문 청크 수인 문장 0개. 그런데 '누락' 배지 18/165(11%): 모델이 청크 하나를 통째로 건너뛴다(`Và đó | chính là` ← quán nét 빠짐, `Và mong rằng | nhân viên phát hiện` ← sẽ không bị 빠짐, 끝 조각 빠짐은 18 중 3). 실행마다 편차가 크다(같은 영상 전체 재분석 두 번: 26/165 → 18/165, 3묶음×2회 표본은 7/150). v3 프롬프트로 같은 3묶음×2회를 돌리면 4/125 — **v4가 만든 문제가 아니라 원래 있던 모델 버릇**(Gara 같은 짧은 문장 영상은 1~2/50, 긴 문장이 많은 Circle K가 심함). 2.5 Flash Lite도 2/165로 비슷. 욕설 청크(`ngu vl`)가 빠지던 것도 같은 현상. **→ '누락 자동 재시도'를 넣었다(2026-10-09)**: `runStage2`가 뭉침 재시도 뒤에, 빠진 단어가 있는 문장만 모아 문맥 없이 다시 요청(최대 2라운드, `analysisCoverage.js#shouldAdoptMissingRetry` — 빠진 단어가 줄었을 때만 채택, 문장 전체 1청크 결과는 거부. 변이 2개 각각 실패 확인). 실측(Circle K 165문장, 전체 재분석 버튼, fetch tee): 첫 패스 누락 32문장(19%) → 1라운드 후 2 → 2라운드 후 **0**. 추가 요청 3개(34문장분, 전체의 약 20%). 최종 과분할 0·뭉침 3·문장당 평균 3.5청크. 예: "Có lẽ là do mình chấp nhận ngủ ở dưới sàn." 첫 패스 `Có lẽ là do` 하나 → 재시도 후 3청크 완성.

실측(2026-10-09, 2.5 Flash, Gara Hạnh Phúc 50문장 + Vạn Sự Như Ý 45문장, 최종 규칙으로 각 2회): 괄호 속 괄호 옛 43·57줄 → 0~3줄(남는 건 `쨍(종소리)`·`(호격)` 같은 종류 꼬리표), 한자 뜻풀이 5·35 → 0, 줄당 풀이 길이 45→33자(Gara). **빠진 청크는 옛 규칙도 같은 수준**(옛 규칙 4회 1~2문장/회, 새 규칙 0~1문장/회 — 한 번 비교하려고 옛 프롬프트로 잠시 되돌려 돌림). ♪ 개수는 실행마다 들쭉날쭉하다(같은 Gara에서 0~4개 — `bồi thường`에 붙었다 안 붙었다).


### Stage 1 스트림 끊김 감지 + 이어받기 (2026-09)

- **증상(실측)**: 노래(4:05)를 전사하면 몇 분 로딩 끝에 **오류 없이** 2:18.6 "A a"까지만 저장됐다. 끊기지 않은 실행은 3:51의 `[END_OF_AUDIO]`까지 62줄 — 폰 대본은 그 36번째 줄에서 정확히 멈춰 있었다.
- **원인 — 둘이 겹쳤다** (처음엔 ②만으로 진단했다가 정정):
  - ①**반복 루프**: 2:18 "A a"(길게 끄는 모음)를 쓰다 모델이 `" a ※ a ※ …"`를 줄바꿈 없이 131,131자(65,538토큰 = 출력 한도, 약 250초·약 230원)까지 썼다 — 폰의 '몇 분 로딩 후 2:18.6에서 멈춤'이 이것. **이 노래는 설정과 무관하게 거의 매번 루프에 빠진다**(2026-09-22 실측 8회 중 5회 확인 + 2회는 같은 자리에서 끊겨 루프로 추정. 기호 간격 2에서도, 방지 모드를 꺼도 났다 — 기호 탓이 아니다). 자리는 2:18 "A a"와 3:33 "tằng tằng".
  - ②**서버 끊김**: 스트림을 도중에 끊는다. 방식은 연결 리셋(SDK `Error reading from the stream`, 브라우저 `TypeError: network error` — 예전엔 전사 전체 실패)·조용히 닫힘·스트림 안 `{"error":…}` 조각(SDK `text()`가 `""`로 삼킴). **조용히 닫힘·스트림 안 오류는 SDK가 '정상 종료'로 알려** 예전 코드가 절반짜리 대본을 완료로 저장했다. **루프 중인 스트림을 구글이 루프 시작 약 3초 만에 연결 리셋으로 끊는 일이 잦았다**(끊긴 스트림 끝이 `" a ※ a ※ …"`) — 끊지 않고 출력 한도까지 두는 때도 있다(폰 사례). 루프 없는 끊김도 8회 중 2회 있었다.
- **판정**: 정상 완료는 마지막 조각에 `finishReason: STOP`이 붙는다(또는 90% 이후 `[END_OF_AUDIO]`로 우리가 끊음). 이게 없으면 끊긴 것(`StreamIncompleteError`, 받은 데까지 `partial`). `MAX_TOKENS`·`OTHER`·반복 루프(`loop`, 우리가 끊음)·저작권 차단(`RECITATION`)도 끊김으로 본다. **SAFETY 등 그 밖의 차단(SDK ResponseError)과 4xx는 기존대로 오류** — 다시 보내도 같다.
- **반복 루프 감지**: ①줄바꿈 없이 2000자(`LOOP_LINE_MAX_CHARS`)를 넘은 줄의 **끝 2000자에 서로 다른 단어가 30개 이하**(`isRunawayRepeat`) ②같은 줄이 연달아 50번(`LOOP_DUP_LINES`) 버려짐 → 'loop'로 이어받는다. 토큰이 계속 와서 멈춤 감시로는 못 잡는다. 실측: 우리가 끊은 요청은 800~1,000토큰(약 3원)이었다 — 출력 속도(약 260토큰/초)로 치면 루프 시작 후 약 3~4초.
  - **반드시 연결까지 끊을 것(`ctrl.abort()`)**: SDK가 응답을 둘로 나눠(tee) 한쪽은 집계용으로 끝까지 읽는다. 그래서 우리가 읽기만 멈추면(`break`) 다운로드와 서버 생성이 출력 한도까지 계속된다. 테스트가 연결 끊김을 단정한다.
  - 길이만 보지 않는 이유: 반복이 아닌 긴 줄(형식 이탈 등)은 예전처럼 끝까지 받게 둔다(원래도 `analyzeIntraLineRepetition`의 2000자 BLOCKED로 버려진다 — 기준도 같은 2000). ②의 50은 실측 사례가 없어 넉넉히 잡은 값(구호 20줄 연속은 루프가 아님 — 테스트).
- **저작권 차단(RECITATION)**: `isRecitationBlock` — 예전엔 차단 전까지 받은 가사까지 **전부 버리고** 오류만 띄웠다. 지금은 받은 데까지 두고 차단된 곳부터 이어받는다. 한 줄도 못 받았으면 같은 요청을 다시 보낸다(차단은 매번 나지 않는다: 간격 7에서 8회 중 2회). 끝내 한 줄도 못 받으면 `recitationBlockedMessage`(방지 모드 꺼짐 → 켜라 / 간격 > 2 → 2로 줄여라 / 그 외 → 다시 시도). 예전 문구는 목록에 없는 모델 "1.5 Pro"를 권했다. 간격 2를 권하는 근거: 간격 2·1은 10회 중 차단 0회(루프는 났지만 이제 처리된다). **실측 미확인**: 2026-09-22 8회(방지 모드 끔 2회 포함) 동안 차단이 한 번도 안 나서 가짜 모델 테스트로만 검증했다.
- **멈춤 감시**: 첫 조각 180초(Pro는 답 전에 오래 생각), 이후 조각 사이 60초. 사용자 중단 신호도 SDK 요청에 연결했다 — **예전엔 조각 사이에서만 중단을 확인해, 멈춘 스트림은 '전사 중단' 버튼도 먹지 않았다.**
- **이어받기**: 마지막으로 **온전히 받은 줄(줄바꿈까지 온 줄)의 시작**부터 구간 끝까지만 잘라(앞 0.3초 여유) 다시 보낸다. 그 줄은 버리고 새로 받는다(줄 시작 = 문장 경계라 이음매가 깨끗). 끊긴 스트림의 **줄바꿈 전 마지막 조각은 잘린 글자라 버린다.** 프롬프트에 직전 두 줄을 문맥으로 넣고, 이음매에서 ①첫 줄 머리에 붙어 온 앞 문장 단어(`trimBoundaryOverlap`) ②2초 안의 같은 문장 되풀이를 제거한다(같은 말이라도 제 시각이면 보존 — 노래 후렴). 최대 3회. 한 줄도 못 받았으면 원래 요청을 그대로 재사용(오디오 재추출 없음). 서버가 503/429를 알렸을 때만 백오프.
  - **다시 받은 '버렸던 줄'은 원래 시각을 쓴다**(`spliceResume`): 모델은 클립 첫 줄을 클립 0초로 적어 앞 여유 0.3초만큼 이르게 찍는다(실측 2:15.36 → 2:15.06). 같은 줄에서 이어받기가 겹치면 0.3초씩 계속 당겨졌다(3:33.58 → 3:32.98). 원래 시각은 전체 오디오를 들은 첫 요청 값이라 더 정확하다. 클립 안의 나머지 줄 시각은 정상이었다(실행 간 차이 ±0.3초, 평소 편차 수준).
- **끝내 못 받으면**: 받은 데까지 반환 + `onIncomplete({at, reason})` → `useMediaAnalysis#runStage1`이 전사 후 12초 토스트. 문구는 사유별(`incompleteNotice`: 저작권 필터 / 같은 말 되풀이 / 서버 불안정 — 예전엔 전부 '서버 불안정'). 한 줄도 못 받으면 조용한 빈 결과 대신 오류.
- **적용 범위**: 전사(단일 패스·청크 분할)만 이어받는다. 재청취 정렬(`realignMergedBlocks`)·구간 재전사/복구(`retranscribeSegments`)는 같은 `transcribeStream`을 쓰므로 끊김·루프·차단이 **감지만** 되어, 재정렬은 원래 블록 유지(폴백)·재전사는 그 구간 실패로 알린다 — 예전처럼 문장이 조용히 빠지지 않고, 루프도 몇 분이 아니라 몇 초 만에 실패로 끝난다. 재전사 실패 문구에는 `StreamIncompleteError`의 사유별 메시지가 뜬다(저작권 차단은 "RECITATION"을 포함).
- **덤으로 고친 것**: 종료 마커를 '줄 단위'로 판정 — 예전엔 마커가 온 조각째 끊어 그 조각의 앞줄들을 흘렸다.

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
- **주의 — 리뷰로 확정·수정된 4대 함정**: ①걸러진 목록에서 원래 인덱스 보존(`return null`), ②오답0/정복 화면 탈출 경로('오답만 보기' 버튼은 `mistakeOnly`인 동안 유지 + 정복 화면 '돌아가기' 버튼 + 파일 전환 시 리셋), ③키보드/버튼/MediaSession 동일 네비게이션(잠금화면 이전/다음은 **App 한 곳에서 한 번만** 등록하고 ref로 최신 goPrev/goNext를 부른다 — 2026-09 전엔 useAudioPlayer도 따로 등록해, App 등록이 '같은 커밋에서 늦게 도는 effect 순서'와 'goNext가 activeFile에 딸려 매번 새로 생기는 우연'에 기대 이기고 있었다. 실측으로는 재현 안 됐지만 둘 중 하나만 바뀌어도 잠금화면이 오답·묶음을 무시하게 돼 구조로 막았다. 브라우저에서 setActionHandler를 가로채 핸들러를 직접 호출해 묶음 반복 4→6→8, 반복 끔 4→5→6, 삭제·재생 링크 교체 후에도 재등록 0회·동작 유지 확인. 휴대폰 실제 잠금화면에서 묶음별 이동도 사용자가 확인함, 2026-09-29), ④점프 시 반복 타겟 재조준(`jumpToSentence`가 `loopTargetIdxRef` 갱신).

### 문장 편집 — 구간 재전사 · 문장 나누기 (2026-09)

기존 '전사'(문장별 재전사)와 '삭제'는 그대로 두고 더한 기능이다. 계산은 전부 `utils/sentenceEdit.js`(순수, 테스트 有), 실행은 `useMediaAnalysis#retranscribeRange`/`#splitSentence`, 화면은 `components/SentenceEditDialogs.jsx`.

- **구간 재전사**: 선택 모드 '전사' → 확인창에서 '문장별로 다시'(기존, 기본값) / '한 구간으로 다시' 선택. 구간 = 선택한 첫 문장 시작 ~ 마지막 문장이 끝나는 곳(떨어진 문장을 골라도 사이 포함, `rangeFromSelection`). 시작·끝 ±0.5초·±0.1초 조정 + 미리 듣기(시작 3초/끝 3초/전체). **교체 규칙 = 시작 시각이 [start,end) 안인 문장만**(`indicesInRange`) — 구간 밖에서 시작해 걸친 문장은 안 건드린다. 3분 초과는 경고만. 옛 문장은 휴지통, 새 문장은 Stage 3 모델로 자동 분석, 6초 실행취소. 새 결과가 없으면 옛 문장 유지.
  - **⚠️ 이웃 조각 거르기는 `isLeakedFrom`(글자만 남겨 이웃 안에 통째로 들어 있을 때만)** — 기존 복구 모드의 `dropSimilarTo`(단어 70% 겹침)와 `isBoundaryLeakFragment`(≤3단어·60%)를 쓰면 안 된다. 실측: "Màu gì, màu gì, đây?"가 앞 문장 "…sẽ là màu gì nào?"와 단어 80% 겹쳐 **진짜 새 문장인데 사라졌다**. `retranscribeSegments`는 창에 `dropLeakedFrom`이 있으면 두 방식을 끄고 이것만 쓴다(기존 복구는 그대로).
- **문장 나누기**: 문장 **1개** 선택 시에만 툴바에 '나누기'. 뒷부분이 시작될 단어를 탭 → 앞부분 삭제 / 뒷부분 삭제 / 둘 다 남기기. 뒷부분 시작 시각은 **공백 뺀 글자 수 비율**로 어림(`estimateSplitTime`, 끝은 대사 끝 시각 > 다음 문장 시작 > 영상 끝) 후 ±0.5초·±0.1초 버튼과 미리 듣기로 맞춘다. 남은 문장은 자동 재분석(Stage 3), 지운 조각은 휴지통(미분석 상태), 6초 실행취소는 원래 문장·원래 분석을 그대로 되돌린다.
  - **저장 형식 함정**: `sanitizeData`는 시각 문자열 `s`/`timestamp`가 `seconds`보다, `o`가 `text`보다, `a`가 `analysis`보다 우선이고 analysis가 남아 있으면 isAnalyzed를 다시 true로 만든다 → `applySplit`은 짝을 함께 바꾸고 analysis/a를 비운다(테스트가 sanitizeData까지 통과시켜 단정).
  - 끝이 잘린 문장(뒷부분 삭제·나누기의 앞 문장)은 `speechEnd`를 비우고 **`speechEndGraftRef`에서도 그 키를 지운다** — 안 지우면 runStage2가 옛 감지값을 다시 이식한다.
- **실행취소(`makeEditUndo`)는 재분석을 먼저 abort한 뒤 되돌린다** — 안 멈추면 끝난 배치가 자기 스냅샷으로 되돌린 데이터를 다시 덮어쓴다. 멈춘 재분석에 다른 미분석 문장이 있었으면 이어서 돌린다.
- **기존 '삭제'(`deleteSentences`)도 같은 규칙** (2026-09 수정): 예전엔 분석 중에 지우면 **다음 묶음이 끝날 때 지운 문장이 되살아나 저장까지 됐다**(runStage2가 시작 때 사본으로 통째로 덮어씀). 지금은 이 파일의 분석이 돌고 있으면(`stage2ActiveRef`) 멈추고, 남은 미분석 문장을 `stage2Model`로 이어서 돌린다. 실행취소도 `makeEditUndo`를 쓴다. 브라우저에서 Gemini 요청을 20초 붙잡는 fetch 래퍼로 재현·확인(삭제·삭제 후 실행취소 둘 다, 요청 완료 뒤 화면·캐시 문장 수 유지).
- **`runStage2`는 결과에 `data`(마지막으로 쓴 대본)를 돌려준다** — 끝난 직후 `filesRef`는 마지막 커밋 전 값일 수 있어(App이 effect에서 갱신), 재분석 실패분 복원은 이걸 기준으로 한다.
- **재전사 계열 공통 뼈대 `runRetranscribeJob`** (2026-09): 문장별 재전사·빈칸 복구·구간 재전사가 똑같이 하던 앞뒤 처리(API 키 → filesRef 읽기 → 분석 멈춤 → '다시 전사 중' 표시 → Stage 1 채널 교체 → 원본 확보·길이 → 예외 시 표시 해제·안내)를 모았다. 기능별 차이(구간 계산·결과 끼워 넣기·저장 방식·실행취소·휴지통)는 각 `work`에 그대로 두었다 — 문장별 재전사·복구는 `persistCache`(클라우드 없음), 구간 재전사는 `persistEdit`+휴지통+실행취소로 **일부러 다르다**. 옮긴 본문은 공백 무시 diff로 동일 확인. 실측: 90초 클립으로 합치기 전·후 세 기능 성공 경로(문장 수·안내 문구·표시 해제·재분석) 비교 + 가짜 SSE 응답(`[END_OF_AUDIO]`만)으로 '결과 없음' 3종 + 미디어 없는 가짜 캐시로 '원본 없음' 3종 확인.
- **구간 재전사의 첫 문장 누락 (2026-09-29 수정, 실측 3/3 재현 → 수정 후 2→2)**: 모델이 조각의 첫 줄을 늘 조각 0초로 적는데, 무음 스냅이 조각 머리를 구간 시작보다 0.3초 넘게 앞(무음)에서 자르면 첫 줄 시각이 `blockStart - 0.3`보다 이르게 계산돼 시각 필터에 '앞 문장 꼬리'로 버려졌다. 실측: 구간 71.8~81.8초, 조각 시작 71.19초, 모델 원문 `[00:00.00] Loay hoay…` → 71.19초 → 버림(2문장 → 1문장). 지금은 `selectWindowSentences`가 **구간 재전사(dropLeakedFrom 있음)에서만**, 조각 0초(`clipStart` = 무음 스냅 후 조각 시작 ±0.05초)에 찍힌 이른 줄을 구간 시작 시각으로 옮겨 살린다(시각 문자열 `s`/`timestamp`도 함께 — sanitizeData가 문자열을 우선). 앞 문장과 단어 70% 이상 겹치면 옮기지 않는다(새어 나온 조각). 복구 모드는 창이 이웃 문장 시작부터라 해당 없음 — 그대로. 변이 5개(구제 끔·닮음 검사·0초 조건·복구 모드 적용·시각 문자열) 각각 실패 확인.
- **휴지통 복구 시 미분석 문장은 즉시 분석**(`restoreSentences`) — 나누기로 잘라낸 조각은 분석 없이 보관되므로 안 하면 스피너만 돈다.
- **미리 듣기는 본 플레이어가 아니라 별도 `<audio>`(`hooks/usePreviewPlayer.js`)** — 본 플레이어로 재생하면 문장 반복·대사만 건너뛰기 엔진이 위치를 옮겨 경계 확인이 안 된다. 시작 전 본 플레이어를 멈춘다. (브라우저 검증 주의: 탭이 hidden이면 크롬이 미디어를 아예 안 불러와 소리 확인 불가 — 자동 검증은 호출 위치·시간까지만. 실제 소리는 사용자가 휴대폰에서 확인함, 2026-09-29)

### 대본 정확도 자기 검증 (커버리지 검사 + 전사의심)

- **분석 커버리지 검사(비용 0)**: `utils/analysisCoverage.js#checkAnalysisCoverage` — 원문 단어↔청크 대조(규칙 9)와 뭉침(문장 전체=1청크 또는 10단어↑ 청크, 숫자 병기 청크는 길이 검사 제외) 감지. **뭉침 길이 기준이 느슨한(10) 이유: 공식 예시에 7단어 청크가 있고, 베트남어 띄어쓰기는 음절 단위라 겹단어가 2칸으로 세어져 부풀려짐(실사용 오탐 2건으로 8→10 완화). 심한 뭉침은 문장전체=1청크 검사와 분석 시점 60% 편중 자동재분할이 담당.** **길이는 '의미 단위'로 센다(`countMeaningUnits`, 2026-10)**: 대문자로 시작하는 음절이 이어지면 지명·이름 하나(쉼표·마침표에서 끊음). 실측 오탐 `đi từ Hải Phòng đến xã Bum Tở Lai Châu`(10칸 → 6단위). 누락 검사는 그대로 음절 단위. 옛 세기·쉼표 끊기 변이 각각 실패 확인. **과분할 배지(2026-10)**: 구두점만인 청크(`**?**: ?`)가 있거나 6청크 이상인데 청크당 평균 2.5음절 미만이면 `oversplit`(휴대폰 실측 33단어→16청크 = 2.06). 7단어→4청크 같은 가벼운 분할은 안 잡는다(6청크 조건 — 배지 신뢰). 기준 2.5: Flash 결과 278문장은 2.8 미만도 0건, Lite 165문장은 2.5 미만 9건(2단어 청크 나열, 화면에서 '과분할' 배지 확인) — Flash 오탐 없이 Lite 과분할만 잡힌다. 변이 4개(구두점 조건·2.2→2.0·6청크→3청크·파서 필터) 각각 실패 확인. **파서 안전망 `stage2Parser#isPunctOnlyChunk`**: 굵은 청크에 글자·숫자가 없는 줄은 저장 전에 버린다(옛 캐시엔 배지로만 보임). TranscriptItem 헤더 배지(누락 N/뭉침/과분할/분석 깨짐) → 탭 시 확인창 후 1문장 재분석. 옛 캐시에도 소급 표시.
- **전사의심(규칙 15, 선택 출력)**: Stage 2가 문맥상 오전사 의심 문장에 `[전사의심] 이유` 한 줄 추가 → 파서가 `transcriptSuspect`로 추출(없으면 빈 값, 옛 캐시 완전 호환 → **ANALYSIS_VERSION 불변**). 배지 탭 → 확인창 후 그 구간만 재전사. **주의: 새 문장 필드는 `sanitizeData`(mediaUtils)의 반환 객체에 명시적으로 넣어야 캐시 재로드에서 살아남는다** (화이트리스트 방식이라 빠지면 유실).

- **Stage 2 마커 파서 = 순수 모듈 `services/stage2Parser.js#parseStage2Response`**(2026-07 분리, 테스트 有). 예전엔 `analyzeBatchSentences` 안 인라인 클로저였고 **테스트가 0**이었다. 각 문장을 `--- [INDEX: N] START/END ---` 사이에서 뽑는데, **끝 경계 버그가 있었다**: 끝을 `text.indexOf(자기 END)`로만 잡아, 모델이 END 마커를 제 블록 뒤가 아니라 **응답 끝에 몰아서** 출력하면(실측 이탈) 자기 END가 뒤 문장들 '너머'라 substring이 뒤 문장까지 삼키고 `matchAll(/\[분석\]/g)`가 그들 청크를 전부 긁었다 → **문장 카드마다 다음 문장들 분석이 누적**(S1⊃S2⊃S3…, 스크린샷 보고). 번역은 `.match`(첫 줄)라 멀쩡했고 **분석만 `.matchAll`이라 넘쳤다** — 이 비대칭이 파서가 원인이라는 결정적 단서. 수정: 끝을 `min(자기 END, 바로 다음 문장 START, 길이)`로 clamp → 마커가 밀려도 다음 START에서 끊긴다. 정상 응답엔 다음 START가 자기 END 바로 뒤라 결과 **완전 동일**(회귀 없음). **failed 판정은 불변**(자기 START·END 중 하나라도 없으면 실패 → 토큰 잘림 재시도 안전망 유지). 회귀 테스트(`__tests__/stage2Parser.test.js`)의 'END 몰림' 케이스는 clamp를 옛 코드로 되돌리면 즉시 실패한다(빈 통과 아님, 실측). **이미 캐시된 오염 분석은 자동 복구 불가**(저장 시 마커가 제거돼 내 청크/남의 청크 구분 불가) → 파서 수정 후 **그 문장만 재분석**해야 정상화된다.

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
- **선택 재감지 (A2, 클립 전용)**: 재전사/분석(선택 모드) 패널의 '대사만' 버튼 → `detectSpeechEndsForFile(fileId, { indices })`. 들어보니 speechEnd가 **틀린**(음악을 대사로 세서 늦게 찍힌) 문장만 골라 **덮어써** 고친다(`onlyMissing`은 *빠진* 것만, 이건 *틀린* 것도 포함 — done이어도 재요청). 병합은 기존 코드 재사용(값 있으면 덮어쓰고, 없으면 speechEndSkipped로 기존값 유지). **비용: 전체 오디오가 아니라 문장별 짧은 클립만 전송** — `gemini.js#detectSpeechEndsByClips`가 `clipWindowForDetection`(speechSegments, 순수·테스트됨)으로 `[시작−1.5s, 다음대사시작+1.5s]` 창을 잡아 구간 재전사와 같은 `extractWindow`(실시간 캡처→전체추출 폴백)로 클립을 뜬다. **오프셋 왕복**: 클립은 0-기준이라 문장 시작을 `(절대−winStart)`로 낮춰 보내고 모델 답에 `+winStart`를 더해 절대로 되돌린다(offset=winStart, 오프셋 뮤테이션 테스트로 못 박음). **클립 상한은 `MAX_SENTENCE_SEC`와 같은 출처**(blockStart+MAX+padEnd) — winStart 기준으로 잡으면 병합이 받는 유효 끝의 뒤쪽이 잘린다. **블록 정합**: 같은 seconds 형제는 `blockSpeechEnd`가 최댓값으로 묶으므로, 선택 인덱스의 같은-seconds 형제를 모두 확장해 재감지(한 형제만 고치면 블록 skip이 안 바뀜). **부분 성공 보존**: 클립 배치 중 한 문장의 모델 호출이 던져도(503 등) 이미 성공한 결과를 버리지 않게 per-sentence try/catch로 격리(AbortError만 전파). **감지 중 재진입 차단**: `confirmDetectSpeech`는 `speechDetectBusy`면 무반응(칩/배지 핸들러와 동일) — 안 그러면 무반응+선택소실.
- **주의 — 감지는 `isAnalyzing`을 세우지 않는다**(`speechDetectBusy`라는 별도 상태를 쓴다). 그래서 `isAnalyzing`을 조건으로 하는 모든 보호 장치를 **그냥 통과한다**: ①`loadCache`의 데이터 보존 가드, ②`handleHome`/`removeFile`의 경고창. 감지 관련 상태를 다룰 땐 두 조건을 항상 같이 검토할 것. `purgeLocal`(이 기기에서 삭제)에는 아직 감지 가드가 없다(알려진 한계 — 자체 확인창은 있음).
- **감지 결과 구제(`mediaUtils.js#graftSpeechEnds`)**: 완료된 대본을 다시 여는 유일한 경로인 `loadCache`는 항목 data를 localStorage 스냅샷으로 **통째 교체**한다. 저장이 실패했거나 저장 전에 전환하면 화면의 speechEnd가 그 한 줄에서 소멸했다(되돌릴 방법 없음 — `speechEndGraftRef`는 `runStage2` 안에서만 읽힌다). 지금은 교체 직전 메모리값을 이식한다. **규칙: 채우기만 하고 덮어쓰지 않는다(저장본 우선), `seconds`+`text`가 둘 다 같을 때만**(재전사된 문장에 옛 값이 붙는 오염 방지). Stage 2 재개 경로(`runStage2` 호출)에도 반드시 **이식본**을 넘길 것 — 안 그러면 Stage 2가 speechEnd 없는 스냅샷으로 되돌린다.
- **⚠️ 상태 업데이터 실행 타이밍에 의존하지 말 것** (실제로 물린 버그): `setFiles(prev => {... 값 꺼내기 ...})` 후 `await setTimeout(0)`으로 "이제 실행됐겠지" 하고 결과를 읽던 코드가 있었다. React 18은 자체 스케줄러(MessageChannel)로 업데이트를 처리하므로 **`setTimeout(0)`이 먼저 깨는 경우가 있다**. 그러면 `applied=0 / latestData=null`로 오판해 **오류 토스트를 띄우고 저장을 건너뛴 뒤, 잠시 후 업데이터가 실행돼 화면만 켜졌다** → "오류가 떴는데 칩은 초록, 다시 열면 사라짐"(간헐적, 재현율 3/3인 날도 있었다). **해법: 최신 사본 ref(App의 `filesRef`)에서 동기적으로 읽어 계산까지 끝내고, 상태에는 결과만 반영한다(업데이터는 순수하게 유지).** 남아 있던 `deleteSentences`·`reanalyzeSentences`·`useMediaCache#loadCache`·`purgeLocal`도 2026-09에 이 방식으로 바꿨다(`useMediaCache`도 `filesRef`를 받는다). `purgeLocal`은 덤으로 '보던 영상' 판정을 고쳤다 — 예전엔 목록 첫 영상과 비교해, 두 번째 이후로 보던 영상을 지우면 화면이 지워진 영상을 계속 가리켰다(가짜 캐시 항목으로 확인).
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
- **목록 순서(첫 화면·기록 창 공통, 2026-09)**: 즐겨찾기 묶음이 위, 나머지가 아래. 각 묶음 안은 **마지막으로 열었거나 별을 누른** 영상이 맨 위(`utils/recentOpen.js`, `miniapp_recent_open` = `{ "{name}_{size}": 시각 }`, 이 기기에만). 기록 시점: `loadCache`/`loadCloud` **시작 시**(미디어 로딩을 기다린 뒤에 적으면 그사이 목록으로 돌아왔을 때 순서가 안 바뀐다 — 실측), `processFiles`(올린 파일), 별 추가(`useFavorites`). '이 기기에서 삭제'(`purgeLocal`)는 기록도 지운다. 기록이 없으면(첫 실행) 캐시의 `metadata.savedAt`으로 **한 번만** 채운다 — 목록이 그릴 때마다 큰 대본 JSON을 파싱하지 않게.
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
- 지원 모델: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite` (목록은 `constants/models.js` 단일 출처). 기본값은 전사·분석·재전사 모두 `gemini-2.5-flash`. 목록에서 뺀 모델(`gemini-2-flash` 서비스 종료, `gemini-3.5-flash`·`gemini-3.6-flash` 실측 탈락)이 저장값에 남아 있으면 `useSettings`의 `validModel`이 기본값으로 교체한다 — **기본값 자체가 목록 안에 있어야 이 폴백이 성립한다**(테스트가 단정).
- **3.x 모델의 생각 기능**: 2.5의 `thinkingBudget: 0` 대신 `thinkingLevel`로 가장 낮게 내린다(`models.js`의 모델별 `thinkingLevel`, 3.1 Flash Lite는 `minimal` — 생각 토큰 0 확인). 3.x는 생각을 완전히 끌 수 없다.
- **한 번 돌린 결과로 판단하지 말 것**: 3.6 Flash는 첫 테스트에서 52문장·최대 24단어로 가장 좋았지만, 이후 4회는 34~41문장·최대 37~55단어로 문장을 뭉쳤다(같은 영상·같은 설정). 한 번 결과만 보고 전사 기본값으로 올렸다가 되돌렸다. 같은 모델도 실행마다 편차가 크다 — 최소 3회.
- **3.x에 온도 1.0(구글 권장)을 줘도 해결되지 않았다**: 3.6 Flash를 1.0으로 3회 돌리자 1회는 오디오에 없는 인사말 8줄을 지어냈다(시각도 최대 20초 어긋남). '3.x는 자동으로 온도 1.0' 방식은 채택하지 않았다.
- **시각 정확도 기준값**: `gemini-3.5-transcribe`(전사 전용, `v1beta/interactions` 엔드포인트, 파일 API 업로드 필수, 프롬프트 불가)의 단어별 시각을 정답으로 문장 시작 오차를 잰다. 2.5 Flash 보통 0.1~0.2초, 3.1 Flash Lite 0.1초, 3.6 Flash 0.3~0.4초. Transcribe 자체는 프롬프트를 못 받아 전사 규칙(1줄 1문장·숫자 병기·RECITATION 회피)을 적용할 수 없어 앱에 붙이지 않았다.
- **새 모델 추가 전 실측 필수**: 2026-09 테스트에서 3.8 Flash·3.5 Flash Lite는 오류 없이 돌았지만 전사에서 문장을 뭉쳐(한 줄 56~57단어) '1줄 1문장'을 어겨 제외했다. 오류가 안 나는 것과 쓸 만한 것은 다르다 — 문장 수·한 줄 최대 단어 수·마지막 시각을 2.5 Flash와 비교할 것.
- Vite 설정에서 `@ffmpeg/ffmpeg`, `@ffmpeg/util`은 optimizeDeps에서 제외 (WASM)

## 작업 시작 전 룰

작업을 시작하기 전에 95% 확신이 들 때까지 저에게 추가 질문을 해주세요. 확신이 안 서면 코드를 작성하지 마세요.

## Language Note

코드 주석과 프롬프트는 한국어로 작성되어 있습니다. UI는 한영 혼용이며, 프롬프트 수정 시 9대 분석 규칙의 정합성에 특히 주의해야 합니다.
