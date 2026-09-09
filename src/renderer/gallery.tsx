/**
 * Every face, on one page.
 *
 * The island is a thing you almost never see twice in the same state, which
 * makes it very hard to design and very easy to break: a row that overflows at
 * four agents, a wing that pushes text under the lens when the token count hits
 * six characters. This page renders the real component — not a picture of it —
 * against fixed data, so all of that shows up at once.
 *
 * It is also the live view: the last card follows whatever the daemon is
 * actually reporting right now.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './island.css';
import { Buddy } from './Buddy';
import { PreviewGallery } from './Preview';
import { Island } from './IslandView';
import { Mark } from './marks';
import { C, MONO, SANS } from './theme';
import type { Activity, Agent, Face, Session, Snapshot, Status } from '../shared/types';

const NOW = Date.now();

const BASE: Snapshot = {
  sessions: [],
  overall: 'idle',
  tokens: 0,
  elapsed: 0,
  dormant: true,
  notchW: 190,
  notchH: 34,
  hoverDelay: 550,
  pulse: true,
  now: NOW
};

function agent(
  id: string,
  kind: 'main' | 'sub',
  title: string,
  activity: Activity,
  status: Status,
  tok: number,
  ageSec: number,
  endedSec?: number
): Agent {
  return {
    id,
    kind,
    title,
    activity,
    status,
    tokens: tok,
    startedAt: NOW - ageSec * 1000,
    endedAt: endedSec === undefined ? undefined : NOW - endedSec * 1000
  };
}

function session(over: Partial<Session> & { id: string }): Session {
  return {
    title: '',
    project: 'demo',
    cwd: '/Users/you/dev/demo',
    branch: 'main',
    status: 'working',
    tokens: 0,
    startedAt: NOW - 60_000,
    lastAt: NOW,
    agents: [],
    ask: null,
    tail: [],
    ...over
  };
}

function snap(sessions: Session[], over: Partial<Snapshot> = {}): Snapshot {
  return {
    ...BASE,
    sessions,
    dormant: sessions.length === 0,
    overall: sessions.length ? sessions[0].status : 'idle',
    tokens: sessions.reduce((n, s) => n + s.tokens, 0),
    elapsed: sessions.reduce((m, s) => Math.max(m, (s.endedAt ?? NOW) - s.startedAt), 0),
    ...over
  };
}

/* ------------------------------------------------------------- fixtures */

const working = session({
  id: 'f1',
  project: 'claude-light',
  cwd: '/Users/you/dev/claude-light',
  branch: 'main',
  status: 'working',
  tokens: 61_300,
  startedAt: NOW - 252_000,
  tool: 'Edit',
  agents: [
    agent('main', 'main', 'Editing Buddy.tsx', 'code', 'working', 24_100, 124),
    agent('a2', 'sub', 'Running test suite', 'shell', 'working', 12_900, 63),
    agent('a3', 'sub', 'Searching hover-intent patterns', 'search', 'working', 8_400, 41),
    agent('a4', 'sub', 'Wrote island geometry spec', 'done', 'done', 15_900, 202, 20)
  ]
});

const asking = session({
  id: 'f2',
  project: 'sill-archive',
  cwd: '/Users/you/dev/sill',
  branch: 'archive',
  status: 'asking',
  tokens: 18_700,
  startedAt: NOW - 725_000,
  agents: [agent('main', 'main', 'Wants to run a destructive command', 'ask', 'asking', 18_700, 725)],
  ask: {
    id: 'ask-1',
    tool: 'Bash',
    command: 'rm -rf ./build/cache',
    message: 'Wants to run a destructive command',
    at: NOW,
    answerable: true
  }
});

const askingTerminal = session({
  ...asking,
  id: 'f2b',
  ask: { ...asking.ask!, id: 'ask-2', command: '', message: 'Claude needs your permission to use Write', answerable: false }
});

const done = session({
  id: 'f3',
  project: 'notes-api',
  cwd: '/Users/you/work/notes-api',
  branch: 'fix/pagination',
  status: 'done',
  tokens: 210_000,
  startedAt: NOW - 1_591_000,
  endedAt: NOW - 4_000,
  agents: [
    agent('main', 'main', 'Rewrote cursor pagination', 'done', 'done', 164_000, 1591, 4),
    agent('b2', 'sub', '142 tests green', 'shell', 'done', 46_200, 950, 40)
  ]
});

