import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.API_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],

  // Multi-page build: cockpit + reporting iFrame
  build: {
    cssMinify: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        reporting: resolve(__dirname, 'reporting.html'),
      },
    },
  },

  server: {
    port: 5174,
    host: '0.0.0.0',
    cors: true,
    proxy: {
      '/ws/dictation': {
        target: API_TARGET,
        ws: true,
      },
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        proxyTimeout: 300000,
      },
      '/config': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
