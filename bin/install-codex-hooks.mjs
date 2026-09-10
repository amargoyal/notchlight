#!/usr/bin/env node
// Install only Notchlight's Codex hooks; hook trust remains Codex's responsibility.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const script = fileURLToPath(import.meta.url);
const hook = path.join(path.dirname(script), 'notchlight-codex-hook.mjs');
const events = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PermissionRequest', 'Interrupt', 'SubagentStart', 'SubagentStop', 'Stop'
];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isOurs = (handler) => typeof handler?.command === 'string'
  && /(?:^|[/\\\s"'])notchlight-codex-hook\.mjs(?=$|[\s"'])/.test(handler.command);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

export function installCodexHooks(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), remove = false) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('--home must be an absolute path.');
  const target = path.join(home, 'hooks.json');
  let original;
  let mode = 0o600;
  try {
    original = fs.readFileSync(target, 'utf8');
    mode = fs.statSync(target).mode & 0o777;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let settings;
  try {
    settings = original === undefined ? {} : JSON.parse(original);
  } catch (error) {
    throw new Error(`${target} is not valid JSON; refusing to change it. (${error.message})`);
  }
  if (!isObject(settings) || (Object.hasOwn(settings, 'hooks') && !isObject(settings.hooks))) {
    throw new Error(`${target} must contain an object with an optional hooks object; refusing to change it.`);
  }
  const before = structuredClone(settings);
  const hooks = settings.hooks ?? {};
  // Remove our handlers from every event, preserving other handlers and metadata.
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    let changed = false;
    const next = groups.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const handlers = group.hooks.filter((handler) => !isOurs(handler));
      if (handlers.length === group.hooks.length) return [group];
      changed = true;
      if (!handlers.length && Object.keys(group).every((key) => key === 'hooks' || key === 'matcher')) return [];
      return [{ ...group, hooks: handlers }];
    });
    if (changed) {
      if (next.length) hooks[event] = next;
      else delete hooks[event];
    }
  }
  if (!remove) {
    for (const event of events) {
      if (Object.hasOwn(hooks, event) && !Array.isArray(hooks[event])) {
        throw new Error(`${target}: hooks.${event} must be an array; refusing to change it.`);
      }
      hooks[event] ??= [];
      hooks[event].push({
        hooks: [{ type: 'command', command: `node ${quote(hook)}`, timeout: event === 'PermissionRequest' ? 63 : 3 }]
      });
    }
    settings.hooks = hooks;
  } else if (Object.keys(hooks).length === 0 && Object.keys(before.hooks ?? {}).length > 0) {
    delete settings.hooks;
  }
  if (isDeepStrictEqual(before, settings)) return { target, changed: false, backup: null, remove };

  fs.mkdirSync(home, { recursive: true });
  const suffix = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  const backup = original === undefined ? null : `${target}.notchlight-backup-${suffix}`;
  const temporary = `${target}.notchlight-tmp-${suffix}`;
  if (backup) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', mode);
    fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, JSON.stringify(settings, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
  return { target, changed: true, backup, remove };
}

function main() {
  let home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  let remove = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remove') remove = true;
    else if (args[i] === '--home' && args[i + 1]) home = args[++i];
    else throw new Error('Usage: node bin/install-codex-hooks.mjs [--home ABSOLUTE_PATH] [--remove]');
  }
  const result = installCodexHooks(home, remove);
  console.log(`${result.changed ? (remove ? 'Removed' : 'Installed') : 'Already up to date:'} Notchlight Codex hooks in ${result.target}`);
  if (result.backup) console.log(`Backup: ${result.backup}`);
  if (!remove) console.log('Review and trust the new or changed hooks with /hooks in Codex.');
  console.log('Reload or restart your Codex session to pick up hook changes.');
}

let isEntry = false;
try {
  isEntry = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(script);
} catch { /* Importing the installer must not run its CLI. */ }
if (isEntry) {
  try { main(); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
