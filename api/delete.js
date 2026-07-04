// 특정 대본(폴더)의 모든 Blob(영상/데이터/메타) 삭제
import { list, del } from '@vercel/blob';
import { resolveNamespace, isSafeFolder, blobToken } from '../lib/cloud.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const { passphrase, folder } = req.body || {};
    const ns = resolveNamespace(passphrase);
    if (!ns) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    if (!isSafeFolder(folder)) {
        res.status(400).json({ error: 'Invalid folder' });
        return;
    }

    const token = blobToken();
    try {
        const { blobs } = await list({ prefix: `${ns}/${folder}/`, token, limit: 1000 });
        if (blobs.length > 0) {
            await del(blobs.map(b => b.url), { token });
        }
        res.status(200).json({ ok: true, deleted: blobs.length });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Delete failed' });
    }
}
