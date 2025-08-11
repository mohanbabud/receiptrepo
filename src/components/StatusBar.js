import React, { useEffect, useState } from 'react';
import { testAuthConnection, testFirestoreConnection, testStorageConnection } from '../firebaseDiagnostics';

const label = (s) => {
  if (s === 'connected') return 'OK';
  if (s === 'disconnected') return 'Down';
  if (s === 'timeout') return 'Slow';
  if (s === 'checking') return 'Checking';
  return 'Unknown';
};

export default function StatusBar({ pollMs = 30000 }) {
  const [auStatus, setAuStatus] = useState('checking');
  const [fsStatus, setFsStatus] = useState('checking');
  const [stStatus, setStStatus] = useState('checking');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    let timer;
    const run = async () => {
      try {
        setAuStatus('checking');
        setFsStatus('checking');
        setStStatus('checking');
        const [au, fs, st] = await Promise.all([
          testAuthConnection(),
          testFirestoreConnection(),
          testStorageConnection(),
        ]);
        if (!mounted) return;
        setAuStatus(au);
        setFsStatus(fs);
        setStStatus(st);
      } catch (_) {
        if (!mounted) return;
        setAuStatus('disconnected');
        setFsStatus('disconnected');
        setStStatus('disconnected');
      } finally {
        if (mounted && pollMs > 0) {
          timer = setTimeout(() => setTick((t) => t + 1), pollMs);
        }
      }
    };
    run();
    return () => { mounted = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, pollMs]);

  const statusVar = (s) => {
    if (s === 'connected') return 'var(--success-color)';
    if (s === 'disconnected') return 'var(--error-color)';
    if (s === 'timeout') return 'var(--warning-color)';
    return 'var(--text-muted)';
  };

  const pill = (name, status) => (
    <span
      title={`${name}: ${status}`}
      aria-label={`${name} status: ${label(status)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 999,
        background: 'var(--gray-100)',
        border: '1px solid var(--gray-200)',
        color: 'var(--text-primary)',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: statusVar(status),
          boxShadow: '0 0 0 2px rgba(0,0,0,0.03) inset',
        }}
      />
      <span>{name}</span>
      <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
        {label(status)}
      </span>
    </span>
  );

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} aria-live="polite" aria-label="Firebase service status">
  {pill('Auth', auStatus)}
      {pill('Firestore', fsStatus)}
      {pill('Storage', stStatus)}
      <button
        aria-label="Refresh status"
        onClick={() => setTick((t) => t + 1)}
        style={{
          marginLeft: 4,
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid var(--gray-200)',
          background: 'var(--bg-primary)',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Refresh
      </button>
    </div>
  );
}
