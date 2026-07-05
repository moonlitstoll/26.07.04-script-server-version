// 클라우드 동기화 모듈 (Vercel Blob 백엔드와 통신)
// - 비밀 암호 하나로 여러 기기가 같은 보관함을 공유
// - 로컬 저장(localStorage/IndexedDB)에 얹혀 best-effort로 동작: 실패해도 앱 기본 기능은 유지
import { upload } from '@vercel/blob/client';

const PASSPHRASE_KEY = 'miniapp_cloud_passphrase';

// ─── 비밀 암호 관리 ───
export function getPassphrase() {
    return localStorage.getItem(PASSPHRASE_KEY) || '';
}
export function setPassphrase(p) {
    if (p) localStorage.setItem(PASSPHRASE_KEY, p);
    else localStorage.removeItem(PASSPHRASE_KEY);
}
export function hasPassphrase() {
    return !!getPassphrase();
}

// ─── 해시 유틸 (서버 lib/cloud.js 와 동일한 규칙) ───
async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function computeNamespace(passphrase) {
    return (await sha256hex(passphrase)).slice(0, 32);
}
// 파일 식별자 → 안전한 폴더명(hex). 파일명 특수문자/유니코드 문제 회피
async function computeFolder(name, size) {
    return (await sha256hex(`${name}_${size}`)).slice(0, 40);
}

// ─── 영상/오디오 원본 업로드 (브라우저 → Blob 직접) ───
export async function uploadMedia(file, onProgress) {
    const passphrase = getPassphrase();
    if (!passphrase) return null;

    const ns = await computeNamespace(passphrase);
    const folder = await computeFolder(file.name, file.size);
    const pathname = `${ns}/${folder}/media`;

    const blob = await upload(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        contentType: file.type || 'application/octet-stream',
        clientPayload: JSON.stringify({ passphrase }),
        onUploadProgress: (p) => onProgress && onProgress(p.percentage),
    });
    return blob.url;
}

// ─── 메타 + 대본/분석 데이터 저장 ───
// mediaUrl 을 넘기지 않으면 서버가 기존 meta.json 의 mediaUrl 을 보존한다.
export async function saveMeta(fileInfo, data, status, mediaUrl, duration) {
    const passphrase = getPassphrase();
    if (!passphrase) return null;

    const folder = await computeFolder(fileInfo.name, fileInfo.size);
    const res = await fetch('/api/save-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            passphrase,
            folder,
            meta: {
                name: fileInfo.name,
                size: fileInfo.size,
                type: fileInfo.type || '',
                status: status || 'extracted',
                duration: duration || 0,
                mediaUrl: mediaUrl || null,
            },
            data,
        }),
    });
    if (!res.ok) throw new Error(`save-meta ${res.status}`);
    return res.json();
}

// ─── 내 보관함 목록 조회 ───
export async function listItems() {
    const passphrase = getPassphrase();
    if (!passphrase) return [];
    const res = await fetch(`/api/list?passphrase=${encodeURIComponent(passphrase)}`);
    if (!res.ok) throw new Error(`list ${res.status}`);
    const { items } = await res.json();
    return items || [];
}

// ─── 대본/분석 본문 로드 (data.json) ───
export async function fetchData(dataUrl) {
    if (!dataUrl) return null;
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`data ${res.status}`);
    return res.json();
}

// ─── 즐겨찾기 (기기 간 동기화) ───
// 즐겨찾기 ID는 "{name}_{size}" — 로컬 캐시/클라우드 항목 모두 동일 규칙으로 계산
export async function getFavorites() {
    const passphrase = getPassphrase();
    if (!passphrase) return [];
    const res = await fetch(`/api/favorites?passphrase=${encodeURIComponent(passphrase)}`);
    if (!res.ok) throw new Error(`favorites ${res.status}`);
    const { favorites } = await res.json();
    return favorites || [];
}

export async function saveFavorites(favorites) {
    const passphrase = getPassphrase();
    if (!passphrase) return;
    const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase, favorites }),
    });
    if (!res.ok) throw new Error(`favorites ${res.status}`);
    return res.json();
}

// ─── 보던 위치 (기기 간 동기화) ───
// 값: { "{name}_{size}": { idx, seconds, t } }. 서버가 t 최신 기준으로 병합.
export async function getPositions() {
    const passphrase = getPassphrase();
    if (!passphrase) return {};
    const res = await fetch(`/api/position?passphrase=${encodeURIComponent(passphrase)}`);
    if (!res.ok) throw new Error(`position ${res.status}`);
    const { positions } = await res.json();
    return positions && typeof positions === 'object' ? positions : {};
}

export async function savePositions(positions) {
    const passphrase = getPassphrase();
    if (!passphrase) return;
    const res = await fetch('/api/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase, positions }),
    });
    if (!res.ok) throw new Error(`position ${res.status}`);
    return res.json();
}

// ─── 삭제 ───
export async function deleteItem(fileInfo) {
    const passphrase = getPassphrase();
    if (!passphrase) return;
    const folder = await computeFolder(fileInfo.name, fileInfo.size);
    const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase, folder }),
    });
    if (!res.ok) throw new Error(`delete ${res.status}`);
    return res.json();
}
