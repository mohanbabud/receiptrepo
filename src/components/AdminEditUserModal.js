import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export default function AdminEditUserModal({ open, onClose, user }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('user');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (open && user) {
      setEmail(user.email || '');
      setUsername(user.username || '');
      setRole(user.role || 'user');
      setIsActive(user.isActive !== false);
      setError('');
      setSuccess('');
    }
  }, [open, user]);

  if (!open || !user) return null;

  const handleClose = () => { if (busy) return; onClose?.(); };

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    setError(''); setSuccess('');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Enter a valid email'); return; }
    if (!username || username.trim().length < 2) { setError('Enter a valid username'); return; }
    setBusy(true);
    try {
      const fn = httpsCallable(functions, 'adminUpdateUser');
      await fn({ uid: user.id, email, username, role, isActive });
      setSuccess('User updated');
      setTimeout(() => handleClose(), 900);
    } catch (err) {
      setError(err?.message || 'Failed to update user');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="aeu-title" style={{ width: 480, maxWidth: '95vw', background: '#fff', borderRadius: 8, boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div id="aeu-title" style={{ fontWeight: 600 }}>Edit User</div>
          <button onClick={handleClose} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }} disabled={busy}>✕</button>
        </div>
        <form onSubmit={onSubmit} style={{ padding: 16, display: 'grid', gap: 10 }}>
          <label style={{ fontSize: 13, color: '#444' }}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
          <label style={{ fontSize: 13, color: '#444' }}>Username</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
          <label style={{ fontSize: 13, color: '#444' }}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }}>
            <option value="viewer">Viewer</option>
            <option value="user">User</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <label style={{ fontSize: 13, color: '#444' }}>Active</label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={busy} /> Active
          </label>
          {error && <div style={{ background: '#ffeaea', border: '1px solid #f5c2c7', color: '#b42318', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
          {success && <div style={{ background: '#eaffea', border: '1px solid #b7eb8f', color: '#065f46', padding: '8px 10px', borderRadius: 6 }}>{success}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={handleClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy} style={{ padding: '8px 12px', background: busy ? '#6ea8fe' : '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }}>{busy ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
