// 구글 드라이브 '스트리밍'/OneDrive '온디맨드' 등 아직 로컬에 없는 파일을
// 안정적으로 '한 번에' 메모리로 적재한다.
//
// 배경: 이런 클라우드 파일은 디스크에 실제 바이트가 없는 자리표시자라,
// 첫 읽기가 다운로드(하이드레이션)를 유발하면서 파일이 바뀌고,
// 그 사이 다른 읽기(비디오 메타/FFmpeg 등)가 끼어들면 파일 참조가 깨져
// NotReadableError("...after a reference to a file was acquired")가 난다.
//
// 대책:
//  1) 맨 처음에 파일을 통째로 '한 번' 메모리에 적재한다 (이후 처리는 전부 이 메모리 파일로).
//  2) arrayBuffer 외에 FileReader, blob-URL fetch 등 여러 읽기 방식을 순차 시도한다
//     (스트리밍 파일은 방식에 따라 성공률이 다르다).
//  3) 실패 시 잠깐 기다렸다 재시도 → 백그라운드 다운로드 완료 후 성공.

async function viaArrayBuffer(file) {
    const buf = await file.arrayBuffer();
    if (!buf || buf.byteLength === 0) throw new Error('빈 데이터(arrayBuffer)');
    return buf;
}

async function viaFileReader(file) {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const r = reader.result;
            if (r && r.byteLength > 0) resolve(r);
            else reject(new Error('빈 데이터(FileReader)'));
        };
        reader.onerror = () => reject(reader.error || new Error('FileReader 오류'));
        reader.readAsArrayBuffer(file);
    });
}

async function viaObjectUrl(file) {
    // createObjectURL은 파일 스냅샷을 캡처하므로, 직접 읽기가 깨진 경우에도
    // blob URL을 통한 fetch가 성공하는 경우가 있다.
    const url = URL.createObjectURL(file);
    try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        if (!buf || buf.byteLength === 0) throw new Error('빈 데이터(objectURL)');
        return buf;
    } finally {
        URL.revokeObjectURL(url);
    }
}

const STRATEGIES = [
    ['arrayBuffer', viaArrayBuffer],
    ['fileReader', viaFileReader],
    ['objectURL', viaObjectUrl],
];

async function readableFromFile(file) {
    let lastErr;
    for (const [name, strat] of STRATEGIES) {
        try {
            const buf = await strat(file);
            return { buf, name };
        } catch (e) {
            lastErr = e;
            console.warn(`[Materialize] ${name} 실패: ${e && e.message}`);
        }
    }
    throw lastErr || new Error('읽기 실패');
}

/**
 * File System Access API 핸들 기반 적재.
 * 매 라운드 handle.getFile()로 '새 참조'를 재획득하므로, 클라우드 스트리밍 파일이
 * 백그라운드 다운로드로 갱신되면 다음 라운드에서 성공한다. (참조 고정 문제 해결)
 */
export async function materializeFromHandle(handle, { attempts = 10, delayMs = 2000, onWait } = {}) {
    let lastErr;
    for (let round = 0; round < attempts; round++) {
        try {
            const file = await handle.getFile(); // 새 스냅샷 재획득
            const { buf, name } = await readableFromFile(file);
            console.log(`[Materialize] 핸들 성공: ${name} (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB, ${round + 1}회차)`);
            return new File([buf], file.name, {
                type: file.type || 'application/octet-stream',
                lastModified: file.lastModified || Date.now(),
            });
        } catch (e) {
            lastErr = e;
            console.warn(`[Materialize] 핸들 ${round + 1}회차 실패: ${e && e.message}`);
        }
        if (round < attempts - 1) {
            if (onWait) onWait(round + 1, attempts);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    const detail = (lastErr && lastErr.message) ? lastErr.message : String(lastErr);
    throw new Error(
        `파일을 읽을 수 없습니다. 클라우드 파일 다운로드가 오래 걸리거나 실패했습니다. ` +
        `파일을 우클릭해 "오프라인 사용 가능"으로 받은 뒤 다시 시도하세요. (${detail})`
    );
}

/**
 * 원본과 동일한 name/type을 가진 '읽기 가능한' 메모리 File 반환.
 * 모든 시도가 실패하면 예외를 던진다(호출부에서 원본 폴백 처리).
 */
export async function materializeFile(file, { attempts = 5, delayMs = 2000, onWait } = {}) {
    let lastErr;
    for (let round = 0; round < attempts; round++) {
        for (const [name, strat] of STRATEGIES) {
            try {
                const buf = await strat(file);
                console.log(`[Materialize] 성공: ${name} (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB, ${round + 1}회차)`);
                return new File([buf], file.name, {
                    type: file.type || 'application/octet-stream',
                    lastModified: file.lastModified || Date.now(),
                });
            } catch (e) {
                lastErr = e;
                console.warn(`[Materialize] ${name} 실패 (${round + 1}회차): ${e && e.message}`);
            }
        }
        if (round < attempts - 1) {
            if (onWait) onWait(round + 1, attempts);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    const detail = (lastErr && lastErr.message) ? lastErr.message : String(lastErr);
    throw new Error(
        `파일을 읽을 수 없습니다. 클라우드(구글 드라이브/OneDrive) 파일이 아직 다운로드되지 않았을 수 있습니다. ` +
        `잠시 후 다시 시도하거나, 파일을 우클릭해 "오프라인 사용 가능"으로 받아주세요. (${detail})`
    );
}
