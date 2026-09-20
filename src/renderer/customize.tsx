import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type Dispatch, type KeyboardEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './island.css';
import './customize.css';
import { Buddy } from './Buddy';
import { CompanionSurface, useCompanion, type LiveController } from './LiveCompanion';
import { DEFAULT_PREFERENCES, SAMPLE_FILES } from './previewModel';
import { Icon, PreviewSurface, usePreview } from './Preview';
import type { PreviewAction, PreviewPreferences, PreviewState } from './previewModel';
import { describeAccount, describeCapture, PLAYER_NAMES, SPOTIFY_REDIRECT_URI } from '../shared/companion';
import { HOVER_DELAYS, LINGER_CHOICES, SAMPLE_APP_SETTINGS, STALE_CHOICES, shortcutLabel, withCurrent, type AppSettings, type AppSettingsPatch } from '../shared/settings';

/* ---- sections ---- */
type Section = 'general' | 'appearance' | 'agents' | 'music' | 'tray' | 'clipboard' | 'about';
const SECTIONS: { id: Section; label: string; description: string; icon: string; tile: string; keywords: string }[] = [
  { id: 'general', label: 'General', description: 'Startup, how the notch opens, and how long sessions stay on the bar.', icon: 'settings', tile: '#8d8a84', keywords: 'login startup updates hover delay shortcut keyboard sessions forget stale terminal finished' },
  { id: 'appearance', label: 'Appearance', description: 'How this window and the notch look. The notch stays black, like the hardware.', icon: 'appearance', tile: '#5f83a8', keywords: 'theme light dark system spacing compact comfortable motion resting bar collapsed' },
  { id: 'agents', label: 'Agents', description: 'Claude Code and Codex sessions on this Mac, and how each one shows up.', icon: 'face', tile: '#c97c5c', keywords: 'claude codex buddy robot pulse tokens hooks approvals home' },
  { id: 'music', label: 'Music', description: 'Which player the notch follows, and what the Music face shows.', icon: 'music', tile: '#c2606c', keywords: 'spotify apple player artwork glow bars visualizer capture smart shuffle client id' },
  { id: 'tray', label: 'Tray', description: 'A temporary shelf for files on their way somewhere.', icon: 'tray', tile: '#7f9a6b', keywords: 'shelf files thumbnails drag drop copy' },
  { id: 'clipboard', label: 'Clipboard', description: 'What you copied, still within reach. Off until you say so.', icon: 'clipboard', tile: '#b48b3e', keywords: 'history copy paste pins pause clear' },
  { id: 'about', label: 'About', description: 'Version, updates, and the things that live on this Mac.', icon: 'info', tile: '#8d8a84', keywords: 'version update release config folder gallery reset' }
];
type View = 'agents' | 'music' | 'tray' | 'clipboard';

/* ---- search ---- */
const SearchContext = createContext('');
function matches(query: string, ...texts: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || texts.some(text => text?.toLowerCase().includes(q));
}

/* ---- rows and groups ---- */
function RowText({ title, description }: { title: string; description?: string }) {
  return <span className="settings-row-text"><span className="settings-row-title">{title}</span>{description && <span className="settings-row-description">{description}</span>}</span>;
}
function Row({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  const hit = matches(useContext(SearchContext), title, description);
  return <div className={`settings-row${hit ? '' : ' is-dimmed'}`}><RowText title={title} description={description}/><span className="settings-row-control">{children}</span></div>;
}
function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return <section className="settings-group">{title && <h2>{title}</h2>}<div className="settings-group-rows">{children}</div>{footer && <p className="settings-group-footer">{footer}</p>}</section>;
}
function Toggle({ title, description, value, onChange, disabled, icon }: { title: string; description?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; icon?: ReactNode }) {
  const hit = matches(useContext(SearchContext), title, description);
  return <label className={`settings-row${hit ? '' : ' is-dimmed'}`}><RowText title={title} description={description}/><span className="settings-row-control">{icon}<input type="checkbox" role="switch" className="settings-switch" checked={value} disabled={disabled} onChange={e => onChange(e.target.checked)}/></span></label>;
}

