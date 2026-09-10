import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ApprovalDecision, HitRect, Snapshot } from '../shared/types';
import type { CompanionPreferences, CompanionSnapshot, CompanionView, SpotifyCommand } from '../shared/companion';

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('notchlight', {
  openCustomize: () => ipcRenderer.send('open-customize'),
  onSnapshot: (cb: (s: Snapshot) => void) => subscribe('snapshot', cb),
  onHover: (cb: (inside: boolean) => void) => subscribe('hover', cb),
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
  onMusicLevels: (cb: (levels: number[]) => void) => subscribe('music:levels', cb),
  copyClipboardItem: (id: string) => ipcRenderer.invoke('clipboard:copy', id),
  pinClipboardItem: (id: string, pinned: boolean) => ipcRenderer.invoke('clipboard:pin', id, pinned),
  removeClipboardItem: (id: string) => ipcRenderer.invoke('clipboard:remove', id),
  clearClipboard: (includePinned: boolean) => ipcRenderer.invoke('clipboard:clear', includePinned),
  pauseClipboard: (paused: boolean) => ipcRenderer.invoke('clipboard:pause', paused)
});
