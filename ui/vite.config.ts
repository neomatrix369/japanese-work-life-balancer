import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { ttsPlugin } from './tts-plugin'; // POST /tts — server-side voice narration (key stays server-side)

export default defineConfig({
  plugins: [react(), ttsPlugin()],
  server: {
    port: 5173,
    strictPort: true, // fail loudly instead of quietly starting a second UI on :5174
    proxy: {
      '/api': {
        target: 'http://localhost:8083',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
