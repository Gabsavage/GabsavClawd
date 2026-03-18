import { useState } from 'react';
import { useWsStatus } from './hooks/useWs.js';
import Monitor   from './pages/Monitor.jsx';
import Pipeline  from './pages/Pipeline.jsx';
import Analytics from './pages/Analytics.jsx';
import Tokens    from './pages/Tokens.jsx';

const NAV = [
  { id: 'monitor',   label: 'MONITOR',   icon: '⬡' },
  { id: 'pipeline',  label: 'PIPELINE',  icon: '▦' },
  { id: 'analytics', label: 'ANALYTICS', icon: '◫' },
  { id: 'tokens',    label: 'TOKENS',    icon: '◈' },
];

const C = {
  bg:       '#05050e',
  surface:  '#0a0a1c',
  card:     '#0e0e24',
  border:   '#1a1a38',
  borderHi: '#2c2c52',
  green:    '#00ff88',
  amber:    '#f59e0b',
  cyan:     '#22d3ee',
  violet:   '#a855f7',
  rose:     '#f43f5e',
  text:     '#dde4f5',
  muted:    '#52576e',
  mutedHi:  '#7c829e',
};

function StatusDot({ status }) {
  const color =
    status === 'connected'    ? C.green  :
    status === 'connecting'   ? C.amber  : C.rose;
  const label =
    status === 'connected'    ? 'LIVE'   :
    status === 'connecting'   ? 'CONN…'  : 'OFF';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: color,
        display: 'inline-block',
        animation: status === 'connected' ? 'blink-slow 3s infinite' : 'blink 0.8s infinite',
      }} />
      <span style={{ fontSize: '9px', color, letterSpacing: '0.12em' }}>{label}</span>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState('monitor');
  const wsStatus = useWsStatus();

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* ── Sidebar ── */}
      <nav style={{
        width: '200px',
        flexShrink: 0,
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* Logo */}
        <div style={{
          padding: '24px 20px 20px',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: '18px',
            fontWeight: 800,
            color: C.green,
            letterSpacing: '0.06em',
          }}>
            OPENCLAWD
          </div>
          <div style={{ fontSize: '9px', color: C.muted, marginTop: '3px', letterSpacing: '0.15em' }}>
            CONTROL CENTER
          </div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {NAV.map(({ id, label, icon }) => {
            const active = page === id;
            return (
              <button
                key={id}
                onClick={() => setPage(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 10px',
                  background: active ? 'rgba(0,255,136,0.07)' : 'transparent',
                  border: 'none',
                  borderLeft: `2px solid ${active ? C.green : 'transparent'}`,
                  borderRadius: '0 6px 6px 0',
                  color: active ? C.green : C.muted,
                  cursor: 'pointer',
                  fontFamily: 'Space Mono, monospace',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.color = C.mutedHi; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.color = C.muted; } }}
              >
                <span style={{ fontSize: '13px', opacity: 0.7 }}>{icon}</span>
                {label}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: `1px solid ${C.border}`,
        }}>
          <StatusDot status={wsStatus} />
          <div style={{ fontSize: '8px', color: C.muted, marginTop: '8px', letterSpacing: '0.08em' }}>
            v0.1.0 — PHASE 1
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        {page === 'monitor'   && <Monitor />}
        {page === 'pipeline'  && <Pipeline />}
        {page === 'analytics' && <Analytics />}
        {page === 'tokens'    && <Tokens />}
      </main>

    </div>
  );
}
