// 문장의 analysis 문자열(여러 줄)에서 의미 청크를 뽑아낸다.
// 각 줄 형식: "**원어 청크**: 한국어 뜻 (요소별 상세)"  ([분석] 마커는 저장 시 제거됨)
// 반환: [{ chunk: '원어', meaning: '뜻(상세)' }]
//  - 💡 태그(폐지 기능)는 뜻에서 제거, ⚡실제 병기는 보존(학습에 유용)
//  - "문장 전체=1청크" 실패본이면 길이 1 배열이 나오고, 호출부에서 '통째 가림'으로 처리
export function parseChunks(item) {
    if (!item || !item.isAnalyzed || typeof item.analysis !== 'string') return [];
    return item.analysis.split('\n')
        .map(raw => {
            // 혹시 남아있을 수 있는 [분석]/분석] 접두 제거
            const line = raw.replace(/^\s*\[?\s*분석\s*\]?\s*/, '');
            const m = line.match(/^\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/);
            if (!m) return null;
            const chunk = m[1].trim();
            if (!chunk) return null;
            const meaning = (m[2] || '').replace(/\\n/g, ' ').replace(/\s*〔💡[^〕]*〕/g, '').trim();
            return { chunk, meaning };
        })
        .filter(Boolean);
}
