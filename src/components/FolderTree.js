import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { ref, listAll, getMetadata, getDownloadURL, uploadBytes, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { FaFolder, FaFolderOpen, FaFile, FaImage, FaFilePdf, FaFileAlt, FaVideo, FaMusic, FaTrash } from 'react-icons/fa';
import './FolderTree.css';

const ROOT_PATH = '/files/';

const FolderTree = ({ currentPath, onPathChange, refreshTrigger, userRole, onFileSelect }) => {
  // State
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState(new Set());
  const [expandedFolders, setExpandedFolders] = useState(new Set([ROOT_PATH]));
  const [fileSort, setFileSort] = useState('name');
  const [fileFilter, setFileFilter] = useState('');
  const [storageFiles, setStorageFiles] = useState([]);
  const [storageFolders, setStorageFolders] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, target: null, type: null });
  const [renamingFolder, setRenamingFolder] = useState(null); // Keeping this for context
  const [renameFolderName, setRenameFolderName] = useState(''); // Keeping this for context
  const [newFolderName, setNewFolderName] = useState(''); // Keeping this for context
  const [showNewFolderInput, setShowNewFolderInput] = useState(false); // Keeping this for context
  const [showSuccessPopup, setShowSuccessPopup] = useState(false); // Keeping this for context
  const [successMessage, setSuccessMessage] = useState(''); // Keeping this for context
  const [isError, setIsError] = useState(false); // Keeping this for context

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]); // Fixing useEffect dependency warning

  // Load Firestore and Storage data
  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadFirestoreData(), loadStorageStructure()]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFirestoreData = () => {
    return new Promise((resolve) => {
      const q = query(collection(db, 'files'), orderBy('name'));
      onSnapshot(
        q,
        (snapshot) => {
          const fileList = [];
          const folderSet = new Set();
          snapshot.forEach((doc) => {
            const fileData = { id: doc.id, ...doc.data() };
            fileList.push(fileData);
            const pathParts = (fileData.path || '').split('/').filter(part => part);
            let currentFolderPath = '/';
            pathParts.forEach(part => {
              currentFolderPath += part + '/';
              folderSet.add(currentFolderPath);
            });
          });
          setFiles(fileList);
          setFolders(folderSet);
          resolve();
        },
        (error) => {
          console.warn('Firestore files listener error:', error?.code || error?.name, error?.message);
          // Gracefully continue with storage-only data
          setFiles([]);
          setFolders(new Set());
          resolve();
        }
      );
    });
  };

  const loadStorageStructure = async () => {
    try {
      const loadStorageRecursive = async (folderRef, basePath = '') => {
        const result = await listAll(folderRef);
        const folderSet = new Set();
        const fileList = [];
        // Always add folder prefixes, even if empty
        for (const prefix of result.prefixes) {
          const folderPath = basePath + '/' + prefix.name + '/';
          folderSet.add(folderPath);
          const subResult = await loadStorageRecursive(prefix, basePath + '/' + prefix.name);
          subResult.folders.forEach(f => folderSet.add(f));
          fileList.push(...subResult.files);
        }
        for (const item of result.items) {
          try {
            const metadata = await getMetadata(item);
            const downloadURL = await getDownloadURL(item);
            const filePath = basePath === '' ? '/' : basePath + '/';
            fileList.push({
              id: item.fullPath,
              name: item.name,
              path: filePath,
              size: metadata.size,
              type: metadata.contentType,
              downloadURL: downloadURL,
              ref: item,
              uploadedAt: metadata.timeCreated,
              isStorageFile: true
            });
            // If .keep file, add its parent folder (redundant, but safe)
            if (item.name === '.keep') {
              folderSet.add(filePath);
            }
          } catch (error) {
            console.error('Error getting file metadata:', error);
          }
        }
        return { folders: folderSet, files: fileList };
      };
  // Only list under the permitted 'files/' root per storage.rules
  const storageRef = ref(storage, 'files/');
  const result = await loadStorageRecursive(storageRef, ROOT_PATH.replace(/\/+$/, ''));
      setStorageFolders(result.folders);
      setStorageFiles(result.files);
    } catch (error) {
      console.error('Error loading storage structure:', error);
    }
  };

  // UI helpers
  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown size';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (fileName, fileType) => {
    if (fileType?.startsWith('image/')) return <FaImage className="file-icon image" />;
    if (fileType?.startsWith('video/')) return <FaVideo className="file-icon video" />;
    if (fileType?.startsWith('audio/')) return <FaMusic className="file-icon audio" />;
    if (fileType === 'application/pdf') return <FaFilePdf className="file-icon pdf" />;
    return <FaFileAlt className="file-icon document" />;
  };

  const toggleFolder = (folderPath) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderPath)) newExpanded.delete(folderPath);
    else newExpanded.add(folderPath);
    setExpandedFolders(newExpanded);
    onPathChange(folderPath);
  };

  // Context menu logic
  const handleContextMenu = (e, target, type) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, target, type });
  };
  const hideContextMenu = () => setContextMenu({ visible: false, x: 0, y: 0, target: null, type: null });
  const handleMenuAction = (action) => {
    if (action === 'rename' && contextMenu.target) {
      setRenamingFolder(contextMenu.target);
      setRenameFolderName(contextMenu.target.split('/').filter(Boolean).pop());
    } else if (action === 'create') {
      setShowNewFolderInput(true);
    } else if (action === 'delete' && contextMenu.target) {
      handleDeleteFolder(contextMenu.target);
    }
    hideContextMenu();
  };

  // Rename folder in Firebase Storage
  const handleRenameFolder = async () => {
    if (!renamingFolder || !renameFolderName.trim()) return;
    const oldPath = renamingFolder;
    const newPath = oldPath.replace(/[^/]+\/$/, renameFolderName + '/');
    try {
      // Move all files from oldPath to newPath
      const folderRef = ref(storage, oldPath);
      const result = await listAll(folderRef);
      let moved = false;
      for (const item of result.items) {
        try {
          const fileBytes = await import('firebase/storage').then(mod => mod.getBytes(item));
          const newFileRef = ref(storage, item.fullPath.replace(oldPath, newPath));
          await uploadBytes(newFileRef, fileBytes);
          await deleteObject(item);
          moved = true;
        } catch (err) {
          console.error('Error moving file:', item.fullPath, err);
        }
      }
      // If folder is empty, create a .keep file in newPath and delete .keep in oldPath
      if (!moved) {
        const oldKeepRef = ref(storage, oldPath + '.keep');
        try { await deleteObject(oldKeepRef); } catch (e) {}
        const newKeepRef = ref(storage, newPath + '.keep');
        await uploadBytes(newKeepRef, new Uint8Array());
      }
      setRenamingFolder(null);
      setRenameFolderName('');
      setSuccessMessage('Folder renamed successfully!');
      setShowSuccessPopup(true);
      loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error renaming folder: ' + (error.message || error.toString()));
      setShowSuccessPopup(true);
      console.error('Error renaming folder:', error);
    }
  };

  // Delete folder and its contents in Firebase Storage
  const handleDeleteFolder = async (folderPath) => {
    if (!folderPath) return;
    try {
      const folderRef = ref(storage, folderPath);
      const result = await listAll(folderRef);
      for (const item of result.items) {
        await deleteObject(item);
      }
      for (const prefix of result.prefixes) {
        await handleDeleteFolder(prefix.fullPath);
      }
      setSuccessMessage('Folder deleted successfully!');
      setShowSuccessPopup(true);
      loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error deleting folder');
      setShowSuccessPopup(true);
      console.error('Error deleting folder:', error);
    }
  };

  // Create new folder in Firebase Storage
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    let basePath = contextMenu.target || '/';
    if (!basePath.endsWith('/')) basePath += '/';
    // Normalize: always create under files/ root per storage.rules
    let scopedBase = basePath;
    if (!scopedBase.startsWith('/files/')) {
      scopedBase = `/files${basePath}`.replace(/\/+/g, '/');
    }
    const folderPath = (scopedBase === '/' ? '' : scopedBase) + newFolderName + '/.keep';
    try {
      const folderRef = ref(storage, folderPath);
      await uploadBytes(folderRef, new Uint8Array()); // Create empty file to simulate folder
      setShowNewFolderInput(false);
      setNewFolderName('');
      setSuccessMessage('Folder created successfully!');
      setShowSuccessPopup(true);
      loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error creating folder');
      setShowSuccessPopup(true);
      console.error('Error creating folder:', error);
    }
  };

  // Render folder tree
  const renderFolderTree = (path = '/', level = 0) => {
    const items = [];
    const actualFolders = new Set([...storageFolders]);
    // Only show subfolders for the current path
    const subfolders = Array.from(actualFolders)
      .filter(folder => {
        const relativePath = folder.substring(path.length);
        const folderName = folder.substring(path.length).replace('/', '');
        return folder.startsWith(path) && folder !== path && relativePath.split('/').filter(p => p).length === 1;
      })
      .sort((a, b) => {
        // Sort by folder name alphabetically
        const nameA = a.substring(path.length).replace('/', '').toLowerCase();
        const nameB = b.substring(path.length).replace('/', '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    // Only show subfolders if their parent is expanded
    if (expandedFolders.has(path)) {
      subfolders.forEach(folderPath => {
        const folderName = folderPath.substring(path.length).replace('/', '');
        const isExpanded = expandedFolders.has(folderPath);
        const filesInFolder = storageFiles.filter(f => f.path === folderPath).length;
        items.push(
          <div key={folderPath} className="tree-item" onContextMenu={e => handleContextMenu(e, folderPath, 'folder')}>
            <div className={`folder-item ${currentPath === folderPath ? 'active' : ''}`} style={{ paddingLeft: `${level * 12}px` }} onClick={() => toggleFolder(folderPath)} title={`Folder: ${folderName} (${filesInFolder} files)`}>
              <div className="item-content">
                {isExpanded ? <FaFolderOpen className="folder-icon" /> : <FaFolder className="folder-icon" />}
                <span className="folder-name">{folderName}</span>
                <span className="folder-count">({filesInFolder})</span>
              </div>
            </div>
            {isExpanded && renderFolderTree(folderPath, level + 1)}
          </div>
        );
      });
    }
    // Only show files for the currently opened folder in grid view
    if (currentPath === path) {
  let filteredFiles = storageFiles.filter(file => file.name !== '.keep' && file.name !== '.folder-placeholder' && file.path === path);
      if (fileFilter) {
        filteredFiles = filteredFiles.filter(file => file.name.toLowerCase().includes(fileFilter.toLowerCase()));
      }
      filteredFiles = filteredFiles.sort((a, b) => {
        if (fileSort === 'name') return a.name.localeCompare(b.name);
        if (fileSort === 'size') return a.size - b.size;
        if (fileSort === 'type') return (a.type || '').localeCompare(b.type || '');
        return 0;
      });
      items.push(
        <div key={path + '-file-grid'} className="file-grid-view">
          {filteredFiles.length === 0 ? (
            <div className="empty-state">No files found.</div>
          ) : (
            filteredFiles.map(file => (
              <div key={file.id} className="file-grid-item" onClick={() => onFileSelect && onFileSelect(file)} title={file.name}>
                <div className="item-content">
                  {getFileIcon(file.name, file.type)}
                  <span className="file-name" title={file.name}>{file.name}</span>
                  <span className="file-size">{formatFileSize(file.size)}</span>
                  {file.isStorageFile && <span className="storage-badge" title="File in Firebase Storage">Storage</span>}
                </div>
              </div>
            ))
          )}
        </div>
      );
    }
  return <>{items}</>;
  };

  if (loading) return <div className="loading">Loading files...</div>;

  return (
    <div className="folder-tree">
      <div className="tree-header" onContextMenu={e => handleContextMenu(e, currentPath, 'background')}>
        <div className="breadcrumb-path">
          <span className="path-label">📁</span>
          <div className="breadcrumb-nav">
            {/* Breadcrumbs */}
          </div>
        </div>
        <div className="tree-controls">
          <input
            type="text"
            className="file-filter-input"
            placeholder="Filter files..."
            value={fileFilter}
            onChange={e => setFileFilter(e.target.value)}
            style={{ marginRight: '8px' }}
          />
          <select className="file-sort-select" value={fileSort} onChange={e => setFileSort(e.target.value)}>
            <option value="name">Sort by Name</option>
            <option value="size">Sort by Size</option>
            <option value="type">Sort by Type</option>
          </select>
        </div>
      </div>
      {/* Context Menu UI */}
      {contextMenu.visible && (
        <div className="context-menu" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999, background: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: '160px', padding: '4px 0' }} onMouseLeave={hideContextMenu}>
          {contextMenu.type === 'folder' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>Folder Actions</div>
              <div className="context-menu-item" style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', cursor: 'pointer', gap: '8px' }} onClick={() => handleMenuAction('rename')}>
                <FaFolderOpen style={{ color: '#007bff' }} /> Rename Folder
              </div>
              <div className="context-menu-item" style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', cursor: 'pointer', gap: '8px', color: '#d9534f' }} onClick={() => handleMenuAction('delete')}>
                <FaTrash style={{ color: '#d9534f' }} /> Delete Folder
              </div>
              <div className="context-menu-item" style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', cursor: 'pointer', gap: '8px' }} onClick={() => handleMenuAction('create')}>
                <FaFolder style={{ color: '#28a745' }} /> New Subfolder
              </div>
            </>
          )}
          {contextMenu.type === 'background' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>Root Actions</div>
              <div className="context-menu-item" style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', cursor: 'pointer', gap: '8px' }} onClick={() => handleMenuAction('create')}>
                <FaFolder style={{ color: '#28a745' }} /> New Folder
              </div>
            </>
          )}
        </div>
      )}
      {/* New Folder Input UI */}
      {showNewFolderInput && (
        <div className="new-folder-popup" style={{ position: 'fixed', top: contextMenu.y + 20, left: contextMenu.x, zIndex: 10000, background: '#fff', border: '1px solid #ccc', borderRadius: '4px', padding: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          <input
            type="text"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="Enter folder name"
            autoFocus
            style={{ marginRight: '8px' }}
          />
          <button onClick={handleCreateFolder}>Create</button>
          <button onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}>Cancel</button>
        </div>
      )}
      {/* Rename Folder Input UI */}
      {renamingFolder && (
        <div className="rename-folder-popup" style={{ position: 'fixed', top: contextMenu.y + 20, left: contextMenu.x, zIndex: 10000, background: '#fff', border: '1px solid #ccc', borderRadius: '4px', padding: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          <input
            type="text"
            value={renameFolderName}
            onChange={e => setRenameFolderName(e.target.value)}
            placeholder="Enter new folder name"
            autoFocus
            style={{ marginRight: '8px' }}
          />
          <button onClick={handleRenameFolder}>Rename</button>
          <button onClick={() => { setRenamingFolder(null); setRenameFolderName(''); }}>Cancel</button>
        </div>
      )}
      {/* Success/Error Popup */}
      {showSuccessPopup && (
        <div className="success-popup" style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 10001, background: isError ? '#ffeaea' : '#eaffea', border: '1px solid #ccc', borderRadius: '4px', padding: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          {successMessage}
          <button style={{ marginLeft: '12px' }} onClick={() => setShowSuccessPopup(false)}>Close</button>
        </div>
      )}
  <div className="tree-content">{renderFolderTree(ROOT_PATH, 0)}</div>
    </div>
  );
};

export default FolderTree;
