// FirebaseStatus.js
// React component to show current connectivity status to Firebase services

import React, { useEffect, useState } from 'react';
import { diagnoseFirebase } from '../firebaseDiagnostics';
import { testAuthConnection, testFirestoreConnection, testStorageConnection } from '../firebaseDiagnostics';

const statusColors = {
  connected: '#43a047',
  disconnected: '#d32f2f',
  timeout: '#f57c00',
  checking: '#757575',
  unknown: '#757575'
};

const labelFor = (s) => {
  switch (s) {
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Disconnected';
    case 'timeout':
      return 'Timeout';
    case 'checking':
      return 'Checking...';
    default:
      return 'Unknown';
  }
};

const FirebaseStatus = () => {
  const [status, setStatus] = useState({
    auth: 'unknown',
    firestore: 'unknown',
    storage: 'unknown'
  });
  const [loading, setLoading] = useState({ auth: false, firestore: false, storage: false });

  useEffect(() => {
    let timeoutId;
    async function checkStatus() {
      setLoading({ auth: true, firestore: true, storage: true });
      setStatus({ auth: 'checking', firestore: 'checking', storage: 'checking' });
      let finished = false;
      timeoutId = setTimeout(() => {
        setStatus(s => ({
          auth: s.auth === 'checking' || s.auth === 'unknown' ? 'timeout' : s.auth,
          firestore: s.firestore === 'checking' || s.firestore === 'unknown' ? 'timeout' : s.firestore,
          storage: s.storage === 'checking' || s.storage === 'unknown' ? 'timeout' : s.storage
        }));
        setLoading({ auth: false, firestore: false, storage: false });
      }, 5000);
      try {
        const result = await diagnoseFirebase();
        if (!finished) {
          clearTimeout(timeoutId);
          setStatus(result);
          setLoading({ auth: false, firestore: false, storage: false });
        }
      } catch {
        if (!finished) {
          clearTimeout(timeoutId);
          setStatus({ auth: 'disconnected', firestore: 'disconnected', storage: 'disconnected' });
          setLoading({ auth: false, firestore: false, storage: false });
        }
      }
      finished = true;
    }
    checkStatus();
    return () => clearTimeout(timeoutId);
  }, []);

  // Re-check functions for each service
  const recheckAuth = async () => {
    setLoading(l => ({ ...l, auth: true }));
    setStatus(s => ({ ...s, auth: 'checking' }));
    const authStatus = await testAuthConnection();
    setStatus(s => ({ ...s, auth: authStatus }));
    setLoading(l => ({ ...l, auth: false }));
  };

  const recheckFirestore = async () => {
    setLoading(l => ({ ...l, firestore: true }));
    setStatus(s => ({ ...s, firestore: 'checking' }));
    const firestoreStatus = await testFirestoreConnection();
    setStatus(s => ({ ...s, firestore: firestoreStatus }));
    setLoading(l => ({ ...l, firestore: false }));
  };

  const recheckStorage = async () => {
    setLoading(l => ({ ...l, storage: true }));
    setStatus(s => ({ ...s, storage: 'checking' }));
    const storageStatus = await testStorageConnection();
    setStatus(s => ({ ...s, storage: storageStatus }));
    setLoading(l => ({ ...l, storage: false }));
  };

  return (
    <div style={{
      background: '#fffde7',
      border: '1px solid #ffd600',
      borderRadius: 8,
      padding: 16,
      margin: '16px 0',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      maxWidth: 400
    }}>
      <h3 style={{ margin: 0, fontSize: 18, color: '#d32f2f' }}>Firebase Connectivity Status</h3>
      {(loading.auth || loading.firestore || loading.storage) ? (
        <p style={{ color: statusColors.checking }}>Checking...</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0 0' }}>
          {['auth', 'firestore', 'storage'].map(service => (
            <li key={service} style={{
              display: 'flex', alignItems: 'center', marginBottom: 8
            }}>
              <span style={{ width: 90, fontWeight: 500 }}>{service.charAt(0).toUpperCase() + service.slice(1)}:</span>
              <span style={{
                color: statusColors[status[service]] || statusColors.unknown,
                fontWeight: 600,
                marginLeft: 8
              }}>
                {labelFor(status[service])}
              </span>
              <button
                onClick={
                  service === 'auth'
                    ? recheckAuth
                    : service === 'firestore'
                    ? recheckFirestore
                    : recheckStorage
                }
                disabled={loading[service]}
                style={{ marginLeft: 8 }}
              >
                {loading[service] ? 'Checking...' : 'Re-check'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FirebaseStatus;
