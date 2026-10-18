// 전사(1단계) 실패 화면의 문구. 예전엔 SDK 원문("[GoogleGenerativeAI Error] … 400 Bad Request")을 그대로 보여 줘서
// 비개발자가 왜 실패했는지, 뭘 눌러야 하는지 알 수 없었다. 여기서 사유별 한국어 한 줄 + 맞는 버튼으로 바꾼다.
// 순수 함수 — 화면 없이 테스트한다. 원문은 '자세히'로 접어 둔다(raw).

// 호출부가 앞에 붙이는 머리말 — 사용자에겐 뜻이 없다.
const PREFIXES = [/^Analysis failed:\s*/i, /^API Error \(Stage 1\):\s*/i, /^Retry Analysis Error:\s*/i];

export function stage1FailureNotice(errorText) {
    const raw = String(errorText || '').trim();
    let msg = raw;
    for (const p of PREFIXES) msg = msg.replace(p, '');

    // gemini.js가 이미 "[오류: 구글 서버 과부하] 설명…"처럼 한국어로 만든 것은 머리말을 제목으로 쓴다
    const bracket = msg.match(/^\[오류:\s*([^\]]+)\]\s*(.*)$/s);
    if (bracket) return { title: bracket[1].trim(), detail: bracket[2].trim(), action: 'retry', raw };

    if (/API key not valid|API_KEY_INVALID|API Key is required|Please set Gemini API Key|PERMISSION_DENIED|\b403\b|\b401\b/i.test(msg)) {
        return { title: 'API 키 문제예요', detail: '설정에서 Gemini 키가 맞는지 확인해 주세요. 키를 새로 받았으면 다시 붙여 넣으세요.', action: 'settings', raw };
    }
    if (/RECITATION|저작권/i.test(msg)) {
        return { title: '저작권 필터에 걸렸어요', detail: msg.replace(/^.*?(설정|방지|간격)/s, '$1') || '설정 > 고급 설정에서 저작권 차단 피하기를 켜고 다시 시도해 보세요.', action: 'settings', raw };
    }
    if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        return { title: '요청 한도에 걸렸어요', detail: '1분쯤 뒤에 다시 시도해 주세요. 무료 한도를 다 썼으면 내일 다시 할 수 있어요.', action: 'retry', raw };
    }
    if (/\b503\b|UNAVAILABLE|overloaded|\b5\d\d\b/i.test(msg)) {
        return { title: '구글 서버가 붐벼요', detail: '잠시 후 다시 시도해 주세요. 대개 몇 분 안에 풀려요.', action: 'retry', raw };
    }
    if (/\b413\b|too large|request entity|exceeds/i.test(msg)) {
        return { title: '파일이 너무 커요', detail: '15분 안쪽으로 잘라서 올리거나, 설정 > 고급 설정에서 긴 영상 나눠 받아쓰기를 켜 주세요.', action: 'settings', raw };
    }
    if (/Failed to fetch|NetworkError|network error|ERR_INTERNET|ERR_NETWORK|offline/i.test(msg)) {
        return { title: '인터넷이 끊겼어요', detail: '연결을 확인한 뒤 다시 시도해 주세요.', action: 'retry', raw };
    }
    if (/No valid data found|music\/noise/i.test(msg)) {
        return { title: '말소리를 찾지 못했어요', detail: '이 파일은 음악이나 소음만 있을 수 있어요. 다른 파일로 해 보세요.', action: 'retry', raw };
    }
    if (/오디오 데이터가 비어 있음|size=0B/i.test(msg)) {
        return { title: '소리를 꺼내지 못했어요', detail: '파일이 깨졌거나 소리 트랙이 없을 수 있어요. 다른 파일로 해 보세요.', action: 'retry', raw };
    }
    // 우리가 쓴 한국어 안내(중단·취소)는 그대로 제목으로
    if (/^[가-힣]/.test(msg) && msg.length <= 60) return { title: msg, detail: '', action: 'retry', raw };

    return { title: '받아쓰기에 실패했어요', detail: '잠시 후 다시 시도해 주세요. 계속 안 되면 아래 자세히를 눌러 보여 주세요.', action: 'retry', raw };
}