const solo = session({
  id: 'f4',
  project: 'notes-api',
  cwd: '/Users/you/work/notes-api',
  status: 'working',
  tokens: 9_700,
  startedAt: NOW - 48_000,
  tool: 'Bash',
  agents: [agent('main', 'main', 'Migrating tokens to inline styles', 'shell', 'working', 9_700, 48)]
});

/* ------------------------------------------------------------------- page */

function Screen({
  w,
  h,
  children
}: {
  w: number;
  h: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        background: '#2E4657',
        borderRadius: 12,
        position: 'relative',
        overflow: 'hidden',
        flex: 'none'
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '54%', background: '#5C6B4A' }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 22, background: 'rgba(0,0,0,.22)' }} />
      {/* The hardware cutout, drawn so the "invisible" states read as invisible
          rather than as a card that failed to render. The island sits on top of
          it in the same black. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: BASE.notchW,
          height: BASE.notchH,
          background: '#000',
          borderRadius: '0 0 12px 12px'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 14,
          display: 'flex',
          gap: 14,
          font: `400 10px/1 ${MONO}`,
          color: 'rgba(255,255,255,.72)'
        }}
      >
        <div>100%</div>
        <div>Tue 9:41</div>
      </div>
      {children}
    </div>
  );
}

function Card({
  title,
  note,
  w = 436,
  h = 176,
  children
}: {
  title: string;
  note: string;
  w?: number;
  h?: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <Screen w={w} h={h}>
        {children}
      </Screen>
      <div style={{ maxWidth: w }}>
        <div style={{ font: `600 12px/1.4 ${SANS}`, color: '#1E1B18' }}>{title}</div>
        <div style={{ font: `400 12px/1.5 ${SANS}`, color: '#6E6660', marginTop: 2 }}>{note}</div>
      </div>
    </div>
  );
}

function Band({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            font: `600 10px/1 ${MONO}`,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: '#8A817A',
            whiteSpace: 'nowrap'
          }}
        >
          {label}
        </div>
        <div style={{ height: 1, flex: 1, background: '#DED6CB' }} />
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

const FACES: { face: Face; label: string; light: string }[] = [
  { face: 'working', label: 'working', light: 'green' },
  { face: 'thinking', label: 'thinking', light: 'green' },
  { face: 'asking', label: 'asking', light: 'yellow' },
  { face: 'done', label: 'done', light: 'red' },
  { face: 'failed', label: 'failed', light: 'red' },
  { face: 'idle', label: 'idle', light: 'no light' },
  { face: 'approved', label: 'approved', light: 'flash green' }
];

const MARKS: { activity: Activity; label: string }[] = [
  { activity: 'code', label: 'writing code' },
  { activity: 'shell', label: 'running a command' },
  { activity: 'search', label: 'searching' },
  { activity: 'read', label: 'reading files' },
  { activity: 'web', label: 'out on the network' },
  { activity: 'agent', label: 'delegating' },
  { activity: 'think', label: 'thinking' },
  { activity: 'ask', label: 'waiting on you' },
  { activity: 'done', label: 'finished' }
];

function Sheet() {
  return (
    <div
      style={{
        width: 1180,
        background: '#26221F',
        borderRadius: 14,
        padding: '26px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 26,
        boxShadow: '0 22px 46px -28px rgba(30,22,16,.5)'
      }}
    >
      <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
        {FACES.map((f) => (
          <div key={f.face} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: 120 }}>
            <Buddy face={f.face} size={44} />
            <div style={{ font: `500 11px/1.3 ${MONO}`, color: C.body }}>{f.label}</div>
            <div style={{ font: `400 10px/1.3 ${MONO}`, color: '#6E6660' }}>{f.light}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 1, background: 'rgba(255,255,255,.09)' }} />
      <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', alignItems: 'center' }}>
        {MARKS.map((m) => (
          <div key={m.activity} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mark activity={m.activity} color="#C8BFB6" />
            <div style={{ font: `400 11.5px/1 ${MONO}`, color: C.muted }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Live() {
  const [live, setLive] = useState<Snapshot | null>(null);
  useEffect(() => {
    return window.claudeLight?.onSnapshot?.(setLive);
  }, []);
  const s = live ?? BASE;
  return (
    <Card
      title="Live"
      note={
        live
          ? s.dormant
            ? 'Connected. Nothing is running right now.'
            : `${s.sessions.length} session${s.sessions.length === 1 ? '' : 's'} · click through it.`
          : 'Waiting for the daemon.'
      }
      w={600}
      h={360}
    >
      <Island snap={s} hovering open />
    </Card>
  );
}

function App() {
  return (
    <div style={{ padding: '52px 64px 110px', font: `400 13px/1.5 ${SANS}`, background: '#EFEBE4', minHeight: '100vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 56, width: 'max-content' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
          <div style={{ font: `600 27px/1 ${SANS}`, color: '#1E1B18', letterSpacing: '-.02em' }}>Claude Light</div>
          <div style={{ font: `400 13.5px/1.55 ${SANS}`, color: '#6E6660', maxWidth: 560 }}>
            Status light on the left wing, buddy on the right, nothing behind the lens. Invisible until something is
            running — or until you hold the cursor on the notch.
          </div>
        </div>

        <PreviewGallery />

        <Band label="Nothing running">
          <Card title="Idle" note="No wings, no light, no buddy. Just the hardware notch.">
            <Island snap={snap([])} hovering={false} open={false} />
          </Card>
          <Card title="Cursor on the notch" note="Hairline stubs peek out either side as a keep-going hint.">
            <Island snap={snap([])} hovering open={false} />
          </Card>
          <Card title="Held open, nothing to report" note="Dead light, sleeping buddy. Collapses the moment you leave.">
            <Island snap={snap([])} hovering open />
          </Card>
        </Band>

        <Band label="Collapsed · the light carries the state">
          <Card title="Green — working" note="A light, the activity mark, the buddy. No numbers — this bar is on screen the whole time.">
            <Island snap={snap([working])} hovering={false} open={false} />
          </Card>
          <Card title="Yellow — needs you" note="Buddy looks up, question mark beside it.">
            <Island snap={snap([asking])} hovering={false} open={false} />
          </Card>
          <Card title="Red — finished" note="Red light, a tick, buddy pleased with itself. Click the light to dismiss it.">
            <Island snap={snap([done])} hovering={false} open={false} />
          </Card>
          <Card title="Three sessions" note="One light each, worst state first. Buddies stack, most active in front.">
            <Island snap={snap([asking, working, done])} hovering={false} open={false} />
          </Card>
        </Band>

        <Band label="One session · agents are the front page">
          <Card
            title="Four agents"
            note="No drilling needed — you land straight on the agents, each with its own light, mark, tokens and clock."
            w={600}
            h={330}
          >
            <Island snap={snap([working])} hovering open />
          </Card>
          <Card
            title="One agent"
            note="The same shape, one row long. Nothing special-cased for the count."
            w={600}
            h={330}
          >
            <Island snap={snap([solo])} hovering open />
          </Card>
        </Band>

        <Band label="Yellow, opened">
          <Card
            title="Answerable"
            note="The daemon is holding the tool call open, so Allow and Deny are real."
            w={600}
            h={300}
          >
            <Island snap={snap([asking])} hovering open />
          </Card>
          <Card
            title="Read-only"
            note="Claude Code is asking in the terminal. The island says so rather than growing buttons that do nothing."
            w={600}
            h={300}
          >
            <Island snap={snap([askingTerminal])} hovering open />
          </Card>
        </Band>

        <Band label="Several sessions · click into one">
          <Card
            title="The list"
            note="Worst first. Click a row to see its agents; the ‹ takes you back."
            w={600}
            h={330}
          >
            <Island snap={snap([asking, working, done])} hovering open />
          </Card>
          <Card title="Finished session" note="Two agents, both done. Clicking the red light dismisses it." w={600} h={300}>
            <Island snap={snap([done])} hovering open />
          </Card>
        </Band>

        <Band label="Buddy faces & activity marks">
          <Sheet />
        </Band>

        <Band label="Right now">
          <Live />
        </Band>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
