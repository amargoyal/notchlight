#!/usr/bin/env node
/**
 * Native Codex smoke checks. Two modes, neither touches the real app or its
 * saved preferences:
 *
 *   node scripts/smoke-codex.mjs replay [CODEX_HOME]
 *     Read-only. Replays the rollouts already recorded under the given (or
 *     default) Codex home through the adapter and prints what the notch would
 *     show: provider, source label, status, title, subagents. Nothing is
 *     written to the Codex home.
 *
 *   node scripts/smoke-codex.mjs live [allow|deny|defer ...]
 *     Runs real `codex exec` tasks in an isolated CODEX_HOME (auth copied from
 *     your own home, hooks installed only there, trust bypassed for that home
 *     only) against an isolated workspace, with a private Notchlight socket
 *     that answers each PermissionRequest with the listed decisions in order.
 *     Verifies the harmless operation's outcome on disk for every decision.
 *     Uses your Codex quota; requires `codex` on PATH and an existing login.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { installCodexHooks } from '../bin/install-codex-hooks.mjs';

const mode = process.argv[2] || 'replay';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notchlight-smoke-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const realHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const label = (s) => `${s.provider}${s.source && s.source !== 'unknown' ? ` · ${s.source === 'desktop' ? 'Desktop' : 'CLI'}` : ''}`;
const describe = (s) => `${label(s).padEnd(16)} ${s.status.padEnd(11)} ${(s.title || s.project).slice(0, 48).padEnd(48)} agents=${s.agents.length} tokens=${s.tokensKnown === false ? '—' : s.tokens}`;

await build({ entryPoints: ['src/main/codex.ts', 'src/main/codexApprovals.ts'], bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, outdir: root, logLevel: 'silent' });
const require = createRequire(import.meta.url);
const { CodexAdapter } = require(path.join(root, 'codex.cjs'));
const { CodexApprovals } = require(path.join(root, 'codexApprovals.cjs'));

async function replay(home) {
  const adapter = new CodexAdapter();
  adapter.configure(true, home);
  try {
    // Each scan reads at most 8 MiB per file; a long-lived Desktop thread needs a few passes.
    for (let n = 0; n < 8; n++) adapter.scan();
    console.log(`Replaying ${home} (read-only) → ${adapter.health.state}: ${adapter.health.message}`);
    const sessions = adapter.sessions();
    if (!sessions.length) console.log('No sessions modified within the last three hours.');
    for (const s of sessions) {
      console.log(describe(s));
      for (const a of s.agents.filter((a) => a.kind === 'sub')) console.log(`    └ subagent ${a.title.slice(0, 40)} · ${a.status}`);
    }
    const bySource = sessions.reduce((m, s) => ((m[s.source] = (m[s.source] || 0) + 1), m), {});
    console.log('Sources:', JSON.stringify(bySource), '· statuses:', JSON.stringify(sessions.reduce((m, s) => ((m[s.status] = (m[s.status] || 0) + 1), m), {})));
  } finally { adapter.stop(); }
}

async function live(decisions) {
  const codexHome = path.join(root, 'codex-home');
  const notchHome = path.join('/tmp', `nl-smoke-${process.pid}`); // short: UNIX socket path limit
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(codexHome, { recursive: true }); fs.mkdirSync(notchHome, { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
  fs.copyFileSync(path.join(realHome, 'auth.json'), path.join(codexHome, 'auth.json'));
  fs.writeFileSync(path.join(notchHome, 'companion.json'), JSON.stringify({ preferences: { codexEnabled: true, codexApprovals: true } }));
  const installed = installCodexHooks(codexHome);
  console.log(`Hooks installed in isolated home: ${installed.target}`);

  const adapter = new CodexAdapter();
  const approvals = new CodexApprovals(path.join(notchHome, 'codex.sock'), () => true, () => true, 55_000);
  const log = [];
  const observed = { hooks: [], requests: [], statuses: new Set() };
  approvals.on('hook', (p) => { observed.hooks.push(p.hook_event_name); adapter.onHook(p); });
  approvals.on('requests', (id, requests) => adapter.setHeld(id, requests));
  approvals.on('answered', (id, decision) => { adapter.onAnswered(id, decision); log.push(`answered ${id} ${decision}`); });
  adapter.on('terminal', (id, turn) => approvals.releaseTurn(id, turn));
  adapter.on('change', () => { for (const s of adapter.sessions()) observed.statuses.add(`${s.source}:${s.status}`); });
  approvals.start();
  adapter.configure(true, codexHome);
  await wait(200);

  const results = [];
  try {
    for (const [index, decision] of decisions.entries()) {
      const target = `smoke-${index + 1}-${decision}.txt`;
      let answered = 0;
      const answerer = (id, requests) => {
        for (const ask of requests) {
          if (answered++) continue; // one decision per request; late clicks stay invalid
          observed.requests.push({ tool: ask.tool, command: ask.command.slice(0, 80) });
          log.push(`request ${ask.tool}: ${ask.command.slice(0, 60)}`);
          setTimeout(() => { try { approvals.decide(id, ask.id, decision); } catch (e) { log.push(`decide failed: ${e.message}`); } }, 150);
        }
      };
      approvals.on('requests', answerer);
      const prompt = `Run exactly this shell command and nothing else, then stop without asking questions: printf ok > ${target}`;
      const args = ['exec', '--skip-git-repo-check', '--dangerously-bypass-hook-trust', '-C', workspace, '-s', 'read-only', '-c', 'approval_policy="on-request"', '--json', prompt];
      const startedAt = Date.now();
      const child = spawn('codex', args, { env: { ...process.env, CODEX_HOME: codexHome, NOTCHLIGHT_HOME: notchHome }, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.end();
      let out = '', err = '';
      child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
      const code = await new Promise((r) => child.on('exit', r));
      approvals.off('requests', answerer);
      await wait(1500); for (let n = 0; n < 4; n++) adapter.scan();
      const events = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const written = fs.existsSync(path.join(workspace, target));
      const session = adapter.sessions()[0];
      results.push({ decision, code, ms: Date.now() - startedAt, requests: answered, written, status: session?.status, source: session?.source, events: events.map((e) => e.type).filter((t, i, a) => a.indexOf(t) === i) });
      for (const e of events.filter((e) => e.type === 'error' || e.type === 'turn.failed')) log.push(`${e.type}: ${JSON.stringify(e.message ?? e.error ?? e).slice(0, 240)}`);
      if (err.trim() && !/Reading additional input/.test(err)) log.push(`stderr: ${err.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`);
    }
  } finally {
    approvals.stop(); adapter.stop();
    fs.rmSync(notchHome, { recursive: true, force: true });
  }
  console.log('\nLive results (isolated CODEX_HOME, read-only sandbox, approval_policy=on-request):');
  for (const r of results) console.log(`  ${r.decision.padEnd(6)} exit=${r.code} ${String(r.ms).padStart(6)}ms requests=${r.requests} file written=${r.written} adapter=${r.source}:${r.status} events=${r.events.join(',')}`);
  console.log('Hook events seen:', JSON.stringify(observed.hooks.reduce((m, e) => ((m[e] = (m[e] || 0) + 1), m), {})));
  console.log('Statuses observed while running:', [...observed.statuses].join(', '));
  for (const line of log) console.log('  ·', line);
  const problems = [];
  for (const r of results) {
    if (r.decision === 'allow' && !r.written) problems.push('allow did not write the file');
    if (r.decision === 'deny' && r.written) problems.push('deny still wrote the file');
    if (r.requests === 0) problems.push(`${r.decision}: no PermissionRequest reached the companion`);
  }
  if (problems.length) { console.error('Problems:', problems.join('; ')); process.exitCode = 1; }
}

try {
  if (mode === 'replay') await replay(process.argv[3] || realHome);
  else if (mode === 'live') await live(process.argv.slice(3).length ? process.argv.slice(3) : ['allow', 'deny', 'defer']);
  else throw new Error('Usage: node scripts/smoke-codex.mjs replay [CODEX_HOME] | live [allow|deny|defer ...]');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
