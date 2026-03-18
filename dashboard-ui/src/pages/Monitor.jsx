import { useState, useCallback } from 'react';
import { useApi, apiPost } from '../hooks/useApi.js';
import { useWsMessages } from '../hooks/useWs.js';

const C = {
  card: '#0e0e24', border: '#1a1a38', borderHi: '#2c2c52',
  green: '#00ff88', amber: '#f59e0b', cyan: '#22d3ee',
  violet: '#a855f7', rose: '#f43f5e', text: '#dde4f5',
  muted: '#52576e', mutedHi: '#7c829e',
};

const FLUX = {
  perplexity: { label: 'FLUX 1 — PERPLEXITY', sub: 'News & Reddit signals', color: C.cyan  },
  flux2:      { label: 'FLUX 2 — WEBSOCKET',  sub: 'Pump.fun migrations',   color: C.amber },
  flux3:      { label: 'FLUX 3 — GROK / CT',  sub: 'Crypto Twitter trends', color: C.violet },
};

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function StatBox({ label, value, accent }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: '8px', padding: '16px 20px',
      borderTop: accent ? `2px solid ${accent}` : undefined,
    }}>
      <div style={{ fontSize: '9px', color: C.muted, letterSpacing: '0.12em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: 700, color: C.text }}>{value ?? '—'}</div>
    </div>
  );
}

