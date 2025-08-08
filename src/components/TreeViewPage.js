import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import StorageTreeView from './StorageTreeView';
import './TreeViewPage.css';

const TreeViewPage = ({ user, userRole }) => {
  const [currentPath, setCurrentPath] = useState('');

  return (
    <div className="tree-view-page">
      <header className="tree-header">
        <div className="header-left">
          <Link to="/dashboard" className="back-btn">
            ← Back to Dashboard
          </Link>
          <h1>Firebase Storage Structure</h1>
        </div>
        <div className="header-right">
          <span className="current-path">
            Current: <strong>/{currentPath || 'PNLM'}</strong>
          </span>
          <span className="user-info">
            {user.email} ({userRole})
          </span>
        </div>
      </header>

      <div className="tree-content">
        <StorageTreeView 
          currentPath={currentPath}
          onFolderSelect={setCurrentPath}
        />
      </div>
    </div>
  );
};

export default TreeViewPage;
