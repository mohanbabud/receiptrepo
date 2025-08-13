import React, { useState } from 'react';
import { auth } from '../firebase';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';

const MIN_LEN = 6;

export default function ChangePasswordModal({ open, onClose }) {
  const user = auth.currentUser;
  const email = user?.email || '';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    setError('');
    setSuccess('');
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose?.();
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError('');
    setSuccess('');
    if (!email || !user) {
      setError('Not authenticated. Please sign in again.');
      return;
    }
    if (!currentPassword) {
      setError('Enter current password.');
      return;
    }
    if (!newPassword || newPassword.length < MIN_LEN) {
      setError(`New password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const cred = EmailAuthProvider.credential(email, currentPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPassword);
      setSuccess('Password updated successfully.');
      setTimeout(() => {
        handleClose();
      }, 1200);
    } catch (err) {
      const msg = err?.message || 'Failed to update password';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cp-title" style={{ width: 420, maxWidth: '95vw', background: '#fff', borderRadius: 8, boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div id="cp-title" style={{ fontWeight: 600 }}>Change Password</div>
          <button onClick={handleClose} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }} disabled={busy}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 16, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: '#555' }}>Signed in as <strong>{email}</strong></div>
          {error && <div style={{ background: '#ffeaea', border: '1px solid #f5c2c7', color: '#b42318', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
          {success && (
            <div
              style={{
                background: '#eaffea',
                border: '1px solid #b7eb8f',
                color: '#065f46',
                padding: '8px 10px',
                borderRadius: 6,
              }}
            >
              {success}
            </div>
          )}
          <label style={{ fontSize: 13, color: '#444' }}>Current password</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required disabled={busy} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
          <label style={{ fontSize: 13, color: '#444' }}>New password</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={MIN_LEN} disabled={busy} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
          <label style={{ fontSize: 13, color: '#444' }}>Confirm new password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required disabled={busy} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={handleClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy} style={{ padding: '8px 12px', background: busy ? '#6ea8fe' : '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }}>{busy ? 'Saving…' : 'Update Password'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
