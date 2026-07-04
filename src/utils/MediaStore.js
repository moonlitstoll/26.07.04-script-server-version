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

    async saveFile(file) {
        const db = await this.ensureDb();
        const id = this.getFileId(file.name, file.size);

        // Store as blob directly
        const data = {
            id,
            name: file.name,
            size: file.size,
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

    // 최근 사용 시각 갱신 (LRU 자동 정리 기준)
    async touch(name, size) {
        const db = await this.ensureDb();
        const id = this.getFileId(name, size);
        return new Promise((resolve) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const rec = getReq.result;
                if (rec) { rec.timestamp = Date.now(); store.put(rec); }
                resolve(true);
            };
            getReq.onerror = () => resolve(false);
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
