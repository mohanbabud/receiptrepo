import React, { useState } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import './StorageManager.css';

const StorageManager = ({ onStructureChange }) => {
  const [newFolderPath, setNewFolderPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');

  const createFolder = async (folderPath) => {
    try {
      setCreating(true);
      setMessage('');

      // Normalize path: trim spaces, remove leading/trailing slashes
      let clean = (folderPath || '').trim().replace(/^\/+|\/+$/g, '');
      if (!clean) throw new Error('Folder path cannot be empty');
      // Ensure we always write under the allowed "files/" root per storage.rules
      if (!/^files\//i.test(clean)) {
        clean = `files/${clean}`;
      }
  // Avoid accidental duplicate slashes throughout the path
  clean = clean.replace(/\/+/g, '/');

      // Firebase Storage doesn't have explicit folders, so we create a hidden placeholder file
      const fullPath = `${clean}/.folder-placeholder`;
      const folderRef = ref(storage, fullPath);
      // Create a tiny placeholder file to establish the folder
      const emptyFile = new Blob([''], { type: 'text/plain' });
      await uploadBytes(folderRef, emptyFile);

      setMessage(`✅ Folder "${clean.replace(/^files\//, '')}" created successfully!`);

      // Notify parent component to refresh
      if (onStructureChange) {
        onStructureChange();
      }

      setNewFolderPath('');

      // Hide .keep files in any file list rendering (example)
      // If you render files, use: files.filter(f => f.name !== '.keep')
    } catch (error) {
      console.error('Error creating folder:', error);
      setMessage(`❌ Error creating folder: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (newFolderPath.trim()) {
      createFolder(newFolderPath.trim());
    }
  };

  return (
    <div className="storage-manager">
      <h4>Storage Structure Manager</h4>
      
      <form onSubmit={handleSubmit} className="folder-form">
        <div className="form-group">
          <label>Create New Folder:</label>
          <input
            type="text"
            value={newFolderPath}
            onChange={(e) => setNewFolderPath(e.target.value)}
            placeholder="e.g., documents/reports or photos"
            disabled={creating}
          />
        </div>
        <button type="submit" disabled={creating || !newFolderPath.trim()}>
          {creating ? 'Creating...' : 'Create Folder'}
        </button>
      </form>

      <div className="quick-actions">
      </div>

      {message && (
        <div className={`message ${message.includes('✅') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}

      <div className="info">
        <h5>Current Issue:</h5>
        <p>Your Firebase Storage currently only has a "files" folder. Create more folders to see the tree structure in action!</p>
        
        <h5>Folder Path Examples:</h5>
        <ul>
          <li><code>documents</code> - Creates a documents folder (stored at files/documents)</li>
          <li><code>images/photos</code> - Creates images folder with photos subfolder (files/images/photos)</li>
          <li><code>projects/web-apps</code> - Creates nested project folders (files/projects/web-apps)</li>
        </ul>
      </div>
    </div>
  );
};

export default StorageManager;
