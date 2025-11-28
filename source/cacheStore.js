import fs from 'fs';
import path from 'path';

const MAX_CACHE = 2 * 1024 * 1024 * 1024; // 2GB

export default class LRUCacheStore {
    constructor(chunkLength, opts) {
        this.chunkLength = chunkLength;
        this.path = opts.path || 'temp';
        this.cacheSize = 0;
        this.lastAccessedIndex = 0;
        this.chunks = new Set(); // Track existing chunk indices

        // Ensure temp directory exists
        if (!fs.existsSync(this.path)) {
            fs.mkdirSync(this.path, { recursive: true });
        }
    }

    put(index, buf, callback) {
        const filePath = path.join(this.path, `${index}`);
        
        fs.writeFile(filePath, buf, (err) => {
            if (err) return callback(err);

            if (!this.chunks.has(index)) {
                this.cacheSize += buf.length;
                this.chunks.add(index);
            }
            
            // Update focus to this chunk (the "Window" center)
            this.lastAccessedIndex = index;
            this.evictIfNeeded(callback);
        });
    }

    get(index, opts, callback) {
        if (typeof opts === 'function') {
            callback = opts;
            opts = null;
        }

        // Update focus to this chunk (the "Window" center)
        this.lastAccessedIndex = index;
        const filePath = path.join(this.path, `${index}`);

        fs.readFile(filePath, (err, buf) => {
            if (err) {
                // File missing (evicted or not downloaded yet).
                return callback(err);
            }

            if (opts && (opts.offset || opts.length)) {
                const offset = opts.offset || 0;
                const length = opts.length || (buf.length - offset);
                return callback(null, buf.subarray(offset, offset + length));
            }
            
            callback(null, buf);
        });
    }

    evictIfNeeded(callback) {
        if (this.cacheSize <= MAX_CACHE) return callback();

        // Sliding Window Strategy:
        // Sort chunks by distance from lastAccessedIndex (descending).
        // We evict the chunks that are furthest away from the current playback position.
        const sortedChunks = Array.from(this.chunks).sort((a, b) => {
            const distA = Math.abs(a - this.lastAccessedIndex);
            const distB = Math.abs(b - this.lastAccessedIndex);
            return distB - distA; // Furthest first
        });

        const evictNext = () => {
            if (this.cacheSize <= MAX_CACHE || sortedChunks.length === 0) {
                return callback();
            }

            const index = sortedChunks.shift();
            const filePath = path.join(this.path, `${index}`);

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    // File already gone
                    this.chunks.delete(index);
                    return evictNext();
                }

                fs.unlink(filePath, (err) => {
                    if (err) return callback(err);
                    
                    this.cacheSize -= stats.size;
                    this.chunks.delete(index);
                    evictNext();
                });
            });
        };

        evictNext();
    }

    close(callback) {
        if (callback) callback();
    }

    destroy(callback) {
        try {
            // Clean up the temp folder when torrent is destroyed
            if (fs.existsSync(this.path)) {
                fs.rm(this.path, { recursive: true, force: true }, (err) => {
                    if (err) return callback(err);
                    callback();
                });
            } else {
                callback();
            }
        } catch (err) {
            callback(err);
        }
    }
}