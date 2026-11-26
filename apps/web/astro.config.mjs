import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

/**
 * The marketing site on directmate.app: static pages, plus the live demo widget as a React island.
 * The admin is a separate app (apps/admin) on platform.directmate.app.
 *
 * `build.format: 'file'` writes /pricing as pricing.html; nginx serves it at /pricing (try_files $uri.html).
 */
export default defineConfig({
  site: 'https://directmate.app',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    react(),
    sitemap({
      filter: (page) => !/\/(404|welcome)$/.test(page.replace(/\/$/, '')),
    }),
  ],
  // The old landing's address. nginx answers it with a 301 in production; this covers `astro dev` and preview.
  redirects: { '/welcome': '/' },
  server: { port: 4321 },
  vite: {
    server: {
      // The demo widget calls /api/demo/* and shows /uploads/* images, as on directmate.app.
      proxy: {
        '/api': { target: 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') },
        '/uploads': { target: 'http://localhost:3000' },
      },
    },
  },
});
