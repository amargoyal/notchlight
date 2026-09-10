/**
 * The write side: Claude Code's hooks, over a unix socket.
 *
 * Transcripts say what happened; hooks say when, instantly, and they are the
 * only thing that can tell a long tool call apart from a question waiting for
 * an answer. That distinction is the difference between a green light and a
 * yellow one, which is most of this product.
 *
 * The socket is line-delimited JSON in both directions. Almost every event is
 * fire and forget — the client writes and disconnects. The one exception is a
 * gated PreToolUse, where the connection is held open until the island decides
 * or the deadline passes.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import { SOCK, config, ensureDir } from './config';
import { logEvent } from './lifecycle';

export interface HookEvent {
  event: string;
  sessionId: string;
  cwd?: string;
  transcript?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  message?: string;
  prompt?: string;
  reason?: string;
  /** The `claude` process the hook ran under, reported by the hook client. */
  pid?: number;
}

export type Decision = 'allow' | 'deny';

interface Held {
  id: string;
  sessionId: string;
  tool: string;
  input: Record<string, unknown>;
  socket: net.Socket;
  timer: NodeJS.Timeout;
}

let gateSeq = 0;

export class HookServer extends EventEmitter {
  private server: net.Server | null = null;
  private held = new Map<string, Held>();

  start(): void {
    ensureDir();
    // A socket file left behind by a crash makes bind fail with EADDRINUSE.
    // Electron's single-instance lock upstream of this already guarantees no
    // other copy is running, so a file here is debris and gets cleared.
    try {
      if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK);
    } catch {
      /* the bind below will report it properly */
    }
    const server = net.createServer((sock) => this.session(sock));
    server.on('error', (e) => logEvent('hooks', (e as Error).message));
    server.listen(SOCK, () => {
      try {
        fs.chmodSync(SOCK, 0o600);
      } catch {
        /* best effort — the socket is under the user's own home either way */
      }
      logEvent('hooks', 'listening on ' + SOCK);
    });
    this.server = server;
  }

  private session(sock: net.Socket): void {
    let buf = '';
    let handled = false;
    sock.setEncoding('utf8');
    // A client that connects and then says nothing would otherwise hold a
    // socket and a file descriptor for the life of the daemon. A hook payload
    // arrives in one write; ten seconds is a very long time to wait for it.
    const idle = setTimeout(() => {
      if (!handled) sock.destroy();
    }, 10_000);
    idle.unref();
    sock.on('close', () => clearTimeout(idle));
    sock.on('error', () => sock.destroy());
    sock.on('data', (chunk) => {
      if (handled) return;
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) {
        // A hook payload is one line. Anything unbounded is not one of ours.
        if (buf.length > 1_000_000) sock.destroy();
        return;
      }
      handled = true;
      clearTimeout(idle);
      let payload: any;
      try {
        payload = JSON.parse(buf.slice(0, nl));
      } catch {
        return sock.end();
      }
      this.dispatch(payload, sock);
    });
  }

  private dispatch(p: any, sock: net.Socket): void {
    const e: HookEvent = {
      event: String(p?.hook_event_name ?? ''),
      sessionId: String(p?.session_id ?? ''),
      cwd: typeof p?.cwd === 'string' ? p.cwd : undefined,
      transcript: typeof p?.transcript_path === 'string' ? p.transcript_path : undefined,
      toolName: typeof p?.tool_name === 'string' ? p.tool_name : undefined,
      toolInput: p?.tool_input && typeof p.tool_input === 'object' ? p.tool_input : undefined,
      message: typeof p?.message === 'string' ? p.message : undefined,
      prompt: typeof p?.prompt === 'string' ? p.prompt : undefined,
      reason: typeof p?.reason === 'string' ? p.reason : undefined,
      pid: Number.isInteger(p?.notchlight?.pid) && p.notchlight.pid > 1 ? p.notchlight.pid : undefined
    };
    if (!e.event || !e.sessionId) return void sock.end();

    const gated =
      e.event === 'PreToolUse' && !!e.toolName && config().gateTools.includes(e.toolName);

    if (!gated) {
      this.emit('hook', e);
      return void sock.end();
    }
    this.hold(e, sock);
  }

  /**
   * Hold a tool call open while the island shows it.
   *
   * The deadline is the safety net, and it is not optional: without one, an
   * island that never answers — because the window died, because the user
   * walked away — would wedge Claude Code until its own hook timeout fired.
   * Timing out answers nothing, which lets Claude Code fall back to asking in
   * the terminal exactly as it would with this app uninstalled.
   */
  private hold(e: HookEvent, sock: net.Socket): void {
    const id = 'gate-' + ++gateSeq;
    const timer = setTimeout(() => this.settle(id, null), config().gateTimeoutSec * 1000);
    const held: Held = {
      id,
      sessionId: e.sessionId,
      tool: e.toolName || '',
      input: e.toolInput || {},
      socket: sock,
      timer
    };
    this.held.set(id, held);
    sock.on('close', () => {
      // Claude Code gave up on its side; stop showing a question nobody is
      // waiting on the answer to.
      const still = this.held.get(id);
      if (still) {
        clearTimeout(still.timer);
        this.held.delete(id);
        this.emit('gate-gone', id);
      }
    });
    this.emit('gate', { ...e, gateId: id });
  }

  /** Answer a held call. Unknown ids are stale clicks and are ignored. */
  decide(id: string, decision: Decision): void {
    this.settle(id, decision);
  }

  /**
   * Let a held call go without answering it.
   *
   * Answering nothing is not a refusal — Claude Code falls straight through to
   * its own permission prompt, which is exactly what it would do if this app
   * were not installed. It is the safe way to drop a question the island can no
   * longer show.
   */
  release(id: string): void {
    this.settle(id, null);
  }

  /** A session ended with calls still held — let them fall through to Claude. */
  releaseSession(sessionId: string): void {
    for (const [id, h] of this.held) if (h.sessionId === sessionId) this.settle(id, null);
  }

  private settle(id: string, decision: Decision | null): void {
    const h = this.held.get(id);
    if (!h) return;
    clearTimeout(h.timer);
    this.held.delete(id);
    const reply = decision
      ? {
          decision,
          reason:
            decision === 'allow' ? 'Allowed from the Notchlight island.' : 'Denied from the Notchlight island.'
        }
      : {};
    try {
      h.socket.write(JSON.stringify(reply) + '\n');
      h.socket.end();
    } catch {
      /* the client is gone; the timeout on its side does the same thing */
    }
    this.emit('gate-done', id, decision);
  }

  stop(): void {
    for (const id of [...this.held.keys()]) this.settle(id, null);
    this.server?.close();
    this.server = null;
    try {
      fs.unlinkSync(SOCK);
    } catch {
      /* already gone */
    }
  }
}
