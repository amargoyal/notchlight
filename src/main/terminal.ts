/**
 * Back to the terminal a session lives in.
 *
 * A session knows its process: the hook client reports the pid of the
 * `claude` that ran it, and without hooks the process table gives the pids
 * working in the session's directory. From the pid, the parent chain says
 * which app is hosting it — Terminal, iTerm2, Ghostty, VS Code — and the tty
 * says which tab. Terminal and iTerm2 can select that tab by tty through
 * their scripting dictionaries; everything else is brought to the front and
 * left to its own tab handling.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logEvent } from './lifecycle';

const run = promisify(execFile);

export type TerminalKind = 'terminal' | 'iterm' | 'app' | 'none';
export interface TerminalHost { kind: TerminalKind; app: string | null; name: string }

/**
 * The hosting app from a chain of executable paths, child first. The first
 * ancestor inside a .app bundle wins: a shell inside Ghostty is Ghostty, a
 * `claude` inside VS Code's terminal is VS Code.
 */
export function classifyHost(chain: string[]): TerminalHost {
  for (const comm of chain) {
    const match = /^(.*?\/([^/]+)\.app)\/Contents\//.exec(comm);
    if (!match) continue;
    const app = match[1], name = match[2];
    if (name === 'Terminal') return { kind: 'terminal', app, name };
    if (name === 'iTerm' || name === 'iTerm2') return { kind: 'iterm', app, name: 'iTerm2' };
    return { kind: 'app', app, name };
  }
  return { kind: 'none', app: null, name: '' };
}

/** AppleScript that selects the tab holding `tty` in Terminal or iTerm2, then brings that window forward. */
export function selectTabScript(kind: TerminalKind, tty: string): string | null {
  const device = `/dev/${tty}`;
  if (!/^ttys\d{3}$/.test(tty)) return null;
  if (kind === 'terminal') return `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${device}" then
        set selected tab of w to t
        set index of w to 1
        activate
        return true
      end if
    end repeat
  end repeat
end tell
return false`;
  if (kind === 'iterm') return `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${device}" then
          select s
          select t
          activate
          return true
        end if
      end repeat
    end repeat
  end repeat
end tell
return false`;
  return null;
}

async function ps(args: string[]): Promise<string> {
  try { return (await run('ps', args, { timeout: 3000 })).stdout; } catch { return ''; }
}

/** The executable paths from `pid` up to launchd, child first. */
export async function parentChain(pid: number): Promise<string[]> {
  const chain: string[] = [];
  let current = pid;
  for (let depth = 0; depth < 12 && current > 1; depth++) {
    const out = await ps(['-o', 'ppid=,comm=', '-p', String(current)]);
    const match = /^\s*(\d+)\s+(.*)$/.exec(out.trim());
    if (!match) break;
    chain.push(match[2].trim());
    current = Number(match[1]);
  }
  return chain;
}

export async function ttyOf(pid: number): Promise<string | null> {
  const tty = (await ps(['-o', 'tty=', '-p', String(pid)])).trim();
  return tty && tty !== '??' ? tty : null;
}

/**
 * Bring the terminal hosting `pid` to the front, on the right tab where the
 * app can be asked. Resolves to what was done, for the notice.
 */
export async function jumpToProcess(pid: number): Promise<string> {
  const [chain, tty] = await Promise.all([parentChain(pid), ttyOf(pid)]);
  const host = classifyHost(chain);
  logEvent('island', `jump to pid ${pid}: ${host.kind} ${host.name || ''} tty ${tty ?? 'none'}`);
  if (host.kind === 'none') throw new Error('That session’s terminal could not be found.');
  const script = tty ? selectTabScript(host.kind, tty) : null;
  if (script) {
    try {
      const { stdout } = await run('/usr/bin/osascript', ['-e', script], { timeout: 4000 });
      if (stdout.trim() === 'true') return `Switched to ${host.name}.`;
    } catch (error) {
      logEvent('island', `jump: ${host.name} script failed: ${(error as Error).message.split('\n')[0]}`);
    }
  }
  await run('open', [host.app!], { timeout: 4000 });
  return `Brought ${host.name} forward.`;
}
