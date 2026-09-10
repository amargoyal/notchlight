/**
 * The daemon.
 *
 * Hooks and transcripts feed one live store and one notch overlay. The gallery
 * and customization preview are ordinary windows with a shared Dock lifecycle.
 */
import { app, BrowserWindow, clipboard, ClipboardItem as ElectronClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DIR, config, ensureDir } from './config';
import { CompanionStore } from './companionStore';
import { ClipboardStore, SKIPPED_FORMATS, type Pasteboard } from './clipboardStore';
import { LineHelper, parsePasteboardChange, type PasteboardChange } from './helperProcess';
import { SpotifyPlayer } from './spotify';
import { SpotifyWatcher } from './spotifyWatch';
import { installCompanionIpc } from './companionIpc';
import { AudioLevels, wantsLevels } from './audioLevels';
import { DemoStore } from './demo';
import { HookServer, type HookEvent } from './hookServer';
import { createGalleryWindow, createCustomizeWindow, NotchWindow } from './notchWindow';
import { notchState, probeNotch } from './notchProbe';
import { trayIcon } from './png';
import { Store } from './store';
import { CodexAdapter } from './codex';
import { CodexApprovals } from './codexApprovals';
import { AgentCoordinator } from './agentCoordinator';
import { logEvent } from './lifecycle';
import { Hover } from './hover';
import { jumpToProcess } from './terminal';
import type { HitRect, Snapshot } from '../shared/types';

const DEMO = process.argv.includes('--demo');
const GALLERY_ONLY = process.argv.includes('--gallery');
const CUSTOMIZE = process.argv.includes('--customize');
app.setName('Notchlight');

/**
 * A second copy would bind the same socket and draw a second island on the same
 * notch. Losing the lock means an instance is already running, so this one exits
 * without ever reaching `whenReady` — `app.quit()` alone would not have stopped
 * the rest of this file from booting.
 */
const PRIMARY = app.requestSingleInstanceLock();
if (!PRIMARY) app.quit();

type AnyStore = AgentCoordinator;

let store: AnyStore;
let hooks: HookServer | null = null;
let codex: CodexAdapter;
let codexApprovals: CodexApprovals;
let notch: NotchWindow | null = null;
let tray: Tray | null = null;
let gallery: BrowserWindow | null = null;
let customize: BrowserWindow | null = null;
let companion: CompanionStore;
let clips: ClipboardStore;
let pasteboardWatch: LineHelper<PasteboardChange>;
let spotify: SpotifyPlayer;
let watcher: SpotifyWatcher;
let levels: AudioLevels;
let shelfTimer: NodeJS.Timeout | null = null;
let pickFiles: (() => Promise<void>) | null = null;
let hover: Hover | null = null;
let claudeStore: Store | null = null;
/** Asleep or locked: nobody is looking, so no helper should be running. */
let dark = false;
/** The island has the keyboard; Escape or a click elsewhere gives it back. */
let keyboard = false;

function send(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

/**
 * The gallery and customization preview are ordinary desktop windows.
 *
 * With the dock icon hidden the process is an accessory and cannot become the
 * frontmost app, so a window opened from the tray appears *behind* whatever you
 * were using. The dock icon comes back for as long as the gallery is open, and
 * goes away when the last ordinary window closes.
 */
function openGallery(): void {
  if (gallery && !gallery.isDestroyed()) {
    app.focus({ steal: true });
    gallery.show();
    return void gallery.focus();
  }
  void app.dock?.show();
  gallery = createGalleryWindow();
  // Snapshots are only emitted on change, so a gallery opened during a quiet
  // minute would sit on "waiting for the daemon" until something moved.
  gallery.webContents.on('did-finish-load', () => send(gallery, 'snapshot', store.current()));
  gallery.once('ready-to-show', () => {
    app.focus({ steal: true });
    gallery?.show();
    gallery?.focus();
  });
  gallery.on('closed', () => {
    gallery = null;
    syncDock();
  });
}

/** Keep the Dock available while either ordinary desktop window is open. */
function syncDock(): void {
  if (gallery || customize) void app.dock?.show();
  else app.dock?.hide();
}

function openCustomize(): void {
  if (customize && !customize.isDestroyed()) {
    app.focus({ steal: true });
    customize.show();
    customize.focus();
    return;
  }
  void app.dock?.show();
  customize = createCustomizeWindow();
  customize.webContents.on('did-finish-load', () => {
    send(customize, 'snapshot', store.current());
    send(customize, 'companion', companion.current());
  });
  customize.once('ready-to-show', () => {
    app.focus({ steal: true });
    customize?.show();
    customize?.focus();
  });
  customize.on('closed', () => {
    customize = null;
    syncDock();
  });
}

function installHooks(): void {
  const script = path.join(__dirname, '..', '..', 'bin', 'install-hooks.mjs');
  execFile(process.execPath, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, out, errOut) => {
    console.log('[hooks] install: ' + (err ? err.message : out.trim() || errOut.trim()));
    refreshTray();
  });
}

