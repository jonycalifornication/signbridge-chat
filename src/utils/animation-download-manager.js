/**
 * Animation Download Manager
 * Manages downloading, caching, and sequencing VRMA animations from the backend.
 * @module animation-download-manager
 */

import { getApiClient } from './api-client.js';
import { getFoundAnimationCount } from './language-mode.js';

/**
 * @typedef {Object} CachedAnimation
 * @property {string} blobUrl - Local blob URL for the VRMA
 * @property {string} originalUrl - Original remote URL
 * @property {number} downloadedAt - Timestamp of download
 * @property {number} size - Size in bytes
 */

/**
 * Manages animation downloads and local caching
 */
export class AnimationDownloadManager {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxCacheSize] - Max number of cached animations
     * @param {number} [options.preloadConcurrency] - Number of concurrent downloads
     */
    constructor(options = {}) {
        /** @type {Map<string, CachedAnimation>} URL -> cached animation */
        this.cache = new Map();

        /** @type {Map<string, Promise<string>>} URL -> in-progress download promise */
        this.pendingDownloads = new Map();

        this.maxCacheSize = options.maxCacheSize || 100;
        this.preloadConcurrency = options.preloadConcurrency || 3;
        this.apiClient = getApiClient();

        /** @type {Map<string, number>} URL -> usage count for LRU eviction */
        this.usageCount = new Map();
    }

    /**
     * Get a local blob URL for a remote VRMA file.
     * Downloads and caches if not already cached.
     * @param {string} remoteUrl - Remote URL to the VRMA file
     * @returns {Promise<string>} Local blob URL ready for GLTFLoader
     */
    async getAnimationUrl(remoteUrl) {
        // Track usage
        this.usageCount.set(remoteUrl, (this.usageCount.get(remoteUrl) || 0) + 1);

        // Check cache
        if (this.cache.has(remoteUrl)) {
            console.log(`[DownloadManager] Cache hit: ${remoteUrl}`);
            return this.cache.get(remoteUrl).blobUrl;
        }

        // Check if download is already in progress
        if (this.pendingDownloads.has(remoteUrl)) {
            console.log(`[DownloadManager] Waiting for pending download: ${remoteUrl}`);
            return this.pendingDownloads.get(remoteUrl);
        }

        // Start new download
        const downloadPromise = this._downloadAndCache(remoteUrl);
        this.pendingDownloads.set(remoteUrl, downloadPromise);

        try {
            const blobUrl = await downloadPromise;
            return blobUrl;
        } finally {
            this.pendingDownloads.delete(remoteUrl);
        }
    }

    /**
     * Download a VRMA file and store in cache
     * @param {string} remoteUrl
     * @returns {Promise<string>} Blob URL
     * @private
     */
    async _downloadAndCache(remoteUrl) {
        console.log(`[DownloadManager] Downloading: ${remoteUrl}`);
        const startTime = performance.now();

        try {
            const buffer = await this.apiClient.downloadVRMA(remoteUrl);
            const blob = new Blob([buffer], { type: 'model/gltf-binary' });
            const blobUrl = URL.createObjectURL(blob);

            const elapsed = (performance.now() - startTime).toFixed(0);
            console.log(`[DownloadManager] Downloaded in ${elapsed}ms (${(buffer.byteLength / 1024).toFixed(1)}KB): ${remoteUrl}`);

            // Evict old entries if needed
            this._evictIfNeeded();

            // Store in cache
            this.cache.set(remoteUrl, {
                blobUrl,
                originalUrl: remoteUrl,
                downloadedAt: Date.now(),
                size: buffer.byteLength,
            });

            return blobUrl;
        } catch (error) {
            console.error(`[DownloadManager] Failed to download: ${remoteUrl}`, error);
            throw error;
        }
    }

    /**
     * Preload animations for a translate response sequence
     * @param {Array} sequence - Array of AnimationSequenceItem from translate API
     * @returns {Promise<Map<string, string>>} Map of remoteUrl -> blobUrl
     */
    async preloadSequence(sequence) {
        const urls = sequence
            .filter(item => item.found && item.file_url)
            .map(item => item.file_url);

        if (urls.length === 0) return new Map();

        console.log(`[DownloadManager] Preloading ${urls.length} animations...`);

        const results = new Map();
        const chunks = this._chunk(urls, this.preloadConcurrency);

        for (const chunk of chunks) {
            const promises = chunk.map(async (url) => {
                try {
                    const blobUrl = await this.getAnimationUrl(url);
                    results.set(url, blobUrl);
                } catch (error) {
                    console.warn(`[DownloadManager] Failed to preload: ${url}`, error);
                }
            });
            await Promise.all(promises);
        }

        console.log(`[DownloadManager] Preloaded ${results.size}/${urls.length} animations`);
        return results;
    }

    /**
     * Translate text and preload all found animations
     * @param {string} text - Text to translate
     * @param {string} [languageId] - Language override
     * @returns {Promise<{response: Object, urls: Map<string, string>}>}
     */
    async translateAndPreload(text, languageId) {
        const response = await this.apiClient.translate(text, languageId);

        if (!response.sequence || response.sequence.length === 0) {
            return { response, urls: new Map() };
        }

        const urls = await this.preloadSequence(response.sequence);
        return { response, urls };
    }

    /**
     * Try languages in order and preload the first usable translation.
     * If none has found animations, return the first successful response so
     * callers can still fall back to finger spelling.
     * @param {string} text
     * @param {string[]} languageIds
     * @returns {Promise<{response: Object, urls: Map<string, string>, languageId: string|null}>}
     */
    async translateAndPreloadAny(text, languageIds = []) {
        const candidates = Array.isArray(languageIds) && languageIds.length > 0
            ? languageIds
            : [this.apiClient.languageId];
        let firstSuccessful = null;
        let lastError = null;

        for (const languageId of candidates) {
            try {
                const result = await this.translateAndPreload(text, languageId);
                const foundCount = getFoundAnimationCount(result.response);
                const selectedLanguageId = result.response?.language_id || languageId;

                if (!firstSuccessful) {
                    firstSuccessful = { ...result, languageId: selectedLanguageId };
                }

                if (foundCount > 0) {
                    console.log(`[DownloadManager] Selected language ${selectedLanguageId} (${foundCount} found)`);
                    return { ...result, languageId: selectedLanguageId };
                }
            } catch (error) {
                lastError = error;
                console.warn(`[DownloadManager] Translation failed for language ${languageId}:`, error);
            }
        }

        if (firstSuccessful) {
            console.log(`[DownloadManager] No found animations in language chain, using ${firstSuccessful.languageId}`);
            return firstSuccessful;
        }

        throw lastError || new Error('Translation failed for all configured languages');
    }

    /**
     * Evict least-used cached entries if cache exceeds max size
     * @private
     */
    _evictIfNeeded() {
        if (this.cache.size < this.maxCacheSize) return;

        // Sort by usage count, evict least used
        const entries = [...this.cache.entries()]
            .sort((a, b) => {
                const usageA = this.usageCount.get(a[0]) || 0;
                const usageB = this.usageCount.get(b[0]) || 0;
                return usageA - usageB;
            });

        // Evict the bottom 25%
        const evictCount = Math.ceil(this.maxCacheSize * 0.25);
        for (let i = 0; i < evictCount && i < entries.length; i++) {
            const [url, cached] = entries[i];
            URL.revokeObjectURL(cached.blobUrl);
            this.cache.delete(url);
            this.usageCount.delete(url);
            console.log(`[DownloadManager] Evicted: ${url}`);
        }
    }

    /**
     * Split array into chunks
     * @param {Array} arr
     * @param {number} size
     * @returns {Array<Array>}
     * @private
     */
    _chunk(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Clear all cached animations
     */
    clearCache() {
        for (const [, cached] of this.cache) {
            URL.revokeObjectURL(cached.blobUrl);
        }
        this.cache.clear();
        this.usageCount.clear();
        this.pendingDownloads.clear();
        console.log('[DownloadManager] Cache cleared');
    }

    /**
     * Get cache statistics
     * @returns {Object}
     */
    getStats() {
        let totalSize = 0;
        for (const [, cached] of this.cache) {
            totalSize += cached.size;
        }
        return {
            cachedCount: this.cache.size,
            pendingCount: this.pendingDownloads.size,
            totalSizeKB: (totalSize / 1024).toFixed(1),
            maxCacheSize: this.maxCacheSize,
        };
    }
}

// Singleton
let _defaultManager = null;

/**
 * Get or create the default download manager
 * @param {Object} [options]
 * @returns {AnimationDownloadManager}
 */
export function getDownloadManager(options) {
    if (!_defaultManager) {
        _defaultManager = new AnimationDownloadManager(options);
    }
    return _defaultManager;
}
