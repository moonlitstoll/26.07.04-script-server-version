// 대본+분석 결과(data.json)와 목록용 메타(meta.json)를 Blob에 저장
import { put, head } from '@vercel/blob';
import { resolveNamespace, isSafeFolder, blobToken } from '../lib/cloud.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const { passphrase, folder, meta, data } = req.body || {};
    const ns = resolveNamespace(passphrase);
    if (!ns) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    if (!isSafeFolder(folder) || !meta) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }

    const token = blobToken();
    const base = `${ns}/${folder}`;

    try {
        // 1) 대본+분석 본문 저장 (배열)
        const dataBlob = await put(`${base}/data.json`, JSON.stringify(data ?? []), {
            access: 'public',
            contentType: 'application/json',
            addRandomSuffix: false,
            allowOverwrite: true,
            token,
        });

        // 2) 미디어 URL 보존: 이번 요청에 mediaUrl이 없으면 기존 meta.json 값을 유지
        let mediaUrl = meta.mediaUrl || null;
        if (!mediaUrl) {
            try {
                const existing = await head(`${base}/meta.json`, { token });
                if (existing?.url) {
                    const prev = await fetch(existing.url).then(r => r.json()).catch(() => null);
                    if (prev?.mediaUrl) mediaUrl = prev.mediaUrl;
                }
            } catch { /* 기존 메타 없음 */ }
        }

        // 3) 목록용 메타 저장 (가벼움)
        const fullMeta = {
            name: meta.name,
            size: meta.size,
            type: meta.type || '',
            status: meta.status || 'extracted',
            duration: meta.duration || 0,
            savedAt: Date.now(),
            mediaUrl,
            dataUrl: dataBlob.url,
        };
        const metaBlob = await put(`${base}/meta.json`, JSON.stringify(fullMeta), {
            access: 'public',
            contentType: 'application/json',
            addRandomSuffix: false,
            allowOverwrite: true,
            token,
        });

        res.status(200).json({ ok: true, meta: fullMeta, metaUrl: metaBlob.url });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Save failed' });
    }
}
