#!/usr/bin/env node
/**
 * Build the Swift helpers ahead of time.
 *
 *   node scripts/build-helpers.mjs            → native/prebuilt/<arch>/<name>
 *   node scripts/build-helpers.mjs --check    → exit 1 if a prebuilt is missing or stale
 *
 * Each binary is recorded in native/prebuilt/manifest.json with the SHA-256 of
 * the source it was built from, so the app can tell a prebuilt that matches
 * its source from one left behind by an older checkout. Runs on a Mac with the
 * Xcode command line tools; the GitHub Actions workflow runs it on a macOS
 * runner so a user of the packaged app never needs swiftc.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const native = path.join(root, 'native');
const arch = process.arch;
const outDir = path.join(native, 'prebuilt', arch);
const manifestPath = path.join(native, 'prebuilt', 'manifest.json');
const check = process.argv.includes('--check');

export const HELPERS = ['audiotap', 'notchprobe', 'spotifywatch', 'pasteboardwatch'];
export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* first build */ }

let stale = 0;
for (const name of HELPERS) {
  const source = path.join(native, `${name}.swift`);
  const binary = path.join(outDir, name);
  const hash = sha256(source);
  const record = manifest[name]?.[arch];
  const fresh = record?.sha256 === hash && fs.existsSync(binary);
  if (check) {
    console.log(`${fresh ? 'ok   ' : 'stale'} ${name} (${arch})`);
    if (!fresh) stale++;
    continue;
  }
  if (fresh) { console.log(`up to date ${name}`); continue; }
  fs.mkdirSync(outDir, { recursive: true });
  process.stdout.write(`building ${name} for ${arch}… `);
  execFileSync('swiftc', ['-O', '-o', binary, source], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.chmodSync(binary, 0o755);
  manifest[name] = { ...(manifest[name] ?? {}), [arch]: { sha256: hash, builtAt: new Date().toISOString(), host: `${os.type()} ${os.release()}`, swift: swiftVersion() } };
  console.log(`${(fs.statSync(binary).size / 1024).toFixed(0)} KB`);
}

if (check) process.exit(stale ? 1 : 0);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest ${path.relative(root, manifestPath)}`);

function swiftVersion() {
  try { return execFileSync('swiftc', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0].trim(); }
  catch { return 'unknown'; }
}
