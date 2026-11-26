/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  /** A Google Sheet copy of the product template, shown in «Add products». */
  readonly VITE_SHEET_TEMPLATE_URL?: string;
  /** The marketing site (apps/web). Default: http://localhost:4321 in dev, https://directmate.app in a build. */
  readonly VITE_SITE_URL?: string;
}
