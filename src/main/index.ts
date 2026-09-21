/**
 * The daemon.
 *
 * Hooks and transcripts feed one live store and one notch overlay. The gallery
 * and customization preview are ordinary windows with a shared Dock lifecycle.
 */
import { app, BrowserWindow, clipboard, ClipboardItem as ElectronClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, safeStorage, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DIR, config, ensureDir, writeConfig } from './config';
import { CompanionStore } from './companionStore';
import { ClipboardStore, SKIPPED_FORMATS, type Pasteboard } from './clipboardStore';
import { LineHelper, parsePasteboardChange, type PasteboardChange } from './helperProcess';
import { SpotifyPlayer } from './spotify';
import { SpotifyWatcher } from './spotifyWatch';
import { SpotifyAccount } from './spotifyAccount';
import { SmartShuffle } from './smartShuffle';
import { fetchTint } from './tint';
import { installCompanionIpc } from './companionIpc';
import { AudioLevels, helperArguments, wantsLevels } from './audioLevels';
import { Hud } from './hud';
import { Battery } from './battery';
import { Calendar } from './calendar';
import { fetchAppleArtwork } from './appleArtwork';
import { DemoStore } from './demo';
import { HookServer, type HookEvent } from './hookServer';
import { createGalleryWindow, createCustomizeWindow, createUpdateWindow, createWelcomeWindow, NotchWindow } from './notchWindow';
import { notchState, probeDisplays, probeNotch } from './notchProbe';
import { menubarIcon } from './png';
import { Store } from './store';
import { CodexAdapter } from './codex';
import { CodexApprovals } from './codexApprovals';
import { AgentCoordinator } from './agentCoordinator';
import { logEvent } from './lifecycle';
import { Updater, type Release } from './updates';
import type { UpdateResponse } from '../shared/updates';
import { jumpToProcess } from './terminal';
import type { HitRect, Snapshot } from '../shared/types';
import type { BatteryActivity, BatterySnapshot, CalendarSnapshot, HudActivity, HudSnapshot } from '../shared/companion';
import { validateAppSettings, type AppSettings, type AppSettingsPatch, type ScreenInfo } from '../shared/settings';

const DEMO = process.argv.includes('--demo');
const GALLERY_ONLY = process.argv.includes('--gallery');
const CUSTOMIZE = process.argv.includes('--customize');
/** Open the welcome on its own, to look at it. */
const WELCOME_PREVIEW = process.argv.includes('--welcome');
/** Open the update card with a sample release, to look at it. */
const UPDATE_PREVIEW = process.argv.includes('--update-preview');
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
let updateWin: BrowserWindow | null = null;
let welcome: BrowserWindow | null = null;
let updater: Updater;
/** The release the open update window is about, so its answer knows the version. */
let offered: Release | null = null;
let companion: CompanionStore;
let clips: ClipboardStore;
let pasteboardWatch: LineHelper<PasteboardChange>;
let spotify: SpotifyPlayer;
let watcher: SpotifyWatcher;
let account: SpotifyAccount;
let smart: SmartShuffle;
let levels: AudioLevels;
let hud: Hud;
let battery: Battery;
let calendar: Calendar;
let shelfTimer: NodeJS.Timeout | null = null;
let pickFiles: (() => Promise<void>) | null = null;
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
  showDock();
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

/**
 * A dev run has no app bundle, so the Dock would show Electron's own icon while
 * a window is open. The packaged app carries build/icon.icns and needs nothing.
 */
let dockIconSet = false;
function showDock(): void {
  if (!app.isPackaged && !dockIconSet) {
    dockIconSet = true;
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'icon.png'));
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
  void app.dock?.show();
}

/** Keep the Dock available while either ordinary desktop window is open. */
function syncDock(): void {
  if (gallery || customize || welcome) showDock();
  else app.dock?.hide();
}

/**
 * The welcome, shown once per version that asks for one.
 *
 * It takes focus, which the island never does, so it needs the Dock icon for as
 * long as it is open — an accessory process cannot come to the front, and a
 * window asking questions from behind the terminal is worse than no window.
 */
