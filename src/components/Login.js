import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import './Login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Signup removed — only Sign In flow is available
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Google sign-in removed

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

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
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-form">
        <h2>Sign In</h2>
        
        {error && <div className="error">{error}</div>}
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
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
              minLength="6"
            />
          </div>
          
          <button 
            type="submit" 
            className="login-btn"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Sign In'}
          </button>
        </form>

      </div>
    </div>
  );
};

export default Login;
