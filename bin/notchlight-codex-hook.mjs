#!/usr/bin/env node
// Codex hooks: https://learn.chatgpt.com/docs/hooks
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const started = Date.now();
// NOTCHLIGHT_HOME lets an isolated smoke test point the client at its own socket.
const dir = process.env.NOTCHLIGHT_HOME && path.isAbsolute(process.env.NOTCHLIGHT_HOME) ? process.env.NOTCHLIGHT_HOME : path.join(os.homedir(), '.notchlight');
let fallback = '';

function done(output = fallback) {
  if (!output) process.exit(0);
  // A piped stdout is asynchronous on macOS. Exit only after its write flushes.
  setTimeout(() => process.exit(0), 250).unref();
  process.stdout.once('error', () => process.exit(0));
  process.stdout.write(output, () => process.exit(0));
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let input = '';
    const finish = () => {
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', finish);
      process.stdin.removeListener('error', finish);
      resolve(input);
    };
    const onData = (chunk) => { input += chunk; };
    const timer = setTimeout(finish, 1500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
}

function approvalsEnabled() {
  try {
    const { preferences } = JSON.parse(fs.readFileSync(path.join(dir, 'companion.json'), 'utf8'));
    return preferences?.codexEnabled === true && preferences?.codexApprovals === true;
  } catch {
    return false;
  }
}

async function main() {
  const payload = JSON.parse(await readStdin());
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return done();
  const event = payload.hook_event_name;
  fallback = event === 'Stop' || event === 'SubagentStop' ? '{}' : '';
  const waiting = event === 'PermissionRequest' && approvalsEnabled();

  // The parent may be a shell, so it is a reporter, never an inferred owner.
  const envelope = { ...payload, provider: 'codex', reporterPid: process.ppid };
  const sock = net.createConnection(path.join(dir, 'codex.sock'));
  let settled = false;
  let buffer = '';
  const finish = (output = fallback) => {
    if (settled) return;
    settled = true;
    clearTimeout(connectTimer);
    clearTimeout(waitTimer);
    sock.destroy();
    done(output);
  };
  const connectTimer = setTimeout(() => finish(), 600);
  const waitTimer = setTimeout(() => finish(), waiting ? Math.max(1, 56000 - (Date.now() - started)) : 400);

  sock.setEncoding('utf8');
  sock.on('connect', () => {
    clearTimeout(connectTimer);
    sock.write(JSON.stringify(envelope) + '\n', (error) => {
      if (error || !waiting) finish();
    });
  });
  const answer = (line) => {
    try {
      const response = JSON.parse(line);
      if (response?.decision !== 'allow' && response?.decision !== 'deny') return finish();
      const decision = { behavior: response.decision };
      const message = response.message ?? response.reason;
      if (typeof message === 'string') decision.message = message;
      finish(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
    } catch {
      finish();
    }
  };
  sock.on('data', (chunk) => {
    if (!waiting) return;
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline >= 0) answer(buffer.slice(0, newline));
  });
  sock.on('end', () => {
    if (waiting && buffer.trim()) answer(buffer);
    else finish();
  });
  sock.on('error', () => finish());
  sock.on('close', () => finish());
}

main().catch(() => done());
