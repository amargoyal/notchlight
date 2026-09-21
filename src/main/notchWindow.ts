/**
 * The overlays: one per screen that should carry an island, each full screen
 * width, transparent, above the menu bar, and click-through everywhere except
 * the island itself.
 *
 * There is no text input anywhere in Notchlight, so unlike its ancestor this
 * window never takes the keyboard. Mouse events reach a non-focusable window
 * fine, which is the whole reason the Allow/Deny buttons can work without ever
 * stealing focus from the terminal you are actually typing in.
 */
import { app, BrowserWindow, screen, type Display } from 'electron';
import path from 'node:path';
import { config, type Config } from './config';
import { Hover } from './hover';
import { probeFor, resetProbe, type DisplayProbe } from './notchProbe';
import { logEvent } from './lifecycle';
import type { HitRect } from '../shared/types';

/** How wide and how tall the collapsed bar is on one screen. */
export interface NotchGeometry { notchW: number; notchH: number }

/** The real menu bar height on a screen — the collapsed bar must cover it exactly. */
function menuBarHeightOf(d: Display): number {
  return Math.max(24, d.workArea.y - d.bounds.y);
}

/**
 * What the bar should measure on one screen.
 *
 * A screen with a cutout matches the hole by default; the cutout can measure a
 * point shorter than the menu bar it sits in — 32 against 33 on a 14" — and a
 * bar that misses by a pixel leaves a sliver of menu bar showing above it, so
 * the taller of the two wins. A screen with no cutout has no hole to match, so
 * it takes the plain height the owner chose.
 */
export function geometryFor(d: Display, cfg: Pick<Config, 'notchHeight' | 'notchHeightCustom' | 'plainNotchHeight' | 'notchW' | 'notchH'> = config(), probe: (id: number) => DisplayProbe | null = probeFor): NotchGeometry {
  const measured = probe(d.id);
  const menuBar = menuBarHeightOf(d);
  if (measured?.notch) {
    const height = cfg.notchHeight === 'menu-bar' ? menuBar
      : cfg.notchHeight === 'custom' ? cfg.notchHeightCustom
      : Math.max(Math.round(measured.notchH ?? cfg.notchH), menuBar);
    return { notchW: Math.round(measured.notchW ?? cfg.notchW), notchH: height };
  }
  return { notchW: cfg.notchW, notchH: cfg.plainNotchHeight || menuBar };
}

/**
 * One overlay, on one screen: full screen width, transparent, above the menu
 * bar, and click-through everywhere except the island itself.
 *
 * Each screen gets its own hover intent. The cursor is only ever on one of
 * them, so they never fight — but an island that unfolded on the display you
 * are not looking at, because the pointer was on another one, would be worse
 * than useless.
 */
class NotchOverlay {
  win: BrowserWindow;
  readonly hover: Hover;
  private hit: HitRect = { x: 0, y: 0, w: 0, h: 0 };
  private engaged = false;
  private wasActive = false;
  geometry: NotchGeometry;

  constructor(public display: Display) {
    this.geometry = geometryFor(display);
    this.hover = new Hover(open => this.send('open', open), () => config());
    this.win = this.build();
  }

  private build(): BrowserWindow {
    const d = this.display;
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: windowHeight(d),
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
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setContentProtection(config().contentProtection);
    this.assertLevel();
    win.loadFile(path.join(__dirname, '../renderer/island.html'));
    win.once('ready-to-show', () => {
      win.showInactive();
      // Order matters: showing can drop the level back under the menu bar.
      this.assertLevel();
      this.assertTop();
      setTimeout(() => { this.assertLevel(); this.assertTop(); }, 250);
    });
    // The island has no devtools you can reach, so its console comes here.
    win.webContents.on('console-message', e => {
      if (e.level === 'error' || e.level === 'warning') logEvent('island', e.message);
    });
    // A dead renderer leaves a transparent window that still swallows the cursor
    // wherever the last hit rect said the island was — an invisible dead zone
    // over the notch, forever. Reload instead of only writing it down.
    win.webContents.on('render-process-gone', (_e, det) => {
      logEvent('island', `renderer gone on display ${this.display.id}: ${det.reason}`);
      this.hit = { x: 0, y: 0, w: 0, h: 0 };
      if (det.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => win.reload(), 1000);
    });
    win.on('show', () => this.assertLevel());
    win.on('blur', () => this.assertLevel());
    return win;
  }

