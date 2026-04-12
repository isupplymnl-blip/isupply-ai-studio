/**
 * Runtime file storage helpers.
 *
 * When packaged (Electron), USER_DATA_DIR is set to app.getPath('userData')
 * so writes land in the user's AppData — not the read-only Program Files dir.
 * In development, files go to the project's public/ directory as before.
 */
import path from 'path';

export function getUploadDir(): string {
  const base = process.env.USER_DATA_DIR;
  return base
    ? path.join(base, 'uploads')
    : path.join(process.cwd(), 'public', 'uploads');
}

export function getGeneratedDir(): string {
  const base = process.env.USER_DATA_DIR;
  return base
    ? path.join(base, 'generated')
    : path.join(process.cwd(), 'public', 'generated');
}

export function getAssetsDbPath(): string {
  const base = process.env.USER_DATA_DIR;
  return base
    ? path.join(base, 'assets.json')
    : path.join(process.cwd(), 'data', 'assets.json');
}

/** URL the browser uses to load an uploaded reference image */
export function makeUploadUrl(filename: string): string {
  return `/api/uploads/${filename}`;
}

/** URL the browser uses to load a generated image */
export function makeGeneratedUrl(filename: string): string {
  return `/api/generated/${filename}`;
}

/**
 * Resolve a stored image URL back to an absolute file path for deletion.
 * Handles new-style (/api/uploads/x, /api/generated/x) and legacy (/uploads/x).
 */
export function urlToFilePath(url: string): string {
  const apiUploads = url.match(/^\/api\/uploads\/(.+)$/);
  if (apiUploads) return path.join(getUploadDir(), apiUploads[1]);

  const apiGenerated = url.match(/^\/api\/generated\/(.+)$/);
  if (apiGenerated) return path.join(getGeneratedDir(), apiGenerated[1]);

  // Legacy URLs written before this change (dev only)
  return path.join(process.cwd(), 'public', url);
}
