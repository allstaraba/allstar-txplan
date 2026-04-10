import React, { useState, useEffect } from 'react';
import { getPromptHistory, restorePrompt } from '../api.js';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function VersionHistory() {
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadVersions = () => {
    setLoading(true);
    getPromptHistory()
      .then(data => {
        setVersions(data);
        if (data.length > 0 && !selected) setSelected(data[0]);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadVersions(); }, []);

  const handleRestore = async () => {
    if (!selected) return;
    setRestoring(true);
    setError('');
    setSuccess('');
    try {
      await restorePrompt(selected.id);
      setSuccess(`Version "${selected.label}" is now active.`);
      setTimeout(() => setSuccess(''), 3000);
      loadVersions();
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div style={{ padding: '32px', height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>
        Version History
      </h1>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
        View and restore previous system prompt versions.
      </p>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#dc2626', fontSize: '14px' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#16a34a', fontSize: '14px', fontWeight: '600' }}>
          ✓ {success}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', fontSize: '14px' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', gap: '24px', flex: 1, overflow: 'hidden' }}>
          {/* Left: version list */}
          <div style={{ width: '30%', overflowY: 'auto', borderRight: '1px solid #e2e8f0', paddingRight: '24px' }}>
            {versions.map(v => (
              <div
                key={v.id}
                onClick={() => setSelected(v)}
                style={{
                  padding: '14px 16px',
                  borderRadius: '10px',
                  marginBottom: '8px',
                  cursor: 'pointer',
                  background: selected?.id === v.id ? '#eff6ff' : '#f8fafc',
                  border: `1.5px solid ${selected?.id === v.id ? '#bfdbfe' : '#e2e8f0'}`,
                  transition: 'all 0.1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{v.label}</span>
                  {v.is_active === 1 && (
                    <span style={{
                      padding: '2px 8px',
                      background: '#dcfce7',
                      color: '#16a34a',
                      fontSize: '11px',
                      fontWeight: '700',
                      borderRadius: '20px',
                      border: '1px solid #86efac',
                    }}>
                      ACTIVE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{formatDate(v.created_at)}</div>
              </div>
            ))}
          </div>

          {/* Right: preview */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selected ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#0f172a' }}>{selected.label}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{formatDate(selected.created_at)}</div>
                  </div>
                  {selected.is_active !== 1 && (
                    <button
                      onClick={handleRestore}
                      disabled={restoring}
                      style={{
                        padding: '8px 20px',
                        background: restoring ? '#93c5fd' : '#2563eb',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: restoring ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {restoring ? 'Restoring...' : 'Restore This Version'}
                    </button>
                  )}
                </div>
                <textarea
                  readOnly
                  value={selected.text}
                  style={{
                    flex: 1,
                    padding: '16px',
                    border: '1.5px solid #e2e8f0',
                    borderRadius: '10px',
                    fontSize: '12.5px',
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    color: '#374151',
                    resize: 'none',
                    outline: 'none',
                    background: '#f8fafc',
                    lineHeight: '1.6',
                  }}
                />
              </>
            ) : (
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>Select a version to preview</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
