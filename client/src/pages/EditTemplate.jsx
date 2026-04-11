import React, { useState, useEffect, useRef } from 'react';
import { getPrompt, updatePrompt } from '../api.js';

export default function EditTemplate({ user }) {
  const isAdmin = user?.role === 'Admin';
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Logo state
  const [logoExists, setLogoExists] = useState(false);
  const [logoKey, setLogoKey] = useState(0); // bump to force img reload
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoDeleting, setLogoDeleting] = useState(false);
  const [logoError, setLogoError] = useState('');
  const logoInputRef = useRef(null);

  useEffect(() => {
    getPrompt()
      .then(p => {
        setText(p.text);
        setLabel(p.label || 'Default');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));

    // Check whether a logo exists
    fetch('/api/settings/logo', { method: 'HEAD' })
      .then(r => setLogoExists(r.ok))
      .catch(() => setLogoExists(false));
  }, []);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLogoError('');
    setLogoUploading(true);
    try {
      const token = localStorage.getItem('allstar_token');
      const form = new FormData();
      form.append('logo', file);
      const r = await fetch('/api/settings/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Upload failed');
      }
      setLogoExists(true);
      setLogoKey(k => k + 1);
    } catch (err) {
      setLogoError(err.message);
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const handleLogoDelete = async () => {
    setLogoError('');
    setLogoDeleting(true);
    try {
      const token = localStorage.getItem('allstar_token');
      const r = await fetch('/api/settings/logo', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Delete failed');
      }
      setLogoExists(false);
      setLogoKey(k => k + 1);
    } catch (err) {
      setLogoError(err.message);
    } finally {
      setLogoDeleting(false);
    }
  };

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

      {!isAdmin && (
        <div style={{
          background: '#fef9c3',
          border: '1px solid #fde047',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '24px',
          color: '#854d0e',
          fontSize: '14px',
          fontWeight: '500',
        }}>
          Admin access required to make changes. You can view the current prompt but cannot save edits.
        </div>
      )}

      {/* ── Company Logo ── */}
      <div style={{
        background: '#f8fafc',
        border: '1.5px solid #e2e8f0',
        borderRadius: '10px',
        padding: '20px 24px',
        marginBottom: '32px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
          Company Logo
        </div>
        <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
          Appears centered at the top of the first page of every exported DOCX.
        </div>

        {logoExists && (
          <div style={{ marginBottom: '16px' }}>
            <img
              key={logoKey}
              src={`/api/settings/logo?v=${logoKey}`}
              alt="Company logo"
              style={{
                maxHeight: '80px',
                maxWidth: '300px',
                display: 'block',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '8px',
                background: '#fff',
                marginBottom: '12px',
              }}
            />
          </div>
        )}

        {isAdmin && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: 'none' }}
              onChange={handleLogoUpload}
            />
            <button
              onClick={() => logoInputRef.current.click()}
              disabled={logoUploading}
              style={{
                padding: '8px 18px',
                background: logoUploading ? '#93c5fd' : '#2563eb',
                border: 'none',
                borderRadius: '7px',
                color: '#fff',
                fontSize: '13px',
                fontWeight: '600',
                cursor: logoUploading ? 'not-allowed' : 'pointer',
              }}
            >
              {logoUploading ? 'Uploading...' : logoExists ? 'Replace Logo' : 'Upload Logo'}
            </button>

            {logoExists && (
              <button
                onClick={handleLogoDelete}
                disabled={logoDeleting}
                style={{
                  padding: '8px 18px',
                  background: logoDeleting ? '#fca5a5' : '#fee2e2',
                  border: '1px solid #fecaca',
                  borderRadius: '7px',
                  color: logoDeleting ? '#9b1c1c' : '#dc2626',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: logoDeleting ? 'not-allowed' : 'pointer',
                }}
              >
                {logoDeleting ? 'Removing...' : 'Remove Logo'}
              </button>
            )}
          </div>
        )}

        {logoError && (
          <div style={{ color: '#dc2626', fontSize: '13px', marginTop: '10px' }}>
            {logoError}
          </div>
        )}
      </div>

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

          {isAdmin && (
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
          )}
        </>
      )}
    </div>
  );
}
