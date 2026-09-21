/**
 * Electron's shape, for the checks that never open a window.
 *
 * scripts/test-displays.mjs exercises the pure choosers in notchWindow.ts, which
 * sits in a module that imports electron at the top. Nothing here is called; it
 * exists so the import resolves outside an Electron process.
 */
const missing = name => () => { throw new Error(`${name} is not available outside Electron.`); };
export const app = { isActive: () => false, getVersion: () => '0.0.0' };
export const BrowserWindow = class { constructor() { throw new Error('No windows in the display checks.'); } };
export const screen = { getAllDisplays: missing('screen.getAllDisplays'), getPrimaryDisplay: missing('screen.getPrimaryDisplay'), getCursorScreenPoint: missing('screen.getCursorScreenPoint'), getDisplayNearestPoint: missing('screen.getDisplayNearestPoint'), on: () => {} };
export default { app, BrowserWindow, screen };
