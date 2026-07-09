const DB_NAME = 'MediaSmartAnalyzerDB';
const STORE_NAME = 'mediaFiles';
const DB_VERSION = 1;

class MediaStore {
    constructor() {
        this.db = null;
        this.initPromise = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async ensureDb() {
        if (!this.db) await this.initPromise;
        return this.db;
    }

    getFileId(name, size) {
        return `${name}_${size}`;
    }

    // idOverride({name,size})를 주면 그 신원으로 키를 만든다.
    // 온디맨드(구글 드라이브 등) 파일은 실제 읽은 바이트 수가 원본 보고 크기와 달라서,
    // 캐시/클라우드 메타와 '동일한 신원(원본 name/size)'으로 저장해 조회 키를 일치시킨다.
    async saveFile(file, idOverride = null) {
        const db = await this.ensureDb();
        const name = idOverride?.name ?? file.name;
        const size = idOverride?.size ?? file.size;
        const id = this.getFileId(name, size);

        // Store as blob directly
        const data = {
            id,
            name,
            size,
            type: file.type,
            blob: file,
            timestamp: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(data);

            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getFile(name, size) {
        const db = await this.ensureDb();
        const id = this.getFileId(name, size);

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result.blob);
                } else {
                    resolve(null);
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // 이름만으로 첫 레코드 조회 (레거시 키 불일치 복구용)
    async getRecordByName(name) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                const rows = request.result || [];
                resolve(rows.find(r => r.name === name) || null);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // name_size 정확 매칭 우선 → 실패 시 이름만으로 폴백.
    // 폴백으로 찾으면 올바른 키로 재저장하고 옛 항목을 정리(자가 치유)해 다음 조회는 O(1)로.
    async getFileFlexible(name, size) {
        const exact = await this.getFile(name, size);
        if (exact) return exact;

        const rec = await this.getRecordByName(name);
        if (!rec) return null;

        if (size && String(rec.size) !== String(size)) {
            try {
                await this.saveFile(rec.blob, { name, size });
                if (rec.id !== this.getFileId(name, size)) {
                    await this.deleteFile(rec.name, rec.size);
                }
            } catch { /* 자가 치유 실패는 무시 (blob은 반환) */ }
        }
        return rec.blob;
    }

    // 저장된 모든 영상의 메타(용량 계산/자동 정리용) — blob 본문은 제외
    async listEntries() {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                const rows = request.result || [];
                resolve(rows.map(({ id, name, size, timestamp }) => ({ id, name, size, timestamp: timestamp || 0 })));
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async deleteFile(name, size) {
        const db = await this.ensureDb();
        const id = this.getFileId(name, size);

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async clearAll() {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

export const mediaStore = new MediaStore();
