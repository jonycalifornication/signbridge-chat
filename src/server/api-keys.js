import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEYS_FILE = path.join(__dirname, '../../api_keys.json');

// Initialize DB file if not exists
if (!fs.existsSync(API_KEYS_FILE)) {
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify([]));
}

function generateApiKey() {
    return 'signbridge_' + crypto.randomBytes(24).toString('hex');
}

export async function getAllKeys() {
    try {
        const data = await fs.promises.readFile(API_KEYS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('[API Keys] Read error:', e);
        return [];
    }
}

async function saveKeys(keys) {
    await fs.promises.writeFile(API_KEYS_FILE, JSON.stringify(keys, null, 2));
}

export async function createKey(domain) {
    const keys = await getAllKeys();
    const newKey = {
        id: crypto.randomUUID(),
        apiKey: generateApiKey(),
        domain: domain ? domain.trim() : '*',
        createdAt: Date.now()
    };
    keys.push(newKey);
    await saveKeys(keys);
    return newKey;
}

export async function deleteKey(id) {
    let keys = await getAllKeys();
    const initialLength = keys.length;
    keys = keys.filter(k => k.id !== id);
    if (keys.length < initialLength) {
        await saveKeys(keys);
        return true;
    }
    return false;
}

function extractDomain(urlStr) {
    if (!urlStr) return null;
    try {
        const url = new URL(urlStr);
        return url.hostname;
    } catch (e) {
        return urlStr; // Fallback if it's just a raw hostname
    }
}

export async function validateRequest(req) {
    const keys = await getAllKeys();
    const providedKey = req.headers['x-api-key'];

    // 1. Validate by exact API Key match
    if (providedKey) {
        const keyData = keys.find(k => k.apiKey === providedKey);
        if (keyData) {
            console.log(`[Auth] Valid API key used for domain: ${keyData.domain}`);
            return true;
        }
    }

    // 2. Fallback: Validate by Domain (Origin or Referer)
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const requestHost = origin ? extractDomain(origin) : extractDomain(referer);

    if (requestHost) {
        // Find if this domain is registered in any key
        // Allow wildcards or exact matches
        const isDomainAllowed = keys.some(k => {
            if (k.domain === '*') return true;
            if (k.domain.toLowerCase() === requestHost.toLowerCase()) return true;
            // Support simple wildcard like *.example.com (optional but nice)
            if (k.domain.startsWith('*.') && requestHost.endsWith(k.domain.slice(2))) return true;
            // Also check raw string matching just in case
            if (origin && origin.includes(k.domain)) return true;
            if (referer && referer.includes(k.domain)) return true;
            return false;
        });

        if (isDomainAllowed) {
            console.log(`[Auth] Validated via Domain Match: ${requestHost}`);
            return true;
        }
    }

    // Always allow localhost/127.0.0.1 for local development
    if (requestHost === 'localhost' || requestHost === '127.0.0.1') {
        return true; 
    }

    console.warn(`[Auth] Unauthorized request. Key: ${providedKey ? 'Invalid' : 'Missing'}, Domain: ${requestHost}`);
    return false;
}
