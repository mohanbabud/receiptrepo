import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import './Login.css';

const ResetPassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const oobCode = params.get('oobCode') || '';
  const [verifying, setVerifying] = useState(true);
  const [valid, setValid] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setVerifying(true);
      setError('');
      try {
        const mail = await verifyPasswordResetCode(auth, oobCode);
        if (!cancelled) {
          setEmail(mail);
          setValid(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError('This reset link is invalid or has expired.');
          setValid(false);
        }
      } finally {
        if (!cancelled) setVerifying(false);
      }
    }
    if (oobCode) run();
    else { setVerifying(false); setError('Missing reset code.'); }
    return () => { cancelled = true; };
  }, [oobCode]);

  const canSubmit = valid && password.length >= 6 && password === confirm && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    setInfo('');
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setInfo('Password updated. You can now sign in with your new password.');
      setTimeout(() => navigate('/login'), 1200);
    } catch (e) {
      setError('Failed to update password. Please try again or request a new link.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-form" style={{ maxWidth: 420 }}>
        <h2>Reset Password</h2>
        {verifying && <div className="info">Verifying reset link…</div>}
        {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
        {info && <div className="info" role="status" aria-live="polite">{info}</div>}
        {valid && !verifying && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={email} disabled />
            </div>
            <div className="form-group">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a new password"
                minLength={6}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter the new password"
                minLength={6}
                required
              />
            </div>
            <button type="submit" className="login-btn" disabled={!canSubmit}>
              {submitting ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        )}
        <div className="form-footer" style={{ marginTop: '1rem' }}>
          <button className="toggle-btn" onClick={() => navigate('/login')}>Back to Sign In</button>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