function openWelcome(): void {
  if (welcome && !welcome.isDestroyed()) {
    app.focus({ steal: true });
    welcome.show();
    return void welcome.focus();
  }
  showDock();
  welcome = createWelcomeWindow();
  welcome.webContents.on('did-finish-load', () => send(welcome, 'companion', companion.current()));
  welcome.once('ready-to-show', () => {
    app.focus({ steal: true });
    welcome?.show();
    welcome?.focus();
  });
  welcome.on('closed', () => {
    welcome = null;
    markWelcomeSeen();
    syncDock();
  });
}

/**
 * The welcome is over, however it ended.
 *
 * Closing the window counts. Someone who shuts it on the second step has
 * answered the question — they do not want to be walked through it — and being
 * asked again at every launch would be the app arguing with them.
 */
function markWelcomeSeen(): void {
  if (config().onboardedVersion === app.getVersion()) return;
  writeConfig({ onboardedVersion: app.getVersion() });
  logEvent('notchlight', `welcome seen for ${app.getVersion()}`);
}

function finishWelcome(): void {
  markWelcomeSeen();
  if (welcome && !welcome.isDestroyed()) welcome.close();
}

function openCustomize(): void {
  if (customize && !customize.isDestroyed()) {
    app.focus({ steal: true });
    customize.show();
    customize.focus();
    return;
  }
  showDock();
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

/** The desktop theme, resolved: the window paints before its page can ask. */
function desktopTheme(): 'light' | 'dark' {
  const pref = companion?.current().preferences.theme ?? 'system';
  return pref === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : pref;
}

/**
 * Show the update card. One at a time: a second release while the first is
 * still on screen just replaces what the card says.
 */
function showUpdate(release: Release): void {
  offered = release;
  const info = updater.info(release, desktopTheme());
  if (updateWin && !updateWin.isDestroyed()) {
    send(updateWin, 'update', info);
    updateWin.show();
    updateWin.focus();
    return;
  }
  updateWin = createUpdateWindow(info.theme);
  updateWin.webContents.on('did-finish-load', () => send(updateWin, 'update', info));
  updateWin.once('ready-to-show', () => {
    app.focus({ steal: true });
    updateWin?.show();
    updateWin?.focus();
  });
  updateWin.on('closed', () => { updateWin = null; offered = null; });
}

function answerUpdate(response: UpdateResponse): void {
  const release = offered;
  if (release) {
    if (response === 'download') { updater.downloaded(release.version); void shell.openExternal(release.download); }
    else if (response === 'skip') updater.skip(release.version);
    else updater.later();
  }
  updateWin?.close();
}

/** The menu item: ask now, and say what came back. */
async function checkForUpdates(): Promise<void> {
  const outcome = await updater.check(true);
  if (outcome.kind === 'update') return;
  const box = (message: string, detail: string) => { app.focus({ steal: true }); void dialog.showMessageBox({ type: outcome.kind === 'failed' ? 'warning' : 'info', message, detail, buttons: ['OK'] }); };
  if (outcome.kind === 'failed') box('Could not check for updates.', `GitHub did not answer: ${outcome.error}.`);
  else box("You're up to date.", `Notchlight ${updater.current} is the newest release.`);
}

function installHooks(): Promise<void> {
  const script = path.join(__dirname, '..', '..', 'bin', 'install-hooks.mjs');
  return new Promise(resolve => {
    execFile(process.execPath, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, out, errOut) => {
      console.log('[hooks] install: ' + (err ? err.message : out.trim() || errOut.trim()));
      refreshTray();
      resolve();
    });
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
      { label: 'Show the welcome again', click: () => openWelcome() },
      { label: 'Open faces gallery', click: () => openGallery() },
      hooksInstalled()
        ? { label: 'Claude Code hooks installed', enabled: false }
        : { label: 'Install Claude Code hooks…', click: () => installHooks() },
      ...(app.isPackaged ? [{ label: 'Start at login', type: 'checkbox' as const, checked: app.getLoginItemSettings().openAtLogin, click: (item: Electron.MenuItem) => { app.setLoginItemSettings({ openAtLogin: item.checked }); logEvent('notchlight', `start at login ${item.checked ? 'on' : 'off'}`); } }] : []),
      { label: 'Reveal config folder', click: () => shell.openPath(APP_DIR) },
      { type: 'separator' },
      { label: `Notchlight ${app.getVersion()}`, enabled: false },
      { label: 'Check for updates…', click: () => { void checkForUpdates(); } },
      { type: 'separator' },
      { label: 'Quit Notchlight', click: () => app.quit() }
    ])
  );
  tray.setTitle(trayTitle(s));
}

