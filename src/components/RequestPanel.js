import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { FaClock, FaCheck, FaTimes } from 'react-icons/fa';
import './RequestPanel.css';

const RequestPanel = ({ userId, refreshTrigger }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'requests'),
      where('requestedBy', '==', userId),
      orderBy('requestedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const requestList = [];
      snapshot.forEach((doc) => {
        requestList.push({ id: doc.id, ...doc.data() });
      });
      setRequests(requestList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId, refreshTrigger]);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending':
        return <FaClock className="status-icon pending" />;
      case 'approved':
        return <FaCheck className="status-icon approved" />;
      case 'rejected':
        return <FaTimes className="status-icon rejected" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending':
        return '#ffc107';
      case 'approved':
        return '#28a745';
      case 'rejected':
        return '#dc3545';
      default:
        return '#6c757d';
    }
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

  if (loading) {
    return <div className="loading">Loading requests...</div>;
  }

  return (
    <div className="request-panel">
      {requests.length === 0 ? (
        <div className="empty-requests">
          <p>No requests submitted</p>
        </div>
      ) : (
        <div className="requests-list">
          {requests.map((request) => (
            <div key={request.id} className="request-item">
              <div className="request-header">
                <div className="request-type">
                  {getStatusIcon(request.status)}
                  <span className="request-action">{request.type}</span>
                </div>
                <span 
                  className="request-status"
                  style={{ color: getStatusColor(request.status) }}
                >
                  {request.status}
                </span>
              </div>
              
              <div className="request-details">
                <p className="request-description">
                  {getRequestDescription(request)}
                </p>
                <div className="request-meta">
                  <span className="request-date">
                    {formatDate(request.requestedAt)}
                  </span>
                  {request.path && (
                    <span className="request-path">
                      Path: {request.path}
                    </span>
                  )}
                </div>
                
                {request.adminResponse && (
                  <div className="admin-response">
                    <strong>Admin Response:</strong> {request.adminResponse}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      
      <div className="panel-footer">
        <p className="info-text">
          File operations require admin approval. You can track the status of your requests here.
        </p>
      </div>
    </div>
  );
};

export default RequestPanel;