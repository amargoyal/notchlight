import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_COMPANION_PREFERENCES, EMPTY_SPOTIFY, validatePreferences, type CompanionSnapshot, type CompanionView, type ShelfFile, type SpotifySnapshot } from '../shared/companion';

type Entry = { id: string; path: string };
export class CompanionStore extends EventEmitter {
  private entries: Entry[] = [];
  private state: CompanionSnapshot;
  private queue: Promise<unknown> = Promise.resolve();
  private icons = new Map<string, string>();
  constructor(private file: string, private icon: (file: string) => Promise<string>, pulse = true) {
    super();
    this.state = { preferences: { ...DEFAULT_COMPANION_PREFERENCES, pulse }, view: 'agents', files: [], music: { ...EMPTY_SPOTIFY }, notice: '' };
  }
  current(): CompanionSnapshot { return this.state; }
  private emitState() { this.emit('change', this.state); }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state.preferences = { ...this.state.preferences, ...validatePreferences(raw.preferences) };
      if (Array.isArray(raw.entries)) {
        const seen = new Set<string>();
        this.entries = raw.entries.filter((v: unknown): v is Entry => {
          if (!v || typeof v !== 'object') return false;
          const e = v as Entry;
          if (typeof e.id !== 'string' || !e.id || typeof e.path !== 'string' || !path.isAbsolute(e.path) || seen.has(e.path)) return false;
          seen.add(e.path); return true;
        }).slice(0, 100);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.state.notice = 'Saved companion settings could not be read. Using defaults.';
    }
    await this.refresh();
  }
  private async persist(preferences = this.state.preferences, entries = this.entries): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ preferences, entries }, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  updatePreferences(patch: unknown): Promise<void> {
    const checked = validatePreferences(patch);
    return this.serial(async () => {
      const next = { ...this.state.preferences, ...checked };
      await this.persist(next);
      this.state = { ...this.state, preferences: next };
      this.emitState();
    });
  }
  setView(view: unknown): void {
    if (view === 'claude') view = 'agents';
    if (view !== 'agents' && view !== 'music' && view !== 'tray') throw new Error('Unknown view.');
    this.state = { ...this.state, view: view as CompanionView }; this.emitState();
  }
  setMusic(music: SpotifySnapshot): void { this.state = { ...this.state, music }; this.emitState(); }
  notice(notice: string): void { this.state = { ...this.state, notice }; this.emitState(); }
  add(paths: unknown): Promise<void> {
    if (!Array.isArray(paths) || paths.length > 100 || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) return Promise.reject(new Error('Choose files from Finder.'));
    return this.serial(async () => {
      const next = [...this.entries]; let added = 0, skipped = 0;
      for (const name of paths) {
        try {
          const canonical = await fs.realpath(name);
          const stat = await fs.stat(canonical);
          if (!stat.isFile() && !stat.isDirectory()) { skipped++; continue; }
          if (next.some(e => e.path === canonical)) continue;
          if (next.length >= 100) { skipped++; continue; }
          next.push({ id: randomUUID(), path: canonical }); added++;
        } catch { skipped++; }
      }
      await this.persist(this.state.preferences, next);
      this.entries = next;
      if (added) this.state.view = 'tray';
      this.state.notice = added ? `${added} ${added === 1 ? 'item' : 'items'} added to Tray.${skipped ? ` ${skipped} could not be added.` : ''}` : skipped ? 'Those files could not be added. Tray holds up to 100 items.' : 'Those files are already in Tray.';
      await this.refreshNow();
    });
  }
  remove(id: unknown): Promise<void> {
    return this.serial(async () => {
      const entry = this.entry(id);
      const next = this.entries.filter(e => e.id !== entry.id);
      await this.persist(this.state.preferences, next);
      this.entries = next; this.icons.delete(entry.path);
      this.state.notice = 'Removed from Tray. The original file stays where it is.';
      await this.refreshNow();
    });
  }
  entry(id: unknown): Entry {
    const entry = typeof id === 'string' && this.entries.find(e => e.id === id);
    if (!entry) throw new Error('This item is no longer in Tray.');
    return entry;
  }
  async existingPath(id: unknown): Promise<string> {
    const entry = this.entry(id);
    try { await fs.access(entry.path); return entry.path; }
    catch { throw new Error('This file was moved or removed. Add it to Tray again.'); }
  }
  /** Copy only into a user-chosen directory, never overwrite an existing destination. */
  copyTo(id: string, destination: string): Promise<void> {
    return this.serial(async () => {
      const source = await this.existingPath(id);
      const folder = await fs.realpath(destination);
      const target = path.join(folder, path.basename(source));
      if (target === source || folder.startsWith(source + path.sep)) throw new Error('Choose a destination outside the original folder.');
      await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
      if (this.state.preferences.removeAfterTransfer) {
        const next = this.entries.filter(e => e.id !== id);
        try { await this.persist(this.state.preferences, next); this.entries = next; }
        catch { this.state.notice = 'Copy saved. Tray could not be updated; the item was kept.'; await this.refreshNow(); return; }
      }
      this.state.notice = `Saved a copy of ${path.basename(source)}.`;
      await this.refreshNow();
    });
  }
  refresh(): Promise<void> { return this.serial(() => this.refreshNow()); }
  private async refreshNow(): Promise<void> {
    const files: ShelfFile[] = [];
    for (const entry of this.entries) {
      let file: ShelfFile = { id: entry.id, name: path.basename(entry.path), kind: 'text', size: '', unavailable: true };
      try {
        const stat = await fs.stat(entry.path);
        const extension = path.extname(entry.path).toLowerCase();
        const kind = stat.isDirectory() ? 'folder' : extension === '.pdf' ? 'pdf' : ['.png','.jpg','.jpeg','.heic','.gif','.webp'].includes(extension) ? 'image' : 'text';
        if (!this.icons.has(entry.path)) {
          const thumbnail = await this.icon(entry.path).catch(() => '');
          if (thumbnail) this.icons.set(entry.path, thumbnail);
        }
        const size = stat.isDirectory() ? 'Folder' : stat.size < 1024 ? `${stat.size} B` : stat.size < 1048576 ? `${Math.ceil(stat.size / 1024)} KB` : `${(stat.size / 1048576).toFixed(1)} MB`;
        file = { ...file, kind, size, unavailable: false, thumbnail: this.icons.get(entry.path) };
      } catch { /* Preserve the reference so the user can identify and remove it. */ }
      files.push(file);
    }
    this.state = { ...this.state, files }; this.emitState();
  }
}
