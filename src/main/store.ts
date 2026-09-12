/**
 * One place that knows what the light should be.
 *
 * Two sources feed it and they are not equal partners. Transcripts are the
 * truth about content — which project, which agents, how many tokens, what
 * words describe the work. Hooks are the truth about *phase* — working, asking,
 * done — because that is the one thing a file on disk cannot tell you: a tool
 * call that has been open for ninety seconds looks identical whether Claude is
 * compiling something or waiting for you to say yes.
 *
 * Where hooks are not installed the phase is inferred from the transcript's
 * timing instead. It is worse, and it is worth having: the island still works
 * on a machine where nobody ran the installer.
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { config } from './config';
import { ellipsis } from './format';
import { directoryKey, Liveness } from './liveness';
import type { HookEvent } from './hookServer';
import { TranscriptWatcher, phraseFor, type SessionFacts } from './transcripts';
import type { Agent, Ask, Session, Snapshot, Status } from '../shared/types';

/** Worst first: a question outranks work, which outranks a finished session. */
const RANK: Record<Status, number> = { asking: 0, working: 1, failed: 2, done: 3, interrupted: 4, unknown: 5, idle: 6 };

type Phase = 'idle' | 'working' | 'asking' | 'done';

interface Live {
  id: string;
  /** Set by hooks; `null` while only the transcript has been heard from. */
  phase: Phase | null;
  lastHookAt: number;
  ask: Ask | null;
  /**
   * Every tool call this session is holding open, not just the one on screen.
   *
   * It was a single slot, and a second gated call overwrote it — orphaning the
   * first, which then sat there stalling Claude Code for the whole timeout with
   * no way for anyone to answer it. Whatever is dropped from here gets released
   * so it falls back to Claude Code's own prompt immediately.
   */
  gates: Set<string>;
  /** The gate behind the ask currently on screen. */
  gateId: string | null;
  /** Red light the user has waved away — stays hidden until it moves again. */
  dismissedAt: number;
  doneAt: number;
  /** SessionEnd fired at this time. Zero for a session still alive. */
  endedAt: number;
  /** First moment the process table stopped accounting for this session. */
  deadSince: number;
  cwd?: string;
  /** The session's own `claude` process, when a hook has said. */
  pid?: number;
  /**
   * Whether that pid was ever confirmed live in the process table.
   *
   * A hook reports its own parent, which is `claude` only if the shell that
   * ran the hook exec'd rather than forked. Confirming the pid once turns it
   * from a claim into a fact, and only a confirmed pid is allowed to be the
   * reason a session disappears — otherwise a shell pid nobody can find would
   * hide a session that is still very much open.
   */
  pidSeen: boolean;
}

/**
 * Whether a Notification is a question, or only a nudge.
 *
 * Claude Code sends a Notification for two very different things. One is a
 * permission prompt sitting in the terminal with numbered choices, which is a
 * question: nothing moves until a person picks one. The other fires about a
 * minute after Claude stopped, saying nobody has typed anything yet — and that
 * is not a question, it is the ordinary state of a finished session whose user
 * is reading the answer. Treating it as one turned every completed session
 * yellow a minute after it finished, and it stayed yellow, because a session
 * that has stopped writes nothing more for `phaseOf` to notice.
 *
 * The match is on Claude Code's own wording for the permission prompt rather
 * than on loose keywords. The message is free text that can quote a tool name
 * or a command, so `includes('approve')` fired on notifications that were only
 * talking about approving something.
 */
function isPermissionAsk(message: string): boolean {
  const m = message.toLowerCase();
  // "Claude needs your permission to use Bash"
  return /needs? your permission/.test(m) || /permission to (use|run)\b/.test(m);
}

/** One line describing what a tool call would do, for the approval card. */
function commandLine(tool: string, input: Record<string, any>): string {
  const i = input || {};
  if (tool === 'Bash') return ellipsis(String(i.command ?? ''), 160);
  if (tool === 'Write') return 'write ' + String(i.file_path ?? '');
  if (tool === 'Edit' || tool === 'MultiEdit') return 'edit ' + String(i.file_path ?? '');
  if (tool === 'NotebookEdit') return 'edit ' + String(i.notebook_path ?? '');
  if (tool === 'WebFetch') return 'fetch ' + String(i.url ?? '');
  return phraseFor(tool, i);
}

export class Store extends EventEmitter {
  private live = new Map<string, Live>();
  private facts = new Map<string, SessionFacts>();
  private watcher = new TranscriptWatcher();
  private liveness = new Liveness();
  /** Sessions whose `claude` process is gone. */
  private closed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private last: Snapshot | null = null;
  private notchW = config().notchW;
  private notchH = config().notchH;

