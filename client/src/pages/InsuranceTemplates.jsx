import React, { useState, useEffect, useRef } from 'react';
import { getInsuranceTemplates, getInsuranceTemplate, createInsuranceTemplate, updateInsuranceTemplate, deleteInsuranceTemplate, extractInsuranceTemplateDocument, getInsuranceTemplateVersions, restoreInsuranceTemplateVersion } from '../api.js';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function InsuranceTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editor state — null means "list view", otherwise { id: null|number, name, text }
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // template id to confirm
  const fileInputRef = useRef(null);

  // Version history for the template currently being edited
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null); // version object being previewed

  const load = () => {
    setLoading(true);
    getInsuranceTemplates()
      .then(data => setTemplates(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const startCreate = () => {
    setEditing({ id: null, name: '', text: '' });
    setError('');
    setSuccess('');
  };

  const startEdit = async (id) => {
    setError('');
    setSuccess('');
    setLoadingEdit(true);
    setVersions([]);
    setShowVersions(false);
    setPreviewVersion(null);
    try {
      const [t, vers] = await Promise.all([getInsuranceTemplate(id), getInsuranceTemplateVersions(id)]);
      setEditing({ id: t.id, name: t.name, text: t.text });
      setVersions(vers);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingEdit(false);
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setError('');
    setVersions([]);
    setShowVersions(false);
    setPreviewVersion(null);
  };

  const handleRestore = async (version) => {
    if (!editing?.id) return;
    setRestoring(true);
    setError('');
    try {
      await restoreInsuranceTemplateVersion(editing.id, version.id);
      // Reload template and version list
      const [t, vers] = await Promise.all([getInsuranceTemplate(editing.id), getInsuranceTemplateVersions(editing.id)]);
      setEditing({ id: t.id, name: t.name, text: t.text });
      setVersions(vers);
      setPreviewVersion(null);
      setShowVersions(false);
      setSuccess(`Restored to version ${version.version_number}.`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setExtracting(true);
    setError('');
    try {
      const { text, filename } = await extractInsuranceTemplateDocument(file);
      setEditing(prev => ({
        ...prev,
        text,
        name: prev.name || filename.replace(/\.[^.]+$/, ''),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!editing.name.trim()) { setError('Name is required.'); return; }
    if (!editing.text.trim()) { setError('Rules text is required.'); return; }
    setSaving(true);
    setError('');
    try {
      if (editing.id === null) {
        await createInsuranceTemplate(editing.name.trim(), editing.text.trim());
        setSuccess('Template created.');
      } else {
        await updateInsuranceTemplate(editing.id, editing.name.trim(), editing.text.trim());
        setSuccess('Template saved.');
      }
      setEditing(null);
      load();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteInsuranceTemplate(id);
      setConfirmDelete(null);
      setSuccess('Template deleted.');
      load();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
      setConfirmDelete(null);
    }
  };

  const cardStyle = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
    padding: '18px 22px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  };

  const btnStyle = (variant = 'default') => ({
    padding: '7px 14px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    ...(variant === 'primary' ? { background: '#2563eb', color: '#fff' } :
        variant === 'danger' ? { background: '#ef4444', color: '#fff' } :
        variant === 'ghost' ? { background: '#f1f5f9', color: '#374151' } :
        { background: '#f1f5f9', color: '#374151' }),
  });

  // ── Editor view ──────────────────────────────────────────────────────────────
  if (editing !== null) {
    return (
      <div style={{ padding: '32px', maxWidth: '900px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <button onClick={cancelEdit} style={{ ...btnStyle('ghost'), fontSize: '13px' }}>← Back</button>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a', margin: 0 }}>
            {editing.id === null ? 'New Insurance Template' : 'Edit Template'}
          </h1>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Template Name
          </label>
          <input
            type="text"
            value={editing.name}
            onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Carelon Maryland Medicaid"
            style={{
              width: '100%', padding: '10px 13px', border: '1.5px solid #e2e8f0',
              borderRadius: '8px', fontSize: '14px', color: '#0f172a', outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => e.target.style.borderColor = '#2563eb'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
              Insurance Rules Document
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
              style={{ ...btnStyle('ghost'), fontSize: '12px', padding: '5px 11px', opacity: extracting ? 0.6 : 1 }}
            >
              {extracting ? 'Extracting…' : '↑ Upload PDF / DOCX / TXT'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>or paste below</span>
          </div>
          <textarea
            value={editing.text}
            onChange={e => setEditing(prev => ({ ...prev, text: e.target.value }))}
            placeholder="Paste the insurance company's coverage rules, requirements, and criteria here…"
            rows={28}
            style={{
              width: '100%', padding: '12px 14px', border: '1.5px solid #e2e8f0',
              borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', color: '#0f172a',
              resize: 'vertical', outline: 'none', lineHeight: '1.6', boxSizing: 'border-box',
            }}
            onFocus={e => e.target.style.borderColor = '#2563eb'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
          {editing.text && (
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px', textAlign: 'right' }}>
              {editing.text.length.toLocaleString()} characters
            </div>
          )}
        </div>

        {success && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
            {success}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginBottom: versions.length > 0 ? '32px' : 0 }}>
          <button onClick={handleSave} disabled={saving} style={{ ...btnStyle('primary'), opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Template'}
          </button>
          <button onClick={cancelEdit} style={btnStyle('ghost')}>Cancel</button>
        </div>

        {/* Version history — only for existing templates */}
        {editing.id !== null && versions.length > 0 && (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '24px' }}>
            <button
              onClick={() => { setShowVersions(v => !v); setPreviewVersion(null); }}
              style={{ background: 'none', border: 'none', fontSize: '13px', fontWeight: '600', color: '#64748b', cursor: 'pointer', padding: 0, marginBottom: '12px' }}
            >
              {showVersions ? '▾' : '▸'} Version History ({versions.length})
            </button>

            {showVersions && (
              <div>
                {previewVersion && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                        Version {previewVersion.version_number} — {formatDate(previewVersion.created_at)}
                      </span>
                      <button
                        onClick={() => handleRestore(previewVersion)}
                        disabled={restoring}
                        style={{ ...btnStyle('primary'), fontSize: '12px', padding: '5px 12px', opacity: restoring ? 0.6 : 1 }}
                      >
                        {restoring ? 'Restoring…' : 'Restore this version'}
                      </button>
                      <button onClick={() => setPreviewVersion(null)} style={{ ...btnStyle('ghost'), fontSize: '12px', padding: '5px 10px' }}>Close</button>
                    </div>
                    <div style={{ fontSize: '12px', color: '#374151', fontWeight: '600', marginBottom: '4px' }}>{previewVersion.name}</div>
                    <pre style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', margin: 0, lineHeight: '1.5' }}>
                      {previewVersion.text.slice(0, 1000)}{previewVersion.text.length > 1000 ? '\n…' : ''}
                    </pre>
                  </div>
                )}
                {versions.map(v => (
                  <div
                    key={v.id}
                    style={{ display: 'flex', alignItems: 'center', padding: '9px 12px', marginBottom: '6px', background: previewVersion?.id === v.id ? '#eff6ff' : '#f8fafc', border: `1px solid ${previewVersion?.id === v.id ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: '6px' }}
                  >
                    <div style={{ flex: 1, fontSize: '13px', color: '#374151' }}>
                      <span style={{ fontWeight: '600' }}>v{v.version_number}</span>
                      <span style={{ color: '#94a3b8', marginLeft: '10px', fontSize: '12px' }}>{formatDate(v.created_at)}</span>
                      {v.name !== editing.name && <span style={{ color: '#94a3b8', marginLeft: '8px', fontSize: '12px' }}>"{v.name}"</span>}
                    </div>
                    <button
                      onClick={() => setPreviewVersion(previewVersion?.id === v.id ? null : v)}
                      style={{ ...btnStyle('ghost'), fontSize: '12px', padding: '4px 10px' }}
                    >
                      {previewVersion?.id === v.id ? 'Hide' : 'Preview'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px', maxWidth: '800px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Insurance Templates</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px', marginBottom: 0 }}>
            Paste or upload insurance rules documents. Used by the Compliance tool to check plans against each insurer's requirements.
          </p>
        </div>
        <button onClick={startCreate} style={{ ...btnStyle('primary'), padding: '9px 18px' }}>
          + New Template
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
          {success}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#94a3b8', fontSize: '14px' }}>Loading…</div>
      ) : templates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>No templates yet</div>
          <div style={{ fontSize: '13px', marginBottom: '20px' }}>Create your first insurance rules template to enable compliance checking.</div>
          <button onClick={startCreate} style={btnStyle('primary')}>+ New Template</button>
        </div>
      ) : (
        templates.map(t => (
          <div key={t.id} style={cardStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#0f172a', marginBottom: '3px' }}>{t.name}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Created {formatDate(t.created_at)}</div>
            </div>
            {loadingEdit ? null : (
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button onClick={() => startEdit(t.id)} style={btnStyle('ghost')}>Edit</button>
                {confirmDelete === t.id ? (
                  <>
                    <span style={{ fontSize: '13px', color: '#dc2626', alignSelf: 'center' }}>Delete?</span>
                    <button onClick={() => handleDelete(t.id)} style={btnStyle('danger')}>Yes, Delete</button>
                    <button onClick={() => setConfirmDelete(null)} style={btnStyle('ghost')}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDelete(t.id)} style={{ ...btnStyle('ghost'), color: '#dc2626' }}>Delete</button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
