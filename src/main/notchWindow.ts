/**
 * The overlay: full screen width, transparent, above the menu bar, and
 * click-through everywhere except the island itself.
 *
 * There is no text input anywhere in Notchlight, so unlike its ancestor this
 * window never takes the keyboard. Mouse events reach a non-focusable window
 * fine, which is the whole reason the Allow/Deny buttons can work without ever
 * stealing focus from the terminal you are actually typing in.
 */
import { BrowserWindow, screen, type Display } from 'electron';
import path from 'node:path';
import { config } from './config';
import { probeNotch, resetProbe } from './notchProbe';
import { logEvent } from './lifecycle';
import type { HitRect } from '../shared/types';

export class NotchWindow {
  win: BrowserWindow | null = null;
  private hit: HitRect = { x: 0, y: 0, w: 0, h: 0 };
  private engaged = false;
  private cursorPoll: NodeJS.Timeout | null = null;
  private levelPoll: NodeJS.Timeout | null = null;
  private settleTimer: NodeJS.Timeout | null = null;
  private display: Display | null = null;
  private pending = 0;
  private forceSettle = false;
  private lastSignature = '';

  constructor(
    private onHover: (inside: boolean) => void,
    private onDisplaysChanged: () => void = () => {}
  ) {
    // Bound once for the life of the process. Display events arrive in bursts —
    // waking a screen fires several — and each reposition re-measures the
    // cutout with a blocking subprocess, so settle first and measure once.
    screen.on('display-metrics-changed', (_e, d, changed) => this.settle(`metrics ${d.id} ${changed.join(',')}`));
    screen.on('display-added', (_e, d) => this.settle(`added ${d.id}`));
    screen.on('display-removed', (_e, d) => this.settle(`removed ${d.id}`));
  }

