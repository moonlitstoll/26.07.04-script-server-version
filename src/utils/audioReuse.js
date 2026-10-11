// 1단계 전사가 구글 파일 저장소에 올린 '전체 오디오' 주소를 기억해, 같은 영상의 '대사만' 감지가
// 오디오를 다시 뽑고 다시 올리지 않게 한다. 순수 모듈(테스트 대상) — 기록은 호출부의 Map(이 탭 메모리)에만.
//
// 점검 실측(2026-10-11, 9회): 감지 단계의 재업로드 9.6~46.6초(평균 약 22초) + 감지 전 대기 8~12초
// (원본 다시 읽기·길이 계산·오디오 재추출). 휴대폰은 15MB 넘는 오디오를 두 번 보내 데이터도 두 배.
// 같은 영상·같은 추출 방식이라 올라간 오디오는 감지가 다시 만들 것과 똑같다.

// 구글은 올린 파일을 48시간 보관한다 — 여유를 두고 46시간까지만 쓴다(넘으면 예전처럼 다시 올림)
export const AUDIO_REUSE_MS = 46 * 3600 * 1000;

// 캐시 키와 같은 신원(이름·크기). 메모리 적재본(materializeFile)이 아니라 원본 신원을 넘길 것
export const audioReuseKey = (file) => (file && file.name ? `${file.name}_${file.size}` : '');

// 구글 파일 저장소에 올린 경우(fileData)만 기억한다. 15MB 이하라 요청에 직접 실은(inlineData) 오디오는
// 다시 보내야 하므로 기억할 게 없다.
export function rememberAudio(cache, file, part, duration = 0, now = Date.now()) {
    const key = audioReuseKey(file);
    if (!key || !part?.fileData?.fileUri) return;
    cache.set(key, { part, duration, at: now });
}

export function reusableAudio(cache, file, now = Date.now()) {
    const key = audioReuseKey(file);
    const hit = key ? cache.get(key) : null;
    if (!hit) return null;
    if (now - hit.at > AUDIO_REUSE_MS) { cache.delete(key); return null; }
    return hit;
}

export function forgetAudio(cache, file) {
    cache.delete(audioReuseKey(file));
}
