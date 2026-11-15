// public/sw.js(인터넷 없이 열기)를 빌드 결과에 맞춰 채우는 순수 함수들. vite.config.js가 빌드 끝에 부른다.
// 브라우저 코드가 아니라 빌드 도구용이지만, 테스트(vitest)가 실제 함수를 물도록 src/utils에 둔다.

// 기기에 미리 저장하지 않을 것:
//  - ffmpeg/: 32MB. 새 영상을 올릴 때만 쓰고, 그건 어차피 인터넷이 있어야 한다.
//  - version.json: '새 버전' 확인용이라 저장본을 주면 안 된다.
//  - sw.js: 자기 자신.
const SKIP = [/^ffmpeg\//, /^version\.json$/, /^sw\.js$/, /\.map$/];

// files: dist 기준 상대 경로('assets/index-abc.js'). 반환: 저장할 주소 목록('/assets/index-abc.js'), 정렬됨.
export function precacheList(files) {
    return files
        .map(f => String(f).replace(/\\/g, '/').replace(/^\.?\//, ''))
        .filter(f => f && !SKIP.some(re => re.test(f)))
        .map(f => '/' + f)
        .sort();
}

const list = (arr) => arr.map(s => JSON.stringify(s)).join(', ');

// 틀(public/sw.js)의 두 자리를 채운다. 자리가 하나라도 없으면 던진다 — 조용히 빈 목록으로 배포되면
// '저장된 줄 알았는데 인터넷 없이 안 열림'이 된다.
export function renderServiceWorker(template, { buildId, files }) {
    if (!files.includes('/index.html')) throw new Error('저장 목록에 /index.html 이 없습니다');
    const slots = [
        ["'__SW_BUILD_ID__'", JSON.stringify(String(buildId))],
        ['/*__SW_PRECACHE__*/', list(files)],
    ];
    let out = template;
    for (const [mark, value] of slots) {
        if (!out.includes(mark)) throw new Error(`sw.js 틀에 ${mark} 자리가 없습니다`);
        out = out.replace(mark, () => value);
    }
    return out;
}