  send(channel: string, payload: unknown): void {
    const win = this.win;
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
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
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    if (b.y !== d.bounds.y || b.x !== d.bounds.x || b.width !== d.bounds.width) {
      win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: windowHeight(d) });
    }
  }

  /** Follow the screen this overlay belongs to, or move to another one entirely. */
  moveTo(d: Display): void {
    this.display = d;
    if (this.win && !this.win.isDestroyed()) {
      this.win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: windowHeight(d) });
    }
    this.assertLevel();
    this.applyGeometry();
  }

  /** Out of screen recordings, or back into them. */
  setContentProtection(on: boolean): void {
    if (this.win && !this.win.isDestroyed()) this.win.setContentProtection(on);
  }

  /** Re-measure this screen and tell the island what it is sitting in. */
  applyGeometry(): NotchGeometry {
    this.geometry = geometryFor(this.display);
    this.send('geometry', this.geometry);
    return this.geometry;
  }

  /** The island measured itself; this is where it says it ended up. */
  setHitRect(r: HitRect): void { this.hit = r; }

  /**
   * Cursor polling, not mouse events: the window is click-through, so it does
   * not get enter and leave events until after we have already decided to stop
   * being click-through.
   */
  track(point: { x: number; y: number }): void {
    const win = this.win;
    const d = this.display;
    if (!win || win.isDestroyed()) return;
    const left = d.bounds.x + this.hit.x;
    const top = d.bounds.y + this.hit.y;
    const inside = this.hit.w > 0 && point.x >= left && point.x <= left + this.hit.w && point.y >= top && point.y <= top + this.hit.h;
    if (inside === this.engaged) return;
    this.engaged = inside;
    win.setIgnoreMouseEvents(!inside, { forward: true });
    // Two separate facts. `hover` is the cursor arriving, which is what draws
    // the little stubs that say "keep going"; `open` is the dwell being
    // satisfied, which is what unfolds the panel.
    this.send('hover', inside);
    this.hover.set(inside);
  }

  /** Let the island take the keyboard. */
  takeKeyboard(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.wasActive = app.isActive?.() ?? false;
    win.setFocusable(true);
    win.setIgnoreMouseEvents(false);
    this.engaged = true;
    win.focus();
    this.assertLevel();
  }

  /** Back to click-through and non-focusable. True if taking the keys activated the app. */
  releaseKeyboard(): boolean {
    const win = this.win;
    if (!win || win.isDestroyed()) return false;
    const cameForward = (app.isActive?.() ?? false) && !this.wasActive;
    win.blur();
    win.setFocusable(false);
    // Let the cursor poll decide whether the island stays engaged.
    this.engaged = false;
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setContentProtection(config().contentProtection);
    this.assertLevel();
    return cameForward;
  }

  destroy(): void {
    this.hover.hold(false);
    this.win?.destroy();
  }
}

/**
 * Clear the tallest panel, but never overhang the display: a window taller
 * than its screen is one macOS is entitled to move.
 */
function windowHeight(d: Display): number {
  return Math.min(config().windowHeight, d.bounds.height);
}

/**
 * Which screens carry an island, given what is attached and what was asked for.
 *
 * A screen with no cutout only qualifies when the owner has asked for one
 * there: it is a bar hanging off a menu bar rather than a hole being filled,
 * and nobody wants that by surprise on a second monitor. Whatever the rule, a
 * screen that has been unplugged falls back to the built-in one rather than
 * leaving the island on nothing at all.
 *
 * Pure, and separately testable: everything Electron knows arrives as an
 * argument.
 */
export function chooseDisplayIds(
  all: number[],
  probe: (id: number) => DisplayProbe | null,
  cfg: Pick<Config, 'displays' | 'displayId' | 'allowWithoutNotch' | 'plainNotchHeight'>,
  cursor: number
): number[] {
  const plain = cfg.allowWithoutNotch && cfg.plainNotchHeight > 0;
  const eligible = all.filter(id => probe(id)?.notch || plain);
  if (!eligible.length) return [];
  const preferred = eligible.find(id => probe(id)?.builtin) ?? eligible.find(id => probe(id)?.notch) ?? eligible[0];
  switch (cfg.displays) {
    case 'all': return eligible;
    case 'cursor': return [eligible.includes(cursor) ? cursor : preferred];
    case 'chosen': return [eligible.includes(cfg.displayId) ? cfg.displayId : preferred];
    default: return [preferred];
  }
}

/**
 * Every overlay, and which screens deserve one.
 *
 * One island on the built-in panel is still the default, and on a single-screen
 * Mac nothing here does anything. Plugged into a monitor, the island can appear
 * on all of them, on one you pick, or follow the pointer between them — and the
 * last of those is why overlays are moved rather than rebuilt: a window that is
 * destroyed and made again loses a second to loading the renderer, every time
 * you cross a screen edge.
 */
