// 클라우드 동기화 모듈 (Vercel Blob 백엔드와 통신)
// - 비밀 암호 하나로 여러 기기가 같은 보관함을 공유
// - 로컬 저장(localStorage/IndexedDB)에 얹혀 best-effort로 동작: 실패해도 앱 기본 기능은 유지
import { upload } from '@vercel/blob/client';

// ─────────────────────────────────────────────────────────────
// [클라우드 동기화 스위치] false = 완전히 꺼짐(서버 통신 0, 기기 로컬 저장만 사용).
// 다시 켜려면 이 값을 true로 바꾸면 된다 — 서버 코드(api/, lib/)는 그대로 살아 있다.
//
// 끈 이유(2026-07): Vercel 한도로 클라우드 목록·링크가 이미 동작하지 않는 상태였고,
// 그 경로에서 데이터 유실 버그가 반복됐다(CDN 스테일, 옛 스냅샷 덮어쓰기 등).
//
// 구현 주의 — 여기 한 곳(getPassphrase)만 막으면 전체가 멈춘다:
//   uploadMedia/saveMeta/listItems/getFavorites/saveFavorites/deleteItem 이 모두
//   맨 앞에서 `if (!passphrase) return ...` 으로 빠져나가고, App의 passphrase 상태도
//   ''이 되어 즐겨찾기 동기화 effect와 클라우드 목록 조회가 애초에 실행되지 않는다.
//   (함수마다 개별 가드를 넣는 방식은 getFavorites가 []를 반환하는 순간
//    useFavorites가 그걸 '서버에 별표 없음'으로 보고 로컬 즐겨찾기를 지워버린다 — 금지)
// ─────────────────────────────────────────────────────────────
export const CLOUD_ENABLED = false;

const PASSPHRASE_KEY = 'miniapp_cloud_passphrase';

// ─── 비밀 암호 관리 ───
export function getPassphrase() {
    if (!CLOUD_ENABLED) return ''; // 스위치 OFF → 모든 클라우드 함수가 여기서부터 무력화
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

// POST + JSON 공통 요청: 실패 시 `${label} ${status}` 에러 throw, 성공 시 res.json().
async function postJson(url, payload, label) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${label} ${res.status}`);
    return res.json();
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
// data 를 넘기지 않으면(undefined) 서버가 data.json 을 건드리지 않는다 —
// 영상 업로드 완료처럼 'mediaUrl만 갱신'하는 호출이 옛 대본으로 최신본을 덮어쓰는 사고를 막는다.
// status 도 undefined 면 기존 값을 유지한다(진행 상태를 되돌리지 않기 위함).
export async function saveMeta(fileInfo, data, status, mediaUrl, duration) {
    const passphrase = getPassphrase();
    if (!passphrase) return null;

    const folder = await computeFolder(fileInfo.name, fileInfo.size);
    const meta = {
        name: fileInfo.name,
        size: fileInfo.size,
        type: fileInfo.type || '',
        duration: duration || 0,
        mediaUrl: mediaUrl || null,
    };
    if (status !== undefined) meta.status = status;
    const payload = { passphrase, folder, meta };
    if (data !== undefined) payload.data = data;
    return postJson('/api/save-meta', payload, 'save-meta');
}

// ─── 내 보관함 목록 조회 ───
// 목록 조회. 일부 메타를 못 읽었으면 items.partial = true 로 표시한다
// (호출부가 '목록에 없음 = 미업로드'로 오판해 최신 클라우드 대본을 덮어쓰는 것을 막기 위함).
export async function listItems() {
    const passphrase = getPassphrase();
    if (!passphrase) return [];
    const res = await fetch(`/api/list?passphrase=${encodeURIComponent(passphrase)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const { items, failed } = await res.json();
    const arr = items || [];
    if (failed > 0) {
        arr.partial = true;
        console.warn(`[Cloud] 목록 일부 조회 실패 (${failed}건) — 자동 재업로드를 건너뜁니다`);
    }
    return arr;
}

// ─── 대본/분석 본문 로드 (data.json) ───
export async function fetchData(dataUrl) {
    if (!dataUrl) return null;
    // data.json은 같은 경로에 덮어쓰이는데 Blob 공개 URL은 CDN에 캐시된다 —
    // 유일 쿼리로 우회해 항상 마지막 저장본을 받는다 (안 하면 재분석/감지 결과가 유실된 옛 대본이 내려옴)
    const bust = `${dataUrl}${dataUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
    const res = await fetch(bust, { cache: 'no-store' });
    if (!res.ok) throw new Error(`data ${res.status}`);
    return res.json();
}

// ─── 즐겨찾기 (기기 간 동기화) ───
// 즐겨찾기 ID는 "{name}_{size}" — 로컬 캐시/클라우드 항목 모두 동일 규칙으로 계산
export async function getFavorites() {
    const passphrase = getPassphrase();
    if (!passphrase) return [];
    // 브라우저 캐시까지 확실히 우회 — 항상 서버의 현재 목록을 받는다
    const res = await fetch(`/api/favorites?passphrase=${encodeURIComponent(passphrase)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`favorites ${res.status}`);
    const { favorites } = await res.json();
    return favorites || [];
}

export async function saveFavorites(favorites) {
    const passphrase = getPassphrase();
    if (!passphrase) return;
    return postJson('/api/favorites', { passphrase, favorites }, 'favorites');
}

// ─── 삭제 ───
export async function deleteItem(fileInfo) {
    const passphrase = getPassphrase();
    if (!passphrase) return;
    const folder = await computeFolder(fileInfo.name, fileInfo.size);
    return postJson('/api/delete', { passphrase, folder }, 'delete');
}
