import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  html: { cspNonce: 'ajith-bundled-assets' },
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
});
