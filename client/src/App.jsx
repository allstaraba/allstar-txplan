import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import GeneratePlan from './pages/GeneratePlan.jsx';
import ReviewRevise from './pages/ReviewRevise.jsx';
import EditTemplate from './pages/EditTemplate.jsx';
import VersionHistory from './pages/VersionHistory.jsx';
import ManageUsers from './pages/ManageUsers.jsx';
import PlanHistory from './pages/PlanHistory.jsx';
import ClientRecords from './pages/ClientRecords.jsx';
import ClientProfile from './pages/ClientProfile.jsx';
import ActivityLog from './pages/ActivityLog.jsx';
import { getMe, logout, generatePlan, getPlan, getGenerationStatus } from './api.js';

const styles = {
  layout: {
    display: 'flex',
    height: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    overflow: 'hidden',
  },
  sidebar: {
    width: '220px',
    minWidth: '220px',
    background: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
    color: '#fff',
    overflow: 'hidden',
  },
  sidebarHeader: {
    padding: '24px 20px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '4px',
  },
  starIcon: {
    fontSize: '22px',
    color: '#fbbf24',
  },
  brandName: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#fff',
    letterSpacing: '0.01em',
  },
  brandSub: {
    fontSize: '11px',
    color: '#94a3b8',
    marginLeft: '32px',
    lineHeight: 1.3,
  },
  nav: {
    flex: 1,
    padding: '12px 0',
    overflowY: 'auto',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 20px',
    color: '#94a3b8',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.15s',
    cursor: 'pointer',
    borderLeft: '3px solid transparent',
  },
  navItemActive: {
    color: '#fff',
    background: 'rgba(37, 99, 235, 0.18)',
    borderLeft: '3px solid #2563eb',
  },
  sidebarFooter: {
    padding: '16px 20px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  userInfo: {
    marginBottom: '12px',
  },
  userName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#e2e8f0',
  },
  userRole: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '2px',
  },
  signOutBtn: {
    width: '100%',
    padding: '8px 12px',
    background: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    borderRadius: '6px',
    color: '#f87171',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    background: '#f8fafc',
    overflowY: 'auto',
  },
};

