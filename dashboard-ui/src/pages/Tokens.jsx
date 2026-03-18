import { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi.js';

const C = {
  card: '#0e0e24', border: '#1a1a38', borderHi: '#2c2c52',
  green: '#00ff88', amber: '#f59e0b', cyan: '#22d3ee',
  violet: '#a855f7', rose: '#f43f5e', text: '#dde4f5',
  muted: '#52576e', mutedHi: '#7c829e',
};

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const COLS = [
  { key: 'name',       label: 'TOKEN',      sortable: true },
  { key: 'theme',      label: 'THEME',      sortable: true },
  { key: 'format',     label: 'FORMAT',     sortable: true },
  { key: 'volume_sol', label: 'VOLUME SOL', sortable: true },
  { key: 'trade_count',label: 'TRADES',     sortable: true },
  { key: 'migrated',   label: 'MIGRATED',   sortable: true },
  { key: 'created_at', label: 'CREATED',    sortable: true },
];

export default function Tokens() {
  const { data, loading } = useApi('/api/tokens?limit=200');
  const [sort, setSort]   = useState({ key: 'created_at', dir: 'desc' });
  const [search, setSearch] = useState('');
  const [filterMig, setFilterMig] = useState('all');

  const tokens = useMemo(() => {
    if (!data) return [];
    let list = [...data];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.name?.toLowerCase().includes(q) ||
        t.ticker?.toLowerCase().includes(q) ||
        t.theme?.toLowerCase().includes(q) ||
        t.format?.toLowerCase().includes(q)
      );
    }

    if (filterMig === 'migrated') list = list.filter(t => t.migrated);
    if (filterMig === 'live')     list = list.filter(t => !t.migrated);

    list.sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      if (typeof av === 'number' || typeof bv === 'number') {
        return sort.dir === 'asc' ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0);
      }
      return sort.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });

    return list;
  }, [data, sort, search, filterMig]);

  function toggleSort(key) {
    setSort(prev =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
    );
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1400px' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{
          fontFamily: 'Syne, sans-serif', fontSize: '28px', fontWeight: 800,
          margin: 0, color: C.text, letterSpacing: '0.04em',
        }}>
          PUMP.FUN TOKENS
        </h1>
        <p style={{ margin: '4px 0 0', color: C.muted, fontSize: '10px', letterSpacing: '0.06em' }}>
          All tokens observed on pump.fun via WebSocket
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search name, ticker, theme…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: '4px',
            color: C.text, fontFamily: 'Space Mono, monospace', fontSize: '11px',
            padding: '8px 12px', outline: 'none', width: '260px',
          }}
          onFocus={e => { e.target.style.borderColor = C.green; }}
          onBlur={e =>  { e.target.style.borderColor = C.border; }}
        />

        {['all', 'migrated', 'live'].map(f => (
          <button
            key={f}
            onClick={() => setFilterMig(f)}
            style={{
              padding: '7px 14px',
              background: filterMig === f ? `${C.cyan}18` : 'transparent',
              border: `1px solid ${filterMig === f ? C.cyan : C.border}`,
              borderRadius: '4px',
              color: filterMig === f ? C.cyan : C.muted,
              fontSize: '9px', letterSpacing: '0.12em',
              cursor: 'pointer', fontFamily: 'Space Mono, monospace',
            }}
          >
            {f.toUpperCase()}
          </button>
        ))}

        <span style={{ marginLeft: 'auto', fontSize: '10px', color: C.muted }}>
          {tokens.length} tokens
          {loading && <span style={{ marginLeft: '8px', color: C.amber }}>loading…</span>}
        </span>
      </div>

      {/* Table */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: '8px', overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Space Mono, monospace' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && toggleSort(col.key)}
                    style={{
                      padding: '11px 14px', textAlign: 'left',
                      fontSize: '8px', color: sort.key === col.key ? C.cyan : C.muted,
                      letterSpacing: '0.12em', fontWeight: 700,
                      cursor: col.sortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.label}
                    {sort.key === col.key && (
                      <span style={{ marginLeft: '4px', opacity: 0.7 }}>
                        {sort.dir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: C.muted, fontSize: '11px', fontStyle: 'italic' }}>
                    No tokens found
                  </td>
                </tr>
              )}
              {tokens.map((t, i) => (
                <tr
                  key={t.id}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${C.cyan}08`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'; }}
                >
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>{t.name}</span>
                    <span style={{ fontSize: '10px', color: C.green, marginLeft: '6px' }}>${t.ticker}</span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '10px', color: C.mutedHi }}>
                    {t.theme || <span style={{ color: C.muted }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '10px', color: C.mutedHi }}>
                    {t.format || <span style={{ color: C.muted }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: C.amber, fontWeight: 700 }}>
                    {t.volume_sol > 0 ? `${fmt(t.volume_sol)} ◎` : <span style={{ color: C.muted }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: C.text }}>
                    {t.trade_count > 0 ? t.trade_count : <span style={{ color: C.muted }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {t.migrated ? (
                      <span style={{
                        fontSize: '8px', padding: '2px 8px', borderRadius: '99px',
                        background: `${C.violet}20`, color: C.violet, letterSpacing: '0.1em',
                      }}>
                        ✓ MIGRATED
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '8px', padding: '2px 8px', borderRadius: '99px',
                        background: `${C.green}15`, color: C.green, letterSpacing: '0.1em',
                      }}>
                        ● LIVE
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '10px', color: C.muted, whiteSpace: 'nowrap' }}>
                    {fmtDate(t.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
