import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc,
  orderBy,
  where,
  setDoc
} from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { sendPasswordResetEmail, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, storage, auth } from '../firebase';
import { FaArrowLeft, FaCheck, FaTimes, FaUsers, FaFileAlt, FaClock, FaKey, FaEnvelope, FaUserPlus } from 'react-icons/fa';
import './AdminPanel.css';

const AdminPanel = ({ user }) => {
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('requests');
  const [loading, setLoading] = useState(true);
  const [resetPasswordTarget, setResetPasswordTarget] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Add User states
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [newUserData, setNewUserData] = useState({
    email: '',
    username: '',
    password: '',
    role: 'user'
  });
  const [addUserLoading, setAddUserLoading] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [addUserSuccess, setAddUserSuccess] = useState('');

  useEffect(() => {
    // Listen to requests
    const requestsQuery = query(
      collection(db, 'requests'),
      orderBy('requestedAt', 'desc')
    );
    
    const unsubscribeRequests = onSnapshot(requestsQuery, (snapshot) => {
      const requestList = [];
      snapshot.forEach((doc) => {
        requestList.push({ id: doc.id, ...doc.data() });
      });
      setRequests(requestList);
    });

    // Listen to users
    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const userList = [];
      snapshot.forEach((doc) => {
        userList.push({ id: doc.id, ...doc.data() });
      });
      setUsers(userList);
    });

    // Listen to files
    const filesQuery = query(
      collection(db, 'files'),
      orderBy('uploadedAt', 'desc')
    );
    const unsubscribeFiles = onSnapshot(filesQuery, (snapshot) => {
      const fileList = [];
      snapshot.forEach((doc) => {
        fileList.push({ id: doc.id, ...doc.data() });
      });
      setFiles(fileList);
      setLoading(false);
    });

    return () => {
      unsubscribeRequests();
      unsubscribeUsers();
      unsubscribeFiles();
    };
  }, []);

  const handleRequestAction = async (requestId, action, adminResponse = '') => {
    try {
      const requestDoc = requests.find(r => r.id === requestId);
      
      if (action === 'approved' && requestDoc.type === 'delete') {
        // Execute the delete operation
        const fileDoc = files.find(f => f.id === requestDoc.fileId);
        if (fileDoc) {
          // Delete from Storage
          const fileRef = ref(storage, fileDoc.fullPath);
          await deleteObject(fileRef);
          
          // Delete from Firestore
          await deleteDoc(doc(db, 'files', fileDoc.id));
        }
      } else if (action === 'approved' && requestDoc.type === 'rename') {
        // Execute the rename operation
        await updateDoc(doc(db, 'files', requestDoc.fileId), {
          name: requestDoc.newFileName,
          updatedAt: new Date()
        });
      }

      // Update request status
      await updateDoc(doc(db, 'requests', requestId), {
        status: action,
        adminResponse: adminResponse,
        processedAt: new Date(),
        processedBy: user.uid
      });

    } catch (error) {
      console.error('Error processing request:', error);
      alert('Error processing request');
    }
  };

  const handleUserRoleChange = async (userId, newRole) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        role: newRole,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating user role:', error);
      alert('Error updating user role');
    }
  };

  const handlePasswordResetClick = (userData) => {
    setResetPasswordTarget(userData);
    setShowResetConfirm(true);
    setResetSuccess(false);
    setResetError('');
  };

  const cancelPasswordReset = () => {
    setShowResetConfirm(false);
    setResetPasswordTarget(null);
    setResetSuccess(false);
    setResetError('');
  };

  const confirmPasswordReset = async () => {
    if (!resetPasswordTarget || !resetPasswordTarget.email) return;
    
    setIsResetting(true);
    try {
      await sendPasswordResetEmail(auth, resetPasswordTarget.email);
      
      setResetSuccess(true);
      setResetError('');
      
      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setShowResetConfirm(false);
        setResetPasswordTarget(null);
        setResetSuccess(false);
      }, 5000);
      
    } catch (error) {
      console.error('Error sending password reset email:', error);
      let errorMessage = 'Failed to send password reset email';
      
      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage = 'No user found with this email address';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many requests. Please try again later';
          break;
        default:
          errorMessage = error.message;
      }
      
      setResetError(errorMessage);
      setResetSuccess(false);
    } finally {
      setIsResetting(false);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    
    if (!newUserData.email || !newUserData.password || !newUserData.username) {
      setAddUserError('Please fill in all required fields');
      return;
    }

    if (newUserData.password.length < 6) {
      setAddUserError('Password must be at least 6 characters long');
      return;
    }

    setAddUserLoading(true);
    setAddUserError('');
    setAddUserSuccess('');

    try {
      // Create user with Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(
        auth, 
        newUserData.email, 
        newUserData.password
      );
      
      const newUser = userCredential.user;

      // Add user to Firestore with additional details
      await setDoc(doc(db, 'users', newUser.uid), {
        email: newUserData.email,
        username: newUserData.username,
        role: newUserData.role,
        createdAt: new Date(),
        createdBy: user.uid,
        createdByEmail: user.email,
        isActive: true
      });

      setAddUserSuccess(`User ${newUserData.username} (${newUserData.email}) has been created successfully!`);
      
      // Reset form
      setNewUserData({
        email: '',
        username: '',
        password: '',
        role: 'user'
      });

      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setAddUserSuccess('');
        setShowAddUserForm(false);
      }, 5000);

    } catch (error) {
      console.error('Error creating user:', error);
      let errorMessage = 'Failed to create user';
      
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Email address is already registered';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address format';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak';
      } else {
        errorMessage = error.message || 'Failed to create user';
      }
      
      setAddUserError(errorMessage);
    } finally {
      setAddUserLoading(false);
    }
  };

  const resetAddUserForm = () => {
    setShowAddUserForm(false);
    setNewUserData({
      email: '',
      username: '',
      password: '',
      role: 'user'
    });
    setAddUserError('');
    setAddUserSuccess('');
  };

  const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.toDate) return 'Unknown';
    return timestamp.toDate().toLocaleDateString();
  };

  const getRequestDescription = (request) => {
    switch (request.type) {
      case 'delete':
        return `Delete "${request.fileName}"`;
      case 'rename':
        return `Rename "${request.fileName}" to "${request.newFileName}"`;
      default:
        return 'Unknown request';
    }
  };

  const renderRequests = () => {
    const pendingRequests = requests.filter(r => r.status === 'pending');
    
    return (
      <div className="admin-section">
        <h3>Pending Requests ({pendingRequests.length})</h3>
        
        {pendingRequests.length === 0 ? (
          <div className="empty-state">
            <FaClock className="empty-icon" />
            <p>No pending requests</p>
          </div>
        ) : (
          <div className="requests-grid">
            {pendingRequests.map((request) => (
              <div key={request.id} className="request-card">
                <div className="request-info">
                  <h4>{getRequestDescription(request)}</h4>
                  <p>Requested by: {request.requestedBy}</p>
                  <p>Date: {formatDate(request.requestedAt)}</p>
                  {request.path && <p>Path: {request.path}</p>}
                </div>
                
                <div className="request-actions">
                  <button
                    onClick={() => handleRequestAction(request.id, 'approved')}
                    className="approve-btn"
                  >
                    <FaCheck /> Approve
                  </button>
                  <button
                    onClick={() => {
                      const response = prompt('Reason for rejection (optional):');
                      handleRequestAction(request.id, 'rejected', response || '');
                    }}
                    className="reject-btn"
                  >
                    <FaTimes /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <h3>All Requests History</h3>
        <div className="requests-table">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Requested By</th>
                <th>Date</th>
                <th>Status</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td className={`type-${request.type}`}>{request.type}</td>
                  <td>{getRequestDescription(request)}</td>
                  <td>{request.requestedBy}</td>
                  <td>{formatDate(request.requestedAt)}</td>
                  <td className={`status-${request.status}`}>{request.status}</td>
                  <td>{request.adminResponse || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderUsers = () => (
    <div className="admin-section">
      <h3>User Management ({users.length} users)</h3>
      <div className="users-table">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Username</th>
              <th>Role</th>
              <th>Created</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((userData) => (
              <tr key={userData.id}>
                <td>{userData.email}</td>
                <td>{userData.username || '-'}</td>
                <td>
                  <select
                    value={userData.role || 'user'}
                    onChange={(e) => handleUserRoleChange(userData.id, e.target.value)}
                    className={`role-select ${userData.role}`}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>{formatDate(userData.createdAt)}</td>
                <td>{formatDate(userData.lastLogin)}</td>
                <td>
                  <div className="user-actions">
                    <span className={`user-status ${userData.role}`}>
                      {userData.role || 'user'}
                    </span>
                    <button
                      className="reset-password-btn"
                      onClick={() => handlePasswordResetClick(userData)}
                      title={`Send password reset email to ${userData.email}`}
                    >
                      <FaKey />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderFiles = () => (
    <div className="admin-section">
      {/** Filter out .folder-placeholder files everywhere in file stats and table */}
      {(() => {
        const visibleFiles = files.filter(f => f.name !== '.folder-placeholder');
        return <>
          <h3>File Overview ({visibleFiles.length} files)</h3>
          <div className="files-stats">
            <div className="stat-card">
              <h4>Total Files</h4>
              <p>{visibleFiles.length}</p>
            </div>
            <div className="stat-card">
              <h4>Total Size</h4>
              <p>{(visibleFiles.reduce((sum, file) => sum + (file.size || 0), 0) / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <div className="stat-card">
              <h4>Images</h4>
              <p>{visibleFiles.filter(f => f.type?.startsWith('image/')).length}</p>
            </div>
            <div className="stat-card">
              <h4>PDFs</h4>
              <p>{visibleFiles.filter(f => f.type === 'application/pdf').length}</p>
            </div>
          </div>
          <div className="files-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Path</th>
                  <th>Size</th>
                  <th>Type</th>
                  <th>Uploaded</th>
                  <th>Uploaded By</th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr key={file.id}>
                    <td title={file.name}>{file.name}</td>
                    <td>{file.path}</td>
                    <td>{(file.size / 1024 / 1024).toFixed(2)} MB</td>
                    <td>{file.type || 'Unknown'}</td>
                    <td>{formatDate(file.uploadedAt)}</td>
                    <td>{file.uploadedBy || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>;
      })()}
    </div>
  );

  const renderAddUsers = () => (
    <div className="admin-section">
      <div className="add-user-header">
        <h3>Add New User</h3>
        <button
          className="add-user-btn"
          onClick={() => setShowAddUserForm(true)}
          disabled={showAddUserForm}
        >
          <FaUserPlus /> Add User
        </button>
      </div>

      {showAddUserForm && (
        <div className="add-user-form-container">
          <form onSubmit={handleAddUser} className="add-user-form">
            <div className="form-header">
              <h4>Create New User Account</h4>
              <button
                type="button"
                className="close-form-btn"
                onClick={resetAddUserForm}
              >
                <FaTimes />
              </button>
            </div>

            {addUserError && (
              <div className="error-message">
                <FaTimes className="error-icon" />
                {addUserError}
              </div>
            )}

            {addUserSuccess && (
              <div className="success-message">
                <FaCheck className="success-icon" />
                {addUserSuccess}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="userEmail">Email Address *</label>
              <input
                type="email"
                id="userEmail"
                value={newUserData.email}
                onChange={(e) => setNewUserData({
                  ...newUserData,
                  email: e.target.value
                })}
                placeholder="user@example.com"
                required
                disabled={addUserLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="userName">Username *</label>
              <input
                type="text"
                id="userName"
                value={newUserData.username}
                onChange={(e) => setNewUserData({
                  ...newUserData,
                  username: e.target.value
                })}
                placeholder="Enter username"
                required
                disabled={addUserLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="userPassword">Password *</label>
              <input
                type="password"
                id="userPassword"
                value={newUserData.password}
                onChange={(e) => setNewUserData({
                  ...newUserData,
                  password: e.target.value
                })}
                placeholder="Minimum 6 characters"
                minLength="6"
                required
                disabled={addUserLoading}
              />
              <small className="password-hint">Password must be at least 6 characters long</small>
            </div>

            <div className="form-group">
              <label htmlFor="userRole">Role *</label>
              <select
                id="userRole"
                value={newUserData.role}
                onChange={(e) => setNewUserData({
                  ...newUserData,
                  role: e.target.value
                })}
                required
                disabled={addUserLoading}
              >
                <option value="viewer">Viewer - Read-only access</option>
                <option value="user">User - Upload files, submit requests</option>
                <option value="admin">Admin - Full access</option>
              </select>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={resetAddUserForm}
                disabled={addUserLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="create-user-btn"
                disabled={addUserLoading}
              >
                {addUserLoading ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="add-user-info">
        <h4>📋 Instructions</h4>
        <ul>
          <li><strong>Email Address:</strong> Must be a valid email address that will be used for login</li>
          <li><strong>Username:</strong> Display name for the user in the system</li>
          <li><strong>Password:</strong> Temporary password (user can change it later)</li>
          <li><strong>Role:</strong> Determines user permissions in the system</li>
        </ul>
      </div>

      <div className="user-roles-guide">
        <h4>🔐 Role Permissions</h4>
        <div className="roles-grid">
          <div className="role-card viewer">
            <h5>👁️ Viewer</h5>
            <ul>
              <li>View files and folders</li>
              <li>Download files</li>
              <li>Read-only access</li>
            </ul>
          </div>
          <div className="role-card user">
            <h5>📤 User</h5>
            <ul>
              <li>All Viewer permissions</li>
              <li>Upload new files</li>
              <li>Submit delete/rename requests</li>
            </ul>
          </div>
          <div className="role-card admin">
            <h5>⚡ Admin</h5>
            <ul>
              <li>All User permissions</li>
              <li>Delete/rename files directly</li>
              <li>Manage users and approve requests</li>
              <li>Access admin panel</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return <div className="loading">Loading admin panel...</div>;
  }

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <div className="header-left">
          <Link to="/dashboard" className="back-link">
            <FaArrowLeft /> Back to Dashboard
          </Link>
          <h1>Admin Panel</h1>
        </div>
        <div className="header-right">
          <span>Logged in as: {user.email}</span>
        </div>
      </header>

      <div className="admin-tabs">
        <button
          className={`tab-btn ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          <FaFileAlt /> Requests ({requests.filter(r => r.status === 'pending').length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <FaUsers /> Users ({users.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'addUsers' ? 'active' : ''}`}
          onClick={() => setActiveTab('addUsers')}
        >
          <FaUserPlus /> Add Users
        </button>
        <button
          className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          <FaFileAlt /> Files ({files.length})
        </button>
      </div>

      <div className="admin-content">
        {activeTab === 'requests' && renderRequests()}
        {activeTab === 'users' && renderUsers()}
        {activeTab === 'addUsers' && renderAddUsers()}
        {activeTab === 'files' && renderFiles()}
      </div>

      {showResetConfirm && (
        <div className="reset-confirm-overlay">
          <div className="reset-confirm-dialog">
            <div className="reset-confirm-header">
              <FaKey className="reset-icon" />
              <h3>Reset User Password</h3>
              <button 
                className="close-btn"
                onClick={cancelPasswordReset}
                title="Cancel"
              >
                <FaTimes />
              </button>
            </div>
            
            <div className="reset-confirm-content">
              {resetSuccess ? (
                <div className="reset-success">
                  <FaEnvelope className="success-icon" />
                  <h4>Password Reset Email Sent!</h4>
                  <p>
                    A password reset email has been sent to:
                  </p>
                  <div className="email-sent">
                    <strong>{resetPasswordTarget?.email}</strong>
                  </div>
                  <p className="reset-note">
                    The user will receive an email with instructions to reset their password.
                    This dialog will close automatically in a few seconds.
                  </p>
                </div>
              ) : resetError ? (
                <div className="reset-error">
                  <FaTimes className="error-icon" />
                  <h4>Password Reset Failed</h4>
                  <p className="error-message">{resetError}</p>
                  <p>Please check the email address and try again.</p>
                </div>
              ) : (
                <div className="reset-confirm">
                  <p>
                    Are you sure you want to send a password reset email to this user?
                  </p>
                  <div className="user-reset-info">
                    <div className="user-email">
                      <strong>Email:</strong> {resetPasswordTarget?.email}
                    </div>
                    <div className="user-name">
                      <strong>Username:</strong> {resetPasswordTarget?.username || 'N/A'}
                    </div>
                    <div className="user-role">
                      <strong>Role:</strong> {resetPasswordTarget?.role || 'user'}
                    </div>
                  </div>
                  <div className="reset-warning">
                    <p>📧 <strong>Note:</strong> The user will receive an email with a secure link to reset their password.</p>
                  </div>
                </div>
              )}
            </div>

            {!resetSuccess && (
              <div className="reset-confirm-actions">
                <button 
                  className="cancel-btn"
                  onClick={cancelPasswordReset}
                  disabled={isResetting}
                >
                  Cancel
                </button>
                <button 
                  className="confirm-reset-btn"
                  onClick={confirmPasswordReset}
                  disabled={isResetting}
                >
                  {isResetting ? 'Sending...' : 'Send Reset Email'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
