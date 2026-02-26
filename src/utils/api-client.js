/**
 * API client for communicating with signBridgeStorage backend.
 * Handles translation requests and VRMA file downloads.
 * @module api-client
 */

import { CONFIG } from '../config.js';

/**
 * @typedef {Object} AnimationSequenceItem
 * @property {string} word - The word being translated
 * @property {string|null} gloss_name - The gloss name if found
 * @property {string|null} type - Animation type (lexical, etc.)
 * @property {string|null} file_url - URL to the VRMA file
 * @property {string|null} transition_in - Transition in handshape
 * @property {string|null} transition_out - Transition out handshape
 * @property {boolean} found - Whether the animation was found
 */

/**
 * @typedef {Object} TranslateResponse
 * @property {string} text - Original text
 * @property {string} language_id - Language ID used
 * @property {AnimationSequenceItem[]} sequence - Animation sequence
 */

/**
 * API Client for signBridgeStorage backend
 */
export class ApiClient {
    /**
     * @param {Object} options
     * @param {string} [options.baseUrl] - Backend API base URL
     * @param {string} [options.apiKey] - API key for authentication
     * @param {string} [options.languageId] - Default language ID
     * @param {number} [options.timeout] - Request timeout in ms
     */
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || CONFIG.apiUrl || 'http://localhost:8000/api/v1';
        this.apiKey = options.apiKey || CONFIG.apiKey || '';
        this.languageId = options.languageId || CONFIG.languageId || 'kz_KSL';
        this.timeout = options.timeout || 10000;

        // Remove trailing slash
        this.baseUrl = this.baseUrl.replace(/\/+$/, '');
    }

    /**
     * Build request headers
     * @returns {Object} Headers object
     */
    _getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }
        return headers;
    }

    /**
     * Make a fetch request with timeout
     * @param {string} url
     * @param {RequestInit} options
     * @returns {Promise<Response>}
     */
    async _fetch(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Translate text to animation sequence
     * @param {string} text - Text to translate
     * @param {string} [languageId] - Language ID override
     * @returns {Promise<TranslateResponse>}
     */
    async translate(text, languageId = null) {
        const url = `${this.baseUrl}/translate/`;
        const body = {
            text: text,
            language_id: languageId || this.languageId,
        };

        console.log(`[ApiClient] Translating: "${text}" (lang: ${body.language_id})`);

        const response = await this._fetch(url, {
            method: 'POST',
            headers: this._getHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Translation API failed (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        console.log(`[ApiClient] Got ${data.sequence?.length || 0} animation items`);
        return data;
    }

    /**
     * Download a VRMA file as ArrayBuffer
     * @param {string} fileUrl - URL to the VRMA file (can be S3 URL or relative)
     * @returns {Promise<ArrayBuffer>}
     */
    async downloadVRMA(fileUrl) {
        // If the URL is relative, prefix with baseUrl
        let url = fileUrl;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `${this.baseUrl}/files/download?file_key=${encodeURIComponent(fileUrl)}`;
        }

        console.log(`[ApiClient] Downloading VRMA: ${url}`);

        const response = await this._fetch(url, {
            method: 'GET',
            headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
        });

        if (!response.ok) {
            throw new Error(`VRMA download failed (${response.status}): ${url}`);
        }

        return await response.arrayBuffer();
    }

    /**
     * Check backend health
     * @returns {Promise<boolean>}
     */
    async checkHealth() {
        try {
            const response = await this._fetch(`${this.baseUrl.replace('/api/v1', '')}/health`, {
                method: 'GET',
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get a Blob URL for a remote VRMA file (for use with GLTFLoader)
     * @param {string} fileUrl - URL to the VRMA file
     * @returns {Promise<string>} Blob URL that can be loaded by GLTFLoader
     */
    async getVRMABlobUrl(fileUrl) {
        const buffer = await this.downloadVRMA(fileUrl);
        const blob = new Blob([buffer], { type: 'model/gltf-binary' });
        return URL.createObjectURL(blob);
    }
}

// Singleton instance
let _defaultClient = null;

/**
 * Get or create the default API client instance
 * @param {Object} [options] - Options to pass to new client
 * @returns {ApiClient}
 */
export function getApiClient(options) {
    if (!_defaultClient) {
        _defaultClient = new ApiClient(options);
    }
    return _defaultClient;
}