function Layout({ user, onLogout, currentPlan, setCurrentPlan, injectedText, setInjectedText }) {
  const navigate = useNavigate();
  // generatingPlans: Map<genId, { text, status, section, total, label, error, clientName }>
  const [generatingPlans, setGeneratingPlans] = useState(new Map());
  const [activeGenId, setActiveGenId] = useState(null);
  const [regenJob, setRegenJob] = useState(null); // null or { clientName, chars }
  const abortControllersRef = useRef(new Map());
  const genCounterRef = useRef(0);
  const pollIntervalRef = useRef(null);
  const pollCancelledRef = useRef(false);

  // startServerPolling: switch to polling mode when the SSE connection drops mid-generation.
  // Used both on page mount (to recover from a refresh) and when the SSE stream fails.
  // genId: the local genId to update (or 'server-reconnect' for mount-time recovery).
  const startServerPolling = (genId) => {
    if (pollIntervalRef.current) return; // already polling
    pollCancelledRef.current = false;

    const POLL_ID = genId;

    pollIntervalRef.current = setInterval(async () => {
      if (pollCancelledRef.current) return;
      try {
        const updated = await getGenerationStatus();
        if (pollCancelledRef.current) return;
        if (updated.status === 'running') {
          setGeneratingPlans(prev => {
            const next = new Map(prev);
            const cur = next.get(POLL_ID);
            if (!cur) return prev;
            next.set(POLL_ID, { ...cur, status: 'running', section: updated.section || cur.section, label: updated.label || cur.label });
            return next;
          });
        } else if (updated.status === 'done') {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          try {
            const planData = await getPlan(updated.planId);
            const revs = planData.revisions;
            const planText = revs && revs.length > 0 ? revs[revs.length - 1].text : '';
            setCurrentPlan({ plan_id: updated.planId, text: planText, client_name: updated.clientName });
          } catch {}
          setGeneratingPlans(prev => { const next = new Map(prev); next.delete(POLL_ID); return next; });
          setActiveGenId(null);
        } else {
          // idle or error — stop polling
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          if (updated.status === 'error') {
            setGeneratingPlans(prev => {
              const next = new Map(prev);
              const cur = next.get(POLL_ID);
              if (cur) next.set(POLL_ID, { ...cur, status: 'error', error: updated.error || 'Generation failed' });
              return next;
            });
          } else {
            setGeneratingPlans(prev => { const next = new Map(prev); next.delete(POLL_ID); return next; });
            setActiveGenId(null);
          }
        }
      } catch {}
    }, 3000);
  };

  // On mount, check if there's an in-progress generation for this user on the server.
  // This handles page refresh / browser close / navigation away mid-generation.
  useEffect(() => {
    const RECONNECT_GEN_ID = 'server-reconnect';

    async function checkServerJob() {
      try {
        const job = await getGenerationStatus();
        if (pollCancelledRef.current) return;
        if (job.status === 'running') {
          setGeneratingPlans(prev => {
            const next = new Map(prev);
            if (!next.has(RECONNECT_GEN_ID)) {
              next.set(RECONNECT_GEN_ID, {
                text: '', status: 'running',
                section: job.section || 1, total: job.total || 4,
                label: job.label || 'Generating…',
                error: null, clientName: job.clientName || '',
                reconnected: true,
              });
            }
            return next;
          });
          setActiveGenId(RECONNECT_GEN_ID);
          startServerPolling(RECONNECT_GEN_ID);
        }
      } catch {}
    }

    checkServerJob();
    return () => {
      pollCancelledRef.current = true;
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    await logout();
    localStorage.removeItem('allstar_token');
    onLogout();
    navigate('/login');
  };

  const stopGeneration = (genId) => {
    const ctrl = abortControllersRef.current.get(genId);
    if (ctrl) {
      ctrl.abort();
      abortControllersRef.current.delete(genId);
    }
    setGeneratingPlans(prev => {
      const next = new Map(prev);
      next.delete(genId);
      return next;
    });
    setActiveGenId(prev => prev === genId ? null : prev);
  };

  const updateGen = (genId, updater) => {
    setGeneratingPlans(prev => {
      const next = new Map(prev);
      const cur = next.get(genId);
      if (!cur) return prev;
      next.set(genId, typeof updater === 'function' ? updater(cur) : { ...cur, ...updater });
      return next;
    });
  };

  // Start generation at Layout level so it survives page navigation
  const startGeneration = async (notes, uploadedFileIds = []) => {
    const genId = ++genCounterRef.current;
    const initEntry = { text: '', status: 'running', section: 1, total: 4, label: 'Client Info & Narrative', error: null, clientName: '' };
    setGeneratingPlans(prev => new Map(prev).set(genId, initEntry));
    setActiveGenId(genId);
    navigate('/review');

    const controller = new AbortController();
    abortControllersRef.current.set(genId, controller);

    let accumulated = '';
    try {
      const data = await generatePlan(
        notes,
        {},
        (chunk) => {
          accumulated += chunk;
          updateGen(genId, prev => ({ ...prev, text: accumulated }));
        },
        ({ section, total, label }) => {
          updateGen(genId, prev => ({ ...prev, section, total, label }));
        },
        controller.signal,
        uploadedFileIds
      );
      // Fetch from DB to get the boilerplate-injected text (markers replaced)
      let planText = accumulated;
      try {
        const planData = await getPlan(data.plan_id);
        const revs = planData.revisions;
        if (revs && revs.length > 0) planText = revs[revs.length - 1].text;
      } catch { /* use accumulated */ }
      setCurrentPlan({ plan_id: data.plan_id, text: planText, client_name: data.client_name });
      setGeneratingPlans(prev => {
        const next = new Map(prev);
        next.delete(genId);
        return next;
      });
      setActiveGenId(null);
    } catch (err) {
      if (err.name === 'AbortError') {
        setGeneratingPlans(prev => { const next = new Map(prev); next.delete(genId); return next; });
        setActiveGenId(prev => prev === genId ? null : prev);
      } else {
        // SSE connection dropped (network error / proxy timeout). Check if the server
        // is still generating — if so, switch to polling mode instead of showing an error.
        try {
          const job = await getGenerationStatus();
          if (job.status === 'running') {
            updateGen(genId, prev => ({ ...prev, status: 'running', label: job.label || prev.label, reconnected: true }));
            startServerPolling(genId);
          } else if (job.status === 'done') {
            // Generation finished just as the connection dropped — load the plan
            try {
              const planData = await getPlan(job.planId);
              const revs = planData.revisions;
              const planText = revs && revs.length > 0 ? revs[revs.length - 1].text : '';
              setCurrentPlan({ plan_id: job.planId, text: planText, client_name: job.clientName });
            } catch {}
            setGeneratingPlans(prev => { const next = new Map(prev); next.delete(genId); return next; });
            setActiveGenId(null);
          } else {
            updateGen(genId, prev => ({ ...prev, status: 'error', error: err.message }));
          }
        } catch {
          updateGen(genId, prev => ({ ...prev, status: 'error', error: err.message }));
        }
      }
    } finally {
      abortControllersRef.current.delete(genId);
    }
  };

  const navLinks = [
    { to: '/generate', icon: '✦', label: 'Generate Plan' },
    { to: '/review', icon: '◈', label: 'Review & Revise' },
    { to: '/clients', icon: '◎', label: 'Client Records' },
    { to: '/plans', icon: '☰', label: 'Plan History' },
    ...(user.role === 'Admin' ? [{ to: '/template', icon: '⊞', label: 'Edit Template' }] : []),
    { to: '/history', icon: '◷', label: 'Version History' },
    ...(user.role === 'Admin' ? [
      { to: '/users', icon: '◉', label: 'Manage Users' },
      { to: '/activity', icon: '◑', label: 'Activity Log' },
    ] : []),
  ];

  return (
    <div style={styles.layout}>
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={styles.brandRow}>
            <span style={styles.starIcon}>★</span>
            <span style={styles.brandName}>All Star ABA</span>
          </div>
          <div style={styles.brandSub}>Treatment Plan Generator</div>
        </div>
        <nav style={styles.nav}>
          {navLinks.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              style={({ isActive }) => ({
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              })}
            >
              <span style={{ fontSize: '16px' }}>{link.icon}</span>
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* Persistent regeneration card */}
        {regenJob && (
          <div style={{
            margin: '0 12px 8px',
            padding: '10px 12px',
            background: 'rgba(124,58,237,0.18)',
            border: '1px solid rgba(124,58,237,0.4)',
            borderRadius: '8px',
            cursor: 'pointer',
          }} onClick={() => navigate('/review')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <span style={{
                display: 'inline-block', width: '10px', height: '10px',
                border: '2px solid rgba(255,255,255,0.25)', borderTopColor: '#c4b5fd',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0,
              }} />
              <span style={{ fontSize: '11px', color: '#c4b5fd', fontWeight: '600', flex: 1 }}>
                Regenerating Plan
              </span>
            </div>
            {regenJob.clientName && (
              <div style={{ fontSize: '10px', color: '#a78bfa', marginBottom: '5px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {regenJob.clientName}
              </div>
            )}
            <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginBottom: '6px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: '45%',
                background: 'linear-gradient(90deg, #7c3aed, #c4b5fd)',
                borderRadius: '2px', animation: 'slidebar 1.6s ease-in-out infinite',
              }} />
            </div>
            <div style={{ fontSize: '10px', color: '#a78bfa', lineHeight: 1.4 }}>
              Applying all chat changes…
              {regenJob.chars > 500 && (
                <span style={{ opacity: 0.75 }}> · {Math.round(regenJob.chars / 1000)}k chars</span>
              )}
              <br />
              <span style={{ color: '#c4b5fd', opacity: 0.7 }}>Click to watch progress</span>
            </div>
          </div>
        )}

        {/* Persistent generation cards — one per active generation */}
        {[...generatingPlans.entries()].map(([genId, gen]) => {
          const pct = Math.round(((gen.section - 1) / gen.total) * 100);
          const isActive = genId === activeGenId;
          return (
            <div key={genId} style={{
              margin: '0 12px 8px',
              padding: '10px 12px',
              background: gen.status === 'error' ? 'rgba(239,68,68,0.15)' : (isActive ? 'rgba(37,99,235,0.25)' : 'rgba(37,99,235,0.13)'),
              border: `1px solid ${gen.status === 'error' ? 'rgba(239,68,68,0.3)' : (isActive ? 'rgba(37,99,235,0.5)' : 'rgba(37,99,235,0.28)')}`,
              borderRadius: '8px',
              cursor: 'pointer',
            }} onClick={() => { setActiveGenId(genId); navigate('/review'); }}>
              {gen.status === 'running' ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                    <span style={{
                      display: 'inline-block', width: '10px', height: '10px',
                      border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#60a5fa',
                      borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '11px', color: '#93c5fd', fontWeight: '600', flex: 1 }}>
                      Generating Plan #{genId}
                    </span>
                    <span style={{ fontSize: '10px', color: '#60a5fa' }}>{pct}%</span>
                  </div>
                  {/* 0–100% progress bar */}
                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginBottom: '5px' }}>
                    <div style={{
                      height: '100%', width: `${pct}%`,
                      background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
                      borderRadius: '2px', transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: '10px', color: '#60a5fa', lineHeight: 1.3, marginBottom: '7px' }}>
                    Section {gen.section}/{gen.total} — {gen.label}<br />
                    <span style={{ color: '#93c5fd', opacity: 0.7 }}>Click to watch progress</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); stopGeneration(genId); }}
                    style={{
                      width: '100%', padding: '4px 0',
                      background: 'rgba(239,68,68,0.18)',
                      border: '1px solid rgba(239,68,68,0.35)',
                      borderRadius: '5px', color: '#fca5a5',
                      fontSize: '11px', fontWeight: '600', cursor: 'pointer',
                    }}
                  >
                    ✕ Stop
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: '#fca5a5' }}>
                  Plan #{genId} failed. {gen.error}
                </div>
              )}
            </div>
          );
        })}

        <div style={styles.sidebarFooter}>
          <div style={styles.userInfo}>
            <div style={styles.userName}>{user.username}</div>
            <div style={styles.userRole}>{user.role}</div>
          </div>
          <button style={styles.signOutBtn} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>
      <main style={styles.content}>
        <Routes>
          <Route path="/generate" element={<GeneratePlan onGenerate={startGeneration} isGenerating={generatingPlans.size > 0} />} />
          <Route path="/review" element={<ReviewRevise user={user} currentPlan={currentPlan} setCurrentPlan={setCurrentPlan} injectedText={injectedText} setInjectedText={setInjectedText} generatingPlan={activeGenId != null ? generatingPlans.get(activeGenId) ?? null : null} onRegeneratingChange={(active, clientName = '') => { if (active) setRegenJob({ clientName, chars: 0 }); else setRegenJob(null); }} onRegenChunk={(text) => setRegenJob(prev => prev ? { ...prev, chars: prev.chars + text.length } : prev)} />} />
          <Route path="/clients" element={<ClientRecords />} />
          <Route path="/clients/:id" element={<ClientProfile currentPlan={currentPlan} setCurrentPlan={setCurrentPlan} injectedText={injectedText} setInjectedText={setInjectedText} onRegeneratingChange={(active, clientName = '') => { if (active) setRegenJob({ clientName, chars: 0 }); else setRegenJob(null); }} onRegenChunk={(text) => setRegenJob(prev => prev ? { ...prev, chars: prev.chars + text.length } : prev)} />} />
          <Route path="/plans" element={<PlanHistory setCurrentPlan={setCurrentPlan} />} />
          <Route path="/template" element={<EditTemplate user={user} />} />
          <Route path="/history" element={<VersionHistory />} />
          {user.role === 'Admin' && <Route path="/users" element={<ManageUsers user={user} />} />}
          {user.role === 'Admin' && <Route path="/activity" element={<ActivityLog />} />}
          <Route path="*" element={<Navigate to="/generate" replace />} />
        </Routes>
      </main>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slidebar { 0% { transform: translateX(-150%); } 100% { transform: translateX(280%); } }
      `}</style>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [injectedText, setInjectedText] = useState('');

  // Persist currentPlan in localStorage so it survives page refreshes
  const [currentPlan, setCurrentPlanState] = useState(() => {
    try {
      const saved = localStorage.getItem('allstar_current_plan');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const setCurrentPlan = (plan) => {
    setCurrentPlanState(plan);
    if (plan) {
      localStorage.setItem('allstar_current_plan', JSON.stringify(plan));
    } else {
      localStorage.removeItem('allstar_current_plan');
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('allstar_token');
    if (token) {
      getMe()
        .then(u => setUser(u))
        .catch(() => {
          localStorage.removeItem('allstar_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ color: '#94a3b8', fontSize: '16px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/generate" replace /> : <Login onLogin={u => setUser(u)} />}
        />
        <Route
          path="/*"
          element={
            user
              ? <Layout user={user} onLogout={() => setUser(null)} currentPlan={currentPlan} setCurrentPlan={setCurrentPlan} injectedText={injectedText} setInjectedText={setInjectedText} />
              : <Navigate to="/login" replace />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
