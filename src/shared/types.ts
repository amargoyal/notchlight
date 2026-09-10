import type { CompanionBridge } from './companion';
/**
 * The contract between the daemon and the island.
 *
 * One snapshot object crosses the bridge on every change. It is small enough
 * that diffing it would cost more than sending it, and a whole-state message
 * means the island can never drift out of sync with the daemon.
 */

/**
 * What the light says. Three colours carry the whole product:
 *
 *   green  — working, leave it alone
 *   yellow — it wants something from you
 *   red    — finished with what it was doing
 *
 * `idle` is a session that exists but has nothing to report (started, never
 * prompted) and `failed` is a red with a different face, not a fourth colour.
 */
export type AgentProvider = 'claude' | 'codex';
export type AgentFilter = 'all' | AgentProvider;
export type ApprovalDecision = 'allow' | 'deny' | 'defer';

export type Status = 'working' | 'asking' | 'done' | 'failed' | 'idle' | 'interrupted' | 'unknown';

/** The little mark beside a row that says what kind of work is happening. */
export type Activity = 'code' | 'shell' | 'search' | 'read' | 'web' | 'think' | 'ask' | 'done' | 'agent' | 'idle';

/** Buddy faces, keyed the way the design sheet names them. */
export type Face = 'working' | 'thinking' | 'asking' | 'done' | 'failed' | 'idle' | 'approved';

export interface Agent {
  tokensKnown?: boolean;
  /** `main` for the session's own thread, otherwise the Task tool_use id. */
  id: string;
  kind: 'main' | 'sub';
  /** What it is doing, in words: "Editing Buddy.dc.html". */
  title: string;
  activity: Activity;
  status: Status;
  /** Subagent type when Claude named one, e.g. `Explore`. */
  agentType?: string;
  tokens: number;
  startedAt: number;
  /** Absent while it is still running. */
  endedAt?: number;
}

/** A permission request the island is showing, and may be able to answer. */
export interface Ask {
  id: string;
  /** Tool name, e.g. `Bash`. */
  tool: string;
  /** One line of what it wants to do — the command, the path. */
  command: string;
  /** Claude Code's own wording, when a Notification carried one. */
  message: string;
  at: number;
  /**
   * The daemon is holding the tool call open and a decision here is real.
   * False means the prompt is sitting in the terminal and this is a readout.
   */
  answerable: boolean;
}

export interface Session {
  /** Brief expression feedback, independent of task status. */
  approvedAt?: number;
  provider?: AgentProvider;
  source?: 'desktop' | 'cli' | 'unknown';
  originalId?: string;
  parentSessionId?: string;
  tokensKnown?: boolean;
  id: string;
  /** Claude Code's own title for the conversation when it has written one. */
  title: string;
  /** Directory basename — what the row is called. */
  project: string;
  cwd: string;
  branch?: string;
  status: Status;
  /** Input + output + cache-creation tokens. Cache reads are excluded. */
  tokens: number;
  startedAt: number;
  /** Last time anything happened, for staleness. */
  lastAt: number;
  /** Wall-clock the session has been alive, frozen once it finishes. */
  endedAt?: number;
  agents: Agent[];
  ask: Ask | null;
  /** Last few lines of tool output, for the single-agent view. */
  tail: string[];
  /** The tool the session is inside right now, if any. */
  tool?: string;
  /** Short terminal error text when a provider reported the turn as failed. */
  failure?: string;
}

export interface Snapshot {
  tokensKnown?: boolean;
  codex?: { state: 'disabled' | 'ready' | 'missing' | 'unsupported'; message: string; hooksSeen: boolean };
  /** Claude Code connection: whether its hooks are installed and the socket is up. */
  claude?: { state: 'ready' | 'no-hooks' | 'demo'; message: string };
  sessions: Session[];
  /** Worst-first: asking, then working, then done. */
  overall: Status;
  /** Total across live sessions. */
  tokens: number;
  /** Longest running session's elapsed ms. */
  elapsed: number;
  /** Nothing to show — the island renders as nothing but a hover target. */
  dormant: boolean;
  /** Measured cutout width in points; the island keeps this space clear. */
  notchW: number;
  /** Measured cutout height — the island's collapsed bar matches it. */
  notchH: number;
  /** ms of dwell before a hover opens the island. */
  hoverDelay: number;
  /** Whether the status light breathes while working. */
  pulse: boolean;
  /** Server clock, so the island's timers do not drift from the daemon's. */
  now: number;
}

/** Where the island actually is on screen, so the daemon can aim the cursor test. */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IslandBridge extends CompanionBridge {
  getSnapshot(): Promise<Snapshot>;
  /** Open the separate sample-data customization window. */
  openCustomize(): void;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  /** Report the island's own on-screen box after every layout change. */
  setHitRect(r: HitRect): void;
  /** Cursor entered or left the island's box, decided by the daemon. */
  onHover(cb: (inside: boolean) => void): () => void;
  /** The hover dwell was satisfied — unfold. */
  onOpen(cb: (open: boolean) => void): () => void;
  /** Answer a held permission request. */
  decide(sessionId: string, askId: string, decision: ApprovalDecision): Promise<import('./companion').OperationResult>;
  /** Drop a finished session's red light. */
  dismiss(sessionId: string): void;
}

declare global {
  interface Window {
    notchlight: IslandBridge;
  }
}
