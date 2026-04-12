import React, { useState, useEffect, useRef } from 'react';
import { getInsuranceTemplates, getComplianceChecks, runComplianceCheck, sendComplianceChatMessage, getPlans } from '../api.js';

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
        // Inline bold
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
      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} } @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ComplianceTool({ currentPlan, setCurrentPlan }) {
  // Plan + template selection
  const [plans, setPlans] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Check state
  const [checking, setChecking] = useState(false);
  const [streamingResult, setStreamingResult] = useState('');
  const [finalResult, setFinalResult] = useState('');    // saved after streaming completes
  const [checkHistory, setCheckHistory] = useState([]);
  const [viewingCheck, setViewingCheck] = useState(null);
  const [error, setError] = useState('');

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);  // [{role,content}]
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [streamingChat, setStreamingChat] = useState('');
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const resultEndRef = useRef(null);

  // Active result text — either the live streaming, the completed result, or the viewed history item
  const activeResult = viewingCheck ? viewingCheck.result_text : (finalResult || streamingResult);
  const activePlanId = selectedPlanId || (currentPlan?.plan_id ? String(currentPlan.plan_id) : '');

  useEffect(() => {
    Promise.all([getPlans(), getInsuranceTemplates()])
      .then(([p, t]) => {
        setPlans(p);
        setTemplates(t);
        if (t.length > 0) setSelectedTemplateId(String(t[0].id));
        // Pre-select current plan if one is loaded
        if (currentPlan?.plan_id) setSelectedPlanId(String(currentPlan.plan_id));
        else if (p.length > 0) setSelectedPlanId(String(p[0].id));
      })
      .catch(err => setError(err.message));
  }, []);

  // Load check history when plan selection changes
  useEffect(() => {
    if (!activePlanId) return;
    setViewingCheck(null);
    setFinalResult('');
    setStreamingResult('');
    setChatMessages([]);
    getComplianceChecks(activePlanId).then(setCheckHistory).catch(() => {});
  }, [activePlanId]);

  // Auto-scroll
  useEffect(() => { resultEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [streamingResult]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, streamingChat]);

  const handleRunCheck = async () => {
    if (!activePlanId || !selectedTemplateId || checking) return;
    setError('');
    setStreamingResult('');
    setFinalResult('');
    setViewingCheck(null);
    setChatMessages([]);
    setChecking(true);
    let accumulated = '';
    try {
      await runComplianceCheck(Number(activePlanId), Number(selectedTemplateId), (chunk) => {
        accumulated += chunk;
        setStreamingResult(accumulated);
      });
      setFinalResult(accumulated);
      setStreamingResult('');
      const checks = await getComplianceChecks(activePlanId);
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
        Number(activePlanId),
        result,
        newMessages,
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

  const selectedPlan = plans.find(p => String(p.id) === activePlanId);

  // ── Layout: left = controls + result, right = chat ────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Top bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a', marginRight: '4px' }}>Compliance Check</span>

        {/* Plan picker */}
        <select
          value={activePlanId}
          onChange={e => setSelectedPlanId(e.target.value)}
          disabled={checking}
          style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', color: '#0f172a', background: '#fff', maxWidth: '220px' }}
        >
          {plans.map(p => (
            <option key={p.id} value={String(p.id)}>{p.client_name || `Plan #${p.id}`}</option>
          ))}
        </select>

        {/* Template picker */}
        <select
          value={selectedTemplateId}
          onChange={e => setSelectedTemplateId(e.target.value)}
          disabled={checking || templates.length === 0}
          style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', color: '#0f172a', background: '#fff', maxWidth: '220px' }}
        >
          {templates.length === 0
            ? <option>No templates — admin must add one</option>
            : templates.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)
          }
        </select>

        <button
          onClick={handleRunCheck}
          disabled={checking || !activePlanId || !selectedTemplateId || templates.length === 0}
          style={{
            padding: '8px 20px', background: checking ? '#e2e8f0' : '#2563eb',
            border: 'none', borderRadius: '6px', color: checking ? '#94a3b8' : '#fff',
            fontSize: '13px', fontWeight: '600',
            cursor: checking ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {checking ? `Checking… ${streamingResult.length > 0 ? `· ${streamingResult.length.toLocaleString()} chars` : ''}` : 'Run Compliance Check'}
        </button>

        {error && (
          <span style={{ fontSize: '12px', color: '#dc2626', marginLeft: '8px' }}>{error}</span>
        )}
      </div>

      {/* Body: left (results) + right (chat) */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: result + history (60%) */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', overflow: 'hidden' }}>

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
                  {c.template_name} · {new Date(c.created_at).toLocaleDateString()}
                </button>
              ))}
            </div>
          )}

          {/* Result area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
            {!activeResult && !checking && (
              <div style={{ textAlign: 'center', paddingTop: '80px', color: '#94a3b8' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  {selectedPlan ? `Ready to check ${selectedPlan.client_name || `Plan #${selectedPlan.id}`}` : 'Select a plan and template'}
                </div>
                <div style={{ fontSize: '13px' }}>
                  {templates.length === 0
                    ? 'An admin needs to add insurance templates first.'
                    : 'Pick a plan and insurance template above, then click Run Compliance Check.'}
                </div>
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
                    <span style={{ fontSize: '12px', color: '#64748b' }}>{viewingCheck.template_name} · {new Date(viewingCheck.created_at).toLocaleString()}</span>
                    <button onClick={() => { setViewingCheck(null); setChatMessages([]); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>✕ Close</button>
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
                <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>
                  Ask about the results or request help fixing issues:
                </p>
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
