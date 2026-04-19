import React, { useMemo, useState } from 'react';
import { export97155Report, preview97155Report } from '../api.js';

const panel = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

export default function Reports97155() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const monthLabel = useMemo(() => {
    if (!preview?.source?.months?.length) return '—';
    return preview.source.months.join(', ');
  }, [preview]);

  const handleFile = (nextFile) => {
    setFile(nextFile || null);
    setPreview(null);
    setError('');
  };

  const runPreview = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const data = await preview97155Report(file);
      setPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runExport = async () => {
    if (!file) return;
    setExporting(true);
    setError('');
    try {
      const { blob, filename } = await export97155Report(file);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: '28px 32px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#0f172a' }}>
      <div style={{ marginBottom: '22px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>97155 Reports</h1>
        <p style={{ margin: '8px 0 0', color: '#64748b', maxWidth: '820px', lineHeight: 1.5 }}>
          Upload a monthly 97155 workbook and export a rebuilt package with a detail tab, a master summary tab,
          and one BCBA tab per provider using the same print breakdown as your April 2026 sample.
        </p>
      </div>

      <div style={{ ...panel, padding: '20px', marginBottom: '20px' }}>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files?.[0]);
          }}
          style={{
            border: '2px dashed #cbd5e1',
            borderRadius: '12px',
            padding: '28px',
            textAlign: 'center',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
            Drop a workbook here or choose a file
          </div>
          <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '14px' }}>
            Best input: a workbook with `97155 Billed Detail` and `In-Person by Client`
          </div>
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            onChange={(e) => handleFile(e.target.files?.[0])}
            style={{ marginBottom: '12px' }}
          />
          <div style={{ fontSize: '13px', color: file ? '#0f172a' : '#94a3b8' }}>
            {file ? file.name : 'No file selected'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button
            onClick={runPreview}
            disabled={!file || loading}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              background: !file || loading ? '#cbd5e1' : '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: !file || loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Analyzing…' : 'Preview Breakdown'}
          </button>
          <button
            onClick={runExport}
            disabled={!file || exporting}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: !file || exporting ? '#f8fafc' : '#fff',
              color: '#0f172a',
              fontWeight: 600,
              cursor: !file || exporting ? 'default' : 'pointer',
            }}
          >
            {exporting ? 'Building Workbook…' : 'Export Styled Workbook'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '14px', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: '8px', fontSize: '13px' }}>
            {error}
          </div>
        )}
      </div>

      {preview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px', marginBottom: '20px' }}>
            {[
              ['Month(s)', monthLabel],
              ['Detail Rows', preview.source.detailRowCount],
              ['Summary Rows', preview.source.summaryRowCount],
              ['BCBA Sheets', preview.source.ownerSheetCount],
            ].map(([label, value]) => (
              <div key={label} style={{ ...panel, padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{label}</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>

          {preview.warnings?.length > 0 && (
            <div style={{ ...panel, padding: '16px', marginBottom: '20px', background: '#fffbeb', borderColor: '#fde68a' }}>
              <div style={{ fontWeight: 700, marginBottom: '8px' }}>Warnings</div>
              {preview.warnings.map((warning) => (
                <div key={warning} style={{ fontSize: '13px', color: '#92400e', marginBottom: '4px' }}>{warning}</div>
              ))}
            </div>
          )}

          <div style={{ ...panel, overflow: 'hidden', marginBottom: '20px' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>BCBA Breakdown</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['BCBA', 'Clients', '97153 Hours', '97155 Needed', '97155 Completed'].map((header) => (
                    <th key={header} style={{ textAlign: 'left', padding: '10px 14px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.owners.map((owner, index) => (
                  <tr key={owner.owner_name} style={{ borderTop: index ? '1px solid #f1f5f9' : 'none' }}>
                    <td style={{ padding: '11px 14px', fontWeight: 600 }}>{owner.owner_name}</td>
                    <td style={{ padding: '11px 14px' }}>{owner.client_count}</td>
                    <td style={{ padding: '11px 14px' }}>{owner.scheduled_97153_hours.toFixed(2)}</td>
                    <td style={{ padding: '11px 14px' }}>{owner.total_97155_needed.toFixed(2)}</td>
                    <td style={{ padding: '11px 14px' }}>{owner.total_97155_completed.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
