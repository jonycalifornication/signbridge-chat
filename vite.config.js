import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      // Proxy API requests to backend in dev mode
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        widget: resolve(__dirname, 'widget-demo.html'),
        vrma: resolve(__dirname, 'test-vrma.html'),
        embed: resolve(__dirname, 'embed.html'),
        widget_demo: resolve(__dirname, 'widget_demo/index.html'),
        stream_demo: resolve(__dirname, 'stream_demo/index.html'),
        quaternion_demo: resolve(__dirname, 'quaternion_demo/index.html'),
        mobile_demo: resolve(__dirname, 'mobile_demo/index.html'),
        documentation: resolve(__dirname, 'documentation/index.html'),
      }
    }
  }
});
