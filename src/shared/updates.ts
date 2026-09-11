/**
 * What the update window is told, and what it can answer.
 *
 * The daemon does the comparing; the window only shows one release and asks
 * three questions. Nothing here downloads or installs anything — the build is
 * unsigned, so the honest path is the same one the README describes: open the
 * DMG in the browser, drag Notchlight into Applications.
 */
export interface UpdateInfo {
  /** The version running now, as `app.getVersion()` reports it. */
  current: string;
  /** The newest release on GitHub, without its `v`. */
  latest: string;
  /** The release title, or the tag when the release has none. */
  title: string;
  /** Release notes as written on GitHub, markdown, possibly empty. */
  notes: string;
  /** The release page. */
  url: string;
  /** The DMG for this machine, if the release has one; else the release page. */
  download: string;
  /** ISO timestamp of the release. */
  publishedAt: string;
  /** Resolved for the window: the desktop theme preference against the system. */
  theme: 'light' | 'dark';
}

/** The three buttons. */
export type UpdateResponse = 'download' | 'later' | 'skip';

export interface UpdateBridge {
  /** The release the window was opened for. Fires once the page has loaded. */
  onUpdate(cb: (info: UpdateInfo) => void): () => void;
  /** Download, remind me later, or skip this version. Closes the window. */
  respondToUpdate(response: UpdateResponse): void;
}