  /** Live agent processes working in this directory, newest first, for when no hook has named one. */
  processesIn(cwd: string, name: 'claude' | 'codex' = 'claude'): number[] { return this.liveness.pidsFor(cwd, name); }

  /** Cutout geometry comes from the probe once the window has measured it. */
  setNotch(w: number, h: number): void {
    this.notchW = Math.round(w);
    this.notchH = Math.round(h);
    this.publish();
  }

  start(): void {
    if (config().watchProcesses) this.liveness.start();
    this.tick();
    // Transcripts are polled rather than watched. fs.watch on a directory tree
    // this busy fires far more often than the island can repaint, and every
    // notification would still end in the same forward read this loop already
    // does — so the timer is both simpler and cheaper.
    this.timer = setInterval(() => this.tick(), 900);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.liveness.stop();
  }

  private ensure(id: string, cwd?: string): Live {
    let s = this.live.get(id);
    if (!s) {
      s = {
        id,
        phase: null,
        lastHookAt: 0,
        ask: null,
        gates: new Set(),
        gateId: null,
        dismissedAt: 0,
        doneAt: 0,
        endedAt: 0,
        deadSince: 0,
        pidSeen: false,
        cwd
      };
      this.live.set(id, s);
    }
    if (cwd) s.cwd = cwd;
    return s;
  }

  /** A hook fired. Phase changes here are instant; content catches up on the tick. */
  onHook(e: HookEvent): void {
    const s = this.ensure(e.sessionId, e.cwd);
    s.lastHookAt = Date.now();
    // A `--resume` runs under a new process, so a changed pid is a fresh claim
    // that has to earn its confirmation over again.
    if (e.pid && e.pid !== s.pid) {
      s.pid = e.pid;
      s.pidSeen = false;
    }
    switch (e.event) {
      case 'SessionStart':
        if (s.phase === null) s.phase = 'idle';
        s.dismissedAt = 0;
        break;
      case 'UserPromptSubmit':
        s.phase = 'working';
        s.doneAt = 0;
        s.dismissedAt = 0;
        s.endedAt = 0;
        this.clearAsk(s);
        break;
      case 'PreToolUse':
      case 'PostToolUse':
        // A tool moving means whatever was being asked has been answered — in
        // the terminal, if not here.
        s.phase = 'working';
        s.doneAt = 0;
        s.endedAt = 0;
        this.clearIfStale(s);
        break;
      case 'Notification': {
        if (!isPermissionAsk(e.message || '')) break;
        // A permission prompt cannot appear after the turn ended — no tool runs
        // without a prompt first, and that arrives as UserPromptSubmit. Out of
        // order it is noise, and lighting a finished session yellow on noise is
        // the mistake this whole path exists to avoid.
        if (s.phase === 'done') break;
        s.phase = 'asking';
        // A held gate already put a better card on screen — do not overwrite a
        // question you can answer with one you cannot.
        if (s.ask?.answerable) break;
        s.ask = {
          id: 'note-' + s.id + '-' + s.lastHookAt,
          tool: 'permission',
          command: '',
          message: e.message || 'Claude needs your permission',
          at: s.lastHookAt,
          answerable: false
        };
        break;
      }
      case 'Stop':
        s.phase = 'done';
        s.doneAt = Date.now();
        this.clearAsk(s);
        break;
      case 'SessionEnd':
        // Not a delete. The transcript is still recent, so the next tick would
        // recreate the entry with a blank phase and the session would come back
        // as a green working row seconds after it ended. Tombstone it and let
        // doneLinger age it out — and let a `--resume` of the same id revive it
        // by writing something newer than the moment it stopped.
        s.phase = 'done';
        s.doneAt = Date.now();
        s.endedAt = s.doneAt;
        this.clearAsk(s);
        break;
      default:
        break;
    }
    this.publish();
  }

  /** A gated tool call is being held. This is a question with real buttons. */
  onGate(e: HookEvent & { gateId: string }): void {
    const s = this.ensure(e.sessionId, e.cwd);
    s.lastHookAt = Date.now();
    s.phase = 'asking';
    s.doneAt = 0;
    s.dismissedAt = 0;
    s.endedAt = 0;
    // Only one question fits on the island. Anything already held is let go
    // rather than orphaned — released, it falls straight through to Claude
    // Code's own prompt instead of waiting out the deadline unanswerable.
    for (const id of s.gates) if (id !== e.gateId) this.emit('release', id);
    s.gates.clear();
    s.gates.add(e.gateId);
    s.gateId = e.gateId;
    s.ask = {
      id: e.gateId,
      tool: e.toolName || 'tool',
      command: commandLine(e.toolName || '', (e.toolInput || {}) as Record<string, any>),
      message: 'Wants to run ' + (e.toolName || 'a tool'),
      at: s.lastHookAt,
      answerable: true
    };
    this.publish();
  }

