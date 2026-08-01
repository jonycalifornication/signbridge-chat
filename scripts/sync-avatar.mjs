/**
 * CLI: pull the deployed avatar build into the local mirror and make it live.
 *
 *   npm run avatar:sync                 # sync + promote
 *   AVATAR_URL=https://… npm run avatar:sync
 *
 * This bypasses the smoke render, because a smoke render needs the render server
 * itself. Use it for the first bootstrap or in a Docker build step; day to day,
 * prefer `POST /admin/avatar/sync`, which vets the new build before promoting it.
 */
import '../src/server/load-env.js';
import { AVATAR_URL, promoteMirror, syncMirror } from '../src/server/avatar-mirror.js';

const log = (msg) => console.log(`[AvatarMirror] ${msg}`);

try {
    log(`Source: ${AVATAR_URL}`);
    await syncMirror({ onLog: log });
    const manifest = promoteMirror();
    log(`Live mirror is now the build synced at ${manifest.syncedAt} (${manifest.fileCount} files).`);
} catch (error) {
    console.error(`[AvatarMirror] Sync failed: ${error.message}`);
    process.exit(1);
}