/* ---- controls ---- */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <span className="settings-segmented" role="radiogroup" aria-label={label}>{options.map(option => <label key={option.value} className={value === option.value ? 'is-selected' : ''}><input type="radio" name={label} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)}/>{option.label}</label>)}</span>;
}
function Popup<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <span className="settings-popup"><select aria-label={label} value={String(value)} onChange={e => { const next = options.find(option => String(option.value) === e.target.value); if (next) onChange(next.value); }}>{options.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select><Icon name="updown" size={12}/></span>;
}
function Status({ tone = 'good', children }: { tone?: 'good' | 'wait' | 'off' | 'bad'; children: ReactNode }) {
  return <span className={`settings-status tone-${tone}`} role="status"><i/><span>{children}</span></span>;
}
function Button({ kind, children, ...rest }: { kind?: 'primary' | 'danger' | 'quiet' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={`settings-button${kind ? ` is-${kind}` : ''}`}>{children}</button>;
}
const Robot = () => <span style={{ width: 16, height: 16, borderRadius: 5, background: '#dce7ea', border: '1.5px solid #89aab5', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><i style={{ width: 8, height: 3, borderRadius: 2, background: '#15252d', display: 'block' }}/></span>;

/** The Client ID, saved when it is whole: on blur or Enter, never mid-typing. */
function ClientIdField({ value, onSave }: { value: string; onSave: (id: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const clean = draft.trim().toLowerCase();
  const valid = clean === '' || /^[0-9a-f]{32}$/.test(clean);
  const commit = () => { if (valid && clean !== value) onSave(clean); };
  return <span className="settings-field"><input type="text" spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder="32 characters, from your Spotify app" aria-label="Client ID" value={draft} aria-invalid={!valid} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}/>{!valid && <small>A Client ID is 32 hexadecimal characters.</small>}</span>;
}

/** Electron's accelerator for a key press, from the physical key so ⌥ does not turn N into ˜. */
function acceleratorFor(e: KeyboardEvent<HTMLElement>): string {
  const mods = [e.metaKey && 'Command', e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter((m): m is string => !!m);
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code
    : ({ Space: 'Space', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Tab: 'Tab' } as Record<string, string>)[code] ?? '';
  return key && mods.length ? [...mods, key].join('+') : '';
}
function ShortcutRecorder({ value, onSave }: { value: string; onSave: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false);
  return <>
    <button type="button" className={`settings-kbd${recording ? ' is-recording' : ''}`} aria-label={recording ? 'Press the new shortcut, or Escape to keep the old one' : `Shortcut: ${value ? shortcutLabel(value) : 'none'}. Click to change.`} onClick={() => setRecording(true)} onBlur={() => setRecording(false)} onKeyDown={e => {
      if (!recording) return;
      e.preventDefault();
      if (e.key === 'Escape') { setRecording(false); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { onSave(''); setRecording(false); return; }
      const accelerator = acceleratorFor(e);
      if (accelerator) { onSave(accelerator); setRecording(false); }
    }}>{recording ? 'Type a shortcut…' : value ? shortcutLabel(value) : 'None'}</button>
    {value && !recording && <Button kind="quiet" onClick={() => onSave('')}>Remove</Button>}
  </>;
}

/* ---- app settings, over the bridge when there is one ---- */
function useAppSettings(live: LiveController) {
  const [settings, setSettings] = useState<AppSettings>(SAMPLE_APP_SETTINGS);
  const refresh = useCallback(() => {
    if (!live.available || !window.notchlight.getAppSettings) return;
    void window.notchlight.getAppSettings().then(setSettings).catch(() => {});
  }, [live.available]);
  useEffect(refresh, [refresh]);
  const update = (patch: AppSettingsPatch) => {
    if (!live.available) { setSettings(s => ({ ...s, ...patch })); return; }
    void live.run(async () => {
      const result = await window.notchlight.updateAppSettings(patch);
      if (result.ok && result.settings) setSettings(result.settings);
      return result;
    });
  };
  return { settings, update, refresh };
}
type AppSettingsController = ReturnType<typeof useAppSettings>;

/* ---- sidebar ---- */
function Sidebar({ section, onSelect, query, onQuery, live, version }: { section: Section; onSelect: (id: Section) => void; query: string; onQuery: (q: string) => void; live: boolean; version: string }) {
  const visible = SECTIONS.filter(item => matches(query, item.label, item.keywords));
  return <aside className="settings-sidebar">
    <div className="settings-titlebar" aria-hidden="true"/>
    <label className="settings-search"><Icon name="search" size={13}/><input type="search" placeholder="Search" aria-label="Search settings" value={query} onChange={e => onQuery(e.target.value)}/></label>
    <nav aria-label="Settings sections">
      {visible.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}><span className="settings-tile" style={{ background: item.tile }}><Icon name={item.icon} size={12}/></span><span>{item.label}</span></button>)}
      {!visible.length && <p className="settings-search-empty">Nothing matches “{query}”.</p>}
    </nav>
    <div className="settings-sidebar-foot"><Buddy size={16}/><span><b>Notchlight</b> {version}</span><span className="settings-badge">{live ? 'This Mac' : 'Preview'}</span></div>
  </aside>;
}

/* ---- the preview strip ---- */
function PreviewStrip({ live, state, dispatch, onCustomize }: { live: LiveController; state: PreviewState; dispatch: Dispatch<PreviewAction>; onCustomize: () => void }) {
  const [open, setOpen] = useState(true);
  const expanded = live.available ? open : state.open;
  const setExpanded = (value: boolean) => { if (live.available) setOpen(value); else dispatch({ type: 'open', value }); };
  const notice = live.available ? live.error || live.state.notice : state.notice;
  return <section className={`settings-preview${expanded ? '' : ' is-collapsed'}`} aria-label="Live preview">
    <div className="settings-preview-bar">
      <span className="settings-preview-title"><i/>{live.available ? 'Your notch' : 'Live preview'}</span>
      <span className="settings-preview-tools"><span className="settings-preview-note">{live.available ? 'Changes apply as you make them.' : 'Sample data · no audio or real files'}</span><Segmented label="Notch state" value={expanded ? 'expanded' : 'collapsed'} options={[{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Collapsed' }]} onChange={v => setExpanded(v === 'expanded')}/></span>
    </div>
    <div className="mp-desktop">
      <div className="mp-menubar" aria-hidden="true"><span>{live.available ? 'Notchlight' : 'Finder'} <b>File</b> <b>Edit</b> <b>View</b></span><span>{live.available ? 'On this Mac' : 'Wed 9:41'}</span></div>
      <div className="mp-camera" style={{ width: live.available ? live.snapshot.notchW : 190, height: live.available ? live.snapshot.notchH : 34 }}/>
      {live.available ? <CompanionSurface live={live} open={open} hovering onCustomize={onCustomize}/> : <PreviewSurface state={state} dispatch={dispatch} onCustomize={onCustomize}/>}
    </div>
    <div className="settings-preview-notice" role={live.error ? 'alert' : 'status'} aria-live="polite">{notice || (live.available ? 'Music follows your player. Tray takes your real files.' : 'Tip: switch faces in the notch to see each one.')}</div>
  </section>;
}

/* ---- panes ---- */
interface PaneProps { live: LiveController; state: PreviewState; dispatch: Dispatch<PreviewAction>; prefs: PreviewPreferences; pref: <K extends keyof PreviewPreferences>(key: K, value: PreviewPreferences[K]) => void; app: AppSettingsController; showView: (view: View) => void }

function GeneralPane({ live, app }: PaneProps) {
  const s = app.settings;
  const noLogin = live.available && !s.packaged;
  return <>
    <Group title="Startup" footer={live.available ? (noLogin ? 'Launch at login is available in the packaged app.' : undefined) : 'These apply in the desktop app. Here they only change the preview.'}>
      <Toggle title="Launch at login" description="Open Notchlight when you sign in to this Mac." value={s.loginItem} disabled={noLogin} onChange={v => app.update({ loginItem: v })}/>
      <Row title="Updates" description={`Notchlight ${s.version}. New releases are offered from the menu bar; nothing installs itself.`}><Button disabled={!live.available} onClick={() => void live.run(() => window.notchlight.checkForUpdates())}>Check Now</Button></Row>
    </Group>
    <Group title="Opening the notch">
      <Row title="Hover delay" description="How long the pointer rests on the notch before it opens."><Popup label="Hover delay" value={s.hoverDelay} options={withCurrent(HOVER_DELAYS, s.hoverDelay, v => `${(v / 1000).toFixed(2)} seconds`)} onChange={v => app.update({ hoverDelay: v })}/></Row>
      <Row title="Keyboard shortcut" description="Opens the notch for the keyboard. Escape hands focus back to the app you were in."><ShortcutRecorder value={s.shortcut} onSave={v => app.update({ shortcut: v })}/></Row>
      <Toggle title="Show on a Mac without a notch" description="The island hangs off the menu bar instead of a cutout. Takes effect the next time Notchlight starts." value={s.allowWithoutNotch} onChange={v => app.update({ allowWithoutNotch: v })}/>
    </Group>
    <Group title="Sessions" footer="With the Claude Code hooks installed, a session leaves the moment it really ends.">
      <Row title="Forget a quiet session after" description="A session that has said nothing for this long leaves the bar."><Popup label="Forget a quiet session after" value={s.staleSec} options={withCurrent(STALE_CHOICES, s.staleSec, v => `${Math.round(v / 60)} minutes`)} onChange={v => app.update({ staleSec: v })}/></Row>
      <Toggle title="Watch for closed terminals" description="Checks for live claude processes so a closed window clears its light. Off skips the periodic scan." value={s.watchProcesses} onChange={v => app.update({ watchProcesses: v })}/>
      <Row title="Keep a finished light" description="Red means finished, not gone. Choose how long it stays."><Popup label="Keep a finished light" value={s.doneLingerSec} options={withCurrent(LINGER_CHOICES, s.doneLingerSec, v => `${Math.round(v / 60)} minutes`)} onChange={v => app.update({ doneLingerSec: v })}/></Row>
    </Group>
  </>;
}

