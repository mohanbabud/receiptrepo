import React, { useState, useEffect } from 'react';
import { ref, listAll } from 'firebase/storage';
import { storage } from '../firebase';
import { FaFolder, FaFolderOpen, FaFile, FaExpand, FaCompress } from 'react-icons/fa';
import './StorageTreeView.css';

const ROOT_PATH = 'files';

const StorageTreeView = ({ onFolderSelect, currentPath, refreshTrigger }) => {
  const [treeData, setTreeData] = useState({});
  const [expandedNodes, setExpandedNodes] = useState(new Set([ROOT_PATH])); // Root is expanded by default
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    loadStorageStructure();
  }, [refreshTrigger]); // Re-load when refreshTrigger changes

  const loadStorageStructure = async () => {
    try {
      setLoading(true);
      const structure = await buildStorageTree(ROOT_PATH);
      setTreeData(structure);
      // Auto expand root if it has folders
      if (structure.folders && Object.keys(structure.folders).length > 0) {
        setExpandedNodes(new Set([ROOT_PATH]));
      }
    } catch (error) {
      console.error('Error loading storage structure:', error);
    } finally {
      setLoading(false);
    }
  };

  const buildStorageTree = async (path) => {
    try {
      const storageRef = ref(storage, path);
      const result = await listAll(storageRef);
      
      const tree = {
        folders: {},
        files: []
      };

      // Process folders
      for (const folderRef of result.prefixes) {
        const folderName = folderRef.name;
  const folderPath = path ? `${path}/${folderName}` : folderName;
        
        tree.folders[folderName] = {
          path: folderPath,
          name: folderName,
          children: null, // Lazy load
          fileCount: 0,
          folderCount: 0
        };
      }

      // Process files
      tree.files = result.items.map(item => ({
        name: item.name,
        path: item.fullPath,
        size: null // Can be loaded separately if needed
      }));

      return tree;
    } catch (error) {
      console.error('Error in buildStorageTree:', error);
      return { folders: {}, files: [] };
    }
  };

  const loadFolderChildren = async (folderPath) => {
    try {
      const children = await buildStorageTree(folderPath);
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
          targetFolder.fileCount = children.files.length;
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

  const handleFolderClick = (folderPath) => {
    if (onFolderSelect) {
      onFolderSelect(folderPath);
    }
  };

  const renderTreeNode = (node, path = ROOT_PATH, level = 0) => {
    if (!node) {
      console.log('⚠️ renderTreeNode called with null node');
      return null;
    }

    console.log(`🖥️ Rendering node at path "${path}" level ${level}:`, {
      folders: Object.keys(node.folders || {}),
      files: (node.files || []).length,
      hasChildren: node.children ? Object.keys(node.children.folders || {}).length : 0
    });

    const isExpanded = expandedNodes.has(path);
    const isSelected = currentPath === path;
    
    // Check for children - either loaded children or unloaded folders
    const hasChildren = (node.children && Object.keys(node.children.folders).length > 0) || 
                       (node.folders && Object.keys(node.folders).length > 0);

    console.log(`📊 Node "${path}" - expanded: ${isExpanded}, hasChildren: ${hasChildren}, selected: ${isSelected}`);

    return (
      <div key={path} className="tree-node" style={{ marginLeft: `${level * 20}px` }}>
        <div 
          className={`tree-node-header ${isSelected ? 'selected' : ''}`}
          onClick={() => handleFolderClick(path)}
        >
          <span 
            className="tree-node-toggle"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren || path === ROOT_PATH) toggleNode(path);
            }}
          >
            {hasChildren || path === ROOT_PATH ? (
              isExpanded ? <FaFolderOpen /> : <FaFolder />
            ) : (
              <FaFolder className="empty-folder" />
            )}
          </span>
          <span className="tree-node-label">
            {path === ROOT_PATH ? 'PNLM' : node.name || path.split('/').pop()}
          </span>
          <span className="tree-node-stats">
            {node.children && Object.keys(node.children.folders).length > 0 && (
              <span className="folder-count">{Object.keys(node.children.folders).length}📁</span>
            )}
            {!node.children && node.folders && Object.keys(node.folders).length > 0 && (
              <span className="folder-count">{Object.keys(node.folders).length}📁</span>
            )}
            {node.children && node.children.files.length > 0 && (
              <span className="file-count">{node.children.files.length}📄</span>
            )}
            {!node.children && node.files && node.files.length > 0 && (
              <span className="file-count">{node.files.length}📄</span>
            )}
          </span>
        </div>

        {isExpanded && node.children && (
          <div className="tree-node-children">
            {Object.entries(node.children.folders).map(([folderName, folderData]) =>
              renderTreeNode(folderData, folderData.path, level + 1)
            )}
            {node.children.files.length > 0 && (
              <div className="tree-files" style={{ marginLeft: `${(level + 1) * 20 + 20}px` }}>
                {node.children.files.filter(file => file.name !== '.folder-placeholder' && file.name !== '.keep').map(file => (
                  <div key={file.path} className="tree-file">
                    <FaFile className="file-icon" />
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
            {node.files && node.files.length > 0 && (
              <div className="tree-files" style={{ marginLeft: `${(level + 1) * 20 + 20}px` }}>
                {node.files.filter(file => file.name !== '.folder-placeholder' && file.name !== '.keep').map(file => (
                  <div key={file.path} className="tree-file">
                    <FaFile className="file-icon" />
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
        <div className="loading-spinner">Loading storage structure...</div>
      </div>
    );
  }

  return (
    <div className={`storage-tree-view ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="tree-header">
        <h3>Storage Structure</h3>
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
          (() => {
            console.log('🎨 Main render - treeData:', treeData);
            console.log('🎨 About to render root node with:', { 
              folders: Object.keys(treeData.folders || {}), 
              files: (treeData.files || []).length,
              children: treeData.children ? Object.keys(treeData.children.folders || {}) : 'none'
            });
            
            return treeData && renderTreeNode({ 
              folders: treeData.folders || {}, 
              files: treeData.files || [],
              children: treeData.children,
              name: 'PNLM'
            }, ROOT_PATH, 0);
          })()
        )}
      </div>

      <div className="tree-legend">
        <div className="legend-item">
          <FaFolder /> Folder
        </div>
        <div className="legend-item">
          <FaFile /> File
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