/**
 * Whether Claude Code is wired to talk to us.
 *
 * Worth showing, because almost everything that looks like a bug in this app
 * when the hooks are missing is the hooks being missing: no yellow light, and
 * finished sessions that hang around because nothing reports SessionEnd.
 */
function hooksInstalled(): boolean {
  try {
    const text = fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8');
    return text.includes('notchlight-hook.mjs') || text.includes('cl-hook.mjs');
  } catch {
    return false;
  }
}

function trayTitle(s: Snapshot): string {
  if (s.dormant) return '';
  const n = s.sessions.length;
  return n > 1 ? String(n) : '';
}

function refreshTray(): void {
  if (!tray) return;
  const s = store.current();
  const probe = probeNotch();
  const lines: Electron.MenuItemConstructorOptions[] = [
    { label: s.dormant ? 'Nothing running' : `${s.sessions.length} session${s.sessions.length === 1 ? '' : 's'}`, enabled: false }
  ];
  for (const sess of s.sessions.slice(0, 6)) {
    lines.push({ label: `${sess.provider === 'codex' ? 'Codex' : 'Claude'} · ${sess.project} — ${sess.status}`, enabled: false });
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...lines,
      { type: 'separator' },
      {
        label: probe?.notch
          ? `Cutout ${Math.round(probe.notchW ?? 0)}×${Math.round(probe.notchH ?? 0)}pt`
          : notchState() === 'no'
            ? 'No cutout on this display'
            : 'Cutout not measured',
        enabled: false
      },
      { label: `Open for the keyboard${config().shortcut ? ` (${shortcutLabel(config().shortcut)})` : ''}`, click: () => openForKeyboard() },
      { label: 'Add files to Tray…', click: () => { void pickFiles?.().catch(e => companion.notice(String(e.message))); } },
      { label: 'Customize Notchlight…', click: () => openCustomize() },
      { label: 'Open faces gallery', click: () => openGallery() },
      hooksInstalled()
        ? { label: 'Claude Code hooks installed', enabled: false }
        : { label: 'Install Claude Code hooks…', click: () => installHooks() },
      ...(app.isPackaged ? [{ label: 'Start at login', type: 'checkbox' as const, checked: app.getLoginItemSettings().openAtLogin, click: (item: Electron.MenuItem) => { app.setLoginItemSettings({ openAtLogin: item.checked }); logEvent('notchlight', `start at login ${item.checked ? 'on' : 'off'}`); } }] : []),
      { label: 'Reveal config folder', click: () => shell.openPath(APP_DIR) },
      { type: 'separator' },
      { label: 'Quit Notchlight', click: () => app.quit() }
    ])
  );
  tray.setTitle(trayTitle(s));
}

function startTray(): void {
  const img = nativeImage.createFromBuffer(trayIcon(), { scaleFactor: 2 });
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Notchlight');
  tray.on('drop-files', (_event, files) => { void companion.add(files).catch(e => companion.notice(String(e.message))); });
  refreshTray();
}

