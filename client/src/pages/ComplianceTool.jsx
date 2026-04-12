import React, { useState, useEffect, useRef } from 'react';
import { getInsuranceTemplates, getComplianceChecks, runComplianceCheck, sendComplianceChatMessage, extractCompliancePlan } from '../api.js';

// ── Compliance result renderer ────────────────────────────────────────────────
function ComplianceResult({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div style={{ fontSize: '13.5px', lineHeight: '1.75', color: '#1e293b' }}>
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} style={{ height: '8px' }} />;
        if (t.startsWith('## ')) {
          return <h2 key={i} style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '20px 0 10px', borderBottom: '2px solid #e2e8f0', paddingBottom: '6px' }}>{t.slice(3)}</h2>;
        }
        if (t.startsWith('### ')) {
          const heading = t.slice(4);
          const color = heading.includes('❌') || heading.toLowerCase().includes('fail') ? '#dc2626'
            : heading.includes('⚠️') || heading.toLowerCase().includes('warn') ? '#d97706'
            : heading.includes('✅') || heading.toLowerCase().includes('pass') ? '#16a34a'
            : '#374151';
          const bg = heading.includes('❌') ? '#fef2f2'
            : heading.includes('⚠️') ? '#fffbeb'
            : heading.includes('✅') ? '#f0fdf4'
            : '#f8fafc';
          return (
            <div key={i} style={{ background: bg, borderRadius: '6px', padding: '8px 12px', margin: '14px 0 8px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color, margin: 0 }}>{heading}</h3>
            </div>
          );
        }
        const parts = t.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((p, j) =>
          p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p
        );
        const isListItem = t.startsWith('- ') || /^\d+\.\s/.test(t);
        return (
          <div key={i} style={{ marginBottom: isListItem ? '8px' : '3px', paddingLeft: isListItem ? '12px' : 0 }}>
            {rendered}
          </div>
        );
      })}
    </div>
  );
}

