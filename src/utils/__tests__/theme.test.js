// 테마 규칙 검증 — 설정값·기기 설정 → 실제 테마, 그리고 <html>에 반영되는 모양.
// index.html의 인라인 스크립트도 같은 규칙을 따른다(첫 화면 번쩍임 방지). 규칙이 바뀌면 거기도 같이.
import { describe, it, expect } from 'vitest';
import { normalizeThemePref, resolveTheme, applyResolvedTheme, THEME_COLOR, THEME_OPTIONS, DEFAULT_THEME } from '../theme';

describe('normalizeThemePref — 저장값 정리', () => {
    it('세 값만 그대로, 나머지는 system', () => {
        for (const v of ['system', 'light', 'dark']) expect(normalizeThemePref(v)).toBe(v);
        for (const bad of [null, undefined, '', 'auto', 'DARK', 'true', 0]) expect(normalizeThemePref(bad), String(bad)).toBe('system');
    });
    it('기본값은 system이고 목록 안에 있다', () => {
        expect(DEFAULT_THEME).toBe('system');
        expect(THEME_OPTIONS).toContain(DEFAULT_THEME);
    });
});

describe('resolveTheme — 무엇을 그릴지', () => {
    it("system은 기기 설정을 따른다", () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
    });
    it("light/dark 고정은 기기 설정을 무시한다", () => {
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });
    it('오염된 값은 system처럼 동작한다', () => {
        expect(resolveTheme('weird', true)).toBe('dark');
        expect(resolveTheme(undefined, false)).toBe('light');
    });
});

// 가짜 document: classList·style·meta만 흉내 낸다
function fakeDoc(withMeta = false) {
    const classes = new Set();
    const meta = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const head = { children: [], appendChild(el) { this.children.push(el); } };
    const doc = {
        documentElement: {
            classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
            style: {},
        },
        head,
        _meta: withMeta ? meta : null,
        querySelector(sel) { return sel === 'meta[name="theme-color"]' ? this._meta : null; },
        createElement() { const m = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }; this._meta = m; return m; },
    };
    return { doc, classes, head };
}

describe('applyResolvedTheme — <html> 반영', () => {
    it('dark면 클래스·color-scheme·상태바 색이 다크, light면 전부 라이트로 돌아온다', () => {
        const { doc, classes } = fakeDoc();
        expect(applyResolvedTheme(doc, 'dark')).toBe('dark');
        expect(classes.has('dark')).toBe(true);
        expect(doc.documentElement.style.colorScheme).toBe('dark');
        expect(doc._meta.attrs.content).toBe(THEME_COLOR.dark);

        expect(applyResolvedTheme(doc, 'light')).toBe('light');
        expect(classes.has('dark')).toBe(false);
        expect(doc.documentElement.style.colorScheme).toBe('light');
        expect(doc._meta.attrs.content).toBe(THEME_COLOR.light);
    });
    it('theme-color meta가 없으면 만들어 head에 넣고, 있으면 재사용한다', () => {
        const a = fakeDoc(false);
        applyResolvedTheme(a.doc, 'dark');
        expect(a.head.children).toHaveLength(1);
        expect(a.head.children[0].attrs.name).toBe('theme-color');
        const b = fakeDoc(true);
        applyResolvedTheme(b.doc, 'dark');
        expect(b.head.children).toHaveLength(0);
        expect(b.doc._meta.attrs.content).toBe(THEME_COLOR.dark);
    });
    it('상태바 색은 라이트 바탕(slate-50)·다크 바탕(slate-900)과 같다', () => {
        expect(THEME_COLOR.light.toLowerCase()).toBe('#f8fafc');
        expect(THEME_COLOR.dark.toLowerCase()).toBe('#0f172a');
    });
});
