import React, { useMemo, useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import './Login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Signup removed — only Sign In flow is available
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  const isValidEmail = useMemo(() => /.+@.+\..+/.test(email), [email]);

  const mapAuthError = (code, message) => {
    switch (code) {
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Contact an admin.';
      case 'auth/user-not-found':
        return 'No account found with that email.';
      case 'auth/wrong-password':
        return 'Incorrect password. Try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      default:
        return message || 'Sign in failed. Please try again.';
    }
  };

  // Google sign-in removed

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
  setResetMessage('');

    try {
      // Sign in existing user
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Ensure user document exists with a default role for Storage/Firestore rules
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          email: user.email || '',
          username: '',
          role: 'user',
          createdAt: new Date(),
          lastLogin: new Date()
        });
      } else {
        // Update last login if already exists
        await setDoc(userDocRef, { lastLogin: new Date() }, { merge: true });
      }
    } catch (error) {
      setError(mapAuthError(error.code, error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    setResetMessage('');
    if (!isValidEmail) {
      setError('Enter a valid email to reset your password.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setResetMessage('Password reset email sent. Check your inbox.');
    } catch (err) {
      setError(mapAuthError(err.code, err.message));
    }
  };

  return (
    <div className="login-container">
      <div className="login-form">
        <h2>Sign In</h2>
        
  {error && <div className="error" role="alert" aria-live="assertive">{error}</div>}
  {resetMessage && <div className="info" role="status" aria-live="polite">{resetMessage}</div>}
  {/* OAuth sign-in removed */}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="Enter your email"
              autoFocus
              aria-invalid={!!error && !isValidEmail}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter your password"
                minLength="6"
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="form-row">
              <button type="button" className="forgot-link" onClick={handleForgotPassword}>
                Forgot password?
              </button>
            </div>
          </div>
          
          <button 
            type="submit" 
            className="login-btn"
            disabled={loading || !isValidEmail || password.length < 6}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

      </div>
    </div>
  );
};

export default Login;
