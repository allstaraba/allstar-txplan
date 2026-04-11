import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getClient,
  updateClientStatus,
  updateClientNotes,
  uploadClientDocument,
  deleteClientDocument,
  extractDocumentText,
  getAuthPeriods,
  createAuthPeriod,
  updateAuthPeriod,
} from '../api.js';
import ReviewRevise from './ReviewRevise.jsx';

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(fileType) {
  if (!fileType) return '📄';
  const t = fileType.toLowerCase();
  if (t === '.pdf' || t === 'application/pdf') return '📕';
  if (t === '.docx' || t === '.doc') return '📘';
  if (t === '.txt' || t === '.md') return '📝';
  return '📄';
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
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'inline-block',
      }}
    >
      {status || 'Draft'}
    </span>
  );
}

function PeriodStatusBadge({ status }) {
  const map = {
    active:    { bg: '#dcfce7', color: '#166534', label: 'Active' },
    completed: { bg: '#e0e7ff', color: '#3730a3', label: 'Completed' },
    pending:   { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 9px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.02em' }}>
      {s.label}
    </span>
  );
}

function periodLabel(p) {
  if (p.period_type === 'initial') return 'Initial Auth';
  return `Reauth ${p.period_number - 1}`;
}

export default function ClientProfile({ currentPlan, setCurrentPlan, injectedText, setInjectedText, onRegeneratingChange, onRegenChunk }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('plan');
  const [notes, setNotes] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [docError, setDocError] = useState('');
  const fileInputRef = useRef(null);
  const notesTimerRef = useRef(null);

  // Authorization periods
  const [authPeriods, setAuthPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null); // null = show all
  const [uploadPeriodId, setUploadPeriodId] = useState('');       // '' = untagged
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null); // { id, start_date, end_date, status }
  const [periodError, setPeriodError] = useState('');

  const loadClient = () => {
    getClient(id)
      .then(data => {
        setClient(data);
        setNotes(data.notes || '');
        setDocuments(data.documents || []);
        setError('');
        setCurrentPlan({ plan_id: parseInt(id), client_name: data.client_name });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadPeriods = () => {
    getAuthPeriods(id)
      .then(periods => {
        setAuthPeriods(periods);
        // Default upload period to the active one if any
        const active = periods.find(p => p.status === 'active');
        if (active && uploadPeriodId === '') setUploadPeriodId(String(active.id));
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadClient();
    loadPeriods();
    return () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleStatus = async () => {
    const next = (client.status || 'Draft') === 'Draft' ? 'Finalized' : 'Draft';
    await updateClientStatus(id, next);
    setClient(prev => ({ ...prev, status: next }));
  };

  const handleNotesSave = async () => {
    await updateClientNotes(id, notes);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  const handleFileDrop = async (files) => {
    setUploading(true);
    setDocError('');
    const periodId = uploadPeriodId ? Number(uploadPeriodId) : null;
    for (const file of Array.from(files)) {
      try {
        const doc = await uploadClientDocument(id, file, periodId);
        setDocuments(prev => [doc, ...prev]);
      } catch (err) {
        setDocError('Upload failed: ' + err.message);
      }
    }
    setUploading(false);
  };

  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    await deleteClientDocument(id, docId);
    setDocuments(prev => prev.filter(d => d.id !== docId));
  };

  const handleUseInPlan = async (doc) => {
    setDocError('');
    try {
      const result = await extractDocumentText(id, doc.id);
      const prefix = 'Please incorporate the following document into the treatment plan:\n\n';
      setInjectedText(prefix + result.text);
      setActiveTab('plan');
    } catch (err) {
      setDocError('Extract failed: ' + err.message);
    }
  };

  const handleDownloadDoc = (doc) => {
    const token = localStorage.getItem('allstar_token');
    fetch(`/api/clients/${id}/documents/${doc.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.blob())
      .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = doc.original_name;
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch(() => setDocError('Download failed.'));
  };

  const handleCreatePeriod = async () => {
    setPeriodError('');
    setCreatingPeriod(true);
    try {
      const period = await createAuthPeriod(id, {});
      setAuthPeriods(prev => [...prev, period]);
      if (period.status === 'active') setUploadPeriodId(String(period.id));
    } catch (err) {
      setPeriodError(err.message);
    } finally {
      setCreatingPeriod(false);
    }
  };

  const handlePeriodStatusToggle = async (period) => {
    const next = period.status === 'active' ? 'completed' : period.status === 'completed' ? 'pending' : 'active';
    try {
      const updated = await updateAuthPeriod(id, period.id, { status: next });
      setAuthPeriods(prev => prev.map(p => p.id === period.id ? updated : p));
    } catch (err) {
      setPeriodError(err.message);
    }
  };

  // Filter displayed documents based on selected period
  const visibleDocs = selectedPeriodId
    ? documents.filter(d => d.authorization_period_id === selectedPeriodId)
    : documents;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontFamily: 'system-ui, sans-serif' }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', color: '#dc2626', fontFamily: 'system-ui, sans-serif' }}>{error}</div>
    );
  }

  const tabBtnStyle = (tab) => ({
    padding: '9px 20px',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
    background: 'none',
    fontSize: '14px',
    fontWeight: '600',
    color: activeTab === tab ? '#2563eb' : '#64748b',
    cursor: 'pointer',
    transition: 'color 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Header bar */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('/clients')}
          style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '13px', fontWeight: '500', cursor: 'pointer', padding: '4px 0', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          ← Client Records
        </button>
        <div style={{ width: '1px', height: '20px', background: '#e2e8f0' }} />
        <h1 style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: '#0f172a', flex: 1 }}>
          {client?.client_name || '(Unnamed)'}
        </h1>
        <StatusBadge status={client?.status || 'Draft'} onClick={handleToggleStatus} />
      </div>

      {/* Notes bar */}
      <div style={{
        background: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        flexShrink: 0,
      }}>
        <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151', paddingTop: '7px', whiteSpace: 'nowrap' }}>
          BCBA Notes:
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={handleNotesSave}
          placeholder="Add notes about this client..."
          rows={2}
          style={{
            flex: 1,
            padding: '7px 11px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '13px',
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
            color: '#0f172a',
            lineHeight: '1.5',
            background: '#fff',
          }}
          onFocus={e => e.target.style.borderColor = '#2563eb'}
          onBlur2={e => e.target.style.borderColor = '#e2e8f0'}
        />
        {savedMsg && (
          <span style={{ fontSize: '12px', color: '#16a34a', paddingTop: '8px', whiteSpace: 'nowrap' }}>Saved ✓</span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', flexShrink: 0 }}>
        <button style={tabBtnStyle('plan')} onClick={() => setActiveTab('plan')}>Treatment Plan</button>
        <button style={tabBtnStyle('documents')} onClick={() => setActiveTab('documents')}>
          Documents {documents.length > 0 && `(${documents.length})`}
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'plan' ? (
          <ReviewRevise
            currentPlan={currentPlan}
            setCurrentPlan={setCurrentPlan}
            injectedText={injectedText}
            setInjectedText={setInjectedText}
            onRegeneratingChange={onRegeneratingChange}
            onRegenChunk={onRegenChunk}
          />
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

            {/* ── Authorization Periods ── */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Authorization Periods</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>Track authorization windows. Click a period to filter documents.</div>
                </div>
                <button
                  onClick={handleCreatePeriod}
                  disabled={creatingPeriod}
                  style={{
                    padding: '7px 16px',
                    background: creatingPeriod ? '#93c5fd' : '#2563eb',
                    border: 'none',
                    borderRadius: '7px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: creatingPeriod ? 'not-allowed' : 'pointer',
                  }}
                >
                  {authPeriods.length === 0
                    ? (creatingPeriod ? 'Creating…' : '+ Initial Auth Period')
                    : (creatingPeriod ? 'Creating…' : '+ New Reauth Period')}
                </button>
              </div>

              {periodError && (
                <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '13px', marginBottom: '10px' }}>
                  {periodError}
                </div>
              )}

              {authPeriods.length === 0 ? (
                <div style={{ background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '10px', padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                  No authorization periods yet. Click "+ Initial Auth Period" to get started.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* "All" filter chip */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <button
                      onClick={() => setSelectedPeriodId(null)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '20px',
                        border: selectedPeriodId === null ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
                        background: selectedPeriodId === null ? '#eff6ff' : '#fff',
                        color: selectedPeriodId === null ? '#2563eb' : '#64748b',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      All Documents
                    </button>
                    {authPeriods.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPeriodId(selectedPeriodId === p.id ? null : p.id)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '20px',
                          border: selectedPeriodId === p.id ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
                          background: selectedPeriodId === p.id ? '#eff6ff' : '#fff',
                          color: selectedPeriodId === p.id ? '#2563eb' : '#64748b',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        {periodLabel(p)}
                      </button>
                    ))}
                  </div>

                  {/* Period cards */}
                  {authPeriods.map(p => {
                    const isEditing = editingPeriod?.id === p.id;
                    return (
                      <div
                        key={p.id}
                        style={{
                          background: '#fff',
                          border: `1.5px solid ${selectedPeriodId === p.id ? '#2563eb' : '#e2e8f0'}`,
                          borderRadius: '10px',
                          padding: '12px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '16px',
                          flexWrap: 'wrap',
                        }}
                      >
                        {/* Period label */}
                        <div style={{ minWidth: '90px' }}>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{periodLabel(p)}</div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Period {p.period_number}</div>
                        </div>

                        {/* Date range */}
                        {isEditing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <input
                              type="date"
                              defaultValue={editingPeriod.start_date || ''}
                              onChange={e => setEditingPeriod(prev => ({ ...prev, start_date: e.target.value }))}
                              style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', color: '#374151' }}
                            />
                            <span style={{ fontSize: '12px', color: '#94a3b8' }}>to</span>
                            <input
                              type="date"
                              defaultValue={editingPeriod.end_date || ''}
                              onChange={e => setEditingPeriod(prev => ({ ...prev, end_date: e.target.value }))}
                              style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', color: '#374151' }}
                            />
                            <button
                              onClick={async () => {
                                try {
                                  const updated = await updateAuthPeriod(id, p.id, { start_date: editingPeriod.start_date || null, end_date: editingPeriod.end_date || null });
                                  setAuthPeriods(prev => prev.map(x => x.id === p.id ? updated : x));
                                  setEditingPeriod(null);
                                } catch (err) { setPeriodError(err.message); }
                              }}
                              style={{ padding: '4px 10px', background: '#2563eb', border: 'none', borderRadius: '5px', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingPeriod(null)}
                              style={{ padding: '4px 10px', background: '#f1f5f9', border: 'none', borderRadius: '5px', color: '#64748b', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => setEditingPeriod({ id: p.id, start_date: p.start_date || '', end_date: p.end_date || '' })}
                            title="Click to edit dates"
                            style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer', minWidth: '160px' }}
                          >
                            {p.start_date || p.end_date
                              ? `${formatDate(p.start_date)} – ${formatDate(p.end_date)}`
                              : <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>No dates set — click to add</span>
                            }
                          </div>
                        )}

                        {/* Status badge — click to cycle */}
                        <div
                          onClick={() => handlePeriodStatusToggle(p)}
                          title="Click to change status"
                          style={{ cursor: 'pointer' }}
                        >
                          <PeriodStatusBadge status={p.status} />
                        </div>

                        {/* Doc count for this period */}
                        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#94a3b8' }}>
                          {documents.filter(d => d.authorization_period_id === p.id).length} doc(s)
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Upload area ── */}
            <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Tag upload to period:</div>
              <select
                value={uploadPeriodId}
                onChange={e => setUploadPeriodId(e.target.value)}
                style={{ padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', color: '#374151', background: '#fff' }}
              >
                <option value="">No period (untagged)</option>
                {authPeriods.map(p => (
                  <option key={p.id} value={String(p.id)}>{periodLabel(p)}{p.status === 'active' ? ' (Active)' : ''}</option>
                ))}
              </select>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                handleFileDrop(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#2563eb' : '#cbd5e1'}`,
                borderRadius: '10px',
                padding: '32px',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? '#eff6ff' : '#f8fafc',
                marginBottom: '24px',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>📎</div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                PDF, DOCX, TXT, and more
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={e => { handleFileDrop(e.target.files); e.target.value = ''; }}
              />
            </div>

            {docError && (
              <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', marginBottom: '16px', fontSize: '13px' }}>
                {docError}
              </div>
            )}

            {/* Documents list */}
            {selectedPeriodId && (
              <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: '600', marginBottom: '10px' }}>
                Showing documents for: {periodLabel(authPeriods.find(p => p.id === selectedPeriodId) || {})}
                <button onClick={() => setSelectedPeriodId(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}>✕ Clear filter</button>
              </div>
            )}

            {visibleDocs.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '40px', fontSize: '14px' }}>
                {selectedPeriodId ? 'No documents tagged to this period.' : 'No documents uploaded yet.'}
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      {['File', 'Period', 'Uploaded By', 'Date', 'Size', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocs.map((doc, i) => {
                      const docPeriod = authPeriods.find(p => p.id === doc.authorization_period_id);
                      return (
                        <tr
                          key={doc.id}
                          style={{ borderBottom: i < visibleDocs.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}
                        >
                          <td style={{ padding: '11px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '18px' }}>{fileIcon(doc.file_type)}</span>
                              <span style={{ color: '#0f172a', fontWeight: '500' }}>{doc.original_name}</span>
                            </div>
                          </td>
                          <td style={{ padding: '11px 14px', color: '#64748b', fontSize: '12px' }}>
                            {docPeriod ? periodLabel(docPeriod) : <span style={{ color: '#cbd5e1' }}>—</span>}
                          </td>
                          <td style={{ padding: '11px 14px', color: '#64748b' }}>{doc.uploader || '—'}</td>
                          <td style={{ padding: '11px 14px', color: '#64748b' }}>{formatDate(doc.uploaded_at)}</td>
                          <td style={{ padding: '11px 14px', color: '#64748b' }}>{formatSize(doc.file_size)}</td>
                          <td style={{ padding: '11px 14px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                onClick={() => handleDownloadDoc(doc)}
                                style={{ padding: '4px 10px', background: '#f1f5f9', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', color: '#374151' }}
                              >
                                Download
                              </button>
                              <button
                                onClick={() => handleUseInPlan(doc)}
                                style={{ padding: '4px 10px', background: '#eff6ff', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', color: '#2563eb' }}
                              >
                                Use in Plan
                              </button>
                              <button
                                onClick={() => handleDeleteDoc(doc.id)}
                                style={{ padding: '4px 10px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', color: '#dc2626' }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
