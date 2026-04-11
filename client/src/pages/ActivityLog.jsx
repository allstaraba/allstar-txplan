import React, { useState, useEffect } from 'react';

const ACTION_LABELS = {
  generated_plan:   'Generated plan',
  revised_plan:     'Revised plan',
  regenerated_plan: 'Regenerated plan',
  exported_plan:    'Exported plan',
  duplicated_plan:  'Duplicated plan',
  deleted_plan:     'Deleted plan',
  edited_prompt:    'Edited prompt',
  restored_prompt:  'Restored prompt',
  created_user:     'Created user',
  deleted_user:     'Deleted user',
  uploaded_logo:    'Uploaded logo',
  deleted_logo:     'Deleted logo',
};

const ACTION_COLORS = {
  generated_plan:   '#16a34a',
  revised_plan:     '#2563eb',
  regenerated_plan: '#7c3aed',
  exported_plan:    '#0891b2',
  duplicated_plan:  '#0891b2',
  deleted_plan:     '#dc2626',
  edited_prompt:    '#d97706',
  restored_prompt:  '#d97706',
  created_user:     '#16a34a',
  deleted_user:     '#dc2626',
  uploaded_logo:    '#0891b2',
  deleted_logo:     '#dc2626',
};

function formatDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt + (dt.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export default function ActivityLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('allstar_token');
    fetch('/api/activity-log', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) return r.json().then(j => { throw new Error(j.error || 'Failed to load'); });
        return r.json();
      })
      .then(data => setEntries(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '32px', maxWidth: '1100px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>
        Activity Log
      </h1>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '28px' }}>
        Last 200 actions across the app. Most recent first.
      </p>

      {loading && <div style={{ color: '#64748b', fontSize: '14px' }}>Loading...</div>}
      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
          padding: '10px 14px', color: '#dc2626', fontSize: '14px',
        }}>
          {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div style={{ color: '#64748b', fontSize: '14px' }}>No activity recorded yet.</div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                <th style={th}>Date / Time</th>
                <th style={th}>User</th>
                <th style={th}>Action</th>
                <th style={{ ...th, textAlign: 'left' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={e.id}
                  style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #e2e8f0' }}
                >
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748b' }}>{formatDate(e.created_at)}</td>
                  <td style={{ ...td, fontWeight: '600', color: '#0f172a' }}>{e.username || '—'}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 10px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '600',
                      background: (ACTION_COLORS[e.action] || '#64748b') + '18',
                      color: ACTION_COLORS[e.action] || '#64748b',
                      whiteSpace: 'nowrap',
                    }}>
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#374151', maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.details || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: '700',
  color: '#374151',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const td = {
  padding: '10px 14px',
  verticalAlign: 'middle',
};
