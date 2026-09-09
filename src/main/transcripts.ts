/**
 * The read side.
 *
 * Claude Code already writes down everything the island needs. A session is
 *
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl                      the main thread
 *   ~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl one per subagent
 *   ~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.meta.json
 *
 * and the meta file is the join: it carries the `toolUseId` of the Task call
 * that spawned the agent, plus its type and its one-line description. Reading
 * those three things gives the project, the branch, every agent, its tokens and
 * the words for what it is doing right now — without asking Claude for
 * anything, and without a hook being installed at all.
 *
 * Subagents are launched asynchronously: the Task tool returns immediately with
 * "async agent launched", so a tool_result on a Task means *started*, never
 * *finished*. Completion arrives later as a `queue-operation` carrying a
 * `<task-notification>` — that is what closes an agent row out.
 *
 * Every file is read forward from a remembered offset, so the steady state is a
 * few kilobytes of new JSON per tick rather than a re-parse of a transcript
 * that can reach tens of megabytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { PROJECTS_DIR } from './config';
import { ellipsis, tildePath } from './format';
import type { Activity, Agent } from '../shared/types';

/** A file that has never been read gets this much of its tail, at most. */
const FIRST_READ_CAP = 16 * 1024 * 1024;

/**
 * How long a subagent's transcript must go quiet before it counts as finished
 * without a notification to say so.
 *
 * It was 45 seconds, and that was far too eager: an agent writes nothing at all
 * between issuing a tool call and getting its result, so one `npm test` was
 * enough to grey a working agent out. Across the real agent transcripts on this
 * machine, three quarters contain a mid-run gap longer than 45s and the longest
 * runs to nearly an hour.
 */
const AGENT_QUIET_MS = 10 * 60_000;

/** …unless it is stuck inside a tool call, which needs a much longer rope. */
const AGENT_BLOCKED_QUIET_MS = 45 * 60_000;

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface OpenTool {
  name: string;
  input: Record<string, unknown>;
  at: number;
}

/** What one session adds up to. */
export interface SessionFacts {
  sessionId: string;
  file: string;
  cwd: string;
  project: string;
  branch?: string;
  /** Claude Code's own conversation title, when it has written one. */
  title: string;
  startedAt: number;
  /** Newest activity anywhere in the session, subagents included. */
  lastAt: number;
  /**
   * Newest activity on the main thread alone.
   *
   * Kept apart from `lastAt` because the store compares hook timestamps against
   * it: hooks only ever report the main thread, so measuring their freshness
   * against a clock that a background agent keeps pushing forward would declare
   * every hook stale the moment a Task was running.
   */
  mainLastAt: number;
  tokens: number;
  /** The main thread first, then live subagents, then finished ones. */
  agents: Agent[];
  /** The tool the main thread is inside right now. */
  tool?: string;
  /** The main thread has an unanswered tool call open. */
  busy: boolean;
  /** Last lines of tool output, for the one-agent view. */
  tail: string[];
}

const TOOL_ACTIVITY: Record<string, Activity> = {
  Read: 'read',
  NotebookRead: 'read',
  Write: 'code',
  Edit: 'code',
  MultiEdit: 'code',
  NotebookEdit: 'code',
  Bash: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',
  Grep: 'search',
  Glob: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'agent',
  Agent: 'agent',
  SendMessage: 'agent',
  Workflow: 'agent',
  TodoWrite: 'think',
  Skill: 'think',
  ToolSearch: 'search'
};

export function activityFor(tool: string): Activity {
  return TOOL_ACTIVITY[tool] ?? 'code';
}

function short(p: unknown): string {
  const s = String(p ?? '');
  if (!s) return '';
  return path.basename(s) || tildePath(s);
}