  /**
   * Re-measure once the displays stop moving. Also the right thing after a
   * wake: the screen that comes back is not always the one that went to sleep,
   * and macOS does not always send a display event for it.
   */
  settle(reason: string): void {
    if (!this.pending++) logEvent('display', `change: ${reason}`);
    if (reason === 'resume' || reason === 'unlock-screen') this.forceSettle = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      const events = this.pending;
      this.pending = 0;
      const signature = this.signature();
      // macOS also announces "screen parameters changed" for things that are
      // not screens — an audio device appearing, an app going fullscreen — in
      // bursts of a dozen. Nothing moved, so nothing is re-measured: the probe
      // is a blocking subprocess and the answer would be the same.
      if (!this.forceSettle && signature === this.lastSignature) {
        logEvent('display', `unchanged after ${events} event${events === 1 ? '' : 's'}; kept`);
        this.assertLevel();
        this.assertTop();
        return;
      }
      this.forceSettle = false;
      this.lastSignature = signature;
      resetProbe();
      // Reposition first. It is what picks the display and re-runs the probe;
      // asking for the geometry before it has moved measures the screen the
      // window is about to leave.
      if (this.win) this.reposition();
      this.onDisplaysChanged();
      const d = this.display;
      logEvent('display', `settled on ${d ? `${d.id} ${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}` : 'no display'} after ${events} event${events === 1 ? '' : 's'}`);
    }, 250);
  }

  /** Everything about the displays that would move the island. */
  private signature(): string {
    return screen.getAllDisplays().map(d => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}:${d.workArea.y - d.bounds.y}`).sort().join('|');
  }

  /**
   * The display with the cutout, if we can tell.
   *
   * This has to agree with the Swift probe, which measures one specific screen
   * and reports its width — if the window landed anywhere else, the wings would
   * be anchored to a cutout on another display. So the probe's answer wins and
   * the work-area heuristic is only the fallback. Two displays of the same
   * width are ambiguous, so that case falls through rather than guessing.
   */
  private pickDisplay(): Display {
    const all = screen.getAllDisplays();
    const p = probeNotch();
    if (p?.notch && p.screenW) {
      const w = Math.round(p.screenW);
      const measured = all.filter((d) => Math.round(d.bounds.width) === w);
      if (measured.length === 1) return measured[0];
    }
    const notched = all.find((d) => d.workArea.y - d.bounds.y >= 33);
    return notched || screen.getPrimaryDisplay();
  }

  /** The real menu bar height — the collapsed bar must cover it exactly. */
  menuBarHeight(): number {
    const d = this.display || this.pickDisplay();
    return Math.max(24, d.workArea.y - d.bounds.y);
  }

  /**
   * macOS resets a window's level on several operations, and a reset level puts
   * the menu bar back on top of the island. Only re-assert what has drifted:
   * setVisibleOnAllWorkspaces rewrites the whole collection behaviour, and
   * calling it mid Mission Control animation is a good way to make the overlay
   * pop out as a window of its own.
   */
  assertLevel(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (!win.isVisibleOnAllWorkspaces()) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver', 1);
    if (!win.isHiddenInMissionControl()) win.setHiddenInMissionControl(true);
  }

  /** The roof of the screen, y = 0 — not the top of the work area. */
  assertTop(): void {
    const win = this.win;
    const d = this.display;
    if (!win || win.isDestroyed() || !d) return;
    const b = win.getBounds();
    if (b.y !== d.bounds.y || b.x !== d.bounds.x || b.width !== d.bounds.width) {
      win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: this.windowHeight(d) });
    }
  }

  create(): BrowserWindow {
    const d = this.pickDisplay();
    this.display = d;
    this.lastSignature = this.signature();
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: this.windowHeight(d),
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      acceptFirstMouse: true,
      type: 'panel',
      /**
       * Without this AppKit's constrainFrameRect() shoves the window down to
       * workArea.y on show, and the island lands under the menu bar instead of
       * being it. This is the only way to sit at y = 0 on a notched Mac.
       */
      enableLargerThanScreen: true,
      hiddenInMissionControl: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });

    this.win = win;
    win.setIgnoreMouseEvents(true, { forward: true });
    this.assertLevel();
    win.loadFile(path.join(__dirname, '../renderer/island.html'));
    win.once('ready-to-show', () => {
      win.showInactive();
      // Order matters: showing can drop the level back under the menu bar.
      this.assertLevel();
      this.assertTop();
      setTimeout(() => {
        this.assertLevel();
        this.assertTop();
      }, 250);
    });
    // The island has no devtools you can reach, so its console comes here.
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') logEvent('island', e.message);
    });
    // A dead renderer leaves a transparent window that still swallows the cursor
    // wherever the last hit rect said the island was — an invisible dead zone
    // over the notch, forever. Reload instead of only writing it down.
    win.webContents.on('render-process-gone', (_e, det) => {
      logEvent('island', `renderer gone: ${det.reason}`);
      this.hit = { x: 0, y: 0, w: 0, h: 0 };
      if (det.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => win.reload(), 1000);
    });
    win.on('show', () => this.assertLevel());
    win.on('blur', () => this.assertLevel());

    this.cursorPoll = setInterval(() => this.trackCursor(), 60);
    // Cheap insurance against anything else lowering us — Spaces, fullscreen,
    // screen sharing, a display waking up.
    this.levelPoll = setInterval(() => {
      this.assertLevel();
      this.assertTop();
    }, 2000);
    return win;
  }

  reposition(): void {
    if (!this.win) return;
    const d = this.pickDisplay();
    this.display = d;
    this.win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: this.windowHeight(d) });
    this.assertLevel();
  }

  /**
   * Clear the tallest panel, but never overhang the display: a window taller
   * than its screen is one macOS is entitled to move.
   */
  private windowHeight(d: Display): number {
    return Math.min(config().windowHeight, d.bounds.height);
  }

  /** The island measured itself; this is where it says it ended up. */
  setHitRect(r: HitRect): void {
    this.hit = r;
  }

  /**
   * Cursor polling, not mouse events: the window is click-through, so it does
   * not get enter and leave events until after we have already decided to stop
   * being click-through.
   */
  private trackCursor(): void {
    const win = this.win;
    const d = this.display;
    if (!win || win.isDestroyed() || !d) return;
    const p = screen.getCursorScreenPoint();
    const left = d.bounds.x + this.hit.x;
    const right = left + this.hit.w;
    const top = d.bounds.y + this.hit.y;
    const bottom = top + this.hit.h;
    const inside = this.hit.w > 0 && p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
    if (inside === this.engaged) return;
    this.engaged = inside;
    win.setIgnoreMouseEvents(!inside, { forward: true });
    this.onHover(inside);
  }

  destroy(): void {
    if (this.cursorPoll) clearInterval(this.cursorPoll);
    if (this.levelPoll) clearInterval(this.levelPoll);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.win?.destroy();
    this.win = null;
  }
}

/** The design gallery — every face of the island, on a normal window. */
export function createGalleryWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 940,
    show: false,
    title: 'Notchlight — faces',
    backgroundColor: '#EFEBE4',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // The gallery has no devtools you would think to open, so its console comes
  // to the terminal the daemon was started from.
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log('[gallery] ' + e.message);
  });
  win.loadFile(path.join(__dirname, '../renderer/gallery.html'));
  return win;
}

/** A normal desktop window; preferences are preview-local, never production config. */
export function createCustomizeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    show: false,
    title: 'Notchlight — Customize',
    backgroundColor: '#F5F2ED',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '../renderer/customize.html'));
  return win;
}
