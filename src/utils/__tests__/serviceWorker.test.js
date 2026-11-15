import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { precacheList, renderServiceWorker } from '../swBuild';
import { isOffline } from '../online';

// 인터넷 없이 열기(public/sw.js). 사본이 아니라 실제 파일을 읽어, 빌드가 쓰는 실제 함수로 채운 뒤
// 가짜 브라우저(self·caches·fetch)에서 돌린다.
const TEMPLATE = readFileSync(fileURLToPath(new URL('../../../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://app.test';
const DIST = ['index.html', 'assets/index-AAA.js', 'assets/index-AAA.css', 'icon-192.png', 'manifest.webmanifest',
    'version.json', 'sw.js', 'ffmpeg/ffmpeg-core.wasm', 'ffmpeg/ffmpeg-core.js'];

const fakeCaches = () => {
    const store = new Map(); // 이름 → Map(주소 → Response)
    const keyOf = (k) => new URL(typeof k === 'string' ? k : k.url, ORIGIN).pathname;
    const api = (name) => ({
        put: async (k, res) => { store.get(name).set(keyOf(k), res); },
        match: async (k) => store.get(name)?.get(keyOf(k)),
    });
    return {
        store,
        open: async (name) => { if (!store.has(name)) store.set(name, new Map()); return api(name); },
        keys: async () => [...store.keys()],
        delete: async (name) => store.delete(name),
        match: async (k, opts = {}) => {
            const names = opts.cacheName ? [opts.cacheName] : [...store.keys()];
            for (const n of names) { const hit = store.get(n)?.get(keyOf(k)); if (hit) return hit; }
            return undefined;
        },
    };
};

const res = (body, type = 'application/javascript', status = 200) =>
    new Response(body, { status, headers: { 'content-type': type } });
const typeOf = (path) => path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'application/javascript';

// buildId·서버 응답을 바꿔 가며 sw.js를 띄운다. fetchImpl(주소, 옵션) → Response | throw
const boot = ({ buildId = '200', caches = fakeCaches(), fetchImpl } = {}) => {
    const handlers = {};
    const self = {
        addEventListener: (type, fn) => { handlers[type] = fn; },
        location: { origin: ORIGIN },
        skipWaiting: vi.fn(async () => {}),
        clients: { claim: vi.fn(async () => {}) },
    };
    const fetchMock = vi.fn(async (input, init) => fetchImpl(typeof input === 'string' ? input : input.url, init));
    const src = renderServiceWorker(TEMPLATE, { buildId, files: precacheList(DIST) });
    new Function('self', 'caches', 'fetch', src)(self, caches, fetchMock);
    const lifecycle = async (type) => { let p; handlers[type]({ waitUntil: (x) => { p = x; } }); await p; };
    // 반환: respondWith에 넘어간 약속(가로챈 경우) 또는 null(브라우저에 맡김)
    const request = (path, { mode = 'no-cors', method = 'GET', origin = ORIGIN } = {}) => {
        let answer = null;
        handlers.fetch({ request: { url: origin + path, method, mode }, respondWith: (p) => { answer = p; } });
        return answer;
    };
    return { self, caches, fetchMock, install: () => lifecycle('install'), activate: () => lifecycle('activate'), request };
};

const serverOk = (path) => res(`server:${path}`, typeOf(path));
const offline = () => { throw new TypeError('Failed to fetch'); };

describe('swBuild — 저장 목록', () => {
    it('화면 파일만 넣고 ffmpeg(32MB)·version.json·sw.js는 뺀다', () => {
        expect(precacheList(DIST)).toEqual(['/assets/index-AAA.css', '/assets/index-AAA.js', '/icon-192.png', '/index.html', '/manifest.webmanifest']);
    });
    it('윈도우 경로(역슬래시)도 같은 결과', () => {
        expect(precacheList(['assets\\index-AAA.js', 'ffmpeg\\ffmpeg-core.wasm', 'index.html'])).toEqual(['/assets/index-AAA.js', '/index.html']);
    });
    it('틀에 자리가 없거나 index.html이 빠지면 빌드를 멈춘다', () => {
        expect(() => renderServiceWorker('const x = 1;', { buildId: '1', files: ['/index.html'] })).toThrow(/자리가 없습니다/);
        expect(() => renderServiceWorker(TEMPLATE, { buildId: '1', files: ['/assets/a.js'] })).toThrow(/index\.html/);
    });
    it('채운 결과에 빈 자리 표시가 남지 않는다', () => {
        const out = renderServiceWorker(TEMPLATE, { buildId: '777', files: precacheList(DIST) });
        expect(out).not.toMatch(/__SW_/);
        expect(out).toContain('const BUILD_ID = "777";');
        expect(out).toContain('"/index.html"');
    });
});

describe('sw.js — 설치', () => {
    it('목록을 전부 저장하고, 다 저장한 뒤에만 준비 표시를 남긴다', async () => {
        const sw = boot({ fetchImpl: serverOk });
        await sw.install();
        const shell = sw.caches.store.get('shell-200');
        expect([...shell.keys()].sort()).toEqual(['/__offline-ready', '/assets/index-AAA.css', '/assets/index-AAA.js', '/icon-192.png', '/index.html', '/manifest.webmanifest']);
        expect(sw.fetchMock.mock.calls.map(c => c[0])).not.toContain('/ffmpeg/ffmpeg-core.wasm');
        expect(sw.self.skipWaiting).toHaveBeenCalled();
    });
    it('JS 자리에 HTML이 오면(서버가 없는 파일을 index.html로 돌려줌) 저장하지 않고 실패한다', async () => {
        const sw = boot({ fetchImpl: (p) => p === '/assets/index-AAA.js' ? res('<!doctype html>', 'text/html; charset=utf-8') : serverOk(p) });
        await expect(sw.install()).rejects.toThrow(/HTML/);
        expect(sw.caches.store.has('shell-200')).toBe(false);
    });
    it('파일 하나라도 못 받으면 반쯤 찬 저장본을 남기지 않는다', async () => {
        const sw = boot({ fetchImpl: (p) => p === '/icon-192.png' ? res('', 'text/plain', 404) : serverOk(p) });
        await expect(sw.install()).rejects.toThrow(/404/);
        expect(sw.caches.store.has('shell-200')).toBe(false);
    });
});

describe('sw.js — 화면 열기', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const installed = async (fetchAfter) => {
        let impl = serverOk;
        const sw = boot({ fetchImpl: (p, init) => impl(p, init) });
        await sw.install();
        impl = fetchAfter;
        sw.fetchMock.mockClear();
        return sw;
    };

    it('인터넷이 없으면 저장본으로 바로 연다', async () => {
        const sw = await installed(offline);
        const out = await sw.request('/', { mode: 'navigate' });
        expect(await out.text()).toBe('server:/index.html'); // 설치 때 저장한 그 응답
    });
    it('인터넷이 되면 저장본이 아니라 서버의 최신 화면을 준다', async () => {
        const sw = await installed(() => res('NEW DEPLOY', 'text/html'));
        const out = await sw.request('/', { mode: 'navigate' });
        expect(await out.text()).toBe('NEW DEPLOY');
    });
    it('서버가 3초 안에 답하지 않으면 저장본으로 연다 (2.9초엔 아직 기다림)', async () => {
        const sw = await installed(() => new Promise(() => {})); // 끝내 답 없음
        let settled = null;
        sw.request('/', { mode: 'navigate' }).then(r => { settled = r; });
        await vi.advanceTimersByTimeAsync(2900);
        expect(settled).toBe(null);
        await vi.advanceTimersByTimeAsync(200);
        expect(await settled.text()).toBe('server:/index.html');
    });
    it('서버가 오류(500)를 주면 저장본으로 연다', async () => {
        const sw = await installed(() => res('down', 'text/html', 500));
        const out = await sw.request('/some/path', { mode: 'navigate' });
        expect(await out.text()).toBe('server:/index.html');
    });
    it('저장본이 없으면 서버 응답을 그대로 준다', async () => {
        const sw = boot({ fetchImpl: () => res('ONLY NETWORK', 'text/html') });
        const out = await sw.request('/', { mode: 'navigate' });
        expect(await out.text()).toBe('ONLY NETWORK');
    });
    it('화면이 쓰는 JS·CSS는 저장본에서 준다 (서버에 묻지 않음)', async () => {
        const sw = await installed(offline);
        const out = await sw.request('/assets/index-AAA.js');
        expect(await out.text()).toBe('server:/assets/index-AAA.js');
        expect(sw.fetchMock).not.toHaveBeenCalled();
    });
    it('건드리지 않는 것: /api, version.json, ffmpeg, 보내기(POST), 바깥 서버(AI)', async () => {
        const sw = await installed(offline);
        expect(sw.request('/api/list?passphrase=x')).toBe(null);
        expect(sw.request('/api/list', { mode: 'navigate' })).toBe(null);
        expect(sw.request('/version.json?t=1')).toBe(null);
        expect(sw.request('/ffmpeg/ffmpeg-core.wasm')).toBe(null);
        expect(sw.request('/', { mode: 'navigate', method: 'POST' })).toBe(null);
        expect(sw.request('/v1beta/models', { origin: 'https://generativelanguage.googleapis.com' })).toBe(null);
        expect(sw.request('/v1/messages', { origin: 'https://api.anthropic.com' })).toBe(null);
        // 바깥 서버의 주소가 우리 저장 목록과 우연히 같아도 우리 파일을 주면 안 된다
        expect(sw.request('/assets/index-AAA.js', { origin: 'https://cdn.other.com' })).toBe(null);
    });
});

describe('sw.js — 새 버전으로 바뀔 때', () => {
    it('이번 저장본과 바로 앞 저장본만 남기고 더 옛것은 지운다', async () => {
        const caches = fakeCaches();
        for (const id of ['100', '150', '180']) await boot({ buildId: id, caches, fetchImpl: serverOk }).install();
        await (await caches.open('other-cache')).put('/x', res('keep'));
        const sw = boot({ buildId: '200', caches, fetchImpl: serverOk });
        await sw.install();
        await sw.activate();
        expect((await caches.keys()).sort()).toEqual(['other-cache', 'shell-180', 'shell-200']);
        expect(sw.self.clients.claim).toHaveBeenCalled();
    });
    it('아직 열려 있는 앞 버전 화면은 앞 저장본에서 제 JS를 받는다', async () => {
        const caches = fakeCaches();
        const prev = await caches.open('shell-180');
        await prev.put('/assets/index-OLD.js', res('old build js'));
        const sw = boot({ buildId: '200', caches, fetchImpl: serverOk });
        await sw.install();
        await sw.activate();
        sw.fetchMock.mockClear();
        const out = await sw.request('/assets/index-OLD.js');
        expect(await out.text()).toBe('old build js');
        expect(sw.fetchMock).not.toHaveBeenCalled();
    });
});

describe('online — AI 버튼을 막을지', () => {
    it('확실히 끊겼을 때(onLine === false)만 막는다', () => {
        expect(isOffline({ onLine: false })).toBe(true);
        expect(isOffline({ onLine: true })).toBe(false);
        expect(isOffline({})).toBe(false);   // 값을 모르면 막지 않는다
        expect(isOffline(null)).toBe(false);
    });
});
