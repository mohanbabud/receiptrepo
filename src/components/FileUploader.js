import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { ref, uploadBytesResumable, getDownloadURL, getMetadata } from 'firebase/storage';
import { collection, addDoc } from 'firebase/firestore';
import { storage, db } from '../firebase';
import './FileUploader.css';

const FileUploader = ({ currentPath, onUploadComplete, userRole, seedFiles = [] }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadTasks, setUploadTasks] = useState({}); // key -> uploadTask
  const [uploadStatus, setUploadStatus] = useState({}); // key -> 'running'|'paused'|'done'|'error'|'canceled'
  // image optimization mode for JPEGs only: 'balanced' (resize+reencode), 'lossless' (strip metadata only), 'off'
  const [optMode, setOptMode] = useState('lossless');
  const folderInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const seededOnceRef = useRef(0);

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

  const downscaleImage = useCallback(async (file) => {
    try {
      const blob = file;
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = URL.createObjectURL(blob);
      });
      const canvas = document.createElement('canvas');
      const maxEdge = 2000; // max width/height
      let { width, height } = img;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const quality = 0.85;
      const outputType = 'image/jpeg';
      const optimizedBlob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality));
      URL.revokeObjectURL(img.src);
      if (!optimizedBlob) return file;
      // Preserve original filename; change extension if needed
      let newName = file.name;
      if (!/\.jpe?g$/i.test(newName)) newName = newName.replace(/\.[^.]+$/i, '') + '.jpg';
      return new File([optimizedBlob], newName, { type: outputType, lastModified: Date.now() });
    } catch (e) {
      console.warn('Image optimization failed, uploading original', e);
      return file;
    }
  }, []);

  const preprocessFiles = useCallback(async (files) => {
    const out = [];
    for (const f of files) {
      const isJpeg = f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name || '');
      if (isJpeg) {
        if (optMode === 'off') {
          out.push(f);
        } else if (optMode === 'lossless') {
          out.push(await stripJpegMetadataLossless(f));
        } else {
          // balanced/default path (resize and re-encode as high-quality JPEG)
          out.push(await downscaleImage(f));
        }
      } else {
        // Leave non-JPEG images untouched
        out.push(f);
      }
    }
    return out;
  }, [downscaleImage, stripJpegMetadataLossless, optMode]);

  const performUploads = useCallback(async (acceptedFilesRaw) => {
    if (userRole === 'viewer') {
      setError('You do not have permission to upload files');
      return;
    }

    if (acceptedFilesRaw.length === 0) {
      setError('No valid files selected');
      return;
    }

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
      // Retain original filename in Storage (no prefixing)
      const fileName = file.name;
      const { name: finalName, objectPath } = await ensureUniquePath(base, fileName);
      const storageRef = ref(storage, objectPath);
      
      console.log('Uploading file to path:', objectPath);
      
      try {
  const uploadTask = uploadBytesResumable(storageRef, file);
        const key = file.name;
        setUploadTasks(prev => ({ ...prev, [key]: uploadTask }));
        
        return new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(prev => ({
                ...prev,
                [key]: progress
              }));
              const state = snapshot.state; // 'running' | 'paused'
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
                
                // Save file metadata to Firestore
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
                  ...(file.type?.startsWith('image/') ? { ocrStatus: 'pending' } : {})
                };
                
                await addDoc(collection(db, 'files'), fileDoc);
                console.log('File metadata saved for:', file.name);
                setUploadStatus(prev => ({ ...prev, [key]: 'done' }));
                resolve();
              } catch (error) {
                console.error('Error saving file metadata:', error);
                setUploadStatus(prev => ({ ...prev, [key]: 'error' }));
                reject(error);
              }
            }
          );
        });
      } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
      }
    });

    try {
      await Promise.all(uploadPromises);
      setUploadProgress({});
      setSuccess(`Successfully uploaded ${acceptedFiles.length} file(s)!`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
      
      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError('Error uploading files: ' + error.message);
    } finally {
      setUploading(false);
    }
  }, [currentPath, onUploadComplete, userRole, preprocessFiles]);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop: performUploads,
    disabled: uploading || userRole === 'viewer',
    noClick: true,       // prevent auto-opening on container clicks
    noKeyboard: true,    // avoid Enter/Space triggering dialog
    maxSize: 524288000, // 500MB per file
    onDropRejected: (fileRejections) => {
      const errors = fileRejections.map(rejection => 
        `${rejection.file.name}: ${rejection.errors.map(e => e.message).join(', ')}`
      );
      setError('File(s) rejected: ' + errors.join('; '));
    }
  });

  // Handle folder selection using webkitdirectory
  const onFolderPicked = async (e) => {
    const fileList = Array.from(e.target.files || []);
    if (userRole === 'viewer') {
      setError('You do not have permission to upload files');
      return;
    }
    if (fileList.length === 0) return;

    setUploading(true);
    setError('');
    setSuccess('');
    setUploadProgress({});

    const base = computeBase(currentPath);
    const ensureUniquePath = async (fullPath) => {
      // For folders, fullPath includes subdirectories and filename
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
        try {
          await getMetadata(ref(storage, candidate));
          attempt += 1; // exists
        } catch (_) {
          return candidate; // not exists
        }
      }
    };

    try {
      const tasks = fileList.map(async (file) => {
        // Optimize JPEGs according to current mode
        const [optFile] = await preprocessFiles([file]);
        // Preserve relative path inside the chosen folder
        const relPathRaw = file.webkitRelativePath || file.name;
        const relPath = relPathRaw.replace(/\\/g, '/').replace(/^\/+/, '');
        // If optimization changed filename (e.g., png->jpg via balanced), update the leaf name in relPath
        let relParts = relPath.split('/');
        relParts[relParts.length - 1] = optFile.name;
        const finalRelPath = relParts.join('/');
        const desiredPath = `${base}/${finalRelPath}`.replace(/\/+/, '/');
        let finalPath = null;
        const computePath = async () => {
          finalPath = await ensureUniquePath(desiredPath);
          return finalPath;
        };
        return new Promise((resolve, reject) => {
          computePath().then((objectPath) => {
            const uploadTask = uploadBytesResumable(ref(storage, objectPath), optFile);
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
                await getDownloadURL(finalRef);
                // Optional: write metadata to Firestore (best-effort)
                try {
                  const dirPart = finalRelPath.split('/').slice(0, -1).join('/');
                  await addDoc(collection(db, 'files'), {
                    id: Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                    name: optFile.name,
                    originalName: file.name,
                    path: `/${base}/${dirPart}`,
                    fullPath: finalRef.fullPath,
                    size: optFile.size,
                    type: optFile.type || file.type,
                    uploadedAt: new Date(),
                    uploadedBy: userRole === 'admin' ? 'admin' : 'user'
                  });
                } catch (_) { /* ignore metadata errors */ }
                  setUploadStatus(prev => ({ ...prev, [finalRelPath]: 'done' }));
                resolve();
              } catch (e2) { reject(e2); }
            }
          );
          }).catch(reject);
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
      // reset input so the same folder can be picked again
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // Seeded files upload (from external drop banner)
  useEffect(() => {
    const files = Array.isArray(seedFiles) ? seedFiles : [];
    if (!files.length) return;
    // avoid re-triggering for the same batch
    if (seededOnceRef.current === files.length) return;
    seededOnceRef.current = files.length;
    performUploads(files);
  }, [seedFiles, performUploads]);

  // Resumable controls
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
                  <label htmlFor="optMode" style={{ fontSize: 12, opacity: 0.8 }}>Image optimization:</label>
                  <select id="optMode" value={optMode} onChange={(e) => setOptMode(e.target.value)} style={{ fontSize: 12 }}>
                    <option value="balanced">Balanced (resize to 2000px, high quality)</option>
                    <option value="lossless">Lossless (strip metadata only)</option>
                    <option value="off">Off</option>
                  </select>
                </div>
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