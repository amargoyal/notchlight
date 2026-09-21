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

export const HELPERS = ['audiotap', 'notchprobe', 'spotifywatch', 'pasteboardwatch', 'hudwatch', 'powerwatch', 'calendarwatch', 'share'];
export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/**
 * A helper's Info.plist, when it has one.
 *
 * macOS reads the usage-description strings and the bundle identifier from the
 * *calling* process, and a bare command-line binary has neither — so a helper
 * that asks for the calendar is refused without anyone being asked. The plist is
 * linked into the binary's own __TEXT,__info_plist section, and an ad-hoc
 * signature binds it, which is what gives TCC something stable to remember.
 *
 * Kept next to the sources in native/info, so a helper's identity and its
 * source live together and are hashed together.
 */
export const helperInfo = name => path.join(native, 'info', `${name}.plist`);
export const buildArgs = (name, source, binary) => {
  const info = helperInfo(name);
  return ['-O', '-o', binary, source,
    ...(fs.existsSync(info) ? ['-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', info] : [])];
};
/** The source and its Info.plist together: either changing means a stale binary. */
export const helperHash = (name, source) => {
  const hash = createHash('sha256').update(fs.readFileSync(source));
  const info = helperInfo(name);
  if (fs.existsSync(info)) hash.update(fs.readFileSync(info));
  return hash.digest('hex');
};
/**
 * Bind the plist and give the binary a name TCC can hold on to. swiftc leaves a
 * linker-signed adhoc signature that binds nothing, so this replaces it.
 */
export const signHelper = (name, binary) => {
  if (!fs.existsSync(helperInfo(name))) return;
  execFileSync('codesign', ['--force', '--sign', '-', '--identifier', `com.notchlight.${name}`, binary], { stdio: ['ignore', 'ignore', 'inherit'] });
};

let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* first build */ }

let stale = 0;
for (const name of HELPERS) {
  const source = path.join(native, `${name}.swift`);
  const binary = path.join(outDir, name);
  const hash = helperHash(name, source);
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
  execFileSync('swiftc', buildArgs(name, source, binary), { stdio: ['ignore', 'ignore', 'inherit'] });
  signHelper(name, binary);
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
