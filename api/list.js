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
                const m = await fetch(b.url).then(r => r.json());
                // 폴더 식별자 추출: ns/<folder>/meta.json
                const parts = b.pathname.split('/');
                const folder = parts[parts.length - 2];
                return { ...m, folder };
            } catch {
                return null;
            }
        }));

        res.status(200).json({ items: items.filter(Boolean) });
    } catch (e) {
        res.status(500).json({ error: e.message || 'List failed' });
    }
}
