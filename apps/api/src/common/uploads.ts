import { join, resolve, sep } from 'path';

/**
 * Files the API serves at `/uploads/…` (`main.ts`). In production this
 * folder is a named Docker volume, so it survives deploys.
 */
export function uploadsRoot(): string {
  return resolve(process.cwd(), 'uploads');
}

/** The file behind an `/uploads/…` URL, or null for any other URL or a path that escapes the folder. */
export function uploadPath(url: string): string | null {
  if (!url.startsWith('/uploads/')) return null;
  const file = resolve(join(process.cwd(), url));
  return file.startsWith(uploadsRoot() + sep) ? file : null;
}
