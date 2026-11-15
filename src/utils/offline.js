// 인터넷 없이 열기: 화면 파일 저장 담당(public/sw.js) 등록 + 저장 지키기 요청 + 준비 여부 확인.

const READY_MARK = '/__offline-ready'; // public/sw.js와 같은 값

export const offlineSupported = () =>
    import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined';

// 개발 서버에서는 등록하지 않는다 — 저장본이 끼어들면 고친 코드가 안 보인다.
export function registerOfflineShell() {
    if (!offlineSupported()) return;
    const go = () => navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[offline] 등록 실패:', e));
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
}

// 용량이 모자랄 때 크롬이 이 앱의 영상(IndexedDB)·대본(localStorage)을 말없이 지우지 않게 요청한다.
// 크롬은 묻는 창 없이 스스로 허락/거절한다(설치한 앱은 대개 허락). 거절돼도 예전과 같을 뿐이다.
export async function requestPersistentStorage() {
    try {
        if (!navigator.storage?.persist) return false;
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
    } catch { return false; }
}

// 화면 파일이 전부 저장됐고(표시는 sw.js가 다 저장한 뒤에만 남긴다) 저장 담당이 켜져 있으면 true.
export async function isOfflineReady() {
    try {
        if (!offlineSupported()) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg?.active) return false;
        return !!(await caches.match(READY_MARK));
    } catch { return false; }
}
