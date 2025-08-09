import React, { useState } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth, storage, db } from '../firebase';
import FolderTree from './FolderTree';
import FileUploader from './FileUploader';
import FilePreview from './FilePreview';
import StorageTreeView from './StorageTreeView';
import './Dashboard.css';

const Dashboard = ({ user, userRole }) => {
  const [currentPath, setCurrentPath] = useState('/files/');
  const [selectedFile, setSelectedFile] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Focus the UI on folders/files, remove alternate views
  const [showUploader, setShowUploader] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const refreshFiles = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleFileSelect = (file) => {
    // Prevent selecting folder placeholder files
    if (file.name === '.folder-placeholder' || file.name === '.folder_placeholder') return;
    setSelectedFile(file);
  };

  const handleCreateFolder = async () => {
    if (userRole === 'viewer') return;
    const folderName = prompt('Enter folder name:');
    if (!folderName || !folderName.trim()) return;
    try {
      // Ensure user doc exists so storage.rules authorize writes
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          email: user.email || '',
          username: user.displayName || '',
          role: 'user',
          createdAt: new Date(),
          lastLogin: new Date()
        });
      }

      // Normalize base path to ensure we're under 'files/' root
      let base = currentPath && currentPath !== '/' ? currentPath : 'files';
      base = base.replace(/^\/+/, ''); // drop leading '/'
      if (!base.startsWith('files')) base = `files${base ? '/' + base : ''}`;
      const fullPath = `${base}/${folderName.trim().replace(/^\/+|\/+$/g, '')}/.keep`;
      const keepRef = ref(storage, fullPath);
      await uploadBytes(keepRef, new Uint8Array());
      setRefreshTrigger(prev => prev + 1);
    } catch (e) {
      console.error('Create folder failed:', e);
      alert('Failed to create folder: ' + (e && e.message ? e.message : e));
    }
  };

  const handleUploadFiles = () => {
  // Open uploader modal
  setShowUploader(true);
  };

  // (stats UI removed)

  return (
    <div className="dashboard">
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <h1>Firebase File Manager</h1>
          <div className="header-actions" style={{ display: 'flex', gap: 8 }}>
            {userRole !== 'viewer' && (
              <>
                <button className="action-btn create-folder" onClick={handleCreateFolder}>📁 New Folder</button>
                <button className="action-btn upload-files" onClick={handleUploadFiles}>📤 Upload</button>
                <button className="action-btn refresh-all" onClick={() => setRefreshTrigger(prev => prev + 1)}>🔄 Refresh</button>
              </>
            )}
          </div>
        </div>
        <div className="header-info">
          <div className="user-info">
            <span>Welcome, {user.email}</span>
            <span className={`role-badge ${userRole}`}>{userRole}</span>
          </div>
          {userRole === 'admin' && (
            <Link to="/admin" className="admin-link">Admin Panel</Link>
          )}
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>
      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-section">
            <h3>Folders</h3>
            <StorageTreeView currentPath={currentPath} onFolderSelect={setCurrentPath} refreshTrigger={refreshTrigger} />
          </div>
          
        </aside>

        <div className="content">
          <div className="main-grid">
            <section className="main-area">
              <div className="tree-view-header">
                <h2>Files</h2>
                <div className="path-info">
                  <span>Path: <strong>{(currentPath || '/').replace(/^\/files\/?/, '/PNLM/')}</strong></span>
                  <span>Role: <strong>{userRole}</strong></span>
                </div>
              </div>
              <div className="main-tree-content">
                <FolderTree currentPath={currentPath} onPathChange={setCurrentPath} refreshTrigger={refreshTrigger} userRole={userRole} onFileSelect={handleFileSelect} />
              </div>
            </section>

      <aside className="right-panel">
              {selectedFile ? (
                <FilePreview 
                  file={selectedFile}
                  onClose={() => setSelectedFile(null)}
                  userRole={userRole}
                  userId={user.uid}
                  onFileAction={refreshFiles}
                />
              ) : (
        <></>
              )}
            </aside>
          </div>
        </div>
      </div>

      {/* Uploader Modal */}
      {showUploader && userRole !== 'viewer' && (
        <div className="uploader-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ background: '#fff', borderRadius: 8, width: 'min(720px, 92vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
              <h3 style={{ margin: 0 }}>Upload Files</h3>
              <button onClick={() => setShowUploader(false)} className="close-btn">✕</button>
            </div>
            <div style={{ padding: 16 }}>
              <FileUploader currentPath={currentPath} onUploadComplete={() => { setShowUploader(false); refreshFiles(); }} userRole={userRole} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
