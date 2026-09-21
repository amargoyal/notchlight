import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ApprovalDecision, HitRect, Snapshot } from '../shared/types';
import type { BatteryActivity, CompanionPreferences, CompanionSnapshot, CompanionView, HudActivity, SmartShuffleAnswer, SpotifyCommand } from '../shared/companion';
import type { UpdateInfo, UpdateResponse } from '../shared/updates';
import type { AppSettingsPatch } from '../shared/settings';

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('notchlight', {
  openCustomize: () => ipcRenderer.send('open-customize'),
  onSnapshot: (cb: (s: Snapshot) => void) => subscribe('snapshot', cb),
  onHover: (cb: (inside: boolean) => void) => subscribe('hover', cb),
  onGeometry: (cb: (geometry: { notchW: number; notchH: number }) => void) => subscribe('geometry', cb),
  onOpen: (cb: (open: boolean) => void) => subscribe('open', cb),
  onKeyboard: (cb: (taken: boolean) => void) => subscribe('keyboard', cb),
  keyboardDone: () => ipcRenderer.send('keyboard:done'),
  focusSession: (sessionId: string) => ipcRenderer.invoke('session:focus', sessionId),
  setHitRect: (r: HitRect) => ipcRenderer.send('hit-rect', r),
  decide: (sessionId: string, askId: string, decision: ApprovalDecision) => ipcRenderer.invoke('decide', { sessionId, askId, decision }),
  dismiss: (sessionId: string) => ipcRenderer.send('dismiss', sessionId),
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  installCodexHooks: (remove = false) => ipcRenderer.invoke('codex:hooks',remove),
  chooseCodexHome: () => ipcRenderer.invoke('codex:home'),
  getCompanion: () => ipcRenderer.invoke('companion:get'),
  onCompanion: (cb: (s: CompanionSnapshot) => void) => subscribe('companion', cb),
  updatePreferences: (patch: Partial<CompanionPreferences>) => ipcRenderer.invoke('companion:preferences', patch),
  setView: (view: CompanionView) => ipcRenderer.invoke('companion:view', view),
  addFiles: (files: File[]) => {
    const paths = files.map(file => webUtils.getPathForFile(file)).filter(Boolean);
    return paths.length ? ipcRenderer.invoke('shelf:add', paths) : Promise.resolve({ ok: false, error: 'Drop files from Finder.' });
  },
  pickFiles: () => ipcRenderer.invoke('shelf:pick'),
  removeFiles: (ids: string[]) => ipcRenderer.invoke('shelf:remove', ids),
  undoRemove: () => ipcRenderer.invoke('shelf:undo'),
  revealFile: (id: string) => ipcRenderer.invoke('shelf:reveal', id),
  locateFile: (id: string) => ipcRenderer.invoke('shelf:locate', id),
  saveFileCopy: (ids: string[]) => ipcRenderer.invoke('shelf:copy', ids),
  startFileDrag: (ids: string[]) => ipcRenderer.send('shelf:drag', ids),
  connectSpotify: () => ipcRenderer.invoke('spotify:connect'),
  openSpotify: () => ipcRenderer.invoke('spotify:open'),
  controlSpotify: (command: SpotifyCommand, position?: number) => ipcRenderer.invoke('spotify:control', command, position),
  signInSpotify: () => ipcRenderer.invoke('spotify:signin'),
  signOutSpotify: () => ipcRenderer.invoke('spotify:signout'),
  answerPick: (answer: SmartShuffleAnswer) => ipcRenderer.invoke('spotify:pick', answer),
  onMusicLevels: (cb: (levels: number[]) => void) => subscribe('music:levels', cb),
  onHud: (cb: (activity: HudActivity) => void) => subscribe('hud:event', cb),
  openAccessibility: () => ipcRenderer.invoke('hud:accessibility'),
  onBattery: (cb: (activity: BatteryActivity) => void) => subscribe('battery:event', cb),
  copyClipboardItem: (id: string) => ipcRenderer.invoke('clipboard:copy', id),
  pinClipboardItem: (id: string, pinned: boolean) => ipcRenderer.invoke('clipboard:pin', id, pinned),
  removeClipboardItem: (id: string) => ipcRenderer.invoke('clipboard:remove', id),
  clearClipboard: (includePinned: boolean) => ipcRenderer.invoke('clipboard:clear', includePinned),
  pauseClipboard: (paused: boolean) => ipcRenderer.invoke('clipboard:pause', paused),
  onUpdate: (cb: (info: UpdateInfo) => void) => subscribe('update', cb),
  respondToUpdate: (response: UpdateResponse) => ipcRenderer.send('update:respond', response),
  getAppSettings: () => ipcRenderer.invoke('app:settings'),
  updateAppSettings: (patch: AppSettingsPatch) => ipcRenderer.invoke('app:settings:update', patch),
  checkForUpdates: () => ipcRenderer.invoke('app:updates'),
  revealConfigFolder: () => ipcRenderer.invoke('app:config-folder'),
  openGallery: () => ipcRenderer.invoke('app:gallery'),
  installClaudeHooks: () => ipcRenderer.invoke('app:claude-hooks')
});
