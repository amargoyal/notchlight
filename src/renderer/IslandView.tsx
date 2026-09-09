/**
 * Every face of the island, in one component.
 *
 * The rules it encodes, in the order they matter:
 *
 *   nothing running        → invisible, but the notch is still a hover target
 *   cursor on the notch    → two hairline stubs, meaning "keep going"
 *   held past the dwell    → unfold
 *   one session            → its agents are the front page; no drilling
 *   several sessions       → a list, and you click into one
 *
 * The status light is always on the left wing and the buddy is always on the
 * right, at every size, in every state. That is the whole visual contract: the
 * lens in the middle never has anything behind it.
 *
 * Collapsed, the bar carries a light, a mark and a buddy and nothing else. It
 * is on screen the whole time a session runs, so every character it holds is a
 * character you did not ask to read; the numbers live one hover away instead.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Buddy, BuddyStack, faceFor } from './Buddy';
import { Mark } from './marks';
import { C, MONO, PANEL_W, SANS, glow, lightColor } from './theme';
import { duration, tokens as fmtTokens } from '../shared/fmt';
import type { Activity, Agent, Face, HitRect, Session, Snapshot, Status } from '../shared/types';

const STUB_W = 26;

export interface IslandProps {
  snap: Snapshot;
  /** Optional presentation supplied only by the multipurpose design preview. */
  surface?: { navigation: ReactNode; expanded?: ReactNode; collapsed?: ReactNode; active: boolean; panel?: { id: string; 'aria-labelledby': string } };
  /** The cursor is on the island right now. */
  hovering: boolean;
  /** The dwell has been satisfied. */
  open: boolean;
  onDecide?: (sessionId: string, askId: string, decision: 'allow' | 'deny') => void;
  onDismiss?: (sessionId: string) => void;
  /** The island measured itself. The daemon aims the cursor test with this. */
  onBox?: (r: HitRect) => void;
}

/* ------------------------------------------------------------------ atoms */

function Light({ status, size = 9, pulse = false }: { status: Status; size?: number; pulse?: boolean }) {
  const color = lightColor(status);
  const dead = status === 'idle';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        background: dead ? 'transparent' : color,
        boxShadow: dead ? `inset 0 0 0 1.5px ${C.dead}` : glow(color, 0.9),
        animation: pulse && status === 'working' ? 'cl-pulse 1.7s ease-in-out infinite' : undefined
      }}
    />
  );
}

function Mono({
  children,
  color = C.text,
  size = 11,
  weight = 500
}: {
  children: ReactNode;
  color?: string;
  size?: number;
  weight?: number;
}) {
  return <div style={{ font: `${weight} ${size}px/1 ${MONO}`, color, whiteSpace: 'nowrap' }}>{children}</div>;
}

const CLIP: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/**
 * The three-column spine.
 *
 * The side tracks are `1fr`, and inside a `max-content` container that makes
 * both of them as wide as the wider one — so the middle track lands dead centre
 * of the island no matter what the two wings are holding. Getting this wrong by
 * four pixels is exactly how text ends up under the camera.
 */
