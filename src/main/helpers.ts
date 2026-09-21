/**
 * The Swift helpers: prebuilt when a matching one ships, compiled otherwise.
 *
 * Each helper is one source file under native/. A packaged app carries
 * native/prebuilt/<arch>/<name> with a manifest recording the SHA-256 of the
 * source it was built from; when that matches the source next to it, the
 * binary is copied into ~/.notchlight/bin and no compiler is needed. When it
 * does not match — a checkout with edited sources — or there is no prebuilt
 * for this architecture, swiftc builds it. Everything degrades quietly: no
 * swiftc, no source, a failed build — the caller gets null and carries on.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, ensureDir } from './config';
import { logEvent } from './lifecycle';

export type HelperName = 'audiotap' | 'notchprobe' | 'spotifywatch' | 'pasteboardwatch' | 'hudwatch' | 'powerwatch' | 'calendarwatch' | 'share';

export interface HelperPaths {
  /** Directory holding <name>.swift. */
  sourceDir: string;
  /** Directory holding <arch>/<name> and manifest.json. */
  prebuiltDir: string;
  /** Where the usable binary ends up. */
  binDir: string;
  arch: string;
}

/** dist/main/index.js → ../../native. Resolved on use, so the module loads anywhere. */
export function defaultPaths(): HelperPaths {
  const native = path.join(__dirname, '..', '..', 'native');
  return { sourceDir: native, prebuiltDir: path.join(native, 'prebuilt'), binDir: path.join(APP_DIR, 'bin'), arch: process.arch };
}

export const helperSource = (name: HelperName, paths = defaultPaths()) => path.join(paths.sourceDir, `${name}.swift`);
export const helperBinary = (name: HelperName, paths = defaultPaths()) => path.join(paths.binDir, name);
/**
 * A helper's Info.plist, when it has one.
 *
 * macOS reads the usage-description strings and the bundle identifier from the
 * calling process, and a bare command-line binary has neither — so a helper that
 * asks for the calendar is refused without anyone being asked. The plist is
 * linked into the binary's own section and bound by an ad-hoc signature, which
 * also gives TCC a stable name to remember the answer against.
 */
export const helperInfo = (name: HelperName, paths = defaultPaths()) => path.join(paths.sourceDir, 'info', `${name}.plist`);

/** The source and its Info.plist together: either changing means a stale binary. */
function sha256(file: string, also?: string): string {
  const hash = createHash('sha256').update(fs.readFileSync(file));
  if (also && fs.existsSync(also)) hash.update(fs.readFileSync(also));
  return hash.digest('hex');
}
const sourceHash = (name: HelperName, paths: HelperPaths) => sha256(helperSource(name, paths), helperInfo(name, paths));

/** What swiftc is given, which is the source plus the plist when there is one. */
function buildArgs(name: HelperName, source: string, binary: string, paths: HelperPaths): string[] {
  const info = helperInfo(name, paths);
  return ['-O', '-o', binary, source,
    ...(fs.existsSync(info) ? ['-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', info] : [])];
}

/**
 * Bind the plist and name the binary. swiftc leaves a linker-signed signature
 * that binds nothing, so it is replaced — without this the plist is present in
 * the file and ignored by macOS.
 */
function sign(name: HelperName, binary: string, paths: HelperPaths): void {
  if (!fs.existsSync(helperInfo(name, paths))) return;
  try { execFileSync('codesign', ['--force', '--sign', '-', '--identifier', `com.notchlight.${name}`, binary], { stdio: 'ignore', timeout: 20_000 }); }
  catch { logEvent('notchlight', `helper ${name}: could not be signed; permissions may be refused without a prompt`); }
}

/** The shipped binary for this source and architecture, if the manifest vouches for it. */
export function prebuiltFor(name: HelperName, paths = defaultPaths()): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(paths.prebuiltDir, 'manifest.json'), 'utf8'));
    const record = manifest?.[name]?.[paths.arch];
    const binary = path.join(paths.prebuiltDir, paths.arch, name);
    if (!record?.sha256 || !fs.existsSync(binary)) return null;
    return record.sha256 === sourceHash(name, paths) ? binary : null;
  } catch { return null; }
}

/**
 * Decide what to do, without doing it: `ready` when the installed binary is
 * already current, `copy` when a matching prebuilt should be installed,
 * `compile` when only the compiler can help, `none` when nothing can.
 */