function startTray(): void {
  const img = nativeImage.createFromBuffer(menubarIcon(), { scaleFactor: 2 });
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
  spotify = new SpotifyPlayer(undefined, undefined, undefined, fetchTint, fetchAppleArtwork);
  spotify.setPlayer(companion.current().preferences.musicPlayer);
  watcher = new SpotifyWatcher();
  watcher.on('change', change => spotify.onExternalChange(change));
  // With instant word of every change, the polls are only a safety net.
  watcher.on('listening', (listening: boolean) => spotify.setPollInterval(listening ? 10_000 : 2_500));
  // The sign-in is sealed with the keychain when Electron can; a Mac without one keeps it owner-only on disk.
  account = new SpotifyAccount({ file: path.join(APP_DIR, 'spotify-account.json'), open: url => shell.openExternal(url), cipher: safeStorage.isEncryptionAvailable() ? { encrypt: text => safeStorage.encryptString(text), decrypt: data => safeStorage.decryptString(data) } : null });
  smart = new SmartShuffle(account, { skip: () => spotify.command('next') });
  smart.on('change', state => companion.setSmartShuffle(state));
  smart.on('notice', (text: string) => companion.notice(text));
  // The tap follows the player being read; a change of player restarts it on the other app.
  let tappedPlayer = spotify.currentPlayer();
  levels = new AudioLevels(undefined, () => helperArguments(config(), spotify.currentPlayer()));
  levels.on('levels', (bands: number[]) => {
    notch?.broadcast('music:levels', bands);
    send(customize, 'music:levels', bands);
  });
  levels.on('status', () => companion.setCapture({ status: levels.status, reason: levels.reason, retryAt: levels.nextRetry() }));
  // The keys are a live activity, so a press goes straight to the overlay on its
  // own channel; the pane's readout rides the companion snapshot like everything else.
  hud = new Hud();
  hud.on('activity', (activity: HudActivity) => {
    notch?.broadcast('hud:event', activity);
    send(customize, 'hud:event', activity);
  });
  hud.on('change', (state: HudSnapshot) => companion.setHud(state));
  battery = new Battery();
  battery.on('activity', (activity: BatteryActivity) => {
    notch?.broadcast('battery:event', activity);
    send(customize, 'battery:event', activity);
  });
  battery.on('change', (state: BatterySnapshot) => companion.setBattery(state));
  calendar = new Calendar();
  calendar.on('change', (state: CalendarSnapshot) => companion.setCalendar(state));
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
  spotify.on('change', music => {
    companion.setMusic(music);
    smart.observe(music.status === 'ready' && music.player === 'spotify' && music.track ? music.track.id : null, music.playing);
  });
  account.configure(companion.current().preferences.spotifyClientId);
  account.load();
  companion.setSmartShuffle(smart.snapshot());
  const syncLevels = () => {
    if (spotify.currentPlayer() !== tappedPlayer) { tappedPlayer = spotify.currentPlayer(); levels.setActive(false); }
    levels.setActive(!dark && wantsLevels(companion.current()));
  };
  // Asleep or locked, the tap would sit on a session nobody is looking at.
  const syncHud = () => {
    const { hudEnabled, hudOptionKey } = companion.current().preferences;
    hud.configure(!dark && !DEMO && hudEnabled, hudOptionKey);
  };
  syncHud();
  // The battery keeps reading while the screen is off: waking up to find the
  // level where it was an hour ago is worse than one quiet helper.
  const syncBattery = () => battery.setActive(!DEMO && companion.current().preferences.batteryEnabled);
  syncBattery();
  // Reminders are a second macOS permission, so asking for them starts a fresh
  // helper: a process that has already asked for less cannot ask for more.
  const syncCalendar = () => {
    const { calendarEnabled, calendarReminders } = companion.current().preferences;
    calendar.configure(!DEMO && calendarEnabled, calendarReminders);
  };
  syncCalendar();
  companion.on('change', state => {
    syncCodex();
    syncClipboard();
    notch?.broadcast('companion', state);
    send(customize, 'companion', state);
    send(welcome, 'companion', state);
    syncLevels();
    syncHud();
    syncBattery();
    syncCalendar();
    spotify.setPlayer(state.preferences.musicPlayer);
    account.configure(state.preferences.spotifyClientId);
    smart.setEnabled(!DEMO && state.preferences.spotifyEnabled && state.preferences.smartShuffle);
    if (state.preferences.spotifyEnabled !== spotifyEnabled) {
      spotifyEnabled = state.preferences.spotifyEnabled;
      spotify.setEnabled(spotifyEnabled);
      watcher.setActive(spotifyEnabled && !DEMO);
    }
  });
  ipcMain.handle('snapshot:get', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (event.senderFrame !== event.sender.mainFrame || !win || win !== customize && !notch?.owns(win)) throw new Error('Unknown snapshot consumer.');
    return store.current();
  });
  pickFiles = installCompanionIpc(companion, spotify, clips,
    win => !!win && (win === customize || win === welcome || !!notch?.owns(win)),
    () => { openCustomize(); return customize!; }, account, smart,
    // Under the notch on the screen the island is on, which is where the files
    // being shared appear to be coming from.
    () => {
      const bounds = notch?.win?.getBounds();
      return bounds ? { x: Math.round(bounds.x + bounds.width / 2), y: bounds.y + 36 } : { x: 0, y: 40 };
    });
  if (spotifyEnabled) { spotify.setEnabled(true); watcher.setActive(!DEMO); }
  smart.setEnabled(!DEMO && spotifyEnabled && companion.current().preferences.smartShuffle);
  shelfTimer = setInterval(() => { void companion.refresh().catch(() => companion.notice('Tray could not refresh.')); }, 10000);
  // After the island exists, not before: the welcome points at a notch, and
  // pointing at one that has not been drawn yet is a poor introduction.
  if (WELCOME_PREVIEW || (!DEMO && !GALLERY_ONLY && !CUSTOMIZE && config().onboardedVersion !== app.getVersion())) {
    setTimeout(() => openWelcome(), WELCOME_PREVIEW ? 0 : 900);
  }

  // Hover intent and the open state belong to each overlay: the cursor is only
  // ever on one screen, and an island unfolding on the display you are not
  // looking at would be worse than useless.
  notch = new NotchWindow(() => applyNotchGeometry());

  for (const win of notch.create()) {
    win.on('blur', () => { if (keyboard) releaseKeyboard('focus left'); });
    win.webContents.on('did-finish-load', () => {
      applyNotchGeometry();
      send(win, 'snapshot', store.current());
      send(win, 'companion', companion.current());
    });
  }

  store.on('snapshot', (s: Snapshot) => {
    notch?.broadcast('snapshot', s);
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

  watchPower(() => { syncLevels(); syncHud(); });
  registerShortcut();
  store.start();
  startTray();
  updater = new Updater({ current: app.getVersion(), automatic: app.isPackaged && !DEMO });
  updater.on('update', (release: Release) => showUpdate(release));
  updater.start();
  if (UPDATE_PREVIEW) showUpdate(sampleRelease());
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
  notch.hold(true);
  notch.broadcast('keyboard', true);
  notch.takeKeyboard();
}

function releaseKeyboard(why: string): void {
  if (!keyboard) return;
  keyboard = false;
  logEvent('island', `keyboard released: ${why}`);
  notch?.broadcast('keyboard', false);
  const cameForward = notch?.releaseKeyboard() ?? false;
  notch?.hold(false);
  // Hiding an active app is how macOS hands focus back to the previous one.
  // Only when no ordinary window is open: those belong to this app and would
  // vanish with it.
  if (cameForward && !gallery && !customize) {
    app.hide();
    for (const win of notch?.windows() ?? []) win.showInactive();
  }
}

/**
 * A look, rather than a visit.
 *
 * The island unfolds where the pointer is and folds itself away again, without
 * ever taking the keyboard. It is for the answer to "what is it doing" when
 * your hands are on the keyboard and the notch is on another screen — and
 * pressing it again puts it away early.
 */
const PEEK_MS = 2600;
let peekTimer: NodeJS.Timeout | null = null;
function peek(): void {
  if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; notch?.hold(false); return; }
  notch?.hold(true);
  logEvent('island', 'peeked');
  peekTimer = setTimeout(() => { peekTimer = null; notch?.hold(false); }, PEEK_MS);
}

