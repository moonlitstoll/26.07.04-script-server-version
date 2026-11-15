/* 인터넷 없이 열기 (2026-11-15)
 *
 * 대본(localStorage)과 영상(IndexedDB)은 원래 기기 안에 있는데, 앱 화면 파일(HTML·JS·CSS)을
 * 켤 때마다 서버에서 받아서 인터넷이 없으면 앱이 아예 안 켜졌다. 이 파일이 화면 파일을 기기에 저장해 둔다.
 *
 * - 인터넷이 될 때: 지금처럼 서버의 최신 화면을 먼저 받는다. 3초 안에 못 받으면 저장본으로 연다.
 * - 인터넷이 없을 때: 저장본으로 바로 연다.
 * - 저장하지 않는 것: /api, version.json(새 버전 확인), ffmpeg(32MB, 새 영상 올릴 때만 씀).
 *
 * 아래 두 값은 빌드할 때 vite.config.js가 채운다(src/utils/swBuild.js#renderServiceWorker).
 * 이 파일은 public/에 있지만 dist/sw.js는 채워진 사본이다.
 */
const BUILD_ID = '__SW_BUILD_ID__';
const PRECACHE = [/*__SW_PRECACHE__*/];

const SHELL_PREFIX = 'shell-';
const SHELL = SHELL_PREFIX + BUILD_ID;
const READY_MARK = '/__offline-ready';
const NAV_TIMEOUT_MS = 3000;
const PRECACHE_SET = new Set(PRECACHE);

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(SHELL);
            await Promise.all(PRECACHE.map(async (path) => {
                const res = await fetch(path, { cache: 'reload' });
                if (!res.ok) throw new Error('[sw] ' + path + ' ' + res.status);
                // vercel.json이 '없는 파일'을 index.html(200)로 돌려준다. 그걸 JS·CSS 자리에 저장하면
                // 인터넷 없을 때 흰 화면이 된다 → HTML이 온 자리는 실패로 본다.
                const type = res.headers.get('content-type') || '';
                if (path !== '/index.html' && type.includes('text/html')) throw new Error('[sw] ' + path + ' 자리에 HTML이 옴');
                await cache.put(path, res);
            }));
            // 전부 저장된 뒤에만 표시를 남긴다 — 설정 창의 '인터넷 없이도 열림 ✓'이 이걸 본다.
            await cache.put(READY_MARK, new Response(BUILD_ID, { headers: { 'content-type': 'text/plain' } }));
        } catch (e) {
            await caches.delete(SHELL); // 반쯤 찬 저장본을 남기지 않는다. 다음에 앱을 열 때 다시 시도.
            throw e;
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 이번 저장본 + 바로 앞 저장본 하나만 남긴다. 앞 것을 남기는 이유: 아직 열려 있는 옛 화면이
        // 옛 JS 조각을 찾을 때 서버엔 이미 없어서(index.html이 대신 옴) 깨지는 것을 막는다.
        const old = (await caches.keys()).filter(k => k.startsWith(SHELL_PREFIX) && k !== SHELL).sort();
        await Promise.all(old.slice(0, -1).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

// 화면(HTML): 서버 먼저, 3초 안에 못 받거나 실패하면 저장본.
async function navigate(request) {
    const cached = await caches.match('/index.html', { cacheName: SHELL });
    if (!cached) return fetch(request);
    return new Promise((resolve) => {
        let done = false;
        const finish = (res) => { if (!done) { done = true; clearTimeout(timer); resolve(res); } };
        const timer = setTimeout(() => finish(cached), NAV_TIMEOUT_MS);
        fetch(request).then(
            (res) => finish(res && res.ok ? res : cached),
            () => finish(cached),
        );
    });
}

// 화면이 쓰는 파일(JS·CSS·아이콘): 저장본 먼저. /assets 파일은 이름에 내용 지문이 들어 있어 바뀌지 않는다.
async function shellFile(request, path) {
    const hit = await caches.match(path, { cacheName: SHELL })
        || (path.startsWith('/assets/') ? await caches.match(path) : undefined);
    return hit || fetch(request);
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // AI 서버 등 바깥 요청은 건드리지 않는다
    if (url.pathname.startsWith('/api/')) return;
    if (request.mode === 'navigate') { event.respondWith(navigate(request)); return; }
    if (PRECACHE_SET.has(url.pathname) || url.pathname.startsWith('/assets/')) {
        event.respondWith(shellFile(request, url.pathname));
    }
    // version.json·ffmpeg 등은 브라우저가 평소대로 처리
});
