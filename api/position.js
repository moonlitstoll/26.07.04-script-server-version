// 네임스페이스(보관함)별 "마지막으로 보던 문장 위치"를 Blob 한 파일에 저장/조회.
// 값 형태: { "{name}_{size}": { idx, seconds, t } }  (t = 최종 조회 시각 ms)
// 충돌 처리: POST 시 서버가 기존 값과 병합하여 각 항목의 t가 더 큰(최근) 쪽을 채택.
//   → 여러 기기가 동시에 올려도 서로의 최신 항목을 덮어쓰지 않음.
// GET  ?passphrase=...            → { positions: {...} }
// POST { passphrase, positions }  → 병합 저장
import { put, head } from '@vercel/blob';
import { resolveNamespace, blobToken } from '../lib/cloud.js';

const MAX_KEYS = 2000;

export default async function handler(req, res) {
    const isPost = req.method === 'POST';
    const passphrase = isPost ? req.body?.passphrase : req.query?.passphrase;
    const ns = resolveNamespace(passphrase);
    if (!ns) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = blobToken();
    const path = `${ns}/position.json`;

    const readExisting = async () => {
        try {
            const existing = await head(path, { token });
            if (existing?.url) {
                const j = await fetch(existing.url, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
                return (j && typeof j === 'object') ? j : {};
            }
        } catch { /* 아직 없음 */ }
        return {};
    };

    try {
        if (isPost) {
            const incoming = (req.body?.positions && typeof req.body.positions === 'object') ? req.body.positions : {};
            const merged = await readExisting();
            for (const [k, v] of Object.entries(incoming)) {
                if (!v || typeof v.idx !== 'number') continue;
                const entry = {
                    idx: v.idx,
                    seconds: typeof v.seconds === 'number' ? v.seconds : 0,
                    t: typeof v.t === 'number' ? v.t : 0,
                };
                const cur = merged[k];
                if (!cur || entry.t >= (cur.t || 0)) merged[k] = entry;
            }
            // 상한 초과 시 오래된(t 작은) 항목부터 제거
            const keys = Object.keys(merged);
            if (keys.length > MAX_KEYS) {
                keys.sort((a, b) => (merged[b].t || 0) - (merged[a].t || 0));
                const kept = {};
                for (const k of keys.slice(0, MAX_KEYS)) kept[k] = merged[k];
                for (const k of Object.keys(merged)) if (!(k in kept)) delete merged[k];
            }
            await put(path, JSON.stringify(merged), {
                access: 'public',
                contentType: 'application/json',
                addRandomSuffix: false,
                allowOverwrite: true,
                token,
            });
            res.status(200).json({ ok: true });
            return;
        }

        const positions = await readExisting();
        res.status(200).json({ positions });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Position failed' });
    }
}