function register(accelerator: string, what: string, action: () => void): boolean {
  if (!accelerator) return true;
  try {
    const ok = globalShortcut.register(accelerator, action);
    logEvent('island', ok ? `${what} ${accelerator} registered` : `${what} ${accelerator} is taken by another app`);
    return ok;
  } catch (error) {
    logEvent('island', `${what} ${accelerator} rejected: ${(error as Error).message}`);
    return false;
  }
}

function registerShortcut(): boolean {
  const cfg = config();
  const opens = register(cfg.shortcut, 'shortcut', () => keyboard ? releaseKeyboard('shortcut') : openForKeyboard());
  // The two are registered together and reported together, but a peek shortcut
  // that clashes must not cost the one that opens the notch.
  const peeks = register(cfg.peekShortcut, 'peek shortcut', () => peek());
  return opens && peeks;
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

ipcMain.on('welcome:done', event => {
  if (BrowserWindow.fromWebContents(event.sender) !== welcome) return;
  finishWelcome();
});

ipcMain.on('island:close', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!notch?.owns(win)) return;
  if (keyboard) releaseKeyboard('swiped away');
  notch.close(win);
});

ipcMain.on('keyboard:done', (event) => {
  if (notch?.owns(BrowserWindow.fromWebContents(event.sender))) releaseKeyboard('escape');
});

