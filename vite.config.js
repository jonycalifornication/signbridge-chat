import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    cors: true,
    allowedHosts: true, // Allow Docker internal hostname (avatar-widget)
    proxy: {
      // The video generator only talks to our own renderer: video generation,
      // gloss preview, chat sessions and the admin panel. Everything
      // avatar-related happens server-side or inside the render page, so the
      // browser needs no proxy to the avatar or the storage backend.
      '/api/v1': {
        target: process.env.RENDERER_URL || 'http://avatar-renderer:3003',
        changeOrigin: true,
      },

      '/admin': {
        target: process.env.RENDERER_URL || 'http://avatar-renderer:3003',
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        // The video generator is the whole app now — it owns the site root.
        main: resolve(__dirname, 'index.html'),
      }
    }
  }
});
