import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    hmr: false,
    middlewareMode: false,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        rewrite: (path) => path,
      },
      '/auth': {
        target: 'http://backend:8000',
        rewrite: (path) => path,
      },
      '/rooms': {
        target: 'http://backend:8000',
        rewrite: (path) => path,
      },
      '/ws': {
        target: 'ws://backend:8000',
        ws: true,
        rewrite: (path) => path,
      },
      '/stream': {
        target: 'http://backend:8000',
        rewrite: (path) => path,
      },
      '/admin': {
        target: 'http://backend:8000',
        rewrite: (path) => path,
      },
      '/health': {
        target: 'http://backend:8000',
        rewrite: (path) => path,
      }
    }
  }
});