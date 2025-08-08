import React, { useState } from 'react';
import { deleteObject, ref } from 'firebase/storage';
import { doc, deleteDoc, addDoc, collection, updateDoc } from 'firebase/firestore';
import { storage, db } from '../firebase';
import { FaTimes, FaDownload, FaTrash, FaEdit } from 'react-icons/fa';
import './FilePreview.css';

const FilePreview = ({ file, onClose, userRole, userId, onFileAction }) => {
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState(file.originalName || file.name);
  const [isRenaming, setIsRenaming] = useState(false);

  // Hide folder placeholder files from preview/info (must be after hooks)
  if (file.name === '.folder-placeholder' || file.name === '.folder_placeholder') {
    if (onClose) onClose();
    return null;
  }

  const handleDownload = () => {
    window.open(file.downloadURL, '_blank');
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
        // Delete from Storage
        const fileRef = ref(storage, file.fullPath);
        await deleteObject(fileRef);
        
        // Delete from Firestore
        await deleteDoc(doc(db, 'files', file.id));
        
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
    if (file.type?.startsWith('image/')) {
      return (
        <div className="preview-image-content">
          <img src={file.downloadURL} alt={file.name} style={{ maxWidth: '100%', borderRadius: '8px' }} />
          <h3>File Information</h3>
          <p><strong>Name:</strong> {file.name}</p>
          <p><strong>Type:</strong> {file.type || 'Unknown'}</p>
          <p><strong>Size:</strong> {(file.size / 1024 / 1024).toFixed(2)} MB</p>
          <p><strong>Uploaded:</strong> {file.uploadedAt?.toDate?.()?.toLocaleDateString() || 'Unknown'}</p>
          <p><strong>Path:</strong> {file.path}</p>
        </div>
      );
    }
    // ...other file type previews...
    return (
      <div className="preview-generic-content">
        <h3>File Information</h3>
        <p><strong>Name:</strong> {file.name}</p>
        <p><strong>Type:</strong> {file.type || 'Unknown'}</p>
        <p><strong>Size:</strong> {(file.size / 1024 / 1024).toFixed(2)} MB</p>
        <p><strong>Uploaded:</strong> {file.uploadedAt?.toDate?.()?.toLocaleDateString() || 'Unknown'}</p>
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
              {userRole !== 'viewer' && !isRenaming && (
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
              <span>Size: {(file.size / 1024 / 1024).toFixed(2)} MB</span>
              <span>Type: {file.type || 'Unknown'}</span>
              <span>Uploaded: {file.uploadedAt?.toDate?.()?.toLocaleDateString() || 'Unknown'}</span>
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