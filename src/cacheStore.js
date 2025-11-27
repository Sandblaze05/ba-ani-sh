import FSChunkStore from 'fs-chunk-store';

const MAX_CACHE = 2 * 1024 * 1024 * 1024; // 2GB

export default class LRUCacheStore {
    constructor(chunklength, opts) {
        this.store = new FSChunkStore(chunklength, opts);
        this.chunklength = chunklength;
        this.cacheSize = 0;
        this.lru = new Map(); // chunkIndex: lastAccessTime
    }

    put(index, buf, callback) {
        const size = buf.length;

        this.store.put(index, buf, (err) => {
            if (err) return callback(err);

            this.cacheSize += size;
            this.lru.set(index, Date.now());

            this.evictIfNeeded(callback);
        });
    }

    get(index, opts, callback) {
        this.lru.set(index, Date.now());
        this.store.get(index, opts, callback);
    }

    evictIfNeeded(callback) {
        if (this.cacheSize <= MAX_CACHE) return callback();

        const sorted = [...this.lru.entries()].sort((a, b) => a[1] - b[1]);

        const evictNext = () => {
            if (this.cacheSize <= MAX_CACHE || sorted.length === 0) {
                return callback();
            }

            const [index] = sorted.shift();

            this.store.put(index, Buffer.alloc(0), () => {
                this.cacheSize -= this.chunklength;
                this.lru.delete(index);
                evictNext();
            });
        };

        evictNext();
    }

    close(callback) {
        if (this.store.close) {
            this.store.close(callback);
        } else if (callback) {
            callback();
        }
    }

    destroy(callback) {
        if (this.store.destroy) {
            this.store.destroy(callback);
        } else if (this.store.close) {
            this.store.close(callback);
        } else if (callback) {
            callback();
        }
    }
}