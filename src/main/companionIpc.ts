import { BrowserWindow, dialog, ipcMain, nativeImage, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import { CompanionStore } from './companionStore';
import { SpotifyPlayer } from './spotify';
import { trayIcon } from './png';
import type { OperationResult } from '../shared/companion';

type Event = IpcMainInvokeEvent | IpcMainEvent;
export function installCompanionIpc(store: CompanionStore, spotify: SpotifyPlayer, trusted: (win: BrowserWindow | null) => boolean, dialogWindow: () => BrowserWindow) {
  function check(event: Event) {
    if (event.senderFrame !== event.sender.mainFrame || !trusted(BrowserWindow.fromWebContents(event.sender))) throw new Error('This window cannot change the companion.');
  }
  const handle = (name: string, action: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<void> | void) => {
    ipcMain.handle(name, async (event, ...args): Promise<OperationResult> => {
      try { check(event); await action(event, ...args); return { ok: true }; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const message = (code === 'EEXIST' || code === 'ERR_FS_CP_EEXIST') ? 'That destination already contains an item with this name. Choose another folder.' : code === 'EACCES' || code === 'EPERM' ? 'macOS did not allow access to that location. Choose another folder.' : (error as Error).message || 'The action could not be completed.';
        return { ok: false, error: message };
      }
    });
  };
  ipcMain.handle('companion:get', event => { check(event); return store.current(); });
  handle('companion:preferences', (_e, patch) => store.updatePreferences(patch));
  handle('companion:view', (_e, view) => store.setView(view));
  handle('shelf:add', (_e, files) => store.add(files));
  handle('shelf:remove', (_e, id) => store.remove(id));
  handle('shelf:reveal', async (_e, id) => shell.showItemInFolder(await store.existingPath(id)));
  handle('shelf:pick', async () => {
    const result = await dialog.showOpenDialog(dialogWindow(), { title: 'Add to Tray', properties: ['openFile', 'openDirectory', 'multiSelections'] });
    if (!result.canceled) await store.add(result.filePaths);
  });
  handle('shelf:copy', async (_e, id) => {
    await store.existingPath(id);
    const result = await dialog.showOpenDialog(dialogWindow(), { title: 'Save a copy in…', buttonLabel: 'Save Copy Here', properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled && result.filePaths[0]) await store.copyTo(id, result.filePaths[0]);
  });
  ipcMain.on('shelf:drag', (event, id: unknown) => {
    try {
      check(event);
      const entry = store.entry(id);
      if (!fs.existsSync(entry.path)) throw new Error('This file was moved or removed. Add it again.');
      const thumbnail = store.current().files.find(f => f.id === entry.id)?.thumbnail;
      let icon = thumbnail ? nativeImage.createFromDataURL(thumbnail) : nativeImage.createFromBuffer(trayIcon());
      if (icon.isEmpty()) icon = nativeImage.createFromBuffer(trayIcon());
      event.sender.startDrag({ file: entry.path, icon });
      store.notice('Drag to another app. The item stays in Tray until you remove it.');
    } catch (error) { store.notice((error as Error).message || 'Could not start the file drag.'); }
  });
  handle('spotify:connect', async () => {
    const alreadyEnabled = store.current().preferences.spotifyEnabled;
    await store.updatePreferences({ spotifyEnabled: true });
    if (alreadyEnabled) spotify.setEnabled(true);
  });
  handle('spotify:open', () => shell.openExternal('spotify:'));
  handle('spotify:control', (_e, command, position) => spotify.command(command, position));
  return async () => {
    const result = await dialog.showOpenDialog(dialogWindow(), { title: 'Add to Tray', properties: ['openFile', 'openDirectory', 'multiSelections'] });
    if (!result.canceled) await store.add(result.filePaths);
  };
}