/** The sentence a row shows: a verb, and the thing the verb is being done to. */
export function phraseFor(tool: string, input: Record<string, any>): string {
  const i = input || {};
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
      return 'Reading ' + short(i.file_path ?? i.notebook_path);
    case 'Write':
      return 'Writing ' + short(i.file_path);
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'Editing ' + short(i.file_path ?? i.notebook_path);
    case 'Bash':
      return ellipsis(String(i.description || i.command || 'Running a command'), 52);
    case 'BashOutput':
      return 'Watching a command';
    case 'Grep':
      return 'Searching ' + ellipsis(String(i.pattern ?? ''), 34);
    case 'Glob':
      return 'Looking for ' + ellipsis(String(i.pattern ?? ''), 34);
    case 'WebFetch':
      return 'Fetching ' + ellipsis(String(i.url ?? '').replace(/^https?:\/\//, ''), 40);
    case 'WebSearch':
      return 'Searching the web for ' + ellipsis(String(i.query ?? ''), 34);
    case 'Task':
    case 'Agent':
      return 'Delegating ' + ellipsis(String(i.description ?? i.prompt ?? 'a task'), 40);
    case 'SendMessage':
      return 'Messaging an agent';
    case 'TodoWrite':
      return 'Updating the plan';
    case 'Skill':
      return 'Running the ' + String(i.skill ?? '') + ' skill';
    case 'Workflow':
      return 'Orchestrating agents';
    default: {
      const bare = tool.replace(/^mcp__/, '').split('__').pop() || tool;
      for (const k of ['description', 'query', 'pattern', 'path', 'file_path', 'command', 'name']) {
        if (typeof i[k] === 'string' && i[k]) return bare + ' · ' + ellipsis(i[k], 38);
      }
      // A bare tool name reads as a noun sitting on its own in a list of
      // sentences. Every other row here starts with a verb; this one should too.
      return 'Using ' + bare;
    }
  }
}

/**
 * Distinct tokens the session has put through the model: fresh input, output,
 * and cache writes.
 *
 * Cache reads are deliberately not added, and not because they are cheap. Every
 * turn re-reads the same cached prefix, so summing them counts the same tokens
 * again and again — on a five hour conversation that is a quarter of a billion,
 * a number that measures how long the session has been alive rather than how
 * much work it has done. Cache *creation* already counts each new token once,
 * which is the thing being asked about.
 */
function countable(u: Usage | undefined): number {
  if (!u) return 0;
  return (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
}

/** A message's text, whichever of the two shapes its content arrived in. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b: any) => (b && typeof b === 'object' && b.type === 'text' ? String(b.text ?? '') : ''))
    .join('\n');
}

/** The first line with anything on it — prompts often open with a blank one. */
function firstLine(text: string, max: number): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) return ellipsis(t, max);
  }
  return '';
}

/**
 * Tags Claude Code injects into the user turn on the person's behalf.
 *
 * These arrive as ordinary user records, so without this the island would
 * cheerfully render a slash command's stdout, or a raw XML notification, as
 * "what you asked for".
 */
const INJECTED = ['<task-notification>', '<command-name>', '<local-command-stdout>', '<system-reminder>'];

function machineWritten(text: string): boolean {
  const head = text.slice(0, 400);
  return INJECTED.some((tag) => head.includes(tag));
}

function stamp(v: unknown): number {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : 0;
}

/** Up to three lines of a tool result, for the output tail. */
function resultLines(result: unknown): string[] {
  let text = '';
  if (typeof result === 'string') text = result;
  else if (Array.isArray(result)) {
    text = result
      .map((b: any) => (typeof b === 'string' ? b : b?.type === 'text' ? String(b.text ?? '') : ''))
      .join('\n');
  } else if (result && typeof result === 'object') {
    const r = result as any;
    text = String(r.stdout ?? r.stderr ?? r.content ?? '');
  }
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)
    .slice(-3)
    .map((l) => ellipsis(l, 92));
}

/**
 * A JSONL file read forward, once.
 *
 * Subclasses get whole parsed records and keep only what a row needs; the
 * reader itself never holds more than the current chunk, which is what lets a
 * seventy megabyte conversation cost a few kilobytes of memory.
 */
abstract class Reader {
  /** Tokens this file has put through the model. */
  tokens = 0;
  private offset = 0;
  private carry = '';
  private inode = -1;
  private usageId = '';
  private usageAdded = 0;
  /**
   * A transcript is being appended to while it is read, so a chunk can end in
   * the middle of a multi-byte character. Decoding the buffer directly would
   * turn that character into a replacement char, permanently breaking the JSON
   * of one record — and since the offset has already advanced, that record is
   * gone for good. The decoder holds the incomplete bytes instead.
   */
  private decoder = new StringDecoder('utf8');

