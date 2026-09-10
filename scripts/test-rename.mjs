import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateData } from '../bin/migrate-data.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notchlight-rename-'));
try {
  const old = path.join(home, '.claude-light');
  const current = path.join(home, '.notchlight');
  fs.mkdirSync(old);
  const preferences = '{"preferences":{"spotifyEnabled":true},"entries":[{"id":"file-1","path":"/tmp/example.pdf"}]}';
  fs.writeFileSync(path.join(old, 'companion.json'), preferences);
  fs.writeFileSync(path.join(old, 'config.json'), '{"gateTools":["Bash"]}');
  assert.equal(migrateData(home), current);
  assert.equal(fs.readFileSync(path.join(current, 'companion.json'), 'utf8'), preferences);
  assert.equal(fs.readFileSync(path.join(current, 'config.json'), 'utf8'), '{"gateTools":["Bash"]}');
  assert.equal(fs.realpathSync(old), fs.realpathSync(current));
  assert.equal(migrateData(home), current, 'migration is repeatable');
  fs.unlinkSync(old);
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'config.json'), 'old-data');
  assert.throws(() => migrateData(home), /Both old and new/);
  assert.equal(fs.readFileSync(path.join(old, 'config.json'), 'utf8'), 'old-data');
  assert.equal(fs.readFileSync(path.join(current, 'companion.json'), 'utf8'), preferences);
  fs.rmSync(old, { recursive: true });
  fs.rmSync(current, { recursive: true });
  migrateData(home);
  assert.ok(fs.existsSync(current));
  assert.ok(!fs.existsSync(old), 'fresh installations do not create legacy aliases');
  console.log('Rename checks passed: preserved preferences, shelf and gates; repeatable migration; no overwrite; clean fresh install.');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