export class NotchWindow {
  private overlays: NotchOverlay[] = [];
  private cursorPoll: NodeJS.Timeout | null = null;
  private levelPoll: NodeJS.Timeout | null = null;
  private settleTimer: NodeJS.Timeout | null = null;
  private pending = 0;
  private forceSettle = false;
  private lastSignature = '';
  private held = false;

  constructor(private onDisplaysChanged: () => void = () => {}) {
    // Bound once for the life of the process. Display events arrive in bursts —
    // waking a screen fires several — and each reposition re-measures the
    // cutouts with a blocking subprocess, so settle first and measure once.
    screen.on('display-metrics-changed', (_e, d, changed) => this.settle(`metrics ${d.id} ${changed.join(',')}`));
    screen.on('display-added', (_e, d) => this.settle(`added ${d.id}`));
    screen.on('display-removed', (_e, d) => this.settle(`removed ${d.id}`));
  }

  /** The window that stands for the island when only one can be meant. */
  get win(): BrowserWindow | null { return this.overlays[0]?.win ?? null; }
  windows(): BrowserWindow[] { return this.overlays.map(o => o.win).filter(w => w && !w.isDestroyed()); }
  displayIds(): number[] { return this.overlays.map(o => o.display.id); }
  owns(win: BrowserWindow | null): boolean { return !!win && this.overlays.some(o => o.win === win); }
  broadcast(channel: string, payload: unknown): void { for (const overlay of this.overlays) overlay.send(channel, payload); }
  /** The geometry of the screen that stands for the island — what the gallery and the settings preview draw. */
  primaryGeometry(): NotchGeometry { return this.overlays[0]?.geometry ?? geometryFor(screen.getPrimaryDisplay()); }
  menuBarHeight(): number { return menuBarHeightOf(this.overlays[0]?.display ?? screen.getPrimaryDisplay()); }

  create(): BrowserWindow[] {
    this.lastSignature = this.signature();
    this.sync();
    this.cursorPoll = setInterval(() => this.trackCursor(), 60);
    // Cheap insurance against anything else lowering us — Spaces, fullscreen,
    // screen sharing, a display waking up.
    this.levelPoll = setInterval(() => {
      for (const overlay of this.overlays) { overlay.assertLevel(); overlay.assertTop(); }
    }, 2000);
    return this.windows();
  }

  /** The screens that should carry an island right now. */
  private targets(): Display[] {
    const all = screen.getAllDisplays();
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    const chosen = new Set(chooseDisplayIds(all.map(d => d.id), probeFor, config(), cursor));
    return all.filter(d => chosen.has(d.id));
  }

  /**
   * Make the overlays match the target screens.
   *
   * An overlay whose screen is no longer wanted is moved to a screen that has
   * none rather than destroyed and rebuilt — which is what makes following the
   * pointer instant instead of a reload.
   */
  private sync(): void {
    const targets = this.targets();
    const wanted = new Map(targets.map(d => [d.id, d]));
    const keep: NotchOverlay[] = [];
    const spare: NotchOverlay[] = [];
    for (const overlay of this.overlays) {
      const target = wanted.get(overlay.display.id);
      if (target) { overlay.moveTo(target); wanted.delete(overlay.display.id); keep.push(overlay); }
      else spare.push(overlay);
    }
    for (const display of wanted.values()) {
      const reused = spare.pop();
      if (reused) { reused.moveTo(display); keep.push(reused); continue; }
      keep.push(new NotchOverlay(display));
    }
    for (const gone of spare) gone.destroy();
    // Screen order, so "the first one" means the same thing between runs.
    this.overlays = keep.sort((a, b) => a.display.bounds.x - b.display.bounds.x || a.display.id - b.display.id);
    for (const overlay of this.overlays) { overlay.assertLevel(); overlay.assertTop(); }
    if (this.held) this.hold(true);
  }

  setContentProtection(on: boolean): void {
    for (const overlay of this.overlays) overlay.setContentProtection(on);
    logEvent('island', `screen recording ${on ? 'excluded' : 'included'}`);
  }

  /** Reopen the overlays against the current preferences — a Displays row changed. */
  reconfigure(): void {
    if (!this.overlays.length && !this.cursorPoll) return;
    this.sync();
    this.applyGeometry();
  }

