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

function AppearancePane({ prefs, pref }: PaneProps) {
  return <>
    <Group title="Settings window">
      <Row title="Theme">
        <span className="settings-theme">{(['light', 'dark', 'system'] as const).map(theme => <label key={theme} className={prefs.theme === theme ? 'selected' : ''}><input type="radio" name="desktop-theme" checked={prefs.theme === theme} onChange={() => pref('theme', theme)}/><span className={`theme-swatch swatch-${theme}`}><i/><b/><em/></span><span>{theme[0].toUpperCase() + theme.slice(1)}</span></label>)}</span>
      </Row>
    </Group>
    <Group title="Notch">
      <Row title="Spacing" description="Comfortable gives rows a little more room when the notch is open."><Segmented label="Spacing" value={prefs.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} onChange={v => pref('density', v)}/></Row>
      <Toggle title="Reduce motion" description="Keeps transitions, the pulse and the bars still." value={prefs.reducedMotion} onChange={v => pref('reducedMotion', v)}/>
    </Group>
    <Group title="Resting bar" footer="What the collapsed notch shows. Faces share the bar when they have something to show; either agent still surfaces a request when it needs you.">
      <Toggle title="Claude" description="Status light and buddy while a session runs." icon={<Buddy size={16}/>} value={prefs.restClaude} onChange={v => pref('restClaude', v)}/>
      <Toggle title="Codex" description="A separate light and robot while Codex works." icon={<Robot/>} value={prefs.restCodex} onChange={v => pref('restCodex', v)}/>
      <Toggle title="Music" description="Artwork and the bars while a track is ready." value={prefs.restMusic} onChange={v => pref('restMusic', v)}/>
      <Toggle title="Tray" description="A count of what you have set aside." value={prefs.restTray} onChange={v => pref('restTray', v)}/>
      <Toggle title="Clipboard" description={prefs.clipboardEnabled ? 'The kind of the latest item and a count.' : 'Turn on the clipboard history to show it here.'} value={prefs.clipboardEnabled && prefs.restClipboard} disabled={!prefs.clipboardEnabled} onChange={v => pref('restClipboard', v)}/>
    </Group>
  </>;
}

