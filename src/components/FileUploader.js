import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc } from 'firebase/firestore';
import { storage, db } from '../firebase';
import './FileUploader.css';

const FileUploader = ({ currentPath, onUploadComplete, userRole }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Generate unique file ID
  const generateFileId = () => {
    return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  };

  const onDrop = useCallback(async (acceptedFiles) => {
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
    
    const uploadPromises = acceptedFiles.map(async (file) => {
      const fileId = generateFileId();
      const fileName = `${fileId}_${file.name}`;
      // Normalize currentPath to ensure a single 'files/' prefix
      let base = (currentPath || '').trim();
      // Drop leading slash
      base = base.replace(/^\/+/, '');
      // Map root or empty to 'files'
      if (base === '' || base === '/') base = 'files';
      // Ensure single 'files/' prefix (avoid 'filesfiles/...')
      if (base === 'files') {
        // ok
      } else if (!base.startsWith('files/')) {
        base = `files/${base}`;
      }
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
    onDrop,
    disabled: uploading || userRole === 'viewer',
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
      'application/pdf': ['.pdf'],
      'text/*': ['.txt', '.md', '.csv'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/msword': ['.doc'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'video/*': ['.mp4', '.avi', '.mov', '.wmv', '.flv'],
      'audio/*': ['.mp3', '.wav', '.ogg', '.aac']
    },
    maxSize: 10485760, // 10MB
    onDropRejected: (fileRejections) => {
      const errors = fileRejections.map(rejection => 
        `${rejection.file.name}: ${rejection.errors.map(e => e.message).join(', ')}`
      );
      setError('File(s) rejected: ' + errors.join('; '));
    }
  });

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
                <div className="file-info">
                  <small>Supported: Images, Documents, Videos, Audio</small>
                  <small>Max size: 10MB per file</small>
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