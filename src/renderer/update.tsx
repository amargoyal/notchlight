/**
 * "A newer Notchlight is ready."
 *
 * One card: what you run, what is out, what changed, and three answers. The
 * notes are GitHub markdown rendered by hand into a few tags — headings, lists,
 * paragraphs, inline code — because a release note is prose, not a web page,
 * and this window should never render HTML someone typed into a text box.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './update.css';
import { Buddy } from './Buddy';
import type { UpdateInfo, UpdateResponse } from '../shared/updates';

/** Inline: `code`, **bold**, [text](url) → text. Everything else is text. */
function inline(text: string, key: number): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={`${key}-${i++}`}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={`${key}-${i++}`}>{m[2]}</strong>);
    else out.push(m[3]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block: headings, bullet lists, paragraphs. Blank lines separate. */
export function renderNotes(notes: string): ReactNode[] {
  const lines = notes.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let k = 0;
  const flush = () => {
    if (para.length) { blocks.push(<p key={k++}>{inline(para.join(' '), k)}</p>); para = []; }
    if (list.length) { blocks.push(<ul key={k++}>{list.map((item, i) => <li key={i}>{inline(item, k * 100 + i)}</li>)}</ul>); list = []; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (!line.trim()) { flush(); continue; }
    if (heading) { flush(); blocks.push(<h3 key={k++}>{inline(heading[2], k)}</h3>); continue; }
    if (bullet) { if (para.length) flush(); list.push(bullet[1]); continue; }
    if (list.length) flush();
    para.push(line.trim());
  }
  flush();
  return blocks;
}

function releasedOn(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  return new Date(at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function App() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => window.notchlight.onUpdate(setInfo), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer('later');
      if (e.key === 'Enter' && !e.metaKey) answer('download');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const answer = (response: UpdateResponse) => window.notchlight.respondToUpdate(response);
  if (!info) return <div className="update-app"><div className="update-drag"/></div>;
  const date = releasedOn(info.publishedAt);
  const notes = renderNotes(info.notes);
  return <div className={`update-app theme-${info.theme}`}>
    <div className="update-drag"/>
    <header className="update-head"><Buddy face="approved" size={36}/><span><b>Notchlight</b><small>Update available</small></span></header>
    <h1>A newer Notchlight is ready.</h1>
    <div className="update-versions"><code>{info.current}</code><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 7h9M8 3.5 11.5 7 8 10.5"/></svg><code className="latest">{info.latest}</code>{date && <time dateTime={info.publishedAt}>Released {date}</time>}</div>
    <section className="update-notes" aria-label="Release notes">
      <h2>{info.title}</h2>
      {notes.length ? notes : <p className="empty">No notes for this release.</p>}
    </section>
    <p className="update-hint">The download opens in your browser. Quit Notchlight, drag the new one into Applications to replace this copy, and open it again.</p>
    <div className="update-actions">
      <button className="text" onClick={() => answer('skip')}>Skip this version</button>
      <span className="spacer"/>
      <button onClick={() => answer('later')}>Later<kbd>esc</kbd></button>
      <button className="primary" autoFocus onClick={() => answer('download')}>Download {info.latest}<kbd>↩</kbd></button>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