  /** The gate closed — answered, timed out, or Claude Code walked away. */
  onGateClosed(gateId: string): void {
    for (const s of this.live.values()) {
      if (!s.gates.delete(gateId)) continue;
      if (s.gateId === gateId) {
        s.ask = null;
        s.gateId = null;
        if (s.phase === 'asking') s.phase = 'working';
      }
    }
    this.publish();
  }

  /** Drop the question on screen, and let go of anything it was holding. */
  private clearAsk(s: Live): void {
    for (const id of s.gates) this.emit('release', id);
    s.gates.clear();
    s.ask = null;
    s.gateId = null;
  }

  /** The island answered a question. Returns the gate to settle, if any. */
  gateFor(sessionId: string, askId: string): string | null {
    const s = this.live.get(sessionId);
    if (!s || !s.ask || s.ask.id !== askId || !s.ask.answerable) return null;
    return s.gateId;
  }

  /** UserPromptSubmit and friends clear an ask; so does a session ending. */
  private clearIfStale(s: Live): void {
    if (s.ask && !s.ask.answerable) this.clearAsk(s);
  }

  dismiss(sessionId: string): void {
    const s = this.live.get(sessionId);
    if (!s) return;
    s.dismissedAt = Date.now();
    this.publish();
  }

  /** Re-read transcripts and republish if anything actually changed. */
  private tick(): void {
    const cfg = config();
    const facts = this.watcher.scan(cfg.staleSec * 1000);
    this.facts.clear();
    for (const f of facts) {
      this.facts.set(f.sessionId, f);
      // A transcript that appeared without a hook still deserves a row.
      this.ensure(f.sessionId, f.cwd);
    }
    this.sweepClosed();
    // A daemon meant to run for weeks would otherwise keep one entry for every
    // session id it ever saw. Anything with no transcript left and no recent
    // hook has nothing to contribute to a snapshot again.
    const floor = Date.now() - cfg.staleSec * 1000;
    for (const [id, s] of this.live) {
      if (this.facts.has(id) || s.gates.size) continue;
      if (s.lastHookAt >= floor) continue;
      this.live.delete(id);
    }
    this.publish();
  }

  /**
   * Work out which sessions the process table can no longer account for.
   *
   * Two questions, and the first one is exact. A session whose pid a hook
   * named, and which a scan has since confirmed is really a `claude`, is alive
   * precisely while that pid is: closing its terminal window takes the row out
   * of the process table and the light goes out on the next scan, with no
   * guessing and nothing to wait for.
   *
   * The count per directory answers for everyone else — sessions from a machine
   * with no hooks installed, or whose hook has not fired yet. With one live
   * `claude` in ~/dev/thing, the newest session file there is the one it
   * belongs to and anything older is closed. Sessions with no directory
   * recorded, and every session at all when the scan could not run, are left
   * alone — hiding a session you still have open is the worse mistake, so every
   * uncertainty resolves towards showing it.
   */
  private sweepClosed(): void {
    const cfg = config();
    if (!cfg.watchProcesses) {
      this.closed.clear();
      return;
    }
    // No successful scan yet: say nothing rather than guess.
    if (!this.liveness.reliable()) return;

    const now = Date.now();
    // Nothing in the process table while transcripts are plainly being written.
    // That reads as a blind probe — a wrapper, a container, a different name —
    // but only until the probe has resolved a single `claude` of its own. After
    // that it demonstrably works on this machine, and zero is zero: the last
    // session you had open closing is the ordinary way to reach it, and it used
    // to be the one case where the light stayed on.
    if (this.liveness.total() === 0 && !this.liveness.sawAgents()) {
      const recent = [...this.facts.values()].some((f) => now - f.lastAt < 60_000);
      if (recent) {
        this.closed.clear();
        return;
      }
    }

    // Shell aliases and renamed checkout paths must share the same process
    // budget. Resolve both sides using the filesystem rather than spelling.
    const byDir = new Map<string, SessionFacts[]>();
    for (const f of this.facts.values()) {
      if (!f.cwd) continue;
      const key = directoryKey(f.cwd);
      const list = byDir.get(key);
      if (list) list.push(f);
      else byDir.set(key, [f]);
    }

    const alive = new Set<string>();
    /** Sessions proved gone by their own pid, which no grace period applies to. */
    const departed = new Set<string>();
    for (const [key, list] of byDir) {
      list.sort((a, b) => b.lastAt - a.lastAt);
      let keep = this.liveness.countFor(key);
      const unnamed: SessionFacts[] = [];
      for (const f of list) {
        const s = this.live.get(f.sessionId);
        const pid = s?.pid;
        if (pid && this.liveness.hasPid(pid)) {
          // Identified, and it holds one of this directory's processes — so it
          // must not also be counted against the sessions that have no pid.
          if (s) s.pidSeen = true;
          alive.add(f.sessionId);
          keep--;
          continue;
        }
        if (pid && s?.pidSeen) {
          departed.add(f.sessionId);
          continue;
        }
        unnamed.push(f);
      }
      for (let i = 0; i < unnamed.length && i < keep; i++) alive.add(unnamed[i].sessionId);
    }

    for (const f of this.facts.values()) {
      const s = this.live.get(f.sessionId);
      if (!s) continue;
      if (departed.has(f.sessionId)) {
        // Its own process is gone. Nothing can still be holding a tool call
        // open, and there is nothing a longer look would tell us.
        this.clearAsk(s);
        s.deadSince = s.deadSince || now;
        this.closed.add(f.sessionId);
        continue;
      }
      // A held tool call proves there is a process on the other end of it.
      if (!f.cwd || alive.has(f.sessionId) || s.gates.size) {
        s.deadSince = 0;
        this.closed.delete(f.sessionId);
        continue;
      }
      // A grace period, because a count can miss a process that is mid-exec and
      // a light that blinks out and back is worse than one that lingers.
      if (!s.deadSince) s.deadSince = now;
      if (now - s.deadSince >= cfg.processGraceSec * 1000) this.closed.add(f.sessionId);
    }
  }