  constructor(readonly file: string) {}

  protected abstract consume(record: any): void;
  protected abstract onReset(): void;

  /** Read whatever is new. Returns false when nothing changed. */
  poll(): boolean {
    let st: fs.Stats;
    try {
      st = fs.statSync(this.file);
    } catch {
      return false;
    }
    // A rotated file gets a new inode; a truncated one is shorter than where we
    // stopped. Either way the offset means nothing any more.
    if (this.inode !== -1 && (st.ino !== this.inode || st.size < this.offset)) this.reset();
    this.inode = st.ino;
    if (st.size <= this.offset) return false;

    let from = this.offset;
    // A first read of an enormous transcript starts at the tail, and the line
    // it lands in the middle of is half a record, so that one is thrown away.
    const seeking = from === 0 && st.size > FIRST_READ_CAP;
    if (seeking) {
      from = st.size - FIRST_READ_CAP;
      this.carry = '';
      this.decoder = new StringDecoder('utf8');
    }
    let fd: number;
    try {
      fd = fs.openSync(this.file, 'r');
    } catch {
      return false;
    }
    try {
      const len = st.size - from;
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, from);
      this.offset = from + n;
      const text = this.carry + this.decoder.write(buf.subarray(0, n));
      const lines = text.split('\n');
      // The last piece is a whole line only if the file ended with a newline.
      this.carry = lines.pop() ?? '';
      if (seeking) lines.shift();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.consume(JSON.parse(line));
        } catch {
          /* a torn line mid-write is expected; the next poll gets it whole */
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      fs.closeSync(fd);
    }
  }

  private reset(): void {
    this.offset = 0;
    this.carry = '';
    this.decoder = new StringDecoder('utf8');
    this.tokens = 0;
    this.usageId = '';
    this.usageAdded = 0;
    this.onReset();
  }

  /**
   * Add an assistant record's usage — once per API turn, not once per record.
   *
   * Claude Code writes one JSONL record per content block, so a turn that
   * thinks, speaks and calls a tool is three records carrying the *same*
   * `usage` object. Adding each one counted every token two or three times
   * over: measured against real transcripts, totals came out 2.4x to 3.4x the
   * truth, which made the island's headline number meaningless.
   *
   * Records of a turn are contiguous, so remembering one id is enough. The
   * later record wins rather than the first: everything but `output_tokens` is
   * byte-identical across the group, and `output_tokens` climbs to its final
   * value as the response streams — so first-wins would latch a placeholder and
   * undercount the output instead.
   */
  protected countUsage(e: any): void {
    const u = e?.message?.usage as Usage | undefined;
    if (!u) return;
    const n = countable(u);
    const id = String(e?.message?.id ?? '');
    if (id && id === this.usageId) {
      this.tokens += n - this.usageAdded;
      this.usageAdded = n;
      return;
    }
    this.usageId = id;
    this.usageAdded = n;
    this.tokens += n;
  }
}

/* ------------------------------------------------------------- subagents */

interface AgentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
}

/** One subagent's own conversation. */
class AgentTranscript extends Reader {
  startedAt = 0;
  /** Written a moment after the transcript, so it is re-read until it shows up. */
  meta: AgentMeta;
  lastAt = 0;
  private open: OpenTool | null = null;
  private lastTool: OpenTool | null = null;
  private lastSaid = '';
  /** Latched once judged finished, so the row cannot flicker mid-gap. */
  private ended = 0;
  /**
   * The first line of what this agent was asked to do. A workflow's agents get
   * no description in their meta file, so without this a freshly launched one
   * has nothing at all to put in a row.
   */
  private brief = '';

  constructor(
    file: string,
    readonly agentId: string,
    meta: AgentMeta
  ) {
    super(file);
    this.meta = meta;
  }

  /** True while the meta file has still not been read. */
  needsMeta(): boolean {
    return !this.meta.agentType && !this.meta.description && !this.meta.toolUseId;
  }

  protected onReset(): void {
    this.open = null;
    this.lastTool = null;
    this.ended = 0;
  }

