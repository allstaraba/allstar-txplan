import React, { useState, useEffect } from 'react';
import { getUsers, createUser, deleteUser } from '../api.js';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ManageUsers({ user: currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add user form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('BCBA');
  const [adding, setAdding] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    getUsers()
      .then(data => setUsers(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      setError('Username and password are required.');
      return;
    }
    setAdding(true);
    setError('');
    setSuccess('');
    try {
      await createUser(newUsername.trim(), newPassword, newRole);
      setSuccess(`User "${newUsername}" created.`);
      setNewUsername('');
      setNewPassword('');
      setNewRole('BCBA');
      setTimeout(() => setSuccess(''), 3000);
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, username) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    setError('');
    try {
      await deleteUser(id);
      setSuccess(`User "${username}" deleted.`);
      setTimeout(() => setSuccess(''), 3000);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ padding: '32px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>
        Manage Users
      </h1>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '32px' }}>
        Add or remove users. Admin role has access to all features including user management.
      </p>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#dc2626', fontSize: '14px' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#16a34a', fontSize: '14px', fontWeight: '600' }}>
          ✓ {success}
        </div>
      )}

      {/* Users Table */}
      <div style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        overflow: 'hidden',
        marginBottom: '32px',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Username</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>Loading...</td>
              </tr>
            ) : users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '14px 16px', fontSize: '14px', fontWeight: '500', color: '#0f172a' }}>
                  {u.username}
                  {u.id === currentUser?.id && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: '#94a3b8' }}>(you)</span>
                  )}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '600',
                    background: u.role === 'Admin' ? '#ede9fe' : '#e0f2fe',
                    color: u.role === 'Admin' ? '#7c3aed' : '#0369a1',
                  }}>
                    {u.role}
                  </span>
                </td>
                <td style={{ padding: '14px 16px', fontSize: '13px', color: '#64748b' }}>{formatDate(u.created_at)}</td>
                <td style={{ padding: '14px 16px' }}>
                  {u.id !== currentUser?.id && (
                    <button
                      onClick={() => handleDelete(u.id, u.username)}
                      style={{
                        padding: '5px 12px',
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '6px',
                        color: '#dc2626',
                        fontSize: '12px',
                        fontWeight: '500',
                        cursor: 'pointer',
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Form */}
      <div style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '24px',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '0 0 20px' }}>
          Add New User
        </h2>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
              Username
            </label>
            <input
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="username"
              required
              style={{
                padding: '8px 12px',
                border: '1.5px solid #e2e8f0',
                borderRadius: '7px',
                fontSize: '14px',
                color: '#0f172a',
                outline: 'none',
                width: '160px',
              }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
              Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="password"
              required
              style={{
                padding: '8px 12px',
                border: '1.5px solid #e2e8f0',
                borderRadius: '7px',
                fontSize: '14px',
                color: '#0f172a',
                outline: 'none',
                width: '160px',
              }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
              Role
            </label>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1.5px solid #e2e8f0',
                borderRadius: '7px',
                fontSize: '14px',
                color: '#0f172a',
                outline: 'none',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <option value="BCBA">BCBA</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            style={{
              padding: '8px 20px',
              background: adding ? '#93c5fd' : '#2563eb',
              border: 'none',
              borderRadius: '7px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
              cursor: adding ? 'not-allowed' : 'pointer',
            }}
          >
            {adding ? 'Adding...' : 'Add User'}
          </button>
        </form>
      </div>
    </div>
  );
}