  /**
   * Phase without hooks — green or red, never yellow.
   *
   * An open tool call that has written nothing for a minute is a permission
   * prompt waiting in the terminal, or it is a slow build, or an agent fleet
   * that has been running for an hour. On disk those are the same file. Calling
   * that yellow was tried and it was wrong the first time it mattered: a
   * TaskOutput blocking on a workflow lit the island up as "waiting on you" for
   * an hour while nothing was waiting on anybody.
   *
   * Yellow demands that a person get up and do something, so it is the one
   * colour that must never be a guess. Without hooks the island stays green.
   */
  private inferPhase(f: SessionFacts): Phase {
    if (f.busy) return 'working';
    // Thinking and a long tool run both write nothing at all. A minute of
    // silence between turns is ordinary; more than that has stopped.
    return Date.now() - f.lastAt < 60_000 ? 'working' : 'done';
  }

  /**
   * Whose word to take.
   *
   * A held gate wins outright — the tool call is literally stopped, waiting on
   * this window. Otherwise hooks are authoritative only while they are the most
   * recent thing that happened: if the transcript has moved on since the last
   * hook fired, the session did something the hooks did not report, and a phase
   * pinned by a stale event is a light that never changes again. That is not
   * hypothetical — one stray Notification is enough to leave a session yellow
   * for the rest of its life.
   */
  private phaseOf(s: Live, f: SessionFacts): Phase {
    if (s.gates.size) return 'asking';
    // Against `mainLastAt`, never `lastAt`. Hooks only ever speak for the main
    // thread, so comparing them to a clock that a running subagent keeps
    // pushing forward declared every hook stale the moment a Task was in
    // flight — which silently threw away the one state that needs a person.
    const heard = s.phase !== null && s.lastHookAt >= f.mainLastAt - 2000;
    return heard ? s.phase! : this.inferPhase(f);
  }

  private statusOf(s: Live, f: SessionFacts | undefined): Status {
    if (!f) return 'idle';
    const phase = this.phaseOf(s, f);
    if (phase === 'asking') return 'asking';
    if (phase === 'working') return 'working';
    if (phase === 'done') return 'done';
    return 'idle';
  }

  /**
   * The agents, with the session's phase pushed down onto the main thread.
   *
   * A subagent's own status comes from the transcript and is already right —
   * it either has a result or it does not. The main thread is the one that
   * needs the hook's opinion.
   */
  private agentsFor(f: SessionFacts, status: Status, ask: Ask | null): Agent[] {
    return f.agents.map((a) => {
      if (a.kind !== 'main') return a;
      const main: Agent = { ...a, status };
      if (status === 'asking') {
        main.activity = 'ask';
        if (ask && ask.answerable) main.title = ask.message;
      } else if (status === 'done') {
        main.activity = 'done';
      }
      return main;
    });
  }

