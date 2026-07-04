// OneDrive '온디맨드'(클라우드 전용) 등 아직 로컬에 다운로드되지 않은 파일을
// 안정적으로 메모리에 적재한다.
//
// 배경: OneDrive Files On-Demand 파일은 디스크에 실제 바이트가 없는 '자리표시자'라
// 브라우저의 FileReader/arrayBuffer 읽기가 NotReadableError로 실패한다.
// arrayBuffer() 호출 자체가 OneDrive의 자동 다운로드(하이드레이션)를 유발하므로,
// 실패 시 잠깐 기다렸다 재시도하면 다운로드 완료 후 성공한다.
//
// 반환: 원본과 동일한 name/type/size를 가진 '읽기 가능한' 메모리 File.
// 이후 재생/전사/업로드 등 모든 처리를 이 파일로 하면 재접근 실패가 없다.
export async function materializeFile(file, { attempts = 8, delayMs = 2500, onWait } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const buf = await file.arrayBuffer();
            if (!buf || buf.byteLength === 0) throw new Error('빈 파일이 읽혔습니다');
            return new File([buf], file.name, {
                type: file.type || 'application/octet-stream',
                lastModified: file.lastModified || Date.now(),
            });
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) {
                if (onWait) onWait(i + 1, attempts);
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }
    const detail = (lastErr && lastErr.message) ? lastErr.message : String(lastErr);
    throw new Error(
        `파일을 읽을 수 없습니다. OneDrive 등 클라우드 파일이 아직 다운로드되지 않았을 수 있습니다. ` +
        `인터넷 연결을 확인하거나, 탐색기에서 파일 우클릭 → "항상 이 장치에 유지"로 받은 뒤 다시 시도하세요. (${detail})`
    );
}
