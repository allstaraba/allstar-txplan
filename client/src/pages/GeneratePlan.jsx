import React, { useState, useRef } from 'react';
import { uploadFile } from '../api.js';

export default function GeneratePlan({ onGenerate, isGenerating }) {
  const [notes, setNotes] = useState('');
  // uploadedFiles: [{ name, text, fileId, fileSize, fileType }]
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingName, setUploadingName] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const acceptedExts = ['.pdf', '.docx', '.txt', '.md', '.rtf', '.zip', '.xlsx', '.xls'];

  const handleFiles = async (files) => {
    for (const file of Array.from(files)) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!acceptedExts.includes(ext)) {
        setError(`Unsupported file type: ${file.name}. Accepted: ${acceptedExts.join(', ')}`);
        continue;
      }
      setUploading(true);
      setUploadingName(file.name);
      setError('');
      try {
        const data = await uploadFile(file);
        setUploadedFiles(prev => [...prev, { name: file.name, text: data.text, fileId: data.fileId, fileSize: data.fileSize, fileType: data.fileType }]);
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${err.message}`);
      } finally {
        setUploading(false);
        setUploadingName('');
      }
    }
    // Reset input so selecting the same file again triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const handleGenerate = () => {
    // Combine uploaded file texts with separators, then append manual notes
    const parts = uploadedFiles.map(f => `--- ${f.name} ---\n${f.text}`);
    if (notes.trim()) parts.push(`--- Additional Notes ---\n${notes.trim()}`);
    const combined = parts.join('\n\n');

    if (!combined.trim()) {
      setError('Please upload a file or paste notes before generating.');
      return;
    }
    setError('');
    const fileIds = uploadedFiles
      .filter(f => f.fileId)
      .map(f => ({ fileId: f.fileId, originalName: f.name, fileSize: f.fileSize, fileType: f.fileType }));
    onGenerate(combined, fileIds);
  };

  const disabled = isGenerating || uploading;

  return (
    <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>
        Generate Treatment Plan
      </h1>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '32px' }}>
        Upload one or more files and/or paste BCBA intake notes to generate a complete ABA treatment plan.
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
          padding: '32px 24px',
          textAlign: 'center',
          background: dragOver ? '#eff6ff' : '#f8fafc',
          cursor: 'pointer',
          transition: 'all 0.15s',
          marginBottom: uploadedFiles.length ? '12px' : '20px',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedExts.join(',')}
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files.length) handleFiles(e.target.files); }}
        />
        {uploading ? (
          <div style={{ color: '#2563eb' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
            <div style={{ fontSize: '14px' }}>Uploading {uploadingName}…</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>☁</div>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
              Drop files here or click to add more
            </div>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Supports: {acceptedExts.join(', ')} · Multiple files allowed
            </div>
          </div>
        )}
      </div>

      {/* Uploaded file list */}
      {uploadedFiles.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          {uploadedFiles.map((f, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              marginBottom: '6px',
            }}>
              <span style={{ fontSize: '16px' }}>📄</span>
              <span style={{ flex: 1, fontSize: '13px', fontWeight: '500', color: '#0f172a' }}>{f.name}</span>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {Math.round(f.text.length / 1000)}k chars
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  fontSize: '16px',
                  lineHeight: 1,
                  padding: '2px 4px',
                  borderRadius: '4px',
                }}
                title="Remove file"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Notes Textarea */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={uploadedFiles.length
          ? 'Paste any additional notes here (optional — will be combined with uploaded files)…'
          : 'Paste BCBA intake notes here, or drop a file above…'}
        style={{
          width: '100%',
          minHeight: '220px',
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
        disabled={disabled}
        style={{
          marginTop: '20px',
          padding: '13px 32px',
          background: disabled ? '#93c5fd' : '#2563eb',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '15px',
          fontWeight: '600',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          transition: 'background 0.15s',
        }}
      >
        {isGenerating ? (
          <>
            <span style={{
              display: 'inline-block', width: '16px', height: '16px',
              border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
              borderRadius: '50%', animation: 'spin 0.7s linear infinite',
            }} />
            Generating… you can navigate away safely
          </>
        ) : 'Generate Treatment Plan'}
      </button>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
