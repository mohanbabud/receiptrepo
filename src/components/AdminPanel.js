import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  orderBy,
  setDoc,
  getDocs,
  startAt,
  endAt,
  limit as qLimit
} from 'firebase/firestore';
import { deleteObject, ref, listAll, getMetadata, uploadBytes } from 'firebase/storage';
import { sendPasswordResetEmail, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, storage, auth } from '../firebase';
import { FaArrowLeft, FaCheck, FaTimes, FaUsers, FaFileAlt, FaClock, FaKey, FaEnvelope, FaUserPlus } from 'react-icons/fa';
import { getFunctions, httpsCallable } from 'firebase/functions';
import AdminSetPasswordModal from './AdminSetPasswordModal';
import './AdminPanel.css';

const AdminPanel = ({ user }) => {
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('requests');
  const [loading, setLoading] = useState(true);
  const [resetPasswordTarget, setResetPasswordTarget] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Add User states
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [newUserData, setNewUserData] = useState({ email: '', username: '', password: '', role: 'user' });
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [addUserSuccess, setAddUserSuccess] = useState('');
  const [setPwTarget, setSetPwTarget] = useState(null);
  const [showSetPw, setShowSetPw] = useState(false);

  // Optimize existing images
  const [optPrefix, setOptPrefix] = useState('files/');
  const [optLimit, setOptLimit] = useState(25);
  const [optMode, setOptMode] = useState('balanced');
  const [optDryRun, setOptDryRun] = useState(true);
  const [optOverwrite, setOptOverwrite] = useState(false);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState('');
  const [optResult, setOptResult] = useState(null);
  const [showOptDetails, setShowOptDetails] = useState(false);
  // Upload optimize self-test
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState(null);
  const [selfTestError, setSelfTestError] = useState('');

  // Resync sizes
  const [resyncPrefix, setResyncPrefix] = useState('files/');
  const [resyncLimit, setResyncLimit] = useState(50);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [resyncError, setResyncError] = useState('');
  const [resyncSummary, setResyncSummary] = useState(null);
  const [showFailedDetails, setShowFailedDetails] = useState(false);
  const [resyncCleanStale, setResyncCleanStale] = useState(true);

  // Normalize to files/ prefix without leading slash and ending with slash
  const toFilesPrefix = (p) => {
    try {
      let x = String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!x) return 'files/';
      if (!x.startsWith('files')) x = 'files/' + x;
      x = x.replace(/\/+/g, '/');
      if (!x.endsWith('/')) x += '/';
      return x;
    } catch (_) { return 'files/'; }
  };

  useEffect(() => {
    const unsubReq = onSnapshot(query(collection(db, 'requests'), orderBy('requestedAt', 'desc')), (snap) => {
      const arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() })); setRequests(arr);
    });
    const unsubUsers = onSnapshot(query(collection(db, 'users')), (snap) => {
      const arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() })); setUsers(arr);
    });
    const unsubFiles = onSnapshot(query(collection(db, 'files'), orderBy('uploadedAt', 'desc')), (snap) => {
      const arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() })); setFiles(arr); setLoading(false);
    });
    return () => { unsubReq(); unsubUsers(); unsubFiles(); };
  }, []);

  const handleRequestAction = async (requestId, action, adminResponse = '') => {
    try {
      const req = requests.find(r => r.id === requestId);
      const ensurePath = (p) => String(p || '').replace(/^\/+/, '');
      const deleteFolderRecursive = async (folderPath) => {
        const folderRef = ref(storage, ensurePath(folderPath));
        const res = await listAll(folderRef);
        for (const item of res.items) { try { await deleteObject(item); } catch {} }
        for (const sub of res.prefixes) { await deleteFolderRecursive(sub.fullPath); }
      };
      if (action === 'approved' && req?.type === 'delete') {
        const path = ensurePath(req.path || '');
        if (path) {
          if ((req.targetType || 'file') === 'folder') await deleteFolderRecursive(path.replace(/\/+$/, ''));
          else { try { await deleteObject(ref(storage, path)); } catch {} }
        }
      } else if (action === 'approved' && req?.type === 'rename') {
        await updateDoc(doc(db, 'files', req.fileId), { name: req.newFileName, updatedAt: new Date() });
      }
      await updateDoc(doc(db, 'requests', requestId), { status: action, adminResponse, processedAt: new Date(), processedBy: user.uid });
    } catch (e) { console.error(e); alert('Error processing request'); }
  };

  const handleUserRoleChange = async (userId, newRole) => {
    try { await updateDoc(doc(db, 'users', userId), { role: newRole, updatedAt: new Date() }); }
    catch (e) { console.error(e); alert('Error updating user role'); }
  };

  const handlePasswordResetClick = (u) => { setResetPasswordTarget(u); setShowResetConfirm(true); setResetSuccess(false); setResetError(''); };
  const cancelPasswordReset = () => { setShowResetConfirm(false); setResetPasswordTarget(null); setResetSuccess(false); setResetError(''); };
  const confirmPasswordReset = async () => {
    if (!resetPasswordTarget?.email) return; setIsResetting(true);
    try { await sendPasswordResetEmail(auth, resetPasswordTarget.email); setResetSuccess(true); setTimeout(() => { setShowResetConfirm(false); setResetPasswordTarget(null); setResetSuccess(false); }, 5000); }
    catch (error) {
      console.error('Reset email error', error);
      let m = error.message || 'Failed to send password reset email';
      if (error.code === 'auth/user-not-found') m = 'No user found with this email address';
      else if (error.code === 'auth/invalid-email') m = 'Invalid email address';
      else if (error.code === 'auth/too-many-requests') m = 'Too many requests. Try later';
      setResetError(m); setResetSuccess(false);
    } finally { setIsResetting(false); }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUserData.email || !newUserData.password || !newUserData.username) { setAddUserError('Please fill in all required fields'); return; }
    if (newUserData.password.length < 6) { setAddUserError('Password must be at least 6 characters long'); return; }
    setAddUserLoading(true); setAddUserError(''); setAddUserSuccess('');
    try {
      const cred = await createUserWithEmailAndPassword(auth, newUserData.email, newUserData.password);
      await setDoc(doc(db, 'users', cred.user.uid), { email: newUserData.email, username: newUserData.username, role: newUserData.role, createdAt: new Date(), createdBy: user.uid, createdByEmail: user.email, isActive: true });
      setAddUserSuccess(`User ${newUserData.username} (${newUserData.email}) has been created successfully!`);
      setNewUserData({ email: '', username: '', password: '', role: 'user' });
      setTimeout(() => { setAddUserSuccess(''); setShowAddUserForm(false); }, 5000);
    } catch (error) {
      console.error('Error creating user:', error);
      let m = error.message || 'Failed to create user';
      if (error.code === 'auth/email-already-in-use') m = 'Email address is already registered';
      else if (error.code === 'auth/invalid-email') m = 'Invalid email address format';
      else if (error.code === 'auth/weak-password') m = 'Password is too weak';
      setAddUserError(m);
    } finally { setAddUserLoading(false); }
  };

  const resetAddUserForm = () => { setShowAddUserForm(false); setNewUserData({ email: '', username: '', password: '', role: 'user' }); setAddUserError(''); setAddUserSuccess(''); };

  const formatDate = (ts) => (!ts || !ts.toDate) ? 'Unknown' : ts.toDate().toLocaleDateString();
  const getRequestDescription = (r) => r?.type === 'delete' ? `Delete "${r.fileName}"` : r?.type === 'rename' ? `Rename "${r.fileName}" to "${r.newFileName}"` : 'Unknown request';
  const formatBytes = (b = 0) => {
    if (!Number.isFinite(b)) return '-';
    const abs = Math.abs(b);
    if (abs < 1024) return `${b} B`;
    if (abs < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1024/1024).toFixed(2)} MB`;
  };

  // Resync helper that can be reused by Optimize toolbar or standalone
  const runResync = async (prefixFromCaller) => {
    setResyncLoading(true); setResyncError(''); setResyncSummary(null);
    setShowFailedDetails(false);
    try {
      const rawPrefix = prefixFromCaller ?? resyncPrefix;
      const prefix = String(rawPrefix || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
      const q = query(
        collection(db, 'files'),
        orderBy('fullPath'),
        startAt(prefix),
        endAt(prefix + '\\uf8ff'),
        qLimit(Math.max(0, Number(resyncLimit) || 0))
      );
      const snap = await getDocs(q);
      let updated = 0, failed = 0, staleDetected = 0, staleRemoved = 0;
      const failedItems = [];
      for (const d of snap.docs) {
        const data = d.data() || {}; const full = data.fullPath; if (!full) continue;
        try {
          const meta = await getMetadata(ref(storage, full));
          const size = Number(meta?.size);
          const type = meta?.contentType || data.type;
          if (Number.isFinite(size)) {
            await updateDoc(doc(db, 'files', d.id), { size, type, updatedAt: new Date() });
            updated++;
          }
        } catch (err) {
          const code = err && (err.code || err?.message);
          const isNotFound = typeof code === 'string' && (code.includes('storage/object-not-found') || code.includes('404'));
          if (isNotFound) {
            staleDetected++;
            if (resyncCleanStale) {
              try { await updateDoc(doc(db, 'files', d.id), { deleted: true, deletedAt: new Date() }); } catch (_) {}
              try { /* optionally delete doc */ /* await deleteDoc(doc(db, 'files', d.id)); */ } catch (_) {}
              staleRemoved++;
            }
          } else {
            failed++;
            failedItems.push({ id: d.id, fullPath: full, error: err?.message || String(err) });
          }
        }
      }
      setResyncSummary({ scanned: snap.size, updated, failed, failedItems, staleDetected, staleRemoved, cleaned: resyncCleanStale });
      try {
        const normalized = toFilesPrefix(prefix);
        window.dispatchEvent(new CustomEvent('storage-meta-refresh', { detail: { prefix: normalized } }));
        window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: 'Resync completed. Refreshing files…' } }));
      } catch {}
    } catch (e) {
      setResyncError(e?.message || 'Resync failed');
    } finally {
      setResyncLoading(false);
    }
  };

  const renderRequests = () => {
    const pending = requests.filter(r => r.status === 'pending');
    return (
      <div className="admin-section">
        <h3>Pending Requests ({pending.length})</h3>
        {pending.length === 0 ? (
          <div className="empty-state"><FaClock className="empty-icon" /><p>No pending requests</p></div>
        ) : (
          <div className="requests-grid">
            {pending.map((r) => (
              <div key={r.id} className="request-card">
                <div className="request-info">
                  <h4>{getRequestDescription(r)}</h4>
                  <p>Requested by: {r.requestedBy}</p>
                  <p>Date: {formatDate(r.requestedAt)}</p>
                  {r.path && <p>Path: {r.path}</p>}
                </div>
                <div className="request-actions">
                  <button onClick={() => handleRequestAction(r.id, 'approved')} className="approve-btn"><FaCheck /> Approve</button>
                  <button onClick={() => { const response = prompt('Reason for rejection (optional):'); handleRequestAction(r.id, 'rejected', response || ''); }} className="reject-btn"><FaTimes /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderUsers = () => (
    <div className="admin-section">
      <h3>User Management ({users.length} users)</h3>
      <div className="users-table">
        <table>
          <thead>
            <tr><th>Email</th><th>Username</th><th>Role</th><th>Created</th><th>Last Login</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.username || '-'}</td>
                <td>
                  <select value={u.role || 'user'} onChange={(e) => handleUserRoleChange(u.id, e.target.value)} className={`role-select ${u.role}`}>
                    <option value="viewer">Viewer</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>{formatDate(u.createdAt)}</td>
                <td>{formatDate(u.lastLogin)}</td>
                <td>
                  <div className="user-actions">
                    <span className={`user-status ${u.role}`}>{u.role || 'user'}</span>
                    <div style={{ display: 'inline-flex', gap: 8 }}>
                      <button className="reset-password-btn" onClick={() => handlePasswordResetClick(u)} title={`Send password reset email to ${u.email}`}><FaEnvelope /></button>
                      <button className="reset-password-btn" onClick={() => { setSetPwTarget(u); setShowSetPw(true); }} title={`Set a new password for ${u.email}`}><FaKey /></button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderFiles = () => (
    <div className="admin-section">
      {(() => {
        const visibleFiles = files.filter(f => f.name !== '.folder-placeholder');
        return <>
          <h3>File Overview ({visibleFiles.length} files)</h3>
          <div className="files-stats">
            <div className="stat-card"><h4>Total Files</h4><p>{visibleFiles.length}</p></div>
            <div className="stat-card"><h4>Total Size</h4><p>{(visibleFiles.reduce((s, f) => s + (f.size || 0), 0) / 1024 / 1024).toFixed(2)} MB</p></div>
            <div className="stat-card"><h4>Images</h4><p>{visibleFiles.filter(f => f.type?.startsWith('image/')).length}</p></div>
            <div className="stat-card"><h4>PDFs</h4><p>{visibleFiles.filter(f => f.type === 'application/pdf').length}</p></div>
          </div>
          <div className="files-table">
            <table>
              <thead><tr><th>Name</th><th>Path</th><th>Size</th><th>Type</th><th>Uploaded</th><th>Uploaded By</th></tr></thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr key={file.id}>
                    <td title={file.name}>{file.name}</td>
                    <td>{file.path}</td>
                    <td>{(file.size / 1024 / 1024).toFixed(2)} MB</td>
                    <td>{file.type || 'Unknown'}</td>
                    <td>{formatDate(file.uploadedAt)}</td>
                    <td>{file.uploadedBy || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>;
      })()}
    </div>
  );

  const runOptimization = async (doDryRun) => {
    if (optLoading) return; // guard against rapid double clicks
    setOptLoading(true); setOptError(''); setOptResult(null);
    try {
      const callable = httpsCallable(getFunctions(undefined, 'us-central1'), 'optimizeExistingImages');
      const normalizedPrefix = String(optPrefix || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      const res = await callable({ prefix: normalizedPrefix, limit: Math.max(0, Number(optLimit) || 0), mode: optMode, dryRun: !!doDryRun, overwrite: !!optOverwrite });
      setOptResult(res && res.data ? res.data : res);
      if (!doDryRun) {
        const normalized = toFilesPrefix(optPrefix);
        try {
          window.dispatchEvent(new CustomEvent('storage-meta-refresh', { detail: { prefix: normalized } }));
          window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: 'Optimization completed. Refreshing files…' } }));
        } catch {}
      }
    } catch (e) { console.error('optimizeExistingImages error', e); setOptError(e?.message || 'Optimization call failed'); }
    finally { setOptLoading(false); }
  };

  const renderOptimize = () => (
    <div className="admin-section">
      <h3>Optimize Existing Images</h3>
      <p style={{ maxWidth: 820, color: '#555' }}>Compress existing JPEGs in Storage. Start with a dry run to preview size savings.</p>
      <p style={{ maxWidth: 820, color: '#6b7280', marginTop: 6, fontSize: 13 }}>
        Note: Files already optimized with the same mode are skipped unless you enable "Overwrite". Uploads are optimized with <strong>balanced</strong> by default.
      </p>
      <div className="settings-grid">
        <div className="field">
          <label>Prefix (folder root)</label>
          <input value={optPrefix} onChange={e => setOptPrefix(e.target.value)} placeholder="files/" />
        </div>
        <div className="field">
          <label>Limit (files per run)</label>
          <input type="number" min={0} value={optLimit} onChange={e => setOptLimit(e.target.value)} />
        </div>
        <div className="field">
          <label>Mode</label>
          <select value={optMode} onChange={e => setOptMode(e.target.value)}>
            <option value="lossless">Lossless (strip metadata)</option>
            <option value="balanced">Balanced (≤2000px, q≈85)</option>
          </select>
        </div>
        <label className="switch">
          <input type="checkbox" checked={optOverwrite} onChange={e => setOptOverwrite(e.target.checked)} />
          Overwrite already-optimized
        </label>
        <label className="switch">
          <input type="checkbox" checked={optDryRun} onChange={e => setOptDryRun(e.target.checked)} />
          Dry run (no writes)
        </label>
      </div>
      <div className="section-actions">
        <button type="button" className="approve-btn" onClick={() => runOptimization(true)} disabled={optLoading}>{optLoading ? 'Running…' : 'Dry Run'}</button>
        <button type="button" className="reject-btn" onClick={() => runOptimization(false)} disabled={optLoading || optDryRun} title={optDryRun ? 'Uncheck Dry run to enable' : ''}>{optLoading ? 'Running…' : 'Execute'}</button>
        <button
          type="button"
          className="outline-btn"
          disabled={resyncLoading}
          onClick={async () => {
            // use the optimize prefix for resync run
            const desiredPrefix = String(optPrefix || 'files/');
            await runResync(desiredPrefix);
          }}
          title="Resync sizes/types from Storage into Firestore"
        >
          {resyncLoading ? 'Resyncing…' : 'Run Resync'}
        </button>
        <div className="resync-inline">
          <label title="Mark Firestore docs as deleted when Storage objects are missing">
            <input
              type="checkbox"
              checked={resyncCleanStale}
              onChange={(e) => setResyncCleanStale(e.target.checked)}
            />
            Clean up missing
          </label>
          <label title="Max docs per resync run">
            Limit
            <input
              type="number"
              min={0}
              value={resyncLimit}
              onChange={(e) => setResyncLimit(e.target.value)}
            />
          </label>
        </div>
      </div>
      {optError && (<div className="error-message" style={{ marginTop: 12 }}><FaTimes className="error-icon" /> {optError}</div>)}
      {optResult && (
        <div style={{ marginTop: 16 }}>
          <h4>Result</h4>
          <div className="files-stats" style={{ marginTop: 8 }}>
            <div className="stat-card"><h4>Scanned</h4><p>{optResult.scanned}</p></div>
            <div className="stat-card"><h4>Processed</h4><p>{optResult.processed}</p></div>
            <div className="stat-card"><h4>Skipped</h4><p>{optResult.skipped}</p></div>
            <div className="stat-card"><h4>Saved</h4><p>{((optResult.savedBytes || 0)/1024/1024).toFixed(2)} MB</p></div>
            {Array.isArray(optResult.details) && optResult.details.length > 0 && (
              <div className="stat-card"><h4>Saved %</h4><p>{(() => {
                const beforeSum = optResult.details.reduce((s,d) => s + (Number(d.before)||0), 0);
                const saved = Number(optResult.savedBytes)||0;
                if (!beforeSum) return '0%';
                return ((saved / beforeSum) * 100).toFixed(1) + '%';
              })()}</p></div>
            )}
          </div>
          {Array.isArray(optResult.details) && optResult.details.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="approve-btn"
                onClick={() => setShowOptDetails(v => !v)}
                style={{ padding: '6px 10px' }}
              >
                {showOptDetails ? 'Hide file details' : `Show file details (${optResult.details.length})`}
              </button>
              {showOptDetails && (
                <div className="files-table" style={{ marginTop: 10, maxHeight: 320, overflow: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Old Size</th>
                        <th>New Size</th>
                        <th>Saved</th>
                        <th>Saved %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optResult.details.map((d, i) => {
                        const before = Number(d.before) || 0;
                        const after = Number(d.after) || 0;
                        const saved = before > 0 ? (before - after) : 0;
                        const pct = before > 0 ? Math.max(0, (saved / before) * 100) : 0;
                        return (
                          <tr key={i}>
                            <td title={d.path}>{d.path}</td>
                            <td>{formatBytes(before)}</td>
                            <td>{formatBytes(after)}</td>
                            <td>{formatBytes(saved)}</td>
                            <td>{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
  <div className="section-divider" />
      <h3>Validate Upload Optimization</h3>
      <p style={{ maxWidth: 820, color: '#555' }}>Runs a quick self-test: uploads a tiny JPEG to Storage, then checks if the optimizeOnUpload function compressed it and set the metadata flag.</p>
  <div className="section-actions" style={{ marginTop: 8 }}>
        <button
          className="approve-btn"
          disabled={selfTestRunning}
          onClick={async () => {
            setSelfTestRunning(true); setSelfTestError(''); setSelfTestResult(null);
            try {
              // Create a tiny JPEG via canvas
              const canvas = document.createElement('canvas');
              canvas.width = 64; canvas.height = 64;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ddd'; ctx.fillRect(0,0,64,64);
              ctx.fillStyle = '#333'; ctx.font = '12px sans-serif'; ctx.fillText('TEST', 12, 36);
              const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
              if (!blob) throw new Error('Failed to generate test image');
              const beforeSize = blob.size;
              // Upload to a test path
              const ts = Date.now();
              const testPath = `files/__opt_test__/self-test-${ts}.jpg`;
              const testRef = ref(storage, testPath);
              await uploadBytes(testRef, blob, { contentType: 'image/jpeg' });
              // Give the finalize trigger a moment to run
              await new Promise(r => setTimeout(r, 2500));
              // Read back metadata
              let meta = null; let retries = 0;
              while (retries < 4) {
                try { meta = await getMetadata(testRef); break; } catch { await new Promise(r => setTimeout(r, 800)); retries++; }
              }
              if (!meta) throw new Error('Could not read Storage metadata after upload');
              const afterSize = Number(meta.size) || 0;
              const md = (meta && meta.customMetadata) || (meta && meta.metadata) || {};
              const optimizedMode = md.optimized || md['optimized'] || null;
              const saved = beforeSize > 0 ? Math.max(0, beforeSize - afterSize) : 0;
              setSelfTestResult({ path: testPath, beforeSize, afterSize, optimizedMode, saved });
              // Dispatch a UI refresh
              try {
                window.dispatchEvent(new CustomEvent('storage-meta-refresh', { detail: { prefix: 'files/' } }));
                window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: 'Self-test image uploaded and checked.' } }));
              } catch {}
            } catch (e) {
              setSelfTestError(e?.message || 'Self-test failed');
            } finally { setSelfTestRunning(false); }
          }}
        >{selfTestRunning ? 'Running…' : 'Run Self-Test'}</button>
      </div>
      {selfTestError && (<div className="error-message" style={{ marginTop: 10 }}><FaTimes className="error-icon" /> {selfTestError}</div>)}
      {selfTestResult && (
        <div style={{ marginTop: 12 }}>
          <div className="files-stats">
            <div className="stat-card"><h4>Path</h4><p title={selfTestResult.path} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{selfTestResult.path}</p></div>
            <div className="stat-card"><h4>Before</h4><p>{formatBytes(selfTestResult.beforeSize)}</p></div>
            <div className="stat-card"><h4>After</h4><p>{formatBytes(selfTestResult.afterSize)}</p></div>
            <div className="stat-card"><h4>Saved</h4><p>{formatBytes(selfTestResult.saved)}</p></div>
            <div className="stat-card"><h4>Optimized</h4><p>{selfTestResult.optimizedMode || 'no'}</p></div>
          </div>
        </div>
      )}
  <div className="section-divider" />
      {resyncError && (<div className="error-message" style={{ marginTop: 12 }}><FaTimes className="error-icon" /> {resyncError}</div>)}
      {resyncSummary && (
        <div style={{ marginTop: 12, color: '#374151' }}>
          <div>
            Scanned: {resyncSummary.scanned} · Updated: {resyncSummary.updated} · Failed: {resyncSummary.failed}
            {typeof resyncSummary.staleDetected === 'number' && (
              <> · Missing in Storage: {resyncSummary.staleDetected}{resyncSummary.cleaned ? ` (marked deleted: ${resyncSummary.staleRemoved})` : ''}</>
            )}
          </div>
          {!!resyncSummary.failed && resyncSummary.failed > 0 && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="reject-btn"
                onClick={() => setShowFailedDetails((v) => !v)}
                style={{ padding: '6px 10px' }}
              >
                {showFailedDetails ? 'Hide failed details' : `Show failed details (${resyncSummary.failed})`}
              </button>
              {showFailedDetails && (
                <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}><th style={{ textAlign: 'left', padding: 8 }}>Path</th><th style={{ textAlign: 'left', padding: 8 }}>Error</th></tr>
                    </thead>
                    <tbody>
                      {(resyncSummary.failedItems || []).map((it, idx) => (
                        <tr key={`${it.id}-${idx}`}>
                          <td style={{ padding: 8, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: 520 }} title={it.fullPath}>{it.fullPath}</td>
                          <td style={{ padding: 8 }}>{it.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderAddUsers = () => (
    <div className="admin-section">
      <div className="add-user-header">
        <h3>Add New User</h3>
        <button className="add-user-btn" onClick={() => setShowAddUserForm(true)} disabled={showAddUserForm}><FaUserPlus /> Add User</button>
      </div>
      {showAddUserForm && (
        <div className="add-user-form-container">
          <form onSubmit={handleAddUser} className="add-user-form">
            <div className="form-header"><h4>Create New User Account</h4><button type="button" className="close-form-btn" onClick={resetAddUserForm}><FaTimes /></button></div>
            {addUserError && (<div className="error-message"><FaTimes className="error-icon" />{addUserError}</div>)}
            {addUserSuccess && (<div className="success-message"><FaCheck className="success-icon" />{addUserSuccess}</div>)}
            <div className="form-group"><label htmlFor="userEmail">Email Address *</label><input type="email" id="userEmail" value={newUserData.email} onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })} placeholder="user@example.com" required disabled={addUserLoading} /></div>
            <div className="form-group"><label htmlFor="userName">Username *</label><input type="text" id="userName" value={newUserData.username} onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })} placeholder="Enter username" required disabled={addUserLoading} /></div>
            <div className="form-group"><label htmlFor="userPassword">Password *</label><input type="password" id="userPassword" value={newUserData.password} onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })} placeholder="Minimum 6 characters" minLength={6} required disabled={addUserLoading} /><small className="password-hint">Password must be at least 6 characters long</small></div>
            <div className="form-group"><label htmlFor="userRole">Role *</label><select id="userRole" value={newUserData.role} onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })} required disabled={addUserLoading}><option value="viewer">Viewer - Read-only access</option><option value="user">User - Upload files, submit requests</option><option value="admin">Admin - Full access</option></select></div>
            <div className="form-actions"><button type="button" className="cancel-btn" onClick={resetAddUserForm} disabled={addUserLoading}>Cancel</button><button type="submit" className="create-user-btn" disabled={addUserLoading}>{addUserLoading ? 'Creating...' : 'Create User'}</button></div>
          </form>
        </div>
      )}
      <div className="add-user-info">
        <h4>📋 Instructions</h4>
        <ul>
          <li><strong>Email Address:</strong> Must be a valid email address that will be used for login</li>
          <li><strong>Username:</strong> Display name for the user in the system</li>
          <li><strong>Password:</strong> Temporary password (user can change it later)</li>
          <li><strong>Role:</strong> Determines user permissions in the system</li>
        </ul>
      </div>
      <div className="user-roles-guide">
        <h4>🔐 Role Permissions</h4>
        <div className="roles-grid">
          <div className="role-card viewer"><h5>👁️ Viewer</h5><ul><li>View files and folders</li><li>Download files</li><li>Read-only access</li></ul></div>
          <div className="role-card user"><h5>📤 User</h5><ul><li>All Viewer permissions</li><li>Upload new files</li><li>Submit delete/rename requests</li></ul></div>
          <div className="role-card admin"><h5>⚡ Admin</h5><ul><li>All User permissions</li><li>Delete/rename files directly</li><li>Manage users and approve requests</li><li>Access admin panel</li></ul></div>
        </div>
      </div>
    </div>
  );

  if (loading) return <div className="loading">Loading admin panel...</div>;

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <div className="header-left">
          <Link to="/dashboard" className="back-link"><FaArrowLeft /> Back to Dashboard</Link>
          <h1>Admin Panel</h1>
        </div>
        <div className="header-right"><span>Logged in as: {user.email}</span></div>
      </header>

      <div className="admin-tabs">
        <button className={`tab-btn ${activeTab === 'requests' ? 'active' : ''}`} onClick={() => setActiveTab('requests')}><FaFileAlt /> Requests ({requests.filter(r => r.status === 'pending').length})</button>
        <button className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}><FaUsers /> Users ({users.length})</button>
        <button className={`tab-btn ${activeTab === 'addUsers' ? 'active' : ''}`} onClick={() => setActiveTab('addUsers')}><FaUserPlus /> Add Users</button>
        <button className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}><FaFileAlt /> Files ({files.length})</button>
        <button className={`tab-btn ${activeTab === 'optimize' ? 'active' : ''}`} onClick={() => setActiveTab('optimize')}><FaFileAlt /> Optimize</button>
      </div>

      <div className="admin-content">
        {activeTab === 'requests' && renderRequests()}
        {activeTab === 'users' && renderUsers()}
        {activeTab === 'addUsers' && renderAddUsers()}
        {activeTab === 'files' && renderFiles()}
        {activeTab === 'optimize' && renderOptimize()}
      </div>

      {showResetConfirm && (
        <div className="reset-confirm-overlay">
          <div className="reset-confirm-dialog">
            <div className="reset-confirm-header">
              <FaKey className="reset-icon" />
              <h3>Reset User Password</h3>
              <button className="close-btn" onClick={cancelPasswordReset} title="Cancel"><FaTimes /></button>
            </div>
            <div className="reset-confirm-content">
              {resetSuccess ? (
                <div className="reset-success">
                  <FaEnvelope className="success-icon" />
                  <h4>Password Reset Email Sent!</h4>
                  <p>A password reset email has been sent to:</p>
                  <div className="email-sent"><strong>{resetPasswordTarget?.email}</strong></div>
                  <p className="reset-note">The user will receive an email with instructions to reset their password. This dialog will close automatically in a few seconds.</p>
                </div>
              ) : resetError ? (
                <div className="reset-error">
                  <FaTimes className="error-icon" />
                  <h4>Password Reset Failed</h4>
                  <p className="error-message">{resetError}</p>
                  <p>Please check the email address and try again.</p>
                </div>
              ) : (
                <div className="reset-confirm">
                  <p>Are you sure you want to send a password reset email to this user?</p>
                  <div className="user-reset-info">
                    <div className="user-email"><strong>Email:</strong> {resetPasswordTarget?.email}</div>
                    <div className="user-name"><strong>Username:</strong> {resetPasswordTarget?.username || 'N/A'}</div>
                    <div className="user-role"><strong>Role:</strong> {resetPasswordTarget?.role || 'user'}</div>
                  </div>
                  <div className="reset-warning"><p>📧 <strong>Note:</strong> The user will receive an email with a secure link to reset their password.</p></div>
                </div>
              )}
            </div>
            {!resetSuccess && (
              <div className="reset-confirm-actions">
                <button className="cancel-btn" onClick={cancelPasswordReset} disabled={isResetting}>Cancel</button>
                <button className="confirm-reset-btn" onClick={confirmPasswordReset} disabled={isResetting}>{isResetting ? 'Sending...' : 'Send Reset Email'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      <AdminSetPasswordModal open={showSetPw} onClose={() => { setShowSetPw(false); setSetPwTarget(null); }} targetUser={setPwTarget} />
    </div>
  );
};

export default AdminPanel;