  /** Re-measure every screen and tell each island what it is sitting in. */
  applyGeometry(): NotchGeometry {
    for (const overlay of this.overlays) overlay.applyGeometry();
    return this.primaryGeometry();
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
        for (const overlay of this.overlays) { overlay.assertLevel(); overlay.assertTop(); }
        return;
      }
      this.forceSettle = false;
      this.lastSignature = signature;
      resetProbe();
      // Reposition first. It is what picks the screens and re-runs the probe;
      // asking for the geometry before it has moved measures the screen the
      // window is about to leave.
      this.sync();
      this.onDisplaysChanged();
      logEvent('display', `settled on ${this.overlays.map(o => `${o.display.id} ${o.display.bounds.width}x${o.display.bounds.height}@${o.display.scaleFactor}`).join(', ') || 'no display'} after ${events} event${events === 1 ? '' : 's'}`);
    }, 250);
  }

  /** Everything about the displays that would move an island. */
  private signature(): string {
    return screen.getAllDisplays().map(d => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}:${d.workArea.y - d.bounds.y}`).sort().join('|');
  }

  /** The overlay under the pointer, or the first one. */
  private focused(): NotchOverlay | null {
    if (!this.overlays.length) return null;
    const under = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return this.overlays.find(o => o.display.id === under.id) ?? this.overlays[0];
  }

  private trackCursor(): void {
    if (!this.overlays.length) return;
    const point = screen.getCursorScreenPoint();
    // Following the pointer moves the one island across screen edges. The check
    // is a comparison, not a reposition: only crossing an edge costs anything.
    if (config().displays === 'cursor') {
      const under = screen.getDisplayNearestPoint(point);
      if (this.overlays[0].display.id !== under.id) this.sync();
    }
    for (const overlay of this.overlays) overlay.track(point);
  }

  /** Keep the island open regardless of the cursor, or stop doing so. */
  hold(held: boolean): void {
    this.held = held;
    const target = held ? this.focused() : null;
    for (const overlay of this.overlays) overlay.hover.hold(held && overlay === target);
  }

  setHitRect(win: BrowserWindow | null, r: HitRect): void {
    this.overlays.find(o => o.win === win)?.setHitRect(r);
  }

  /**
   * Fold one island up now, without waiting for the cursor to leave.
   *
   * The dwell is not re-armed while the pointer stays where it is: a swipe means
   * "not now", and an island that sprang back open half a second later would be
   * answering the opposite question.
   */
  close(win: BrowserWindow | null): void {
    this.overlays.find(o => o.win === win)?.hover.set(false, true);
  }

  takeKeyboard(): void { this.focused()?.takeKeyboard(); }
  releaseKeyboard(): boolean {
    let cameForward = false;
    for (const overlay of this.overlays) cameForward = overlay.releaseKeyboard() || cameForward;
    return cameForward;
  }

  destroy(): void {
    if (this.cursorPoll) clearInterval(this.cursorPoll);
    if (this.levelPoll) clearInterval(this.levelPoll);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    for (const overlay of this.overlays) overlay.destroy();
    this.overlays = [];
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
    // The traffic lights sit in the sidebar, as in System Settings; the
    // renderer marks its own drag regions.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '../renderer/customize.html'));
  return win;
}

/**
 * The welcome: one card, shown once, on the display you are looking at.
 *
 * Deliberately not a panel over the notch. It is asking questions, so it has to
 * take focus and hold it, which is the one thing the island itself never does.
 */
export function createWelcomeWindow(): BrowserWindow {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 640;
  const height = 620;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(d.workArea.x + (d.workArea.width - width) / 2),
    y: Math.round(d.workArea.y + Math.max(40, (d.workArea.height - height) / 3)),
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Notchlight — Welcome',
    backgroundColor: '#f5f2ed',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.on('console-message', e => {
    if (e.level === 'error' || e.level === 'warning') logEvent('notchlight', `[welcome] ${e.message}`);
  });
  win.loadFile(path.join(__dirname, '../renderer/welcome.html'));
  return win;
}

/**
 * The update window: a small card, centred on the display with the cutout,
 * above other windows but not the island. Frameless, so the card can be the
 * whole thing — macOS still gives it rounded corners and a shadow.
 */
export function createUpdateWindow(theme: 'light' | 'dark'): BrowserWindow {
  const d = screen.getPrimaryDisplay();
  const width = 460;
  const height = 520;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(d.workArea.x + (d.workArea.width - width) / 2),
    y: Math.round(d.workArea.y + Math.max(48, (d.workArea.height - height) / 3)),
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'Notchlight — Update',
    backgroundColor: theme === 'dark' ? '#211f1d' : '#f5f2ed',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') logEvent('updates', e.message);
  });
  win.loadFile(path.join(__dirname, '../renderer/update.html'));
  return win;
}