function CycleCard({ fluxKey, cycleData, running, onTrigger, triggering }) {
  const { label, sub, color } = FLUX[fluxKey];
  const last = cycleData?.log?.filter(e => e.type === fluxKey)[0];
  const isRunning = running?.includes(fluxKey);

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${isRunning ? color : C.border}`,
      borderTop: `3px solid ${color}`,
      borderRadius: '8px',
      padding: '20px',
      transition: 'border-color 0.4s, box-shadow 0.4s',
      boxShadow: isRunning ? `0 0 24px ${color}25` : 'none',
      animation: isRunning ? 'glow-pulse 2s infinite' : 'none',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color, letterSpacing: '0.1em' }}>{label}</div>
          <div style={{ fontSize: '9px', color: C.muted, marginTop: '2px' }}>{sub}</div>
        </div>
        <span style={{
          fontSize: '8px', padding: '3px 8px', borderRadius: '99px',
          background: isRunning ? `${color}22` : '#1a1a38',
          color: isRunning ? color : C.muted,
          letterSpacing: '0.1em',
          animation: isRunning ? 'blink 0.9s infinite' : 'none',
        }}>
          {isRunning ? '● RUNNING' : '○ IDLE'}
        </span>
      </div>

      {/* Stats */}
      {last ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
          {[
            { k: 'LAST RUN',  v: timeAgo(last.finishedAt || last.startedAt) },
            { k: 'DURATION',  v: last.duration != null ? `${last.duration}s` : '—' },
            { k: 'SIGNALS',   v: last.signalCount ?? '—' },
            { k: 'CONCEPTS',  v: last.conceptCount ?? '—' },
          ].map(({ k, v }) => (
            <div key={k}>
              <div style={{ fontSize: '8px', color: C.muted, letterSpacing: '0.1em' }}>{k}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '2px', color: C.text }}>{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: C.muted, fontSize: '10px', marginBottom: '16px', fontStyle: 'italic' }}>No runs recorded yet</div>
      )}

      {/* Trigger */}
      <button
        onClick={() => onTrigger(fluxKey)}
        disabled={isRunning || triggering === fluxKey}
        style={{
          width: '100%', padding: '8px',
          background: 'transparent',
          border: `1px solid ${color}55`,
          borderRadius: '4px',
          color: (isRunning || triggering === fluxKey) ? C.muted : color,
          fontSize: '9px', letterSpacing: '0.15em',
          cursor: (isRunning || triggering === fluxKey) ? 'not-allowed' : 'pointer',
          fontFamily: 'Space Mono, monospace',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { if (!isRunning) e.currentTarget.style.background = `${color}11`; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {triggering === fluxKey ? '…' : '▶  TRIGGER CYCLE'}
      </button>
    </div>
  );
}

function LogLine({ line, fresh }) {
  const ts   = line.slice(0, 8);
  const rest = line.slice(9);
  const isErr = rest.toLowerCase().includes('error');
  const isNew = rest.toLowerCase().includes('concept') || rest.toLowerCase().includes('trigger');
  return (
    <div style={{
      padding: '3px 16px',
      color: isErr ? C.rose : fresh ? C.text : C.muted,
      animation: fresh ? 'slide-down 0.25s ease' : 'none',
      fontSize: '11px',
    }}>
      <span style={{ color: C.muted, userSelect: 'none' }}>{ts} </span>
      <span style={{ color: isErr ? C.rose : isNew ? C.green : undefined }}>{rest}</span>
    </div>
  );
}

export default function Monitor() {
  const { data: cycleData, refetch: refetchCycles } = useApi('/api/cycles');
  const { data: stats }   = useApi('/api/analytics/stats');
  const { data: pending } = useApi('/api/pending');

  const [running, setRunning]     = useState([]);
  const [log, setLog]             = useState([]);
  const [triggering, setTriggering] = useState(null);

  const addLog = useCallback((text) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLog(prev => [`${ts} ${text}`, ...prev].slice(0, 60));
  }, []);

  useWsMessages((msg) => {
    if (msg.type === 'init') {
      setRunning(msg.data.running || []);
      refetchCycles();
    }
    if (msg.type === 'cycle_start') {
      setRunning(prev => [...new Set([...prev, msg.data.type])]);
      addLog(`[${msg.data.type}] Cycle started`);
    }
    if (msg.type === 'cycle_update') {
      setRunning(prev => prev.filter(t => t !== msg.data.entry.type));
      refetchCycles();
      const e = msg.data.entry;
      addLog(`[${e.type}] Done — ${e.signalCount} signals, ${e.conceptCount} concepts in ${e.duration}s`);
    }
    if (msg.type === 'new_concept') {
      addLog(`[concept] $${msg.data.ticker}  "${msg.data.name}"  (Flux ${msg.data.flux})`);
    }
    if (msg.type === 'launches_update') {
      addLog(`[launch] Queue updated — ${msg.data.length} pending`);
    }
  });

  async function handleTrigger(flux) {
    setTriggering(flux);
    try {
      const r = await apiPost(`/api/cycles/trigger/${flux}`);
      if (r.error) addLog(`[error] ${r.error}`);
      else addLog(`[trigger] ${flux} cycle triggered manually`);
    } catch {
      addLog(`[error] Could not reach server`);
    } finally {
      setTimeout(() => setTriggering(null), 1500);
    }
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1200px' }}>

      {/* Page header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{
          fontFamily: 'Syne, sans-serif', fontSize: '28px', fontWeight: 800,
          margin: 0, color: C.green, letterSpacing: '0.04em',
        }}>
          SYSTEM MONITOR
        </h1>
        <p style={{ margin: '4px 0 0', color: C.muted, fontSize: '10px', letterSpacing: '0.06em' }}>
          Real-time intelligence pipeline status
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '28px' }}>
        <StatBox label="CONCEPTS TODAY"   value={stats?.todayConcepts} accent={C.green} />
        <StatBox label="SIGNALS TODAY"    value={stats?.todaySignals}  accent={C.cyan} />
        <StatBox label="PENDING LAUNCHES" value={pending?.length ?? 0} accent={C.amber} />
        <StatBox label="TOTAL MIGRATIONS" value={stats?.migrations}    accent={C.violet} />
      </div>

      {/* Cycle cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>
        {Object.keys(FLUX).map(flux => (
          <CycleCard
            key={flux}
            fluxKey={flux}
            cycleData={cycleData}
            running={running}
            onTrigger={handleTrigger}
            triggering={triggering}
          />
        ))}
      </div>

      {/* Live log */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: C.green, display: 'inline-block',
            animation: 'blink-slow 2.5s infinite',
          }} />
          <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: C.muted }}>LIVE SYSTEM LOG</span>
          <span style={{ marginLeft: 'auto', fontSize: '9px', color: C.muted }}>{log.length} events</span>
        </div>
        <div style={{
          padding: '10px 0',
          maxHeight: '300px',
          overflowY: 'auto',
          fontFamily: 'Space Mono, monospace',
        }}>
          {log.length === 0 ? (
            <div style={{ padding: '8px 16px', color: C.muted, fontSize: '11px', fontStyle: 'italic' }}>
              Waiting for events…
            </div>
          ) : (
            log.map((line, i) => <LogLine key={i} line={line} fresh={i === 0} />)
          )}
        </div>
      </div>

    </div>
  );
}
