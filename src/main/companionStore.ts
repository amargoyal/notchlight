import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_COMPANION_PREFERENCES, EMPTY_CAPTURE, EMPTY_SPOTIFY, validatePreferences, type CaptureSnapshot, type CompanionSnapshot, type CompanionView, type ShelfFile, type SpotifySnapshot, type TransferProgress } from '../shared/companion';

type Entry = { id: string; path: string };
/** What Remove took away, so Undo can put it back where it was. */
type Removed = { entries: { entry: Entry; index: number }[]; at: number };

/** Every id in the argument, in order, or a clear complaint. */
function idList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || list.length > 100 || list.some(v => typeof v !== 'string' || !v)) throw new Error('Choose items in Tray first.');
  return [...new Set(list as string[])];
}

export class CopyError extends Error {
  constructor(message: string, readonly partial: string | null, readonly code?: string) { super(message); }
}

export class CompanionStore extends EventEmitter {
  private entries: Entry[] = [];
  private state: CompanionSnapshot;
  private queue: Promise<unknown> = Promise.resolve();
  private icons = new Map<string, string>();
  private removed: Removed | null = null;
  constructor(private file: string, private icon: (file: string) => Promise<string>, pulse = true) {
    super();
    this.state = { preferences: { ...DEFAULT_COMPANION_PREFERENCES, pulse }, view: 'agents', files: [], music: { ...EMPTY_SPOTIFY }, capture: { ...EMPTY_CAPTURE }, transfer: null, undoable: 0, notice: '' };
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
  setCapture(capture: CaptureSnapshot): void {
    const current = this.state.capture;
    if (current.status === capture.status && current.reason === capture.reason && current.retryAt === capture.retryAt) return;
    this.state = { ...this.state, capture }; this.emitState();
  }
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
  /** Take one or several references off the shelf. Originals are untouched; Undo puts the references back. */
  remove(ids: unknown): Promise<void> {
    const wanted = idList(ids);
    return this.serial(async () => {
      const taken: Removed['entries'] = [];
      for (const id of wanted) {
        const index = this.entries.findIndex(e => e.id === id);
        if (index < 0) throw new Error('This item is no longer in Tray.');
        taken.push({ entry: this.entries[index], index });
      }
      const gone = new Set(wanted);
      const next = this.entries.filter(e => !gone.has(e.id));
      await this.persist(this.state.preferences, next);
      this.entries = next;
      for (const { entry } of taken) this.icons.delete(entry.path);
      this.removed = { entries: taken, at: Date.now() };
      this.state.undoable = taken.length;
      this.state.notice = `${taken.length === 1 ? 'Removed from Tray.' : `Removed ${taken.length} items from Tray.`} The originals stay where they are.`;
      await this.refreshNow();
    });
  }
  /** Put back what the last Remove took, in the places it took them from. */
  undoRemove(): Promise<void> {
    return this.serial(async () => {
      const removed = this.removed;
      if (!removed) throw new Error('Nothing to put back.');
      const next = [...this.entries];
      const present = new Set(next.map(e => e.path));
      let restored = 0;
      for (const { entry, index } of [...removed.entries].sort((a, b) => a.index - b.index)) {
        if (present.has(entry.path) || next.length >= 100) continue;
        next.splice(Math.min(index, next.length), 0, entry);
        present.add(entry.path); restored++;
      }
      await this.persist(this.state.preferences, next);
      this.entries = next;
      this.removed = null;
      this.state.undoable = 0;
      this.state.notice = restored ? `${restored === 1 ? 'Put back in Tray.' : `Put ${restored} items back in Tray.`}` : 'Those items are already in Tray.';
      await this.refreshNow();
    });
  }
  /** Point a reference at where its file lives now. */
  relocate(id: unknown, location: unknown): Promise<void> {
    if (typeof location !== 'string' || !path.isAbsolute(location)) return Promise.reject(new Error('Choose the file in Finder.'));
    return this.serial(async () => {
      const entry = this.entry(id);
      const canonical = await fs.realpath(location);
      const stat = await fs.stat(canonical);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error('Choose a file or folder.');
      const other = this.entries.find(e => e.path === canonical && e.id !== entry.id);
      if (other) throw new Error('That file is already in Tray.');
      const next = this.entries.map(e => e.id === entry.id ? { ...e, path: canonical } : e);
      await this.persist(this.state.preferences, next);
      this.icons.delete(entry.path);
      this.entries = next;
      this.state.notice = `Found ${path.basename(canonical)}.`;
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
    catch { throw new Error('This file was moved or removed. Use Locate to find it, or add it again.'); }
  }
  /** The paths of the given ids that still exist, in order. Missing files are counted; ids no longer in Tray are stale clicks and are skipped. */
  async existingPaths(ids: unknown): Promise<{ present: string[]; missing: number }> {
    const present: string[] = []; let missing = 0;
    for (const id of idList(ids)) {
      const entry = this.entries.find(e => e.id === id);
      if (!entry) continue;
      try { await fs.access(entry.path); present.push(entry.path); } catch { missing++; }
    }
    return { present, missing };
  }
  private setTransfer(transfer: TransferProgress | null) {
    this.state = { ...this.state, transfer };
    this.emitState();
  }
  /**
   * Copy one or several items into a user-chosen directory, with progress.
   *
   * Never overwrites: a name already at the destination fails that item and
   * the rest carry on. A failure inside a folder stops that folder and says
   * so, including that a partial copy is at the destination — it is not
   * deleted, because deleting inside a folder the user chose is a bigger
   * surprise than leaving a half-copied one they were told about.
   */
  copyTo(ids: unknown, destination: string): Promise<void> {
    const wanted = idList(ids);
    return this.serial(async () => {
      const folder = await fs.realpath(destination);
      const jobs: { id: string; source: string }[] = [];
      const failures: string[] = [];
      for (const id of wanted) {
        try { jobs.push({ id, source: await this.existingPath(id) }); }
        catch { failures.push(`${path.basename(this.entry(id).path)}: moved or removed`); }
      }
      for (const { source } of jobs) {
        if (path.join(folder, path.basename(source)) === source || folder.startsWith(source + path.sep)) throw new Error('Choose a destination outside the original folder.');
      }
      let total = 0;
      const sizes = new Map<string, number>();
      for (const { source } of jobs) { const size = await measure(source); sizes.set(source, size); total += size; }
      let done = 0, lastReport = 0;
      const report = (name: string, force = false) => {
        const now = Date.now();
        if (!force && now - lastReport < 100) return;
        lastReport = now;
        this.setTransfer({ name, done, total, item: jobs.findIndex(j => path.basename(j.source) === name) + 1, items: jobs.length });
      };
      const saved: { id: string; source: string }[] = [];
      let partial: string | null = null;
      try {
        for (const job of jobs) {
          const name = path.basename(job.source);
          const target = path.join(folder, name);
          const before = done;
          report(name, true);
          try {
            await copyWithProgress(job.source, target, bytes => { done = before + bytes; report(name); });
            done = before + (sizes.get(job.source) ?? 0);
            saved.push(job);
          } catch (error) {
            const e = error as CopyError & NodeJS.ErrnoException;
            done = before + (sizes.get(job.source) ?? 0);
            if (e instanceof CopyError && e.partial) partial = e.partial;
            failures.push(`${name}: ${e.code === 'EEXIST' ? 'already at the destination' : e.code === 'EACCES' || e.code === 'EPERM' ? 'not allowed there' : e.message}`);
          }
        }
        report(jobs.at(-1) ? path.basename(jobs.at(-1)!.source) : '', true);
      } finally { this.setTransfer(null); }
      if (saved.length && this.state.preferences.removeAfterTransfer) {
        const gone = new Set(saved.map(j => j.id));
        const next = this.entries.filter(e => !gone.has(e.id));
        try { await this.persist(this.state.preferences, next); this.entries = next; }
        catch { failures.push('Tray could not be updated; the copied items were kept.'); }
      }
      const savedText = saved.length === 0 ? '' : saved.length === 1 ? `Saved a copy of ${path.basename(saved[0].source)}.` : `Saved copies of ${saved.length} items.`;
      const failedText = failures.length ? ` ${failures.length === 1 ? 'Not copied' : `${failures.length} not copied`} — ${failures.join('; ')}.${partial ? ` A partial copy is at ${partial}.` : ''}` : '';
      this.state.notice = (savedText + failedText).trim() || 'Nothing was copied.';
      await this.refreshNow();
      if (!saved.length) throw new CopyError(this.state.notice, partial);
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
      } catch { /* Preserve the reference so the user can identify, locate or remove it. */ }
      files.push(file);
    }
    this.state = { ...this.state, files }; this.emitState();
  }
}

/** Bytes under a path: the file's size, or every file inside a folder. */
export async function measure(source: string): Promise<number> {
  const stat = await fs.lstat(source);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  for (const name of await fs.readdir(source)) total += await measure(path.join(source, name));
  return total;
}

/**
 * Copy a file or a folder without ever overwriting, reporting bytes as they land.
 * `progress` is called with the bytes copied so far for this source.
 */
export async function copyWithProgress(source: string, target: string, progress: (bytes: number) => void): Promise<void> {
  let copied = 0;
  const step = async (from: string, to: string, root: boolean): Promise<void> => {
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) {
      try { await fs.symlink(await fs.readlink(from), to); }
      catch (error) { throw new CopyError(`${path.basename(from)} could not be linked.`, root ? null : target, (error as NodeJS.ErrnoException).code); }
      return;
    }
    if (stat.isDirectory()) {
      try { await fs.mkdir(to); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        throw new CopyError(code === 'EEXIST' ? 'That destination already contains an item with this name.' : `${path.basename(from)} could not be created.`, root ? null : target, code);
      }
      for (const name of await fs.readdir(from)) await step(path.join(from, name), path.join(to, name), false);
      return;
    }
    if (!stat.isFile()) return;
    try {
      const reader = createReadStream(from);
      reader.on('data', (chunk: Buffer | string) => { copied += chunk.length; progress(copied); });
      await pipeline(reader, createWriteStream(to, { flags: 'wx', mode: stat.mode & 0o777 }));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new CopyError(code === 'EEXIST' ? 'That destination already contains an item with this name.' : `${path.basename(from)} could not be copied${code ? ` (${code})` : ''}.`, root ? null : target, code);
    }
  };
  await step(source, target, true);
}
