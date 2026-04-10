import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPlanRevisions, revisePlan, getExportUrl } from '../api.js';

// ── Plan text renderer ──────────────────────────────────────────────────────────

function parsePipeRows(content) {
  const rows = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    rows.push(t.split('|').map(c => c.trim()));
  }
  return rows;
}

const TWO_COL_TABLES = new Set([
  'client_info', 'family_structure', 'medical_history',
  'school_placement', 'aba_history', 'other_mental_health',
  'other_services', 'coordination_table', 'major_life_changes', 'provider_info',
]);

function TableBlock({ name, content }) {
  const rows = parsePipeRows(content);
  if (rows.length === 0) return null;
  const isTwoCol = TWO_COL_TABLES.has(name);
  const hasHeader = !isTwoCol && rows.length > 1;
  const tdStyle = { border: '1px solid #cbd5e1', padding: '6px 10px', fontSize: '13px', verticalAlign: 'top', lineHeight: '1.5' };
  return (
    <div style={{ marginBottom: '14px', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <tbody>
          {rows.map((row, ri) => {
            const isHeaderRow = hasHeader && ri === 0;
            return (
              <tr key={ri} style={{ background: isHeaderRow ? '#f1f5f9' : (ri % 2 === 1 && !isTwoCol ? '#fafafa' : 'white') }}>
                {row.map((cell, ci) => {
                  const isLabel = isTwoCol && ci === 0;
                  const colWidth = isTwoCol ? (ci === 0 ? '35%' : '65%') : undefined;
                  const parts = cell.split(/\\n|\n/);
                  return (
                    <td key={ci} style={{ ...tdStyle, fontWeight: isHeaderRow || isLabel ? '600' : 'normal', width: colWidth }}>
                      {parts.map((p, pi) => <span key={pi}>{p}{pi < parts.length - 1 && <br />}</span>)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GoalBlock({ name, content }) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const ratLines = [];
  let goalStat = '', baseline = '', dateIntro = '', projMastery = '', progressData = '';
  for (const line of lines) {
    if (line.startsWith('Medical Necessity Rationale') || line.startsWith('A.') || line.startsWith('B.') || line.startsWith('C.') || line.startsWith('●') || line.startsWith('•') || line.startsWith('-')) {
      ratLines.push(line);
    } else if (/^\d+\.\s*Goal Statement:/i.test(line) || /^goal statement:/i.test(line)) { goalStat = line; }
    else if (/^baseline:/i.test(line)) { baseline = line; }
    else if (/^date of introduction:/i.test(line)) { dateIntro = line; }
    else if (/^projected mastery:/i.test(line)) { projMastery = line; }
    else if (/^progress data:/i.test(line)) { progressData = line; }
    else { ratLines.push(line); }
  }
  const renderLabeled = (text, key) => {
    const ci = text.indexOf(':');
    if (ci === -1) return <div key={key} style={{ marginBottom: '4px' }}>{text}</div>;
    return <div key={key} style={{ marginBottom: '4px' }}><span style={{ fontWeight: '600' }}>{text.slice(0, ci + 1)}</span>{' ' + text.slice(ci + 1).trim()}</div>;
  };
  return (
    <div style={{ marginBottom: '18px', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#fafafa' }}>
      <div style={{ fontWeight: '700', marginBottom: '8px', color: '#1e40af' }}>Goal {name}</div>
      {ratLines.map((line, i) => {
        if (line.startsWith('Medical Necessity Rationale')) return <div key={i} style={{ fontWeight: '600', marginBottom: '4px' }}>{line}</div>;
        if (line.startsWith('●') || line.startsWith('•') || line.startsWith('-')) return <div key={i} style={{ paddingLeft: '16px', marginBottom: '3px' }}>{line}</div>;
        return <div key={i} style={{ marginBottom: '3px' }}>{line}</div>;
      })}
      {goalStat && renderLabeled(goalStat, 'gs')}
      {baseline && renderLabeled(baseline, 'bl')}
      {dateIntro && renderLabeled(dateIntro, 'di')}
      {projMastery && renderLabeled(projMastery, 'pm')}
      {progressData && renderLabeled(progressData, 'pd')}
    </div>
  );
}

function BipBlock({ name, content }) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const knownFields = ['Date:', 'Behavior Assessment:', 'Target Behavior:', 'Operational Definition:', 'Quantitative Baseline Data:', 'Hypothesized Function:', 'Functionally Equivalent Replacement Behaviors:', 'Antecedent Interventions:', 'Consequence Interventions:', 'De-escalation Procedures:'];
  const fields = [];
  let currentField = null, currentLines = [];
  const flush = () => { if (currentField !== null) { fields.push({ label: currentField, lines: [...currentLines] }); currentLines = []; } };
  for (const line of lines) {
    let matched = false;
    for (const f of knownFields) {
      if (line.toLowerCase().startsWith(f.toLowerCase())) {
        flush(); currentField = f.replace(/:$/, '');
        const rest = line.slice(f.length).trim();
        if (rest) currentLines.push(rest);
        matched = true; break;
      }
    }
    if (!matched) currentLines.push(line);
  }
  flush();
  const tdStyle = { border: '1px solid #cbd5e1', padding: '6px 10px', fontSize: '13px', verticalAlign: 'top', lineHeight: '1.5' };
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontWeight: '700', fontSize: '13.5px', marginBottom: '6px', color: '#0f172a' }}>Behavior Intervention Plan: {name}</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <tbody>
          {fields.map((f, i) => (
            <tr key={i}>
              <td style={{ ...tdStyle, fontWeight: '600', width: '30%', background: '#f8fafc' }}>{f.label}</td>
              <td style={{ ...tdStyle, width: '70%' }}>
                {f.lines.map((line, li) => (
                  <div key={li} style={line.startsWith('●') || line.startsWith('•') || line.startsWith('-') ? { paddingLeft: '14px' } : {}}>{line}</div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FadingPhaseBlock({ name, content }) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontWeight: '600', marginBottom: '5px' }}>Phase {name}</div>
      {lines.map((line, i) => (
        <div key={i} style={{ paddingLeft: (line.startsWith('●') || line.startsWith('•') || line.startsWith('-')) ? '16px' : '0', marginBottom: '3px' }}>{line}</div>
      ))}
    </div>
  );
}

function CrisisRowBlock({ content }) {
  const rows = parsePipeRows(content);
  if (rows.length === 0) return null;
  const tdStyle = { border: '1px solid #cbd5e1', padding: '6px 10px', fontSize: '13px', verticalAlign: 'top' };
  return (
    <div style={{ marginBottom: '14px', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri === 0 ? '#f1f5f9' : 'white' }}>
              {row.map((cell, ci) => <td key={ci} style={{ ...tdStyle, fontWeight: ri === 0 ? '600' : 'normal' }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextBlock({ content }) {
  const lines = content.split('\n');
  const elements = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { elements.push(<div key={i} style={{ height: '6px' }} />); continue; }
    const secMatch = t.match(/^\[SECTION:([^\]]+)\](.*)$/);
    if (secMatch) {
      const heading = secMatch[2].trim();
      if (heading) elements.push(<div key={i} style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a', textTransform: 'uppercase', marginTop: '14px', marginBottom: '5px', borderBottom: '1.5px solid #e2e8f0', paddingBottom: '3px' }}>{heading}</div>);
      continue;
    }
    if (/^\[\/?\w+\]$/.test(t)) continue;
    if (t.startsWith('# ')) { elements.push(<div key={i} style={{ fontWeight: '800', fontSize: '16px', textAlign: 'center', marginBottom: '8px', marginTop: '8px' }}>{t.slice(2)}</div>); }
    else if (t.startsWith('## ')) { elements.push(<div key={i} style={{ fontWeight: '700', fontSize: '14px', textTransform: 'uppercase', marginTop: '14px', marginBottom: '5px', borderBottom: '1.5px solid #e2e8f0', paddingBottom: '3px', color: '#0f172a' }}>{t.slice(3)}</div>); }
    else if (t.startsWith('### ')) { elements.push(<div key={i} style={{ fontWeight: '600', fontSize: '13.5px', marginTop: '10px', marginBottom: '4px' }}>{t.slice(4)}</div>); }
    else if (t.startsWith('●') || t.startsWith('•') || t.startsWith('- ')) { elements.push(<div key={i} style={{ paddingLeft: '18px', marginBottom: '3px' }}>{t}</div>); }
    else { elements.push(<div key={i} style={{ marginBottom: '4px' }}>{t}</div>); }
  }
  return <>{elements}</>;
}

function SectionBlock({ name, content }) {
  const headingMap = {
    title: null, review_checkbox: null,
    client_info: 'Client Information', biopsychosocial: 'Biopsychosocial Information',
    family_structure: 'Current Family Structure', medications: 'Medications',
    medical_history: 'Medical History', school_placement: 'School Placement',
    aba_history: 'History of ABA Services', other_mental_health: 'Other Mental Health Services',
    other_services: 'Other Services', coordination: 'Coordination of Care',
    coordination_table: null, major_life_changes: 'Major Life Changes',
    narrative: 'Narrative', strengths_challenges: 'Strengths, Challenges & Severity',
    standardized_assessment: 'Standardized Assessment', criterion_assessment: 'Criterion-Referenced Assessment',
    goal_summary: 'Goal Objective Summary', response_to_treatment: 'Response to Treatment',
    skill_acquisition: 'Skill Acquisition Goals', bips: 'Behavior Intervention Plans',
    behavior_reduction: 'Behavior Reduction Goals', parent_training: 'Parent or Caregiver Training',
    generalization: 'Generalization Plan', fading: 'Transition and Fading Plan',
    discharge: 'Discharge Criteria', crisis: 'Crisis Plan',
    recommendations: 'Recommendations for ABA Services', cpt_codes: 'CPT Codes',
    provider_info: 'Provider Information', consent: 'Consent',
  };
  const heading = headingMap[name];
  const trimmedContent = (content || '').trim();
  return (
    <div style={{ marginTop: '18px' }}>
      {heading && <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a', textTransform: 'uppercase', marginBottom: '6px', borderBottom: '1.5px solid #e2e8f0', paddingBottom: '4px' }}>{heading}</div>}
      {trimmedContent && <TextBlock content={trimmedContent} />}
    </div>
  );
}

function renderPlanText(planText) {
  if (!planText) return null;
  if (!/\[\w+:[^\]]*\]/.test(planText)) {
    return <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif', fontSize: '13.5px', lineHeight: '1.7', color: '#1e293b' }}>{planText}</div>;
  }
  const segments = [];
  const blockRegex = /\[(\w+):([^\]]*)\]([\s\S]*?)\[\/\1\]/g;
  let last = 0, m;
  while ((m = blockRegex.exec(planText)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: planText.slice(last, m.index) });
    segments.push({ type: m[1].toUpperCase(), name: m[2].trim(), content: m[3] });
    last = blockRegex.lastIndex;
  }
  if (last < planText.length) segments.push({ type: 'text', content: planText.slice(last) });
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13.5px', lineHeight: '1.7', color: '#1e293b' }}>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case 'SECTION': return <SectionBlock key={i} name={seg.name} content={seg.content} />;
          case 'TABLE': return <TableBlock key={i} name={seg.name} content={seg.content} />;
          case 'GOAL': return <GoalBlock key={i} name={seg.name} content={seg.content} />;
          case 'BIP': return <BipBlock key={i} name={seg.name} content={seg.content} />;
          case 'FADING_PHASE': return <FadingPhaseBlock key={i} name={seg.name} content={seg.content} />;
          case 'CRISIS_ROW': return <CrisisRowBlock key={i} content={seg.content} />;
          default: return <TextBlock key={i} content={seg.content} />;
        }
      })}
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  "Change goal 5 to target 2-step directions",
  "Add a mouthing crisis protocol",
  "He also signs 'more' and 'eat'",
  "Phase 1 fading should include toileting",
];

export default function ReviewRevise({ currentPlan, setCurrentPlan, injectedText, setInjectedText }) {
  const [revisions, setRevisions] = useState([]);
  const [selectedRevIdx, setSelectedRevIdx] = useState(0);
  // messages = [{role:'user'|'assistant', text:'...'}]
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // When injectedText arrives, put it in the input
  useEffect(() => {
    if (injectedText) {
      setInput(injectedText);
      if (setInjectedText) setInjectedText('');
      inputRef.current?.focus();
    }
  }, [injectedText]);

  // Load revisions when plan changes
  useEffect(() => {
    if (currentPlan?.plan_id) {
      setMessages([]);
      setError('');
      getPlanRevisions(currentPlan.plan_id)
        .then(revs => {
          setRevisions(revs);
          setSelectedRevIdx(revs.length - 1);
        })
        .catch(err => setError(err.message));
    }
  }, [currentPlan?.plan_id]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Keep input focused after sends
  useEffect(() => {
    if (!sending) {
      inputRef.current?.focus();
    }
  }, [sending]);

  if (!currentPlan) {
    return (
      <div style={{ padding: '60px 32px', textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
        <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
          No plan loaded
        </h2>
        <p style={{ marginBottom: '24px' }}>Go to Generate Plan to create one, or open a plan from Plan History.</p>
        <button
          onClick={() => navigate('/generate')}
          style={{ padding: '10px 24px', background: '#2563eb', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
        >
          Go to Generate Plan
        </button>
      </div>
    );
  }

  const selectedRevision = revisions[selectedRevIdx];
  // Strip delimiter markers for display — they're only needed by the docx builder
  const planText = (selectedRevision?.text || '').replace(
    /\[(SECTION|TABLE|\/TABLE|GOAL|\/GOAL|BIP|\/BIP|FADING_PHASE|\/FADING_PHASE|CRISIS_ROW|\/CRISIS_ROW):[^\]]*\]/g,
    ''
  ).replace(/^\n{3,}/gm, '\n\n').trim();

  const handleSend = async () => {
    const userMsg = input.trim();
    if (!userMsg || sending) return;

    setInput('');
    setError('');
    setSending(true);
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);

    // Build a streaming revision directly into the revisions list so the
    // left panel updates in real-time as Claude types
    const streamingRevId = Date.now();
    let streamingText = '';

    // Add a placeholder revision so the dropdown + left panel shows live text
    const pendingRev = { id: streamingRevId, revision_number: '…', feedback: userMsg, text: '' };
    setRevisions(prev => {
      const next = [...prev, pendingRev];
      setSelectedRevIdx(next.length - 1);
      return next;
    });

    try {
      const data = await revisePlan(currentPlan.plan_id, userMsg, (chunk) => {
        streamingText += chunk;
        setRevisions(prev => prev.map(r =>
          r.id === streamingRevId ? { ...r, text: streamingText } : r
        ));
      });

      // Replace placeholder with the real saved revision
      const updatedRevisions = await getPlanRevisions(currentPlan.plan_id);
      setRevisions(updatedRevisions);
      setSelectedRevIdx(updatedRevisions.length - 1);

      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: `Done — revision ${data.revision_number} saved.` },
      ]);
    } catch (err) {
      // Remove the failed streaming placeholder
      setRevisions(prev => prev.filter(r => r.id !== streamingRevId));
      setSelectedRevIdx(prev => Math.max(0, prev - 1));
      setError(err.message);
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleExampleClick = (prompt) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(planText).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const handleDownload = async () => {
    // Don't allow download while streaming (revision_number is '…')
    const revNum = selectedRevision?.revision_number;
    if (revNum === undefined || revNum === null || revNum === '…') {
      setError('Please wait for the revision to finish before downloading.');
      return;
    }
    const url = getExportUrl(currentPlan.plan_id, revNum);
    const token = localStorage.getItem('allstar_token');
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${currentPlan.client_name || 'treatment-plan'}-rev${revNum}.docx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError('Download failed: ' + err.message);
    }
  };

  const revisionLabel = (rev) => {
    if (rev.revision_number === 0) return 'Rev 0: Initial';
    const preview = rev.feedback ? rev.feedback.substring(0, 35) : '';
    return `Rev ${rev.revision_number}: ${preview}${rev.feedback?.length > 35 ? '…' : ''}`;
  };

  const btnBase = {
    padding: '7px 16px',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── Top Bar ── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '11px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a', flex: 1 }}>
          Review & Revise
          {currentPlan.client_name && currentPlan.client_name !== 'Unknown' && (
            <span style={{ color: '#64748b', fontWeight: '400', marginLeft: '8px', fontSize: '14px' }}>
              — {currentPlan.client_name}
            </span>
          )}
        </span>
        <button onClick={() => { setCurrentPlan(null); navigate('/generate'); }} style={{ ...btnBase, background: '#f1f5f9', color: '#374151' }}>
          + New Plan
        </button>
        <button onClick={handleCopy} style={{
          ...btnBase,
          background: copySuccess ? '#dcfce7' : '#f1f5f9',
          borderColor: copySuccess ? '#86efac' : '#e2e8f0',
          color: copySuccess ? '#16a34a' : '#374151',
        }}>
          {copySuccess ? '✓ Copied!' : 'Copy to Clipboard'}
        </button>
        <button onClick={handleDownload} style={{ ...btnBase, background: '#2563eb', border: 'none', color: '#fff' }}>
          Download .docx
        </button>
      </div>

      {/* ── Split View ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: Plan text */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{
            padding: '10px 20px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}>
            <label style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>Revision:</label>
            <select
              value={selectedRevIdx}
              onChange={e => setSelectedRevIdx(Number(e.target.value))}
              style={{ padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', color: '#0f172a', background: '#fff', cursor: 'pointer' }}
            >
              {revisions.map((rev, idx) => (
                <option key={rev.id} value={idx}>{revisionLabel(rev)}</option>
              ))}
            </select>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#94a3b8' }}>
              {revisions.length} revision{revisions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {planText
              ? renderPlanText(planText)
              : <span style={{ color: '#94a3b8' }}>No plan text yet.</span>}
          </div>
        </div>

        {/* Right: Chat */}
        <div style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>

          {/* Chat header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>Revision Chat</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              Enter key sends · Shift+Enter for new line
            </div>
          </div>

          {/* Messages area — scrollable, grows to fill space */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {messages.length === 0 ? (
              <div>
                <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px' }}>
                  Send feedback to revise the plan, or try an example:
                </p>
                {EXAMPLE_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleExampleClick(prompt)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 13px',
                      marginBottom: '8px',
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: '#374151',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                    onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '10px' }}>
                    <div style={{
                      maxWidth: '88%',
                      padding: '9px 13px',
                      borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: msg.role === 'user' ? '#2563eb' : '#f1f5f9',
                      color: msg.role === 'user' ? '#fff' : '#374151',
                      fontSize: '13px',
                      lineHeight: '1.5',
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '10px' }}>
                    <div style={{ padding: '9px 13px', borderRadius: '12px 12px 12px 2px', background: '#f1f5f9', fontSize: '13px', color: '#94a3b8' }}>
                      Revising plan…
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Error banner */}
          {error && (
            <div style={{ padding: '8px 20px', background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#dc2626', fontSize: '13px', flexShrink: 0 }}>
              {error}
            </div>
          )}

          {/* Input — always visible, never disabled */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px', flexShrink: 0, background: '#fff' }}>
            <textarea
              ref={inputRef}
              autoFocus
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell me what to change…"
              rows={3}
              style={{
                flex: 1,
                padding: '10px 13px',
                border: '1.5px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '13px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                color: '#0f172a',
                lineHeight: '1.5',
              }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              style={{
                padding: '10px 16px',
                background: sending || !input.trim() ? '#93c5fd' : '#2563eb',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                fontWeight: '600',
                cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                alignSelf: 'flex-end',
                whiteSpace: 'nowrap',
                transition: 'background 0.15s',
              }}
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
