#!/usr/bin/env node
/**
 * The Claude Code hook client.
 *
 * Reads a hook payload on stdin, hands it to the Notchlight daemon over a
 * unix socket, and — only for a tool call the daemon has been configured to
 * gate — waits for the island to answer.
 *
 * The rule this file exists to keep: Notchlight being down, slow, wedged, or
 * half-uninstalled must never change how Claude Code behaves. Every failure
 * path exits 0 with no output, which is exactly what a machine without this app
 * installed does.
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.notchlight');
const SOCK = path.join(DIR, 'notchlight.sock');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

/**
 * Exit, having actually delivered the answer.
 *
 * stdout to a pipe is asynchronous on macOS, so `write` then `exit` in the same
 * tick can truncate the JSON — and a half-written permission decision is worse
 * than none at all. Wait for the flush, with a short deadline so a wedged pipe
 * still cannot hold Claude Code up.
 */
function done(out) {
  if (!out) process.exit(0);
  let left = true;
  const go = () => {
    if (!left) return;
    left = false;
    process.exit(0);
  };
  setTimeout(go, 250).unref?.();
  process.stdout.write(out, go);
}

const raw = await readStdin();
let payload;
try {
  payload = JSON.parse(raw || '{}');
} catch {
  done('');
}

const event = payload.hook_event_name || '';
const cfg = readConfig();
const gateTools = Array.isArray(cfg.gateTools) ? cfg.gateTools : [];
// Only a PreToolUse for a gated tool can produce an answer worth waiting for.
// Everything else is told and forgotten.
const waiting = event === 'PreToolUse' && gateTools.includes(payload.tool_name);
const waitMs = waiting ? (cfg.gateTimeoutSec ?? 55) * 1000 + 5000 : 400;

if (!fs.existsSync(SOCK)) done('');

const sock = net.createConnection(SOCK);
let settled = false;
let buf = '';

const finish = (out) => {
  if (settled) return;
  settled = true;
  try {
    sock.destroy();
  } catch {
    /* already gone */
  }
  done(out);
};

const connectTimer = setTimeout(() => finish(''), 600);
const waitTimer = setTimeout(() => finish(''), waitMs);

sock.on('connect', () => {
  clearTimeout(connectTimer);
  sock.write(JSON.stringify(payload) + '\n');
  // Nothing to wait for: give the write a moment to land, then get out of the
  // way. A hook that lingers is a hook that shows up in Claude Code's latency.
  if (!waiting) setTimeout(() => finish(''), 120);
});

sock.on('data', (d) => {
  buf += d.toString('utf8');
  const nl = buf.indexOf('\n');
  if (nl < 0) return;
  clearTimeout(waitTimer);
  let answer;
  try {
    answer = JSON.parse(buf.slice(0, nl));
  } catch {
    return finish('');
  }
  const decision = answer?.decision;
  // An empty answer is the daemon saying "I timed out too" — which means Claude
  // Code should ask in the terminal, exactly as it would have anyway.
  if (decision !== 'allow' && decision !== 'deny') return finish('');
  finish(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: answer.reason || 'Answered at the Notchlight island.'
      }
    })
  );
});

sock.on('error', () => finish(''));
sock.on('close', () => finish(''));
