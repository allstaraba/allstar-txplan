import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClients, deleteClient, updateClientStatus, duplicatePlan, getPlan } from '../api.js';

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status, onClick }) {
  const style =
    status === 'Finalized'
      ? { background: '#dcfce7', color: '#166534' }
      : { background: '#fef3c7', color: '#92400e' };
  return (
    <span
      onClick={onClick}
      title="Click to toggle status"
      style={{
        ...style,
        padding: '3px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'inline-block',
        whiteSpace: 'nowrap',
      }}
    >
      {status || 'Draft'}
    </span>
  );
}

export default function ClientRecords() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [bcbaFilter, setBcbaFilter] = useState('All');
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    getClients()
      .then(data => { setClients(data); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const bcbaOptions = ['All', ...Array.from(new Set(clients.map(c => c.bcba).filter(Boolean)))];

  const filtered = clients.filter(c => {
    const matchSearch = (c.client_name || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'All' || (c.status || 'Draft') === statusFilter;
    const matchBcba = bcbaFilter === 'All' || c.bcba === bcbaFilter;
    return matchSearch && matchStatus && matchBcba;
  });

  const handleToggleStatus = async (client) => {
    const next = (client.status || 'Draft') === 'Draft' ? 'Finalized' : 'Draft';
    await updateClientStatus(client.id, next);
    setClients(prev => prev.map(c => c.id === client.id ? { ...c, status: next } : c));
  };

  const handleDelete = async (client) => {
    if (!window.confirm(`Delete "${client.client_name}"? This cannot be undone.`)) return;
    await deleteClient(client.id);
    load();
  };

  const handleDuplicate = async (client) => {
    await duplicatePlan(client.id);
    load();
  };

  const handleDownload = async (client) => {
    try {
      const plan = await getPlan(client.id);
      const revisions = plan.revisions || [];
      if (!revisions.length) { alert('No revisions to download.'); return; }
      const latestRev = revisions[revisions.length - 1];
      const token = localStorage.getItem('allstar_token');
      const res = await fetch(`/api/export/${client.id}/${latestRev.revision_number}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert('Download failed.'); return; }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const safeName = (client.client_name || 'treatment-plan')
        .replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'treatment-plan';
      link.download = `treatment-plan-${safeName}-rev${latestRev.revision_number}.docx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      alert('Download error: ' + err.message);
    }
  };

  const selectStyle = {
    padding: '7px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#374151',
    background: '#fff',
    cursor: 'pointer',
  };

  const btnStyle = (variant = 'default') => ({
    padding: '5px 12px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    ...(variant === 'primary' ? { background: '#2563eb', color: '#fff' } :
        variant === 'danger' ? { background: '#fee2e2', color: '#dc2626' } :
        { background: '#f1f5f9', color: '#374151' }),
  });

  return (
    <div style={{ padding: '28px 32px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>
          Client Records
        </h1>
        <span style={{
          background: '#e0e7ff',
          color: '#3730a3',
          borderRadius: '12px',
          padding: '2px 10px',
          fontSize: '13px',
          fontWeight: '600',
        }}>
          {filtered.length} client{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by client name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            ...selectStyle,
            flex: '1',
            minWidth: '200px',
            maxWidth: '320px',
            outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = '#2563eb'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="All">All Statuses</option>
          <option value="Draft">Draft</option>
          <option value="Finalized">Finalized</option>
        </select>
        <select value={bcbaFilter} onChange={e => setBcbaFilter(e.target.value)} style={selectStyle}>
          {bcbaOptions.map(b => <option key={b} value={b}>{b === 'All' ? 'All BCBAs' : b}</option>)}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', marginBottom: '16px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['Client Name', 'BCBA', 'Date Created', 'Last Modified', 'Revisions', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                  {clients.length === 0 ? 'No clients yet. Generate a plan to get started.' : 'No clients match your filters.'}
                </td>
              </tr>
            ) : (
              filtered.map((client, i) => (
                <tr
                  key={client.id}
                  style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <td style={{ padding: '11px 14px' }}>
                    <span
                      onClick={() => navigate(`/clients/${client.id}`)}
                      style={{ color: '#2563eb', fontWeight: '500', cursor: 'pointer', textDecoration: 'none' }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                    >
                      {client.client_name || '(Unnamed)'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', color: '#374151' }}>{client.bcba || '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#64748b' }}>{formatDate(client.created_at)}</td>
                  <td style={{ padding: '11px 14px', color: '#64748b' }}>{formatDate(client.last_modified)}</td>
                  <td style={{ padding: '11px 14px', color: '#64748b', textAlign: 'center' }}>{client.revision_count}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <StatusBadge status={client.status || 'Draft'} onClick={() => handleToggleStatus(client)} />
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button style={btnStyle('primary')} onClick={() => navigate(`/clients/${client.id}`)}>Open</button>
                      <button style={btnStyle()} onClick={() => handleDownload(client)}>Download</button>
                      <button style={btnStyle()} onClick={() => handleDuplicate(client)}>Duplicate</button>
                      <button style={btnStyle('danger')} onClick={() => handleDelete(client)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
