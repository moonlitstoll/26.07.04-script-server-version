// [일회용 정리] 예전에 잠깐 쓰던 위치 동기화 파일({ns}/position.json)을 삭제한다.
// 사용 후 이 파일은 제거 예정. GET ?passphrase=... → 해당 보관함의 position.json 삭제.
import { list, del } from '@vercel/blob';
import { resolveNamespace, blobToken } from '../lib/cloud.js';

export default async function handler(req, res) {
    const passphrase = req.query?.passphrase;
    const ns = resolveNamespace(passphrase);
    if (!ns) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = blobToken();
    try {
        const { blobs } = await list({ prefix: `${ns}/position.json`, token, limit: 1000 });
        if (blobs.length > 0) {
            await del(blobs.map((b) => b.url), { token });
        }
        res.status(200).json({ ok: true, deleted: blobs.length });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Cleanup failed' });
    }
}
