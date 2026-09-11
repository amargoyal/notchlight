/**
 * Is there a newer Notchlight on GitHub?
 *
 * The app asks the releases API once a while, compares the tag against its own
 * version, and opens a small window when the answer is yes. That is the whole
 * job: the build is not signed or notarized, so there is no in-place install —
 * the window sends you to the DMG and the README's drag-to-Applications step.
 *
 * Quiet by design. A check runs a little after boot and then every few hours;
 * "Later" holds the window back for a day, "Skip this version" for good, and
 * every decision is written to ~/.notchlight/updates.json so a restart does
 * not ask again. Only the packaged app checks on its own; a checkout has git.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { APP_DIR } from './config';
import { logEvent } from './lifecycle';
import type { UpdateInfo } from '../shared/updates';

export const RELEASES_API = 'https://api.github.com/repos/amargoyal/notchlight/releases/latest';
export const RELEASES_PAGE = 'https://github.com/amargoyal/notchlight/releases';
const STATE_FILE = path.join(APP_DIR, 'updates.json');

/** How often to ask GitHub, and how long "Later" lasts. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const LATER_MS = 24 * 60 * 60 * 1000;
/** Boot is busy; the first check waits for things to settle. */
const FIRST_CHECK_MS = 45 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;

/** A release, as much of it as the window needs. */
export interface Release {
  version: string;
  title: string;
  notes: string;
  url: string;
  download: string;
  publishedAt: string;
}

interface UpdateState {
  lastCheckAt?: number;
  /** "Skip this version": never show this one again. */
  skipped?: string;
  /** "Later": nothing until this time, whatever the version. */
  remindAt?: number;
}

/**
 * Compare two dotted versions numerically, ignoring a leading `v` and anything
 * after a hyphen (a `-beta` is treated as its base). Positive when `a` is newer.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().replace(/^v/i, '').split('-')[0].split('.').map(part => Number.parseInt(part, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Sanity: a tag is a version if it looks like one. */
export function isVersion(v: string): boolean {
  return /^v?\d+(\.\d+){0,3}(-[\w.]+)?$/i.test(v.trim());
}

/**
 * The GitHub "latest" release, read into a Release. `latest` already excludes
 * drafts and prereleases, so anything that comes back is meant for people.
 */
export function parseRelease(body: unknown, arch: string = process.arch): Release | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as Record<string, unknown>;
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  if (!isVersion(tag)) return null;
  const assets = Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : [];
  const dmgs = assets
    .map(a => (typeof a.browser_download_url === 'string' ? a.browser_download_url : ''))
    .filter(u => /\.dmg$/i.test(u));
  const wanted = arch === 'arm64' ? /arm64|aarch64|apple/i : /x64|x86_64|intel/i;
  const url = typeof r.html_url === 'string' ? r.html_url : RELEASES_PAGE;
  return {
    version: tag.replace(/^v/i, ''),
    title: (typeof r.name === 'string' && r.name.trim()) || tag,
    notes: typeof r.body === 'string' ? r.body.replace(/\r\n/g, '\n').trim() : '',
    url,
    download: dmgs.find(u => wanted.test(path.basename(u))) ?? dmgs[0] ?? url,
    publishedAt: typeof r.published_at === 'string' ? r.published_at : ''
  };
}

/** Fetch the latest release. Throws on a network or API failure. */
export async function fetchLatest(fetchImpl: typeof fetch = fetch): Promise<Release | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RELEASES_API, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Notchlight update check' }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return parseRelease(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export interface UpdaterOptions {
  current: string;
  /** Check on a timer, or only when asked. */
  automatic: boolean;
  fetchImpl?: typeof fetch;
  stateFile?: string;
  now?: () => number;
}

export type CheckOutcome =
  | { kind: 'update'; release: Release }
  | { kind: 'current'; release: Release | null }
  | { kind: 'held'; release: Release; reason: 'skipped' | 'later' }
  | { kind: 'failed'; error: string };

