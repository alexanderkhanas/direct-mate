import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  // svgr: `*.svg?react` imports become components (the Material Symbols in src/components/icons.tsx);
  // without their fixed 48 px size, so CSS classes size them.
  plugins: [react(), svgr({ svgrOptions: { dimensions: false } })],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/uploads': {
        target: 'http://localhost:3000',
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
