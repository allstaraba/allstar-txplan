import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPlans, duplicatePlan } from '../api.js';

const s = {
  page: { padding: '32px', maxWidth: '1100px', margin: '0 auto' },
  header: { marginBottom: '24px' },
  title: { fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' },
  subtitle: { fontSize: '14px', color: '#64748b' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' },
  searchInput: {
    flex: 1,
    maxWidth: '360px',
    padding: '9px 14px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    background: '#fff',
    color: '#0f172a',
  },
  count: { fontSize: '13px', color: '#94a3b8', marginLeft: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
  },
  tr: { borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.1s' },
  td: { padding: '13px 16px', fontSize: '14px', color: '#1e293b' },
  tdMuted: { padding: '13px 16px', fontSize: '13px', color: '#64748b' },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#eff6ff',
    color: '#2563eb',
  },
  actions: { display: 'flex', gap: '8px', alignItems: 'center' },
  openBtn: {
    padding: '5px 12px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  dupBtn: {
    padding: '5px 12px',
    background: '#f1f5f9',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  empty: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#94a3b8',
    fontSize: '15px',
  },
  loading: { textAlign: 'center', padding: '60px', color: '#94a3b8' },
  toast: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    background: '#0f172a',
    color: '#fff',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    zIndex: 9999,
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PlanHistory({ setCurrentPlan }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [dupLoading, setDupLoading] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    try {
      const data = await getPlans();
      setPlans(data);
    } catch (e) {
      showToast('Failed to load plans: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  function handleOpen(plan) {
    // Load plan into review/revise view
    setCurrentPlan({ plan_id: plan.id, client_name: plan.client_name });
    navigate('/review');
  }

  async function handleDuplicate(e, plan) {
    e.stopPropagation();
    setDupLoading(plan.id);
    try {
      const result = await duplicatePlan(plan.id);
      showToast(`Duplicated as "${result.client_name}"`);
      await loadPlans();
    } catch (err) {
      showToast('Duplicate failed: ' + err.message);
    } finally {
      setDupLoading(null);
    }
  }

  const filtered = plans.filter(p =>
    p.client_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.bcba?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div style={s.loading}>Loading plans...</div>;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Plan History</h1>
        <p style={s.subtitle}>All previously generated treatment plans</p>
      </div>

      <div style={s.toolbar}>
        <input
          style={s.searchInput}
          placeholder="Search by client name or BCBA..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={s.count}>{filtered.length} plan{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <div style={s.empty}>
          {search ? 'No plans match your search.' : 'No plans generated yet. Go to Generate Plan to create one.'}
        </div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Client Name</th>
              <th style={s.th}>BCBA</th>
              <th style={s.th}>Date Generated</th>
              <th style={s.th}>Revisions</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(plan => (
              <tr
                key={plan.id}
                style={s.tr}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <td style={{ ...s.td, fontWeight: '600' }}>{plan.client_name || 'Unknown'}</td>
                <td style={s.tdMuted}>{plan.bcba || '—'}</td>
                <td style={s.tdMuted}>{formatDate(plan.created_at)}</td>
                <td style={s.td}>
                  <span style={s.badge}>{plan.revision_count} rev{plan.revision_count !== 1 ? 's' : ''}</span>
                </td>
                <td style={s.td}>
                  <div style={s.actions}>
                    <button style={s.openBtn} onClick={() => handleOpen(plan)}>
                      Open
                    </button>
                    <button
                      style={s.dupBtn}
                      onClick={e => handleDuplicate(e, plan)}
                      disabled={dupLoading === plan.id}
                    >
                      {dupLoading === plan.id ? '...' : 'Duplicate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}
