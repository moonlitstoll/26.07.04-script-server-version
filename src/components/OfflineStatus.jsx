import { useState, useEffect } from 'react';
import { offlineSupported, isOfflineReady } from '../utils/offline';

// 설정 창 맨 아래 작은 글씨: 화면 파일이 기기에 저장돼 인터넷 없이도 앱이 열리는지.
// 알림을 따로 띄우지 않고 여기서만 확인한다(대본 화면 면적을 쓰지 않으려고).
// 저장은 배포 뒤 인터넷이 될 때 앱을 한 번 열면 몇 초 안에 끝난다 → 그동안은 '준비 중'.
// 개발 서버·지원 안 하는 브라우저에서는 아무것도 그리지 않는다.
const OfflineStatus = () => {
    const [ready, setReady] = useState(false);
    const supported = offlineSupported();

    useEffect(() => {
        if (!supported) return undefined;
        let alive = true;
        let timer = null;
        let tries = 0;
        const check = async () => {
            const ok = await isOfflineReady();
            if (!alive) return;
            if (ok) { setReady(true); return; }
            if (++tries < 30) timer = setTimeout(check, 2000);
        };
        check();
        return () => { alive = false; if (timer) clearTimeout(timer); };
    }, [supported]);

    if (!supported) return null;
    return (
        <p className="pt-3 text-center text-[11px] text-slate-400 dark:text-slate-500" data-offline-ready={ready ? '1' : '0'}>
            {ready ? '인터넷 없이도 열림 ✓' : '인터넷 없이 열기 준비 중…'}
        </p>
    );
};

export default OfflineStatus;
