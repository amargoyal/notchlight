/**
 * `electron . --demo` — the island over the real notch, driven by invented
 * sessions.
 *
 * Every face in the design exists in here somewhere: it walks one session
 * working, one session asking with a real-looking command, three sessions at
 * once, and then nothing at all. It is how you check the geometry against your
 * own hardware without waiting for Claude to do something interesting.
 */
import { EventEmitter } from 'node:events';
import { config } from './config';
import type { Agent, Session, Snapshot, Status } from '../shared/types';

const T0 = Date.now();

function agent(
  id: string,
  kind: 'main' | 'sub',
  title: string,
  activity: Agent['activity'],
  status: Status,
  tokens: number,
  ageSec: number,
  endedSec?: number
): Agent {
  return {
    id,
    kind,
    title,
    activity,
    status,
    tokens,
    startedAt: T0 - ageSec * 1000,
    endedAt: endedSec === undefined ? undefined : T0 - endedSec * 1000
  };
}

function session(over: Partial<Session> & { id: string }): Session {
  return {
    title: 'demo',
    project: 'demo',
    cwd: '/Users/demo/dev/demo',
    branch: 'main',
    status: 'working',
    tokens: 0,
    startedAt: T0 - 60_000,
    lastAt: Date.now(),
    agents: [],
    ask: null,
    tail: [],
    ...over
  };
}

const claudeLight = () =>
  session({
    id: 'demo-1',
    title: 'Island geometry',
    project: 'claude-light',
    cwd: '/Users/demo/dev/claude-light',
    branch: 'main',
    status: 'working',
    tokens: 61_300,
    startedAt: T0 - 252_000,
    tool: 'Edit',
    agents: [
      agent('main', 'main', 'Editing Buddy.tsx', 'code', 'working', 24_100, 124),
      agent('a2', 'sub', 'Running test suite', 'shell', 'working', 12_900, 63),
      agent('a3', 'sub', 'Searching hover-intent patterns', 'search', 'working', 8_400, 41),
      agent('a4', 'sub', 'Wrote island geometry spec', 'done', 'done', 15_900, 202, 20)
    ]
  });

const archive = () =>
  session({
    id: 'demo-2',
    title: 'Archive sweep',
    project: 'sill-archive',
    cwd: '/Users/demo/dev/sill',
    branch: 'archive',
    status: 'asking',
    tokens: 18_700,
    startedAt: T0 - 725_000,
    agents: [agent('main', 'main', 'Wants to run a destructive command', 'ask', 'asking', 18_700, 725)],
    ask: {
      id: 'demo-ask',
      tool: 'Bash',
      command: 'rm -rf ./build/cache',
      message: 'Wants to run a destructive command',
      at: Date.now(),
      answerable: true
    }
  });

const notes = () =>
  session({
    id: 'demo-3',
    title: 'Cursor pagination',
    project: 'notes-api',
    cwd: '/Users/demo/work/notes-api',
    branch: 'fix/pagination',
    status: 'done',
    tokens: 210_000,
    startedAt: T0 - 1_591_000,
    endedAt: Date.now() - 4000,
    agents: [
      agent('main', 'main', 'Rewrote cursor pagination', 'done', 'done', 164_000, 1591, 4),
      agent('b2', 'sub', '142 tests green', 'shell', 'done', 46_200, 950, 40)
    ]
  });

const solo = () =>
  session({
    id: 'demo-4',
    title: 'Token migration',
    project: 'notes-api',
    cwd: '/Users/demo/work/notes-api',
    branch: 'main',
    status: 'working',
    tokens: 9_700,
    startedAt: T0 - 48_000,
    tool: 'Bash',
    agents: [agent('main', 'main', 'Migrating tokens to inline styles', 'shell', 'working', 9_700, 48)]
  });

/** Each stage holds for its own number of seconds, then the reel advances. */
const REEL: { hold: number; sessions: () => Session[] }[] = [
  { hold: 14, sessions: () => [claudeLight()] },
  { hold: 10, sessions: () => [solo()] },
  { hold: 12, sessions: () => [archive()] },
  { hold: 14, sessions: () => [archive(), claudeLight(), notes()] },
  { hold: 10, sessions: () => [notes()] },
  { hold: 8, sessions: () => [] }
];

const RANK: Record<Status, number> = { asking: 0, working: 1, failed: 2, done: 3, idle: 4 };

export class DemoStore extends EventEmitter {
  private at = 0;
  private timer: NodeJS.Timeout | null = null;
  private notchW = config().notchW;
  private notchH = config().notchH;
  private last: Snapshot | null = null;

  setNotch(w: number, h: number): void {
    this.notchW = Math.round(w);
    this.notchH = Math.round(h);
    this.publish();
  }

  start(): void {
    this.schedule();
    this.publish();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.at = (this.at + 1) % REEL.length;
      this.publish();
      this.schedule();
    }, REEL[this.at].hold * 1000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  snapshot(): Snapshot {
    const cfg = config();
    const now = Date.now();
    const sessions = REEL[this.at].sessions().sort((a, b) => RANK[a.status] - RANK[b.status]);
    return {
      sessions,
      overall: sessions.length ? sessions[0].status : 'idle',
      tokens: sessions.reduce((n, s) => n + s.tokens, 0),
      elapsed: sessions.reduce((m, s) => Math.max(m, (s.endedAt ?? now) - s.startedAt), 0),
      dormant: sessions.length === 0,
      notchW: this.notchW,
      notchH: this.notchH,
      hoverDelay: cfg.hoverDelay,
      pulse: cfg.pulse,
      now
    };
  }

  publish(): void {
    this.last = this.snapshot();
    this.emit('snapshot', this.last);
  }

  current(): Snapshot {
    return this.last ?? (this.last = this.snapshot());
  }

  /** The demo has nothing to answer, but the island still calls these. */
  gateFor(): string | null {
    return null;
  }

  dismiss(_sessionId: string): void {
    /* the reel moves on by itself */
  }
}
