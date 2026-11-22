// 재생 링크가 죽어 저장소 원본으로 갈아끼울 때, '듣던 자리'와 '틀려던 뜻'을 지키기 위한 판단들.
// 예전엔 링크만 갈아끼워서 자리가 0초로 돌아가고, 방금 누른 ▶는 없던 일이 됐다
// (오래 자리를 비운 뒤 첫 탭이 무시되는 것처럼 보임 — 2026-11-22, 조용한 오류 점검 ⑤).

// ▶를 누른 지 이 시간 안에 링크가 죽은 것으로 드러나면, 복구 뒤 그 재생을 이어서 해 준다.
export const RECOVER_TAP_MS = 5000;
// 재생 위치가 이 시간 안에 실제로 나아가고 있었으면 '듣던 중'으로 본다.
export const RECOVER_LIVE_MS = 3000;
// 같은 파일의 복구는 이 시간 안에 이 횟수까지만(복구한 링크가 곧바로 또 죽는 되풀이 차단).
export const RECOVER_WINDOW_MS = 60000;
export const RECOVER_MAX = 2;

/**
 * 링크를 갈아끼운 뒤 되돌릴 자리와 재생 여부를 정한다.
 * @param {{ armed: ({time:number, play:boolean}|null), pendingSeek: (number|null), lastPos: number,
 *           paused: boolean, lastSyncAt: number, wantPlayAt: number, now: number }} s
 *   armed = 이미 복구 중이던 것(복구한 링크가 또 죽은 경우 — 처음 정한 자리를 그대로 잇는다)
 *   pendingSeek = 아직 적용 못 한 '열 때 되돌릴 자리'
 *   lastPos = 마지막으로 확인한 재생 위치(초). 문장 ▶를 누르면 그 문장 시작으로 바뀐다
 *   lastSyncAt = 재생 위치가 마지막으로 나아간 시각(ms), wantPlayAt = ▶를 마지막으로 누른 시각(ms, 멈춤을 누르면 0)
 * @returns {{ time: number, play: boolean }}
 */
export function pickRecover({ armed = null, pendingSeek = null, lastPos = 0, paused = true, lastSyncAt = 0, wantPlayAt = 0, now }) {
    const raw = armed ? armed.time : (pendingSeek != null ? pendingSeek : lastPos);
    const time = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const tapped = wantPlayAt > 0 && now - wantPlayAt <= RECOVER_TAP_MS;
    const listening = !paused && lastSyncAt > 0 && now - lastSyncAt <= RECOVER_LIVE_MS;
    return { time, play: !!(armed && armed.play) || tapped || listening };
}

/**
 * 복구를 한 번 더 해도 되는지. 예전엔 '파일당 평생 2번'이라, 오래 켜 둔 앱에서 세 번째로 링크가 죽으면
 * 아무 표시 없이 재생이 안 됐다. 이제는 1분 안에 2번까지 — 1분이 지나면 다시 센다.
 * @param {{ n: number, at: number }|undefined} prev
 * @returns {{ ok: boolean, next: { n: number, at: number } }}
 */
export function recoverGate(prev, now) {
    if (!prev || now - prev.at > RECOVER_WINDOW_MS) return { ok: true, next: { n: 1, at: now } };
    if (prev.n < RECOVER_MAX) return { ok: true, next: { n: prev.n + 1, at: prev.at } };
    return { ok: false, next: prev };
}