  protected consume(e: any): void {
    const type = e?.type;
    if (type !== 'user' && type !== 'assistant') return;
    const at = stamp(e.timestamp);
    if (at) {
      if (!this.startedAt) this.startedAt = at;
      this.lastAt = Math.max(this.lastAt, at);
    }
    if (type === 'assistant') this.countUsage(e);

    // A message's content is an array of blocks, except when it is a bare
    // string — which is exactly the shape a subagent's opening prompt arrives
    // in, so skipping it cost every workflow agent its only label.
    const content = e?.message?.content;
    const blocks = Array.isArray(content)
      ? content
      : typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        const name = String(b.name ?? '');
        // The schema tool is how a structured agent hands back its answer, not
        // something it is doing. Showing "Using StructuredOutput" as the work
        // says nothing, and treating it as an open call would earn a finishing
        // agent the long stuck-in-a-tool rope.
        if (name === 'StructuredOutput') continue;
        const t = { name, input: (b.input ?? {}) as Record<string, unknown>, at };
        this.open = t;
        this.lastTool = t;
      } else if (b.type === 'tool_result') {
        this.open = null;
      } else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        if (type === 'assistant') this.lastSaid = ellipsis(b.text, 56);
        else if (!this.brief) this.brief = firstLine(b.text, 46);
      }
    }
  }

  /** What this agent is doing, in one line. */
  title(): string {
    const t = this.open ?? this.lastTool;
    if (t && t.name) return phraseFor(t.name, t.input);
    if (this.lastSaid) return this.lastSaid;
    return this.meta.description || this.brief || 'Working';
  }

  /**
   * The best label for an agent that has stopped.
   *
   * What it was asked to do beats what it said, when anyone wrote it down —
   * but a workflow's agents have no description at all, and then the last
   * thing the agent said is a better account of the work than the first line
   * of the prompt it was handed.
   */
  summary(): string {
    return this.meta.description || this.lastSaid || this.brief || 'Finished';
  }

  activity(): Activity {
    const t = this.open ?? this.lastTool;
    return t && t.name ? activityFor(t.name) : 'think';
  }

  /**
   * When this agent stopped, or undefined while it is still going.
   *
   * A notification is the real answer and settles it outright. Failing that,
   * silence is the only evidence there is — so it has to be a lot of silence,
   * and more still when the agent's last act was to call a tool that has not
   * come back, because that is an agent waiting rather than an agent gone.
   *
   * The verdict is latched: within one gap `lastAt` does not move, so
   * recomputing it every tick would be stable anyway, but latching makes the
   * one-way intent explicit and the revival condition exact — the agent has to
   * actually write something newer than the moment it was written off.
   */
  endedAt(notified: number | undefined): number | undefined {
    const last = this.lastAt || this.startedAt;
    if (notified) return notified;
    if (this.ended && last > this.ended) this.ended = 0;
    if (!this.ended && last) {
      const rope = this.open ? AGENT_BLOCKED_QUIET_MS : AGENT_QUIET_MS;
      if (Date.now() - last > rope) this.ended = last;
    }
    return this.ended || undefined;
  }
}

/**
 * A workflow's own log of its fleet.
 *
 * Workflow agents are not spawned by a `Task` tool call, so there is no
 * tool-use id to join on and no task-notification to close them out — left to
 * the silence rule alone, eight finished reviewers sat on the island as live
 * work for ten minutes. The workflow writes one `result` line per agent as it
 * returns, which is the exact answer.
 */
class Journal extends Reader {
  readonly done = new Set<string>();

  protected onReset(): void {
    this.done.clear();
  }

  protected consume(e: any): void {
    if (e?.type !== 'result' && e?.type !== 'error') return;
    const id = String(e.agentId ?? '');
    if (id) this.done.add(id);
  }
}

/**
 * The subagent files belonging to one session, kept warm.
 *
 * They are not all in one directory. A `Task` call writes straight into
 * `subagents/`, but a workflow puts its fleet under
 * `subagents/workflows/<runId>/` — so the tree is walked rather than listed.
 * Scanning only the top level is how five agents reviewing this very file
 * showed up on the island as "one agent, no subagents".
 */
class AgentSet {
  private open = new Map<string, AgentTranscript>();
  private journals = new Map<string, Journal>();

  constructor(private dir: string) {}

  /** True once a workflow has logged this agent's return. */
  finished(agentId: string): boolean {
    for (const j of this.journals.values()) if (j.done.has(agentId)) return true;
    return false;
  }

