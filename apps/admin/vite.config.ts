import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // react-snap's bundled Chromium is older than Chrome 80, so optional
    // chaining and nullish coalescing in the runtime bundle would fail to
    // parse during prerender. ES2019 forces esbuild to transpile both.
    target: 'es2019',
  },
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
