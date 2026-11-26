/**
 * The marketing site (apps/web). The admin lives on platform.directmate.app; the landing, pricing and legal pages
 * on directmate.app.
 */
export const SITE_URL: string =
  import.meta.env.VITE_SITE_URL ?? (import.meta.env.DEV ? 'http://localhost:4321' : 'https://directmate.app');