/** Hand the measured cutout to both the store and the window's own sizing. */
function applyNotchGeometry(): void {
  // Each overlay is told its own screen's geometry. The store keeps the first
  // one, which is what the gallery and the settings preview draw when they have
  // no screen of their own to measure.
  const geometry = notch?.applyGeometry();
  const cfg = config();
  store.setNotch(geometry?.notchW ?? cfg.notchW, geometry?.notchH ?? cfg.notchH);
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

ipcMain.on('hit-rect', (event, r: HitRect) => {
  if (!r || !finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h)) return;
  notch?.setHitRect(BrowserWindow.fromWebContents(event.sender), r, Number(companion?.current().preferences.hoverPadding ?? 0));
});

function trustedAgentWindow(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return event.senderFrame === event.sender.mainFrame && !!win && (!!notch?.owns(win) || win === customize || win === welcome);
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

/**
 * The General and About panes: config.json values and the macOS integrations
 * that used to live only in the menu bar. Face preferences stay in the
 * companion store.
 */
/** Every attached screen, named and measured, with a mark on the ones carrying an island. */
function screenList(): ScreenInfo[] {
  const showing = new Set(notch?.displayIds() ?? []);
  return probeDisplays().map(d => ({
    id: d.id,
    name: d.name,
    builtin: d.builtin,
    cutout: d.notch ? { w: Math.round(d.notchW ?? 0), h: Math.round(d.notchH ?? 0) } : null,
    active: showing.has(d.id)
  }));
}

function appSettings(): AppSettings {
  const cfg = config();
  const probe = probeNotch();
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    loginItem: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    hoverDelay: cfg.hoverDelay,
    shortcut: cfg.shortcut,
    peekShortcut: cfg.peekShortcut,
    allowWithoutNotch: cfg.allowWithoutNotch,
    contentProtection: cfg.contentProtection,
    displays: cfg.displays,
    displayId: cfg.displayId,
    notchHeight: cfg.notchHeight,
    notchHeightCustom: cfg.notchHeightCustom,
    plainNotchHeight: cfg.plainNotchHeight,
    screens: screenList(),
    staleSec: cfg.staleSec,
    watchProcesses: cfg.watchProcesses,
    doneLingerSec: cfg.doneLingerSec,
    cutout: probe?.notch ? { w: Math.round(probe.notchW ?? 0), h: Math.round(probe.notchH ?? 0) } : null,
    claudeHooks: hooksInstalled(),
    configDir: APP_DIR
  };
}

