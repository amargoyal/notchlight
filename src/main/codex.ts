import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Ask, Session, Snapshot, Status } from '../shared/types';

const text = (v: unknown, limit = 240) => typeof v === 'string' ? v.slice(0, limit) : '';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
type RecordValue = Record<string, any>;
/**
 * Where a rollout came from, from the 0.153.4 `session_meta` fields observed
 * locally: Desktop threads carry `originator: "Codex Desktop"` (or a
 * `*_desktop` build id) with `source: "vscode"`; the terminal writes
 * `originator: "codex-tui"` with `source: "cli"`, and `codex exec` writes
 * `source: "exec"`. Subagent threads carry an object `source` and inherit the
 * originator. Anything else is reported as unknown rather than guessed.
 */
export function sourceOf(p: RecordValue): NonNullable<Session['source']> {
  const originator = text(p.originator, 80).toLowerCase();
  const source = typeof p.source === 'string' ? p.source.toLowerCase() : '';
  if (originator.includes('desktop')) return 'desktop';
  if (source === 'cli' || source === 'exec' || originator === 'codex-tui' || originator.startsWith('codex_cli')) return 'cli';
  return 'unknown';
}
export interface CodexHook extends RecordValue { hook_event_name: string; session_id: string }

/** An incremental reader for the local 0.153.4 rollout format. No private DB writes. */
export class CodexTranscript {
  offset = 0;
  private remainder = '';
  private decoder = new StringDecoder('utf8');
  private skippingLine = false;
  private identity = '';
  private bootstrapping = true;
  session: Session | null = null;
  turnId = '';
  private calls = new Map<string, string>();
  constructor(readonly file: string) {}
  refresh(): void {
    const stat = fs.statSync(this.file);
    const identity = `${stat.dev}:${stat.ino}`;
    if (this.identity !== identity || stat.size < this.offset) {
      this.offset = 0; this.remainder = ''; this.decoder = new StringDecoder('utf8'); this.skippingLine = false; this.session = null; this.turnId = ''; this.calls.clear(); this.bootstrapping = true;
    }
    this.identity = identity;
    const fd = fs.openSync(this.file, 'r');
    try {
      // Bounded chunks keep giant tool outputs from becoming giant allocations.
      const buffer = Buffer.alloc(64 * 1024);
      let remaining = Math.min(stat.size - this.offset, 8 * 1024 * 1024);
      while (remaining > 0) {
        const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, remaining), this.offset);
        if (!count) break;
        this.offset += count; remaining -= count;
        this.remainder += this.decoder.write(buffer.subarray(0, count));
        let end: number;
        while ((end = this.remainder.indexOf('\n')) >= 0) {
          const line = this.remainder.slice(0, end); this.remainder = this.remainder.slice(end + 1);
          if (this.skippingLine) { this.skippingLine = false; continue; }
          try { this.accept(JSON.parse(line), !this.bootstrapping); } catch { /* incomplete/unknown record */ }
        }
        if (this.remainder.length > 4 * 1024 * 1024) { this.remainder = ''; this.skippingLine = true; }
      }
      if (this.offset === stat.size) this.bootstrapping = false;
    } finally { fs.closeSync(fd); }
  }
  accept(record: RecordValue, fresh = true): void {
    const p = record.payload;
    if (!p || typeof p !== 'object') return;
    const at = Date.parse(record.timestamp) || Date.now();
    if (record.type === 'session_meta') {
      const id = text(p.id || p.session_id, 160);
      if (!id) return;
      const spawned = p.source?.subagent?.thread_spawn;
      const parent = text(p.parent_thread_id || spawned?.parent_thread_id, 160);
      this.session = { id: `codex:${id}`, originalId: id, provider: 'codex',
        source: sourceOf(p),
        parentSessionId: parent ? `codex:${parent}` : undefined,
        title: text(p.agent_nickname), project: path.basename(text(p.cwd, 4096)) || 'Codex task', cwd: text(p.cwd, 4096),
        branch: text(p.git?.branch), status: 'idle', tokens: 0, tokensKnown: false,
        startedAt: at, lastAt: at, agents: [], ask: null, tail: [] };
      return;
    }
    const s = this.session;
    if (!s) return;
    if (record.type === 'event_msg') {
      if (p.type === 'task_started') { this.turnId = text(p.turn_id, 160); s.startedAt = at; s.endedAt = undefined; s.ask = null; s.failure = undefined; s.status = fresh ? 'working' : 'unknown'; this.calls.clear(); }
      else if (p.type === 'task_complete' && (!p.turn_id || !this.turnId || p.turn_id === this.turnId)) {
        // Only an explicit terminal error fails the task; tool errors earlier in the turn do not.
        s.status = p.error ? 'failed' : 'done'; s.endedAt = at; s.ask = null; this.calls.clear();
        s.failure = p.error ? text(typeof p.error === 'string' ? p.error : p.error.message, 160) || 'Codex reported an error.' : undefined;
      }
      else if (p.type === 'turn_aborted' && (!p.turn_id || p.turn_id === this.turnId)) { s.status = 'interrupted'; s.endedAt = at; s.ask = null; this.calls.clear(); }
      else if (p.type === 'token_count' && p.info?.total_token_usage) this.usage(p.info.total_token_usage);
      else return;
      s.lastAt = at;
    } else if (record.type === 'token_usage_record') {
      if (p.thread_token_usage) this.usage(p.thread_token_usage);
    } else if (record.type === 'response_item') {
      if (s.endedAt) return;
      if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        const name = text(p.name, 100); const call = text(p.call_id, 160);
        this.calls.set(call, name); s.tool = name; s.lastAt = at;
        if (fresh && !s.ask) s.status = 'working';
        if (/(^|__)request_user_input(_async)?$/.test(name)) s.ask = { id: `input:${call}`, tool: name, command: '', message: 'Answer this question in Codex.', at, answerable: false };
      } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        const call = text(p.call_id, 160); this.calls.delete(call);
        if (s.ask?.id === `input:${call}`) s.ask = null;
        s.tool = [...this.calls.values()].at(-1); s.lastAt = at;
        if (fresh && !s.ask) s.status = 'working';
      } else if (p.type === 'message' && p.role === 'assistant' && fresh) {
        s.lastAt = at; if (!s.ask && s.status === 'unknown') s.status = 'working';
      }
    }
    if (s.ask) s.status = 'asking';
  }
  private usage(value: RecordValue) {
    if (!this.session || typeof value.input_tokens !== 'number' || typeof value.output_tokens !== 'number') return;
    this.session.tokens = Math.max(0, num(value.input_tokens) - num(value.cached_input_tokens)) + num(value.output_tokens);
    this.session.tokensKnown = true;
  }
}

