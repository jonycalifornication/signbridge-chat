/**
 * Load `.env` into process.env.
 *
 * Import this FIRST, before any module that reads configuration at import time
 * (`avatar-mirror.js` resolves AVATAR_URL at module scope). ES modules evaluate
 * in import order, so a side-effect import at the top of the entry point runs
 * early enough.
 *
 * Node does not read `.env` on its own, and `npm run server` bit exactly that:
 * a perfectly good AVATAR_API_KEY sat in `.env` while the renderer sent an empty
 * one and every gesture lookup came back 401.
 *
 * Real environment variables always win, so docker-compose keeps full control.
 * No dependency: the format we need is `KEY=value`, `#` comments, blank lines.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = process.env.ENV_FILE || path.join(__dirname, '../../.env');

function parseEnv(contents) {
    const values = {};

    for (const rawLine of contents.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const separator = line.indexOf('=');
        if (separator <= 0) continue;

        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();

        // Strip one layer of matching quotes, keeping the value verbatim otherwise.
        if (value.length >= 2 && (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        )) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

if (fs.existsSync(ENV_PATH)) {
    const values = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
    const applied = [];

    for (const [key, value] of Object.entries(values)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
            applied.push(key);
        }
    }

    if (applied.length > 0) {
        console.log(`[Env] Loaded from .env: ${applied.join(', ')}`);
    }
}
