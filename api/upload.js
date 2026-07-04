// 브라우저 → Vercel Blob 직접 업로드용 토큰 발급 핸들러
// 큰 영상 파일이 서버 함수(4.5MB 제한)를 거치지 않고 Blob으로 바로 올라가게 한다.
import { handleUpload } from '@vercel/blob/client';
import { resolveNamespace } from '../lib/cloud.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const jsonResponse = await handleUpload({
            body: req.body,
            request: req,
            onBeforeGenerateToken: async (pathname, clientPayload) => {
                // 클라이언트가 보낸 비밀 암호 검증
                let passphrase = null;
                try {
                    passphrase = JSON.parse(clientPayload || '{}').passphrase;
                } catch { /* ignore */ }

                const ns = resolveNamespace(passphrase);
                if (!ns) throw new Error('Unauthorized');

                // 반드시 자기 네임스페이스 폴더 안으로만 업로드 허용
                if (!pathname.startsWith(ns + '/')) throw new Error('Invalid path');

                return {
                    allowedContentTypes: ['video/*', 'audio/*', 'application/octet-stream'],
                    addRandomSuffix: false,     // 경로 고정 (같은 파일은 덮어씀)
                    maximumSizeInBytes: 512 * 1024 * 1024, // 512MB (Blob 캐시 한도)
                    tokenPayload: JSON.stringify({ ns }),
                };
            },
            onUploadCompleted: async () => {
                // 업로드 완료 후 서버측 후처리 없음 (메타는 별도 save-meta에서 저장)
            },
        });

        res.status(200).json(jsonResponse);
    } catch (e) {
        res.status(400).json({ error: e.message || 'Upload failed' });
    }
}