/**
 * Emits `update` with a Release when one should be shown. Whoever listens
 * opens the window and calls back with the answer.
 */
export class Updater extends EventEmitter {
  private state: UpdateState = {};
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private checking: Promise<CheckOutcome> | null = null;
  private readonly file: string;
  private readonly now: () => number;

  constructor(private readonly options: UpdaterOptions) {
    super();
    this.file = options.stateFile ?? STATE_FILE;
    this.now = options.now ?? Date.now;
    this.load();
  }

  get current(): string {
    return this.options.current;
  }

  start(): void {
    if (!this.options.automatic) return;
    const overdue = !this.state.lastCheckAt || this.now() - this.state.lastCheckAt >= CHECK_EVERY_MS;
    const wait = overdue ? FIRST_CHECK_MS : Math.max(FIRST_CHECK_MS, CHECK_EVERY_MS - (this.now() - (this.state.lastCheckAt ?? 0)));
    this.first = setTimeout(() => { void this.check(false); }, wait);
    this.timer = setInterval(() => { void this.check(false); }, CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
  }

  /**
   * Ask GitHub now. A forced check — the menu item — ignores "Later" and a
   * skipped version, because you asked. Only one check runs at a time.
   */
  check(force: boolean): Promise<CheckOutcome> {
    if (this.checking) return this.checking;
    this.checking = this.run(force).finally(() => { this.checking = null; });
    return this.checking;
  }

  private async run(force: boolean): Promise<CheckOutcome> {
    let release: Release | null;
    try {
      release = await fetchLatest(this.options.fetchImpl);
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? 'timed out' : (error as Error).message;
      logEvent('updates', `check failed: ${message}`);
      return { kind: 'failed', error: message };
    }
    this.state.lastCheckAt = this.now();
    this.save();
    if (!release || compareVersions(release.version, this.options.current) <= 0) {
      logEvent('updates', `up to date: ${this.options.current}${release ? ` (latest ${release.version})` : ' (no release)'}`);
      return { kind: 'current', release };
    }
    if (!force) {
      if (this.state.skipped && compareVersions(release.version, this.state.skipped) === 0) {
        logEvent('updates', `${release.version} available, skipped`);
        return { kind: 'held', release, reason: 'skipped' };
      }
      if (this.state.remindAt && this.now() < this.state.remindAt) {
        logEvent('updates', `${release.version} available, held until ${new Date(this.state.remindAt).toISOString()}`);
        return { kind: 'held', release, reason: 'later' };
      }
    }
    logEvent('updates', `${release.version} available, running ${this.options.current}`);
    this.emit('update', release);
    return { kind: 'update', release };
  }

  /** "Later" — not for a day. */
  later(): void {
    this.state.remindAt = this.now() + LATER_MS;
    this.save();
    logEvent('updates', 'later');
  }

  /** "Skip this version" — not for this one, ever. A newer one still shows. */
  skip(version: string): void {
    this.state.skipped = version;
    delete this.state.remindAt;
    this.save();
    logEvent('updates', `skip ${version}`);
  }

  /** The DMG was opened. Nothing to remember: next boot is the new version, or it asks again. */
  downloaded(version: string): void {
    delete this.state.remindAt;
    this.save();
    logEvent('updates', `download ${version}`);
  }

  info(release: Release, theme: UpdateInfo['theme']): UpdateInfo {
    return {
      current: this.options.current,
      latest: release.version,
      title: release.title,
      notes: release.notes,
      url: release.url,
      download: release.download,
      publishedAt: release.publishedAt,
      theme
    };
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as UpdateState;
      if (parsed && typeof parsed === 'object') this.state = parsed;
    } catch {
      this.state = {};
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2) + '\n');
    } catch (error) {
      logEvent('updates', `could not save state: ${(error as Error).message}`);
    }
  }
}
