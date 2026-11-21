import { describe, it, expect } from 'vitest';
import { waitUntilOnline } from '../online';

// 가짜 창: navigator.onLine과 'online' 알림만 흉내 낸다
function fakeEnv(onLine) {
    const listeners = new Set();
    return {
        navigator: { onLine },
        addEventListener: (type, fn) => { if (type === 'online') listeners.add(fn); },
        removeEventListener: (type, fn) => { listeners.delete(fn); },
        goOnline() { this.navigator.onLine = true; for (const fn of [...listeners]) fn(); },
        listeners,
    };
}

describe('인터넷이 다시 연결될 때까지 기다리기', () => {
    it('연결돼 있으면 바로 끝난다', async () => {
        const env = fakeEnv(true);
        await waitUntilOnline(60000, null, env);
        expect(env.listeners.size).toBe(0);
    });

    it("끊겨 있으면 '다시 연결됨' 알림이 올 때 끝난다", async () => {
        const env = fakeEnv(false);
        let done = false;
        const p = waitUntilOnline(60000, null, env).then(() => { done = true; });
        await new Promise(r => setTimeout(r, 20));
        expect(done).toBe(false);
        env.goOnline();
        await p;
        expect(done).toBe(true);
        expect(env.listeners.size).toBe(0);
    });

    it('알림이 안 와도 정한 시간이 지나면 끝난다', async () => {
        const env = fakeEnv(false);
        const t0 = Date.now();
        await waitUntilOnline(40, null, env);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(30);
        expect(env.listeners.size).toBe(0);
    });

    it('기다리는 중에 취소하면 바로 멈춘다', async () => {
        const env = fakeEnv(false);
        const ctrl = new AbortController();
        const p = waitUntilOnline(60000, ctrl.signal, env);
        ctrl.abort();
        await expect(p).rejects.toMatchObject({ name: 'AbortError' });
        expect(env.listeners.size).toBe(0);
    });
});
