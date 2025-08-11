import React, { useState, useEffect, useRef } from 'react';
import { ref, listAll, getMetadata, uploadBytes, deleteObject, getDownloadURL } from 'firebase/storage';
import { storage, db, auth } from '../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import StorageTreeView from './StorageTreeView';
import { FaTrash, FaEdit, FaCopy, FaCut, FaStar, FaRegStar } from 'react-icons/fa';
import { MacFolderIcon, MacFileIcon } from './icons/MacIcons';
import './FolderTree.css';

const ROOT_PATH = '/files/';

const FolderTree = ({ currentPath, onPathChange, refreshTrigger, userRole, onFileSelect, filesOnly = false }) => {
  // State
  // Removed Firestore-backed files/folders; relying on Storage data only
  const [, setExpandedFolders] = useState(new Set([ROOT_PATH]));
  const [fileSort, setFileSort] = useState('name');
  const [fileSortDir, setFileSortDir] = useState('asc'); // 'asc' | 'desc'
  const [fileFilter, setFileFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [filePage, setFilePage] = useState(1);
  const [pageSize, setPageSize] = useState(50); // items per page for files
  const [storageFiles, setStorageFiles] = useState([]);
  const [storageFolders, setStorageFolders] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [includeNestedFiles, setIncludeNestedFiles] = useState(false);
  const [folderView, setFolderView] = useState('cards'); // 'cards' | 'list'
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, target: null, type: null });
  const [renamingFolder, setRenamingFolder] = useState(null); // Keeping this for context
  const [renameFolderName, setRenameFolderName] = useState(''); // Keeping this for context
  const [newFolderName, setNewFolderName] = useState(''); // Keeping this for context
  const [newFolderBasePath, setNewFolderBasePath] = useState(null); // Base path for creating new folder
  const [showNewFolderInput, setShowNewFolderInput] = useState(false); // Keeping this for context
  const [showSuccessPopup, setShowSuccessPopup] = useState(false); // Keeping this for context
  const [successMessage, setSuccessMessage] = useState(''); // Keeping this for context
  const [isError, setIsError] = useState(false); // Keeping this for context
  const [selection, setSelection] = useState({ type: 'background', target: null });
  const [clipboard, setClipboard] = useState(null); // { action: 'copy'|'cut', itemType: 'file'|'folder', payload }
  const [moveCopyModal, setMoveCopyModal] = useState({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH, overwrite: false });
  const [moveCopyBusy, setMoveCopyBusy] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  // Labels (tags + color) and Favorites state
  const [folderLabels, setFolderLabels] = useState({}); // { [path]: { tags: string[], color: string } }
  const [favoriteFolders, setFavoriteFolders] = useState(new Set()); // Set<string>
  const [labelEditor, setLabelEditor] = useState({ open: false, path: null, tagsText: '', color: '#4b5563' });
  const menuRef = useRef(null);
  const longPressRef = useRef({ timer: null, fired: false, target: null, type: null, startX: 0, startY: 0 });

  const openContextMenuAt = (x, y, target, type) => {
    setContextMenu({ visible: true, x, y, target, type });
    setSelection({ type, target });
  };

  const startLongPress = (e, target, type) => {
    if (!e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    const lp = longPressRef.current;
    clearTimeout(lp.timer);
    lp.fired = false;
    lp.target = target;
    lp.type = type;
    lp.startX = x;
    lp.startY = y;
    lp.timer = setTimeout(() => {
      lp.fired = true;
      openContextMenuAt(x, y, target, type);
    }, 550);
  };

  const moveLongPress = (e) => {
    const lp = longPressRef.current;
    if (!lp.timer || !e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - lp.startX);
    const dy = Math.abs(touch.clientY - lp.startY);
    if (dx > 10 || dy > 10) {
      clearTimeout(lp.timer);
      lp.timer = null;
    }
  };

  const endLongPress = () => {
    const lp = longPressRef.current;
    if (lp.timer) {
      clearTimeout(lp.timer);
      lp.timer = null;
    }
    // If a long-press fired, suppress the immediate click that follows
    setTimeout(() => { lp.fired = false; }, 0);
  };

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, refreshTrigger, includeNestedFiles]);

  // Subscribe to Firestore metadata for labels and per-user favorites
  useEffect(() => {
    // Folder labels (global)
    const unsubLabels = onSnapshot(collection(db, 'folders_meta'), (snap) => {
      const map = {};
      snap.forEach((d) => {
        const data = d.data() || {};
        if (data.path) map[data.path] = { tags: Array.isArray(data.tags) ? data.tags : [], color: data.color || '#4b5563' };
      });
      setFolderLabels(map);
    }, (err) => console.warn('folders_meta listener error', err));

    // Favorites (per-user)
    let unsubFav = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (unsubFav) { try { unsubFav(); } catch {} finally { unsubFav = null; } }
      if (!u) {
        setFavoriteFolders(new Set());
        return;
      }
      unsubFav = onSnapshot(collection(db, 'users', u.uid, 'favorites'), (snap) => {
        const set = new Set();
        snap.forEach((d) => {
          const data = d.data() || {};
          if ((data.kind || 'folder') === 'folder' && data.path) set.add(data.path);
        });
        setFavoriteFolders(set);
      }, (err) => console.warn('favorites listener error', err));
    });

    return () => {
      try { unsubLabels(); } catch {}
      try { unsubFav && unsubFav(); } catch {}
      try { unsubAuth(); } catch {}
    };
  }, []);
  // Reset page when filters, sort, or path changes
  useEffect(() => {
    setFilePage(1);
  }, [fileFilter, fileSort, currentPath, storageFiles.length]);

  // Clear filters and selection when navigating to a different folder
  useEffect(() => {
    setFileFilter('');
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    setFilePage(1);
  }, [currentPath]);

  // Ensure ancestors of the current path are expanded so the view reflects the selection
  useEffect(() => {
    const safe = normalizeFolderPath(currentPath || ROOT_PATH);
    const parts = safe.replace(/^\/+|\/+$/g, '').split('/'); // e.g., ['files','A','B']
    let acc = '/';
    const toExpand = new Set([ROOT_PATH]);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      if (p === 'files') { acc = ROOT_PATH; toExpand.add(ROOT_PATH); continue; }
      acc = acc + p + '/';
      toExpand.add(acc);
    }
    setExpandedFolders(prev => new Set([...(prev || []), ...toExpand]));
  }, [currentPath]);

  // Load current folder from Storage (no recursion, minimal metadata)
  const loadData = async () => {
    setLoading(true);
    try {
      const safe = normalizeFolderPath(currentPath || ROOT_PATH);
      const storagePath = safe.replace(/^\/+/, '').replace(/\/+$/, ''); // files/... (no leading/trailing slash)
      const folderRef = ref(storage, storagePath);
      const folderSet = new Set([ROOT_PATH, safe]);
      const fileList = [];

      if (!includeNestedFiles) {
        // Shallow listing: only direct subfolders and files
        const result = await listAll(folderRef);
        for (const prefix of result.prefixes) {
          const subFolderPath = safe + prefix.name + '/';
          folderSet.add(subFolderPath);
        }
        for (const item of result.items) {
          const filePath = safe; // direct files
          fileList.push({ id: item.fullPath, name: item.name, path: filePath, ref: item, isStorageFile: true });
        }
      } else {
        // Deep listing: include files in all nested subfolders
        const walk = async (baseSafe, baseRef) => {
          const res = await listAll(baseRef);
          // Files in this folder
          for (const item of res.items) {
            // Compute file's parent folder path in '/files/.../' form
            const full = item.fullPath; // 'files/.../name'
            const parent = '/' + full.substring(0, full.lastIndexOf('/') + 1); // '/files/.../'
            fileList.push({ id: item.fullPath, name: item.name, path: parent, ref: item, isStorageFile: true });
          }
          // Recurse into subfolders
          for (const prefix of res.prefixes) {
            const subSafe = baseSafe + prefix.name + '/';
            folderSet.add(subSafe);
            await walk(subSafe, prefix);
          }
        };
        await walk(safe, folderRef);
      }

      setStorageFolders(prev => new Set([...(prev || []), ...folderSet]));
      setStorageFiles(fileList);
    } catch (error) {
      console.error('Error loading current folder:', error);
    } finally {
      setLoading(false);
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
  if (fileType?.startsWith('image/')) return <MacFileIcon type="image" className="file-icon image" />;
  if (fileType?.startsWith('video/')) return <MacFileIcon type="video" className="file-icon video" />;
  if (fileType?.startsWith('audio/')) return <MacFileIcon type="audio" className="file-icon audio" />;
  if (fileType === 'application/pdf') return <MacFileIcon type="pdf" className="file-icon pdf" />;
  return <MacFileIcon className="file-icon document" />;
  };

  // toggleFolder removed (UI no longer renders a recursive left tree inside this component)

  // Context menu logic
  const handleContextMenu = (e, target, type) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, target, type });
  setSelection({ type, target });
  };
  const hideContextMenu = () => setContextMenu({ visible: false, x: 0, y: 0, target: null, type: null });
  const toggleSelectFile = (fileItem) => {
    if (!fileItem?.id) return;
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileItem.id)) next.delete(fileItem.id); else next.add(fileItem.id);
      return next;
    });
  };
  const toggleSelectFolder = (folderPath) => {
    if (!folderPath) return;
    setSelectedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath); else next.add(folderPath);
      return next;
    });
  };
  const clearSelection = () => { setSelectedFiles(new Set()); setSelectedFolders(new Set()); };

  // Close context menu on outside click, Escape, scroll, or resize
  useEffect(() => {
    const onDocMouseDown = (ev) => {
      if (!contextMenu.visible) return;
      const el = menuRef.current;
      if (el && !el.contains(ev.target)) hideContextMenu();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') hideContextMenu();
    };
    const onDismiss = () => {
      if (contextMenu.visible) hideContextMenu();
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss, true);
    };
  }, [contextMenu.visible]);
  // eslint-disable-next-line no-unused-vars
  const openBulkModal = (mode) => {
    const files = storageFiles.filter(f => selectedFiles.has(f.id));
    const folders = Array.from(selectedFolders);
    if (files.length === 0 && folders.length === 0) return;
    setMoveCopyModal({ open: true, mode, itemType: 'bulk', target: { files, folders }, dest: normalizeFolderPath(currentPath || ROOT_PATH), overwrite: false });
  };
  // eslint-disable-next-line no-unused-vars
  const handleBulkDelete = async () => {
    if (userRole !== 'admin') { alert('Only admin can delete.'); return; }
    const files = storageFiles.filter(f => selectedFiles.has(f.id));
    const folders = Array.from(selectedFolders);
    if (files.length === 0 && folders.length === 0) return;
    try {
      // Delete files
      for (const f of files) {
        try { await deleteObject(f.ref); } catch (e) { console.warn('Failed to delete file', f.id, e); }
      }
      // Delete folders
      for (const p of folders) {
        try { await handleDeleteFolder(p); } catch (e) { console.warn('Failed to delete folder', p, e); }
      }
      clearSelection();
      await loadData();
      setIsError(false);
      setSuccessMessage(`Deleted ${files.length} file(s) and ${folders.length} folder(s).`);
      setShowSuccessPopup(true);
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Bulk delete encountered errors.');
      setShowSuccessPopup(true);
    }
  };
  const handleMenuAction = async (action) => {
    try {
      if (contextMenu.type === 'folder') {
        const folderPath = contextMenu.target;
        if (action === 'rename') {
          setRenamingFolder(folderPath);
          setRenameFolderName(folderPath.split('/').filter(Boolean).pop());
        } else if (action === 'create-folder') {
          setNewFolderBasePath(normalizeFolderPath(folderPath));
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
        } else if (action === 'download') {
          await downloadFolderAsZip(folderPath);
        } else if (action === 'favorite') {
          await toggleFavorite(folderPath);
        } else if (action === 'labels') {
          openLabelEditor(folderPath);
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
        } else if (action === 'download') {
          await downloadSingleFile(fileItem);
        }
      } else if (contextMenu.type === 'background') {
        if (action === 'create-folder') {
          setNewFolderBasePath(normalizeFolderPath(currentPath || ROOT_PATH));
          setShowNewFolderInput(true);
        }
        if (action === 'create-file') await handleNewFile(currentPath);
      }
    } finally {
      hideContextMenu();
    }
  };

  // Favorites & Labels helpers
  const encodePathId = (p) => encodeURIComponent(p);
  const toggleFavorite = async (folderPath) => {
    const u = auth.currentUser; if (!u) { alert('Please sign in to use favorites.'); return; }
    const favRef = doc(db, 'users', u.uid, 'favorites', encodePathId(folderPath));
    if (favoriteFolders.has(folderPath)) await deleteDoc(favRef);
    else await setDoc(favRef, { kind: 'folder', path: folderPath, addedAt: Date.now() });
  };
  const openLabelEditor = (folderPath) => {
    const current = folderLabels[folderPath] || { tags: [], color: '#4b5563' };
    setLabelEditor({ open: true, path: folderPath, tagsText: current.tags.join(', '), color: current.color || '#4b5563' });
  };
  const saveLabels = async () => {
    const { path, tagsText, color } = labelEditor;
    if (!path) return;
    const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);
    await setDoc(doc(db, 'folders_meta', encodePathId(path)), { path, tags, color: color || '#4b5563' }, { merge: true });
    setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' });
  };
  const removeLabels = async () => {
    const { path } = labelEditor;
    if (!path) return;
    await setDoc(doc(db, 'folders_meta', encodePathId(path)), { path, tags: [], color: '' }, { merge: true });
    setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' });
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
    // Select All files in current folder (respects filter)
    if (ctrl && key.toLowerCase() === 'a') {
      e.preventDefault();
      const safe = normalizeFolderPath(currentPath || ROOT_PATH);
      let all = storageFiles.filter(f => f.path === safe && f.name !== '.keep' && f.name !== '.folder-placeholder');
      if (fileFilter) all = all.filter(f => f.name.toLowerCase().includes(fileFilter.toLowerCase()));
      setSelectedFiles(new Set(all.map(f => f.id)));
      return;
    }
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

  // Destination-aware helpers used by modal
  const handleCopyFileTo = async (fileItem, destFolder, overwrite = false, opts = {}) => {
    const { silent = false } = opts || {};
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const destRef = ref(storage, dest.replace(/^\/+/, ''));
      // Overwrite check
      let exists = false;
      try { await getMetadata(destRef); exists = true; } catch (e) { exists = false; }
      if (exists && !overwrite) {
        if (!silent) {
          setIsError(false);
          setSuccessMessage('Copy skipped: destination already has a file with this name.');
          setShowSuccessPopup(true);
        }
        return;
      }
      await uploadBytes(destRef, data);
      if (!silent) {
        setSuccessMessage('File copied');
        setIsError(false);
        setShowSuccessPopup(true);
        await loadData();
      }
    } catch (e) {
      if (silent) {
        // Propagate to caller so bulk flow can count failures without per-item popups
        throw e;
      } else {
        setIsError(true);
        setSuccessMessage('Error copying file: ' + (e.message || e.toString()));
        setShowSuccessPopup(true);
      }
    }
  };

  const handleMoveFileTo = async (fileItem, destFolder, overwrite = false, opts = {}) => {
    const { silent = false } = opts || {};
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const destRef = ref(storage, dest.replace(/^\/+/, ''));
      // Overwrite check
      let exists = false;
      try { await getMetadata(destRef); exists = true; } catch (e) { exists = false; }
      if (exists && !overwrite) {
        if (!silent) {
          setIsError(false);
          setSuccessMessage('Move skipped: destination already has a file with this name.');
          setShowSuccessPopup(true);
        }
        return;
      }
      await uploadBytes(destRef, data);
      await deleteObject(fileItem.ref);
      if (!silent) {
        setSuccessMessage('File moved');
        setIsError(false);
        setShowSuccessPopup(true);
        await loadData();
      }
    } catch (e) {
      if (silent) {
        // Propagate to caller so bulk flow can count failures without per-item popups
        throw e;
      } else {
        setIsError(true);
        setSuccessMessage('Error moving file: ' + (e.message || e.toString()));
        setShowSuccessPopup(true);
      }
    }
  };

  const getParentFolderPath = (fileItem) => normalizeFolderPath(fileItem?.path || ROOT_PATH);

  // Folder copy/move (recursive)
  const copyFolder = async (srcFolderPath, destFolderPath, removeOriginal = false, overwriteAll = false, opts = {}) => {
    const { silent = false } = opts || {};
    const src = normalizeFolderPath(srcFolderPath);
    const dst = normalizeFolderPath(destFolderPath);
    if (dst.startsWith(src)) {
      alert('Destination cannot be inside the source folder.');
      return;
    }
    try {
      let overwriteApproved = overwriteAll ? true : null; // null = not asked (legacy), true = overwrite all, false = skip conflicts
      const walk = async (fromPath, toPath) => {
        const fromRef = ref(storage, fromPath.replace(/^\/+/, ''));
        const baseFrom = fromPath.replace(/^\/+/, '');
        const result = await listAll(fromRef);
        // Copy files
        for (const item of result.items) {
          const bytes = await import('firebase/storage').then(mod => mod.getBytes(item));
          const rel = item.fullPath.substring(baseFrom.length).replace(/^\/+/, '');
          const toFile = (toPath.replace(/^\/+/, '') + rel).replace(/^\/+/, '');
          const toRef = ref(storage, toFile);
          // Overwrite check per file
          let exists = false;
          try { await getMetadata(toRef); exists = true; } catch (e) { exists = false; }
          if (exists) {
            if (overwriteApproved === null) { overwriteApproved = false; }
            if (!overwriteApproved) {
              // Skip this file and do not delete original on move
              continue;
            }
          }
          await uploadBytes(toRef, bytes);
          if (removeOriginal) {
            await deleteObject(item);
          }
        }
        // Recurse folders
        for (const prefix of result.prefixes) {
          const relFolder = prefix.fullPath.substring(baseFrom.length);
          await walk(prefix.fullPath, (dst + relFolder).replace(/\/+/g, '/'));
          if (removeOriginal) {
            // Try to delete any .keep if exists
            try { await deleteObject(ref(storage, prefix.fullPath + '/.keep')); } catch (e) {}
          }
        }
      };
      await walk(src, dst);
      if (!silent) {
        setSuccessMessage(removeOriginal ? 'Folder moved successfully!' : 'Folder copied successfully!');
        setIsError(false);
        setShowSuccessPopup(true);
        await loadData();
      }
    } catch (e) {
      if (silent) {
        // Propagate to caller so bulk flow can count failures without per-item popups
        throw e;
      } else {
        setIsError(true);
        setSuccessMessage('Error processing folder: ' + (e.message || e.toString()));
        setShowSuccessPopup(true);
      }
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
    let basePath = newFolderBasePath || normalizeFolderPath(currentPath || ROOT_PATH);
    if (!basePath.endsWith('/')) basePath += '/';
    let scopedBase = basePath;
    if (!scopedBase.startsWith('/files/')) {
      scopedBase = `/files${basePath}`.replace(/\/+/g, '/');
    }
    const folderPath = (scopedBase === '/' ? '' : scopedBase) + newFolderName + '/.keep';
    try {
      const folderRef = ref(storage, folderPath);
      await uploadBytes(folderRef, new Uint8Array());
      setShowNewFolderInput(false);
      setNewFolderName('');
      setNewFolderBasePath(null);
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

  // Downloads
  const downloadSingleFile = async (fileItem) => {
    try {
      const bytes = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const { saveAs } = await import('file-saver');
      const blob = new Blob([bytes], { type: fileItem.type || 'application/octet-stream' });
      saveAs(blob, fileItem.name);
    } catch (e) {
      try { if (fileItem.downloadURL) window.open(fileItem.downloadURL, '_blank'); } catch {}
    }
  };

  const downloadFolderAsZip = async (folderPath) => {
    try {
      const { default: JSZip } = await import('jszip');
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();
    const base = normalizeFolderPath(folderPath);
    const baseNoSlash = base.replace(/^\/+/, '');
      const baseName = base.split('/').filter(Boolean).pop() || 'folder';
      const addFolder = async (path, zipFolder) => {
        const folderRef = ref(storage, path.replace(/^\/+/, ''));
        const res = await listAll(folderRef);
        for (const item of res.items) {
      const relName = item.fullPath.substring(baseNoSlash.length).replace(/^\/+/, '');
          try {
            const bytes = await import('firebase/storage').then(mod => mod.getBytes(item));
            zipFolder.file(relName || item.name, bytes);
          } catch (_) {}
        }
        for (const prefix of res.prefixes) {
      const relFolder = prefix.fullPath.substring(baseNoSlash.length).replace(/^\/+/, '');
          await addFolder(prefix.fullPath, zipFolder.folder(relFolder));
        }
      };
      await addFolder(base, zip.folder(baseName));
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${baseName}.zip`);
    } catch (e) {
      alert('Error preparing ZIP: ' + (e.message || String(e)));
    }
  };

  const downloadSelectionAsZip = async () => {
    const files = storageFiles.filter(f => selectedFiles.has(f.id));
    const folders = Array.from(selectedFolders);
    if (files.length === 0 && folders.length === 0) return;
    try {
      const { default: JSZip } = await import('jszip');
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();
      const commonRoot = '/files/';
      for (const f of files) {
        try {
          const bytes = await import('firebase/storage').then(mod => mod.getBytes(f.ref));
          const rel = (f.path + f.name).replace(commonRoot, '').replace(/^\/+/, '');
          zip.file(rel, bytes);
        } catch (_) {}
      }
      for (const p of folders) {
        const base = normalizeFolderPath(p);
    const baseNoSlash = base.replace(/^\/+/, '');
        const baseLabel = base.replace(commonRoot, '').replace(/^\/+|\/+$/g, '');
        const zipFolder = zip.folder(baseLabel || 'folder');
        const addFolder = async (path, zf) => {
          const folderRef = ref(storage, path.replace(/^\/+/, ''));
          const res = await listAll(folderRef);
          for (const item of res.items) {
      const rel = item.fullPath.substring(baseNoSlash.length).replace(/^\/+/, '');
            try {
              const bytes = await import('firebase/storage').then(mod => mod.getBytes(item));
              zf.file(rel || item.name, bytes);
            } catch (_) {}
          }
          for (const prefix of res.prefixes) {
      const relFolder = prefix.fullPath.substring(baseNoSlash.length).replace(/^\/+|\/+$/g, '');
            await addFolder(prefix.fullPath, zf.folder(relFolder));
          }
        };
        await addFolder(base, zipFolder);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const name = files.length + folders.length === 1
        ? (files[0]?.name || (folders[0] || '').split('/').filter(Boolean).pop()) + '.zip'
        : 'selection.zip';
      saveAs(blob, name);
    } catch (e) {
      alert('Error preparing download: ' + (e.message || String(e)));
    }
  };

  // helper to render only the file grid for a specific path
  const renderFilesForPath = (path) => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    let filteredFiles = storageFiles.filter(file => {
      if (file.name === '.keep' || file.name === '.folder-placeholder') return false;
      if (includeNestedFiles) return file.path.startsWith(path);
      return file.path === path;
    });
    if (fileFilter) {
      filteredFiles = filteredFiles.filter(file => file.name.toLowerCase().includes(fileFilter.toLowerCase()));
    }
    filteredFiles = filteredFiles.sort((a, b) => {
      let cmp = 0;
      if (fileSort === 'name') cmp = collator.compare(a.name || '', b.name || '');
  else if (fileSort === 'size') cmp = (a.size || 0) - (b.size || 0);
  else if (fileSort === 'type') cmp = collator.compare(a.type || '', b.type || '');
      return fileSortDir === 'asc' ? cmp : -cmp;
    });
    // Pagination
    const total = filteredFiles.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(filePage, totalPages);
    const start = (safePage - 1) * pageSize;
    const pageItems = filteredFiles.slice(start, start + pageSize);
    const selectedCount = selectedFiles.size + selectedFolders.size;
    return (
  <div key={path + '-file-grid'} className="file-grid-view" role="grid" aria-label={`Files in ${path}`}>
        {/* Selection controls */}
        {filteredFiles.length > 0 && (
          <div className="selection-controls" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', marginBottom: 6 }}>
            <button
              type="button"
              title="Select all files in this folder"
              onClick={() => setSelectedFiles(new Set(filteredFiles.map(f => f.id)))}
            >
              Select all
            </button>
            <button
              type="button"
              title="Select files on this page"
              onClick={() => setSelectedFiles(new Set(pageItems.map(f => f.id)))}
            >
              Select page
            </button>
            {selectedFiles.size > 0 && (
              <button type="button" onClick={clearSelection} title="Clear selection">Clear</button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>{selectedFiles.size} selected</span>
          </div>
        )}
        {selectedCount > 0 && (
          <div className="bulk-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', background: '#f5f7fb', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 }}>
            <strong>{selectedCount}</strong> selected
            <button onClick={() => openBulkModal('copy')}>Copy</button>
            <button onClick={() => openBulkModal('move')}>Move</button>
            {userRole === 'admin' && <button onClick={handleBulkDelete} style={{ color: '#b42318' }}>Delete</button>}
            <button onClick={downloadSelectionAsZip}>Download</button>
            <button onClick={clearSelection} style={{ marginLeft: 'auto' }}>Clear</button>
          </div>
        )}
        {filteredFiles.length === 0 ? (
          <div className="empty-state">No files found.</div>
        ) : (
          pageItems.map(file => (
            <div
              key={file.id}
              className={`file-grid-item ${selection.type === 'file' && selection.target?.id === file.id ? 'selected' : ''}`}
              onClick={async () => {
                setSelection({ type: 'file', target: file });
                if (!onFileSelect) return;
                // Enrich file lazily for preview (url, type, size, fullPath)
                try {
                  let meta = null, url = null;
                  try { meta = await getMetadata(file.ref); } catch (_) {}
                  try { url = await getDownloadURL(file.ref); } catch (_) {}
                  const enriched = {
                    ...file,
                    downloadURL: url || file.downloadURL,
                    type: meta?.contentType || file.type,
                    size: typeof meta?.size === 'number' ? meta.size : file.size,
                    uploadedAt: meta?.updated ? new Date(meta.updated) : file.uploadedAt,
                    fullPath: file?.ref?.fullPath || file.fullPath
                  };
                  onFileSelect(enriched);
                } catch {
                  onFileSelect(file);
                }
              }}
              onContextMenu={e => handleContextMenu(e, file, 'file')}
              title={file.name}
              role="row"
            >
              <input
                type="checkbox"
                checked={selectedFiles.has(file.id)}
                onClick={(e) => { e.stopPropagation(); }}
                onChange={(e) => { e.stopPropagation(); toggleSelectFile(file); }}
                title="Select file"
                style={{ marginRight: 8 }}
              />
              <div className="item-content" role="gridcell">
                {getFileIcon(file.name, file.type)}
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-size">{formatFileSize(file.size)}</span>
                {/* Storage badge hidden per request */}
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
        {filteredFiles.length > 0 && (
          <div className="pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
            <span style={{ color: '#666', fontSize: 12 }}>
              Showing {Math.min(total, start + 1)}–{Math.min(total, start + pageSize)} of {total}
            </span>
            <button disabled={safePage <= 1} onClick={() => setFilePage(p => Math.max(1, p - 1))}>Prev</button>
            <span style={{ fontSize: 12 }}>Page {safePage} / {totalPages}</span>
            <button disabled={safePage >= totalPages} onClick={() => setFilePage(p => Math.min(totalPages, p + 1))}>Next</button>
            <span style={{ marginLeft: 'auto', fontSize: 12 }}>Per page:</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setFilePage(1); }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        )}
      </div>
    );
  };


  // Render only direct subfolders for a given path (no recursive tree)
  const renderSubfoldersOnly = (path) => {
    const safe = normalizeFolderPath(path || ROOT_PATH);
    const actualFolders = new Set([...storageFolders]);
    const subfolders = Array.from(actualFolders)
      .filter(folder => {
        const relativePath = folder.substring(safe.length);
        const isDirectChild = folder.startsWith(safe) && folder !== safe && relativePath.split('/').filter(p => p).length === 1;
        if (!isDirectChild) return false;
        if (!folderFilter) return true;
        const name = folder.substring(safe.length).replace('/', '').toLowerCase();
        return name.includes(folderFilter.toLowerCase());
      })
      .sort((a, b) => {
        const nameA = a.substring(safe.length).replace('/', '').toLowerCase();
        const nameB = b.substring(safe.length).replace('/', '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

    if (subfolders.length === 0) return <div className="empty-state">No subfolders.</div>;

    if (folderView === 'cards') {
      return (
        <div className="folder-card-grid">
          {subfolders.map(folderPath => {
            const folderName = folderPath.substring(safe.length).replace('/', '');
            const filesInFolder = storageFiles.filter(f => f.path === folderPath && f.name !== '.keep' && f.name !== '.folder-placeholder').length;
            return (
              <div
                key={folderPath + '-card-only'}
                className={`folder-card ${currentPath === folderPath ? 'active' : ''}`}
                title={`Folder: ${folderName} (${filesInFolder} files)`}
                onClick={(e) => { if (longPressRef.current.fired) { e.preventDefault(); return; } setExpandedFolders(prev => new Set(prev).add(folderPath)); onPathChange(folderPath); }}
                onContextMenu={e => handleContextMenu(e, folderPath, 'folder')}
                onTouchStart={(e) => startLongPress(e, folderPath, 'folder')}
                onTouchMove={moveLongPress}
                onTouchEnd={endLongPress}
                onTouchCancel={endLongPress}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedFolders(prev => new Set(prev).add(folderPath)); onPathChange(folderPath); } }}
                aria-label={`Open folder ${folderName}`}
              >
                <div className="folder-card-main">
                  <MacFolderIcon className="folder-card-icon" />
                  <div className="folder-card-text">
                    <div className="folder-card-name" title={(folderLabels[folderPath]?.tags || []).join(', ')}>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: folderLabels[folderPath]?.color || 'transparent', display: 'inline-block', marginRight: 6, border: '1px solid #e5e7eb' }} />
                      {folderName}
                      <button className="icon-btn favorite" style={{ marginLeft: 8 }} aria-label={favoriteFolders.has(folderPath) ? 'Unfavorite folder' : 'Favorite folder'} aria-pressed={favoriteFolders.has(folderPath)} title={favoriteFolders.has(folderPath) ? 'Unfavorite' : 'Favorite'} onClick={(e) => { e.stopPropagation(); toggleFavorite(folderPath); }}>
                        {favoriteFolders.has(folderPath) ? <FaStar color="#f59e0b" /> : <FaRegStar />}
                      </button>
                    </div>
                    <div className="folder-card-meta" style={{ visibility: 'hidden' }}>.</div>
                  </div>
                </div>
                {userRole !== 'viewer' && (
                  <div className="folder-card-actions" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedFolders.has(folderPath)}
                      onChange={(e) => { e.stopPropagation(); toggleSelectFolder(folderPath); }}
                      title="Select folder"
                    />
                    <button className="icon-btn rename" title="Rename" onClick={async () => {
                      const newName = prompt('Enter new folder name:', folderName);
                      if (!newName || !newName.trim() || newName.trim() === folderName) return;
                      const newPath = folderPath.replace(/[^/]+\/$/, newName.trim() + '/');
                      await copyFolder(folderPath, newPath, true, true);
                    }}>
                      <FaEdit />
                    </button>
                    <button className="icon-btn copy" title="Copy" onClick={() => { setMoveCopyModal({ open: true, mode: 'copy', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
                      <FaCopy />
                    </button>
                    <button className="icon-btn move" title="Move" onClick={() => { setMoveCopyModal({ open: true, mode: 'move', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
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
            );
          })}
        </div>
      );
    }

    // list view
    return (
      <div className="subfolder-list" style={{ display: 'grid', gap: 8, padding: '8px 4px' }}>
        {subfolders.map(folderPath => {
          const folderName = folderPath.substring(safe.length).replace('/', '');
          return (
            <div
              key={folderPath + '-row-only'}
              className={`file-grid-item ${currentPath === folderPath ? 'selected' : ''}`}
              title={`Open folder ${folderName}`}
              onClick={(e) => { if (longPressRef.current.fired) { e.preventDefault(); return; } setExpandedFolders(prev => new Set(prev).add(folderPath)); onPathChange(folderPath); }}
              onContextMenu={(e) => handleContextMenu(e, folderPath, 'folder')}
            >
              <div className="item-content">
                <MacFolderIcon className="folder-icon" />
                <span className="folder-name">{folderName}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
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
          {!filesOnly && (
            <>
              {/* Quick jump to folder */}
              <input
                type="text"
                list="folders-list"
                placeholder="Quick jump (e.g., /files/Projects/)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = e.currentTarget.value;
                    if (!val) return;
                    const dest = normalizeFolderPath(val);
                    setExpandedFolders(prev => new Set([...prev, dest]));
                    onPathChange(dest);
                    e.currentTarget.value = '';
                  }
                }}
                style={{ marginRight: '8px', width: 280 }}
              />
              <datalist id="folders-list">
                {[...storageFolders].sort().map(fp => (
                  <option key={fp} value={fp} />
                ))}
              </datalist>
              <button
                title="Expand all"
                onClick={() => setExpandedFolders(new Set([ROOT_PATH, ...storageFolders]))}
                style={{ marginRight: 8 }}
              >
                Expand All
              </button>
              <button
                title="Collapse all"
                onClick={() => setExpandedFolders(new Set([ROOT_PATH]))}
                style={{ marginRight: 8 }}
              >
                Collapse All
              </button>
              <button
                title={`Folder view: ${folderView === 'cards' ? 'Cards' : 'List'}`}
                onClick={() => setFolderView(v => (v === 'cards' ? 'list' : 'cards'))}
                style={{ marginRight: 8 }}
              >
                Folders: {folderView === 'cards' ? 'Cards' : 'List'}
              </button>
            </>
          )}
          {showNewFolderInput && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
              <input
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder={`New folder name`}
                autoFocus
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }}
              />
              <button onClick={handleCreateFolder}>Create</button>
              <button onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); setNewFolderBasePath(null); }}>Cancel</button>
            </span>
          )}
          <input
            type="text"
            className="file-filter-input"
            placeholder="Filter files by name..."
            value={fileFilter}
            onChange={e => setFileFilter(e.target.value)}
            style={{ marginRight: '8px' }}
          />
          {fileFilter && (
            <button
              type="button"
              title="Clear filter"
              onClick={() => setFileFilter('')}
              style={{ marginRight: 8 }}
            >
              ✕
            </button>
          )}
          {!filesOnly && (
            <input
              type="text"
              className="file-filter-input"
              placeholder="Filter folders..."
              value={folderFilter}
              onChange={e => setFolderFilter(e.target.value)}
              style={{ marginRight: '8px' }}
            />
          )}
          <select className="file-sort-select" value={fileSort} onChange={e => setFileSort(e.target.value)}>
            <option value="name">Sort by Name</option>
            <option value="size">Sort by Size</option>
            <option value="type">Sort by Type</option>
          </select>
          <button
            type="button"
            className="file-sort-dir-toggle"
            title={fileSortDir === 'asc' ? 'Sort Z→A' : 'Sort A→Z'}
            onClick={() => setFileSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
            style={{ marginLeft: 8 }}
          >
            {fileSort === 'name' ? (fileSortDir === 'asc' ? 'A→Z' : 'Z→A') : (fileSortDir === 'asc' ? '↑' : '↓')}
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12, fontSize: 13 }} title="Include files from nested subfolders in this view">
            <input type="checkbox" checked={includeNestedFiles} onChange={(e) => setIncludeNestedFiles(e.target.checked)} />
            Include nested files
          </label>
        </div>
      </div>
      {/* Lightweight stats for the current folder to aid clarity */}
      {(() => {
        const safe = normalizeFolderPath(currentPath || ROOT_PATH);
        const directSubfolders = Array.from(storageFolders).filter(fp => fp.startsWith(safe) && fp !== safe && fp.substring(safe.length).split('/').filter(Boolean).length === 1).length;
        const directFiles = storageFiles.filter(f => f.path === safe && f.name !== '.keep' && f.name !== '.folder-placeholder').length;
        const nestedFiles = includeNestedFiles ? storageFiles.filter(f => f.path.startsWith(safe) && f.name !== '.keep' && f.name !== '.folder-placeholder').length : null;
        return (
          <div className="folder-stats" style={{ margin: '8px 4px', fontSize: 12, color: '#556', display: 'flex', gap: 12 }}>
            <span title="Current folder path">Path: {safe}</span>
            <span title="Direct subfolders count">Subfolders: {directSubfolders}</span>
            <span title="Direct files count">Files: {directFiles}{nestedFiles !== null ? ` (including nested: ${nestedFiles})` : ''}</span>
          </div>
        );
      })()}
      {/* Context Menu UI */}
      {contextMenu.visible && (
        <div ref={menuRef} className="context-menu" role="menu" aria-label={contextMenu.type === 'file' ? 'File actions' : contextMenu.type === 'folder' ? 'Folder actions' : 'Actions'} style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999, background: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: '200px', padding: '4px 0' }} onMouseLeave={hideContextMenu}>
          {contextMenu.type === 'folder' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>Folder Actions</div>
              <div className="context-menu-item" role="menuitem" tabIndex={0} style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-folder')} onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); handleMenuAction('create-folder'); }}}>📁 New Subfolder</div>
              <div className="context-menu-item" role="menuitem" tabIndex={0} style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-file')} onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); handleMenuAction('create-file'); }}}>📄 New File</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('rename')}>✏️ Rename</div>
              {userRole === 'admin' && (
                <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer', color: '#d9534f' }} onClick={() => handleMenuAction('delete')}>🗑️ Delete</div>
              )}
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('copy')}>📋 Copy</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('move')}>📦 Move</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('download')}>⬇️ Download (.zip)</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('favorite')}>{favoriteFolders.has(contextMenu.target) ? '⭐ Unfavorite' : '☆ Favorite'}</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('labels')}>🏷️ Edit labels</div>
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
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('download')}>⬇️ Download</div>
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
  {/* New Folder Input (inline, convenient placement) */}
      {/* Rename Folder Input UI */}
      {renamingFolder && (
        <div className="rename-folder-popup" role="dialog" aria-modal="true" aria-labelledby="rename-folder-title" style={{ position: 'fixed', top: contextMenu.y + 20, left: contextMenu.x, zIndex: 10000, background: '#fff', border: '1px solid #ccc', borderRadius: '4px', padding: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          <div id="rename-folder-title" style={{ fontWeight: 600, marginBottom: 8 }}>Rename folder</div>
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
        <div className="success-popup" role="status" aria-live="polite" style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 10001, background: isError ? '#ffeaea' : '#eaffea', border: '1px solid #ccc', borderRadius: '4px', padding: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          {successMessage}
          <button style={{ marginLeft: '12px' }} onClick={() => setShowSuccessPopup(false)}>Close</button>
        </div>
      )}
      {/* Label Editor Modal */}
      {labelEditor.open && (
        <div className="label-editor-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10003 }}>
          <div style={{ background: '#fff', width: 420, borderRadius: 8, boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 600 }}>Edit labels</div>
              <button onClick={() => setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' })} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              <label style={{ fontSize: 13, color: '#555' }}>Tags (comma separated)</label>
              <input type="text" value={labelEditor.tagsText} onChange={e => setLabelEditor(prev => ({ ...prev, tagsText: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
              <label style={{ fontSize: 13, color: '#555' }}>Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={labelEditor.color} onChange={e => setLabelEditor(prev => ({ ...prev, color: e.target.value }))} />
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: labelEditor.color, border: '1px solid #ddd' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button onClick={() => setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' })}>Cancel</button>
                <button onClick={removeLabels} style={{ color: '#b42318' }}>Clear</button>
                <button onClick={saveLabels} style={{ background: '#0b5ed7', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 6 }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
  <div className="tree-content" role="group" aria-label="Folder contents" onContextMenu={(e) => { if (!e.defaultPrevented) handleContextMenu(e, currentPath, 'background'); }}>
        {(() => {
          const safe = normalizeFolderPath(currentPath || ROOT_PATH);
          if (filesOnly) return renderFilesForPath(safe);
          // Show subfolders first, then files for the selected folder
          return (
            <>
              {renderSubfoldersOnly(safe)}
              {renderFilesForPath(safe)}
            </>
          );
        })()}
      </div>
      {moveCopyModal.open && (
        <div className="move-copy-modal" role="dialog" aria-modal="true" aria-labelledby="move-copy-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }} onKeyDown={(e) => {
          if (e.key === 'Escape') setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH });
          if (e.key === 'Enter') (document.getElementById('confirm-move-copy') || {}).click?.();
        }}>
          <div style={{ background: '#fff', width: '840px', maxWidth: '95vw', maxHeight: '90vh', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div id="move-copy-title" style={{ fontWeight: 600 }}>
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
                      let pp = String(p || '').trim().replace(/\\/g, '/');
                      if (!pp.startsWith('/')) pp = '/' + pp;
                      // If it already starts with '/files' (with or without trailing slash), don't prefix again
                      if (!pp.startsWith('/files')) {
                        pp = '/files' + (pp === '/' ? '/' : pp);
                      }
                      // Ensure exactly '/files/' prefix
                      if (pp === '/files') pp = '/files/';
                      if (!pp.startsWith('/files/')) pp = pp.replace(/^\/files(?!\/)/, '/files/');
                      if (!pp.endsWith('/')) pp += '/';
                      return pp.replace(/\/+/g, '/');
                    })();
                    setMoveCopyModal(prev => ({ ...prev, dest: normalized }));
                  }}
                />
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>Destination</div>
                <input type="text" value={moveCopyModal.dest} onChange={e => setMoveCopyModal(prev => ({ ...prev, dest: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
                <div style={{ marginTop: 12, padding: '8px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6, fontSize: 13, color: '#555' }}>
                  <div>
                    <strong>Item:</strong>{' '}
                    {(() => {
                      if (moveCopyModal.itemType === 'file') {
                        return moveCopyModal.target?.name || '(file)';
                      }
                      if (moveCopyModal.itemType === 'folder') {
                        const fp = String(moveCopyModal.target || '');
                        return fp.split('/').filter(Boolean).pop() || '(folder)';
                      }
                      if (moveCopyModal.itemType === 'bulk') {
                        const files = moveCopyModal.target?.files?.length || 0;
                        const folders = moveCopyModal.target?.folders?.length || 0;
                        return `${files} file(s) + ${folders} folder(s)`;
                      }
                      return '(none)';
                    })()}
                  </div>
                  <div><strong>Action:</strong> {moveCopyModal.mode === 'copy' ? 'Copy' : 'Move'}</div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: '#444' }}>
                  <input
                    type="checkbox"
                    checked={!!moveCopyModal.overwrite}
                    onChange={(e) => setMoveCopyModal(prev => ({ ...prev, overwrite: e.target.checked }))}
                  />
                  Overwrite existing files
                </label>
                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH, overwrite: false })} style={{ padding: '8px 12px' }} disabled={moveCopyBusy}>Cancel</button>
                  <button
                    id="confirm-move-copy"
                    onClick={async () => {
                      const dest = moveCopyModal.dest;
                      if (!dest) return;
                      // Guard against no-op moves (same folder)
                      if (moveCopyModal.itemType === 'file') {
                        const cur = getParentFolderPath(moveCopyModal.target);
                        if (normalizeFolderPath(dest) === normalizeFolderPath(cur) && moveCopyModal.mode === 'move') { setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH }); return; }
                      } else if (moveCopyModal.itemType === 'folder') {
                        const cur = normalizeFolderPath(moveCopyModal.target);
                        if (normalizeFolderPath(dest) === normalizeFolderPath(cur) && moveCopyModal.mode === 'move') { setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH }); return; }
                      }
                      try {
                        setMoveCopyBusy(true);
                        if (moveCopyModal.itemType === 'file') {
                          if (moveCopyModal.mode === 'copy') await handleCopyFileTo(moveCopyModal.target, dest, !!moveCopyModal.overwrite, { silent: true });
                          else await handleMoveFileTo(moveCopyModal.target, dest, !!moveCopyModal.overwrite, { silent: true });
                          await loadData();
                          setIsError(false);
                          setSuccessMessage(moveCopyModal.mode === 'copy' ? 'File copied' : 'File moved');
                          setShowSuccessPopup(true);
                        } else if (moveCopyModal.itemType === 'folder') {
                          await copyFolder(moveCopyModal.target, dest, moveCopyModal.mode === 'move', !!moveCopyModal.overwrite, { silent: true });
                          await loadData();
                          setIsError(false);
                          setSuccessMessage(moveCopyModal.mode === 'move' ? 'Folder moved successfully!' : 'Folder copied successfully!');
                          setShowSuccessPopup(true);
                        } else if (moveCopyModal.itemType === 'bulk') {
                          const tasks = [];
                          const files = Array.isArray(moveCopyModal.target?.files) ? moveCopyModal.target.files : [];
                          const folders = Array.isArray(moveCopyModal.target?.folders) ? moveCopyModal.target.folders : [];
                          for (const f of files) {
                            tasks.push(moveCopyModal.mode === 'copy'
                              ? handleCopyFileTo(f, dest, !!moveCopyModal.overwrite, { silent: true })
                              : handleMoveFileTo(f, dest, !!moveCopyModal.overwrite, { silent: true })
                            );
                          }
                          for (const p of folders) {
                            tasks.push(copyFolder(p, dest, moveCopyModal.mode === 'move', !!moveCopyModal.overwrite, { silent: true }));
                          }
                          // Run sequentially to limit bandwidth; collect errors
                          let failures = 0;
                          for (const t of tasks) { try { await t; } catch (e) { failures++; } }
                          clearSelection();
                          await loadData();
                          setIsError(failures > 0);
                          setSuccessMessage(failures > 0
                            ? `Completed with ${failures} error(s).`
                            : `Completed: ${files.length} file(s) and ${folders.length} folder(s).`);
                          setShowSuccessPopup(true);
                        }
                        setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH, overwrite: false });
                      } catch (e) {
                        // Error is surfaced via inner functions
                      } finally {
                        setMoveCopyBusy(false);
                      }
                    }}
                    disabled={moveCopyBusy}
                    style={{ padding: '8px 12px', background: moveCopyBusy ? '#6ea8fe' : '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    {moveCopyBusy ? 'Working…' : (moveCopyModal.mode === 'copy' ? 'Copy here' : 'Move here')}
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
