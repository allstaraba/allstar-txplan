import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadFile, generatePlan } from '../api.js';

export default function GeneratePlan({ setCurrentPlan }) {
  const [notes, setNotes] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const acceptedExts = ['.pdf', '.docx', '.txt', '.md', '.rtf', '.zip'];

  const handleFile = async (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!acceptedExts.includes(ext)) {
      setError(`Unsupported file type. Accepted: ${acceptedExts.join(', ')}`);
      return;
    }
    setUploading(true);
    setError('');
    setFileName(file.name);
    try {
      const data = await uploadFile(file);
      setNotes(data.text);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleGenerate = async () => {
    if (!notes.trim()) {
      setError('Please enter or upload notes before generating.');
      return;
    }
    setLoading(true);
    setError('');
    let accumulated = '';
    try {
      const data = await generatePlan(notes, (chunk) => {
        accumulated += chunk;
      });
      setCurrentPlan({ plan_id: data.plan_id, text: accumulated, client_name: data.client_name });
      navigate('/review');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>
        Generate Treatment Plan
      </h1>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '32px' }}>
        Upload a file or paste BCBA intake notes to generate a complete ABA treatment plan.
      </p>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#2563eb' : '#cbd5e1'}`,
          borderRadius: '12px',
          padding: '40px 24px',
          textAlign: 'center',
          background: dragOver ? '#eff6ff' : '#f8fafc',
          cursor: 'pointer',
          transition: 'all 0.15s',
          marginBottom: '20px',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedExts.join(',')}
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }}
        />
        {uploading ? (
          <div style={{ color: '#2563eb' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>⏳</div>
            <div style={{ fontSize: '14px' }}>Extracting text...</div>
          </div>
        ) : fileName ? (
          <div>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>📄</div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{fileName}</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Click to replace</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>☁</div>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
              Drop a file here or click to browse
            </div>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Supports: {acceptedExts.join(', ')}
            </div>
          </div>
        )}
      </div>

      {/* Notes Textarea */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Paste BCBA intake notes here, or drop a file above..."
        style={{
          width: '100%',
          minHeight: '280px',
          padding: '16px',
          border: '1.5px solid #e2e8f0',
          borderRadius: '10px',
          fontSize: '14px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#0f172a',
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
          lineHeight: '1.6',
          background: '#fff',
        }}
        onFocus={e => e.target.style.borderColor = '#2563eb'}
        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
      />

      {error && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          padding: '12px 16px',
          marginTop: '12px',
          color: '#dc2626',
          fontSize: '14px',
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={loading || uploading}
        style={{
          marginTop: '20px',
          padding: '13px 32px',
          background: loading || uploading ? '#93c5fd' : '#2563eb',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '15px',
          fontWeight: '600',
          cursor: loading || uploading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          transition: 'background 0.15s',
        }}
      >
        {loading ? (
          <>
            <span style={{
              display: 'inline-block',
              width: '16px',
              height: '16px',
              border: '2px solid rgba(255,255,255,0.4)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
            Generating treatment plan... This may take 1-2 minutes.
          </>
        ) : 'Generate Treatment Plan'}
      </button>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