  private walk(dir: string, depth: number, out: { id: string; file: string; dir: string }[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth > 0) this.walk(path.join(dir, e.name), depth - 1, out);
        continue;
      }
      if (e.name === 'journal.jsonl') {
        const file = path.join(dir, e.name);
        if (!this.journals.has(file)) this.journals.set(file, new Journal(file));
        this.journals.get(file)!.poll();
        continue;
      }
      if (!e.name.startsWith('agent-') || !e.name.endsWith('.jsonl')) continue;
      out.push({ id: e.name.slice('agent-'.length, -'.jsonl'.length), file: path.join(dir, e.name), dir });
    }
  }

  /** Re-scan the tree and read every agent forward. */
  refresh(): AgentTranscript[] {
    const found: { id: string; file: string; dir: string }[] = [];
    // subagents/ → workflows/ → <runId>/ is two levels; three leaves headroom.
    this.walk(this.dir, 3, found);
    if (!found.length) {
      // This session has never spawned one, or its directory went away.
      this.open.clear();
      this.journals.clear();
      return [];
    }
    const alive = new Set(found.map((f) => f.id));
    for (const id of [...this.open.keys()]) if (!alive.has(id)) this.open.delete(id);

    for (const f of found) {
      const known = this.open.get(f.id);
      // The transcript appears first and the meta file a moment later, so a
      // one-shot read at discovery would leave an agent permanently unlabelled.
      // Keep asking until there is something to read.
      if (known && !known.needsMeta()) continue;
      let meta: AgentMeta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(f.dir, `agent-${f.id}.meta.json`), 'utf8'));
      } catch {
        // Not written yet. The row still works — it falls back to the agent's
        // own words for a title.
      }
      if (known) known.meta = meta;
      else this.open.set(f.id, new AgentTranscript(f.file, f.id, meta));
    }
    const out: AgentTranscript[] = [];
    for (const a of this.open.values()) {
      a.poll();
      out.push(a);
    }
    return out;
  }
}

/* ------------------------------------------------------------ main thread */

interface Task {
  id: string;
  description: string;
  agentType?: string;
  at: number;
}

/** One session's main conversation. */
class SessionTranscript extends Reader {
  readonly sessionId: string;
  private agents: AgentSet;

  cwd = '';
  branch: string | undefined;
  title = '';
  startedAt = 0;
  lastAt = 0;

  private open = new Map<string, OpenTool>();
  private mainTool: { id: string; name: string; input: Record<string, unknown> } | null = null;
  /** Task calls, so a subagent that has no transcript yet still gets a row. */
  private tasks = new Map<string, Task>();
  /** toolUseId → when its task-notification said it finished. */
  private finished = new Map<string, number>();
  private lastSaid = '';
  private lastPrompt = '';
  private tail: string[] = [];

  constructor(file: string) {
    super(file);
    this.sessionId = path.basename(file, '.jsonl');
    this.agents = new AgentSet(path.join(path.dirname(file), this.sessionId, 'subagents'));
  }

  protected onReset(): void {
    this.open.clear();
    this.tasks.clear();
    this.finished.clear();
    this.mainTool = null;
    this.tail = [];
  }

