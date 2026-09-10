import type { ReactNode } from 'react';
import type { AgentFilter, AgentProvider, Session, Snapshot } from '../shared/types';
import { Buddy, faceFor } from './Buddy';
import { lightColor } from './theme';
import { pulseStyle, usePulse } from './pulse';

/** The provider's light on the resting bar; breathes through the shared pulse timer while working. */
function RestingLight({ status, pulse }: { status: Session['status']; pulse: boolean }) {
  const pulsing = usePulse(pulse && status === 'working');
  return <i style={{ background: lightColor(status), ...pulseStyle(pulsing) }}/>;
}

export const providerName = (p: AgentProvider) => p === 'codex' ? 'Codex' : 'Claude';
export const providerOf = (s: Session): AgentProvider => s.provider ?? 'claude';
export function filteredSnapshot(snapshot: Snapshot, filter: AgentFilter): Snapshot {
  const sessions = filter === 'all' ? snapshot.sessions : snapshot.sessions.filter(s => providerOf(s) === filter);
  return { ...snapshot, sessions, dormant: !sessions.length, overall: sessions[0]?.status ?? 'idle', tokensKnown: new Set(sessions.map(providerOf)).size < 2 && sessions.every(s => s.tokensKnown !== false), tokens: sessions.reduce((n,s) => n + s.tokens,0) };
}
export function AgentFilters({snapshot, value, onChange}: {snapshot: Snapshot;value:AgentFilter;onChange:(f:AgentFilter)=>void}) {
  return <div className="agent-filters" role="group" aria-label="Filter agents">{(['all','claude','codex'] as const).map(p => <button key={p} aria-pressed={value === p} onClick={() => onChange(p)}>{p === 'all' ? 'All' : providerName(p)}<span>{snapshot.sessions.filter(s => p === 'all' || providerOf(s) === p).length}</span></button>)}</div>;
}
export function AgentConnection({snapshot,filter}: {snapshot:Snapshot;filter:AgentFilter}) {
  const health = snapshot.codex;
  if (filter !== 'codex' || !health || health.state === 'ready') return null;
  return <p className="agent-connection" role="status">{health.message}</p>;
}
export function AgentAttention({sessions,onSelect}: {sessions:Session[];onSelect:(s:Session)=>void}) {
  const requests = sessions.filter(s => s.status === 'asking');
  return requests.length ? <div className="agent-attention" aria-label="Agent requests">{(['claude','codex'] as const).map(p => {
    const matching = requests.filter(s => providerOf(s) === p);
    return matching.length ? <button key={p} onClick={() => onSelect(matching[0])}><span className="mp-attention-dot"/>{providerName(p)} needs you{matching.length > 1 ? ` · ${matching.length}` : ''}</button> : null;
  })}</div> : null;
}
export function agentRestingParts(snapshot: Snapshot, preferences: {restClaude:boolean;restCodex:boolean;buddy:boolean;codexBuddy:boolean;pulse:boolean;codexPulse:boolean}, onSelect:(provider:AgentProvider)=>void): {left:ReactNode;right:ReactNode;provider:boolean}[] {
  const mixed = new Set(snapshot.sessions.map(providerOf)).size > 1;
  // RestingWings lists outside→inside. Reversing keeps Claude nearest the lens.
  return (['codex','claude'] as const).flatMap(provider => {
    const sessions = snapshot.sessions.filter(s => providerOf(s) === provider);
    if (!sessions.length) return [];
    const status = sessions[0].status;
    if (!(provider === 'claude' ? preferences.restClaude : preferences.restCodex) && status !== 'asking') return [];
    const visibleBuddy = provider === 'claude' ? preferences.buddy : preferences.codexBuddy;
    const name = providerName(provider), short = provider === 'claude' ? 'Cl' : 'Cx';
    const label = `${name}: ${sessions.length} session${sessions.length === 1 ? '' : 's'}, ${status}`;
    const pulse = provider === 'claude' ? preferences.pulse : preferences.codexPulse;
    return [{provider:true,left:<button className="agent-resting" aria-label={label} onClick={() => onSelect(provider)}><RestingLight status={status} pulse={pulse}/>{mixed && <span>{short}</span>}{sessions.length > 1 && <small className="agent-rest-count">{Math.min(99,sessions.length)}{sessions.length > 99 ? '+' : ''}</small>}</button>,
      right:<button className="agent-resting" aria-label={`Show ${name} sessions`} onClick={() => onSelect(provider)}>{visibleBuddy ? <Buddy provider={provider} face={snapshot.now - (sessions[0].approvedAt ?? 0) < 1800 ? 'approved' : faceFor(status,!!sessions[0].tool)} size={22}/> : <span>{short}</span>}</button>}];
  });
}
