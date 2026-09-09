import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './island.css';
import './customize.css';
import { Buddy } from './Buddy';
import { CompanionDesktop, useCompanion } from './LiveCompanion';
import { DEFAULT_PREFERENCES } from './previewModel';
import { Icon, PreviewDesktop, usePreview } from './Preview';
import type { PreviewPreferences, PreviewState } from './previewModel';

type Section = 'appearance' | 'claude' | 'music' | 'tray';
const sections: { id: Section; label: string; description: string }[] = [
  { id: 'appearance', label: 'Appearance', description: 'Make a little space your own.' },
  { id: 'claude', label: 'Claude', description: 'A familiar face for the work ahead.' },
  { id: 'music', label: 'Music', description: 'Keep your rhythm within reach.' },
  { id: 'tray', label: 'Tray', description: 'For the things on their way somewhere.' }
];
function Toggle({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-row"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={value} onChange={e => onChange(e.target.checked)}/></label>;
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-group"><h2>{title}</h2>{children}</section>;
}
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <fieldset className="settings-choice"><legend>{label}</legend><div>{options.map(option => <label key={option.value} className={value === option.value ? 'selected' : ''}><input type="radio" name={label} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)}/>{option.label}</label>)}</div></fieldset>;
}
function App() {
  const { state, dispatch } = usePreview();
  const live = useCompanion();
  const prefs = live.available ? live.state.preferences : state.preferences;
  const [section, setSection] = useState<Section>('appearance');
  const current = sections.find(s => s.id === section)!;
  const pref = <K extends keyof PreviewPreferences>(key: K, value: PreviewPreferences[K]) => {
    if (live.available) void live.run(() => window.claudeLight.updatePreferences({ [key]: value }));
    else dispatch({ type: 'preferences', patch: { [key]: value } });
  };
  const navigate = (id: Section) => { setSection(id); if (id !== 'appearance') { if (live.available) void live.run(() => window.claudeLight.setView(id)); else dispatch({ type: 'view', view: id }); } };
  return <div className={`customize-app theme-${prefs.theme}`}>
    <aside className="settings-sidebar"><div className="settings-brand"><Buddy size={28}/><span>Claude Light<small>A little more useful.</small></span></div>
      <nav aria-label="Customization sections">{sections.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.id === 'claude' ? <Buddy size={18}/> : <Icon name={item.id}/>}<span>{item.label}</span></button>)}</nav>
      <div className="settings-sidebar-bottom"><span className="settings-preview-badge">{live.available ? 'Desktop companion' : 'Design preview'}</span><p>Three faces.<br/>One familiar place.</p><span>Claude Light · 0.1</span></div>
    </aside>
    <main className="settings-main"><header className="settings-header"><div><span>Customize</span><h1>{current.label}</h1><p>{current.description}</p></div><button className="mp-text-button settings-reset" disabled={live.available && !live.ready} onClick={() => { if (live.available) void live.run(() => window.claudeLight.updatePreferences(DEFAULT_PREFERENCES)); else dispatch({ type: 'reset' }); setSection('appearance'); }}><Icon name="reset" size={15}/>{live.available ? 'Reset preferences' : 'Reset Preview'}</button></header>
      <div className="settings-workspace"><fieldset className="settings-controls" disabled={live.available && !live.ready}>
        {section === 'appearance' && <>
          <Group title="Window appearance"><fieldset className="settings-theme"><legend className="sr-only">Desktop theme</legend>{(['light', 'dark', 'system'] as const).map(theme => <label key={theme} className={prefs.theme === theme ? 'selected' : ''}><input type="radio" name="desktop-theme" checked={prefs.theme === theme} onChange={() => pref('theme', theme)}/><span className={`theme-swatch swatch-${theme}`}><i/><b/><em/></span><span>{theme[0].toUpperCase() + theme.slice(1)}</span></label>)}</fieldset><p className="settings-hint">The notch stays black, just like the hardware.</p></Group>
          <Group title="Space & motion"><Choice label="Notch spacing" value={prefs.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} onChange={value => pref('density', value)}/><Toggle title="Reduce motion" description="Keep transitions and indicators still." value={prefs.reducedMotion} onChange={v => pref('reducedMotion', v)}/></Group>
          <div className="settings-tip"><Icon name="appearance" size={21}/><p>See it as you change it.<span>Switch between the tabs in the preview. Collapse the notch to see its smaller face.</span></p></div>
        </>}
        {section === 'claude' && <><Group title="Your companion"><Toggle title="Show buddy" description="A little company in your notch." value={prefs.buddy} onChange={v => pref('buddy', v)}/><Toggle title="Pulse while working" description="Let the status light gently breathe." value={prefs.pulse} onChange={v => pref('pulse', v)}/></Group>{!live.available && <Group title="Try a moment"><label className="settings-select">Claude state<select value={state.claude} onChange={e => dispatch({ type: 'claude', value: e.target.value as PreviewState['claude'] })}><option value="working">Working</option><option value="asking">Needs your attention</option><option value="done">Finished</option><option value="idle">Nothing running</option><option value="many">Several sessions</option></select></label><p className="settings-hint">Try “Needs your attention”, then switch to Music. Claude stays visible without interrupting you.</p></Group>}{live.available && <p className="settings-hint">Your real Claude sessions appear in the notch. Permission requests keep their existing behavior.</p>}</>}
        {section === 'music' && <><Group title="Now playing"><Toggle title="Show album artwork" description="Give each track a familiar face." value={prefs.artwork} onChange={v => pref('artwork', v)}/><Toggle title="Move with the music" description={live.available ? 'Bars in the collapsed wing follow what Spotify is actually playing.' : 'A quiet rhythm in the collapsed wing.'} value={prefs.visualizer} onChange={v => pref('visualizer', v)}/></Group>{!live.available && <Group title="Try a moment"><label className="settings-select">Player state<select value={state.music.missingArtwork ? 'missing' : state.music.source} onChange={e => dispatch({ type: 'music-state', source: e.target.value === 'missing' ? 'ready' : e.target.value as PreviewState['music']['source'], missingArtwork: e.target.value === 'missing' })}><option value="ready">Ready to play</option><option value="empty">Nothing playing</option><option value="missing">Missing artwork</option><option value="unavailable">Player unavailable</option></select></label><p className="settings-hint">Play, pause, skip, and seek through an original sample playlist. No audio will play.</p></Group>}{live.available && <Group title="Spotify connection"><p className="settings-hint">{live.state.music.message || (live.state.music.status === 'ready' ? 'Connected to Spotify on this Mac.' : 'Connect Spotify to show real music in the notch.')}</p><button className="mp-soft-button" disabled={live.state.music.busy} onClick={() => void live.run(() => window.claudeLight.connectSpotify())}>{live.state.preferences.spotifyEnabled ? 'Reconnect Spotify' : 'Connect Spotify'}</button>{live.state.preferences.spotifyEnabled && <button className="mp-text-button" style={{display:'block',marginTop:12}} onClick={() => void live.run(() => window.claudeLight.updatePreferences({spotifyEnabled:false}))}>Disconnect</button>}<p className="settings-hint">macOS may ask for Automation access to Spotify, and to capture audio so the bars can follow the music. No Spotify account sign-in is needed here.</p></Group>}</>}
        {section === 'tray' && <><Group title="Your temporary shelf"><Choice label="File thumbnails" value={prefs.thumbnails} options={[{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }]} onChange={v => pref('thumbnails', v)}/><Toggle title="Remove after transfer" description={live.available ? 'Clear after Save copy. Native drags keep the item.' : 'Clear the sample shelf when a file arrives.'} value={prefs.removeAfterTransfer} onChange={v => pref('removeAfterTransfer', v)}/></Group>{!live.available && <Group title="Try it out"><p className="settings-hint">Drag a file from the Finder preview into the notch. Pick it up again and drop it in the destination below.</p><p className="settings-hint">Or click a Finder file to add it, then select it in Tray and choose Take out.</p><button className="mp-soft-button" disabled={state.files.length === 0} onClick={() => dispatch({ type: 'files', files: [] })}>Empty sample tray</button></Group>}{live.available && <Group title="Move between apps"><p className="settings-hint">Drop files from Finder onto the notch or the shelf below. Drag them out into another app whenever you need them.</p><p className="settings-hint">Native drags keep the reference in Tray. Use Save copy… for a confirmed copy to a folder; originals are never deleted.</p><button className="mp-soft-button" onClick={() => void live.run(() => window.claudeLight.pickFiles())}>Add files…</button></Group>}</>}
        <div className="settings-local-note"><span>{live.available ? 'Saved on this Mac' : 'Just a preview'}</span><p>{live.available ? 'Preferences apply to your live notch and survive restarting the app.' : 'Changes apply here for this window session. Your live Claude island stays as it is.'}</p></div>
      </fieldset>{live.available ? <CompanionDesktop live={live} onCustomize={() => setSection('appearance')}/> : <PreviewDesktop state={state} dispatch={dispatch} onCustomize={() => setSection('appearance')}/>}</div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
