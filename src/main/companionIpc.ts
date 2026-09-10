import { BrowserWindow, dialog, ipcMain, nativeImage, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CompanionStore } from './companionStore';
import { SpotifyPlayer } from './spotify';
import { ClipboardStore } from './clipboardStore';
import { trayIcon } from './png';
import type { OperationResult } from '../shared/companion';

type Event = IpcMainInvokeEvent | IpcMainEvent;
export function installCompanionIpc(store: CompanionStore, spotify: SpotifyPlayer, clips: ClipboardStore, trusted: (win: BrowserWindow | null) => boolean, dialogWindow: () => BrowserWindow) {
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
  handle('shelf:remove', (_e, ids) => store.remove(ids));
  handle('shelf:undo', () => store.undoRemove());
  handle('shelf:reveal', async (_e, id) => shell.showItemInFolder(await store.existingPath(id)));
  handle('shelf:locate', async (_e, id) => {
    const entry = store.entry(id);
    const result = await dialog.showOpenDialog(dialogWindow(), { title: `Where is ${path.basename(entry.path)} now?`, buttonLabel: 'Use This', defaultPath: path.dirname(entry.path), properties: ['openFile', 'openDirectory', 'showHiddenFiles'] });
    if (!result.canceled && result.filePaths[0]) await store.relocate(id, result.filePaths[0]);
  });
  handle('shelf:pick', async () => {
    const result = await dialog.showOpenDialog(dialogWindow(), { title: 'Add to Tray', properties: ['openFile', 'openDirectory', 'multiSelections'] });
    if (!result.canceled) await store.add(result.filePaths);
  });
  handle('shelf:copy', async (_e, ids) => {
    const { present } = await store.existingPaths(ids);
    if (!present.length) throw new Error('Those files were moved or removed. Use Locate to find them, or add them again.');
    const result = await dialog.showOpenDialog(dialogWindow(), { title: present.length === 1 ? 'Save a copy in…' : `Save ${present.length} copies in…`, buttonLabel: present.length === 1 ? 'Save Copy Here' : 'Save Copies Here', properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled && result.filePaths[0]) await store.copyTo(ids, result.filePaths[0]);
  });
  ipcMain.on('shelf:drag', (event, ids: unknown) => {
    try {
      check(event);
      const list = (Array.isArray(ids) ? ids : [ids]).filter((id): id is string => typeof id === 'string');
      const files = list.map(id => store.entry(id).path).filter(p => fs.existsSync(p));
      if (!files.length) throw new Error('Those files were moved or removed. Use Locate to find them, or add them again.');
      const thumbnail = store.current().files.find(f => f.id === list[0])?.thumbnail;
      let icon = thumbnail ? nativeImage.createFromDataURL(thumbnail) : nativeImage.createFromBuffer(trayIcon());
      if (icon.isEmpty()) icon = nativeImage.createFromBuffer(trayIcon());
      event.sender.startDrag({ file: files[0], files, icon });
      store.notice(`Drag to another app. ${files.length === 1 ? 'The item stays' : `The ${files.length} items stay`} in Tray until you remove ${files.length === 1 ? 'it' : 'them'}.${list.length > files.length ? ` ${list.length - files.length} missing ${list.length - files.length === 1 ? 'file was' : 'files were'} left out.` : ''}`);
    } catch (error) { store.notice((error as Error).message || 'Could not start the file drag.'); }
  });
  handle('codex:home', async () => {
    const result = await dialog.showOpenDialog(dialogWindow(), {title:'Choose Codex home', properties:['openDirectory','showHiddenFiles']});
    if (!result.canceled && result.filePaths[0]) await store.updatePreferences({codexHome:result.filePaths[0]});
  });
  handle('codex:hooks', async (_event, remove) => {
    if (typeof remove !== 'boolean') throw new Error('Invalid setup action.');
    const home = store.current().preferences.codexHome || process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
    const script = path.join(__dirname,'../../bin/install-codex-hooks.mjs');
    await promisify(execFile)(process.execPath,[script,'--home',home,...(remove ? ['--remove'] : [])],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:5000});
    store.notice(remove ? 'Notchlight Codex hooks removed. Reload your Codex sessions.' : 'Hooks installed. Review and trust them in Codex, then reload existing sessions.');
  });
  handle('spotify:connect', async () => {
    const alreadyEnabled = store.current().preferences.spotifyEnabled;
    await store.updatePreferences({ spotifyEnabled: true });
    if (alreadyEnabled) spotify.setEnabled(true);
  });
  handle('spotify:open', async () => {
    if (spotify.currentPlayer() === 'apple') await promisify(execFile)('open', ['-b', 'com.apple.Music'], { timeout: 5000 });
    else await shell.openExternal('spotify:');
  });
  handle('clipboard:copy', async (_e, id) => { await clips.copy(id); store.notice('Copied. Paste it wherever you like.'); });
  handle('clipboard:pin', (_e, id, pinned) => clips.pin(id, pinned));
  handle('clipboard:remove', (_e, id) => clips.remove(id));
  handle('clipboard:clear', async (_e, includePinned) => { await clips.clear(includePinned); store.notice(includePinned ? 'Clipboard history and pins cleared.' : 'Clipboard history cleared. Pinned items were kept.'); });
  handle('clipboard:pause', (_e, paused) => { if (typeof paused !== 'boolean') throw new Error('Invalid pause.'); clips.setPaused(paused); });
  handle('spotify:control', (_e, command, position) => spotify.command(command, position));
  return async () => {
    const result = await dialog.showOpenDialog(dialogWindow(), { title: 'Add to Tray', properties: ['openFile', 'openDirectory', 'multiSelections'] });
    if (!result.canceled) await store.add(result.filePaths);
  };
}
