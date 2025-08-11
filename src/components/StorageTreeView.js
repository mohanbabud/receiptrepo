import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ref, listAll, uploadBytes, deleteObject, getBytes, uploadString } from 'firebase/storage';
import { storage } from '../firebase';
import { FaExpand, FaCompress } from 'react-icons/fa';
import { MacFolderIcon, MacFileIcon } from './icons/MacIcons';
import './StorageTreeView.css';

// Performance: keep the tree light
const SHOW_FILES_IN_TREE = false; // Files are visible in the main Files panel; skip them here for speed

const ROOT_PATH = 'files';

const StorageTreeView = ({ onFolderSelect, currentPath, refreshTrigger, userRole }) => {
  const [treeData, setTreeData] = useState({});
  const [expandedNodes, setExpandedNodes] = useState(new Set([ROOT_PATH])); // Root is expanded by default
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [menu, setMenu] = useState({ visible: false, x: 0, y: 0, path: null });
  const menuRef = useRef(null);

  // Build the storage tree recursively up to maxDepth; deeper levels are loaded on expand
  const buildStorageTreeRecursive = useCallback(async (path, depth = 0, maxDepth = 3) => {
    try {
      const storageRef = ref(storage, path);
      const result = await listAll(storageRef);
      const tree = { folders: {}, files: [] };

      // Process folders
      for (const folderRef of result.prefixes) {
        const folderName = folderRef.name;
        const folderPath = path ? `${path}/${folderName}` : folderName;
        let children = null;
        if (depth < maxDepth) {
          children = await buildStorageTreeRecursive(folderRef.fullPath, depth + 1, maxDepth);
        }
        const folderNode = {
          path: folderPath,
          name: folderName,
          children, // may be null if beyond maxDepth
          fileCount: children ? children.files.length : 0,
          folderCount: children ? Object.keys(children.folders).length : 0
        };
        tree.folders[folderName] = folderNode;
      }

      // Process files (names only for the tree)
      tree.files = result.items.map(item => ({
        name: item.name,
        path: item.fullPath,
        size: null
      }));

      return tree;
    } catch (error) {
      console.error('Error in buildStorageTreeRecursive:', error);
      return { folders: {}, files: [] };
    }
  }, []);

  const loadStorageStructure = useCallback(async () => {
    try {
      setLoading(true);
      // Shallow load only the top-level folders for fast initial render
      const structure = await buildStorageTreeRecursive(ROOT_PATH, 0, 0);
      // Keep both top-level folders/files and a children object for root
      // Optionally drop files to keep the tree light
      const children = SHOW_FILES_IN_TREE ? structure : { ...structure, files: [] };
      setTreeData({ ...structure, files: [], children });
      if (structure.folders && Object.keys(structure.folders).length > 0) {
        setExpandedNodes(new Set([ROOT_PATH]));
      }
    } catch (error) {
      console.error('Error loading folders:', error);
    } finally {
      setLoading(false);
    }
  }, [buildStorageTreeRecursive]);

  useEffect(() => {
    loadStorageStructure();
  }, [refreshTrigger, loadStorageStructure]);
  // Context menu helpers
  const showMenu = (e, path) => {
    e.preventDefault();
    setMenu({ visible: true, x: e.clientX, y: e.clientY, path });
  };
  const hideMenu = () => setMenu({ visible: false, x: 0, y: 0, path: null });

  useEffect(() => {
    const onDown = (ev) => {
      if (!menu.visible) return;
      if (menuRef.current && !menuRef.current.contains(ev.target)) hideMenu();
    };
    const onKey = (ev) => { if (ev.key === 'Escape') hideMenu(); };
    const onDismiss = () => { if (menu.visible) hideMenu(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss, true);
    };
  }, [menu.visible]);

  const ensurePath = (p) => {
    // Normalize to 'files/...'
    let x = String(p || ROOT_PATH).replace(/^\/+/, '');
    if (!x.startsWith('files')) x = x.replace(/^/, ROOT_PATH + '/');
    return x.replace(/\/+$/, '');
  };

  const createSubfolder = async (basePath) => {
    const name = prompt('Enter subfolder name:');
    if (!name || !name.trim()) return;
    const full = `${ensurePath(basePath)}/${name.trim().replace(/^\/+|\/+$/g, '')}/.keep`;
    // Use a tiny non-empty payload so folder reliably shows in listings
    await uploadString(ref(storage, full), 'keep', 'raw', { contentType: 'text/plain' });
    hideMenu();
    await loadStorageStructure();
  };

  const deleteFolder = async (path) => {
    if (userRole !== 'admin') { alert('Only admin can delete.'); return; }
    const folderRef = ref(storage, ensurePath(path));
    const res = await listAll(folderRef);
    for (const item of res.items) { try { await deleteObject(item); } catch {} }
    for (const sub of res.prefixes) { await deleteFolder(sub.fullPath); }
  };

  const renameFolder = async (oldPath) => {
    const parts = ensurePath(oldPath).split('/');
    const oldName = parts.pop();
    const base = parts.join('/');
    const newName = prompt('Enter new folder name:', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const newPath = `${base}/${newName.trim()}`;
    await copyFolderRecursive(ensurePath(oldPath), newPath, true);
  };

  const copyFolderRecursive = async (src, dst, removeOriginal = false) => {
    const fromRef = ref(storage, src);
    const res = await listAll(fromRef);
    // files
    for (const item of res.items) {
      const bytes = await getBytes(item);
      const rel = item.fullPath.substring(src.length).replace(/^\/+/, '');
      const toRef = ref(storage, `${dst}/${rel}`.replace(/\/+/, '/'));
      await uploadBytes(toRef, bytes);
      if (removeOriginal) { try { await deleteObject(item); } catch {} }
    }
    // folders
    for (const prefix of res.prefixes) {
      const rel = prefix.fullPath.substring(src.length).replace(/^\/+/, '');
      await copyFolderRecursive(prefix.fullPath, `${dst}/${rel}`.replace(/\/+/, '/'), removeOriginal);
      if (removeOriginal) {
        try { await deleteObject(ref(storage, `${prefix.fullPath}/.keep`)); } catch {}
      }
    }
  };

  const handleMenuAction = async (action) => {
    const p = menu.path;
    try {
      if (action === 'new-folder') await createSubfolder(p);
      if (action === 'rename') await renameFolder(p);
      if (action === 'delete') await deleteFolder(p);
    } finally {
      hideMenu();
    }
  };

  
  

  const loadFolderChildren = async (folderPath) => {
    try {
      // Load one level deep on demand for speed
      const childrenRaw = await buildStorageTreeRecursive(folderPath, 0, 0);
      const children = SHOW_FILES_IN_TREE ? childrenRaw : { ...childrenRaw, files: [] };
      setTreeData(prev => {
        const updated = { ...prev };
        
        if (folderPath === ROOT_PATH) {
          // Root level update
          updated.children = children;
          return updated;
        }
        
        const pathParts = folderPath.split('/').filter(part => part);
        let current = updated;
        
        // Navigate to the parent folder
        for (let i = 0; i < pathParts.length - 1; i++) {
          if (current.children) {
            current = current.children.folders[pathParts[i]];
          } else {
            current = current.folders[pathParts[i]];
          }
        }
        
        // Update the target folder
        const folderName = pathParts[pathParts.length - 1];
        const targetFolder = current.children ? current.children.folders[folderName] : current.folders[folderName];
        
        if (targetFolder) {
          targetFolder.children = children;
          targetFolder.fileCount = SHOW_FILES_IN_TREE ? children.files.length : 0;
          targetFolder.folderCount = Object.keys(children.folders).length;
        }
        
        return updated;
      });
    } catch (error) {
      console.error('Error loading folder children:', error);
    }
  };

  const toggleNode = async (nodePath) => {
    const newExpanded = new Set(expandedNodes);
    
    if (expandedNodes.has(nodePath)) {
      newExpanded.delete(nodePath);
    } else {
      newExpanded.add(nodePath);
      
      // Load children if not already loaded
      let current = treeData;
      
      if (nodePath === ROOT_PATH) {
        // Root node
        if (!current.children) {
          await loadFolderChildren(ROOT_PATH);
        }
      } else {
        const pathParts = nodePath.split('/').filter(part => part);
        
        // Navigate to the target folder
        for (const part of pathParts) {
          if (current.children) {
            current = current.children.folders[part];
          } else {
            current = current.folders[part];
          }
          if (!current) break;
        }
        
        if (current && !current.children) {
          await loadFolderChildren(nodePath);
        }
      }
    }
    
    setExpandedNodes(newExpanded);
  };

  const handleFolderClick = async (folderPath) => {
    if (onFolderSelect) {
      onFolderSelect(folderPath);
    }
    // Also expand to show subfolders when clicking a folder
    if (!expandedNodes.has(folderPath)) {
      await toggleNode(folderPath);
    }
  };

  const renderTreeNode = (node, path = ROOT_PATH, level = 0) => {
  if (!node) return null;

    const isExpanded = expandedNodes.has(path);
    const isSelected = currentPath === path;
    
    // Check for children - either loaded children or unloaded folders
    const hasChildren = (node.children && Object.keys(node.children.folders).length > 0) || 
                       (node.folders && Object.keys(node.folders).length > 0);

    

    return (
      <div key={path} className="tree-node" style={{ marginLeft: `${level * 20}px` }} role="treeitem" aria-expanded={isExpanded} aria-selected={isSelected} aria-label={`Folder ${path === ROOT_PATH ? 'PNLM' : (node.name || path.split('/').pop())}`} tabIndex={0} onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFolderClick(path); }
        if (e.key === 'ArrowRight') { e.preventDefault(); if (!isExpanded) toggleNode(path); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); if (isExpanded) toggleNode(path); }
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); showMenu({ preventDefault: () => {}, clientX: 0, clientY: 0 }, path); }
      }}>
        <div 
          className={`tree-node-header ${isSelected ? 'selected' : ''}`}
          onClick={() => handleFolderClick(path)}
          onContextMenu={(e) => showMenu(e, path)}
        >
          <span 
            className="tree-node-toggle"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren || path === ROOT_PATH) toggleNode(path);
            }}
          >
            {hasChildren || path === ROOT_PATH ? (
              isExpanded ? <MacFolderIcon open /> : <MacFolderIcon />
            ) : (
              <MacFolderIcon className="empty-folder" />
            )}
          </span>
          <span className="tree-node-label">
            {path === ROOT_PATH ? 'PNLM' : node.name || path.split('/').pop()}
          </span>
          {/* counts hidden per request */}
        </div>

    {isExpanded && node.children && (
          <div className="tree-node-children">
            {Object.entries(node.children.folders).map(([folderName, folderData]) =>
              renderTreeNode(folderData, folderData.path, level + 1)
            )}
      {SHOW_FILES_IN_TREE && node.children.files.length > 0 && (
              <div className="tree-files" style={{ marginLeft: `${(level + 1) * 20 + 20}px` }}>
                {node.children.files.filter(file => file.name !== '.folder-placeholder' && file.name !== '.keep').map(file => (
                  <div key={file.path} className="tree-file">
                    <MacFileIcon className="file-icon" />
                    <span className="file-name">{file.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

    {isExpanded && node.folders && !node.children && (
          <div className="tree-node-children">
            {Object.entries(node.folders).map(([folderName, folderData]) =>
              renderTreeNode(folderData, folderData.path, level + 1)
            )}
      {SHOW_FILES_IN_TREE && node.files && node.files.length > 0 && (
              <div className="tree-files" style={{ marginLeft: `${(level + 1) * 20 + 20}px` }}>
                {node.files.filter(file => file.name !== '.folder-placeholder' && file.name !== '.keep').map(file => (
                  <div key={file.path} className="tree-file">
                    <MacFileIcon className="file-icon" />
                    <span className="file-name">{file.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (loading) {
    return (
      <div className="storage-tree-view loading">
  <div className="loading-spinner">Loading folders...</div>
      </div>
    );
  }

  return (
  <div className={`storage-tree-view ${isFullscreen ? 'fullscreen' : ''}`} role="tree" aria-label="Storage folders">
      <div className="tree-header">
  <h3>Folders</h3>
        <div className="tree-controls">
          <button 
            className="refresh-btn"
            onClick={loadStorageStructure}
            title="Refresh structure"
          >
            🔄
          </button>
          <button 
            className="fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen view"}
          >
            {isFullscreen ? <FaCompress /> : <FaExpand />}
          </button>
        </div>
      </div>
      
      <div className="tree-container">
        {treeData && Object.keys(treeData.folders || {}).length === 0 && (treeData.files || []).length === 0 ? (
          <div className="empty-storage">
            <div className="empty-icon">📁</div>
            <p>No files or folders found in Firebase Storage</p>
            <p>Upload some files to see the tree structure</p>
          </div>
        ) : (
          (treeData && renderTreeNode({ 
            folders: treeData.folders || {}, 
            files: treeData.files || [],
            children: treeData.children,
            name: 'PNLM'
          }, ROOT_PATH, 0))
        )}
      </div>

      {menu.visible && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 9999, background: '#fff', border: '1px solid #ccc', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
          onMouseLeave={hideMenu}
          role="menu"
          aria-label="Folder actions"
        >
          <div className="context-menu-title" style={{ padding: '8px 12px', borderBottom: '1px solid #eee' }}>Folder</div>
          <div className="context-menu-item" role="menuitem" tabIndex={0} style={{ padding: '8px 12px', cursor: 'pointer' }} onClick={() => handleMenuAction('new-folder')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleMenuAction('new-folder'); } }}>📁 New subfolder</div>
          <div className="context-menu-item" role="menuitem" tabIndex={0} style={{ padding: '8px 12px', cursor: 'pointer' }} onClick={() => handleMenuAction('rename')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleMenuAction('rename'); } }}>✏️ Rename</div>
          {userRole === 'admin' && (
            <div className="context-menu-item" role="menuitem" tabIndex={0} style={{ padding: '8px 12px', cursor: 'pointer', color: '#b42318' }} onClick={() => handleMenuAction('delete')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleMenuAction('delete'); } }}>🗑️ Delete</div>
          )}
        </div>
      )}

      <div className="tree-legend">
        <div className="legend-item">
          <MacFolderIcon /> Folder
        </div>
        <div className="legend-item">
          <MacFileIcon /> File
        </div>
        <div className="legend-item">
          📁 Folder count
        </div>
        <div className="legend-item">
          📄 File count
        </div>
      </div>
    </div>
  );
};

export default StorageTreeView;
