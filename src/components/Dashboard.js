import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ref, uploadString } from 'firebase/storage';
import { signOut } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth, storage } from '../firebase';
import FolderTree from './FolderTree';
import FileUploader from './FileUploader';
import FilePreview from './FilePreview';
import StorageTreeView from './StorageTreeView';
import StatusBar from './StatusBar';
import './Dashboard.css';

import ThemeToggle from './ThemeToggle';
import AccentToggle from './AccentToggle';
import PresetToggle from './PresetToggle';

const Dashboard = ({ user, userRole, theme, setTheme, accent, setAccent, preset, setPreset }) => {
  // Normalize any incoming path to '/files/.../' format used by FolderTree
  const normalizeFilesPath = useCallback((input) => {
    let p = String(input || '').replace(/\\/g, '/');
    if (!p) return '/files/';
    if (!p.startsWith('/')) p = '/' + p;
    // Ensure it starts with '/files/'
    if (!p.startsWith('/files/')) {
      if (p === '/files') p = '/files/';
      else if (p.startsWith('/files')) p = p.replace('/files', '/files');
      else p = '/files' + (p === '/' ? '/' : p);
    }
    if (!p.endsWith('/')) p += '/';
    return p.replace(/\/+/g, '/');
  }, []);
  const [currentPath, setCurrentPath] = useState('/files/');
  const [selectedFile, setSelectedFile] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Focus the UI on folders/files, remove alternate views
  const [collapseUploader, setCollapseUploader] = useState(true);
  const [droppedFiles, setDroppedFiles] = useState([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragOverlayVisible, setDragOverlayVisible] = useState(false);
  const dragCounterRef = useRef(0);
  const uploaderPanelRef = useRef(null);
  const gridRef = useRef(null);
  const [isResizing, setIsResizing] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(0); // px, measured for right panel
  const PREVIEW_MIN = 320;
  const PREVIEW_MAX_HARD = 720;
  // Toggle to show/hide folders in the Files section
  // Default ON for 'user' and 'admin', OFF for 'viewer'
  const [showFolders, setShowFolders] = useState(userRole !== 'viewer');

  useEffect(() => {
    setShowFolders(userRole !== 'viewer');
  }, [userRole]);
  // removed unused previewBackdropVisible state

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
    if (
      file.name === '.folder-placeholder' ||
      file.name === '.folder_placeholder' ||
      file.name === '.keep'
    ) return;
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
  // Use a tiny non-empty payload for consistency in listings
  await uploadString(keepRef, 'keep', 'raw', { contentType: 'text/plain' });
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

  // Auto-scroll uploader panel into view when expanded
  useEffect(() => {
    if (!collapseUploader && uploaderPanelRef.current) {
      try { uploaderPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
    }
  }, [collapseUploader]);

  // Global drag-and-drop overlay to make uploads easier regardless of scroll
  useEffect(() => {
    if (userRole === 'viewer') return; // no uploads for viewers
    const hasFiles = (e) => Array.from(e?.dataTransfer?.types || []).includes('Files');
    const onWindowDragEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setDragOverlayVisible(true);
    };
    const onWindowDragOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOverlayVisible(true);
    };
    const onWindowDragLeave = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setDragOverlayVisible(false);
    };
    const onWindowDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) {
        setDroppedFiles(files);
        setCollapseUploader(false);
      }
      dragCounterRef.current = 0;
      setDragOverlayVisible(false);
    };
    window.addEventListener('dragenter', onWindowDragEnter);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragenter', onWindowDragEnter);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [userRole]);

  // Close mobile sidebar with Escape key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // (stats UI removed)

  // Initialize preview width the first time a file is selected (or when grid mounts)
  useEffect(() => {
    if (selectedFile && gridRef.current && !previewWidth) {
      const rect = gridRef.current.getBoundingClientRect();
      const initial = Math.max(PREVIEW_MIN, Math.min(Math.floor(rect.width * 0.32), 520));
      setPreviewWidth(initial);
    }
  }, [selectedFile, previewWidth]);

  const clampPreviewWidth = useCallback((w) => {
    if (!gridRef.current) return Math.max(PREVIEW_MIN, Math.min(w, PREVIEW_MAX_HARD));
    const rect = gridRef.current.getBoundingClientRect();
    const resizerWidth = 6; // matches CSS
    const minMain = 520; // ensure Files keeps reasonable space
    const maxAllowed = Math.min(PREVIEW_MAX_HARD, Math.max(PREVIEW_MIN, rect.width - resizerWidth - minMain));
    return Math.max(PREVIEW_MIN, Math.min(w, maxAllowed));
  }, []);

  const onResizerMove = useCallback((clientX) => {
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const newW = rect.right - clientX; // width from cursor to right edge
    setPreviewWidth(prev => clampPreviewWidth(newW || prev));
  }, [clampPreviewWidth]);

  const onResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    const onMove = (ev) => onResizerMove(ev.clientX);
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onResizerMove]);

  const onResizerTouchStart = useCallback((e) => {
    if (!e.touches || !e.touches.length) return;
    setIsResizing(true);
    const onMove = (ev) => {
      if (ev.touches && ev.touches.length) onResizerMove(ev.touches[0].clientX);
    };
    const onEnd = () => {
      setIsResizing(false);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
  }, [onResizerMove]);

  const onResizerKeyDown = useCallback((e) => {
    const STEP = e.shiftKey ? 32 : 16;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPreviewWidth((w) => clampPreviewWidth((w || PREVIEW_MIN) + STEP));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPreviewWidth((w) => clampPreviewWidth((w || PREVIEW_MIN) - STEP));
    }
  }, [clampPreviewWidth]);

  return (
    <div className="dashboard">
  <a href="#main-content" className="skip-link">Skip to content</a>
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <h1>Receipt Manager</h1>
          {/* Top header actions removed; Files section provides upload/refresh/create controls */}
          {/* Mobile menu toggle (visible on small screens) */}
          <button
            className="mobile-menu-toggle"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => {
              setMobileMenuOpen(v => !v);
              setSidebarOpen(v => !v);
            }}
          >
            ☰
          </button>
        </div>
        <div className="header-info" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="user-info">
            <span>Welcome, {user.email}</span>
            <span className={`role-badge ${userRole}`}>{userRole}</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <ThemeToggle theme={theme} setTheme={setTheme} />
            <AccentToggle accent={accent} setAccent={setAccent} />
            <PresetToggle preset={preset} setPreset={setPreset} />
            <StatusBar />
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
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-section">
            <h3>Folders</h3>
            <StorageTreeView
              currentPath={currentPath.replace(/^\/+/, '')}
              onFolderSelect={(path) => {
                const normalized = normalizeFilesPath(path);
                setCurrentPath(normalized);
                if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
                  setSidebarOpen(false);
                }
              }}
              refreshTrigger={refreshTrigger}
              userRole={userRole}
            />
          </div>
          
  </aside>
  {/* Backdrop to close off-canvas sidebar on mobile */}
  {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

  <div className="content" id="main-content">
          <div
            ref={gridRef}
            className={`main-grid ${selectedFile ? 'has-preview' : ''} ${isResizing ? 'resizing' : ''}`}
            style={selectedFile && previewWidth ? { gridTemplateColumns: `1fr 6px ${previewWidth}px` } : undefined}
          >
            <section className="main-area">
              <div className="tree-view-header">
                <h2>Files</h2>
                <div className="path-info" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {/* Show folders toggle */}
                  <label
                    className="toggle-inline"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    title="Show/hide folders in the Files section"
                  >
                    <input
                      type="checkbox"
                      checked={showFolders}
                      onChange={(e) => setShowFolders(e.target.checked)}
                      aria-label="Show folders in Files view"
                    />
                    <span>Show folders</span>
                  </label>
                  {userRole !== 'viewer' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                      <button className="action-btn upload-files" onClick={handleUploadFiles}>📤 Upload Files</button>
                      <button className="action-btn create-folder" onClick={handleCreateSubfolder}>📁 Create subfolder</button>
                      <button className="action-btn refresh-all" onClick={() => setRefreshTrigger(prev => prev + 1)}>🔄 Refresh</button>
                    </div>
                  )}
                </div>
              </div>
              <div
                className="main-tree-content"
                onDragOver={userRole !== 'viewer' ? onBannerDrag : undefined}
                onDragEnter={userRole !== 'viewer' ? onBannerDrag : undefined}
                onDrop={userRole !== 'viewer' ? onBannerDrop : undefined}
              >
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
                  </div>
                )}
                <FolderTree
                  currentPath={currentPath}
                  onPathChange={setCurrentPath}
                  refreshTrigger={refreshTrigger}
                  userRole={userRole}
                  onFileSelect={handleFileSelect}
                  filesOnly={!showFolders}
                />
                {userRole !== 'viewer' && (
                  <div style={{ marginTop: 12 }} ref={uploaderPanelRef}>
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

      {selectedFile && (
        <div
          className="grid-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview panel"
          tabIndex={0}
          onMouseDown={onResizerMouseDown}
          onTouchStart={onResizerTouchStart}
          onKeyDown={onResizerKeyDown}
        />
      )}

      <aside className="right-panel" onClick={(e) => {
        // On very small screens, clicking the backdrop around preview should close it
        if (window.innerWidth <= 480 && e.target.classList.contains('right-panel')) {
          setSelectedFile(null);
        }
      }}>
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
      {/* Global drag-and-drop overlay */}
      {userRole !== 'viewer' && dragOverlayVisible && (
        <div className="drop-overlay" onDragOver={onBannerDrag} onDrop={onBannerDrop}>
          <div className="drop-overlay-inner">
            <div className="drop-overlay-icon">📥</div>
            <div className="drop-overlay-text">Drop files to upload</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
