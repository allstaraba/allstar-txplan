import React, { useState, useEffect } from 'react';
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
import { getMe, logout } from './api.js';

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

  const handleLogout = async () => {
    await logout();
    localStorage.removeItem('allstar_token');
    onLogout();
    navigate('/login');
  };

  const navLinks = [
    { to: '/generate', icon: '✦', label: 'Generate Plan' },
    { to: '/review', icon: '◈', label: 'Review & Revise' },
    { to: '/clients', icon: '◎', label: 'Client Records' },
    { to: '/plans', icon: '☰', label: 'Plan History' },
    { to: '/template', icon: '⊞', label: 'Edit Template' },
    { to: '/history', icon: '◷', label: 'Version History' },
    ...(user.role === 'Admin' ? [{ to: '/users', icon: '◉', label: 'Manage Users' }] : []),
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
          <Route path="/generate" element={<GeneratePlan setCurrentPlan={setCurrentPlan} />} />
          <Route path="/review" element={<ReviewRevise currentPlan={currentPlan} setCurrentPlan={setCurrentPlan} injectedText={injectedText} setInjectedText={setInjectedText} />} />
          <Route path="/clients" element={<ClientRecords />} />
          <Route path="/clients/:id" element={<ClientProfile currentPlan={currentPlan} setCurrentPlan={setCurrentPlan} injectedText={injectedText} setInjectedText={setInjectedText} />} />
          <Route path="/plans" element={<PlanHistory setCurrentPlan={setCurrentPlan} />} />
          <Route path="/template" element={<EditTemplate />} />
          <Route path="/history" element={<VersionHistory />} />
          {user.role === 'Admin' && <Route path="/users" element={<ManageUsers user={user} />} />}
          <Route path="*" element={<Navigate to="/generate" replace />} />
        </Routes>
      </main>
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
