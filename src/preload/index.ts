import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { HitRect, Snapshot } from '../shared/types';
import type { CompanionPreferences, CompanionSnapshot, CompanionView, SpotifyCommand } from '../shared/companion';

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('claudeLight', {
  openCustomize: () => ipcRenderer.send('open-customize'),
  onSnapshot: (cb: (s: Snapshot) => void) => subscribe('snapshot', cb),
  onHover: (cb: (inside: boolean) => void) => subscribe('hover', cb),
  onOpen: (cb: (open: boolean) => void) => subscribe('open', cb),
  setHitRect: (r: HitRect) => ipcRenderer.send('hit-rect', r),
  decide: (sessionId: string, askId: string, decision: 'allow' | 'deny') => ipcRenderer.send('decide', { sessionId, askId, decision }),
  dismiss: (sessionId: string) => ipcRenderer.send('dismiss', sessionId),
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  getCompanion: () => ipcRenderer.invoke('companion:get'),
  onCompanion: (cb: (s: CompanionSnapshot) => void) => subscribe('companion', cb),
  updatePreferences: (patch: Partial<CompanionPreferences>) => ipcRenderer.invoke('companion:preferences', patch),
  setView: (view: CompanionView) => ipcRenderer.invoke('companion:view', view),
  addFiles: (files: File[]) => {
    const paths = files.map(file => webUtils.getPathForFile(file)).filter(Boolean);
    return paths.length ? ipcRenderer.invoke('shelf:add', paths) : Promise.resolve({ ok: false, error: 'Drop files from Finder.' });
  },
  pickFiles: () => ipcRenderer.invoke('shelf:pick'),
  removeFile: (id: string) => ipcRenderer.invoke('shelf:remove', id),
  revealFile: (id: string) => ipcRenderer.invoke('shelf:reveal', id),
  saveFileCopy: (id: string) => ipcRenderer.invoke('shelf:copy', id),
  startFileDrag: (id: string) => ipcRenderer.send('shelf:drag', id),
  connectSpotify: () => ipcRenderer.invoke('spotify:connect'),
  openSpotify: () => ipcRenderer.invoke('spotify:open'),
  controlSpotify: (command: SpotifyCommand, position?: number) => ipcRenderer.invoke('spotify:control', command, position),
  onMusicLevels: (cb: (levels: number[]) => void) => subscribe('music:levels', cb)
});
