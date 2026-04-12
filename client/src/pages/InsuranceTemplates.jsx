import React, { useState, useEffect } from 'react';
import { getInsuranceTemplates, getInsuranceTemplate, createInsuranceTemplate, updateInsuranceTemplate, deleteInsuranceTemplate } from '../api.js';

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
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // template id to confirm

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
    try {
      const t = await getInsuranceTemplate(id);
      setEditing({ id: t.id, name: t.name, text: t.text });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingEdit(false);
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setError('');
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
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Insurance Rules Document
            <span style={{ fontWeight: '400', color: '#94a3b8', marginLeft: '8px' }}>
              Paste the full rules text — Claude will check each requirement against the plan
            </span>
          </label>
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

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleSave} disabled={saving} style={{ ...btnStyle('primary'), opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Template'}
          </button>
          <button onClick={cancelEdit} style={btnStyle('ghost')}>Cancel</button>
        </div>
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
            Paste insurance rules documents. BCBAs can run compliance checks against any template from the Review & Revise page.
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