async function boot(): Promise<void> {
  ensureDir();
  const claude = DEMO ? new DemoStore() : new Store();
  claudeStore = DEMO ? null : claude as Store;
  companion = new CompanionStore(path.join(APP_DIR, 'companion.json'), async file => (await app.getFileIcon(file, { size: 'normal' })).toDataURL(), config().pulse);
  spotify = new SpotifyPlayer();
  watcher = new SpotifyWatcher();
  watcher.on('change', change => spotify.onExternalChange(change));
  // With instant word of every change, the polls are only a safety net.
  watcher.on('listening', (listening: boolean) => spotify.setPollInterval(listening ? 10_000 : 2_500));
  levels = new AudioLevels();
  levels.on('levels', (bands: number[]) => {
    send(notch?.win ?? null, 'music:levels', bands);
    send(customize, 'music:levels', bands);
  });
  levels.on('status', () => companion.setCapture({ status: levels.status, reason: levels.reason, retryAt: levels.nextRetry() }));
  await companion.load();
  // Electron's clipboard is asynchronous and W3C-shaped; the raw macOS markers
  // that mean "do not remember this" are asked for by name through its
  // os-clipboard format so a password manager's paste is never read.
  const pasteboard: Pasteboard = {
    async availableFormats() {
      const [text, image, ...raw] = await Promise.all([clipboard.has('text/plain'), clipboard.has('image/png'), ...SKIPPED_FORMATS.map(f => clipboard.has(`electron application/osclipboard;format="${f}"`).catch(() => false))]);
      return [...(text ? ['text/plain'] : []), ...(image ? ['image/png'] : []), ...SKIPPED_FORMATS.filter((_, i) => raw[i])];
    },
    readText: () => clipboard.readText(),
    writeText: text => clipboard.writeText(text),
    async readImage() {
      const item = (await clipboard.read()).find(i => i.types.includes('image/png'));
      if (!item) return null;
      const blob = await item.getType('image/png') as Blob;
      const png = Buffer.from(await blob.arrayBuffer());
      const image = nativeImage.createFromBuffer(png);
      if (image.isEmpty()) return null;
      const { width, height } = image.getSize();
      return { png, width, height, thumb: image.resize({ height: 44 }).toDataURL() };
    },
    writeImage: png => clipboard.write([new ElectronClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  };
  clips = new ClipboardStore(path.join(APP_DIR, 'clipboard.json'), pasteboard);
  clips.on('change', state => companion.setClipboard(state));
  await clips.load();
  // The change-count helper says when the pasteboard moved; without it the store looks every half second.
  pasteboardWatch = new LineHelper('pasteboardwatch', parsePasteboardChange);
  pasteboardWatch.on('listening', (listening: boolean) => clips.setWatched(listening));
  pasteboardWatch.on('event', (change: PasteboardChange) => clips.notifyChange(change));
  const syncClipboard = () => { const p = companion.current().preferences; const on = !DEMO && p.clipboardEnabled; clips.configure(on, Number(p.clipboardHistorySize)); pasteboardWatch.setActive(on); };
  syncClipboard();
  codex = new CodexAdapter();
  codexApprovals = new CodexApprovals(path.join(APP_DIR,'codex.sock'), () => companion.current().preferences.codexEnabled, () => companion.current().preferences.codexApprovals);
  codexApprovals.on('hook', p => codex.onHook(p));
  codexApprovals.on('requests', (id, requests) => codex.setHeld(id,requests));
  codexApprovals.on('answered', (id, decision) => codex.onAnswered(id,decision));
  codex.on('terminal', (id, turn) => codexApprovals.releaseTurn(id,turn));
  store = new AgentCoordinator(claude, codex, codexApprovals, () => hooks, hooksInstalled);
  let lastCodexHome = '';
  const syncCodex = () => {
    const p = companion.current().preferences;
    const home = p.codexHome || process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
    if (home !== lastCodexHome) { codexApprovals.releaseAll(); lastCodexHome = home; }
    codex.configure(!DEMO && p.codexEnabled, home);
    if (!p.codexEnabled || !p.codexApprovals) codexApprovals.releaseAll();
  };
  syncCodex();
  if (!DEMO) codexApprovals.start();
  let spotifyEnabled = companion.current().preferences.spotifyEnabled;
  spotify.on('change', music => companion.setMusic(music));
  const syncLevels = () => levels.setActive(!dark && wantsLevels(companion.current()));
  companion.on('change', state => {
    syncCodex();
    syncClipboard();
    send(notch?.win ?? null, 'companion', state);
    send(customize, 'companion', state);
    syncLevels();
    if (state.preferences.spotifyEnabled !== spotifyEnabled) {
      spotifyEnabled = state.preferences.spotifyEnabled;
      spotify.setEnabled(spotifyEnabled);
      watcher.setActive(spotifyEnabled && !DEMO);
    }
  });
  ipcMain.handle('snapshot:get', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (event.senderFrame !== event.sender.mainFrame || !win || win !== customize && win !== notch?.win) throw new Error('Unknown snapshot consumer.');
    return store.current();
  });
  pickFiles = installCompanionIpc(companion, spotify, clips,
    win => !!win && (win === customize || win === notch?.win),
    () => { openCustomize(); return customize!; });
  if (spotifyEnabled) { spotify.setEnabled(true); watcher.setActive(!DEMO); }
  shelfTimer = setInterval(() => { void companion.refresh().catch(() => companion.notice('Tray could not refresh.')); }, 10000);

  hover = new Hover((open) => send(notch?.win ?? null, 'open', open), () => config());
  notch = new NotchWindow(
    (inside) => {
      // Two separate facts. `hover` is the cursor arriving, which is what draws
      // the little stubs that say "keep going"; `open` is the dwell being
      // satisfied, which is what unfolds the panel.
      send(notch?.win ?? null, 'hover', inside);
      hover?.set(inside);
    },
    () => applyNotchGeometry()
  );

  const win = notch.create();
  win.on('blur', () => { if (keyboard) releaseKeyboard('focus left'); });
  win.webContents.on('did-finish-load', () => {
    applyNotchGeometry();
    send(win, 'snapshot', store.current());
    send(win, 'companion', companion.current());
  });

  store.on('snapshot', (s: Snapshot) => {
    send(notch?.win ?? null, 'snapshot', s);
    send(gallery, 'snapshot', s);
    send(customize, 'snapshot', s);
    refreshTray();
  });

  if (!DEMO) {
    hooks = new HookServer();
    const real = claude as Store;
    hooks.on('hook', (e: HookEvent) => {
      if (e.event === 'SessionEnd') hooks?.releaseSession(e.sessionId);
      real.onHook(e);
    });
    hooks.on('gate', (e: HookEvent & { gateId: string }) => real.onGate(e));
    hooks.on('gate-gone', (id: string) => real.onGateClosed(id));
    hooks.on('gate-done', (id: string) => real.onGateClosed(id));
    // The store dropped a question it can no longer show. Let the call go, so
    // Claude Code asks in the terminal instead of waiting out the deadline.
    real.on('release', (id: string) => hooks?.release(id));
    hooks.start();
  }

  watchPower(syncLevels);
  registerShortcut();
  store.start();
  startTray();
  ready = true;
  logEvent('notchlight', `ready pid ${process.pid} electron ${process.versions.electron} ${app.getVersion()} ${app.isPackaged ? 'packaged' : 'checkout'} ${DEMO ? 'demo' : 'live'}`);
  if (GALLERY_ONLY || pendingWindow === 'gallery') openGallery();
  if (CUSTOMIZE || pendingWindow === 'customize') openCustomize();
  pendingWindow = null;
}

/**
 * Sleep, lock and wake.
 *
 * Going dark stops the audio helper and holds the Spotify polls: a tap on a
 * device that is about to disappear exits anyway, and an osascript that starts
 * as the lid closes times out and reads as an error. Coming back re-measures
 * the display — the one that wakes is not always the one that slept — reads
 * Spotify at once, and lets the helper come back only if the bars are still
 * wanted. Every step is logged so the native checks can see it happened.
 */
function watchPower(syncLevels: () => void): void {
  const goDark = (why: string) => {
    if (dark) return;
    dark = true;
    logEvent('power', why);
    spotify.suspend();
    syncLevels();
  };
  const comeBack = (why: string) => {
    if (!dark) return;
    dark = false;
    logEvent('power', why);
    notch?.settle(why);
    spotify.resume();
    syncLevels();
    void companion.refresh().catch(() => {});
  };
  powerMonitor.on('suspend', () => goDark('suspend'));
  powerMonitor.on('lock-screen', () => goDark('lock-screen'));
  powerMonitor.on('resume', () => comeBack('resume'));
  powerMonitor.on('unlock-screen', () => comeBack('unlock-screen'));
  powerMonitor.on('shutdown', () => { logEvent('power', 'shutdown'); app.quit(); });
}

/** ⌥⇧N for the menu, from Electron's accelerator spelling. */
function shortcutLabel(accelerator: string): string {
  const names: Record<string, string> = { commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', control: '⌃', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', super: '⌘', meta: '⌘', space: 'Space', escape: 'Esc', return: '↩', enter: '↩', tab: '⇥' };
  return accelerator.split('+').map(part => names[part.toLowerCase()] ?? part.toUpperCase()).join('');
}

/**
 * The keyboard.
 *
 * The island is a non-focusable panel so that its buttons never pull focus
 * from the terminal you are typing in. A shortcut makes it focusable for as
 * long as you are using it: the panel opens, the selected tab takes focus, and
 * Tab, arrows, Enter and Space work as they would in any window. Escape — or
 * clicking anywhere else — makes it click-through again and, if the app came
 * forward to take the keys, hides the app so macOS returns to the one you were
 * in. The overlay is shown again inactive, so nothing you can see changes.
 */
function openForKeyboard(): void {
  if (!notch?.win || notch.win.isDestroyed()) return;
  keyboard = true;
  logEvent('island', 'keyboard taken');
  hover?.hold(true);
  send(notch.win, 'keyboard', true);
  notch.takeKeyboard();
}

function releaseKeyboard(why: string): void {
  if (!keyboard) return;
  keyboard = false;
  logEvent('island', `keyboard released: ${why}`);
  send(notch?.win ?? null, 'keyboard', false);
  const cameForward = notch?.releaseKeyboard() ?? false;
  hover?.hold(false);
  // Hiding an active app is how macOS hands focus back to the previous one.
  // Only when no ordinary window is open: those belong to this app and would
  // vanish with it.
  if (cameForward && !gallery && !customize) {
    app.hide();
    notch?.win?.showInactive();
    notch?.assertLevel();
  }
}

function registerShortcut(): void {
  const accelerator = config().shortcut;
  if (!accelerator) return;
  try {
    const ok = globalShortcut.register(accelerator, () => keyboard ? releaseKeyboard('shortcut') : openForKeyboard());
    logEvent('island', ok ? `shortcut ${accelerator} registered` : `shortcut ${accelerator} is taken by another app`);
  } catch (error) {
    logEvent('island', `shortcut ${accelerator} rejected: ${(error as Error).message}`);
  }
}

/**
 * Jump back to a session's terminal.
 *
 * Claude sessions know their process from the hook client, or the process
 * table gives the `claude` working in their directory. Codex Desktop is the
 * ChatGPT app; Codex CLI is found the same way as Claude when it is running
 * in the session's directory.
 */
async function focusSession(sessionId: string): Promise<string> {
  const session = store.current().sessions.find(s => s.id === sessionId);
  if (!session) throw new Error('That session is no longer shown.');
  if (keyboard) releaseKeyboard('jump');
  if (session.provider === 'codex' && session.source === 'desktop') {
    await promisify(execFile)('open', ['-b', 'com.openai.chat'], { timeout: 4000 }).catch(() => { throw new Error('The ChatGPT app could not be opened.'); });
    return 'Opened ChatGPT.';
  }
  const candidates = session.pid ? [session.pid] : session.provider !== 'codex' && session.cwd && claudeStore ? claudeStore.processesIn(session.cwd) : [];
  if (session.provider === 'codex' && !session.pid && session.cwd && claudeStore) candidates.push(...claudeStore.processesIn(session.cwd, 'codex'));
  if (!candidates.length) throw new Error(session.provider === 'codex' ? 'That Codex session’s terminal could not be found.' : hooksInstalled() ? 'That session’s terminal could not be found. It may have closed.' : 'Install the Claude Code hooks so sessions can name their terminal.');
  let last: Error | null = null;
  for (const pid of candidates) {
    try { return await jumpToProcess(pid); } catch (error) { last = error as Error; }
  }
  throw last ?? new Error('That session’s terminal could not be found.');
}

ipcMain.handle('session:focus', async (event, sessionId) => {
  try {
    if (!trustedAgentWindow(event) || typeof sessionId !== 'string') throw new Error('Invalid request.');
    const notice = await focusSession(sessionId);
    companion.notice(notice);
    return { ok: true };
  } catch (error) { return { ok: false, error: (error as Error).message }; }
});

ipcMain.on('keyboard:done', (event) => {
  if (BrowserWindow.fromWebContents(event.sender) === notch?.win) releaseKeyboard('escape');
});

/** Hand the measured cutout to both the store and the window's own sizing. */
function applyNotchGeometry(): void {
  const p = probeNotch();
  const cfg = config();
  const w = p?.notchW ?? cfg.notchW;
  // The cutout can measure a point shorter than the menu bar it sits in — 32
  // against 33 on a 14" — and a collapsed bar that misses by a pixel leaves a
  // sliver of menu bar showing above it. Cover the taller of the two.
  const h = Math.max(p?.notchH ?? cfg.notchH, notch?.menuBarHeight() ?? 0);
  store.setNotch(w, h);
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

ipcMain.on('hit-rect', (_e, r: HitRect) => {
  if (!r || !finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h)) return;
  notch?.setHitRect(r);
});

function trustedAgentWindow(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return event.senderFrame === event.sender.mainFrame && !!win && (win === notch?.win || win === customize);
}
ipcMain.handle('decide', (event, msg) => {
  try {
    if (!trustedAgentWindow(event) || DEMO || !msg || typeof msg.sessionId !== 'string' || typeof msg.askId !== 'string' || !['allow','deny','defer'].includes(msg.decision)) throw new Error('Invalid approval request.');
    store.decide(msg.sessionId,msg.askId,msg.decision);
    return {ok:true};
  } catch(error) { return {ok:false,error:(error as Error).message}; }
});
ipcMain.on('dismiss', (event, id) => {
  if (trustedAgentWindow(event) && typeof id === 'string') store.dismiss(id);
});

ipcMain.on('open-customize', (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender === gallery || sender === customize || sender === notch?.win) openCustomize();
});

