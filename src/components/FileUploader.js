import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { ref, uploadBytesResumable, getDownloadURL, getMetadata } from 'firebase/storage';
import { collection, addDoc, getDoc, doc, setDoc } from 'firebase/firestore';
import { storage, db, auth } from '../firebase';
import './FileUploader.css';

const DEFAULT_TAG_KEYS = ['ProjectName', 'Value', 'Reciepent', 'Date', 'ExpenseName'];

const FileUploader = ({ currentPath, onUploadComplete, userRole, seedFiles = [] }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadTasks, setUploadTasks] = useState({}); // key -> uploadTask
  const [uploadStatus, setUploadStatus] = useState({}); // key -> 'running'|'paused'|'done'|'error'|'canceled'
  // image optimization mode for JPEGs only: 'balanced' (resize+reencode), 'lossless' (strip metadata only), 'off'
  const [optMode, setOptMode] = useState(() => {
    try { return localStorage.getItem('uploader:optMode') || 'lossless'; } catch { return 'lossless'; }
  });
  const [compressPdf, setCompressPdf] = useState(() => {
    try { return localStorage.getItem('uploader:compressPdf') === '1'; } catch { return false; }
  }); // lossless PDF optimize
  const [optSummary, setOptSummary] = useState('');
  const folderInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  // const seededOnceRef = useRef(0);

  // Tags state (applied to all uploaded files in this batch)
  const [tagsRows, setTagsRows] = useState(DEFAULT_TAG_KEYS.map(k => ({ key: k, value: '' })));
  const [tagsError, setTagsError] = useState('');
  const buildTagsMap = useCallback((rows) => {
    const map = {};
    const seen = new Set();
    for (const r of (rows || [])) {
      const key = String(r.key || '').trim();
      if (!key) continue;
      if (/\s/.test(key)) throw new Error('Tag Name cannot contain spaces');
      if (seen.has(key)) throw new Error('Duplicate Tag Names are not allowed');
      seen.add(key);
      map[key] = String(r.value ?? '');
    }
    return map;
  }, []);

  // Ensure the authenticated user has a profile doc with an allowed role
  const ensureUserProfile = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return; // Not signed in; rules will block anyway downstream
    try {
      const uRef = doc(db, 'users', u.uid);
      const snap = await getDoc(uRef);
      if (!snap.exists()) {
        // Only allow creating non-admin roles from the client per rules
        const role = userRole === 'viewer' ? 'viewer' : 'user';
        await setDoc(uRef, {
          role,
          email: u.email || null,
          createdAt: new Date()
        }, { merge: true });
      }
    } catch (e) {
      // Non-fatal; uploads may still fail with clearer error below
      console.warn('ensureUserProfile failed:', e);
    }
  }, [userRole]);

  // Generate unique file ID
  const generateFileId = () => {
    return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  };

  // Helper: normalize base path under 'files/'
  const computeBase = (curPath) => {
    let base = (curPath || '').trim();
    base = base.replace(/^\/+/, '');
    if (base === '' || base === '/') base = 'files';
    if (base === 'files/' || base === '/files' || base === '/files/') base = 'files';
    if (base !== 'files' && !base.startsWith('files/')) base = `files/${base}`;
    return base.replace(/\\/g, '/').replace(/\/+$/, '');
  };

  // Lossless: strip metadata (EXIF/COM/Photoshop APP13) without re-encoding JPEG bitstream.
  // If parsing fails, returns the original file.
  const stripJpegMetadataLossless = useCallback(async (file) => {
    try {
      if (!file.type || file.type !== 'image/jpeg') return file;
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return file; // not SOI

      const out = [];
      // copy SOI
      out.push(0xFF, 0xD8);
      let i = 2;
      // iterate segments until SOS (FFDA), then copy the rest to keep image data intact
  while (i + 3 < buf.length) {
        // expect marker 0xFF??, allow fill bytes 0xFF
        if (buf[i] !== 0xFF) {
          // unexpected; bail out and return original
          return file;
        }
        let marker = buf[i + 1];
        // Skip padding 0xFFs
        while (marker === 0xFF && i + 2 < buf.length) {
          i += 1;
          marker = buf[i + 1];
        }

        // EOI: copy and stop
        if (marker === 0xD9) { // EOI
          out.push(0xFF, 0xD9);
          i += 2;
          break;
        }

        // Start of Scan: copy SOS header then all remaining bytes (entropy-coded data may contain 0xFF markers)
        if (marker === 0xDA) { // SOS
          if (i + 3 >= buf.length) return file;
          const len = (buf[i + 2] << 8) | buf[i + 3];
          // copy marker + length + SOS header payload
          for (let k = 0; k < 2 + len; k++) out.push(buf[i + k]);
          i += 2 + len;
          // copy the rest (scan data + EOI)
          for (; i < buf.length; i++) out.push(buf[i]);
          const optimized = new File([new Uint8Array(out)], file.name, { type: file.type, lastModified: Date.now() });
          return optimized.size < file.size ? optimized : file;
        }

        // Markers with payload length
        if (i + 3 >= buf.length) return file;
        const len = (buf[i + 2] << 8) | buf[i + 3];
        if (len < 2 || i + 2 + len > buf.length) return file; // malformed

        const isCOM = marker === 0xFE; // Comment
        const isAPP1 = marker === 0xE1; // APP1 (EXIF or XMP)
        const isAPP13 = marker === 0xED; // APP13 Photoshop IRB

        let strip = false;
        if (isCOM) {
          strip = true;
        } else if (isAPP13) {
          // strip Photoshop IRB (APP13)
          strip = true;
        } else if (isAPP1) {
          // Peek payload to distinguish EXIF vs XMP
          const payloadStart = i + 4; // skip marker+len
          const payloadLen = len - 2;
          if (payloadLen > 0 && payloadStart + payloadLen <= buf.length) {
            // Check for 'Exif\0\0'
            const isExif = payloadLen >= 6 &&
              buf[payloadStart + 0] === 0x45 && // E
              buf[payloadStart + 1] === 0x78 && // x
              buf[payloadStart + 2] === 0x69 && // i
              buf[payloadStart + 3] === 0x66 && // f
              buf[payloadStart + 4] === 0x00 &&
              buf[payloadStart + 5] === 0x00;
            if (isExif) {
              // Keep EXIF to preserve orientation and camera data
              strip = false;
            } else {
              // XMP typically begins with ASCII URI string
              const needle = 'http://ns.adobe.com/xap/1.0/';
              let matches = true;
              for (let t = 0; t < needle.length && t < payloadLen; t++) {
                if (buf[payloadStart + t] !== needle.charCodeAt(t)) { matches = false; break; }
              }
              strip = matches; // strip XMP
            }
          }
        }

        if (!strip) {
          // keep this segment
          for (let k = 0; k < 2 + len; k++) out.push(buf[i + k]);
        }
        i += 2 + len;
      }
      // If we exited loop without SOS, fall back to original
      return file;
    } catch (e) {
      console.warn('Lossless JPEG metadata strip failed, using original', e);
      return file;
    }
  }, []);

  // Lossless PDF optimization: reload and re-save pages without re-encoding images.
  const optimizePdfLossless = useCallback(async (file) => {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const src = await PDFDocument.load(await file.arrayBuffer());
      const dst = await PDFDocument.create();
      const pages = await dst.copyPages(src, src.getPageIndices());
      pages.forEach(p => dst.addPage(p));
      // Optionally clear document metadata to save a few bytes
      try { dst.setTitle(''); dst.setAuthor(''); dst.setSubject(''); dst.setKeywords([]); dst.setProducer(''); dst.setCreator(''); } catch (_) {}
      const newBytes = await dst.save();
      const out = new File([new Uint8Array(newBytes)], file.name, { type: 'application/pdf', lastModified: Date.now() });
      return out.size < file.size ? out : file;
    } catch (e) {
      console.warn('PDF lossless optimize skipped:', e);
      return file;
    }
  }, []);

  // Removed lossy downscale path for strict lossless-only policy.

  // Balanced JPEG optimization: optionally resize to max 2000px and re-encode ~85 quality.
  const optimizeJpegBalanced = useCallback(async (file) => {
    try {
      if (!file || !(file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name || ''))) return file;
      const MAX = 2000;
      // Try createImageBitmap first for speed
      let bitmap = null;
      try { if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file); } catch {}
      let width, height, draw;
      if (bitmap) {
        width = bitmap.width; height = bitmap.height;
        draw = (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h);
      } else {
        // Fallback to HTMLImageElement
        const url = URL.createObjectURL(file);
        const img = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = url;
        });
        try { URL.revokeObjectURL(url); } catch {}
        width = img.naturalWidth || img.width; height = img.naturalHeight || img.height;
        draw = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h);
      }
      if (!width || !height) return file;
      let targetW = width, targetH = height;
      const scale = Math.max(width / MAX, height / MAX, 1);
      if (scale > 1) { targetW = Math.round(width / scale); targetH = Math.round(height / scale); }
      const canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return file;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      draw(ctx, targetW, targetH);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) return file;
      const out = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
      const minGain = 1024; // 1KB threshold
      return (out.size + minGain < file.size) ? out : file;
    } catch (e) {
      console.warn('Balanced JPEG optimize failed, using original', e);
      return file;
    }
  }, []);

  const preprocessFiles = useCallback(async (files) => {
    const out = [];
    let savedTotal = 0;
    let optimizedCount = 0;
    for (const f of files) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      if (isPdf && compressPdf) {
        const opt = await optimizePdfLossless(f);
        if (opt && opt.size < f.size) { savedTotal += (f.size - opt.size); optimizedCount += 1; }
        out.push(opt);
        continue;
      }
      const isJpeg = f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name || '');
      if (isJpeg) {
        if (optMode === 'off') {
          out.push(f);
        } else if (optMode === 'balanced') {
          const opt = await optimizeJpegBalanced(f);
          if (opt && opt.size < f.size) { savedTotal += (f.size - opt.size); optimizedCount += 1; }
          out.push(opt);
        } else { // lossless
          const opt = await stripJpegMetadataLossless(f);
          if (opt && opt.size < f.size) { savedTotal += (f.size - opt.size); optimizedCount += 1; }
          out.push(opt);
        }
      } else {
        // Leave non-JPEG images untouched
        out.push(f);
      }
    }
    try {
      if (savedTotal > 0) {
        const kb = Math.round(savedTotal / 1024);
        setOptSummary(`Optimized ${optimizedCount}/${files.length} file(s), saved ${kb} KB total`);
        setTimeout(() => setOptSummary(''), 4000);
      }
    } catch {}
    return out;
  }, [stripJpegMetadataLossless, optimizeJpegBalanced, optMode, compressPdf, optimizePdfLossless]);

  const performUploads = useCallback(async (acceptedFilesRaw) => {
    if (userRole === 'viewer') {
      setError('You do not have permission to upload files');
      return;
    }

    if (acceptedFilesRaw.length === 0) {
      setError('No valid files selected');
      return;
    }

    // Validate tags before starting
    let tagsMap;
    try {
      setTagsError('');
      tagsMap = buildTagsMap(tagsRows);
    } catch (e) {
      const msg = e?.message || 'Invalid tags';
      setTagsError(msg);
      setError(msg);
      return;
    }

  // Satisfy Firestore rule requiring users/{uid} with role in ['user','admin'] (or 'viewer' blocked earlier)
  await ensureUserProfile();

    setUploading(true);
    setError('');
    setSuccess('');
  setUploadProgress({});
  setUploadStatus({});
  const acceptedFiles = await preprocessFiles(acceptedFilesRaw);
    
    console.log('Starting upload for files:', acceptedFiles.map(f => f.name));
    
  const base = computeBase(currentPath);
  const ensureUniquePath = async (folderBase, fileName) => {
      // Add suffix (1), (2), ... before extension if file exists
      const dot = fileName.lastIndexOf('.');
      const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
      const ext = dot > 0 ? fileName.slice(dot) : '';
      let attempt = 0;
      while (true) {
        const name = attempt === 0 ? fileName : `${stem} (${attempt})${ext}`;
        const candidate = `${folderBase}/${name}`;
        try {
          await getMetadata(ref(storage, candidate));
          // exists -> try next
          attempt += 1;
        } catch (_) {
          // not exists
          return { name, objectPath: candidate };
        }
      }
    };
  const uploadPromises = acceptedFiles.map(async (file) => {
    const fileId = generateFileId();
    const fileName = file.name;
    const { name: finalName, objectPath } = await ensureUniquePath(base, fileName);
    const storageRef = ref(storage, objectPath);
    console.log('Uploading file to path:', objectPath);
    const customMetadata = {};
    if (optMode === 'lossless' && (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name))) {
      customMetadata.autoOptimize = '1';
    }
    if (compressPdf && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      customMetadata.autoOptimize = '1';
    }
    const uploadTask = uploadBytesResumable(storageRef, file, { customMetadata });
    const key = file.name;
    setUploadTasks(prev => ({ ...prev, [key]: uploadTask }));
    return new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(prev => ({ ...prev, [key]: progress }));
          const state = snapshot.state;
          setUploadStatus(prev => ({ ...prev, [key]: state === 'paused' ? 'paused' : 'running' }));
        },
        (error) => {
          console.error('Upload error for', file.name, ':', error);
          setUploadStatus(prev => ({ ...prev, [key]: error?.code === 'storage/canceled' ? 'canceled' : 'error' }));
          reject(error);
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            const fileDoc = {
              id: fileId,
              name: finalName,
              originalName: file.name,
              path: currentPath,
              fullPath: objectPath,
              downloadURL,
              size: file.size,
              type: file.type,
              uploadedAt: new Date(),
              uploadedBy: userRole === 'admin' ? 'admin' : 'user',
              uploadedByUid: auth.currentUser ? auth.currentUser.uid : null,
              ...(file.type?.startsWith('image/') ? { ocrStatus: 'pending' } : {}),
              tags: tagsMap
            };
            await addDoc(collection(db, 'files'), fileDoc);
            console.log('File metadata saved for:', file.name);
            setUploadStatus(prev => ({ ...prev, [key]: 'done' }));
            resolve();
          } catch (err) {
            console.error('Error saving file metadata:', err);
            setUploadStatus(prev => ({ ...prev, [key]: 'error' }));
            reject(err);
          }
        }
      );
    });
  });

  try {
    await Promise.all(uploadPromises);
    setUploadProgress({});
    setSuccess(`Successfully uploaded ${acceptedFiles.length} file(s)!`);
    try {
      const base = computeBase(currentPath);
      const normalized = (base + '/').replace(/^\/+/, '').replace(/\\/g,'/');
      window.dispatchEvent(new CustomEvent('storage-meta-refresh', { detail: { prefix: normalized } }));
      window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: 'Upload complete. Refreshing files…' } }));
    } catch (_) {}
    setTimeout(() => setSuccess(''), 3000);
    if (onUploadComplete) onUploadComplete();
  } catch (error) {
    console.error('Upload error:', error);
    setError('Error uploading files: ' + error.message);
  } finally {
    setUploading(false);
  }
  }, [currentPath, onUploadComplete, userRole, preprocessFiles, ensureUserProfile, buildTagsMap, tagsRows, optMode, compressPdf]);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop: performUploads,
    disabled: uploading || userRole === 'viewer',
    noClick: true,
    noKeyboard: true,
    maxSize: 524288000,
    onDropRejected: (fileRejections) => {
      const errors = fileRejections.map(rejection => `${rejection.file.name}: ${rejection.errors.map(e => e.message).join(', ')}`);
      setError('File(s) rejected: ' + errors.join('; '));
    }
  });

  // Handle folder selection using webkitdirectory
  const onFolderPicked = async (e) => {
    const fileList = Array.from(e.target.files || []);
    if (userRole === 'viewer') { setError('You do not have permission to upload files'); return; }
    if (fileList.length === 0) return;
    // Validate tags before starting
    let tagsMap;
    try {
      setTagsError('');
      tagsMap = buildTagsMap(tagsRows);
    } catch (e2) {
      const msg = e2?.message || 'Invalid tags';
      setTagsError(msg);
      setError(msg);
      return;
    }
  await ensureUserProfile();
    setUploading(true);
    setError('');
    setSuccess('');
    setUploadProgress({});
    const base = computeBase(currentPath);
    const ensureUniquePath = async (fullPath) => {
      const parts = fullPath.split('/');
      const fileName = parts.pop();
      const folderBase = parts.join('/');
      const dot = fileName.lastIndexOf('.');
      const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
      const ext = dot > 0 ? fileName.slice(dot) : '';
      let attempt = 0;
      while (true) {
        const name = attempt === 0 ? fileName : `${stem} (${attempt})${ext}`;
        const candidate = `${folderBase}/${name}`;
        try { await getMetadata(ref(storage, candidate)); attempt += 1; } catch (_) { return candidate; }
      }
    };
    try {
      const tasks = fileList.map(async (file) => {
        const [optFile] = await preprocessFiles([file]);
        const relPathRaw = file.webkitRelativePath || file.name;
        const relPath = relPathRaw.replace(/\\/g, '/').replace(/^\/+/, '');
        let relParts = relPath.split('/');
        relParts[relParts.length - 1] = optFile.name;
        const finalRelPath = relParts.join('/');
        const desiredPath = `${base}/${finalRelPath}`.replace(/\/+/, '/');
        const objectPath = await ensureUniquePath(desiredPath);
        return new Promise((resolve, reject) => {
          const customMetadata = {};
          if (optMode === 'lossless' && (optFile.type === 'image/jpeg' || /\.jpe?g$/i.test(optFile.name))) {
            customMetadata.autoOptimize = '1';
          }
          if (compressPdf && (optFile.type === 'application/pdf' || /\.pdf$/i.test(optFile.name))) {
            customMetadata.autoOptimize = '1';
          }
          const uploadTask = uploadBytesResumable(ref(storage, objectPath), optFile, { customMetadata });
          setUploadTasks(prev => ({ ...prev, [finalRelPath]: uploadTask }));
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(prev => ({ ...prev, [finalRelPath]: progress }));
              const state = snapshot.state;
              setUploadStatus(prev => ({ ...prev, [finalRelPath]: state === 'paused' ? 'paused' : 'running' }));
            },
            (err) => { setUploadStatus(prev => ({ ...prev, [finalRelPath]: err?.code === 'storage/canceled' ? 'canceled' : 'error' })); reject(err); },
            async () => {
              try {
                const finalRef = uploadTask.snapshot.ref;
                const downloadURL = await getDownloadURL(finalRef);
                try {
                  const dirPart = finalRelPath.split('/').slice(0, -1).join('/');
                  await addDoc(collection(db, 'files'), {
                    id: Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                    name: optFile.name,
                    originalName: file.name,
                    path: `/${base}/${dirPart}`,
                    fullPath: finalRef.fullPath,
                    downloadURL,
                    size: optFile.size,
                    type: optFile.type || file.type,
                    uploadedAt: new Date(),
                    uploadedBy: userRole === 'admin' ? 'admin' : 'user',
                    uploadedByUid: auth.currentUser ? auth.currentUser.uid : null,
                    tags: tagsMap
                  });
                } catch (_) {}
                setUploadStatus(prev => ({ ...prev, [finalRelPath]: 'done' }));
                resolve();
              } catch (e2) { reject(e2); }
            }
          );
        });
      });
      await Promise.all(tasks);
      setSuccess(`Successfully uploaded ${fileList.length} item(s) from folder.`);
      setTimeout(() => setSuccess(''), 3000);
      onUploadComplete && onUploadComplete();
    } catch (err) {
      setError('Error uploading folder: ' + (err.message || String(err)));
    } finally {
      setUploading(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };
  const pauseAll = () => {
    Object.values(uploadTasks).forEach(t => { try { t.pause(); } catch {} });
  };
  const resumeAll = () => {
    Object.values(uploadTasks).forEach(t => { try { t.resume(); } catch {} });
  };
  const cancelAll = () => {
    Object.values(uploadTasks).forEach(t => { try { t.cancel(); } catch {} });
  };
  const pauseOne = (key) => { const t = uploadTasks[key]; if (t) try { t.pause(); } catch {} };
  const resumeOne = (key) => { const t = uploadTasks[key]; if (t) try { t.resume(); } catch {} };
  const cancelOne = (key) => { const t = uploadTasks[key]; if (t) try { t.cancel(); } catch {} };

  if (userRole === 'viewer') {
    return (
      <div className="upload-disabled">
        <p>File upload not available for viewers</p>
      </div>
    );
  }

  return (
    <div className="file-uploader">
      <div 
        {...getRootProps()} 
        className={`dropzone ${isDragActive ? 'active' : ''} ${isDragReject ? 'reject' : ''} ${uploading ? 'uploading' : ''}`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="upload-status">
            <p>📤 Uploading files...</p>
            <div className="upload-controls" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={pauseAll}>Pause All</button>
              <button onClick={resumeAll}>Resume All</button>
              <button onClick={cancelAll} style={{ color: '#b42318' }}>Cancel All</button>
            </div>
            {Object.entries(uploadProgress).map(([fileName, progress]) => (
              <div key={fileName} className="progress-item">
                <span className="file-name">{fileName}</span>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <span className="progress-text">{Math.round(progress)}%</span>
                <span className="progress-actions" style={{ marginLeft: 8, display: 'inline-flex', gap: 6 }}>
                  {uploadStatus[fileName] === 'paused' ? (
                    <button onClick={() => resumeOne(fileName)}>Resume</button>
                  ) : (
                    <button onClick={() => pauseOne(fileName)}>Pause</button>
                  )}
                  <button onClick={() => cancelOne(fileName)} style={{ color: '#b42318' }}>Cancel</button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="drop-message">
            {isDragActive ? (
              isDragReject ? (
                <p>❌ Some files are not supported</p>
              ) : (
                <p>📂 Drop the files here...</p>
              )
            ) : (
              <>
                <div className="upload-icon">📁</div>
                <p><strong>Drag & drop files here</strong></p>
                <p className="or">or</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <label htmlFor="optMode" style={{ fontSize: 12, opacity: 0.8 }}>Image optimization (opt-in):</label>
                  <select id="optMode" value={optMode} onChange={(e) => { const v = e.target.value; setOptMode(v); try { localStorage.setItem('uploader:optMode', v); } catch {} }} style={{ fontSize: 12 }}>
                    <option value="balanced">Balanced (resize ≤2000px, quality 85)</option>
                    <option value="lossless">Lossless (strip metadata only)</option>
                    <option value="off">Off</option>
                  </select>
                  <small style={{ fontSize: 11, opacity: 0.65 }}>Note: Optimization runs only when selected here.</small>
                  <label style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <input type="checkbox" checked={compressPdf} onChange={(e) => { const v = e.target.checked; setCompressPdf(v); try { localStorage.setItem('uploader:compressPdf', v ? '1' : '0'); } catch {} }} />
                    Optimize PDFs (lossless, opt-in)
                  </label>
                </div>
                {optSummary && (
                  <div style={{ fontSize: 12, color: '#0f766e', background: '#ecfeff', border: '1px solid #99f6e4', padding: '6px 8px', borderRadius: 6 }}>{optSummary}</div>
                )}
                <button
                  type="button"
                  className="browse-btn"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(); }}
                  disabled={uploading || userRole === 'viewer'}
                >
                  📎 Browse Files
                </button>
                <button
                  type="button"
                  className="browse-btn"
                  onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
                  style={{ marginLeft: 8 }}
                >
                  📷 Capture Photo
                </button>
                <button
                  type="button"
                  className="browse-btn"
                  onClick={() => folderInputRef.current && folderInputRef.current.click()}
                  style={{ marginLeft: 8 }}
                >
                  📁 Upload Folder
                </button>
                <input
                  ref={folderInputRef}
                  type="file"
                  webkitdirectory="true"
                  directory="true"
                  multiple
                  onChange={onFolderPicked}
                  style={{ display: 'none' }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) return;
                    performUploads(files);
                    e.target.value = '';
                  }}
                  style={{ display: 'none' }}
                />
                <div className="file-info">
                  <small>Supports bulk upload of files and folders (structure preserved)</small>
                  <small>Max size: 500MB per file</small>
                </div>
                <div style={{ marginTop: 10, width: '100%', maxWidth: 640 }}>
                  <div style={{ marginBottom: 6, color: '#475569', fontSize: 12, fontWeight: 600 }}>Tags applied to uploaded files</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, paddingBottom: 4, borderBottom: '1px solid #e5e7eb', color: '#475569', fontSize: 12, fontWeight: 600 }}>
                    <div>Tag Name</div>
                    <div>Value</div>
                    <div style={{ textAlign: 'right' }}>Actions</div>
                  </div>
                  {(tagsRows || []).map((row, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <input
                        type="text"
                        placeholder="Tag Name"
                        value={row.key}
                        onChange={(e) => { setTagsRows(prev => prev.map((r, i) => i === idx ? { ...r, key: e.target.value } : r)); setTagsError(''); }}
                        style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6 }}
                      />
                      <input
                        type="text"
                        placeholder="Value"
                        value={row.value}
                        onChange={(e) => { setTagsRows(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r)); setTagsError(''); }}
                        style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6 }}
                      />
                      <button type="button" title="Remove" onClick={() => setTagsRows(prev => {
                        const next = prev.filter((_, i) => i !== idx);
                        return next.length > 0 ? next : [{ key: '', value: '' }];
                      })} style={{ padding: '6px 10px', border: '1px solid #fecaca', background: '#fff', color: '#b42318', borderRadius: 6 }}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    <button type="button" onClick={() => setTagsRows(prev => [...prev, { key: '', value: '' }])} title="Add tag" style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc' }}>+ Add</button>
                  </div>
                  {tagsError && (
                    <div style={{ color: '#b42318', fontSize: 13, marginTop: 6 }}>{tagsError}</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      
      {error && (
        <div className="message error">
          ❌ {error}
          <button onClick={() => setError('')} className="close-btn">×</button>
        </div>
      )}
      
      {success && (
        <div className="message success">
          ✅ {success}
        </div>
      )}
    </div>
  );
};

export default FileUploader;