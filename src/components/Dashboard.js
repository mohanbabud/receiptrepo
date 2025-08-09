import React, { useState, useCallback } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { signOut } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth, storage } from '../firebase';
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
  const [collapseUploader, setCollapseUploader] = useState(true);
  const [droppedFiles, setDroppedFiles] = useState([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
  setMobileMenuOpen(false);
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

  // Removed top-level header create-folder; Files section has its own subfolder action

  const handleUploadFiles = () => {
    setCollapseUploader(false);
  };

  const handleCreateSubfolder = useCallback(async () => {
    if (userRole === 'viewer') return;
    const name = prompt('Enter subfolder name:');
    if (!name || !name.trim()) return;
    try {
      let base = currentPath || '/files/';
      if (!base.endsWith('/')) base += '/';
      const fullPath = `${base}${name.trim().replace(/^\/+|\/+$/g, '')}/.keep`.replace(/^\/+/, '');
      const keepRef = ref(storage, fullPath.replace(/^\/+/, ''));
      await uploadBytes(keepRef, new Uint8Array());
      refreshFiles();
    } catch (e) {
      alert('Failed to create subfolder: ' + (e?.message || e));
    }
  }, [currentPath, userRole]);

  const onBannerDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      setDroppedFiles(files);
      setCollapseUploader(false);
    }
  }, []);

  const onBannerDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // (stats UI removed)

  return (
    <div className="dashboard">
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <h1>Receipt Manager</h1>
          {/* Top header actions removed; Files section provides upload/refresh/create controls */}
          {/* Mobile menu toggle (visible on small screens) */}
          <button
            className="mobile-menu-toggle"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(v => !v)}
          >
            ☰
          </button>
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
          {/* Compact mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="mobile-menu" role="menu">
              {userRole === 'admin' && (
                <Link
                  to="/admin"
                  className="mobile-menu-item"
                  onClick={() => setMobileMenuOpen(false)}
                  role="menuitem"
                >
                  🛠️ Admin Panel
                </Link>
              )}
              <button
                className="mobile-menu-item"
                onClick={handleLogout}
                role="menuitem"
              >
                🚪 Logout
              </button>
            </div>
          )}
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
                <div className="path-info" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span>Path: <strong>{(currentPath || '/').replace(/^\/(files)\/?/, '/PNLM/')}</strong></span>
                  <span>Role: <strong>{userRole}</strong></span>
                  {userRole !== 'viewer' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                      <button className="action-btn upload-files" onClick={handleUploadFiles}>📤 Upload Files</button>
                      <button className="action-btn create-folder" onClick={handleCreateSubfolder}>📁 Create subfolder</button>
                      <button className="action-btn refresh-all" onClick={() => setRefreshTrigger(prev => prev + 1)}>🔄 Refresh</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="main-tree-content">
                {/* Drop banner for filesOnly context */}
                {userRole !== 'viewer' && (
                  <div
                    onDragOver={onBannerDrag}
                    onDragEnter={onBannerDrag}
                    onDrop={onBannerDrop}
                    style={{
                      marginBottom: 10,
                      padding: '10px 12px',
                      border: '1px dashed var(--primary, #3b82f6)',
                      borderRadius: 8,
                      background: '#f8fafc',
                      color: '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12
                    }}
                    title="Drop files here to upload to the selected folder"
                  >
                    <span>📥 Drop here to upload to this folder</span>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: 'white',
                        border: '1px solid var(--primary, #3b82f6)',
                        color: 'var(--primary, #3b82f6)',
                        fontSize: 12,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                      }}
                    >
                      {(currentPath || '/').replace(/^\/files\/?/, '/PNLM/')}
                    </span>
                  </div>
                )}
                <FolderTree currentPath={currentPath} onPathChange={setCurrentPath} refreshTrigger={refreshTrigger} userRole={userRole} onFileSelect={handleFileSelect} filesOnly={true} />
                {userRole !== 'viewer' && (
                  <div style={{ marginTop: 12 }}>
                    <button className="action-btn" onClick={() => setCollapseUploader(v => !v)}>
                      {collapseUploader ? '▼' : '▲'} Upload panel
                    </button>
                    {!collapseUploader && (
                      <div style={{ marginTop: 8 }}>
                        <FileUploader currentPath={currentPath} onUploadComplete={() => { setDroppedFiles([]); refreshFiles(); }} userRole={userRole} seedFiles={droppedFiles} />
                      </div>
                    )}
                  </div>
                )}
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

  {/* Modal removed; using collapsible uploader panel instead */}
    </div>
  );
};

export default Dashboard;
