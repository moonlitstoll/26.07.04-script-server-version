// 연속 반복되는 단위(단어/문구)를 최대 keepMax개까지만 남긴다.
// 정규식 역참조(백트래킹 폭발/ReDoS) 대신 토큰 배열을 선형 스캔한다.
// - minRepeat: 이 횟수 이상 연속 반복되면 축약 대상
// - maxUnit: 반복 단위로 인정하는 최대 단어 수
// - keepMax: 반복 시 보존할 최대 단위 수 (실제 반복 강조는 살리되 환각 루프는 자름)
const PUNCT_STRIP = /[.,!?;:…"'`()[\]{}<>~\-—«»「」『』、。，！？]+/g;

function collapseConsecutiveRepeats(text, { minRepeat = 2, maxUnit = 8, keepMax = 2 } = {}) {
    const tokens = text.split(/\s+/).filter(Boolean);
    const n = tokens.length;
    if (n < 2) return { text, changed: false };

    // 비교용 정규화(구두점 제거 + 소문자), 출력은 원본 토큰 유지
    const norm = tokens.map(t => t.replace(PUNCT_STRIP, "").toLowerCase());

    const out = [];
    let changed = false;
    let i = 0;
    while (i < n) {
        let collapsed = false;
        const maxLen = Math.min(maxUnit, Math.floor((n - i) / minRepeat));
        for (let unitLen = 1; unitLen <= maxLen; unitLen++) {
            // 정규화 후 비어있는 단위(순수 구두점 등)는 반복 판정에서 제외
            let emptyUnit = false;
            for (let k = 0; k < unitLen; k++) {
                if (norm[i + k] === "") { emptyUnit = true; break; }
            }
            if (emptyUnit) continue;

            let reps = 1;
            for (;;) {
                const base = i + reps * unitLen;
                if (base + unitLen > n) break;
                let same = true;
                for (let k = 0; k < unitLen; k++) {
                    if (norm[i + k] !== norm[base + k]) { same = false; break; }
                }
                if (!same) break;
                reps++;
            }

            if (reps >= minRepeat) {
                const keep = Math.min(reps, keepMax); // 최대 keepMax 단위 보존
                for (let r = 0; r < keep; r++) {
                    for (let k = 0; k < unitLen; k++) out.push(tokens[i + r * unitLen + k]);
                }
                i += reps * unitLen;
                if (reps > keep) changed = true; // 실제로 줄였을 때만 표시
                collapsed = true;
                break;
            }
        }
        if (!collapsed) {
            out.push(tokens[i]);
            i++;
        }
    }

    return { text: out.join(" "), changed };
}

export function analyzeIntraLineRepetition(text) {
    if (!text) return { original_text: text, refined_text: text, status: "PASS" };

    // 1) 반복 축약을 먼저 수행 → 환각성 반복 루프가 깨끗한 한 줄로 정리된다.
    const { text: collapsed, changed } = collapseConsecutiveRepeats(text, { minRepeat: 2, maxUnit: 8 });

    // 2) 그래도 비정상적으로 길면(답 없는 거대 환각) 그때만 차단한다.
    if (collapsed.length > 2000) {
        const detectedLang = detectLanguage(text);
        let blockedMsg = "[시스템: 비정상적으로 긴 텍스트 차단됨]";
        if (detectedLang === "vi") blockedMsg = "[Hệ thống: Văn bản quá dài bị chặn]";
        else if (detectedLang === "en") blockedMsg = "[System: Abnormally long text blocked]";
        return { original_text: text, refined_text: blockedMsg, status: "BLOCKED" };
    }

    return { original_text: text, refined_text: collapsed, status: changed ? "TRUNCATED" : "PASS" };
}

export function detectLanguage(text) {
    const vietnameseRegex = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂưăạảấầẩẫậắằẳẵặẹẻẽềềểỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪễệỉịọỏốồổỗộớờởỡợụủứừỬỮỰỲỴÝỶỸửữựỳỵỷỹ]/;
    const koreanRegex = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
    if (koreanRegex.test(text)) return "ko";
    if (vietnameseRegex.test(text)) return "vi";
    return "en";
}
