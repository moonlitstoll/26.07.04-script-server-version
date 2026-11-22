import { describe, it, expect } from 'vitest';
import { pickRecover, recoverGate, RECOVER_TAP_MS, RECOVER_LIVE_MS, RECOVER_WINDOW_MS } from '../mediaRecover';

const NOW = 1_000_000;

describe('pickRecover — 링크를 갈아끼운 뒤 되돌릴 자리', () => {
    it('멈춰 둔 채 링크가 죽으면 듣던 자리로, 재생은 하지 않는다', () => {
        expect(pickRecover({ lastPos: 42.5, paused: true, now: NOW })).toEqual({ time: 42.5, play: false });
    });
    it('방금 ▶를 눌렀는데 링크가 죽어 있었으면 그 자리에서 재생한다', () => {
        expect(pickRecover({ lastPos: 9, paused: true, wantPlayAt: NOW - 800, now: NOW })).toEqual({ time: 9, play: true });
    });
    it('▶를 누른 지 오래됐으면 재생하지 않는다', () => {
        expect(pickRecover({ lastPos: 9, paused: true, wantPlayAt: NOW - RECOVER_TAP_MS - 1, now: NOW }).play).toBe(false);
    });
    it('듣던 중에 죽었으면(위치가 방금까지 나아감) 이어서 재생한다', () => {
        expect(pickRecover({ lastPos: 30, paused: false, lastSyncAt: NOW - 200, now: NOW })).toEqual({ time: 30, play: true });
    });
    it('재생 중 표시만 남고 위치는 오래 멈춰 있었으면 재생하지 않는다(돌아왔을 때 갑자기 소리 나지 않게)', () => {
        expect(pickRecover({ lastPos: 30, paused: false, lastSyncAt: NOW - RECOVER_LIVE_MS - 1, now: NOW }).play).toBe(false);
    });
    it('열 때 되돌릴 자리가 아직 적용 전이면 그 자리를 쓴다', () => {
        expect(pickRecover({ pendingSeek: 77, lastPos: 0, now: NOW }).time).toBe(77);
    });
    it('복구한 링크가 또 죽으면 처음 정한 자리·재생 여부를 그대로 잇는다', () => {
        expect(pickRecover({ armed: { time: 12, play: true }, lastPos: 0, paused: true, now: NOW })).toEqual({ time: 12, play: true });
    });
    it('깨진 값은 0초로', () => {
        expect(pickRecover({ lastPos: NaN, now: NOW }).time).toBe(0);
        expect(pickRecover({ lastPos: -3, now: NOW }).time).toBe(0);
    });
});

describe('recoverGate — 복구 횟수 제한', () => {
    it('처음은 된다', () => {
        expect(recoverGate(undefined, NOW)).toEqual({ ok: true, next: { n: 1, at: NOW } });
    });
    it('1분 안에 두 번까지 되고 세 번째는 안 된다', () => {
        const a = recoverGate(undefined, NOW);
        const b = recoverGate(a.next, NOW + 1000);
        expect(b).toEqual({ ok: true, next: { n: 2, at: NOW } });
        const c = recoverGate(b.next, NOW + 2000);
        expect(c.ok).toBe(false);
        expect(c.next).toEqual(b.next);
    });
    it('1분이 지나면 다시 된다(예전엔 파일당 평생 2번이라 세 번째부터 조용히 재생이 안 됐다)', () => {
        const spent = { n: 2, at: NOW };
        expect(recoverGate(spent, NOW + RECOVER_WINDOW_MS).ok).toBe(false);
        expect(recoverGate(spent, NOW + RECOVER_WINDOW_MS + 1)).toEqual({ ok: true, next: { n: 1, at: NOW + RECOVER_WINDOW_MS + 1 } });
    });
});
