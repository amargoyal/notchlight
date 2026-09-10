import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(path.join(os.tmpdir(), 'notchlight-clipboard-'));
try {
  await build({ entryPoints: ['src/main/clipboardStore.ts'], bundle: true, platform: 'node', format: 'esm', outdir: root });
  const { ClipboardStore, toItem, MAX_PINNED, MAX_TEXT_BYTES, MAX_IMAGE_BYTES, SKIPPED_FORMATS } = await import(pathToFileURL(path.join(root, 'clipboardStore.js')).href);

  /** A pasteboard the test controls: what is on it, and what marks it carries. */
  const board = { text: '', image: null, formats: [], writes: [], imageReads: 0 };
  const pasteboard = {
    availableFormats: async () => [...board.formats, ...(board.text ? ['text/plain'] : []), ...(board.image ? ['image/png'] : [])],
    readText: async () => board.text,
    writeText: async text => { board.writes.push(text); board.text = text; board.image = null; board.formats = []; },
    readImage: async () => { board.imageReads++; return board.image; },
    writeImage: async png => { board.writes.push(png); board.image = { png, width: 1, height: 1, thumb: 'data:,thumb' }; board.text = ''; board.formats = []; }
  };
  const put = (text, ...formats) => { board.text = text; board.image = null; board.formats = formats; };
  const putImage = (bytes, width = 640, height = 480) => { board.image = { png: Buffer.alloc(bytes, bytes % 251), width, height, thumb: 'data:image/png;base64,thumb' }; board.text = 'alt text that comes with the picture'; board.formats = []; };
  const file = path.join(root, 'state', 'clipboard.json');
  const store = new ClipboardStore(file, pasteboard, 5);
  const changes = [];
  store.on('change', s => changes.push(s));
  await store.load();
  const texts = () => store.current().items.map(i => i.text);

  put('already there');
  store.configure(true, 50);
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(texts(), [], 'what was on the clipboard before capture began is not history');
  put('first copy');
  await store.poll();
  assert.deepEqual(texts(), ['first copy']);
  await store.poll(); await store.poll();
  assert.deepEqual(texts(), ['first copy'], 'the same clipboard is not remembered twice');
  put('second copy');
  await store.poll();
  put('first copy');
  await store.poll();
  assert.deepEqual(texts(), ['first copy', 'second copy'], 'copying something again moves it to the top, once');

  put('hunter2', 'org.nspasteboard.ConcealedType');
  await store.poll();
  put('one-time code', 'org.nspasteboard.TransientType');
  await store.poll();
  put('   \n  ');
  await store.poll();
  put('x'.repeat(MAX_TEXT_BYTES + 1));
  await store.poll();
  assert.deepEqual(texts(), ['first copy', 'second copy'], 'concealed, transient, blank and oversized pastes are never read');
  assert.ok(SKIPPED_FORMATS.includes('org.nspasteboard.ConcealedType'));

  const second = store.current().items[1];
  await store.copy(second.id);
  assert.deepEqual(board.writes, ['second copy'], 'copy writes the item back');
  assert.deepEqual(texts(), ['second copy', 'first copy'], 'and moves it to the top');
  await store.poll();
  assert.deepEqual(texts(), ['second copy', 'first copy'], 'the poller ignores its own write');

  store.setPaused(true);
  put('while paused');
  await store.poll();
  assert.deepEqual(texts(), ['second copy', 'first copy'], 'nothing is read while paused');
  store.setPaused(false);
  await new Promise(r => setTimeout(r, 10));
  await store.poll();
  assert.deepEqual(texts(), ['second copy', 'first copy'], 'what was copied during the pause stays private');
  put('after pause');
  await store.poll();
  assert.equal(texts()[0], 'after pause');

  // Pins survive the history cap and a plain clear; the pin budget is hard.
  const pinMe = store.current().items.find(i => i.text === 'first copy');
  await store.pin(pinMe.id, true);
  store.configure(true, 20);
  for (let i = 0; i < 30; i++) { put(`filler ${i}`); await store.poll(); }
  assert.equal(store.current().items.filter(i => !i.pinned).length, 20, 'the history size caps unpinned items');
  assert.ok(store.current().items.some(i => i.text === 'first copy' && i.pinned), 'a pinned item outlives the cap');
  await store.clear(false);
  assert.deepEqual(texts(), ['first copy'], 'clear keeps pins');
  for (let i = 0; i < MAX_PINNED + 2; i++) { put(`pin ${i}`); await store.poll(); }
  let pinned = 1;
  for (const item of store.current().items.filter(i => !i.pinned)) {
    try { await store.pin(item.id, true); pinned++; } catch { break; }
  }
  assert.equal(pinned, MAX_PINNED, 'pinning stops at the budget');
  await store.clear(true);
  assert.deepEqual(texts(), [], 'clear all removes pins too');

  // Persistence with owner-only permissions; disabling stops the poller and forgets nothing.
  put('kept on disk');
  await store.poll();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(((await stat(file)).mode & 0o777), 0o600, 'history is readable by the owner only');
  store.configure(false, 20);
  put('after disable');
  await store.poll();
  assert.deepEqual(texts(), ['kept on disk'], 'nothing is read once capture is off');
  store.stop();
  const again = new ClipboardStore(file, pasteboard, 5);
  await again.load();
  assert.deepEqual(again.current().items.map(i => i.text), ['kept on disk'], 'history survives a restart');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).items.length, 1);

  // Images: preferred over the text that rides along, kept as PNG with a thumbnail, deduped by bytes, capped, and never re-read while unchanged.
  const pics = new ClipboardStore(path.join(root, 'state', 'pics.json'), pasteboard, 5);
  await pics.load();
  pics.setWatched(true);
  pics.configure(true, 20);
  await new Promise(r => setTimeout(r, 10));
  putImage(1000);
  pics.notifyChange({ types: ['public.png'], concealed: false });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(pics.current().items[0]?.kind, 'image', 'an image wins over the text beside it');
  assert.equal(pics.current().items[0].preview, '640×480 image');
  assert.equal(pics.current().items[0].thumb, 'data:image/png;base64,thumb');
  assert.ok(pics.current().items[0].data.startsWith('data:image/png;base64,'));
  const reads = board.imageReads;
  await pics.poll(); await pics.poll();
  assert.equal(board.imageReads, reads + 2, 'a poll looks again…');
  assert.equal(pics.current().items.length, 1, '…but the same bytes are not remembered twice');
  putImage(MAX_IMAGE_BYTES + 1);
  pics.notifyChange({ types: ['public.png'], concealed: false });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(pics.current().items.length, 1, 'an oversized image is skipped');
  pics.notifyChange({ types: ['public.png'], concealed: true });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(board.imageReads, reads + 3, 'a concealed change is never read');
  const picture = pics.current().items[0];
  await pics.copy(picture.id);
  assert.ok(Buffer.isBuffer(board.writes.at(-1)) && board.writes.at(-1).length === 1000, 'copying an image back writes its PNG');
  await pics.poll();
  assert.equal(pics.current().items.length, 1, 'the write-back is ignored');
  put('text after picture');
  pics.notifyChange({ types: ['public.utf8-plain-text'], concealed: false });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(pics.current().items.map(i => i.kind), ['text', 'image']);
  const reopened = new ClipboardStore(path.join(root, 'state', 'pics.json'), pasteboard, 5);
  await reopened.load();
  assert.equal(reopened.current().items.find(i => i.kind === 'image')?.bytes, 1000, 'images survive a restart with their size known');
  assert.equal(pics.timer, null, 'no interval while the change-count helper is listening');
  pics.setWatched(false);
  assert.notEqual(pics.timer, null, 'the interval returns when the helper is gone');
  pics.stop();
  const url = toItem('https://example.com/path?q=1');
  assert.equal(url.kind, 'url'); assert.equal(url.host, 'example.com');
  assert.equal(toItem('not a url').kind, 'text');
  const long = toItem(`line one\nline two\n${'x'.repeat(300)}`);
  assert.equal(long.lines, 3);
  assert.ok(long.preview.length <= 140 && long.preview.startsWith('line one line two'));
  assert.ok(changes.length > 5, 'changes are published');
  console.log('Clipboard checks passed: images with thumbnails, change-count driven reads, capture from enable, dedupe, concealed/transient/blank/oversized skipped, copy back ignored, pause, caps, pins, clear, permissions, persistence.');
} finally { await rm(root, { recursive: true, force: true }); }
