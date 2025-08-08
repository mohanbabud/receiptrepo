import React, { useState } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth, storage, db } from '../firebase';
import FolderTree from './FolderTree';
import FileUploader from './FileUploader';
import FilePreview from './FilePreview';
import RequestPanel from './RequestPanel';
import StorageTreeView from './StorageTreeView';
import StorageManager from './StorageManager';
import AdminSetup from './AdminSetup';
import './Dashboard.css';

const Dashboard = ({ user, userRole }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFile, setSelectedFile] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'tree'
  const [storageStats, setStorageStats] = useState({
    folderCount: 0,
    fileCount: 0,
    totalSize: 0
  });

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
    // Create a temporary file input to trigger file selection
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        // This would typically trigger the upload process
        // For now, we'll just refresh
        setRefreshTrigger(prev => prev + 1);
      }
    };
    input.click();
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const updateStorageStats = (stats) => {
    setStorageStats(stats);
  };

  return (
    <div className="dashboard">
      <header className="header">
        <h1>Firebase File Manager</h1>
        <div className="header-info">
          <div className="user-info">
            <span>Welcome, {user.email}</span>
            <span className={`role-badge ${userRole}`}>{userRole}</span>
          </div>
          {userRole === 'admin' && (
            <Link to="/admin" className="admin-link">Admin Panel</Link>
          )}
          <Link to="/tree-view" className="tree-view-link">🌳 Full Tree View</Link>
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>
      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-section">
            <h3>Current Location</h3>
            <div className="current-location">
              <span className="location-icon">📍</span>
              <span className="location-path">{currentPath === '/' ? '' : currentPath}</span>
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Quick Stats</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-icon">📁</span>
                <div className="stat-info">
                  <span className="stat-number">{storageStats.folderCount}</span>
                  <span className="stat-label">Folders</span>
                </div>
              </div>
              <div className="stat-item">
                <span className="stat-icon">📄</span>
                <div className="stat-info">
                  <span className="stat-number">{storageStats.fileCount}</span>
                  <span className="stat-label">Files</span>
                </div>
              </div>
              <div className="stat-item">
                <span className="stat-icon">💾</span>
                <div className="stat-info">
                  <span className="stat-number">{formatBytes(storageStats.totalSize)}</span>
                  <span className="stat-label">Storage Used</span>
                </div>
              </div>
              <div className="stat-item">
                <span className="stat-icon">👤</span>
                <div className="stat-info">
                  <span className="stat-number">{userRole}</span>
                  <span className="stat-label">Role</span>
                </div>
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Quick Actions</h3>
            <div className="quick-actions">
              {userRole !== 'viewer' && (
                <>
                  <button className="action-btn create-folder" onClick={handleCreateFolder}>
                    <span className="action-icon">📁+</span>
                    <span>New Folder</span>
                  </button>
                  <button className="action-btn upload-files" onClick={handleUploadFiles}>
                    <span className="action-icon">📤</span>
                    <span>Upload Files</span>
                  </button>
                </>
              )}
              <button className="action-btn refresh-all" onClick={() => setRefreshTrigger(prev => prev + 1)}>
                <span className="action-icon">🔄</span>
                <span>Refresh All</span>
              </button>
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Recent Activity</h3>
            <div className="recent-activity">
              <div className="activity-item">
                <span className="activity-icon">📁</span>
                <div className="activity-info">
                  <span className="activity-text">Created folder "Jogipet"</span>
                  <span className="activity-time">2 hours ago</span>
                </div>
              </div>
              <div className="activity-item">
                <span className="activity-icon">📁</span>
                <div className="activity-info">
                  <span className="activity-text">Created folder "Aler"</span>
                  <span className="activity-time">3 hours ago</span>
                </div>
              </div>
              <div className="activity-item">
                <span className="activity-icon">📁</span>
                <div className="activity-info">
                  <span className="activity-text">Created folder "Sadasivpet"</span>
                  <span className="activity-time">1 day ago</span>
                </div>
              </div>
            </div>
          </div>
          
        </aside>

        <div className="content">
          <div className="main-grid">
            <section className="main-area">
              <div className="tree-view-header">
                <h2>File Manager</h2>
                <div className="path-info">
                  <span>Path: <strong>{currentPath === '/' ? '' : currentPath}</strong></span>
                  <span>Role: <strong>{userRole}</strong></span>
                </div>
                <div className="view-controls">
                  <button className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>📋 List</button>
                  <button className={`view-btn ${viewMode === 'tree' ? 'active' : ''}`} onClick={() => setViewMode('tree')}>🌳 Tree</button>
                </div>
              </div>
              <div className="main-tree-content">
                {viewMode === 'list' ? (
                  <FolderTree currentPath={currentPath} onPathChange={setCurrentPath} />
                ) : (
                  <StorageTreeView currentPath={currentPath} onFolderSelect={setCurrentPath} refreshTrigger={refreshTrigger} onStatsUpdate={updateStorageStats} />
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
                <>
                  {userRole !== 'viewer' && (
                    <div className="panel">
                      <h3>Upload Files</h3>
                      <FileUploader currentPath={currentPath} onUploadComplete={refreshFiles} userRole={userRole} />
                    </div>
                  )}
                  {userRole === 'user' && (
                    <div className="panel">
                      <h3>Requests</h3>
                      <RequestPanel userId={user.uid} refreshTrigger={refreshTrigger} />
                    </div>
                  )}
                  {userRole === 'admin' && (
                    <div className="panel">
                      <h3>Storage Tools</h3>
                      <StorageManager onStructureChange={refreshFiles} />
                    </div>
                  )}
                  {userRole !== 'admin' && (
                    <div className="panel">
                      <AdminSetup user={user} />
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