function AgentsPane({ live, state, dispatch, prefs, pref, app }: PaneProps) {
  const codex = live.state.preferences;
  return <>
    <Group title="Claude Code" footer="Gated tools are answered in the notch; everything else in the terminal.">
      <Row title="Claude Code" description={live.available ? live.snapshot.claude?.message || 'Sessions on this Mac appear in the notch.' : 'Sessions on this Mac appear in the notch.'}>
        {live.available ? (app.settings.claudeHooks ? <Status>Hooks installed</Status> : <Button onClick={() => void live.run(() => window.notchlight.installClaudeHooks()).then(app.refresh)}>Install Hooks…</Button>)
          : <Popup label="Sample Claude state" value={state.claude} options={[{ value: 'working', label: 'Working' }, { value: 'asking', label: 'Needs your attention' }, { value: 'done', label: 'Finished' }, { value: 'idle', label: 'Nothing running' }, { value: 'many', label: 'Several sessions' }]} onChange={value => dispatch({ type: 'claude', value })}/>}
      </Row>
      <Toggle title="Show buddy" description="A little company in your notch." icon={<Buddy size={16}/>} value={prefs.buddy} onChange={v => pref('buddy', v)}/>
      <Toggle title="Pulse while working" description="Let the status light gently breathe." value={prefs.pulse} onChange={v => pref('pulse', v)}/>
      <Toggle title="Tokens per second" description="A small line in the session panel showing the last minute of output." value={prefs.sparkline} onChange={v => pref('sparkline', v)}/>
    </Group>
    <Group title="Codex">
      {live.available ? <>
        <Toggle title="Monitor local Codex" description="Reads activity from Codex Desktop and CLI on this Mac. Off by default; no account connection is needed." value={codex.codexEnabled} onChange={v => void live.run(() => window.notchlight.updatePreferences({ codexEnabled: v }))}/>
        <Row title="Connection" description={live.snapshot.codex?.message || 'Enable Codex to read local task activity.'}><Status tone={live.snapshot.codex?.state === 'ready' ? 'good' : live.snapshot.codex?.state === 'disabled' || !live.snapshot.codex ? 'off' : 'wait'}>{live.snapshot.codex?.state === 'ready' ? 'Reading' : live.snapshot.codex?.state === 'missing' ? 'Not found' : live.snapshot.codex?.state === 'unsupported' ? 'Unsupported' : 'Off'}</Status></Row>
        <Row title="Codex home" description="Where Codex keeps its sessions."><span className="settings-path">{codex.codexHome || '~/.codex'}</span><Button onClick={() => void live.run(() => window.notchlight.chooseCodexHome())}>Choose…</Button>{codex.codexHome && <Button kind="quiet" onClick={() => void live.run(() => window.notchlight.updatePreferences({ codexHome: '' }))}>Use Default</Button>}</Row>
      </> : <Row title="Sample Codex state" description="Try the states the Agents face can show."><Popup label="Sample Codex state" value={state.codex} options={(['off', 'working', 'asking', 'done', 'failed', 'idle', 'interrupted', 'unknown', 'many'] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={value => dispatch({ type: 'codex', value })}/></Row>}
      <Toggle title="Show robot" description="A cool ivory robot for local Codex tasks." icon={<Robot/>} value={prefs.codexBuddy} onChange={v => pref('codexBuddy', v)}/>
      <Toggle title="Pulse while working" description="Let Codex’s light breathe while it works." value={prefs.codexPulse} onChange={v => pref('codexPulse', v)}/>
    </Group>
    {live.available && <Group title="Codex approvals" footer={<>Codex asks you to review and trust new hook definitions with <code>/hooks</code>, then reload or restart open sessions. Codex’s own approval policy is never changed.</>}>
      <Row title="Hooks" description="Give immediate status and make approvals possible. Other installed hooks are preserved."><Button onClick={() => void live.run(() => window.notchlight.installCodexHooks())}>Install Hooks</Button><Button kind="quiet" onClick={() => void live.run(() => window.notchlight.installCodexHooks(true))}>Remove</Button></Row>
      <Toggle title="Answer approvals in Notchlight" description="Allow once, deny, or hand back to Codex. Unanswered requests return to Codex after 55 seconds." value={codex.codexApprovals} onChange={v => void live.run(() => window.notchlight.updatePreferences({ codexApprovals: v }))}/>
    </Group>}
  </>;
}

function MusicPane({ live, state, dispatch, prefs, pref }: PaneProps) {
  const music = live.state.music;
  const account = live.state.smartShuffle.account;
  const playerName = PLAYER_NAMES[music.player];
  return <>
    {live.available ? <Group title="Player" footer="macOS may ask for Automation access to the player. No account sign-in is needed for playback.">
      <Row title="Follow" description="Whichever is open starts with Spotify and moves to Apple Music while Spotify is not running."><Popup label="Follow" value={live.state.preferences.musicPlayer} options={[{ value: 'spotify', label: 'Spotify' }, { value: 'apple', label: 'Apple Music' }, { value: 'auto', label: 'Whichever is open' }]} onChange={v => void live.run(() => window.notchlight.updatePreferences({ musicPlayer: v }))}/></Row>
      <Row title="Connection" description={music.message || (music.status === 'ready' ? `Connected to ${playerName} on this Mac.` : 'Connect a player to show real music in the notch.')}>
        <Status tone={music.status === 'ready' ? 'good' : music.status === 'disconnected' ? 'off' : 'wait'}>{music.status === 'ready' ? 'Connected' : music.status === 'disconnected' ? 'Not connected' : music.status === 'not-running' ? `${playerName} is closed` : 'Waiting'}</Status>
        <Button disabled={music.busy} onClick={() => void live.run(() => window.notchlight.connectSpotify())}>{live.state.preferences.spotifyEnabled ? 'Reconnect' : 'Connect'}</Button>
        {live.state.preferences.spotifyEnabled && <Button kind="quiet" onClick={() => void live.run(() => window.notchlight.updatePreferences({ spotifyEnabled: false }))}>Disconnect</Button>}
      </Row>
    </Group> : <Group title="Player" footer="Play, pause, skip and seek through an original sample playlist. No audio will play.">
      <Row title="Sample state" description="Try the states the Music face can show."><Popup label="Sample player state" value={state.music.missingArtwork ? 'missing' : state.music.source} options={[{ value: 'ready', label: 'Ready to play' }, { value: 'empty', label: 'Nothing playing' }, { value: 'missing', label: 'Missing artwork' }, { value: 'unavailable', label: 'Player unavailable' }]} onChange={value => dispatch({ type: 'music-state', source: value === 'missing' ? 'ready' : value as PreviewState['music']['source'], missingArtwork: value === 'missing' })}/></Row>
    </Group>}
    <Group title="Now playing">
      <Toggle title="Album artwork" description="Give each track a familiar face." value={prefs.artwork} onChange={v => pref('artwork', v)}/>
      <Toggle title="Glow in the artwork’s colour" description="A soft light behind the artwork and the bars, taken from the record sleeve." value={prefs.artworkGlow} onChange={v => pref('artworkGlow', v)}/>
      <Toggle title="Breathe with the bass" description="The small artwork moves with the low end while the bars are live. Still under Reduce motion." value={prefs.artworkPulse} onChange={v => pref('artworkPulse', v)}/>
    </Group>
    <Group title="Visualizer" footer={live.available && live.state.preferences.spotifyEnabled ? 'Capture is separate from the connection: track details and playback keep working when the bars cannot. Nothing is recorded; the output is reduced to five numbers and dropped.' : undefined}>
      <Toggle title="Move with the music" description={live.available ? 'Bars in the collapsed wing follow what is actually playing.' : 'A quiet rhythm in the collapsed wing.'} value={prefs.visualizer} onChange={v => pref('visualizer', v)}/>
      <Row title="Bars" description="Mirrored folds nine bars around the bass so they read as one shape."><Segmented label="Bars" value={prefs.equalizerLayout} options={[{ value: 'rising', label: 'Rising' }, { value: 'mirrored', label: 'Mirrored' }]} onChange={v => pref('equalizerLayout', v)}/></Row>
      {live.available && live.state.preferences.spotifyEnabled && <Row title="Audio capture" description={describeCapture(live.state.capture, music, live.state.preferences)}><Status tone={live.state.capture.status === 'listening' ? 'good' : live.state.capture.status === 'unavailable' ? 'bad' : 'off'}>{live.state.capture.status === 'listening' ? 'Listening' : live.state.capture.status === 'starting' ? 'Starting' : live.state.capture.status === 'unavailable' ? 'Unavailable' : 'Idle'}</Status></Row>}
    </Group>
    <Group title="Smart Shuffle" footer={live.available ? <>Picks come from Spotify’s Web API, which needs an app of your own: create one at developer.spotify.com/dashboard, add the redirect address as a Redirect URI, and paste its Client ID here. Playback needs none of this.</> : undefined}>
      <Toggle title="Mark Smart Shuffle picks" description="A track Spotify slipped into the playlist gets a mark, with + to keep it and × to move on." value={prefs.smartShuffle} onChange={v => pref('smartShuffle', v)}/>
      {live.available && <>
        <Row title="Redirect URI" description="Add this to your Spotify app before signing in."><span className="settings-code"><code>{SPOTIFY_REDIRECT_URI}</code><Button onClick={() => void navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI)}><Icon name="copy" size={13}/>Copy</Button></span></Row>
        <Row title="Client ID" description="Saved when it is whole: on blur or Enter."><ClientIdField value={live.state.preferences.spotifyClientId} onSave={id => void live.run(() => window.notchlight.updatePreferences({ spotifyClientId: id }))}/></Row>
        <Row title="Spotify account" description={describeAccount(account)}>
          <Status tone={account.status === 'ready' ? 'good' : account.status === 'signing-in' ? 'wait' : account.status === 'error' ? 'bad' : 'off'}>{account.status === 'ready' ? `Signed in${account.user ? ` as ${account.user}` : ''}` : account.status === 'signing-in' ? 'Waiting for your browser' : 'Signed out'}</Status>
          {account.status !== 'off' && <Button disabled={account.status === 'signing-in'} onClick={() => void live.run(() => account.status === 'ready' ? window.notchlight.signOutSpotify() : window.notchlight.signInSpotify())}>{account.status === 'ready' ? 'Sign Out' : 'Sign In'}</Button>}
        </Row>
      </>}
    </Group>
  </>;
}

function TrayPane({ live, state, dispatch, prefs, pref }: PaneProps) {
  const nextSample = SAMPLE_FILES.find(file => !state.files.some(f => f.id === file.id));
  return <>
    <Group title="Shelf" footer={live.available ? 'Native drags keep the reference in Tray. Save Copy… makes a confirmed copy in a folder; originals are never deleted.' : 'Drag a sample file from the notch into another face, or click one to add it.'}>
      <Row title="Thumbnails" description="Large shows the file preview; Small keeps more items in view."><Segmented label="Thumbnails" value={prefs.thumbnails} options={[{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }]} onChange={v => pref('thumbnails', v)}/></Row>
      <Toggle title="Remove after Save Copy" description={live.available ? 'Clears an item once a copy lands in a folder. Native drags keep the item.' : 'Clears the sample shelf when a file arrives.'} value={prefs.removeAfterTransfer} onChange={v => pref('removeAfterTransfer', v)}/>
      <Row title="Add files" description={live.available ? 'Or drop them from Finder onto the notch.' : 'Sample files, for a look at the shelf.'}>
        {live.available ? <Button onClick={() => void live.run(() => window.notchlight.pickFiles())}><Icon name="folder" size={13}/>Add Files…</Button>
          : <><Button disabled={!nextSample} onClick={() => { if (nextSample) dispatch({ type: 'files', files: [...state.files, nextSample] }); }}>Add Sample File</Button><Button kind="quiet" disabled={state.files.length === 0} onClick={() => dispatch({ type: 'files', files: [] })}>Empty Tray</Button></>}
      </Row>
    </Group>
    {live.available && <Group title="Right now">
      <Row title={`${live.state.files.length} ${live.state.files.length === 1 ? 'item' : 'items'} on the shelf`} description={live.state.files.length ? live.state.files.slice(0, 3).map(f => f.name).join(' · ') + (live.state.files.length > 3 ? ' …' : '') : 'Nothing set aside yet.'}>
        <Button kind="danger" disabled={!live.state.files.length} onClick={() => void live.run(() => window.notchlight.removeFiles(live.state.files.map(f => f.id)))}>Empty Tray</Button>
      </Row>
    </Group>}
  </>;
}

function ClipboardPane({ live, prefs, pref, showView }: PaneProps) {
  const clips = live.state.clipboard;
  const pinned = clips.items.filter(i => i.pinned).length;
  return <>
    <Group title="History" footer="Passwords and one-time codes marked concealed or transient by their apps are never read. Items over 20 KB are skipped; the whole history stays under 2 MB and up to 20 items can be pinned. Images are not kept yet.">
      <Toggle title="Keep a clipboard history" description="Off until you say so. Text you copy is kept on this Mac, in a file only you can read. Nothing is sent anywhere." value={prefs.clipboardEnabled} onChange={v => { pref('clipboardEnabled', v); if (v) showView('clipboard'); }}/>
      <Row title="Remember up to" description="Older items make room for new ones; pins stay."><Popup label="Remember up to" value={prefs.clipboardHistorySize} options={[{ value: '20', label: '20 items' }, { value: '50', label: '50 items' }, { value: '100', label: '100 items' }]} onChange={v => pref('clipboardHistorySize', v)}/></Row>
      <Toggle title="Show on the resting bar" description="A count and the kind of the latest item on the collapsed notch." value={prefs.restClipboard} onChange={v => pref('restClipboard', v)}/>
    </Group>
    {live.available && prefs.clipboardEnabled && <Group title="Right now">
      <Row title={clips.paused ? 'Capture is paused' : 'Watching the clipboard'} description={`${clips.items.length} ${clips.items.length === 1 ? 'item' : 'items'} remembered, ${pinned} pinned.`}><Status tone={clips.paused ? 'off' : 'good'}>{clips.paused ? 'Paused' : 'Capturing'}</Status><Button onClick={() => void live.run(() => window.notchlight.pauseClipboard(!clips.paused))}>{clips.paused ? 'Resume' : 'Pause'}</Button></Row>
      <Row title="Clear history" description="Pinned items stay unless you clear everything."><Button disabled={!clips.items.length} onClick={() => void live.run(() => window.notchlight.clearClipboard(false))}>Clear, Keep Pins</Button><Button kind="danger" disabled={!clips.items.length} onClick={() => void live.run(() => window.notchlight.clearClipboard(true))}>Clear Everything</Button></Row>
    </Group>}
    {!live.available && <Group title="Try it out"><Row title="Sample history" description="Switch the history on to see the Clipboard face in the preview. Click a sample item to copy it again; pin what you want to keep."/></Group>}
  </>;
}

function AboutPane({ live, dispatch, app }: PaneProps) {
  const [confirming, setConfirming] = useState(false);
  const s = app.settings;
  const reset = () => { if (live.available) void live.run(() => window.notchlight.updatePreferences(DEFAULT_PREFERENCES)); else dispatch({ type: 'reset' }); setConfirming(false); };
  return <>
    <div className="settings-identity"><Buddy size={44}/><div><h2>Notchlight</h2><p>Version {s.version} · Claude and Codex activity, Spotify, and a file shelf, within reach.</p></div><span className="settings-identity-actions"><Button disabled={!live.available} onClick={() => void live.run(() => window.notchlight.checkForUpdates())}>Check for Updates</Button></span></div>
    <Group title="This Mac">
      <Row title="Cutout" description={s.cutout ? 'Measured on the built-in display each time Notchlight starts.' : 'No cutout on this display. The island can hang off the menu bar instead; see General.'}><span className="settings-path">{s.cutout ? `${s.cutout.w} × ${s.cutout.h} pt` : 'None'}</span></Row>
      <Row title="Config folder" description={`${s.configDir} holds config.json, the clipboard history and the log.`}><Button disabled={!live.available} onClick={() => void live.run(() => window.notchlight.revealConfigFolder())}><Icon name="folder" size={13}/>Reveal in Finder</Button></Row>
      <Row title="Faces gallery" description="Every face and state, side by side."><Button disabled={!live.available} onClick={() => void live.run(() => window.notchlight.openGallery())}>Open Gallery</Button></Row>
    </Group>
    <Group title="Reset">
      <Row title={live.available ? 'Reset all preferences' : 'Reset the preview'} description={live.available ? 'Puts every face preference back to its default. Sessions, hooks, config.json and the clipboard history are kept.' : 'Puts the sample notch back the way it started.'}>
        {confirming ? <><Button kind="danger" onClick={reset}>{live.available ? 'Reset Preferences' : 'Reset Preview'}</Button><Button kind="quiet" onClick={() => setConfirming(false)}>Cancel</Button></> : <Button onClick={() => setConfirming(true)}>Reset…</Button>}
      </Row>
    </Group>
    <p className="settings-credit">Made by Amar Goyal. <a href="https://github.com/amargoyal/notchlight" target="_blank" rel="noreferrer">Source on GitHub</a></p>
  </>;
}

/* ---- the window ---- */
function App() {
  const { state, dispatch } = usePreview();
  const live = useCompanion();
  const prefs = live.available ? live.state.preferences : state.preferences;
  const [section, setSection] = useState<Section>('general');
  const [query, setQuery] = useState('');
  const app = useAppSettings(live);
  const current = SECTIONS.find(s => s.id === section)!;
  const pref = <K extends keyof PreviewPreferences>(key: K, value: PreviewPreferences[K]) => {
    if (live.available) void live.run(() => window.notchlight.updatePreferences({ [key]: value }));
    else dispatch({ type: 'preferences', patch: { [key]: value } });
  };
  const showView = (view: View) => { if (live.available) void live.run(() => window.notchlight.setView(view)); else dispatch({ type: 'view', view }); };
  const navigate = (id: Section) => {
    setSection(id);
    if (id === 'agents' || id === 'music' || id === 'tray' || (id === 'clipboard' && prefs.clipboardEnabled)) showView(id);
  };
  const panes: Record<Section, (props: PaneProps) => ReactNode> = { general: GeneralPane, appearance: AppearancePane, agents: AgentsPane, music: MusicPane, tray: TrayPane, clipboard: ClipboardPane, about: AboutPane };
  const Pane = panes[section];
  return <div className={`customize-app theme-${prefs.theme}`}>
    <SearchContext.Provider value={query}>
      <Sidebar section={section} onSelect={navigate} query={query} onQuery={setQuery} live={live.available} version={app.settings.version}/>
      <main className="settings-main">
        <header className="settings-header"><h1>{current.label}</h1><span className="settings-pill"><i/>{live.available ? 'Saved on this Mac' : 'Preview only'}</span></header>
        <div className="settings-content">
          <p className="settings-description">{current.description}</p>
          <PreviewStrip live={live} state={state} dispatch={dispatch} onCustomize={() => setSection('appearance')}/>
          <fieldset className="settings-controls" disabled={live.available && !live.ready}>
            <Pane live={live} state={state} dispatch={dispatch} prefs={prefs} pref={pref} app={app} showView={showView}/>
          </fieldset>
        </div>
      </main>
    </SearchContext.Provider>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
