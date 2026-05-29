import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use VITE_API_TARGET if provided (set in docker-compose), otherwise
// default to the Docker service name `backend:8000` so the dev server
// inside the frontend container can reach the backend over the Docker
// network. Previously this used 0.0.0.0 which points to the container
// itself and caused proxy requests to fail with ECONNREFUSED.
const apiTarget = process.env.VITE_API_TARGET || 'http://backend:8000';
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
      '/static/uploads': { target: apiTarget, rewrite: (path) => path },
      '/rooms': { target: apiTarget, rewrite: (path) => path },
      '/ws': { target: wsTarget, ws: true, rewrite: (path) => path },
      '/stream': { target: apiTarget, rewrite: (path) => path },
      '/admin': { target: apiTarget, rewrite: (path) => path },
      '/health': { target: apiTarget, rewrite: (path) => path },
    }
  }
});