  snapshot(): Snapshot {
    const cfg = config();
    const now = Date.now();
    const out: Session[] = [];

    for (const s of this.live.values()) {
      const f = this.facts.get(s.id);
      // A session known only from a hook, whose transcript has not appeared
      // yet, has nothing to show — no project, no agents, no clock.
      if (!f) continue;
      // Its terminal is gone. Nothing it could still be doing.
      if (this.closed.has(s.id)) continue;
      const status = this.statusOf(s, f);

      if (status === 'done') {
        const finishedAt = s.doneAt || f.lastAt;
        // Waved away by hand, and nothing has happened since.
        if (s.dismissedAt && s.dismissedAt >= finishedAt) continue;
        if (cfg.doneLingerSec > 0 && now - finishedAt > cfg.doneLingerSec * 1000) continue;
      }
      if (status === 'idle' && now - f.lastAt > 60_000) continue;
      if (now - f.lastAt > cfg.staleSec * 1000) continue;

      out.push({
        id: s.id,
        title: f.title || f.project,
        project: f.project || (s.cwd ? path.basename(s.cwd) : 'session'),
        cwd: f.cwd || s.cwd || '',
        pid: s.pid,
        branch: f.branch,
        status,
        tokens: f.tokens,
        startedAt: f.startedAt,
        lastAt: f.lastAt,
        endedAt: status === 'done' ? s.doneAt || f.lastAt : undefined,
        agents: this.agentsFor(f, status, s.ask),
        ask: status === 'asking' ? s.ask : null,
        tail: f.tail,
        tool: f.tool
      });
    }

    out.sort((a, b) => RANK[a.status] - RANK[b.status] || b.lastAt - a.lastAt);

    const overall: Status = out.length ? out[0].status : 'idle';
    const tokens = out.reduce((n, s) => n + s.tokens, 0);
    const elapsed = out.reduce((m, s) => Math.max(m, (s.endedAt ?? now) - s.startedAt), 0);

    return {
      sessions: out,
      overall,
      tokens,
      elapsed,
      dormant: out.length === 0,
      notchW: this.notchW,
      notchH: this.notchH,
      hoverDelay: cfg.hoverDelay,
      pulse: cfg.pulse,
      now
    };
  }

  /** Publish, but only when the picture actually changed. */
  publish(): void {
    const next = this.snapshot();
    if (this.last && same(this.last, next)) return;
    this.last = next;
    this.emit('snapshot', next);
  }

  current(): Snapshot {
    return this.last ?? (this.last = this.snapshot());
  }
}

/**
 * Whether two snapshots would look the same.
 *
 * `now` and the running clocks change on every tick by design — the island
 * counts seconds off its own timer from `startedAt`, so a new snapshot every
 * 900ms just to advance a number nobody read would be pure repaint. Everything
 * a person can see is compared; the wall clock is not.
 */
function same(a: Snapshot, b: Snapshot): boolean {
  if (a.dormant !== b.dormant || a.overall !== b.overall) return false;
  if (a.notchW !== b.notchW || a.notchH !== b.notchH) return false;
  if (a.tokens !== b.tokens || a.sessions.length !== b.sessions.length) return false;
  // `elapsed` is drawn verbatim in the multi-session header rather than counted
  // off the island's own clock, so it has to be compared like any other label.
  if (Math.round(a.elapsed / 1000) !== Math.round(b.elapsed / 1000)) return false;
  for (let i = 0; i < a.sessions.length; i++) {
    const x = a.sessions[i];
    const y = b.sessions[i];
    if (x.id !== y.id || x.status !== y.status || x.tokens !== y.tokens) return false;
    if (x.title !== y.title || x.tool !== y.tool || x.endedAt !== y.endedAt) return false;
    if (x.project !== y.project || x.cwd !== y.cwd || x.branch !== y.branch) return false;
    if ((x.ask?.id ?? '') !== (y.ask?.id ?? '')) return false;
    if (x.agents.length !== y.agents.length) return false;
    for (let j = 0; j < x.agents.length; j++) {
      const p = x.agents[j];
      const q = y.agents[j];
      if (p.id !== q.id || p.title !== q.title || p.status !== q.status) return false;
      if (p.tokens !== q.tokens || p.activity !== q.activity || p.endedAt !== q.endedAt) return false;
    }
    if (x.tail.join('\n') !== y.tail.join('\n')) return false;
  }
  return true;
}
