import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET || 'http://backend:8000';
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    hmr: false,

    proxy: {
  '/api': { target: apiTarget },
  '/auth': { target: apiTarget },
  '/rooms': { target: apiTarget },
  '/ws': { target: wsTarget, ws: true },
  '/stream': { target: apiTarget },
  '/static/uploads': { target: apiTarget },
}
  }
});