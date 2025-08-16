/* eslint-disable react-hooks/rules-of-hooks */
import React, { useEffect, useState, useMemo } from 'react';
import { deleteObject, ref, getDownloadURL, getMetadata } from 'firebase/storage';
import { doc, deleteDoc, addDoc, collection, updateDoc } from 'firebase/firestore';
import { storage, db } from '../firebase';
import { FaTimes, FaDownload, FaTrash, FaEdit, FaExpand, FaCompress } from 'react-icons/fa';
import './FilePreview.css';

const FilePreview = ({ file, onClose, userRole, userId, onFileAction }) => {
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState(file.originalName || file.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [details, setDetails] = useState({ url: file.downloadURL, type: file.type, size: file.size, uploadedAt: file.uploadedAt, fullPath: file.fullPath });
  const [textPreview, setTextPreview] = useState(null);
  const [imageFit, setImageFit] = useState('contain'); // 'contain' | 'cover'
  const isPlaceholder = file.name === '.folder-placeholder' || file.name === '.folder_placeholder' || file.name === '.keep';

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
  const extMime = useMemo(() => inferMimeFromName(file?.name), [file?.name]);
  const effectiveType = useMemo(() => {
    const raw = (details?.type || file?.type || '').toLowerCase();
    if (!raw || raw === 'application/octet-stream') return (extMime || raw);
    return raw;
  }, [details?.type, file?.type, extMime]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Resolve full path for Storage fetches
        const full = file.fullPath || file?.ref?.fullPath || (() => {
          let base = (file.path || '').replace(/^\/+/, '');
          if (!base || base === '/') base = 'files';
          if (base === 'files/' || base === '/files' || base === '/files/') base = 'files';
          if (!base.startsWith('files')) base = `files/${base}`;
          if (!base.endsWith('/')) base += '/';
          return `${base}${file.name}`;
        })();
        const r = ref(storage, full);
        const [meta, url] = await Promise.all([
          (async () => { try { return await getMetadata(r); } catch { return null; } })(),
          (async () => { try { return await getDownloadURL(r); } catch { return null; } })()
        ]);
        if (!mounted) return;
        setDetails({
          url: url || file.downloadURL,
          type: meta?.contentType || file.type,
          size: typeof meta?.size === 'number' ? meta.size : file.size,
          uploadedAt: meta?.updated ? new Date(meta.updated) : file.uploadedAt,
          fullPath: full
        });
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, [file]);

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
    const url = details.url || file.downloadURL;
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
          fileId: file.id,
          fileName: file.name,
          filePath: file.path,
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
    if (window.confirm(`Are you sure you want to delete "${file.name}"?`)) {
      setLoading(true);
      try {
        // Resolve a safe, non-root storage path
        const buildFullPath = () => {
          let fp = file.fullPath || file?.ref?.fullPath || '';
          if (!fp) {
            let base = (file.path || '').trim();
            base = base.replace(/^\/+/, ''); // drop leading '/'
            if (base === '' || base === '/') base = 'files';
            if (base === 'files/' || base === '/files' || base === '/files/') base = 'files';
            if (!base.startsWith('files')) base = `files/${base}`;
            if (!base.endsWith('/')) base += '/';
            fp = `${base}${file.name}`;
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
        if (!file.isStorageFile && file.id) {
          try { await deleteDoc(doc(db, 'files', file.id)); } catch (_) {}
        }
        
        // Notify outer UI (FolderTree) to show a success popup, then refresh and close
        try {
          const msg = `"${file.name}" deleted successfully!`;
          window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: msg } }));
          // Also broadcast a storage-meta-refresh for the parent folder so any open views reload
          const parent = (() => {
            const fp = (details?.fullPath || file.fullPath || file?.ref?.fullPath || '').replace(/^\/+/, '');
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
          fileId: file.id,
          fileName: file.name,
          newFileName: newName,
          filePath: file.path,
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
      await updateDoc(doc(db, 'files', file.id), {
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

  const renderPreview = () => {
    const t = (effectiveType || '').toLowerCase();
    // Images
    if (t.startsWith('image/')) {
      return (
        <div className="image-preview">
          {details.url ? (
            <img src={details.url} alt={file.name} className={`fit-${imageFit}`} draggable={false} />
          ) : (
            <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>
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
                <h2>{file.name}</h2>
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
              <span>Type: {details.type || file.type || 'Unknown'}</span>
              <span>Uploaded: {details.uploadedAt?.toLocaleDateString?.() || file.uploadedAt?.toDate?.()?.toLocaleDateString() || 'Unknown'}</span>
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