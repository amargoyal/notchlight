import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Run only after stopping the previous service. Never merge or overwrite data. */
export function migrateData(home = os.homedir()) {
  const previous = path.join(home, '.claude-light');
  const current = path.join(home, '.notchlight');
  const old = fs.lstatSync(previous, { throwIfNoEntry: false });
  if (old?.isSymbolicLink()) {
    if (fs.realpathSync(previous) !== fs.realpathSync(current)) throw new Error('Previous data alias points elsewhere; resolve it before installing.');
    return current;
  }
  if (old) {
    if (fs.existsSync(current)) throw new Error('Both old and new data directories exist. Resolve them before installing; no data was overwritten.');
    fs.renameSync(previous, current);
  } else {
    fs.mkdirSync(current, { recursive: true });
  }
  // Cached commands and older tooling can still find the same saved data.
  if (old) fs.symlinkSync(current, previous, 'dir');
  return current;
}