export function planHelper(name: HelperName, paths = defaultPaths()): { action: 'ready' | 'copy' | 'compile' | 'none'; from?: string } {
  const source = helperSource(name, paths);
  const bin = helperBinary(name, paths);
  if (!fs.existsSync(source)) return fs.existsSync(bin) ? { action: 'ready' } : { action: 'none' };
  const prebuilt = prebuiltFor(name, paths);
  const hash = sourceHash(name, paths);
  const installedHash = readSidecar(bin);
  // A binary this app installed from a matching prebuilt, or compiled from this very source, is current.
  if (fs.existsSync(bin) && installedHash === hash) return { action: 'ready' };
  if (prebuilt) return { action: 'copy', from: prebuilt };
  // Compiled before, and the source has not changed since: still good.
  if (fs.existsSync(bin) && !installedHash && fs.statSync(bin).mtimeMs > fs.statSync(source).mtimeMs) return { action: 'ready' };
  return { action: 'compile' };
}

const sidecar = (bin: string) => `${bin}.source-sha256`;
function readSidecar(bin: string): string | null {
  try { return fs.readFileSync(sidecar(bin), 'utf8').trim() || null; } catch { return null; }
}
function writeSidecar(name: HelperName, bin: string, paths: HelperPaths) {
  try { fs.writeFileSync(sidecar(bin), sourceHash(name, paths) + '\n'); } catch { /* the mtime check still works */ }
}

function prepare(name: HelperName, paths: HelperPaths): { action: 'ready' | 'compile' | 'none'; source: string; bin: string } {
  const source = helperSource(name, paths);
  const bin = helperBinary(name, paths);
  const plan = planHelper(name, paths);
  if (plan.action === 'copy') {
    try {
      if (paths.binDir === path.join(APP_DIR, 'bin')) ensureDir();
      fs.mkdirSync(paths.binDir, { recursive: true });
      fs.copyFileSync(plan.from!, bin);
      fs.chmodSync(bin, 0o755);
      // Copying strips nothing, but the signature is checked against the file's
      // location for some checks, so it is re-applied where it will be run from.
      sign(name, bin, paths);
      writeSidecar(name, bin, paths);
      logEvent('notchlight', `helper ${name}: installed prebuilt for ${paths.arch}`);
      return { action: 'ready', source, bin };
    } catch (error) {
      logEvent('notchlight', `helper ${name}: prebuilt could not be installed (${(error as Error).message}); compiling`);
      return { action: 'compile', source, bin };
    }
  }
  if (plan.action === 'compile') {
    try { if (paths.binDir === path.join(APP_DIR, 'bin')) ensureDir(); fs.mkdirSync(paths.binDir, { recursive: true }); } catch { return { action: 'none', source, bin }; }
  }
  return { action: plan.action, source, bin };
}

export function ensureHelper(name: HelperName, paths = defaultPaths()): Promise<string | null> {
  return new Promise(resolve => {
    const { action, source, bin } = prepare(name, paths);
    if (action === 'ready') return resolve(bin);
    if (action === 'none') return resolve(null);
    logEvent('notchlight', `helper ${name}: compiling`);
    execFile('swiftc', buildArgs(name, source, bin, paths), { timeout: 120_000 }, error => {
      if (error) { logEvent('notchlight', `helper ${name}: compile failed (${error.message.split('\n')[0]})`); return resolve(null); }
      sign(name, bin, paths);
      writeSidecar(name, bin, paths);
      resolve(bin);
    });
  });
}

/** The same, blocking — for the cutout probe, which runs before the window exists. */
export function ensureHelperSync(name: HelperName, paths = defaultPaths()): string | null {
  const { action, source, bin } = prepare(name, paths);
  if (action === 'ready') return bin;
  if (action === 'none') return null;
  try {
    logEvent('notchlight', `helper ${name}: compiling`);
    execFileSync('swiftc', buildArgs(name, source, bin, paths), { stdio: 'ignore', timeout: 90_000 });
    sign(name, bin, paths);
    writeSidecar(name, bin, paths);
    return bin;
  } catch (error) {
    logEvent('notchlight', `helper ${name}: compile failed (${(error as Error).message.split('\n')[0]})`);
    return null;
  }
}
