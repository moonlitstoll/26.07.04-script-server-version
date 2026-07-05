// [일회용 이전 도구] 옛 암호 보관함(네임스페이스) 전체를 새 암호 보관함으로 복사한다.
// 서버 내부 복사(copy)라 영상도 다운로드 없이 이전됨. 재실행해도 덮어써서 안전(멱등).
//
// 사용 순서:
//   1) (APP_PASSPHRASE 아직 옛 값인 상태에서) 이 엔드포인트 호출:
//      GET /api/migrate-vault?passphrase=<옛암호>&newPassphrase=<새암호>
//      → 옛 폴더 → 새 폴더로 전체 복사
//   2) Vercel에서 APP_PASSPHRASE 를 <새암호>로 변경 + 재배포
//   3) 기기들에서 새 암호로 로그인
//
// 인증: passphrase(옛=현재)만 APP_PASSPHRASE로 검증. newPassphrase는 목적지 폴더 계산에만 사용.
// 사용 후 이 파일은 제거 예정.
import { list, copy } from '@vercel/blob';
import crypto from 'crypto';
import { resolveNamespace, blobToken } from '../lib/cloud.js';

const nsFromPassphrase = (p) =>
    crypto.createHash('sha256').update(p, 'utf8').digest('hex').slice(0, 32);

export default async function handler(req, res) {
    const passphrase = req.query?.passphrase;        // 현재(옛) 암호
    const newPassphrase = req.query?.newPassphrase;  // 목표(새) 암호

    const oldNs = resolveNamespace(passphrase);      // 검증 통과해야 진행 (옛=현재 APP_PASSPHRASE)
    if (!oldNs) {
        res.status(401).json({ error: 'Unauthorized — 현재(옛) 암호가 맞는지 확인하세요' });
        return;
    }
    if (!newPassphrase || typeof newPassphrase !== 'string' || newPassphrase.length < 4) {
        res.status(400).json({ error: 'newPassphrase(새 암호, 4자 이상)를 지정하세요' });
        return;
    }
    const newNs = nsFromPassphrase(newPassphrase);
    if (newNs === oldNs) {
        res.status(400).json({ error: '새 암호가 기존 암호와 동일합니다' });
        return;
    }

    const token = blobToken();
    try {
        let cursor;
        let copied = 0;
        let failed = 0;
        do {
            const { blobs, cursor: next, hasMore } = await list({
                prefix: `${oldNs}/`, token, limit: 1000, cursor,
            });
            for (const b of blobs) {
                const rest = b.pathname.slice(oldNs.length + 1); // "폴더/media" 등 (oldNs/ 접두어 제거)
                if (!rest) continue;
                const dest = `${newNs}/${rest}`;
                try {
                    await copy(b.url, dest, {
                        access: 'public',
                        token,
                        addRandomSuffix: false,
                        allowOverwrite: true,
                    });
                    copied++;
                } catch (e) {
                    failed++;
                    console.warn('[Migrate] 복사 실패:', dest, e?.message);
                }
            }
            cursor = hasMore ? next : undefined;
        } while (cursor);

        res.status(200).json({ ok: true, copied, failed });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Migrate failed' });
    }
}
