// 대본+분석 결과(data.json)와 목록용 메타(meta.json)를 Blob에 저장
import { put, head } from '@vercel/blob';
import { resolveNamespace, isSafeFolder, blobToken } from '../lib/cloud.js';

// 기존 meta.json 읽기: { found, meta } — 존재하는데 못 읽으면 found=true, meta=null(= 덮어쓰기 금지 신호)
async function readExistingMeta(base, token) {
    let existing = null;
    try {
        existing = await head(`${base}/meta.json`, { token });
    } catch {
        return { found: false, meta: null }; // 파일 자체가 없음(정상 — 첫 저장)
    }
    if (!existing?.url) return { found: false, meta: null };
    try {
        // 유일 쿼리로 CDN 캐시 우회 — 옛 meta를 읽으면 최신 mediaUrl을 잃는다
        const bust = `${existing.url}${existing.url.includes('?') ? '&' : '?'}v=${Date.now()}`;
        const meta = await fetch(bust, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
        return { found: true, meta };
    } catch {
        return { found: true, meta: null }; // 존재하지만 읽기 실패
    }
}

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
        // 0) 기존 메타 조회 (mediaUrl/status/dataUrl 보존 판단에 공용으로 사용)
        const { found: metaExists, meta: prevMeta } = await readExistingMeta(base, token);

        // [보호] 기존 메타가 존재하는데 읽지 못했다면 meta.json을 덮어쓰지 않는다.
        // 강행하면 mediaUrl(업로드된 영상 포인터)이 null로 지워지고 복구 경로가 없다.
        // data.json 저장은 독립적이므로 요청에 data가 있으면 그것만 반영하고 메타는 보류한다.
        if (metaExists && !prevMeta) {
            if (data !== undefined) {
                await put(`${base}/data.json`, JSON.stringify(data ?? []), {
                    access: 'public',
                    contentType: 'application/json',
                    addRandomSuffix: false,
                    allowOverwrite: true,
                    cacheControlMaxAge: 60,
                    token,
                });
            }
            res.status(503).json({ error: 'meta read failed — meta.json not overwritten (data saved)', dataSaved: data !== undefined });
            return;
        }

        // 1) 대본+분석 본문 저장 (배열).
        //    data가 undefined면 '이번 요청은 메타만 갱신' → 기존 data.json을 그대로 둔다.
        //    (영상 업로드 완료 콜백처럼 옛 스냅샷을 들고 있는 호출이 최신 대본을 덮어쓰는 사고 방지)
        // cacheControlMaxAge 60(허용 최소값): 기본값(1개월)이면 같은 경로에 덮어써도
        // CDN이 옛 대본을 계속 내려준다
        let dataUrl = prevMeta?.dataUrl || null;
        if (data !== undefined) {
            const dataBlob = await put(`${base}/data.json`, JSON.stringify(data ?? []), {
                access: 'public',
                contentType: 'application/json',
                addRandomSuffix: false,
                allowOverwrite: true,
                cacheControlMaxAge: 60,
                token,
            });
            dataUrl = dataBlob.url;
        }
        if (!dataUrl) {
            // 대본이 한 번도 저장된 적 없는데 메타만 저장하려는 요청 → 목록에서 열 수 없는 항목이 되므로 거부
            res.status(400).json({ error: 'no data.json exists; data is required for first save' });
            return;
        }

        // 2) 미디어 URL 보존: 이번 요청에 mediaUrl이 없으면 기존 meta.json 값을 유지
        const mediaUrl = meta.mediaUrl || prevMeta?.mediaUrl || null;
        // 3) status 보존: 요청에 status가 없으면 기존 값 유지 (진행 상태를 되돌리지 않음)
        const status = meta.status || prevMeta?.status || 'extracted';

        // 4) 목록용 메타 저장 (가벼움)
        const fullMeta = {
            name: meta.name,
            size: meta.size,
            type: meta.type || prevMeta?.type || '',
            status,
            duration: meta.duration || prevMeta?.duration || 0,
            savedAt: Date.now(),
            mediaUrl,
            dataUrl,
        };
        const metaBlob = await put(`${base}/meta.json`, JSON.stringify(fullMeta), {
            access: 'public',
            contentType: 'application/json',
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60,
            token,
        });

        res.status(200).json({ ok: true, meta: fullMeta, metaUrl: metaBlob.url });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Save failed' });
    }
}
