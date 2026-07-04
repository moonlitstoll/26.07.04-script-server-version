// 서버(Vercel Serverless) 공용 유틸: 비밀 암호 검증 + 네임스페이스 계산
// 비밀 암호를 그대로 폴더명으로 쓰지 않고 SHA-256 해시로 변환해 보관함을 격리한다.
import crypto from 'crypto';

/**
 * 요청의 비밀 암호를 검증하고, 통과하면 그 암호로부터 네임스페이스(폴더 접두어)를 만든다.
 * - APP_PASSPHRASE 환경변수가 설정돼 있으면 그 값과 일치해야만 통과 (무단 사용 방지)
 * - 설정돼 있지 않으면(개발용) 아무 암호나 각자 네임스페이스를 가짐
 * @returns {string|null} 32자 hex 네임스페이스, 인증 실패 시 null
 */
export function resolveNamespace(passphrase) {
    if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 4) return null;

    const allowed = process.env.APP_PASSPHRASE;
    if (allowed && passphrase !== allowed) return null;

    return crypto.createHash('sha256').update(passphrase, 'utf8').digest('hex').slice(0, 32);
}

/** 폴더(파일 식별자) 값이 안전한 hex인지 검증 — 경로 조작 방지 */
export function isSafeFolder(folder) {
    return typeof folder === 'string' && /^[a-f0-9]{1,64}$/.test(folder);
}

/** Blob 읽기/쓰기 토큰 (Vercel Blob 스토어 연결 시 자동 주입되는 환경변수) */
export function blobToken() {
    return process.env.BLOB_READ_WRITE_TOKEN;
}
