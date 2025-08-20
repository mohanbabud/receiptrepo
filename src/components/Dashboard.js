import React, { useState, useCallback, useEffect, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth } from '../firebase';
import FolderTree from './FolderTree';
import FileUploader from './FileUploader';
import FilePreview from './FilePreview';
import StatusBar from './StatusBar';
import './Dashboard.css';

import ThemeToggle from './ThemeToggle';
import AccentToggle from './AccentToggle';
import PresetToggle from './PresetToggle';
import ChangePasswordModal from './ChangePasswordModal';

const Dashboard = ({ user, userRole, theme, setTheme, accent, setAccent, preset, setPreset }) => {
  // No left sidebar path sync; Files view controls the path
  const [currentPath, setCurrentPath] = useState('/files/');
  const [selectedFile, setSelectedFile] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Focus the UI on folders/files, remove alternate views
  const [collapseUploader, setCollapseUploader] = useState(true);
  const [droppedFiles, setDroppedFiles] = useState([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dragOverlayVisible, setDragOverlayVisible] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const dragCounterRef = useRef(0);
  const uploaderPanelRef = useRef(null);
  const gridRef = useRef(null);
  const [isResizing, setIsResizing] = useState(false);
  // Desktop/mobile specific behavior is handled in CSS
  const [previewWidth, setPreviewWidth] = useState(0); // px, measured for right panel
  const PREVIEW_MIN = 320;
  const PREVIEW_MAX_HARD = 720;
  // Toggle to show/hide folders in the Files section (read-only users still need to see folders)
  // Default ON for all roles so viewers can browse folder hierarchy.
  const [showFolders, setShowFolders] = useState(true);
  // (Removed effect that previously hid folders for viewer role.)
  // removed unused previewBackdropVisible state

  const handleLogout = async () => {
    try {
      await signOut(auth);
  setMobileMenuOpen(false);
  setUserMenuOpen(false);
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

  // Removed: header-level Upload/Create actions; use the Upload panel and FolderTree controls instead

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

  // No left sidebar; Escape handling remains for modals handled within components

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

  // Sidebar resizer removed

  // No-op: responsive handled via CSS media queries

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

  // Jump to a path requested by TagSearchPage
  useEffect(() => {
    try {
      const key = 'jumpToPath';
      const v = localStorage.getItem(key);
      if (v && typeof v === 'string') {
        localStorage.removeItem(key);
        if (v.startsWith('/files/')) setCurrentPath(v);
      }
    } catch {}
  }, []);

  // Close user menu on outside click/escape
  useEffect(() => {
    if (!userMenuOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setUserMenuOpen(false); };
    const onClick = (e) => {
      const el = document.querySelector('.user-menu');
      if (el && !el.contains(e.target)) setUserMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [userMenuOpen]);

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
            <Link to="/search" className="admin-link" title="Open Receipt Search">🔎 Search</Link>
            {/* Compact user menu on the far right */}
            <div className="user-menu" style={{ position: 'relative' }}>
              <button
                className="user-menu-button"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen(v => !v)}
                title="Account menu"
              >
                {user?.email || 'Account'} ▾
              </button>
              {userMenuOpen && (
                <div className="user-menu-list" role="menu" aria-label="Account">
                  {userRole === 'admin' && (
                    <Link to="/admin" className="user-menu-item" role="menuitem" onClick={() => setUserMenuOpen(false)}>🛠️ Admin Panel</Link>
                  )}
                  <button className="user-menu-item" role="menuitem" onClick={() => { setShowChangePw(true); setUserMenuOpen(false); }}>🔑 Change Password</button>
                  <button className="user-menu-item danger" role="menuitem" onClick={handleLogout}>� Logout</button>
                </div>
              )}
            </div>
          </div>
          {userRole === 'viewer' && (
            <button
              onClick={async () => {
                try {
                  // Prevent duplicate requests by checking localStorage flag quickly (optimistic)
                  const flagKey = 'upgradeRequested:' + (user?.uid || '');
                  if (localStorage.getItem(flagKey)) {
                    alert('Upgrade request already submitted.');
                    return;
                  }
                  const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
                  // Firestore dynamic import not needed for doc/collection (already imported in other files) but ensure safety
                  const { db } = await import('../firebase');
                  // Add a request document
                  await addDoc(collection(db, 'requests'), {
                    type: 'role-upgrade',
                    requestedBy: user.uid,
                    requestedEmail: user.email,
                    requestedAt: serverTimestamp(),
                    status: 'pending',
                    fromRole: 'viewer',
                    desiredRole: 'user'
                  });
                  localStorage.setItem(flagKey, '1');
                  alert('Upgrade request submitted. An admin will review it.');
                } catch (e) {
                  console.error('Upgrade request error', e);
                  alert('Failed to submit upgrade request.');
                }
              }}
              className="logout-btn"
              style={{ background: '#2563eb' }}
            >Request Upload Access</button>
          )}
          {/* Replaced with compact user menu above */}
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
                onClick={() => { setShowChangePw(true); setMobileMenuOpen(false); }}
                role="menuitem"
              >
                🔑 Change Password
              </button>
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
      <div
        className="main-content"
      >
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
                    <span>Show Folders</span>
                  </label>
                  {userRole !== 'viewer' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                      <button className="action-btn upload-files" onClick={() => setCollapseUploader(v => !v)}>
                        {collapseUploader ? '📤 Upload Files' : '▲ Close Upload'}
                      </button>
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
                {/* Removed secondary drop banner to avoid duplicate upload entry points */}
                <FolderTree
                  currentPath={currentPath}
                  onPathChange={setCurrentPath}
                  refreshTrigger={refreshTrigger}
                  userRole={userRole}
                  onFileSelect={handleFileSelect}
                  filesOnly={!showFolders}
                />
                {userRole !== 'viewer' && !collapseUploader && (
                  <div style={{ marginTop: 12 }} ref={uploaderPanelRef}>
                    <FileUploader currentPath={currentPath} onUploadComplete={() => { setDroppedFiles([]); refreshFiles(); }} userRole={userRole} seedFiles={droppedFiles} />
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

  <ChangePasswordModal open={showChangePw} onClose={() => setShowChangePw(false)} />

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
