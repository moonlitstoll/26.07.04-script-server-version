// 내 보관함(네임스페이스)의 모든 대본 메타 목록 반환
import { list } from '@vercel/blob';
import { resolveNamespace, blobToken } from '../lib/cloud.js';

export default async function handler(req, res) {
    const passphrase = req.method === 'POST' ? req.body?.passphrase : req.query?.passphrase;
    const ns = resolveNamespace(passphrase);
    if (!ns) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = blobToken();
    try {
        const { blobs } = await list({ prefix: `${ns}/`, token, limit: 1000 });
        const metaBlobs = blobs.filter(b => b.pathname.endsWith('/meta.json'));

        const items = await Promise.all(metaBlobs.map(async (b) => {
            try {
                // uploadedAt(list API가 주는 최신 메타)을 캐시 키로 붙여 CDN 스테일 우회 —
                // meta.json은 같은 경로에 덮어쓰이므로 그냥 읽으면 옛 버전이 내려올 수 있다.
                // (내용이 안 바뀌었으면 같은 키 → CDN 재사용, 바뀌면 새 키 → 최신 강제)
                const v = b.uploadedAt ? new Date(b.uploadedAt).getTime() : Date.now();
                const m = await fetch(`${b.url}${b.url.includes('?') ? '&' : '?'}v=${v}`, { cache: 'no-store' }).then(r => r.json());
                // 폴더 식별자 추출: ns/<folder>/meta.json
                const parts = b.pathname.split('/');
                const folder = parts[parts.length - 2];
                return { ...m, folder };
            } catch {
                return null;
            }
        }));

        // 일부 meta.json을 못 읽었으면 그 사실을 알린다.
        // 조용히 빼면 클라이언트가 '클라우드에 없는 항목'으로 오해해 옛 로컬 대본을
        // 최신 클라우드 대본 위에 덮어쓴다(retryPendingUploads).
        const ok = items.filter(Boolean);
        res.status(200).json({ items: ok, failed: items.length - ok.length });
    } catch (e) {
        res.status(500).json({ error: e.message || 'List failed' });
    }
}
