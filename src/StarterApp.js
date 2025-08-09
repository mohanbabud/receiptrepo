import React, { useEffect, useState } from 'react';
import { ref, list } from 'firebase/storage';
import { storage } from './firebase';

const StarterApp = () => {
  const [storageItems, setStorageItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadStorage = async () => {
    setLoading(true);
    setError('');
    try {
      const baseRef = ref(storage, 'files/');
      const res = await list(baseRef, { maxResults: 100 });
      const names = [
        ...res.prefixes.map(p => ({ type: 'folder', name: p.name })),
        ...res.items.map(i => ({ type: 'file', name: i.name }))
      ];
      setStorageItems(names);
    } catch (e) {
      setError(e?.message || 'Failed to load storage');
      setStorageItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial', padding: 24 }}>
  <h2 style={{ marginTop: 0 }}>Receipt Manager — Minimal</h2>
      <p style={{ color: '#666', marginTop: 0 }}>Clean baseline to verify connectivity and storage listing.</p>


      <section style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Storage: files/</h3>
          <button onClick={loadStorage} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>
        {error && <p style={{ color: '#d32f2f' }}>{error}</p>}
        {!error && storageItems.length === 0 && !loading && (
          <p style={{ color: '#777' }}>No items found under files/</p>
        )}
        <ul style={{ paddingLeft: 18, marginTop: 8 }}>
          {storageItems.map((it, idx) => (
            <li key={idx} style={{ color: it.type === 'folder' ? '#1976d2' : '#222' }}>
              {it.type === 'folder' ? '📁' : '📄'} {it.name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default StarterApp;
