import React, { useState, useEffect } from 'react';
import { getPrompt, updatePrompt } from '../api.js';

export default function EditTemplate() {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getPrompt()
      .then(p => {
        setText(p.text);
        setLabel(p.label || 'Default');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!text.trim() || !label.trim()) {
      setError('Both label and prompt text are required.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await updatePrompt(text, label);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>
        Edit Template
      </h1>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '32px' }}>
        Edit the active system prompt used when generating treatment plans. Saving creates a new version.
      </p>

      {loading ? (
        <div style={{ color: '#64748b', fontSize: '14px' }}>Loading prompt...</div>
      ) : (
        <>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Version Label
            </label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g., Updated Goals v2"
              style={{
                width: '300px',
                padding: '8px 12px',
                border: '1.5px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '14px',
                color: '#0f172a',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              System Prompt
            </label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              style={{
                width: '100%',
                height: '500px',
                padding: '16px',
                border: '1.5px solid #e2e8f0',
                borderRadius: '10px',
                fontSize: '13px',
                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                color: '#0f172a',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                lineHeight: '1.6',
                background: '#f8fafc',
              }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>

          {error && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '12px',
              color: '#dc2626',
              fontSize: '14px',
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '12px',
              color: '#16a34a',
              fontSize: '14px',
              fontWeight: '600',
            }}>
              ✓ Saved! New version is now active.
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '11px 28px',
              background: saving ? '#93c5fd' : '#2563eb',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save New Version'}
          </button>
        </>
      )}
    </div>
  );
}