// ── Chat bubble ───────────────────────────────────────────────────────────────
function ChatBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: '12px' }}>
      <div style={{
        maxWidth: '90%', padding: '10px 14px',
        background: isUser ? '#2563eb' : '#f1f5f9',
        color: isUser ? '#fff' : '#1e293b',
        borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
        fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap',
      }}>
        {msg.content}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ padding: '10px 14px', display: 'flex', gap: '4px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '6px', height: '6px', borderRadius: '50%', background: '#94a3b8',
          animation: 'bounce 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`, display: 'inline-block',
        }} />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ComplianceTool() {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Plan input
  const [planText, setPlanText] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [inputMode, setInputMode] = useState('upload'); // 'upload' | 'paste'
  const fileInputRef = useRef(null);

  // Check state
  const [checking, setChecking] = useState(false);
  const [streamingResult, setStreamingResult] = useState('');
  const [finalResult, setFinalResult] = useState('');
  const [checkHistory, setCheckHistory] = useState([]);
  const [viewingCheck, setViewingCheck] = useState(null);
  const [error, setError] = useState('');

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [streamingChat, setStreamingChat] = useState('');
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const resultEndRef = useRef(null);
  const dropZoneRef = useRef(null);

  const activeResult = viewingCheck ? viewingCheck.result_text : (finalResult || streamingResult);

  useEffect(() => {
    Promise.all([getInsuranceTemplates(), getComplianceChecks()])
      .then(([t, checks]) => {
        setTemplates(t);
        if (t.length > 0) setSelectedTemplateId(String(t[0].id));
        setCheckHistory(checks);
      })
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => { resultEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [streamingResult]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, streamingChat]);

  // Drag-and-drop on the drop zone
  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;
    const onDragOver = (e) => { e.preventDefault(); el.style.borderColor = '#2563eb'; el.style.background = '#eff6ff'; };
    const onDragLeave = () => { el.style.borderColor = '#cbd5e1'; el.style.background = '#f8fafc'; };
    const onDrop = (e) => {
      e.preventDefault();
      el.style.borderColor = '#cbd5e1';
      el.style.background = '#f8fafc';
      const file = e.dataTransfer.files[0];
      if (file) handleFileExtract(file);
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  const handleFileExtract = async (file) => {
    setError('');
    setExtracting(true);
    try {
      const result = await extractCompliancePlan(file);
      setPlanText(result.text);
      setDocumentName(result.filename);
      setInputMode('paste'); // switch to text view so user can see/edit
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) handleFileExtract(file);
    e.target.value = '';
  };

  const handleRunCheck = async () => {
    if (!planText.trim() || !selectedTemplateId || checking) return;
    setError('');
    setStreamingResult('');
    setFinalResult('');
    setViewingCheck(null);
    setChatMessages([]);
    setChecking(true);
    let accumulated = '';
    try {
      await runComplianceCheck(planText, Number(selectedTemplateId), documentName || 'Uploaded Plan', (chunk) => {
        accumulated += chunk;
        setStreamingResult(accumulated);
      });
      setFinalResult(accumulated);
      setStreamingResult('');
      const checks = await getComplianceChecks();
      setCheckHistory(checks);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const handleViewHistory = (check) => {
    setViewingCheck(check);
    setFinalResult('');
    setStreamingResult('');
    setChatMessages([]);
  };

  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatSending) return;
    const result = activeResult;
    if (!result) return;
    const newMessages = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);
    setChatInput('');
    setChatSending(true);
    setStreamingChat('');
    let reply = '';
    try {
      await sendComplianceChatMessage(
        result,
        newMessages,
        documentName || 'this plan',
        (chunk) => { reply += chunk; setStreamingChat(reply); }
      );
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatSending(false);
      setStreamingChat('');
      setTimeout(() => chatInputRef.current?.focus(), 50);
    }
  };

  const handleChatKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  };

  const clearPlan = () => {
    setPlanText('');
    setDocumentName('');
    setInputMode('upload');
    setFinalResult('');
    setStreamingResult('');
    setViewingCheck(null);
    setChatMessages([]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Top bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a', marginRight: '4px', whiteSpace: 'nowrap' }}>Compliance Check</span>

        {/* Template picker */}
        <select
          value={selectedTemplateId}
          onChange={e => setSelectedTemplateId(e.target.value)}
          disabled={checking || templates.length === 0}
          style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', color: '#0f172a', background: '#fff', maxWidth: '240px' }}
        >
          {templates.length === 0
            ? <option>No templates — admin must add one</option>
            : templates.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)
          }
        </select>

        <button
          onClick={handleRunCheck}
          disabled={checking || !planText.trim() || !selectedTemplateId || templates.length === 0}
          style={{
            padding: '8px 20px',
            background: checking ? '#e2e8f0' : (!planText.trim() ? '#e2e8f0' : '#2563eb'),
            border: 'none', borderRadius: '6px',
            color: checking || !planText.trim() ? '#94a3b8' : '#fff',
            fontSize: '13px', fontWeight: '600',
            cursor: checking || !planText.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {checking ? `Checking… ${streamingResult.length > 0 ? `· ${streamingResult.length.toLocaleString()} chars` : ''}` : 'Run Compliance Check'}
        </button>

        {error && <span style={{ fontSize: '12px', color: '#dc2626' }}>{error}</span>}
      </div>

      {/* Body: left panel (upload + results) + right panel (chat) */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: upload/paste + results (60%) */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', overflow: 'hidden' }}>

          {/* Plan input section */}
          {!checking && !finalResult && !streamingResult && !viewingCheck && (
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Plan document:</span>
                <button
                  onClick={() => setInputMode('upload')}
                  style={{
                    padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                    border: '1px solid', cursor: 'pointer',
                    borderColor: inputMode === 'upload' ? '#2563eb' : '#e2e8f0',
                    background: inputMode === 'upload' ? '#eff6ff' : '#fff',
                    color: inputMode === 'upload' ? '#2563eb' : '#64748b',
                  }}
                >
                  Upload File
                </button>
                <button
                  onClick={() => setInputMode('paste')}
                  style={{
                    padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                    border: '1px solid', cursor: 'pointer',
                    borderColor: inputMode === 'paste' ? '#2563eb' : '#e2e8f0',
                    background: inputMode === 'paste' ? '#eff6ff' : '#fff',
                    color: inputMode === 'paste' ? '#2563eb' : '#64748b',
                  }}
                >
                  Paste Text
                </button>
                {planText && (
                  <span style={{ fontSize: '12px', color: '#16a34a', marginLeft: '4px' }}>
                    ✓ {documentName || 'Plan text'} · {planText.length.toLocaleString()} chars
                  </span>
                )}
                {planText && (
                  <button onClick={clearPlan} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: '12px', color: '#94a3b8', cursor: 'pointer' }}>
                    ✕ Clear
                  </button>
                )}
              </div>

              {inputMode === 'upload' && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  <div
                    ref={dropZoneRef}
                    onClick={() => !extracting && fileInputRef.current?.click()}
                    style={{
                      border: '2px dashed #cbd5e1', borderRadius: '10px',
                      padding: '36px 24px', textAlign: 'center',
                      background: '#f8fafc', cursor: extracting ? 'default' : 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {extracting ? (
                      <div style={{ color: '#2563eb', fontSize: '14px' }}>
                        <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #bfdbfe', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: 'middle', marginRight: '8px' }} />
                        Extracting text…
                      </div>
                    ) : planText ? (
                      <div>
                        <div style={{ fontSize: '20px', marginBottom: '6px' }}>✓</div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#16a34a' }}>{documentName}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{planText.length.toLocaleString()} characters extracted · click to replace</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '32px', marginBottom: '8px' }}>📄</div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>Drop a plan here or click to upload</div>
                        <div style={{ fontSize: '12px', color: '#94a3b8' }}>PDF, DOCX, or TXT</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {inputMode === 'paste' && (
                <textarea
                  value={planText}
                  onChange={e => { setPlanText(e.target.value); if (!documentName) setDocumentName('Pasted Plan'); }}
                  placeholder="Paste the full treatment plan text here…"
                  rows={10}
                  style={{
                    width: '100%', padding: '12px', border: '1.5px solid #e2e8f0',
                    borderRadius: '8px', fontSize: '13px', resize: 'vertical',
                    fontFamily: 'inherit', lineHeight: '1.6', color: '#1e293b',
                    boxSizing: 'border-box', outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = '#2563eb'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
              )}
            </div>
          )}

          {/* History bar */}
          {checkHistory.length > 0 && !checking && (
            <div style={{ padding: '8px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '8px', overflowX: 'auto', flexShrink: 0, alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap', fontWeight: '600' }}>HISTORY:</span>
              {checkHistory.map(c => (
                <button
                  key={c.id}
                  onClick={() => viewingCheck?.id === c.id ? (setViewingCheck(null), setFinalResult(''), setChatMessages([])) : handleViewHistory(c)}
                  style={{
                    padding: '4px 10px', borderRadius: '20px', border: '1px solid',
                    borderColor: viewingCheck?.id === c.id ? '#2563eb' : '#e2e8f0',
                    background: viewingCheck?.id === c.id ? '#eff6ff' : '#fff',
                    color: viewingCheck?.id === c.id ? '#2563eb' : '#374151',
                    fontSize: '12px', whiteSpace: 'nowrap', cursor: 'pointer',
                  }}
                >
                  {c.document_name || 'Plan'} · {c.template_name} · {new Date(c.created_at).toLocaleDateString()}
                </button>
              ))}
            </div>
          )}

          {/* Result area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
            {!activeResult && !checking && (
              <div style={{ textAlign: 'center', paddingTop: '60px', color: '#94a3b8' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>📋</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  {templates.length === 0
                    ? 'An admin needs to add insurance templates first'
                    : planText ? 'Ready — click Run Compliance Check' : 'Upload or paste a plan to get started'}
                </div>
                {templates.length > 0 && !planText && (
                  <div style={{ fontSize: '13px' }}>Drop a PDF/DOCX or paste the plan text, select an insurance template, then run the check.</div>
                )}
              </div>
            )}
            {checking && !streamingResult && (
              <div style={{ color: '#94a3b8', fontSize: '14px', fontStyle: 'italic' }}>Reviewing plan against insurance rules…</div>
            )}
            {activeResult && (
              <div>
                {viewingCheck && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '8px 12px', background: '#eff6ff', borderRadius: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>Viewing past check:</span>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      {viewingCheck.document_name && `${viewingCheck.document_name} · `}{viewingCheck.template_name} · {new Date(viewingCheck.created_at).toLocaleString()}
                    </span>
                    <button onClick={() => { setViewingCheck(null); setChatMessages([]); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>✕ Close</button>
                  </div>
                )}
                {(finalResult || streamingResult) && (
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
                    <button
                      onClick={clearPlan}
                      style={{ padding: '6px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', color: '#374151', cursor: 'pointer', fontWeight: '600' }}
                    >
                      ← Check Another Plan
                    </button>
                  </div>
                )}
                <ComplianceResult text={activeResult} />
                <div ref={resultEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Right: Chat (40%) */}
        <div style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
          <div style={{ padding: '13px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>Compliance Chat</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '1px' }}>
              {activeResult ? 'Ask about failures, request fix text, or draft a report' : 'Run a check first to enable chat'}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {!activeResult && (
              <div style={{ fontSize: '13px', color: '#94a3b8', paddingTop: '20px' }}>
                After running a compliance check, you can chat here to get help with specific failures, have Claude draft corrective text, or generate a summary report of what's missing.
              </div>
            )}
            {activeResult && chatMessages.length === 0 && !chatSending && (
              <div>
                <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>Ask about the results or request help fixing issues:</p>
                {[
                  'What are the most critical failures I need to fix?',
                  'Draft corrective text for the failed requirements',
                  'Write a report summarizing what\'s missing',
                  'Which failures would cause an immediate denial?',
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => { setChatInput(prompt); chatInputRef.current?.focus(); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '9px 13px', marginBottom: '8px',
                      background: '#f1f5f9', border: '1px solid #e2e8f0',
                      borderRadius: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                    onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
            {chatMessages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
            {chatSending && streamingChat && (
              <ChatBubble msg={{ role: 'assistant', content: streamingChat }} />
            )}
            {chatSending && !streamingChat && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '10px' }}>
                <div style={{ background: '#f1f5f9', borderRadius: '12px 12px 12px 2px' }}>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: '14px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px', flexShrink: 0, background: '#fff' }}>
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={handleChatKey}
              disabled={!activeResult}
              placeholder={activeResult ? 'Ask about the compliance results…' : 'Run a check first…'}
              rows={3}
              style={{
                flex: 1, padding: '10px 13px',
                border: '1.5px solid #e2e8f0', borderRadius: '8px',
                fontSize: '13px', resize: 'none', outline: 'none',
                fontFamily: 'inherit', color: '#0f172a', lineHeight: '1.5',
                background: activeResult ? '#fff' : '#f8fafc',
              }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
            <button
              onClick={handleChatSend}
              disabled={!chatInput.trim() || chatSending || !activeResult}
              style={{
                padding: '10px 16px',
                background: !chatInput.trim() || chatSending || !activeResult ? '#93c5fd' : '#2563eb',
                border: 'none', borderRadius: '8px', color: '#fff',
                fontSize: '13px', fontWeight: '600',
                cursor: !chatInput.trim() || chatSending || !activeResult ? 'not-allowed' : 'pointer',
                alignSelf: 'flex-end', whiteSpace: 'nowrap',
              }}
            >
              {chatSending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
