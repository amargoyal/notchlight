/**
 * Apple Music artwork, as a data URL.
 *
 * Music's scripting dictionary hands artwork over as raw picture bytes, which
 * JavaScript for Automation cannot write to a file cleanly and AppleScript
 * can. So a small AppleScript writes the current track's sleeve to a file in
 * the app's cache, and this reads it, shrinks it to what the island shows,
 * and carries it as PNG. One call per track; the player caches the answer.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { APP_DIR, ensureDir } from './config';

const run = promisify(execFile);

export async function fetchAppleArtwork(): Promise<string | null> {
  const script = path.join(__dirname, '..', '..', 'native', 'music-artwork.applescript');
  const out = path.join(APP_DIR, 'cache', 'apple-artwork');
  try {
    ensureDir();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const { stdout } = await run('/usr/bin/osascript', [script, out], { timeout: 8000 });
    if (stdout.trim() === 'none' || !fs.existsSync(out)) return null;
    const bytes = fs.readFileSync(out);
    if (!bytes.length || bytes.length > 6_000_000) return null;
    const { nativeImage } = await import('electron');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    return image.resize({ width: 176, height: 176, quality: 'good' }).toDataURL();
  } catch { return null; }
  finally { fs.rm(out, { force: true }, () => {}); }
}
