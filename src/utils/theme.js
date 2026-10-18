// 라이트/다크 테마 — 순수 계산 + DOM 반영.
//
// 설정값(miniapp_theme)은 'system' | 'light' | 'dark' 세 가지. 기본 'system' = 휴대폰·PC의
// 다크 모드 설정(prefers-color-scheme)을 따라간다. 실제 화면은 <html>의 'dark' 클래스 하나로
// 결정된다(index.css의 @custom-variant dark). 그래서 'light'를 고르면 기기가 다크여도 흰 화면이다.
//
// index.html의 인라인 스크립트가 React보다 먼저 같은 규칙으로 클래스를 붙인다(첫 화면 흰 번쩍임 방지).
// 규칙을 바꾸면 그쪽도 같이 바꿀 것.

export const THEME_OPTIONS = ['system', 'light', 'dark'];
export const DEFAULT_THEME = 'system';

// 휴대폰 상태바 색(meta theme-color). 라이트는 body 바탕(slate-50), 다크는 slate-900.
export const THEME_COLOR = { light: '#f8fafc', dark: '#0f172a' };

// 저장값이 오염됐거나 없으면 'system'
export function normalizeThemePref(v) {
    return THEME_OPTIONS.includes(v) ? v : DEFAULT_THEME;
}

// 설정값 + 기기 다크 여부 → 실제로 그릴 테마
export function resolveTheme(pref, systemDark) {
    const p = normalizeThemePref(pref);
    if (p === 'system') return systemDark ? 'dark' : 'light';
    return p;
}

// <html>에 'dark' 클래스를 붙이거나 떼고, 상태바 색·color-scheme을 맞춘다.
// doc은 document(테스트에선 가짜). 반환값 = 적용한 테마.
export function applyResolvedTheme(doc, resolved) {
    const dark = resolved === 'dark';
    const root = doc.documentElement;
    if (dark) root.classList.add('dark'); else root.classList.remove('dark');
    // color-scheme: 입력창·select·스크롤바 같은 브라우저 기본 부품이 테마를 따라오게
    root.style.colorScheme = dark ? 'dark' : 'light';
    let meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = doc.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        doc.head.appendChild(meta);
    }
    meta.setAttribute('content', THEME_COLOR[dark ? 'dark' : 'light']);
    return dark ? 'dark' : 'light';
}
