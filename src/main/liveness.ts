/**
 * Which Claude Code sessions are actually still open.
 *
 * Nothing on disk answers this. Closing a terminal window kills `claude` with a
 * signal, so the transcript simply stops — which is byte for byte what an idle
 * session waiting for you to type looks like. Timing cannot tell them apart at
 * any threshold, and a session you shut an hour ago went on burning a light on
 * the notch.
 *
 * So ask the process table. `claude` runs as a process of that name, and its
 * working directory is the project directory the session belongs to, which is
 * the same `cwd` the transcript records. That gives a count per directory:
 * two live processes in ~/dev/thing means at most two of the session files
 * there are still open, newest first.
 *
 * It is a count, not an identity — the process does not carry its session id
 * anywhere readable. Two sessions in one directory and you close the older one,
 * and this keeps the wrong one for a while. That is the residual error, and it
 * is far smaller than the one it replaces.
 *
 * Everything here fails open. If the scan cannot run, or finds nothing while
 * transcripts are plainly being written, it reports that it could not tell and
 * the caller hides nothing.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Transcripts retain shell aliases; lsof reports the physical directory. */
export function directoryKey(cwd: string): string {
  try { return fs.realpathSync.native(cwd); }
  catch { return path.resolve(cwd); }
}

/** Belt and braces: the probe must never become the reason the app stalls. */
const SCAN_TIMEOUT_MS = 4000;

export class Liveness {
  /** Directory → number of live `claude` processes in it. */
  private counts = new Map<string, number>();
  private known = false;
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  start(intervalMs = 5000): void {
    this.scan();
    this.timer = setInterval(() => this.scan(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** How many sessions can still be open in this directory. */
  countFor(cwd: string): number {
    return this.counts.get(directoryKey(cwd)) ?? 0;
  }

  /** Total live processes seen. Zero with `reliable()` means everything closed. */
  total(): number {
    let n = 0;
    for (const c of this.counts.values()) n += c;
    return n;
  }

  /** False until a scan has succeeded. Callers must hide nothing while false. */
  reliable(): boolean {
    return this.known;
  }

  private scan(): void {
    if (this.scanning) return;
    this.scanning = true;
    // Everything is spawned rather than run synchronously: this sits behind a
    // timer on the main process, and a wedged `lsof` freezing the island would
    // be a far worse bug than a stale light.
    execFile('ps', ['-Ao', 'pid=,uid=,comm='], { timeout: SCAN_TIMEOUT_MS }, (err, out) => {
      if (err) {
        this.scanning = false;
        this.known = false;
        return;
      }
      const uid = process.getuid?.() ?? -1;
      const pids: string[] = [];
      for (const line of out.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (!m) continue;
        if (Number(m[2]) !== uid) continue;
        const comm = m[3].trim();
        // `comm` is the executable, not the command line — a `claude` launched
        // through a shim still reports its own name here.
        if (comm !== 'claude' && !comm.endsWith('/claude')) continue;
        pids.push(m[1]);
      }
      if (!pids.length) {
        this.counts.clear();
        this.known = true;
        this.scanning = false;
        return;
      }
      this.readCwds(pids);
    });
  }

  private readCwds(pids: string[]): void {
    // One lsof for every pid at once. `-Fpn` prints `p<pid>` then `n<path>`.
    execFile(
      'lsof',
      ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')],
      { timeout: SCAN_TIMEOUT_MS },
      (err, out) => {
        this.scanning = false;
        // lsof exits non-zero when some pid has already gone. That is normal
        // here and the output for the rest is still good, so only a total
        // absence of output counts as a failure.
        if (!out || !out.trim()) {
          if (err) this.known = false;
          return;
        }
        const next = new Map<string, number>();
        for (const line of out.split('\n')) {
          if (line.startsWith('n')) {
            const dir = line.slice(1).trim();
            if (dir) {
              const key = directoryKey(dir);
              next.set(key, (next.get(key) ?? 0) + 1);
            }
          }
        }
        this.counts = next;
        this.known = true;
      }
    );
  }
}
