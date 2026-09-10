#!/usr/bin/env node
/**
 * The native check: what the running service actually costs, and what it saw.
 *
 *   node scripts/native-check.mjs measure [--seconds 30] [--label idle]
 *       Sample the launchd service's process tree for a fixed interval and
 *       report CPU per process, peak memory, audio helper starts, socket
 *       health and renderer crashes. Prints a markdown row for the record in
 *       docs/native-checks.md.
 *
 *   node scripts/native-check.mjs log [--since 15m]
 *       Show the lifecycle lines the service wrote recently — power, display,
 *       levels, spotify — so a manual sleep/wake, display or Spotify step can
 *       be confirmed from what the app logged rather than from what it looked
 *       like.
 *
 *   node scripts/native-check.mjs socket
 *       Connect to the hook socket and report whether it accepts.
 *
 * Everything here is read-only: it never toggles Spotify, never restarts the
 * service and never writes outside stdout.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const LABEL = 'com.notchlight.island';
const APP_DIR = path.join(os.homedir(), '.notchlight');
const LOG = path.join(APP_DIR, 'island.log');
const SOCK = path.join(APP_DIR, 'notchlight.sock');
const LINE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[([a-z]+)\] (.*)$/;

const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('--')) || 'measure';
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };

function servicePid() {
  const r = spawnSync('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const pid = /\bpid = (\d+)/.exec(r.stdout)?.[1];
  return pid ? Number(pid) : null;
}

/** Every descendant of the service, found through ppid rather than by name. */
function processTree(root) {
  const out = spawnSync('ps', ['-Ao', 'pid=,ppid=,rss=,cputime=,comm='], { encoding: 'utf8' }).stdout;
  const rows = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), cpu: seconds(m[4]), comm: m[5].trim() });
  }
  const tree = new Map();
  const grow = pid => {
    for (const row of rows) if (row.ppid === pid && !tree.has(row.pid)) { tree.set(row.pid, row); grow(row.pid); }
  };
  const self = rows.find(r => r.pid === root);
  if (self) tree.set(root, self);
  grow(root);
  return tree;
}

/** `M:SS.ss` or `H:MM:SS` from ps into seconds. */
function seconds(cputime) {
  return cputime.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function role(row, root) {
  if (row.comm.endsWith('/audiotap')) return 'audiotap';
  if (row.comm.endsWith('/notchprobe')) return 'notchprobe';
  if (row.comm.endsWith('/spotifywatch')) return 'spotifywatch';
  if (/osascript$/.test(row.comm)) return 'osascript';
  if (row.pid === root) return 'main';
  const args = spawnSync('ps', ['-o', 'args=', '-p', String(row.pid)], { encoding: 'utf8' }).stdout;
  const type = /--type=([a-z-]+)/.exec(args)?.[1];
  // Gone before we could ask: a short-lived child such as ps, lsof or swiftc.
  if (!type) return path.basename(row.comm) || 'transient';
  if (type === 'utility') return /utility-sub-type=([a-z.]+)/.exec(args)?.[1]?.split('.')[0] ?? 'utility';
  return type;
}

function readLog(sinceMs) {
  if (!fs.existsSync(LOG)) return [];
  const events = [];
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const at = Date.parse(m[1]);
    if (Number.isFinite(at) && at >= sinceMs) events.push({ at, tag: m[2], message: m[3] });
  }
  return events;
}

