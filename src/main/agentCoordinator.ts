import { EventEmitter } from 'node:events';
import type { ApprovalDecision, Snapshot, Status } from '../shared/types';
import { Store } from './store';
import { DemoStore } from './demo';
import { CodexAdapter } from './codex';
import { CodexApprovals } from './codexApprovals';
import { HookServer } from './hookServer';

const rank: Record<Status, number> = { asking: 0, working: 1, failed: 2, done: 3, interrupted: 4, unknown: 5, idle: 6 };
export class AgentCoordinator extends EventEmitter {
  constructor(readonly claude: Store | DemoStore, readonly codex: CodexAdapter, private decisions: CodexApprovals, private claudeHooks: () => HookServer | null, private claudeHooksInstalled: () => boolean = () => true) {
    super();
    claude.on('snapshot', () => this.emit('snapshot', this.current()));
    codex.on('change', () => this.emit('snapshot', this.current()));
  }
  current(): Snapshot {
    const base = this.claude.current();
    const sessions = [...base.sessions.map(s => ({ ...s, originalId: s.id, id: `claude:${s.id}`, provider: 'claude' as const, source: 'cli' as const })), ...this.codex.sessions()];
    sessions.sort((a,b) => rank[a.status] - rank[b.status] || b.lastAt - a.lastAt || a.id.localeCompare(b.id));
    const providers = new Set(sessions.map(s => s.provider));
    const claude: Snapshot['claude'] = !(this.claude instanceof Store) ? { state: 'demo', message: 'Sample Claude activity.' }
      : this.claudeHooksInstalled() ? { state: 'ready', message: 'Claude Code hooks are installed. Sessions and permission requests appear here.' }
      : { state: 'no-hooks', message: 'Claude Code hooks are not installed. Transcripts still show activity; install hooks for requests and session ends.' };
    return { ...base, sessions, codex: this.codex.health, claude, overall: sessions[0]?.status ?? 'idle', dormant: !sessions.length,
      tokensKnown: providers.size < 2 && sessions.every(s => s.tokensKnown !== false),
      elapsed: sessions.reduce((n,s) => Math.max(n, (s.endedAt ?? Date.now()) - s.startedAt),0),
      tokens: sessions.reduce((n,s) => n + s.tokens,0), now: Date.now() };
  }
  decide(session: string, ask: string, decision: ApprovalDecision) {
    if (!['allow','deny','defer'].includes(decision)) throw new Error('Unknown decision.');
    if (session.startsWith('codex:')) return this.decisions.decide(session,ask,decision);
    if (!session.startsWith('claude:') || !(this.claude instanceof Store)) throw new Error('Unknown session.');
    const gate = this.claude.gateFor(session.slice(7),ask);
    if (!gate || !this.claudeHooks()) throw new Error('This Claude approval has expired.');
    if (decision === 'defer') this.claudeHooks()!.release(gate);
    else this.claudeHooks()!.decide(gate,decision);
  }
  dismiss(id: string) {
    if (id.startsWith('codex:')) this.codex.dismiss(id);
    else if (id.startsWith('claude:')) this.claude.dismiss(id.slice(7));
  }
  setNotch(w: number,h: number) { this.claude.setNotch(w,h); }
  start() { this.claude.start(); }
  stop() { this.claude.stop(); this.codex.stop(); this.decisions.stop(); }
}