/** Write a validated patch: login item to macOS, the rest to config.json, and a new shortcut to the keyboard right away. */
function applyAppSettings(patch: AppSettingsPatch): void {
  const { loginItem, ...rest } = patch;
  if (loginItem !== undefined) {
    if (!app.isPackaged) throw new Error('Launch at login needs the packaged app.');
    app.setLoginItemSettings({ openAtLogin: loginItem });
    logEvent('notchlight', `start at login ${loginItem ? 'on' : 'off'}`);
  }
  if (!Object.keys(rest).length) return;
  const before = { shortcut: config().shortcut, peekShortcut: config().peekShortcut };
  writeConfig(rest);
  // A display rule is the whole arrangement of windows, so it takes effect at
  // once rather than at the next launch.
  if (rest.contentProtection !== undefined) notch?.setContentProtection(rest.contentProtection);
  if (['displays', 'displayId', 'notchHeight', 'notchHeightCustom', 'plainNotchHeight', 'allowWithoutNotch'].some(key => key in rest)) {
    notch?.reconfigure();
    applyNotchGeometry();
  }
  if (rest.shortcut !== undefined && rest.shortcut !== before.shortcut || rest.peekShortcut !== undefined && rest.peekShortcut !== before.peekShortcut) {
    globalShortcut.unregisterAll();
    if (!registerShortcut()) {
      globalShortcut.unregisterAll();
      writeConfig(before);
      registerShortcut();
      throw new Error('That shortcut is taken by another app. The old one still works.');
    }
  }
}

/** A settings call from the customize window: answer with the fresh settings, or with why not. */
function settingsHandle(name: string, action: (...args: unknown[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(name, async (event, ...args) => {
    try {
      if (!trustedAgentWindow(event)) throw new Error('This window cannot change settings.');
      await action(...args);
      return { ok: true, settings: appSettings() };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'The action could not be completed.' };
    }
  });
}
ipcMain.handle('app:settings', event => {
  if (!trustedAgentWindow(event)) throw new Error('This window cannot read settings.');
  return appSettings();
});
settingsHandle('app:settings:update', patch => { applyAppSettings(validateAppSettings(patch)); refreshTray(); });
settingsHandle('app:updates', () => checkForUpdates());
settingsHandle('app:config-folder', async () => { const failure = await shell.openPath(APP_DIR); if (failure) throw new Error(failure); });
settingsHandle('app:gallery', () => openGallery());
settingsHandle('app:claude-hooks', () => installHooks());

ipcMain.on('update:respond', (event, response: UpdateResponse) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (event.senderFrame !== event.sender.mainFrame || !win || win !== updateWin) return;
  if (response !== 'download' && response !== 'later' && response !== 'skip') return;
  answerUpdate(response);
});

/** What the card looks like with something in it, for `--update-preview`. */
function sampleRelease(): Release {
  return {
    version: '9.9.9',
    title: 'Notchlight 9.9.9 — a sample release',
    notes: '## What changed\n- A newer Notchlight is offered from the menu bar when GitHub has one.\n- `Check for updates…` in the menu asks right away.\n- **Later** waits a day; **Skip this version** waits for the next one.\n\nNothing installs itself: the build is unsigned, so the DMG opens in your browser.',
    url: 'https://github.com/amargoyal/notchlight/releases',
    download: 'https://github.com/amargoyal/notchlight/releases',
    publishedAt: new Date().toISOString()
  };
}

ipcMain.on('open-customize', (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender === gallery || sender === customize || notch?.owns(sender)) openCustomize();
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
  smart?.stop();
  account?.stop();
  clips?.stop();
  pasteboardWatch?.stop();
  watcher?.stop();
  levels?.stop();
  hud?.stop();
  battery?.stop();
  calendar?.stop();
  store?.stop();
  hooks?.stop();
  updater?.stop();
  notch?.destroy();
});