export class CodexAdapter extends EventEmitter {
  private readers = new Map<string, CodexTranscript>();
  private hooks = new Map<string, { at: number; status: Status; ended?: boolean; turn:string }>();
  private registrations = new Map<string, Session>();
  private held = new Map<string, Ask[]>();
  private dismissed = new Map<string, number>();
  private titles = new Map<string, string>();
  private answered = new Map<string, number>();
  private terminal = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private directory = '';
  private enabled = false;
  private discoveryAt = 0;
  private changedAt = 0;
  health: NonNullable<Snapshot['codex']> = { state: 'disabled', message: 'Enable Codex to show local desktop and CLI tasks.', hooksSeen: false };
  configure(enabled: boolean, directory: string): void {
    if (this.enabled === enabled && this.directory === directory) return;
    this.stop(); this.enabled = enabled; this.directory = directory;
    this.readers.clear(); this.hooks.clear(); this.registrations.clear(); this.held.clear(); this.dismissed.clear(); this.titles.clear(); this.answered.clear(); this.terminal.clear(); this.discoveryAt = 0;
    this.health = { state: enabled ? 'missing' : 'disabled', message: enabled ? 'Looking for local Codex sessions…' : 'Codex monitoring is off.', hooksSeen: false };
    if (enabled) { this.scan(); this.timer = setInterval(() => this.scan(), 900); }
    this.emit('change');
  }
  scan(): void {
    if (!this.enabled) return;
    const now = Date.now();
    try {
      const sessions = path.join(this.directory, 'sessions');
      if (!fs.existsSync(sessions)) throw new Error('missing');
      if (now - this.discoveryAt > 5000) {
        const files: string[] = [];
        const walk = (dir: string, depth: number) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory() && depth < 3) walk(file, depth + 1);
            else if (entry.isFile() && file.endsWith('.jsonl') && now - fs.statSync(file).mtimeMs < 3 * 60 * 60 * 1000) files.push(file);
          }
        };
        walk(sessions, 0);
        const found = new Set(files);
        for (const file of this.readers.keys()) if (!found.has(file)) this.readers.delete(file);
        for (const file of files) if (!this.readers.has(file)) this.readers.set(file, new CodexTranscript(file));
        this.readTitles(); this.discoveryAt = now;
      }
      let compatible = !this.readers.size;
      for (const reader of this.readers.values()) {
        try {
          reader.refresh(); compatible ||= !!reader.session;
          const s = reader.session;
          if (s?.endedAt) {
            const key = `${s.id}:${reader.turnId}:${s.endedAt}`;
            if (!this.terminal.has(key)) { this.terminal.add(key); this.emit('terminal', s.id, reader.turnId); }
          }
        } catch { /* file rotated during discovery */ }
      }
      this.health = { ...this.health, state: compatible ? 'ready' : 'unsupported', message: compatible ? 'Reading local Codex activity. Hooks provide immediate status and approvals.' : 'This Codex session format is not supported. Update Notchlight.' };
    } catch {
      this.readers.clear();
      this.health = { ...this.health, state: 'missing', message: 'No readable Codex sessions folder. Choose your Codex home or start a local task.' };
    }
    this.changedAt = now; this.emit('change');
  }
  private readTitles() {
    try {
      const file = path.join(this.directory, 'session_index.jsonl');
      const stat = fs.statSync(file); const start = Math.max(0, stat.size - 1024 * 1024);
      const fd = fs.openSync(file, 'r');
      try {
        const b = Buffer.alloc(stat.size - start); fs.readSync(fd, b, 0, b.length, start);
        for (const line of b.toString().split('\n').slice(start ? 1 : 0)) {
          try { const r = JSON.parse(line); if (r.id && r.thread_name) this.titles.set(text(r.id, 160), text(r.thread_name)); } catch { /* partial */ }
        }
      } finally { fs.closeSync(fd); }
    } catch { /* index is optional */ }
  }
  onHook(p: CodexHook): void {
    if (!this.enabled || !p.session_id) return;
    this.health.hooksSeen = true;
    const id = `codex:${p.session_id}`;
    const event = p.hook_event_name;
    // Child hooks use the parent's ID; child Stop must not complete the parent.
    if (event === 'SubagentStart' || event === 'SubagentStop') { this.emit('change'); return; }
    if (!this.registrations.has(id)) this.registrations.set(id, { id, originalId:p.session_id, provider:'codex', source:'unknown', title:'Codex task', project:path.basename(text(p.cwd,4096)) || 'Codex task', cwd:text(p.cwd,4096), status:'idle',tokens:0,tokensKnown:false,startedAt:Date.now(),lastAt:Date.now(),agents:[],ask:null,tail:[] });
    if (event === 'Stop') { this.scan(); return; }
    // SessionEnd finishes the row the way Claude's does: red until dismissed, not a delete.
    const status: Status = event === 'Interrupt' ? 'interrupted' : event === 'SessionStart' ? 'idle' : event === 'SessionEnd' ? 'done' : event === 'PermissionRequest' ? 'asking' : 'working';
    this.hooks.set(id, { at: Date.now(), status, ended: event === 'SessionEnd', turn:text(p.turn_id,160) });
    this.discoveryAt = 0; this.scan();
  }
  onAnswered(id: string, decision: string) {
    if (decision === 'defer') return;
    this.answered.set(id, Date.now());
    const hook = this.hooks.get(id);
    if (hook) this.hooks.set(id, { ...hook, at: Date.now(), status: 'unknown' });
    this.emit('change');
  }
  setHeld(id: string, requests: Ask[]) { this.held.set(id, requests); this.emit('change'); }
  dismiss(id: string) { this.dismissed.set(id, Date.now()); this.emit('change'); }
  sessions(): Session[] {
    const all: Session[] = [];
    const records = new Map(this.registrations);
    const turns = new Map<string,string>();
    for (const reader of this.readers.values()) if (reader.session) {
      const existing = records.get(reader.session.id);
      if (!existing || reader.session.lastAt >= existing.lastAt || this.registrations.get(reader.session.id) === existing) { records.set(reader.session.id, reader.session); turns.set(reader.session.id,reader.turnId); }
    }
    for (const raw of records.values()) {
      const hook = this.hooks.get(raw.id);
      if (Date.now() - Math.max(raw.lastAt,hook?.at ?? 0) > 3*60*60_000 && !this.held.get(raw.id)?.length) continue;
      if ((this.dismissed.get(raw.id) ?? 0) >= Math.max(raw.lastAt, hook?.at ?? 0)) continue;
      const s: Session = { ...raw, approvedAt: this.answered.get(raw.id), agents: [], title: this.titles.get(raw.originalId!) || raw.title || raw.project };
      if (hook && (raw === this.registrations.get(raw.id) || hook.at > raw.lastAt) && !(raw.endedAt && (hook.turn === turns.get(raw.id) || hook.ended))) { s.status = hook.status; s.lastAt = Math.max(s.lastAt, hook.at); if (['done','interrupted'].includes(s.status)) s.endedAt = hook.at; }
      else if (hook?.ended && !s.endedAt) { s.status = 'done'; s.endedAt = hook.at; }
      const held = this.held.get(s.id)?.[0];
      if (held) { s.ask = held; s.status = 'asking'; }
      else if (s.status === 'asking' && !s.ask) s.ask = { id: 'native-prompt', tool: s.tool || 'Codex', command: '', message: 'Continue in Codex.', at: s.lastAt, answerable: false };
      if (s.status === 'working' && this.changedAt - s.lastAt > 15 * 60_000) s.status = 'unknown';
      const title = s.status === 'unknown' ? 'Waiting for fresh activity' : s.status === 'failed' ? s.failure || 'Codex reported an error' : s.status === 'interrupted' ? 'Interrupted in Codex' : s.tool || s.status;
      s.agents.push({ id: 'main', kind: 'main', title, activity: s.status === 'done' || s.status === 'failed' ? 'done' : s.status === 'asking' ? 'ask' : s.tool ? 'shell' : 'think', status: s.status, tokens: s.tokens, tokensKnown: s.tokensKnown, startedAt: s.startedAt, endedAt: s.endedAt });
      all.push(s);
    }
    // Children attach to a parent that is still in view. A child whose parent has
    // aged out (or was never recorded here) is real activity, so it stays as its
    // own row rather than vanishing.
    const parents = all.filter(s => !s.parentSessionId || !all.some(p => p.id === s.parentSessionId));
    for (const child of all.filter(s => !parents.includes(s))) {
      const parent = parents.find(s => s.id === child.parentSessionId);
      if (parent) parent.agents.push({ ...child.agents[0], id: child.id, kind: 'sub', title: child.title, agentType: 'subagent' });
    }
    return parents;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