export function Wings({
  notchW,
  height,
  left,
  right,
  width
}: {
  notchW: number;
  height: number;
  left: ReactNode;
  right: ReactNode;
  width?: number;
}) {
  // On the collapsed bar the tracks are exactly as wide as their contents, so
  // the wings sit against the cutout and the bar stays tight around it. In the
  // fixed-width panel the tracks are far wider than what is in them, and the
  // same alignment would strand the lights and the buddy in the middle of a
  // header with empty margins either side — so there, content goes outward.
  const outward = width !== undefined;
  // Collapsed, the tracks are sized to what they hold rather than to each
  // other: a lone light does not get padded out to the width of the mark and
  // the buddy. The wings then differ, so the notch column is no longer the
  // middle of the bar — the root re-centres the whole shell on it instead.
  const side = outward ? '1fr' : 'auto';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${side} ${notchW}px ${side}`,
        alignItems: 'center',
        height,
        width: width ?? 'max-content'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: outward ? 'flex-start' : 'flex-end' }}>
        {left}
      </div>
      <div data-cl-notch />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: outward ? 'flex-end' : 'flex-start' }}>
        {right}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: C.hair, margin: '0 14px' }} />;
}

function elapsedOf(s: Session, now: number): string {
  return duration((s.endedAt ?? now) - s.startedAt);
}

/**
 * The main thread's row. The store always puts one first, but the island is an
 * overlay with no error boundary and no devtools you can reach — a single
 * undefined here would blank it silently, so it never returns one.
 */
function mainAgent(s: Session): Agent {
  return (
    s.agents.find((a) => a.kind === 'main') ??
    s.agents[0] ?? {
      id: 'main',
      kind: 'main',
      title: s.title || s.project,
      activity: 'think',
      status: s.status,
      tokens: s.tokens,
      startedAt: s.startedAt
    }
  );
}

function faceOf(s: Session): Face {
  const m = mainAgent(s);
  return faceFor(s.status, !!m && m.activity !== 'think');
}

/** `~/dev/thing`. The renderer has no `process`, so the tilde is done by hand. */
function tilde(p: string): string {
  const m = /^\/Users\/[^/]+/.exec(p);
  return m ? '~' + p.slice(m[0].length) : p;
}

/* ------------------------------------------------------------- collapsed */

/** The mark the wing shows for a session: the question and the tick outrank the work. */
function markOf(s: Session): Activity {
  if (s.status === 'asking') return 'ask';
  if (s.status === 'done' || s.status === 'failed') return 'done';
  return mainAgent(s).activity;
}

/**
 * What Claude puts on the resting bar: lights on the left, marks and buddies on
 * the right. Exposed bare, without wing padding, so the companion surface can
 * set it beside the music and tray pieces on one bar.
 */
export function restingClaude(sessions: Session[], snap: Snapshot): { left: ReactNode; right: ReactNode } | null {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) {
    const s = sessions[0];
    return {
      left: <Light status={s.status} pulse={snap.pulse} />,
      right: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mark activity={markOf(s)} color={s.status === 'asking' ? C.yellow : C.dim} />
          <Buddy face={faceOf(s)} size={24} />
        </div>
      )
    };
  }
  return {
    left: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {sessions.slice(0, 4).map((s, i) => (
            <Light key={s.id} status={s.status} pulse={snap.pulse && i === 0} />
          ))}
        </div>
        <Mono>{sessions.length}</Mono>
      </div>
    ),
    right: <BuddyStack faces={sessions.map(faceOf)} size={22} />
  };
}

function CollapsedOne({ s, snap }: { s: Session; snap: Snapshot }) {
  const parts = restingClaude([s], snap)!;
  return (
    <Wings
      notchW={snap.notchW}
      height={snap.notchH}
      left={<div style={{ display: 'flex', alignItems: 'center', padding: '0 12px' }}>{parts.left}</div>}
      right={<div style={{ display: 'flex', alignItems: 'center', padding: '0 12px' }}>{parts.right}</div>}
    />
  );
}

function CollapsedMany({ sessions, snap }: { sessions: Session[]; snap: Snapshot }) {
  const parts = restingClaude(sessions, snap)!;
  return (
    <Wings
      notchW={snap.notchW}
      height={snap.notchH}
      left={<div style={{ display: 'flex', alignItems: 'center', padding: '0 13px' }}>{parts.left}</div>}
      right={<div style={{ display: 'flex', alignItems: 'center', padding: '0 12px 0 8px' }}>{parts.right}</div>}
    />
  );
}

/** Cursor on the notch, dwell not yet met: two hairlines, no commitment. */
export function Stubs({ snap }: { snap: Snapshot }) {
  const stub = (
    <div style={{ width: STUB_W, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 14, height: 2, borderRadius: 1, background: 'rgba(255,255,255,.3)' }} />
    </div>
  );
  return <Wings notchW={snap.notchW} height={snap.notchH} left={stub} right={stub} />;
}

/** Held open with nothing running. Dead light, sleeping buddy. */
function IdleFace({ snap }: { snap: Snapshot }) {
  return (
    <Wings
      notchW={snap.notchW}
      height={snap.notchH}
      left={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 13px' }}>
          <Light status="idle" size={8} />
          <Mono color={C.ghost}>idle</Mono>
        </div>
      }
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px' }}>
          <Mark activity="idle" color={C.faint} />
          <Buddy face="idle" size={24} />
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------ panel */

function PanelHeader({ snap, left, right }: { snap: Snapshot; left: ReactNode; right: ReactNode }) {
  return <Wings notchW={snap.notchW} height={snap.notchH} width={PANEL_W} left={left} right={right} />;
}

function SessionMeta({ s, now }: { s: Session; now: number }) {
  const live = s.agents.filter((a) => !a.endedAt).length;
  const n = s.agents.length;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: '12px 16px 8px',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
        <div style={{ font: `500 13px/1 ${SANS}`, color: C.text, whiteSpace: 'nowrap' }}>{s.project}</div>
        <div style={{ font: `400 11px/1 ${MONO}`, color: C.faint, ...CLIP }}>
          {tilde(s.cwd)}
          {s.branch ? ' · ' + s.branch : ''}
        </div>
      </div>
      <Mono color={C.faint} weight={400}>
        {n} agent{n === 1 ? '' : 's'}
        {live > 0 && live !== n ? ` · ${live} live` : ''} · {elapsedOf(s, now)}
      </Mono>
    </div>
  );
}

function AgentRow({ a, now, highlight }: { a: Agent; now: number; highlight?: boolean }) {
  const finished = !!a.endedAt;
  const asking = a.status === 'asking';
  return (
    <div
      className="cl-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 8,
        background: highlight ? 'rgba(255,255,255,.04)' : undefined
      }}
    >
      <Light status={a.status} size={6} />
      <Buddy face={faceFor(a.status, a.activity !== 'think')} size={22} />
      <Mark activity={a.activity} color={asking ? C.yellow : C.faint} />
      <div
        title={a.title}
        style={{
          flex: 1,
          minWidth: 0,
          font: `400 12.5px/1.3 ${SANS}`,
          color: asking ? C.yellow : finished ? C.dim : C.body,
          ...CLIP
        }}
      >
        {a.title}
      </div>
      <div style={{ font: `500 11px/1 ${MONO}`, color: finished ? C.ghost : C.muted, width: 46, textAlign: 'right' }}>
        {fmtTokens(a.tokens)}
      </div>
      <div style={{ font: `400 11px/1 ${MONO}`, color: C.faint, width: 52, textAlign: 'right' }}>
        {duration((a.endedAt ?? now) - a.startedAt)}
      </div>
    </div>
  );
}

/** Roughly what one agent row costs, and what the panel spends before them. */
const ROW_H = 40;
const PANEL_CHROME_H = 120;

/**
 * How many rows fit.
 *
 * The overlay window has a fixed height and clips whatever runs past it, so a
 * session with a dozen agents would quietly lose its last rows off the bottom
 * of the screen — and the island would go on claiming that taller box as its
 * hover region, leaving a strip of dead cursor below the visible panel.
 */
function rowBudget(): number {
  const h = typeof window === 'undefined' ? 560 : window.innerHeight;
  return Math.max(3, Math.floor((h - PANEL_CHROME_H) / ROW_H));
}

function AgentList({ s, now }: { s: Session; now: number }) {
  const budget = rowBudget();
  const shown = s.agents.length > budget ? s.agents.slice(0, budget - 1) : s.agents;
  const hidden = s.agents.length - shown.length;
  return (
    <div style={{ padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {shown.map((a, i) => (
        <AgentRow key={a.id} a={a} now={now} highlight={i === 0 && a.status === 'working'} />
      ))}
      {hidden > 0 && (
        <div style={{ padding: '6px 8px 2px', font: `400 11px/1 ${MONO}`, color: C.faint }}>
          +{hidden} more agent{hidden === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

function AskCard({
  s,
  onDecide
}: {
  s: Session;
  onDecide?: (sessionId: string, askId: string, decision: 'allow' | 'deny') => void;
}) {
  const ask = s.ask;
  if (!ask) return null;
  return (
    <div
      style={{
        margin: '0 12px 12px',
        padding: '13px 14px',
        background: 'rgba(224,176,74,.09)',
        borderRadius: 14,
        boxShadow: 'inset 0 0 0 1px rgba(224,176,74,.22)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Buddy face="asking" size={22} />
        <div style={{ flex: 1, minWidth: 0, font: `500 12.5px/1.3 ${SANS}`, color: C.text }}>{ask.message}</div>
        <Mono color={C.faint} weight={400}>
          {fmtTokens(s.tokens)}
        </Mono>
      </div>
      {ask.command && (
        <div
          style={{
            margin: '11px 0 12px',
            padding: '9px 11px',
            background: C.well,
            borderRadius: 9,
            font: `400 11.5px/1.45 ${MONO}`,
            color: '#C8BFB6',
            wordBreak: 'break-all'
          }}
        >
          {ask.command}
        </div>
      )}
      {ask.answerable ? (
        <div style={{ display: 'flex', gap: 8, marginTop: ask.command ? 0 : 12 }}>
          <div
            className="cl-btn"
            onClick={() => onDecide?.(s.id, ask.id, 'allow')}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px 0',
              borderRadius: 9,
              background: C.yellow,
              font: `600 12px/1 ${SANS}`,
              color: '#1A1408'
            }}
          >
            Allow once
          </div>
          <div
            className="cl-btn"
            onClick={() => onDecide?.(s.id, ask.id, 'deny')}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px 0',
              borderRadius: 9,
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)',
              font: `600 12px/1 ${SANS}`,
              color: '#D8D0C8'
            }}
          >
            Deny
          </div>
        </div>
      ) : (
        // Claude Code is asking in the terminal and this is only a readout of
        // it. Buttons that did nothing would be worse than no buttons.
        <div style={{ marginTop: ask.command ? 2 : 11, font: `400 11px/1.4 ${MONO}`, color: C.faint }}>
          waiting for your answer in the terminal
        </div>
      )}
    </div>
  );
}

function SessionRow({ s, now, onOpen }: { s: Session; now: number; onOpen: () => void }) {
  const m = mainAgent(s);
  const live = s.agents.filter((a) => !a.endedAt).length;
  const finished = s.status === 'done' || s.status === 'failed';
  const sub =
    s.status === 'asking'
      ? (s.ask?.message ?? 'waiting on you')
      : finished
        ? `done · ${s.agents.length} agent${s.agents.length === 1 ? '' : 's'} finished`
        : `${live} agent${live === 1 ? '' : 's'} · ${m.title}`;
  return (
    <div
      className="cl-row cl-click"
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 8px' }}
    >
      <Light status={s.status} size={7} />
      <Buddy face={faceOf(s)} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `500 13px/1.25 ${SANS}`, color: C.text, ...CLIP }}>{s.project}</div>
        <div
          style={{
            font: `400 11px/1.35 ${MONO}`,
            color: s.status === 'asking' ? C.yellow : C.ghost,
            marginTop: 2,
            ...CLIP
          }}
        >
          {sub}
        </div>
      </div>
      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div style={{ font: `500 11px/1.35 ${MONO}`, color: C.muted }}>{fmtTokens(s.tokens)}</div>
        <div style={{ font: `400 11px/1.35 ${MONO}`, color: C.faint, marginTop: 2 }}>{elapsedOf(s, now)}</div>
      </div>
      <div style={{ font: `400 14px/1 ${MONO}`, color: C.faint, flex: 'none', width: 9 }}>›</div>
    </div>
  );
}

function SessionList({
  sessions,
  snap,
  now,
  onOpen,
  navigation,
  panel
}: {
  panel?: { id: string; 'aria-labelledby': string };
  navigation?: ReactNode;
  sessions: Session[];
  snap: Snapshot;
  now: number;
  onOpen: (id: string) => void;
}) {
  return (
    <div style={{ width: PANEL_W }}>
      <PanelHeader
        snap={snap}
        left={
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 15 }}>
            {sessions.slice(0, 4).map((s, i) => (
              <Light key={s.id} status={s.status} size={8} pulse={snap.pulse && i === 0} />
            ))}
          </div>
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 14 }}>
            <Mono color={C.dim} size={10}>
              {fmtTokens(snap.tokens)} · {duration(snap.elapsed)}
            </Mono>
          </div>
        }
      />
      {navigation}
      <PanelBody panel={panel}>
      <Divider />
      <div style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sessions.slice(0, rowBudget()).map((s) => (
          <SessionRow key={s.id} s={s} now={now} onOpen={() => onOpen(s.id)} />
        ))}
      </div>
      </PanelBody>
    </div>
  );
}

function SessionPanel({
  s,
  snap,
  now,
  onBack,
  onDecide,
  onDismiss,
  navigation,
  panel
}: {
  panel?: { id: string; 'aria-labelledby': string };
  navigation?: ReactNode;
  s: Session;
  snap: Snapshot;
  now: number;
  onBack?: () => void;
  onDecide?: (sessionId: string, askId: string, decision: 'allow' | 'deny') => void;
  onDismiss?: (sessionId: string) => void;
}) {
  const finished = s.status === 'done' || s.status === 'failed';
  return (
    <div style={{ width: PANEL_W }}>
      <PanelHeader
        snap={snap}
        left={
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 14 }}>
            {onBack && (
              <div className="cl-back" onClick={onBack} style={{ font: `400 15px/1 ${MONO}`, color: C.faint }}>
                ‹
              </div>
            )}
            <div
              onClick={finished ? () => onDismiss?.(s.id) : undefined}
              title={finished ? 'Dismiss' : undefined}
              style={{ display: 'flex', alignItems: 'center', cursor: finished ? 'pointer' : 'default' }}
            >
              <Light status={s.status} pulse={snap.pulse} />
            </div>
          </div>
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 13 }}>
            <Mark activity={markOf(s)} color={s.status === 'asking' ? C.yellow : C.dim} />
            <Buddy face={faceOf(s)} size={26} />
          </div>
        }
      />
      {navigation}
      <PanelBody panel={panel}>
      <Divider />
      <SessionMeta s={s} now={now} />
      {s.ask ? <AskCard s={s} onDecide={onDecide} /> : <AgentList s={s} now={now} />}
      </PanelBody>
    </div>
  );
}

function PanelBody({ panel, children }: { panel?: { id: string; 'aria-labelledby': string }; children: ReactNode }) {
  return panel ? <div role="tabpanel" {...panel}>{children}</div> : <>{children}</>;
}

/* ------------------------------------------------------------------- root */

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function Island({ snap, hovering, open, onDecide, onDismiss, onBox, surface }: IslandProps) {
  const [drill, setDrill] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, dx: 0 });
  const now = useNow(!snap.dormant || open);

  // Closing forgets where you were. Re-opening onto a session you drilled into
  // ten minutes ago — which may since have ended — is never what you meant.
  useEffect(() => {
    if (!open) setDrill(null);
  }, [open]);

  // A session that disappears while you are inside it drops you back to the list.
  useEffect(() => {
    if (drill && !snap.sessions.some((s) => s.id === drill)) setDrill(null);
  }, [snap, drill]);

  // Measured on every render, and again whenever the content resizes on its own
  // — a font landing, a title arriving. The observer is made once; only the
  // measurement repeats.
  const sent = useRef<HitRect | null>(null);
  const measure = useRef(() => {});
  measure.current = () => {
    const el = contentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.ceil(r.width);
    const h = Math.ceil(r.height);
    // The shell is centred on the display, and the cutout is too — but with
    // wings of different widths the notch column is off the bar's own centre.
    // Sliding the shell back by that difference puts the empty column over the
    // camera again, which is the only alignment that matters.
    const notch = el.querySelector('[data-cl-notch]');
    const nr = notch?.getBoundingClientRect();
    const dx = nr ? Math.round(r.left + w / 2 - (nr.left + nr.width / 2)) : 0;
    setBox((prev) => (prev.w === w && prev.h === h && prev.dx === dx ? prev : { w, h, dx }));
    // The hit region is the island's *target* size, reported before the shell
    // has finished animating into it. Generous-early is the right way round: it
    // stops a panel that is still growing from collapsing out from under the
    // cursor that opened it.
    const next: HitRect = {
      x: Math.round((window.innerWidth - w) / 2) + dx - 4,
      y: 0,
      w: w + 8,
      // Anything past the window's edge is clipped and invisible; claiming it
      // would make a band of empty screen swallow the cursor.
      h: Math.min(h + 4, window.innerHeight)
    };
    const last = sent.current;
    if (last && last.x === next.x && last.w === next.w && last.h === next.h) return;
    sent.current = next;
    onBox?.(next);
  };

  useLayoutEffect(() => {
    measure.current();
  });

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sessions = snap.sessions;
  const single = sessions.length === 1 ? sessions[0] : null;
  const drilled = drill ? (sessions.find((s) => s.id === drill) ?? null) : null;
  const radius = open ? 26 : 15;
  /** Only the unfolded faces cross-fade; the collapsed bar just morphs. */
  const animate = open && !snap.dormant;

  let content: ReactNode;
  let key: string;

  if (open) {
    if (snap.dormant) {
      content = surface ? <div style={{ width: PANEL_W }}><div style={{ display: 'flex', justifyContent: 'center' }}><IdleFace snap={snap} /></div>{surface.navigation}<div role="tabpanel" {...surface.panel} className="mp-empty"><p>All quiet here.</p><span>Your Claude sessions will appear when work begins.</span></div></div> : <IdleFace snap={snap} />;
      key = 'idle';
    } else if (single) {
      content = <SessionPanel s={single} snap={snap} now={now} onDecide={onDecide} onDismiss={onDismiss} navigation={surface?.navigation} panel={surface?.panel} />;
      key = 'single-' + single.id;
    } else if (drilled) {
      content = (
        <SessionPanel
          s={drilled}
          snap={snap}
          now={now}
          navigation={surface?.navigation} panel={surface?.panel}
          onBack={() => setDrill(null)}
          onDecide={onDecide}
          onDismiss={onDismiss}
        />
      );
      key = 'drill-' + drilled.id;
    } else {
      content = <SessionList sessions={sessions} snap={snap} now={now} onOpen={setDrill} navigation={surface?.navigation} panel={surface?.panel} />;
      key = 'list';
    }
  } else if (single) {
    content = <CollapsedOne s={single} snap={snap} />;
    key = 'collapsed';
  } else if (sessions.length > 1) {
    content = <CollapsedMany sessions={sessions} snap={snap} />;
    key = 'collapsed';
  } else if (hovering) {
    content = <Stubs snap={snap} />;
    key = 'stubs';
  } else {
    // Invisible, but exactly the size of the cutout, so the cursor has
    // something to find.
    content = <div style={{ width: snap.notchW, height: snap.notchH }} />;
    key = 'void';
  }

  if (surface?.expanded !== undefined && open) {
    content = surface.expanded;
    key = 'surface';
  } else if (surface?.collapsed !== undefined && !open) {
    content = surface.collapsed;
    key = 'surface-collapsed';
  }

  const invisible = !surface?.active && snap.dormant && !open && !hovering;

  return (
    <div className="cl-stage">
      <div className="cl-anchor">
        <div
          className="cl-body"
          style={{
            width: box.w || snap.notchW,
            height: box.h || snap.notchH,
            transform: `translateX(${box.dx}px)`,
            borderRadius: `0 0 ${radius}px ${radius}px`,
            background: invisible ? 'transparent' : C.ink,
            boxShadow: invisible
              ? 'none'
              : open
                ? '0 26px 52px -18px rgba(0,0,0,.85)'
                : '0 14px 30px -12px rgba(0,0,0,.8)'
          }}
        >
          <div ref={contentRef} className="cl-content">
            <div key={key} className={animate ? 'cl-fade' : undefined}>
              {content}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
