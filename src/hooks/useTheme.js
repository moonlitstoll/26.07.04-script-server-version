import { useEffect } from 'react';
import { resolveTheme, applyResolvedTheme } from '../utils/theme';

const QUERY = '(prefers-color-scheme: dark)';

// 설정의 테마 값을 <html>에 반영한다. 'system'이면 기기 설정 변경(낮↔밤 자동 전환)도 따라간다.
// 설정창에서 값을 바꾸면 즉시 반영되고(updateField가 바로 저장), Cancel로 되돌리면 다시 이 effect가 돈다.
export function useTheme(pref) {
    useEffect(() => {
        const mq = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
        const apply = () => applyResolvedTheme(document, resolveTheme(pref, !!(mq && mq.matches)));
        apply();
        if (pref !== 'system' || !mq) return undefined;
        // 옛 사파리는 addEventListener가 없고 addListener만 있다
        if (mq.addEventListener) { mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply); }
        mq.addListener(apply);
        return () => mq.removeListener(apply);
    }, [pref]);
}