let ready = false;
let pendingWindow: 'customize' | 'gallery' | null = null;
app.on('second-instance', (_event, argv) => {
  const target = argv.includes('--customize') ? 'customize' : 'gallery';
  if (!ready) { pendingWindow = target; return; }
  target === 'customize' ? openCustomize() : openGallery();
});
app.on('activate', () => { if (ready && !gallery && !customize) openCustomize(); });
app.on('window-all-closed', () => {
  // The overlay is not a window in the usual sense; closing the gallery must
  // not take the island down with it.
});

app.whenReady().then(() => {
  if (!PRIMARY) return;
  /** No dock icon: the island is furniture, not an app you switch to. */
  app.dock?.hide();
  if (notchState() === 'no' && !config().allowWithoutNotch && !DEMO) {
    logEvent('notchlight', 'no cutout on this display — set allowWithoutNotch to run anyway');
  }
  void boot().catch(error => { console.error('[companion] startup failed:', error.message); app.quit(); });
});

app.on('before-quit', () => {
  logEvent('notchlight', 'quitting');
  globalShortcut.unregisterAll();
  if (shelfTimer) clearInterval(shelfTimer);
  spotify?.stop();
  clips?.stop();
  pasteboardWatch?.stop();
  watcher?.stop();
  levels?.stop();
  store?.stop();
  hooks?.stop();
  notch?.destroy();
});
