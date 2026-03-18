import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useApi } from '../hooks/useApi.js';

const C = {
  card: '#0e0e24', border: '#1a1a38', borderHi: '#2c2c52',
  green: '#00ff88', amber: '#f59e0b', cyan: '#22d3ee',
  violet: '#a855f7', rose: '#f43f5e', text: '#dde4f5',
  muted: '#52576e', mutedHi: '#7c829e',
};

const TOOLTIP_STYLE = {
  background: '#0e0e24',
  border: `1px solid ${C.borderHi}`,
  borderRadius: '6px',
  fontFamily: 'Space Mono, monospace',
  fontSize: '11px',
  padding: '8px 12px',
};

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${accent}`, borderRadius: '8px', padding: '18px 20px',
    }}>
      <div style={{ fontSize: '9px', color: C.muted, letterSpacing: '0.12em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '30px', fontWeight: 700, color: C.text }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '9px', color: C.muted, marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function ChartPanel({ title, data, dataKey, color, labelKey = 'theme' }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: '8px', padding: '20px',
    }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: C.muted, letterSpacing: '0.12em', marginBottom: '20px' }}>
        {title}
      </div>
      {!data || data.length === 0 ? (
        <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: C.muted, fontSize: '11px', fontStyle: 'italic' }}>No data yet</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 0, right: 4, left: -20, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis
              dataKey={labelKey}
              tick={{ fill: C.muted, fontSize: 9, fontFamily: 'Space Mono, monospace' }}
              axisLine={{ stroke: C.border }}
              tickLine={false}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              tick={{ fill: C.muted, fontSize: 9, fontFamily: 'Space Mono, monospace' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color }}
              itemStyle={{ color: C.text }}
              cursor={{ fill: `${color}0d` }}
            />
            <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function MigrationRow({ token, index }) {
  function fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return (
    <tr style={{ borderBottom: `1px solid ${C.border}`, animation: 'none' }}>
      <td style={{ padding: '10px 12px', color: C.muted, fontSize: '10px', width: '32px' }}>
        {index + 1}
      </td>
      <td style={{ padding: '10px 12px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>{token.name}</span>
        <span style={{ fontSize: '10px', color: C.green, marginLeft: '6px' }}>${token.ticker}</span>
      </td>
      <td style={{ padding: '10px 12px', fontSize: '10px', color: C.muted }}>
        {token.theme || '—'}
      </td>
      <td style={{ padding: '10px 12px', fontSize: '11px', color: C.amber, fontWeight: 700 }}>
        {token.volume_sol != null ? `${Number(token.volume_sol).toFixed(2)} SOL` : '—'}
      </td>
      <td style={{ padding: '10px 12px', fontSize: '10px', color: C.muted }}>
        {fmt(token.migrated_at)}
      </td>
    </tr>
  );
}

export default function Analytics() {
  const { data: stats }      = useApi('/api/analytics/stats');
  const { data: themes }     = useApi('/api/analytics/themes');
  const { data: formats }    = useApi('/api/analytics/formats');
  const { data: migrations } = useApi('/api/analytics/migrations?hours=168');

  return (
    <div style={{ padding: '32px', maxWidth: '1200px' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{
          fontFamily: 'Syne, sans-serif', fontSize: '28px', fontWeight: 800,
          margin: 0, color: C.text, letterSpacing: '0.04em',
        }}>
          ANALYTICS
        </h1>
        <p style={{ margin: '4px 0 0', color: C.muted, fontSize: '10px', letterSpacing: '0.06em' }}>
          Performance insights across signals, concepts and on-chain activity
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '28px' }}>
        <StatCard label="TOTAL CONCEPTS"  value={stats?.totalConcepts} accent={C.cyan}   sub={`${stats?.todayConcepts ?? 0} today`} />
        <StatCard label="APPROVAL RATE"   value={stats ? `${stats.approvalRate}%` : null} accent={C.green}  sub={`${stats?.approved ?? 0} approved · ${stats?.hot ?? 0} hot`} />
        <StatCard label="TOTAL SIGNALS"   value={stats?.totalSignals}  accent={C.amber}  sub={`${stats?.todaySignals ?? 0} today`} />
        <StatCard label="MIGRATIONS"      value={stats?.migrations}    accent={C.violet} sub="tokens hit 69 SOL" />
      </div>

      {/* Secondary stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '28px' }}>
        <StatCard label="PENDING REVIEW"  value={stats?.pending}   accent={C.amber} />
        <StatCard label="REJECTED"        value={stats?.rejected}  accent={C.muted} />
        <StatCard label="HOT ANGLES"      value={stats?.hot}       accent={C.rose} />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '28px' }}>
        <ChartPanel
          title="TOP THEMES BY VOLUME (SOL)"
          data={themes}
          dataKey="total_volume"
          color={C.green}
          labelKey="theme"
        />
        <ChartPanel
          title="TOP FORMATS BY VOLUME (SOL)"
          data={formats}
          dataKey="total_volume"
          color={C.cyan}
          labelKey="format"
        />
      </div>

      {/* Migrations table */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: C.muted, letterSpacing: '0.12em' }}>
            RECENT MIGRATIONS — LAST 7 DAYS
          </span>
          <span style={{ fontSize: '9px', color: C.violet }}>
            {migrations?.length ?? 0} tokens reached 69 SOL
          </span>
        </div>

        {!migrations || migrations.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: C.muted, fontSize: '11px', fontStyle: 'italic' }}>
            No migrations in the last 7 days
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Space Mono, monospace' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['#', 'TOKEN', 'THEME', 'VOLUME', 'MIGRATED AT'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left',
                      fontSize: '8px', color: C.muted, letterSpacing: '0.12em', fontWeight: 700,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {migrations.map((t, i) => <MigrationRow key={t.id} token={t} index={i} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