  protected consume(e: any): void {
    const type = e?.type;
    if (type === 'ai-title' && typeof e.aiTitle === 'string') {
      this.title = e.aiTitle;
      return;
    }
    if (type === 'queue-operation') {
      this.notification(e);
      return;
    }
    if (type !== 'user' && type !== 'assistant') return;
    // Roughly one notification in ten is delivered as an ordinary user message
    // rather than a queue-operation. Missing those left the agent that sent one
    // running forever on the island.
    if (type === 'user') {
      const text = textOf(e?.message?.content);
      if (text.includes('<task-notification>')) {
        this.notification({ content: text, timestamp: e.timestamp });
        return;
      }
    }
    // A subagent's records live in their own file. If a future version of
    // Claude Code inlines them again, they are still not this thread's work.
    if (e.isSidechain === true) return;

    const at = stamp(e.timestamp);
    if (at) {
      if (!this.startedAt) this.startedAt = at;
      this.lastAt = Math.max(this.lastAt, at);
    }
    if (typeof e.cwd === 'string' && e.cwd) this.cwd = e.cwd;
    if (typeof e.gitBranch === 'string' && e.gitBranch) this.branch = e.gitBranch;
    if (type === 'assistant') this.countUsage(e);

    const content = e?.message?.content;
    const blocks = Array.isArray(content)
      ? content
      : typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : [];

    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        if (type === 'assistant') this.lastSaid = ellipsis(b.text, 56);
        else if (!e.isMeta && !e.toolUseResult && !machineWritten(b.text)) {
          this.lastPrompt = ellipsis(b.text, 56);
        }
      } else if (b.type === 'tool_use') {
        this.openTool(b, at);
      } else if (b.type === 'tool_result') {
        this.closeTool(b);
      }
    }
  }

  /**
   * `<task-notification>` — a subagent stopped.
   *
   * It is the only record that says so. The Task tool_result came back the
   * instant the agent launched, so without this an agent row would go green
   * forever, and the same agent can notify more than once if it is resumed —
   * hence a plain overwrite rather than a first-wins.
   */
  private notification(e: any): void {
    const text = typeof e?.content === 'string' ? e.content : '';
    if (!text.includes('<task-notification>')) return;
    const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1];
    const status = /<status>([^<]+)<\/status>/.exec(text)?.[1];
    if (!id || !status) return;
    if (status === 'running' || status === 'started') return;
    this.finished.set(id, stamp(e.timestamp) || Date.now());
  }

  private openTool(b: any, at: number): void {
    const name = String(b.name ?? '');
    const id = String(b.id ?? '');
    const input = (b.input ?? {}) as Record<string, unknown>;
    if (!id || !name) return;
    this.open.set(id, { name, input, at });
    if (name === 'Task' || name === 'Agent') {
      const desc = String((input as any).description ?? (input as any).prompt ?? 'a task');
      this.tasks.set(id, {
        id,
        description: ellipsis(desc, 46),
        agentType: typeof (input as any).subagent_type === 'string' ? (input as any).subagent_type : undefined,
        at: at || Date.now()
      });
      return;
    }
    this.mainTool = { id, name, input };
  }

  private closeTool(b: any): void {
    const id = String(b.tool_use_id ?? '');
    if (!id) return;
    this.open.delete(id);
    // A Task's result says "launched", not "finished" — only the notification
    // ends an agent, so nothing is closed out here.
    if (this.tasks.has(id)) return;
    const lines = resultLines(b.content);
    if (lines.length) this.tail = lines;
    if (this.mainTool && this.mainTool.id === id) this.mainTool = null;
  }

  /**
   * Whether anyone has said anything in this file yet.
   *
   * Claude Code writes a `bridge-session` record into a transcript the moment
   * a session is registered for remote control — before, and sometimes
   * instead of, any conversation: leaving one session can create a file for
   * the next that never gets used. Such a file has no timestamps, so on every
   * tick it reported "started now, active now", which the store read as a
   * session working forever under a bare uuid, with no project and no words —
   * a phantom row that appeared exactly when a real session was closed.
   */
  empty(): boolean {
    return !this.startedAt;
  }

  /** What the main thread is doing, in one line. */
  private mainTitle(): string {
    if (this.mainTool) return phraseFor(this.mainTool.name, this.mainTool.input);
    if (this.lastSaid) return this.lastSaid;
    if (this.lastPrompt) return this.lastPrompt;
    return this.title || 'Working';
  }

  facts(): SessionFacts {
    const now = Date.now();
    this.poll();
    const live = this.agents.refresh();

    const main: Agent = {
      id: 'main',
      kind: 'main',
      title: this.mainTitle(),
      activity: this.mainTool ? activityFor(this.mainTool.name) : 'think',
      // Overwritten by the store from hook state: a transcript on its own
      // cannot tell a slow tool call from a question waiting in the terminal.
      status: 'working',
      tokens: this.tokens,
      startedAt: this.startedAt || now
    };

    const claimed = new Set<string>();
    const subs: Agent[] = [];
    for (const a of live) {
      const useId = a.meta.toolUseId;
      if (useId) claimed.add(useId);
      const notified =
        (useId ? this.finished.get(useId) : undefined) ??
        (this.agents.finished(a.agentId) ? a.lastAt : undefined);
      const endedAt = a.endedAt(notified);
      const task = useId ? this.tasks.get(useId) : undefined;
      subs.push({
        id: a.agentId,
        kind: 'sub',
        title: endedAt ? task?.description || a.summary() : a.title(),
        activity: endedAt ? 'done' : a.activity(),
        status: endedAt ? 'done' : 'working',
        agentType: a.meta.agentType ?? task?.agentType,
        tokens: a.tokens,
        startedAt: a.startedAt || task?.at || now,
        endedAt
      });
    }

    // A Task whose transcript has not appeared yet — the launch and the first
    // write are a moment apart, and that moment is exactly when you are looking.
    for (const t of this.tasks.values()) {
      if (claimed.has(t.id)) continue;
      const endedAt = this.finished.get(t.id);
      subs.push({
        id: t.id,
        kind: 'sub',
        title: t.description,
        activity: endedAt ? 'done' : 'agent',
        status: endedAt ? 'done' : 'working',
        agentType: t.agentType,
        tokens: 0,
        startedAt: t.at,
        endedAt
      });
    }

    // Live agents first, newest first within each group. The eye goes to the
    // top of the list, and what is still running is what you can still affect.
    subs.sort((a, b) => Number(!!a.endedAt) - Number(!!b.endedAt) || b.startedAt - a.startedAt);

    const lastAt = Math.max(this.lastAt || 0, ...live.map((a) => a.lastAt || 0)) || now;
    const agentTokens = subs.reduce((n, a) => n + a.tokens, 0);

    return {
      sessionId: this.sessionId,
      file: this.file,
      cwd: this.cwd,
      project: this.cwd ? path.basename(this.cwd) : this.sessionId.slice(0, 8),
      branch: this.branch,
      title: this.title || this.lastPrompt || '',
      startedAt: this.startedAt || now,
      lastAt,
      mainLastAt: this.lastAt || now,
      tokens: this.tokens + agentTokens,
      agents: [main, ...subs.slice(0, 12)],
      tool: this.mainTool?.name,
      busy: this.mainTool !== null,
      tail: this.tail
    };
  }
}

