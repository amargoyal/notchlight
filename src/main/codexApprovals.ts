import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { ApprovalDecision, Ask } from '../shared/types';
import type { CodexHook } from './codex';

interface Held { session: string; turn: string; ask: Ask; socket: net.Socket; timer: NodeJS.Timeout }
export class CodexApprovals extends EventEmitter {
  private server: net.Server | null = null;
  private held = new Map<string, Held>();
  constructor(private socketPath: string, private enabled: () => boolean, private approvals: () => boolean, private timeout = 55_000) { super(); }
  start() {
    fs.mkdirSync(path.dirname(this.socketPath), { recursive: true });
    fs.rmSync(this.socketPath, { force: true });
    this.server = net.createServer(socket => {
      socket.setEncoding('utf8'); let buffer = ''; let received = false;
      const idle = setTimeout(() => socket.destroy(), 1000);
      socket.on('error', () => socket.destroy()); socket.on('close', () => clearTimeout(idle));
      socket.on('data', data => {
        if (received) return;
        buffer += data;
        if (buffer.length > 1024 * 1024) { socket.destroy(); return; }
        const end = buffer.indexOf('\n'); if (end < 0) return;
        received = true; clearTimeout(idle);
        try { this.dispatch(JSON.parse(buffer.slice(0, end)), socket); } catch { socket.end('{}\n'); }
      });
    });
    this.server.on('error', () => this.emit('unavailable'));
    this.server.listen(this.socketPath, () => { try { fs.chmodSync(this.socketPath, 0o600); } catch { /* shutdown */ } });
  }
  private dispatch(p: CodexHook, socket: net.Socket) {
    if (!this.enabled() || p.provider !== 'codex' || typeof p.session_id !== 'string' || !p.session_id || p.session_id.length > 160 || typeof p.hook_event_name !== 'string') return void socket.end('{}\n');
    if (!['SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Interrupt','SubagentStart','SubagentStop','Stop'].includes(p.hook_event_name)) return void socket.end('{}\n');
    const session = `codex:${p.session_id}`;
    if (p.hook_event_name === 'SessionEnd') this.releaseSession(session);
    else if (['Interrupt','Stop','UserPromptSubmit'].includes(p.hook_event_name) && typeof p.turn_id === 'string') {
      for (const [id,h] of this.held) if (h.session === session && h.turn === p.turn_id) this.settle(id,'defer');
    }
    this.emit('hook', p);
    if (p.hook_event_name !== 'PermissionRequest' || !this.approvals()) return void socket.end('{}\n');
    const id = `codex-approval:${randomUUID()}`;
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
    const readable = typeof input.command === 'string' ? input.command : JSON.stringify(input);
    const ask: Ask = { id, tool: typeof p.tool_name === 'string' ? p.tool_name.slice(0,120) : 'Codex operation', command: readable.slice(0,4000), message: typeof input.description === 'string' ? input.description.slice(0,1000) : 'Codex is requesting permission for this operation.', at: Date.now(), answerable: true };
    this.held.set(id, { session, turn: typeof p.turn_id === 'string' ? p.turn_id : '', ask, socket, timer: setTimeout(() => this.settle(id, 'defer'), this.timeout) });
    socket.on('close', () => this.settle(id, 'defer'));
    this.changed(session);
  }
  requests(session: string) { return [...this.held.values()].filter(h => h.session === session).map(h => h.ask); }
  private changed(session: string) { this.emit('requests', session, this.requests(session)); }
  decide(session: string, id: string, decision: ApprovalDecision): void {
    const h = this.held.get(id);
    if (!h || h.session !== session || !this.enabled() || !this.approvals()) throw new Error('This Codex approval has expired. Continue in Codex.');
    if (!['allow','deny','defer'].includes(decision)) throw new Error('Unknown decision.');
    this.settle(id, decision);
  }
  private settle(id: string, decision: ApprovalDecision) {
    const h = this.held.get(id); if (!h) return;
    this.held.delete(id); clearTimeout(h.timer);
    if (!h.socket.destroyed) h.socket.end(JSON.stringify({ decision: decision === 'defer' ? null : decision }) + '\n');
    this.changed(h.session);
    this.emit('answered', h.session, decision);
  }
  releaseTurn(session: string, turn: string) { for (const [id,h] of this.held) if (h.session === session && h.turn === turn) this.settle(id,'defer'); }
  releaseSession(session: string) { for (const [id,h] of this.held) if (h.session === session) this.settle(id,'defer'); }
  releaseAll() { for (const id of this.held.keys()) this.settle(id,'defer'); }
  stop() { this.releaseAll(); this.server?.close(); this.server = null; fs.rmSync(this.socketPath,{force:true}); }
}
