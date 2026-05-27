import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Explicitly point to the backend that is running on port 8000.
const apiTarget = 'http://0.0.0.0:8000';
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    hmr: false,
    middlewareMode: false,
    proxy: {
      '/api': { target: apiTarget, rewrite: (path) => path },
      '/auth': { target: apiTarget, rewrite: (path) => path },
      '/rooms': { target: apiTarget, rewrite: (path) => path },
      '/ws': { target: wsTarget, ws: true, rewrite: (path) => path },
      '/stream': { target: apiTarget, rewrite: (path) => path },
      '/admin': { target: apiTarget, rewrite: (path) => path },
      '/health': { target: apiTarget, rewrite: (path) => path },
    }
  }
});