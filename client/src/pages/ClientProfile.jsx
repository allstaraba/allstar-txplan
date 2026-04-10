import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getClient,
  updateClientStatus,
  updateClientNotes,
  uploadClientDocument,
  deleteClientDocument,
  extractDocumentText,
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

export default function ClientProfile({ currentPlan, setCurrentPlan, injectedText, setInjectedText }) {
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

  const loadClient = () => {
    getClient(id)
      .then(data => {
        setClient(data);
        setNotes(data.notes || '');
        setDocuments(data.documents || []);
        setError('');
        // Set currentPlan so ReviewRevise can load revisions
        setCurrentPlan({ plan_id: parseInt(id), client_name: data.client_name });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadClient();
    return () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); };
  }, [id]);

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
    for (const file of Array.from(files)) {
      try {
        const doc = await uploadClientDocument(id, file);
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
          />
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            {/* Upload area */}
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
            {documents.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '40px', fontSize: '14px' }}>
                No documents uploaded yet.
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      {['File', 'Uploaded By', 'Date', 'Size', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc, i) => (
                      <tr
                        key={doc.id}
                        style={{ borderBottom: i < documents.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '18px' }}>{fileIcon(doc.file_type)}</span>
                            <span style={{ color: '#0f172a', fontWeight: '500' }}>{doc.original_name}</span>
                          </div>
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
                    ))}
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
