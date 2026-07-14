// 네임스페이스(보관함)별 즐겨찾기 목록을 Blob 한 파일에 저장/조회
// GET  ?passphrase=...        → { favorites: string[] }
// POST { passphrase, favorites } → 저장
import { put, head } from '@vercel/blob';
import { resolveNamespace, blobToken } from '../lib/cloud.js';

export default async function handler(req, res) {
    const isPost = req.method === 'POST';
    const passphrase = isPost ? req.body?.passphrase : req.query?.passphrase;
    const ns = resolveNamespace(passphrase);
    if (!ns) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = blobToken();
    const path = `${ns}/favorites.json`;

    try {
        if (isPost) {
            const list = Array.isArray(req.body?.favorites) ? req.body.favorites : [];
            // 안전: 문자열만, 최대 1000개
            const clean = list.filter((x) => typeof x === 'string').slice(0, 1000);
            await put(path, JSON.stringify(clean), {
                access: 'public',
                contentType: 'application/json',
                addRandomSuffix: false,
                allowOverwrite: true,
                cacheControlMaxAge: 60, // 허용 최소값 — 기본값(1개월)이면 덮어쓴 뒤에도 CDN이 옛 목록을 계속 준다
                token,
            });
            res.status(200).json({ ok: true });
            return;
        }

        // GET: 없으면 빈 배열
        let favorites = [];
        try {
            const existing = await head(path, { token });
            if (existing?.url) {
                // Blob 공개 URL은 CDN에 캐시된다({ cache: 'no-store' }는 함수 자체 캐시만 우회).
                // 유일한 쿼리를 붙여 CDN 캐시를 뚫고 항상 마지막 저장본을 읽는다 —
                // 이게 없으면 별을 눌러도 재시작 때 옛 목록이 내려와 즐겨찾기가 풀린다.
                const bust = `${existing.url}${existing.url.includes('?') ? '&' : '?'}v=${Date.now()}`;
                favorites = await fetch(bust, { cache: 'no-store' }).then((r) => r.json()).catch(() => []);
            }
        } catch { /* 아직 없음 */ }
        res.status(200).json({ favorites: Array.isArray(favorites) ? favorites : [] });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Favorites failed' });
    }
}
