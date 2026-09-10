/**
 * The Swift helpers, compiled on first use into ~/.notchlight/bin.
 *
 * Each helper is one source file under native/. The binary is rebuilt when the
 * source is newer than it, and everything degrades quietly: no swiftc, no
 * source, a failed build — the caller gets null and carries on without it.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, ensureDir } from './config';

export type HelperName = 'audiotap' | 'spotifywatch';

/** dist/main/index.js → ../../native/<name>.swift */
export const helperSource = (name: HelperName) => path.join(__dirname, '..', '..', 'native', `${name}.swift`);
export const helperBinary = (name: HelperName) => path.join(APP_DIR, 'bin', name);

export function ensureHelper(name: HelperName): Promise<string | null> {
  return new Promise(resolve => {
    const source = helperSource(name);
    const bin = helperBinary(name);
    try {
      if (!fs.existsSync(source)) return resolve(null);
      if (fs.existsSync(bin) && fs.statSync(bin).mtimeMs > fs.statSync(source).mtimeMs) return resolve(bin);
      ensureDir();
      fs.mkdirSync(path.dirname(bin), { recursive: true });
    } catch { return resolve(null); }
    execFile('swiftc', ['-O', '-o', bin, source], { timeout: 120_000 }, error => resolve(error ? null : bin));
  });
}
