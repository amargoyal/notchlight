#!/usr/bin/env node
/**
 * Run Notchlight as a login item, so it survives closing the terminal.
 *
 *   node bin/service.mjs install     build, write the LaunchAgent, start it
 *   node bin/service.mjs restart     rebuild and kick it
 *   node bin/service.mjs status      is it loaded, is it alive
 *   node bin/service.mjs logs        tail what it has written
 *   node bin/service.mjs uninstall   stop it and remove the LaunchAgent
 *
 * launchd rather than `nohup … &`: a backgrounded shell job dies with the
 * session on some terminal configurations, does not come back after a reboot,
 * and has nowhere to put its output. A LaunchAgent starts at login, restarts if
 * it crashes, and keeps a log.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateData } from './migrate-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'com.notchlight.island';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), '.notchlight');
const LOG = path.join(LOG_DIR, 'island.log');
const TARGET = `gui/${process.getuid()}`;

const cmd = process.argv[2] || 'status';

/** The Electron binary inside node_modules, which runs this directory as an app. */
function electronBinary() {
  const p = path.join(ROOT, 'node_modules', 'electron', 'path.txt');
  if (!fs.existsSync(p)) fail('Electron is not installed. Run `npm install` first.');
  return path.join(ROOT, 'node_modules', 'electron', 'dist', fs.readFileSync(p, 'utf8').trim());
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function launchctl(args, { quiet = true } = {}) {
  return spawnSync('launchctl', args, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
}

function build() {
  console.log('building…');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
}

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writePlist() {
  const bin = electronBinary();
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  // swiftc has to be reachable or the cutout cannot be measured, and launchd
  // hands a job almost nothing — so PATH is spelled out rather than inherited.
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(bin)}</string>
    <string>${xml(ROOT)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`;
  fs.writeFileSync(PLIST, plist);
}

function runningPid() {
  const r = launchctl(['print', `${TARGET}/${LABEL}`]);
  const pid = r.status === 0 ? /\bpid = (\d+)/.exec(r.stdout)?.[1] : null;
  return pid ? Number(pid) : null;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/**
 * Stop, and wait for the old process to actually be gone.
 *
 * `bootout` returns before the job has finished quitting. The new copy holds
 * the same single-instance lock, so starting it while the old one is still on
 * its way out makes the new one exit cleanly on the spot — and a clean exit is
 * exactly what KeepAlive is told not to restart. The result was a restart that
 * left nothing running.
 */
async function stop() {
  const pid = runningPid();
  // `bootout` on a job that is not loaded returns non-zero; that is a no-op,
  // not a failure, so its output is swallowed.
  launchctl(['bootout', `${TARGET}/${LABEL}`]);
  if (!pid) return;
  const deadline = Date.now() + 8000;
  while (alive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (alive(pid)) {
    process.kill(pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

function migratePreviousService() {
  const previousLabel = 'com.claudelight.island';
  const previousPlist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${previousLabel}.plist`);
  if (launchctl(['print', `${TARGET}/${previousLabel}`]).status === 0) {
    const result = launchctl(['bootout', `${TARGET}/${previousLabel}`]);
    if (result.status !== 0) fail('Could not stop the previous service: ' + result.stderr);
  }
  const directory = migrateData();
  if (fs.existsSync(previousPlist)) {
    const backup = path.join(directory, 'migration');
    fs.mkdirSync(backup, { recursive: true });
    fs.renameSync(previousPlist, path.join(backup, `${previousLabel}.${Date.now()}.plist`));
  }
}

async function start() {
  let r;
  // bootout can return before launchd finishes removing the previous job.
  // A valid plist can briefly fail bootstrap with EIO during that teardown.
  for (let attempt = 0; attempt < 8; attempt++) {
    r = launchctl(['bootstrap', TARGET, PLIST]);
    if (r.status === 0) return;
    if (r.status !== 5 || attempt === 7) break;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  if (r.status !== 0) fail('launchctl bootstrap failed: ' + (r.stderr || r.stdout || r.status));
}

switch (cmd) {
  case 'install': {
    build();
    await stop();
    migratePreviousService();
    writePlist();
    await start();
    console.log(`installed ${LABEL}`);
    console.log(`  plist  ${PLIST}`);
    console.log(`  log    ${LOG}`);
    console.log('It starts at login from now on. `node bin/service.mjs uninstall` undoes this.');
    break;
  }
  case 'restart': {
    build();
    await stop();
    migratePreviousService();
    writePlist();
    await start();
    console.log('restarted');
    break;
  }
  case 'uninstall': {
    await stop();
    fs.rmSync(PLIST, { force: true });
    console.log(`removed ${LABEL}`);
    break;
  }
  case 'logs': {
    if (!fs.existsSync(LOG)) fail('No log yet at ' + LOG);
    spawnSync('tail', ['-n', '80', '-f', LOG], { stdio: 'inherit' });
    break;
  }
  case 'status': {
    if (!fs.existsSync(PLIST)) {
      console.log('not installed');
      break;
    }
    const r = launchctl(['print', `${TARGET}/${LABEL}`]);
    if (r.status !== 0) {
      console.log('installed, not loaded');
      break;
    }
    const pid = /\bpid = (\d+)/.exec(r.stdout)?.[1];
    const state = /\bstate = (\S+)/.exec(r.stdout)?.[1];
    const runs = /\bruns = (\d+)/.exec(r.stdout)?.[1];
    const lastExit = /last exit code = ([^\n]+)/.exec(r.stdout)?.[1]?.trim();
    console.log(pid ? `running · pid ${pid}` : `loaded · ${state ?? 'not running'}`);
    if (runs) console.log(`runs ${runs}${lastExit && lastExit !== '(never exited)' ? ` · last exit ${lastExit}` : ''}`);
    if (pid) {
      const tree = spawnSync('ps', ['-Ao', 'pid=,ppid=,%cpu=,rss=,comm='], { encoding: 'utf8' }).stdout.split('\n')
        .map(line => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
        .filter(m => m[2] === pid).map(m => ({ pid: m[1], cpu: Number(m[3]), rss: Math.round(Number(m[4]) / 1024), comm: m[5].trim() }));
      for (const child of tree) console.log(`  ${child.comm.endsWith('audiotap') ? 'audiotap' : child.comm.endsWith('spotifywatch') ? 'spotifywatch' : /Renderer/.test(child.comm) ? 'renderer' : /osascript/.test(child.comm) ? 'osascript' : 'helper'} pid ${child.pid} · ${child.cpu.toFixed(1)}% · ${child.rss} MB`);
    }
    console.log('log ' + LOG);
    console.log('`node scripts/native-check.mjs measure` samples CPU over an interval.');
    break;
  }
  default:
    fail(`unknown command: ${cmd}\nuse install | restart | status | logs | uninstall`);
}
