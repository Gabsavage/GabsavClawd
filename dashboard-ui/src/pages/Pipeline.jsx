import { useState, useCallback } from 'react';
import { useApi, apiPatch } from '../hooks/useApi.js';
import { useWsMessages } from '../hooks/useWs.js';

const C = {
  card: '#0e0e24', border: '#1a1a38', borderHi: '#2c2c52',
  green: '#00ff88', amber: '#f59e0b', cyan: '#22d3ee',
  violet: '#a855f7', rose: '#f43f5e', text: '#dde4f5',
  muted: '#52576e', mutedHi: '#7c829e',
};

const FLUX_COLORS  = { '1': C.cyan, '2': C.amber, '3': C.violet };
const FLUX_LABELS  = { '1': 'FLUX 1', '2': 'FLUX 2', '3': 'FLUX 3' };
const STATUS_COLORS = {
  pending:  C.amber,
  approved: C.green,
  hot:      C.rose,
  rejected: C.muted,
};

const FILTERS = [
  { key: 'all',      label: 'ALL' },
  { key: 'pending',  label: 'PENDING' },
  { key: 'approved', label: 'APPROVED' },
  { key: 'hot',      label: 'HOT' },
  { key: 'rejected', label: 'REJECTED' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function Badge({ color, children }) {
  return (
    <span style={{
      fontSize: '8px', padding: '2px 7px', borderRadius: '3px',
      background: `${color}20`, color, letterSpacing: '0.1em', fontWeight: 700,
    }}>
      {children}
    </span>
  );
}

function ConceptCard({ concept, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const fluxColor   = FLUX_COLORS[concept.flux]  || C.muted;
  const statusColor = STATUS_COLORS[concept.telegram_status] || C.muted;

  async function act(status) {
    setBusy(true);
    await apiPatch(`/api/concepts/${concept.id}/status`, { status });
    onUpdate(concept.id, status);
    setBusy(false);
  }

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${fluxColor}`,
      borderRadius: '0 8px 8px 0',
      padding: '16px',
      animation: 'slide-down 0.2s ease',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <Badge color={fluxColor}>{FLUX_LABELS[concept.flux]}</Badge>
          <Badge color={statusColor}>{concept.telegram_status?.toUpperCase()}</Badge>
        </div>
        <span style={{ fontSize: '9px', color: C.muted }}>{timeAgo(concept.created_at)}</span>
      </div>

      {/* Token name */}
      <div style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '15px', fontWeight: 700, color: C.text }}>{concept.name}</span>
        <span style={{ fontSize: '11px', color: C.green, marginLeft: '8px' }}>${concept.ticker}</span>
      </div>

      {/* Description */}
      <p style={{ margin: '0 0 8px', fontSize: '11px', color: C.mutedHi, lineHeight: '1.6' }}>
        {truncate(concept.description, 160)}
      </p>

      {/* Narrative */}
      {concept.narrative && (
        <p style={{ margin: '0 0 10px', fontSize: '10px', color: C.muted, fontStyle: 'italic', lineHeight: '1.5' }}>
          "{truncate(concept.narrative, 120)}"
        </p>
      )}

      {/* Signal source */}
      {(concept.source_signal || concept.signal_strength) && (
        <div style={{
          marginBottom: '12px', fontSize: '10px', color: C.muted,
          borderLeft: `2px solid ${C.border}`, paddingLeft: '8px',
        }}>
          {concept.source_signal && <span>{truncate(concept.source_signal, 90)}</span>}
          {concept.signal_strength && (
            <span style={{ color: C.amber, marginLeft: '6px', fontWeight: 700 }}>
              [{concept.signal_strength}/10]
            </span>
          )}
          {concept.spread && (
            <span style={{ color: C.muted, marginLeft: '6px' }}>· {concept.spread}</span>
          )}
        </div>
      )}

      {/* Actions — only for pending */}
      {concept.telegram_status === 'pending' && (
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { s: 'approved', label: '✓ APPROVE', c: C.green },
            { s: 'hot',      label: '🔥 HOT',    c: C.rose },
            { s: 'rejected', label: '✗ SKIP',    c: C.muted },
          ].map(({ s, label, c }) => (
            <button
              key={s}
              disabled={busy}
              onClick={() => act(s)}
              style={{
                flex: 1, padding: '6px 4px',
                background: 'transparent',
                border: `1px solid ${c}55`,
                borderRadius: '4px',
                color: busy ? C.muted : c,
                fontSize: '9px', letterSpacing: '0.1em',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'Space Mono, monospace',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!busy) e.currentTarget.style.background = `${c}11`; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Pipeline() {
  const [filter, setFilter] = useState('pending');
  const { data: raw, refetch } = useApi(`/api/concepts?status=${filter}&limit=100`);
  const [concepts, setConcepts] = useState(null);

  // Sync raw → local state so we can mutate optimistically
  if (raw && raw !== concepts && !Array.isArray(concepts)) {
    setConcepts(raw);
  }
  const list = concepts || raw || [];

  useWsMessages((msg) => {
    if (msg.type === 'new_concept' && (filter === 'all' || filter === 'pending')) {
      refetch();
    }
    if (msg.type === 'status_change') {
      setConcepts(prev =>
        prev ? prev.map(c => c.id === msg.data.id ? { ...c, telegram_status: msg.data.status } : c) : prev
      );
    }
  });

  const handleUpdate = useCallback((id, status) => {
    setConcepts(prev =>
      prev ? prev.map(c => c.id === id ? { ...c, telegram_status: status } : c) : prev
    );
  }, []);

  // Reset local concepts when filter changes
  const changeFilter = (f) => {
    setFilter(f);
    setConcepts(null);
  };

  const pending  = list.filter(c => c.telegram_status === 'pending').length;
  const approved = list.filter(c => c.telegram_status === 'approved').length;
  const hot      = list.filter(c => c.telegram_status === 'hot').length;
  const rejected = list.filter(c => c.telegram_status === 'rejected').length;

  const counts = { all: list.length, pending, approved, hot, rejected };

  return (
    <div style={{ padding: '32px', maxWidth: '1200px' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{
          fontFamily: 'Syne, sans-serif', fontSize: '28px', fontWeight: 800,
          margin: 0, color: C.text, letterSpacing: '0.04em',
        }}>
          CONCEPT PIPELINE
        </h1>
        <p style={{ margin: '4px 0 0', color: C.muted, fontSize: '10px', letterSpacing: '0.06em' }}>
          AI-generated token concepts — review and curate
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key;
          const color  = active
            ? (key === 'pending' ? C.amber : key === 'approved' ? C.green : key === 'hot' ? C.rose : C.text)
            : C.muted;
          return (
            <button
              key={key}
              onClick={() => changeFilter(key)}
              style={{
                padding: '6px 14px',
                background: active ? `${color}15` : 'transparent',
                border: `1px solid ${active ? color : C.border}`,
                borderRadius: '4px',
                color,
                fontSize: '9px', letterSpacing: '0.12em',
                cursor: 'pointer',
                fontFamily: 'Space Mono, monospace',
                transition: 'all 0.15s',
              }}
            >
              {label}
              {counts[key] > 0 && (
                <span style={{
                  marginLeft: '6px', fontSize: '8px',
                  background: `${color}25`, padding: '1px 5px', borderRadius: '99px',
                }}>
                  {counts[key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {list.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 0',
          color: C.muted, fontSize: '11px', fontStyle: 'italic',
        }}>
          No concepts found for this filter.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
          {list.map(c => (
            <ConceptCard key={c.id} concept={c} onUpdate={handleUpdate} />
          ))}
        </div>
      )}

    </div>
  );
}