function socketAccepts() {
  return new Promise(resolve => {
    const sock = net.connect(SOCK);
    const done = ok => { sock.destroy(); resolve(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 2000).unref();
  });
}

function spotifyPlaying() {
  // Read-only. Asks Spotify's own dictionary whether it is playing; never toggles anything.
  try {
    const out = execFileSync('/usr/bin/osascript', ['-e', 'tell application "System Events" to (name of processes) contains "Spotify"'], { encoding: 'utf8', timeout: 4000 }).trim();
    if (out !== 'true') return 'not running';
    return execFileSync('/usr/bin/osascript', ['-e', 'tell application "Spotify" to player state as string'], { encoding: 'utf8', timeout: 4000 }).trim();
  } catch { return 'unknown'; }
}

const duration = ms => ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
const parseSpan = text => { const m = /^(\d+)([smh])$/.exec(text); return m ? Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[m[2]] : 15 * 60_000; };

async function measure() {
  const total = Number(option('seconds', 30));
  const label = option('label', '');
  const pid = servicePid();
  if (!pid) { console.error('The service is not running. `node bin/service.mjs status`'); process.exit(1); }
  const startedAt = Date.now();
  const before = processTree(pid);
  const seen = new Map();
  const helpers = new Set();
  let peakRss = 0;
  const sample = () => {
    const tree = processTree(pid);
    let rss = 0;
    for (const row of tree.values()) {
      rss += row.rss;
      if (!seen.has(row.pid)) seen.set(row.pid, { ...row, role: role(row, pid), first: row.cpu });
      seen.get(row.pid).last = row.cpu;
      if (row.comm.endsWith('/audiotap')) helpers.add(row.pid);
    }
    peakRss = Math.max(peakRss, rss);
  };
  sample();
  process.stderr.write(`sampling pid ${pid} for ${total}s`);
  for (let i = 0; i < total; i++) {
    await new Promise(r => setTimeout(r, 1000));
    sample();
    if (i % 5 === 4) process.stderr.write('.');
  }
  process.stderr.write('\n');
  const elapsed = (Date.now() - startedAt) / 1000;
  const rows = [...seen.values()].map(r => ({ ...r, percent: ((r.last - (before.get(r.pid)?.cpu ?? r.first)) / elapsed) * 100 }))
    .sort((a, b) => b.percent - a.percent);
  const events = readLog(startedAt);
  const starts = events.filter(e => e.tag === 'levels' && e.message.startsWith('helper start')).length;
  const crashes = events.filter(e => e.tag === 'island' && e.message.startsWith('renderer gone')).length;
  const socket = await socketAccepts();
  const playing = spotifyPlaying();
  const sum = rows.reduce((n, r) => n + r.percent, 0);
  console.log(`\nNotchlight service pid ${pid} · ${elapsed.toFixed(0)}s · Spotify ${playing}${label ? ` · ${label}` : ''}\n`);
  console.log('| process | pid | CPU % | RSS MB |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.role} | ${r.pid} | ${r.percent.toFixed(1)} | ${(r.rss / 1024).toFixed(0)} |`);
  console.log(`| **total** | | **${sum.toFixed(1)}** | peak ${(peakRss / 1024).toFixed(0)} |`);
  console.log(`\naudio helper: ${helpers.size} process${helpers.size === 1 ? '' : 'es'} seen, ${starts} start${starts === 1 ? '' : 's'} logged`);
  console.log(`renderer crashes: ${crashes}`);
  console.log(`hook socket: ${socket ? 'accepts' : 'REFUSED'}`);
  const date = new Date().toISOString().slice(0, 10);
  console.log(`\nrecord row:\n| ${date} | ${label || (playing === 'playing' ? 'playing' : 'idle')} | ${elapsed.toFixed(0)}s | ${sum.toFixed(1)}% | ${(peakRss / 1024).toFixed(0)} MB | ${helpers.size} / ${starts} | ${crashes} | ${socket ? 'ok' : 'refused'} |`);
  if (!socket || crashes) process.exitCode = 1;
}

function showLog() {
  const since = Date.now() - parseSpan(option('since', '15m'));
  const events = readLog(since);
  if (!events.length) { console.log(`No lifecycle lines in the last ${duration(Date.now() - since)}. Is the service on a build that writes them?`); return; }
  const counts = {};
  for (const e of events) counts[e.tag] = (counts[e.tag] ?? 0) + 1;
  console.log(`${events.length} lines since ${new Date(since).toLocaleTimeString()} · ` + Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(' · ') + '\n');
  for (const e of events) console.log(`${new Date(e.at).toLocaleTimeString()}  ${e.tag.padEnd(10)} ${e.message}`);
}

switch (command) {
  case 'measure': await measure(); break;
  case 'log': showLog(); break;
  case 'socket': { const ok = await socketAccepts(); console.log(ok ? `accepts ${SOCK}` : `REFUSED ${SOCK}`); process.exitCode = ok ? 0 : 1; break; }
  default: console.error(`unknown command: ${command}\nuse measure | log | socket`); process.exit(1);
}
