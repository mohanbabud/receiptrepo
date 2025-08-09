import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { ref, listAll, getMetadata, getDownloadURL, uploadBytes, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import StorageTreeView from './StorageTreeView';
import { FaFolder, FaFolderOpen, FaFile, FaImage, FaFilePdf, FaFileAlt, FaVideo, FaMusic, FaTrash, FaEdit, FaCopy, FaCut } from 'react-icons/fa';
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
  const [selection, setSelection] = useState({ type: 'background', target: null });
  const [clipboard, setClipboard] = useState(null); // { action: 'copy'|'cut', itemType: 'file'|'folder', payload }
  const [moveCopyModal, setMoveCopyModal] = useState({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH });

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
  setSelection({ type, target });
  };
  const hideContextMenu = () => setContextMenu({ visible: false, x: 0, y: 0, target: null, type: null });
  const handleMenuAction = async (action) => {
    try {
      if (contextMenu.type === 'folder') {
        const folderPath = contextMenu.target;
        if (action === 'rename') {
          setRenamingFolder(folderPath);
          setRenameFolderName(folderPath.split('/').filter(Boolean).pop());
        } else if (action === 'create-folder') {
          setShowNewFolderInput(true);
        } else if (action === 'create-file') {
          await handleNewFile(folderPath);
        } else if (action === 'delete') {
          if (userRole !== 'admin') { alert('Only admin can delete.'); hideContextMenu(); return; }
          await handleDeleteFolder(folderPath);
        } else if (action === 'copy') {
          setMoveCopyModal({ open: true, mode: 'copy', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'move') {
          setMoveCopyModal({ open: true, mode: 'move', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'details') {
          await showFolderDetails(folderPath);
        }
      } else if (contextMenu.type === 'file') {
        const fileItem = contextMenu.target; // storageFiles entry
        if (!fileItem) return;
        if (action === 'rename') {
          await handleRenameFile(fileItem);
        } else if (action === 'delete') {
          if (userRole !== 'admin') { alert('Only admin can delete.'); hideContextMenu(); return; }
          await handleDeleteFile(fileItem);
        } else if (action === 'copy') {
          setMoveCopyModal({ open: true, mode: 'copy', itemType: 'file', target: fileItem, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'move') {
          setMoveCopyModal({ open: true, mode: 'move', itemType: 'file', target: fileItem, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'details') {
          showFileDetails(fileItem);
        } else if (action === 'create-file') {
          await handleNewFile(currentPath);
        } else if (action === 'create-folder') {
          setShowNewFolderInput(true);
        }
      } else if (contextMenu.type === 'background') {
        if (action === 'create-folder') setShowNewFolderInput(true);
        if (action === 'create-file') await handleNewFile(currentPath);
      }
    } finally {
      hideContextMenu();
    }
  };

  const normalizeFolderPath = (inputPath) => {
    let p = String(inputPath || '').trim();
    if (!p) return ROOT_PATH;
    // Ensure starts with '/files/' and ends with '/'
    p = p.replace(/\\/g, '/');
    if (!p.startsWith('/')) p = '/' + p;
    if (!p.startsWith('/files/')) p = '/files' + (p === '/' ? '/' : p);
    if (!p.endsWith('/')) p += '/';
    return p.replace(/\/+/g, '/');
  };

  const handleNewFile = async (folderPath) => {
    if (userRole === 'viewer') { alert('You do not have permission to create files.'); return; }
    const name = prompt('Enter new file name (e.g., note.txt):');
    if (!name || !name.trim()) return;
    const safeFolder = normalizeFolderPath(folderPath || currentPath);
    const objectPath = `${safeFolder}${name.trim().replace(/^\/+|\/+$/g, '')}`.replace(/^\/+/, '');
    try {
      const fileRef = ref(storage, objectPath);
      await uploadBytes(fileRef, new Uint8Array());
      setSuccessMessage('File created');
      setIsError(false);
      setShowSuccessPopup(true);
      await loadData();
    } catch (err) {
      setIsError(true);
      setSuccessMessage('Error creating file: ' + (err.message || err.toString()));
      setShowSuccessPopup(true);
    }
  };

  // Keyboard shortcuts for selection
  const handleKeyDown = async (e) => {
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    // New Folder
    if (ctrl && !e.shiftKey && key.toLowerCase() === 'n') {
      e.preventDefault();
      setShowNewFolderInput(true);
      return;
    }
    // New File
    if (ctrl && e.shiftKey && key.toLowerCase() === 'n') {
      e.preventDefault();
      await handleNewFile(currentPath);
      return;
    }
    // Rename
    if (key === 'F2') {
      e.preventDefault();
      if (selection.type === 'folder' && selection.target) {
        setRenamingFolder(selection.target);
        setRenameFolderName(selection.target.split('/').filter(Boolean).pop());
      } else if (selection.type === 'file' && selection.target) {
        await handleRenameFile(selection.target);
      }
      return;
    }
    // Delete (admin only)
    if (key === 'Delete') {
      e.preventDefault();
      if (userRole !== 'admin') return;
      if (selection.type === 'folder' && selection.target) {
        await handleDeleteFolder(selection.target);
      } else if (selection.type === 'file' && selection.target) {
        await handleDeleteFile(selection.target);
      }
      return;
    }
    // Copy
    if (ctrl && key.toLowerCase() === 'c') {
      e.preventDefault();
      if (selection.type === 'folder' && selection.target) setClipboard({ action: 'copy', itemType: 'folder', payload: selection.target });
      if (selection.type === 'file' && selection.target) setClipboard({ action: 'copy', itemType: 'file', payload: selection.target });
      return;
    }
    // Cut (move)
    if (ctrl && key.toLowerCase() === 'x') {
      e.preventDefault();
      if (selection.type === 'folder' && selection.target) setClipboard({ action: 'cut', itemType: 'folder', payload: selection.target });
      if (selection.type === 'file' && selection.target) setClipboard({ action: 'cut', itemType: 'file', payload: selection.target });
      return;
    }
    // Paste
    if (ctrl && key.toLowerCase() === 'v') {
      e.preventDefault();
      if (!clipboard) return;
      const destFolder = normalizeFolderPath(currentPath);
      try {
        if (clipboard.itemType === 'file') {
          const fileItem = clipboard.payload;
          const dest = `${destFolder}${fileItem.name}`;
          const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
          const destRef = ref(storage, dest.replace(/^\/+/, ''));
          await uploadBytes(destRef, data);
          if (clipboard.action === 'cut') {
            await deleteObject(fileItem.ref);
          }
        } else if (clipboard.itemType === 'folder') {
          const srcFolderPath = clipboard.payload;
          await copyFolder(srcFolderPath, destFolder, clipboard.action === 'cut');
        }
        setClipboard(null);
        await loadData();
        setSuccessMessage('Paste completed');
        setIsError(false);
        setShowSuccessPopup(true);
      } catch (e2) {
        setIsError(true);
        setSuccessMessage('Error pasting: ' + (e2.message || e2.toString()));
        setShowSuccessPopup(true);
      }
      return;
    }
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

  // File operations
  const handleRenameFile = async (fileItem) => {
    const oldFull = fileItem.ref.fullPath; // e.g., files/a/b/name.ext
    const newName = prompt('Enter new file name:', fileItem.name);
    if (!newName || !newName.trim()) return;
    const newFull = oldFull.replace(/[^/]+$/, newName.trim());
    try {
      const fileBytes = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const newRef = ref(storage, newFull);
      await uploadBytes(newRef, fileBytes);
      await deleteObject(fileItem.ref);
      setSuccessMessage('File renamed successfully!');
      setShowSuccessPopup(true);
      await loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error renaming file: ' + (error.message || error.toString()));
      setShowSuccessPopup(true);
    }
  };

  const handleDeleteFile = async (fileItem) => {
    try {
      await deleteObject(fileItem.ref);
      setSuccessMessage('File deleted successfully!');
      setShowSuccessPopup(true);
      await loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error deleting file');
      setShowSuccessPopup(true);
    }
  };

  const handleCopyFile = async (fileItem) => {
    const destFolder = prompt('Copy to folder under /files (e.g., /files/Target/Sub):', currentPath || ROOT_PATH);
    if (!destFolder) return;
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const destRef = ref(storage, dest.replace(/^\/+/, ''));
      await uploadBytes(destRef, data);
      setSuccessMessage('File copied');
      setIsError(false);
      setShowSuccessPopup(true);
      await loadData();
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Error copying file: ' + (e.message || e.toString()));
      setShowSuccessPopup(true);
    }
  };

  const handleMoveFile = async (fileItem) => {
    const destFolder = prompt('Move to folder under /files (e.g., /files/Target/Sub):', currentPath || ROOT_PATH);
    if (!destFolder) return;
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const destRef = ref(storage, dest.replace(/^\/+/, ''));
      await uploadBytes(destRef, data);
      await deleteObject(fileItem.ref);
      setSuccessMessage('File moved');
      setIsError(false);
      setShowSuccessPopup(true);
      await loadData();
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Error moving file: ' + (e.message || e.toString()));
      setShowSuccessPopup(true);
    }
  };

  // Destination-aware helpers used by modal
  const handleCopyFileTo = async (fileItem, destFolder) => {
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const destRef = ref(storage, dest.replace(/^\/+/, ''));
      await uploadBytes(destRef, data);
      setSuccessMessage('File copied');
      setIsError(false);
      setShowSuccessPopup(true);
      await loadData();
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Error copying file: ' + (e.message || e.toString()));
      setShowSuccessPopup(true);
    }
  };

  const handleMoveFileTo = async (fileItem, destFolder) => {
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const destRef = ref(storage, dest.replace(/^\/+/, ''));
      await uploadBytes(destRef, data);
      await deleteObject(fileItem.ref);
      setSuccessMessage('File moved');
      setIsError(false);
      setShowSuccessPopup(true);
      await loadData();
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Error moving file: ' + (e.message || e.toString()));
      setShowSuccessPopup(true);
    }
  };

  // Folder copy/move (recursive)
  const copyFolder = async (srcFolderPath, destFolderPath, removeOriginal = false) => {
    const src = normalizeFolderPath(srcFolderPath);
    const dst = normalizeFolderPath(destFolderPath);
    if (dst.startsWith(src)) {
      alert('Destination cannot be inside the source folder.');
      return;
    }
    try {
      const walk = async (fromPath, toPath) => {
        const fromRef = ref(storage, fromPath.replace(/^\/+/, ''));
        const result = await listAll(fromRef);
        // Copy files
        for (const item of result.items) {
          const bytes = await import('firebase/storage').then(mod => mod.getBytes(item));
          const rel = item.fullPath.substring(src.length).replace(/^\/+/, '');
          const toFile = (toPath + rel).replace(/^\/+/, '');
          const toRef = ref(storage, toFile);
          await uploadBytes(toRef, bytes);
          if (removeOriginal) {
            await deleteObject(item);
          }
        }
        // Recurse folders
        for (const prefix of result.prefixes) {
          const relFolder = prefix.fullPath.substring(src.length);
          await walk(prefix.fullPath, (dst + relFolder).replace(/\/+/g, '/'));
          if (removeOriginal) {
            // Try to delete any .keep if exists
            try { await deleteObject(ref(storage, prefix.fullPath + '/.keep')); } catch (e) {}
          }
        }
      };
      await walk(src, dst);
      setSuccessMessage(removeOriginal ? 'Folder moved successfully!' : 'Folder copied successfully!');
      setIsError(false);
      setShowSuccessPopup(true);
      await loadData();
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Error processing folder: ' + (e.message || e.toString()));
      setShowSuccessPopup(true);
    }
  };

  const showFolderDetails = async (folderPath) => {
    try {
      const base = normalizeFolderPath(folderPath);
      const folderRef = ref(storage, base.replace(/^\/+/, ''));
      // Shallow list only for quick stats
      const res = await listAll(folderRef);
      const filesHere = res.items.length;
      const subfolders = res.prefixes.length;
      alert(`Folder: ${base}\nSubfolders: ${subfolders}\nFiles (direct): ${filesHere}`);
    } catch (e) {
      alert('Error fetching details: ' + (e.message || e.toString()));
    }
  };

  const showFileDetails = (fileItem) => {
    const info = [
      `Name: ${fileItem.name}`,
      `Path: ${fileItem.path}`,
      `Size: ${formatFileSize(fileItem.size)}`,
      `Type: ${fileItem.type || 'unknown'}`,
      `Uploaded: ${fileItem.uploadedAt || 'unknown'}`
    ].join('\n');
    alert(info);
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
              {userRole !== 'viewer' && (
                <div className="folder-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', paddingRight: 8 }} onClick={e => e.stopPropagation()}>
                  <button className="icon-btn rename" title="Rename" onClick={async () => {
                    const newName = prompt('Enter new folder name:', folderName);
                    if (!newName || !newName.trim() || newName.trim() === folderName) return;
                    const newPath = folderPath.replace(/[^/]+\/$/, newName.trim() + '/');
                    await copyFolder(folderPath, newPath, true);
                  }}>
                    <FaEdit />
                  </button>
                  <button className="icon-btn copy" title="Copy" onClick={() => {
                    setMoveCopyModal({ open: true, mode: 'copy', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
                  }}>
                    <FaCopy />
                  </button>
                  <button className="icon-btn move" title="Move" onClick={() => {
                    setMoveCopyModal({ open: true, mode: 'move', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
                  }}>
                    <FaCut />
                  </button>
                  {userRole === 'admin' && (
                    <button className="icon-btn delete" title="Delete" onClick={async () => { await handleDeleteFolder(folderPath); }}>
                      <FaTrash />
                    </button>
                  )}
                </div>
              )}
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
              <div
                key={file.id}
                className={`file-grid-item ${selection.type === 'file' && selection.target?.id === file.id ? 'selected' : ''}`}
                onClick={() => { onFileSelect && onFileSelect(file); setSelection({ type: 'file', target: file }); }}
                onContextMenu={e => handleContextMenu(e, file, 'file')}
                title={file.name}
              >
                <div className="item-content">
                  {getFileIcon(file.name, file.type)}
                  <span className="file-name" title={file.name}>{file.name}</span>
                  <span className="file-size">{formatFileSize(file.size)}</span>
                  {file.isStorageFile && <span className="storage-badge" title="File in Firebase Storage">Storage</span>}
                </div>
                {userRole !== 'viewer' && (
                  <div className="file-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', paddingRight: 8 }} onClick={e => e.stopPropagation()}>
                    <button className="icon-btn rename" title="Rename" onClick={async () => { await handleRenameFile(file); }}>
                      <FaEdit />
                    </button>
                    <button className="icon-btn copy" title="Copy" onClick={() => { setMoveCopyModal({ open: true, mode: 'copy', itemType: 'file', target: file, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
                      <FaCopy />
                    </button>
                    <button className="icon-btn move" title="Move" onClick={() => { setMoveCopyModal({ open: true, mode: 'move', itemType: 'file', target: file, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
                      <FaCut />
                    </button>
                    {userRole === 'admin' && (
                      <button className="icon-btn delete" title="Delete" onClick={async () => { await handleDeleteFile(file); }}>
                        <FaTrash />
                      </button>
                    )}
                  </div>
                )}
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
  <div className="folder-tree" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="tree-header" onContextMenu={e => handleContextMenu(e, currentPath, 'background')}>
        <div className="breadcrumb-path">
          <span className="path-label">📁</span>
          <div className="breadcrumb-nav">
            {(() => {
              // Build breadcrumbs from currentPath
              const safe = normalizeFolderPath(currentPath);
              const parts = safe.replace(/^\/files\/?/, '').split('/').filter(Boolean);
              const crumbs = [{ label: 'PNLM', path: ROOT_PATH }];
              let acc = ROOT_PATH;
              parts.forEach(p => {
                acc = acc + p + '/';
                crumbs.push({ label: p, path: acc });
              });
              return crumbs.map((c, idx) => (
                <span key={c.path} className="breadcrumb-item">
                  <button
                    type="button"
                    className={`breadcrumb-link ${currentPath === c.path ? 'active' : ''}`}
                    onClick={() => {
                      setExpandedFolders(prev => new Set(prev).add(c.path));
                      onPathChange(c.path);
                    }}
                  >
                    {c.label}
                  </button>
                  {idx < crumbs.length - 1 && <span className="breadcrumb-separator">/</span>}
                </span>
              ));
            })()}
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
        <div className="context-menu" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999, background: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: '200px', padding: '4px 0' }} onMouseLeave={hideContextMenu}>
          {contextMenu.type === 'folder' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>Folder Actions</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-folder')}>📁 New Subfolder</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-file')}>📄 New File</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('rename')}>✏️ Rename</div>
              {userRole === 'admin' && (
                <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer', color: '#d9534f' }} onClick={() => handleMenuAction('delete')}>🗑️ Delete</div>
              )}
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('copy')}>📋 Copy</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('move')}>📦 Move</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('details')}>ℹ️ Details</div>
            </>
          )}
          {contextMenu.type === 'file' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>File Actions</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-file')}>📄 New File</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-folder')}>📁 New Folder</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('rename')}>✏️ Rename</div>
              {userRole === 'admin' && (
                <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer', color: '#d9534f' }} onClick={() => handleMenuAction('delete')}>🗑️ Delete</div>
              )}
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('copy')}>📋 Copy</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('move')}>📦 Move</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('details')}>ℹ️ Details</div>
            </>
          )}
          {contextMenu.type === 'background' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>Here</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-folder')}>📁 New Folder</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-file')}>📄 New File</div>
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
      {moveCopyModal.open && (
        <div className="move-copy-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }}>
          <div style={{ background: '#fff', width: '840px', maxWidth: '95vw', maxHeight: '90vh', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 600 }}>
                {moveCopyModal.mode === 'copy' ? 'Copy to…' : 'Move to…'}
              </div>
              <button onClick={() => setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH })} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
              <div style={{ padding: 12, borderRight: '1px solid #eee' }}>
                <StorageTreeView
                  currentPath={(moveCopyModal.dest || ROOT_PATH).replace(/^\/+/, '').replace(/\\/g,'/')}
                  onFolderSelect={(p) => {
                    // Normalize to '/files/.../' form
                    const normalized = (() => {
                      let pp = String(p || '').trim();
                      pp = pp.replace(/\\/g, '/');
                      if (!pp.startsWith('/')) pp = '/' + pp;
                      if (!pp.startsWith('/files/')) pp = '/files' + (pp === '/' ? '/' : pp);
                      if (!pp.endsWith('/')) pp += '/';
                      return pp.replace(/\/+/, '/');
                    })();
                    setMoveCopyModal(prev => ({ ...prev, dest: normalized }));
                  }}
                />
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>Destination</div>
                <input type="text" value={moveCopyModal.dest} onChange={e => setMoveCopyModal(prev => ({ ...prev, dest: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH })} style={{ padding: '8px 12px' }}>Cancel</button>
                  <button
                    onClick={async () => {
                      const dest = moveCopyModal.dest;
                      if (!dest) return;
                      try {
                        if (moveCopyModal.itemType === 'file') {
                          if (moveCopyModal.mode === 'copy') await handleCopyFileTo(moveCopyModal.target, dest);
                          else await handleMoveFileTo(moveCopyModal.target, dest);
                        } else if (moveCopyModal.itemType === 'folder') {
                          await copyFolder(moveCopyModal.target, dest, moveCopyModal.mode === 'move');
                        }
                        setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH });
                      } catch (e) {
                        // Error is surfaced via inner functions
                      }
                    }}
                    style={{ padding: '8px 12px', background: '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    {moveCopyModal.mode === 'copy' ? 'Copy here' : 'Move here'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FolderTree;
