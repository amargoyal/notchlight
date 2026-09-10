#!/usr/bin/env node
/**
 * Wires notchlight-hook into ~/.claude/settings.json, or a project's own settings with
 * --project. Idempotent, keeps every hook that is already there, and writes a
 * backup of the file it is about to change.
 *
 *   node bin/install-hooks.mjs [--project] [--remove]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, 'notchlight-hook.mjs');
const remove = process.argv.includes('--remove');
const target = process.argv.includes('--project')
  ? path.join(process.cwd(), '.claude', 'settings.json')
  : path.join(os.homedir(), '.claude', 'settings.json');

/**
 * PreToolUse is here for the green light, not for gating: it is what makes the
 * island react the instant a tool starts. It only ever blocks when a tool name
 * has been added to `gateTools` in ~/.notchlight/config.json, which is empty
 * by default — so the generous timeout below costs nothing until you opt in.
 */
function gateTimeout() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.notchlight', 'config.json'), 'utf8'));
    return (c.gateTimeoutSec ?? 55) + 8;
  } catch {
    return 63;
  }
}

const EVENTS = {
  SessionStart: 5,
  UserPromptSubmit: 5,
  PreToolUse: gateTimeout(),
  PostToolUse: 5,
  Notification: 5,
  Stop: 5,
  SessionEnd: 5
};

const isOurs = (h) => typeof h?.command === 'string' && (h.command.includes('notchlight-hook.mjs') || h.command.includes('cl-hook.mjs'));

let settings = {};
if (fs.existsSync(target)) {
  const text = fs.readFileSync(target, 'utf8');
  try {
    settings = JSON.parse(text);
  } catch (e) {
    console.error(`${target} is not valid JSON — refusing to touch it. (${e.message})`);
    process.exit(1);
  }
  fs.writeFileSync(target + '.notchlight-backup', text);
}
settings.hooks = settings.hooks || {};

for (const [event, timeout] of Object.entries(EVENTS)) {
  const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  // Strip any previous entry of ours first, so installing twice is a no-op.
  for (const g of groups) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => !isOurs(h));
  let next = groups.filter((g) => Array.isArray(g.hooks) && g.hooks.length > 0);
  if (!remove) {
    // Quoted: a checkout under a path with a space in it is not exotic.
    const entry = { type: 'command', command: `node "${HOOK}"`, timeout };
    const star = next.find((g) => g.matcher === '*' || g.matcher === undefined);
    if (star) star.hooks.push(entry);
    else next = [...next, { matcher: '*', hooks: [entry] }];
  }
  if (next.length) settings.hooks[event] = next;
  else delete settings.hooks[event];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(settings, null, 2) + '\n');
console.log(`${remove ? 'Removed' : 'Installed'} Notchlight hooks in ${target}`);
if (!remove) console.log('Backup at ' + target + '.notchlight-backup');
