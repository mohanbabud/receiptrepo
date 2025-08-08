import React, { useState } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

const AdminSetup = ({ user }) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const makeAdmin = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
  const userRef = doc(db, 'users', user.uid);
  // Create or update user doc with admin role
  await setDoc(userRef, { role: 'admin', email: user.email || '' }, { merge: true });
      
      setMessage('✅ You are now an admin! Please refresh the page.');
      
      // Auto refresh after 2 seconds
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Error making admin:', error);
      setMessage('❌ Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const checkCurrentRole = async () => {
    if (!user) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setMessage(`Current role: ${userData.role || 'user'}`);
      }
    } catch (error) {
      setMessage('Error checking role: ' + error.message);
    }
  };

  return (
    <div style={{ 
      background: '#f8f9fa', 
      padding: '20px', 
      borderRadius: '8px', 
      margin: '20px',
      border: '1px solid #dee2e6'
    }}>
      <h3>Admin Setup</h3>
      <p>Current User: <strong>{user?.email}</strong></p>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        <button 
          onClick={checkCurrentRole}
          style={{
            background: '#17a2b8',
            color: 'white',
            border: 'none',
            padding: '10px 15px',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Check Current Role
        </button>
        
        <button 
          onClick={makeAdmin}
          disabled={loading}
          style={{
            background: loading ? '#6c757d' : '#dc3545',
            color: 'white',
            border: 'none',
            padding: '10px 15px',
            borderRadius: '5px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Setting...' : 'Make Me Admin'}
        </button>
      </div>
      
      {message && (
        <div style={{
          padding: '10px',
          borderRadius: '5px',
          background: message.includes('✅') ? '#d4edda' : message.includes('❌') ? '#f8d7da' : '#d1ecf1',
          color: message.includes('✅') ? '#155724' : message.includes('❌') ? '#721c24' : '#0c5460',
          border: `1px solid ${message.includes('✅') ? '#c3e6cb' : message.includes('❌') ? '#f5c6cb' : '#bee5eb'}`
        }}>
          {message}
        </div>
      )}
      
      <div style={{ marginTop: '15px', fontSize: '14px', color: '#6c757d' }}>
        <strong>Note:</strong> Only use this if you're the project owner and need admin access.
      </div>
    </div>
  );
};

export default AdminSetup;
