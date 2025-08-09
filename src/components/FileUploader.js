import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc } from 'firebase/firestore';
import { storage, db } from '../firebase';
import './FileUploader.css';

const FileUploader = ({ currentPath, onUploadComplete, userRole, seedFiles = [] }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const folderInputRef = useRef(null);
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

  const performUploads = useCallback(async (acceptedFiles) => {
    if (userRole === 'viewer') {
      setError('You do not have permission to upload files');
      return;
    }

    if (acceptedFiles.length === 0) {
      setError('No valid files selected');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');
    setUploadProgress({});
    
    console.log('Starting upload for files:', acceptedFiles.map(f => f.name));
    
  const base = computeBase(currentPath);
  const uploadPromises = acceptedFiles.map(async (file) => {
      const fileId = generateFileId();
      const fileName = `${fileId}_${file.name}`;
      const objectPath = `${base}/${fileName}`;
      const storageRef = ref(storage, objectPath);
      
      console.log('Uploading file to path:', objectPath);
      
      try {
        const uploadTask = uploadBytesResumable(storageRef, file);
        
        return new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: progress
              }));
            },
            (error) => {
              console.error('Upload error for', file.name, ':', error);
              reject(error);
            },
            async () => {
              try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                
                // Save file metadata to Firestore
                const fileDoc = {
                  id: fileId,
                  name: file.name,
                  originalName: file.name,
                  path: currentPath,
                  fullPath: objectPath,
                  downloadURL,
                  size: file.size,
                  type: file.type,
                  uploadedAt: new Date(),
                  uploadedBy: userRole === 'admin' ? 'admin' : 'user'
                };
                
                await addDoc(collection(db, 'files'), fileDoc);
                console.log('File metadata saved for:', file.name);
                
                resolve();
              } catch (error) {
                console.error('Error saving file metadata:', error);
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
  }, [currentPath, onUploadComplete, userRole]);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop: performUploads,
    disabled: uploading || userRole === 'viewer',
    // Accept any file; validation handled server-side if needed
    // accept: {},
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

    try {
      const tasks = fileList.map((file) => {
        // Preserve relative path inside the chosen folder
        const relPathRaw = file.webkitRelativePath || file.name;
        const relPath = relPathRaw.replace(/\\/g, '/').replace(/^\/+/, '');
        const objectPath = `${base}/${relPath}`.replace(/\/+/, '/');
        const storageRef = ref(storage, objectPath);
        const uploadTask = uploadBytesResumable(storageRef, file);
        return new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(prev => ({ ...prev, [relPath]: progress }));
            },
            (err) => reject(err),
            async () => {
              try {
                await getDownloadURL(uploadTask.snapshot.ref);
                // Optional: write metadata to Firestore (best-effort)
                try {
                  const dirPart = relPath.split('/').slice(0, -1).join('/');
                  await addDoc(collection(db, 'files'), {
                    id: Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                    name: file.name,
                    originalName: file.name,
                    path: `/${base}/${dirPart}`,
                    fullPath: objectPath,
                    size: file.size,
                    type: file.type,
                    uploadedAt: new Date(),
                    uploadedBy: userRole === 'admin' ? 'admin' : 'user'
                  });
                } catch (_) { /* ignore metadata errors */ }
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
                <button type="button" className="browse-btn">
                  📎 Browse Files
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