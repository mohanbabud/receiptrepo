/* eslint-disable react-hooks/rules-of-hooks */
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { deleteObject, ref, getDownloadURL, getMetadata, listAll } from 'firebase/storage';
import { doc, deleteDoc, addDoc, collection, updateDoc } from 'firebase/firestore';
import { storage, db } from '../firebase';
import { FaTimes, FaDownload, FaTrash, FaEdit, FaExpand, FaCompress } from 'react-icons/fa';
import './FilePreview.css';

const FilePreview = ({ file, onClose, userRole, userId, onFileAction }) => {
  const [loading, setLoading] = useState(false);
  const [activeFile, setActiveFile] = useState(file);
  const [newName, setNewName] = useState(file.originalName || file.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [details, setDetails] = useState({ url: file.downloadURL, type: file.type, size: file.size, uploadedAt: file.uploadedAt, fullPath: file.fullPath });
  const [textPreview, setTextPreview] = useState(null);
  const [imageFit, setImageFit] = useState('contain'); // 'contain' | 'cover'
  const [siblings, setSiblings] = useState([]); // Array<{ name, fullPath, ref }>
  const [siblingIndex, setSiblingIndex] = useState(-1);
  const [flipDir, setFlipDir] = useState(null); // 'next' | 'prev' | null
  const isPlaceholder = (activeFile?.name || file.name) === '.folder-placeholder' || (activeFile?.name || file.name) === '.folder_placeholder' || (activeFile?.name || file.name) === '.keep';
  const urlCacheRef = useRef(new Map()); // Map<fullPath, { url: string, ts: number }>

  // Keep activeFile in sync when prop changes
  useEffect(() => {
    setActiveFile(file);
    setNewName(file.originalName || file.name);
  }, [file]);

  // Helper: infer MIME from filename when metadata is missing or generic
  const inferMimeFromName = (name = '') => {
    const ext = String(name).toLowerCase().split('.').pop();
    switch (ext) {
      case 'pdf': return 'application/pdf';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      case 'avif': return 'image/avif';
      case 'svg': return 'image/svg+xml';
      case 'mp4': return 'video/mp4';
      case 'webm': return 'video/webm';
      case 'ogv':
      case 'ogg': return 'video/ogg';
      case 'mp3': return 'audio/mpeg';
      case 'wav': return 'audio/wav';
      case 'm4a': return 'audio/mp4';
      case 'csv': return 'text/csv';
      case 'txt':
      case 'log': return 'text/plain';
      case 'json': return 'application/json';
      case 'xml': return 'application/xml';
      case 'html':
      case 'htm': return 'text/html';
      case 'md': return 'text/markdown';
      default: return '';
    }
  };
  const extMime = useMemo(() => inferMimeFromName(activeFile?.name), [activeFile?.name]);
  const effectiveType = useMemo(() => {
    const raw = (details?.type || activeFile?.type || '').toLowerCase();
    if (!raw || raw === 'application/octet-stream') return (extMime || raw);
    return raw;
  }, [details?.type, activeFile?.type, extMime]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Resolve full path for Storage fetches
        const full = activeFile?.fullPath || activeFile?.ref?.fullPath || (() => {
          const f = activeFile || file;
          let base = (f.path || '').replace(/^\/+/, '');
          if (!base || base === '/') base = 'files';
          if (base === 'files/' || base === '/files' || base === '/files/') base = 'files';
          if (!base.startsWith('files')) base = `files/${base}`;
          if (!base.endsWith('/')) base += '/';
          return `${base}${(f.name)}`;
        })();
        const r = ref(storage, full);
        const [meta, url] = await Promise.all([
          (async () => { try { return await getMetadata(r); } catch { return null; } })(),
          (async () => { try { return await getDownloadURL(r); } catch { return null; } })()
        ]);
        if (!mounted) return;
        const nextDetails = {
          url: url || activeFile?.downloadURL || file.downloadURL,
          type: meta?.contentType || activeFile?.type || file.type,
          size: typeof meta?.size === 'number' ? meta.size : (activeFile?.size ?? file.size),
          uploadedAt: meta?.updated ? new Date(meta.updated) : (activeFile?.uploadedAt ?? file.uploadedAt),
          fullPath: full
        };
        setDetails(nextDetails);
        // Cache the current file URL for quicker back/forward navigation
        if (nextDetails.fullPath && nextDetails.url) {
          try {
            urlCacheRef.current.set(nextDetails.fullPath, { url: nextDetails.url, ts: Date.now() });
            // Keep cache small (up to 20 entries)
            if (urlCacheRef.current.size > 20) {
              const firstKey = urlCacheRef.current.keys().next().value;
              urlCacheRef.current.delete(firstKey);
            }
          } catch {}
        }
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, [activeFile]);

  // Build sibling JPG list for flipbook when viewing an image
  useEffect(() => {
    const t = (effectiveType || '').toLowerCase();
    const isImg = t.startsWith('image/') || /\.(jpg|jpeg)$/i.test(activeFile?.name || '');
    if (!isImg) { setSiblings([]); setSiblingIndex(-1); return; }
    let cancelled = false;
    (async () => {
      try {
        // Determine full path for the active file
        const f = activeFile || file;
        let full = (f?.fullPath || f?.ref?.fullPath || details?.fullPath || '').replace(/^\/+/, '');
        if (!full && f?.name) {
          // Rebuild from path + name as in the main details effect
          let base = (f.path || '').replace(/^\/+/, '');
          if (!base || base === '/') base = 'files';
          if (base === 'files/' || base === '/files' || base === '/files/') base = 'files';
          if (!base.startsWith('files')) base = `files/${base}`;
          if (!base.endsWith('/')) base += '/';
          full = `${base}${f.name}`;
        }
        const parent = full && full.includes('/') ? full.substring(0, full.lastIndexOf('/')) : 'files';
        const parentRef = ref(storage, parent);
        const res = await listAll(parentRef);
        // Filter to JPG/JPEG files only (as requested)
        const imgs = res.items
          .filter(it => /\.(jpg|jpeg)$/i.test(it.name))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
          .map(it => ({ name: it.name, fullPath: it.fullPath, ref: it }));
        if (cancelled) return;
        setSiblings(imgs);
        const idx = imgs.findIndex(i => i.name === (f?.name || ''));
        setSiblingIndex(idx);
      } catch (_) {
        if (!cancelled) { setSiblings([]); setSiblingIndex(-1); }
      }
    })();
    return () => { cancelled = true; };
  }, [activeFile?.name, activeFile?.fullPath, details?.fullPath, effectiveType]);

  // Fetch small text-based files for inline preview
  useEffect(() => {
    const t = (effectiveType || '').toLowerCase();
    setTextPreview(null);
    if (!details?.url) return;
    const isText = t.startsWith('text/') || t === 'application/json' || t === 'application/xml' || t === 'text/csv';
    if (!isText) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(details.url);
        if (!res.ok) return;
        const txt = await res.text();
        if (!cancelled) setTextPreview(txt);
      } catch (_) {
        // ignore fetch errors, fall back to generic info
      }
    })();
    return () => { cancelled = true; };
  }, [details.url, effectiveType]);

  // Auto-close placeholder files via effect to avoid conditional returns before hooks
  useEffect(() => {
    if (isPlaceholder && onClose) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaceholder]);

  const handleDownload = () => {
    const url = details.url || activeFile?.downloadURL || file.downloadURL;
    if (url) window.open(url, '_blank');
  };

  const handleDelete = async () => {
    if (userRole === 'viewer') {
      alert('You do not have permission to delete files');
      return;
    }

  if (userRole === 'user') {
      // Create delete request for admin approval
      try {
        await addDoc(collection(db, 'requests'), {
          type: 'delete',
      fileId: activeFile.id || file.id,
      fileName: activeFile.name || file.name,
      filePath: activeFile.path || file.path,
          requestedBy: userId,
          requestedAt: new Date(),
          status: 'pending'
        });
        alert('Delete request submitted for admin approval');
        onClose();
      } catch (error) {
        console.error('Error submitting delete request:', error);
        alert('Error submitting delete request');
      }
      return;
    }

    // Admin can delete directly
    if (window.confirm(`Are you sure you want to delete "${activeFile.name || file.name}"?`)) {
      setLoading(true);
      try {
        // Resolve a safe, non-root storage path
        const buildFullPath = () => {
          const f = activeFile || file;
          let fp = f.fullPath || f?.ref?.fullPath || '';
          if (!fp) {
            let base = (f.path || '').trim();
            base = base.replace(/^\/+/, ''); // drop leading '/'
            if (base === '' || base === '/') base = 'files';
            if (base === 'files/' || base === '/files' || base === '/files/') base = 'files';
            if (!base.startsWith('files')) base = `files/${base}`;
            if (!base.endsWith('/')) base += '/';
            fp = `${base}${f.name}`;
          }
          return fp.replace(/^\/+/, '');
        };

        const safeFullPath = buildFullPath();
        if (!safeFullPath || safeFullPath === '/' || safeFullPath === 'files' || safeFullPath === 'files/') {
          throw new Error('Invalid file path for deletion');
        }

        // Delete from Storage
        const fileRef = ref(storage, safeFullPath);
        await deleteObject(fileRef);
        
        // Delete from Firestore only if this is a Firestore-tracked file
        if (!(activeFile?.isStorageFile) && (activeFile?.id)) {
          try { await deleteDoc(doc(db, 'files', activeFile.id)); } catch (_) {}
        }
        
        // Notify outer UI (FolderTree) to show a success popup, then refresh and close
        try {
          const msg = `"${activeFile.name || file.name}" deleted successfully!`;
          window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: msg } }));
          // Also broadcast a storage-meta-refresh for the parent folder so any open views reload
          const parent = (() => {
            const fp = (details?.fullPath || activeFile?.fullPath || activeFile?.ref?.fullPath || file.fullPath || file?.ref?.fullPath || '').replace(/^\/+/, '');
            if (!fp || fp === 'files' || fp === 'files/') return 'files/';
            const parentPath = fp.substring(0, fp.lastIndexOf('/') + 1);
            return parentPath || 'files/';
          })();
          window.dispatchEvent(new CustomEvent('storage-meta-refresh', { detail: { prefix: parent } }));
        } catch (_) {}
        onFileAction();
        onClose();
      } catch (error) {
        console.error('Error deleting file:', error);
        alert('Error deleting file');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRename = async () => {
    if (userRole === 'viewer') {
      alert('You do not have permission to rename files');
      return;
    }

  if (userRole === 'user') {
      // Create rename request for admin approval
      try {
        await addDoc(collection(db, 'requests'), {
          type: 'rename',
      fileId: activeFile.id || file.id,
      fileName: activeFile.name || file.name,
          newFileName: newName,
      filePath: activeFile.path || file.path,
          requestedBy: userId,
          requestedAt: new Date(),
          status: 'pending'
        });
        alert('Rename request submitted for admin approval');
        setIsRenaming(false);
        onClose();
      } catch (error) {
        console.error('Error submitting rename request:', error);
        alert('Error submitting rename request');
      }
      return;
    }

    // Admin can rename directly (for simplicity, we'll just update the display name)
    try {
      await updateDoc(doc(db, 'files', activeFile.id), {
        name: newName,
        updatedAt: new Date()
      });
      onFileAction();
      setIsRenaming(false);
    } catch (error) {
      console.error('Error renaming file:', error);
      alert('Error renaming file');
    }
  };

  // Flipbook navigation helpers (images only)
  const canFlip = useMemo(() => {
    const isImg = String(effectiveType || '').startsWith('image/') || /\.(jpg|jpeg)$/i.test(activeFile?.name || '');
    return !!(siblings && siblings.length > 1 && isImg);
  }, [siblings, effectiveType, activeFile?.name]);
  const gotoSibling = useCallback(async (next = true) => {
    if (!canFlip || siblingIndex < 0 || !siblings || siblings.length === 0) return;
    const newIdx = (siblingIndex + (next ? 1 : -1) + siblings.length) % siblings.length;
    setFlipDir(next ? 'next' : 'prev');
    try {
      const target = siblings[newIdx];
      const parentPath = (() => {
        const fp = target.fullPath.replace(/^\/+/, '');
        const last = fp.lastIndexOf('/');
        if (last === -1) return '/files/';
        return '/' + fp.substring(0, last + 1);
      })();
      // If we have a cached URL, use it immediately to reduce flicker
      const cached = urlCacheRef.current.get(target.fullPath);
      setActiveFile({ name: target.name, path: parentPath, fullPath: target.fullPath, ref: ref(storage, target.fullPath), isStorageFile: true });
      if (cached?.url) {
        setDetails(d => ({ ...d, url: cached.url }));
      }
      setSiblingIndex(newIdx);
    } finally {
      setTimeout(() => setFlipDir(null), 350);
    }
  }, [canFlip, siblingIndex, siblings]);
  const onNext = useCallback(() => gotoSibling(true), [gotoSibling]);
  const onPrev = useCallback(() => gotoSibling(false), [gotoSibling]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (!canFlip) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); onNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canFlip, onNext, onPrev]);

  // Preload next and previous images to warm cache
  useEffect(() => {
    if (siblingIndex < 0 || !siblings || siblings.length === 0) return;
    const idxs = new Set([
      (siblingIndex + 1) % siblings.length,
      (siblingIndex - 1 + siblings.length) % siblings.length,
    ]);
    idxs.forEach((i) => {
      const item = siblings[i];
      if (!item || !item.fullPath) return;
      const cached = urlCacheRef.current.get(item.fullPath);
      if (cached?.url) {
        // Already cached; still warm the browser image cache
        try { const im = new Image(); im.src = cached.url; } catch {}
        return;
      }
      (async () => {
        try {
          const u = await getDownloadURL(ref(storage, item.fullPath));
          urlCacheRef.current.set(item.fullPath, { url: u, ts: Date.now() });
          try { const im = new Image(); im.src = u; } catch {}
          // Trim cache if too big
          if (urlCacheRef.current.size > 20) {
            const firstKey = urlCacheRef.current.keys().next().value;
            urlCacheRef.current.delete(firstKey);
          }
        } catch {}
      })();
    });
  }, [siblingIndex, siblings]);

  const renderPreview = () => {
    const t = (effectiveType || '').toLowerCase();
    // Images
    if (t.startsWith('image/')) {
      return (
        <div className="image-preview">
          <div className={`flipbook ${flipDir ? (flipDir === 'next' ? 'flip-next' : 'flip-prev') : ''}`} onClick={canFlip ? onNext : undefined} title={canFlip ? 'Click to go to next image' : undefined}>
            {details.url ? (
              <img src={details.url} alt={activeFile?.name || file.name} className={`fit-${imageFit}`} draggable={false} />
            ) : (
              <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>
            )}
          </div>
          {canFlip && (
            <>
              <button className="nav-arrow nav-left" onClick={(e) => { e.stopPropagation(); onPrev(); }} aria-label="Previous image">❮</button>
              <button className="nav-arrow nav-right" onClick={(e) => { e.stopPropagation(); onNext(); }} aria-label="Next image">❯</button>
            </>
          )}
        </div>
      );
    }
    // PDFs
    if (t === 'application/pdf') {
      return (
        <div className="pdf-preview">
          {details.url ? (
            <iframe title={file.name} src={`${details.url}#toolbar=0&navpanes=0`} />
          ) : (
            <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>
          )}
        </div>
      );
    }
    // Video
    if (t.startsWith('video/')) {
      return (
        <div style={{ width: '100%' }}>
          {details.url ? (
            <video src={details.url} controls style={{ width: '100%', maxHeight: 520, borderRadius: 8 }} />
          ) : (
            <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>
          )}
        </div>
      );
    }
    // Audio
    if (t.startsWith('audio/')) {
      return (
        <div style={{ width: '100%', textAlign: 'center' }}>
          {details.url ? (
            <audio src={details.url} controls style={{ width: '100%' }} />
          ) : (
            <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>
          )}
        </div>
      );
    }
    // Text-like
    if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml' || t === 'text/csv') {
      return (
        <div style={{ width: '100%' }}>
          {textPreview ? (
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f4f6', padding: 12, borderRadius: 8, maxHeight: 520, overflow: 'auto' }}>{textPreview}</pre>
          ) : details.url ? (
            <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>
          ) : (
            <div style={{ padding: 12, color: '#666' }}>Preview unavailable</div>
          )}
        </div>
      );
    }
    // Fallback – generic info
    return (
      <div className="preview-generic-content">
        <h3>File Information</h3>
        <p><strong>Name:</strong> {file.name}</p>
        <p><strong>Type:</strong> {details.type || file.type || 'Unknown'}</p>
        <p><strong>Size:</strong> {typeof details.size === 'number' ? (details.size / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}</p>
        <p><strong>Uploaded:</strong> {details.uploadedAt?.toLocaleDateString?.() || file.uploadedAt?.toDate?.()?.toLocaleDateString() || 'Unknown'}</p>
        <p><strong>Path:</strong> {file.path}</p>
        <p className="preview-note">Preview not available for this file type</p>
      </div>
    );
  };

  return (
      <div className="file-preview-overlay">
        <div className="file-preview">
          <div className="preview-header">
            <div className="file-title">
              {isRenaming ? (
                <div className="rename-input">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleRename()}
                  />
                  <button onClick={handleRename} className="save-btn">Save</button>
                  <button onClick={() => setIsRenaming(false)} className="cancel-btn">Cancel</button>
                </div>
              ) : (
                <h2>{activeFile?.name || file.name}</h2>
              )}
            </div>
            <div className="preview-actions">
              {/* Image Fit/Fill toggle (only for images) */}
              {String(effectiveType || '').toLowerCase().startsWith('image/') && (
                <button
                  onClick={() => setImageFit(f => (f === 'contain' ? 'cover' : 'contain'))}
                  className="action-btn"
                  title={imageFit === 'contain' ? 'Switch to Fill (cover)' : 'Switch to Fit (contain)'}
                >
                  {imageFit === 'contain' ? <FaExpand /> : <FaCompress />}
                </button>
              )}
              {String(effectiveType || '').toLowerCase().startsWith('image/') && canFlip && (
                <span style={{ alignSelf: 'center', color: '#6b7280', fontSize: 12 }}>
                  {siblingIndex + 1} / {siblings.length}
                </span>
              )}
              <button onClick={handleDownload} className="action-btn download" title="Download">
                <FaDownload />
              </button>
              {userRole !== 'viewer' && !isRenaming && (
                <button 
                  onClick={() => setIsRenaming(true)} 
                  className="action-btn rename" 
                  title="Rename"
                  disabled={loading}
                >
                  <FaEdit />
                </button>
              )}
              {userRole === 'admin' && !isRenaming && (
                <button 
                  onClick={handleDelete} 
                  className="action-btn delete" 
                  title="Delete"
                  disabled={loading}
                >
                  <FaTrash />
                </button>
              )}
              <button onClick={onClose} className="action-btn close" title="Close">
                <FaTimes />
              </button>
            </div>
          </div>
          <div className="preview-content">
            {renderPreview()}
          </div>
          <div className="preview-footer">
            <div className="file-metadata">
              <span>Size: {typeof details.size === 'number' ? (details.size / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}</span>
              <span>Type: {details.type || activeFile?.type || file.type || 'Unknown'}</span>
              <span>
                Uploaded: {
                  details.uploadedAt?.toLocaleDateString?.() ||
                  (typeof activeFile?.uploadedAt?.toDate === 'function' ? activeFile.uploadedAt.toDate().toLocaleDateString() : undefined) ||
                  (typeof file.uploadedAt?.toDate === 'function' ? file.uploadedAt.toDate().toLocaleDateString() : undefined) ||
                  'Unknown'
                }
              </span>
              {userRole === 'user' && (
                <span className="note">Note: File operations require admin approval</span>
              )}
            </div>
          </div>
        </div>
      </div>
  );
};

export default FilePreview;