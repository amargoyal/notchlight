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

