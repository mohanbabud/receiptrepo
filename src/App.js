import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import Login from './components/Login';
import ResetPassword from './components/ResetPassword';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import TreeViewPage from './components/TreeViewPage';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
  });
  const [accent, setAccent] = useState(() => {
    try { return localStorage.getItem('accent') || 'teal'; } catch { return 'teal'; }
  });
  const [preset, setPreset] = useState(() => {
    try { return localStorage.getItem('preset') || 'default'; } catch { return 'default'; }
  });
  const idleTimerRef = useRef(null);
  const bcRef = useRef(null);
  const AUTO_LOGOUT_MS = 30 * 60 * 1000; // 30 minutes

  // Helper: broadcast and record activity across tabs
  const touchActivity = useCallback(() => {
    try {
      localStorage.setItem('lastActivity', String(Date.now()));
    } catch {}
    try {
      if (bcRef.current) bcRef.current.postMessage({ type: 'activity', at: Date.now() });
    } catch {}
  }, []);

  // Helper: reset idle timer
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (!user) return;
    idleTimerRef.current = setTimeout(async () => {
      try { await signOut(auth); } catch (e) { /* noop */ }
    }, AUTO_LOGOUT_MS);
  }, [user, AUTO_LOGOUT_MS]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setUserRole(userDoc.data().role || 'user');
          } else {
            setUserRole('user');
          }
        } catch (error) {
          console.error('Error fetching user role:', error);
          setUserRole('user');
        }
        // Start idle tracking on sign-in
        touchActivity();
        resetIdleTimer();
      } else {
        setUser(null);
        setUserRole(null);
        // Clear idle timer on sign-out
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [resetIdleTimer, touchActivity]);

  // Install activity listeners and cross-tab sync
  useEffect(() => {
    // BroadcastChannel (if supported)
    try {
      // eslint-disable-next-line no-undef
      bcRef.current = 'BroadcastChannel' in window ? new BroadcastChannel('auth-activity') : null;
      if (bcRef.current) {
        bcRef.current.onmessage = (e) => {
          if (e && e.data && e.data.type === 'activity') {
            resetIdleTimer();
          }
        };
      }
    } catch {}

    const onStorage = (e) => {
      if (e.key === 'lastActivity') {
        resetIdleTimer();
      }
    };
    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        touchActivity();
        resetIdleTimer();
      }
    };
    const onAnyActivity = () => {
      touchActivity();
      resetIdleTimer();
    };

    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisChange);
    events.forEach((evt) => window.addEventListener(evt, onAnyActivity, { passive: true }));

    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisChange);
      events.forEach((evt) => window.removeEventListener(evt, onAnyActivity));
      try { if (bcRef.current) bcRef.current.close(); } catch {}
    };
  }, [user, resetIdleTimer, touchActivity]);

  // Theme management
  useEffect(() => {
    try { localStorage.setItem('theme', theme); } catch {}
    const root = document.documentElement;
    const apply = (t) => root.setAttribute('data-theme', t);
    if (theme === 'auto') {
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq && mq.matches ? 'dark' : 'light');
      const handler = (e) => apply(e.matches ? 'dark' : 'light');
      mq && mq.addEventListener && mq.addEventListener('change', handler);
      return () => { mq && mq.removeEventListener && mq.removeEventListener('change', handler); };
    } else {
      apply(theme);
    }
  }, [theme]);

  // Accent management
  useEffect(() => {
    try { localStorage.setItem('accent', accent); } catch {}
    const root = document.documentElement;
    root.setAttribute('data-accent', accent);
  }, [accent]);

  // Theme preset management
  useEffect(() => {
    try { localStorage.setItem('preset', preset); } catch {}
    const root = document.documentElement;
    if (!preset || preset === 'default') {
      root.removeAttribute('data-preset');
    } else {
      root.setAttribute('data-preset', preset);
    }
  }, [preset]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <Router>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/dashboard" element={user ? <Dashboard user={user} userRole={userRole} theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} preset={preset} setPreset={setPreset} /> : <Navigate to="/login" />} />
          <Route path="/admin" element={user && userRole === 'admin' ? <AdminPanel user={user} /> : <Navigate to="/dashboard" />} />
          <Route path="/tree-view" element={user ? <TreeViewPage user={user} userRole={userRole} /> : <Navigate to="/login" />} />
          <Route path="/" element={<Navigate to={user ? '/dashboard' : '/login'} />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;