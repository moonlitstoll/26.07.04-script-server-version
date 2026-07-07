import { useState, useEffect } from 'react';
import { BUILD_ID } from '../buildInfo';

// 배포된 version.json의 buildId를 주기적으로(마운트·포커스·5분 간격) 확인해,
// 실행 중인 번들 ID와 다르면 '새 버전 있음'을 반환한다. → 사용자에게 새로고침 안내.
// dev/오프라인/파일없음(404)은 조용히 무시한다.
export const useAppUpdate = () => {
    const [updateReady, setUpdateReady] = useState(false);

    useEffect(() => {
        let alive = true;
        let intervalId = null;

        const check = async () => {
            if (!alive || BUILD_ID === 'dev') return;
            try {
                const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                if (alive && data && data.buildId && data.buildId !== BUILD_ID) {
                    setUpdateReady(true);
                    if (intervalId) clearInterval(intervalId);
                }
            } catch {
                /* 오프라인/개발 서버 등 — 무시 */
            }
        };

        check();
        const onFocus = () => check();
        window.addEventListener('focus', onFocus);
        intervalId = setInterval(check, 5 * 60 * 1000);

        return () => {
            alive = false;
            window.removeEventListener('focus', onFocus);
            if (intervalId) clearInterval(intervalId);
        };
    }, []);

    return updateReady;
};