/**
 * Every session worth watching, kept warm.
 *
 * A session is worth watching if its transcript changed recently. The set is
 * re-derived on every tick, so a `claude` started five minutes from now is
 * picked up without a single hook firing.
 */
export class TranscriptWatcher {
  private open = new Map<string, SessionTranscript>();

  /** Session transcripts touched within `windowMs`, newest first. */
  private recentFiles(windowMs: number): string[] {
    const out: { file: string; mtime: number }[] = [];
    let slugs: string[];
    try {
      slugs = fs.readdirSync(PROJECTS_DIR);
    } catch {
      return [];
    }
    const cutoff = Date.now() - windowMs;
    for (const slug of slugs) {
      const dir = path.join(PROJECTS_DIR, slug);
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        // Only the session files at the top of a project directory. The
        // per-session subdirectories hold subagents, which belong to a session
        // rather than being one.
        if (!n.endsWith('.jsonl')) continue;
        const file = path.join(dir, n);
        try {
          const st = fs.statSync(file);
          if (st.isFile() && st.mtimeMs >= cutoff) out.push({ file, mtime: st.mtimeMs });
        } catch {
          /* vanished between readdir and stat */
        }
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime).map((o) => o.file);
  }

  /**
   * Read every recent session forward and hand back what they say now.
   *
   * A session whose subagents are still writing counts as recent even when its
   * own file has gone quiet — otherwise a main thread waiting on four agents
   * would age out of the list while the work was still happening.
   */
  scan(windowMs: number): SessionFacts[] {
    const files = this.recentFiles(windowMs);
    const live = new Set(files);
    for (const [id, t] of [...this.open]) if (!live.has(t.file)) this.open.delete(id);

    const facts: SessionFacts[] = [];
    for (const file of files) {
      const id = path.basename(file, '.jsonl');
      let t = this.open.get(id);
      if (!t) {
        t = new SessionTranscript(file);
        this.open.set(id, t);
      }
      const f = t.facts();
      // Registered but never spoken in: not a session anyone is sitting in.
      if (t.empty()) continue;
      facts.push(f);
    }
    return facts;
  }
}
