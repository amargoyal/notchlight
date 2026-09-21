/**
 * The first run.
 *
 * Everything Notchlight can do is off until someone says otherwise — the hooks
 * are not installed, Codex is not read, no player is connected, the clipboard
 * remembers nothing. That is the right default for every one of them and the
 * wrong first impression for all of them at once: a new install is a black
 * notch that does nothing, with the switches that would change that buried four
 * panes deep.
 *
 * So this asks once, in the order the answers matter, and every step can be
 * skipped. Nothing here is a wall: Skip leaves the setting exactly where it was,
 * and the same rows live in the settings window afterwards.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './welcome.css';
import { Buddy } from './Buddy';
import { PLAYER_NAMES } from '../shared/companion';
import type { CompanionPreferences, CompanionSnapshot, OperationResult } from '../shared/companion';
import type { AppSettings } from '../shared/settings';

/** The app icon as the Dock draws it: the notch hung from the edge of an ivory squircle. */
function AppMark({ size = 64 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22.37" fill="#f2ede7"/><path d="M16 0H84V20A16 16 0 0 1 68 36H32A16 16 0 0 1 16 20Z" fill="#000"/><circle cx="34" cy="20" r="6.5" fill="#5fbe86"/></svg>;
}

function Row({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="welcome-row">
    <span className="welcome-row-text"><b>{title}</b><span>{description}</span></span>
    <span className="welcome-row-control">{children}</span>
  </div>;
}
function Switch({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <input type="checkbox" role="switch" aria-label={label} className="welcome-switch" checked={value} onChange={e => onChange(e.target.checked)}/>;
}
function Button({ strong, ...rest }: { strong?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={`welcome-button${strong ? ' is-strong' : ''}`}/>;
}
function Done({ children }: { children: ReactNode }) {
  return <span className="welcome-done"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>{children}</span>;
}

export type StepId = 'welcome' | 'agents' | 'music' | 'extras' | 'done';
export const STEPS: StepId[] = ['welcome', 'agents', 'music', 'extras', 'done'];

interface StepProps {
  preferences: CompanionPreferences;
  settings: AppSettings;
  pref: (patch: Partial<CompanionPreferences>) => void;
  run: (operation: () => Promise<OperationResult>) => void;
  music: CompanionSnapshot['music'];
}

function WelcomeStep() {
  return <>
    <div className="welcome-mark"><AppMark/></div>
    <h1>A quieter place to work.</h1>
    <p className="welcome-lede">
      Notchlight fills the notch with the things you keep checking — what your agents are doing,
      what is playing, the files you are carrying between apps. It stays out of the way until it has
      something to say.
    </p>
    <div className="welcome-rows">
      <Row title="Everything is off until you ask" description="Nothing is read, watched or connected until you switch it on. This takes a minute and every step can be skipped."/>
      <Row title="Nothing leaves this Mac" description="Sessions, clipboard history and what is playing are read locally and stay here. The only thing Notchlight asks the network is whether there is a new version."/>
    </div>
  </>;
}

function AgentsStep({ preferences, settings, pref, run }: StepProps) {
  return <>
    <div className="welcome-mark"><Buddy size={56}/></div>
    <h1>Your agents, on the bar.</h1>
    <p className="welcome-lede">A light for each running session, and its question when it has one — without a terminal in front of you.</p>
    <div className="welcome-rows">
      <Row title="Claude Code" description="The hooks tell Notchlight when a session starts, asks something and ends. Without them a finished session lingers until it goes stale.">
        {settings.claudeHooks ? <Done>Installed</Done> : <Button strong onClick={() => run(() => window.notchlight.installClaudeHooks())}>Install Hooks</Button>}
      </Row>
      <Row title="Codex" description="Reads task activity from Codex Desktop and the CLI on this Mac. No account connection is needed.">
        <Switch label="Monitor local Codex" value={preferences.codexEnabled} onChange={v => pref({ codexEnabled: v })}/>
      </Row>
    </div>
    <p className="welcome-note">Claude Code needs to be told about the hooks once. Existing sessions pick them up when they next start.</p>
  </>;
}

function MusicStep({ preferences, pref, run, music }: StepProps) {
  const choices: { value: CompanionPreferences['musicPlayer']; label: string }[] = [
    { value: 'spotify', label: PLAYER_NAMES.spotify }, { value: 'apple', label: PLAYER_NAMES.apple }, { value: 'auto', label: 'Whichever is open' }
  ];
  return <>
    <h1>What is playing.</h1>
    <p className="welcome-lede">
      Artwork and the bars on the resting bar, transport and a seek bar when it opens. macOS will ask
      for permission to control the player the first time.
    </p>
    <div className="welcome-rows">
      <Row title="Follow" description="Whichever is open starts with Spotify and moves to Apple Music while Spotify is not running.">
        <span className="welcome-choices">{choices.map(choice => <label key={choice.value} className={preferences.musicPlayer === choice.value ? 'is-selected' : ''}>
          <input type="radio" name="player" checked={preferences.musicPlayer === choice.value} onChange={() => pref({ musicPlayer: choice.value })}/>{choice.label}
        </label>)}</span>
      </Row>
      <Row title="Connect" description={music.status === 'ready' ? `Connected to ${PLAYER_NAMES[music.player]} on this Mac.` : 'Nothing is read until you connect.'}>
        {preferences.spotifyEnabled ? <Done>{music.status === 'ready' ? 'Connected' : 'On'}</Done> : <Button strong onClick={() => run(() => window.notchlight.connectSpotify())}>Connect</Button>}
      </Row>
      <Row title="Move with the music" description="The bars follow the player's actual output through a Core Audio tap. macOS asks for audio capture separately, and the bars work without it — they just stay quiet.">
        <Switch label="Move with the music" value={preferences.visualizer} onChange={v => pref({ visualizer: v })}/>
      </Row>
    </div>
  </>;
}

function ExtrasStep({ preferences, pref, run }: StepProps) {
  return <>
    <h1>The rest of it.</h1>
    <p className="welcome-lede">Each of these can wait. They are all in the settings window under the same names.</p>
    <div className="welcome-rows">
      <Row title="Volume and brightness in the notch" description="Replaces the grey square macOS puts in the middle of the screen. Needs Accessibility, so that it can see the keys before macOS does.">
        <Switch label="Volume and brightness in the notch" value={preferences.hudEnabled} onChange={v => pref({ hudEnabled: v })}/>
        {preferences.hudEnabled && <Button onClick={() => run(() => window.notchlight.openAccessibility())}>Allow…</Button>}
      </Row>
      <Row title="Battery" description="The level on the resting bar, and a word when the charger goes in or comes out.">
        <Switch label="Battery" value={preferences.batteryEnabled} onChange={v => pref({ batteryEnabled: v })}/>
      </Row>
      <Row title="Clipboard history" description="What you copied, still within reach. Kept on this Mac in a file only you can read; passwords and one-time codes are skipped.">
        <Switch label="Clipboard history" value={preferences.clipboardEnabled} onChange={v => pref({ clipboardEnabled: v })}/>
      </Row>
    </div>
  </>;
}

function DoneStep({ settings }: StepProps) {
  return <>
    <div className="welcome-mark"><AppMark size={56}/></div>
    <h1>That is everything.</h1>
    <p className="welcome-lede">
      Rest the pointer on the notch to open it, or press {settings.shortcut ? shortcut(settings.shortcut) : 'the shortcut'} from anywhere.
      Two fingers up folds it away again.
    </p>
    <div className="welcome-rows">
      <Row title="Settings" description="Every switch here, and a good many more, live in the settings window — reachable from the menu bar icon or the gear in the open notch."/>
      <Row title="The gallery" description="Every face the notch can show, side by side. Useful for deciding what you want on the resting bar."/>
    </div>
  </>;
}

/** ⌥⇧N, from Electron's accelerator spelling. */
function shortcut(accelerator: string): string {
  const names: Record<string, string> = { commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', control: '⌃', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', super: '⌘', meta: '⌘' };
  return accelerator.split('+').filter(Boolean).map(part => names[part.toLowerCase()] ?? part.toUpperCase()).join('');
}

const PANES: Record<StepId, (props: StepProps) => ReactNode> = { welcome: WelcomeStep, agents: AgentsStep, music: MusicStep, extras: ExtrasStep, done: DoneStep };
const NEXT_LABEL: Record<StepId, string> = { welcome: 'Get Started', agents: 'Continue', music: 'Continue', extras: 'Continue', done: 'Open the Notch' };

function App() {
  const [step, setStep] = useState<StepId>('welcome');
  const [state, setState] = useState<CompanionSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const stop = window.notchlight.onCompanion(setState);
    void window.notchlight.getCompanion().then(setState).catch(() => setError('Could not read the current settings.'));
    void window.notchlight.getAppSettings().then(setSettings).catch(() => {});
    return stop;
  }, []);
  const run = (operation: () => Promise<OperationResult>) => {
    setError('');
    void operation()
      .then(result => { if (!result.ok) setError(result.error || 'That could not be done.'); })
      .then(() => window.notchlight.getAppSettings().then(setSettings).catch(() => {}))
      .catch(() => setError('That could not be done.'));
  };
  if (!state || !settings) return <div className="welcome-app"><div className="welcome-drag"/><div className="welcome-body"/></div>;
  const index = STEPS.indexOf(step);
  const Pane = PANES[step];
  const props: StepProps = {
    preferences: state.preferences, settings, music: state.music, run,
    pref: patch => run(() => window.notchlight.updatePreferences(patch))
  };
  const finish = () => window.notchlight.finishWelcome();
  return <div className="welcome-app">
    <div className="welcome-drag"/>
    <div className="welcome-body">
      <Pane {...props}/>
      {error && <p className="welcome-error" role="alert">{error}</p>}
    </div>
    <div className="welcome-foot">
      <span className="welcome-dots" aria-hidden="true">{STEPS.map((id, i) => <i key={id} className={i === index ? 'is-here' : ''}/>)}</span>
      {index > 0 && step !== 'done' && <Button onClick={() => setStep(STEPS[index - 1])}>Back</Button>}
      {step !== 'done' && step !== 'welcome' && <Button onClick={() => setStep(STEPS[index + 1])}>Skip</Button>}
      <Button strong onClick={() => step === 'done' ? finish() : setStep(STEPS[index + 1])}>{NEXT_LABEL[step]}</Button>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
