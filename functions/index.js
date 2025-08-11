const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();

// Cloud function to handle file operations
exports.processFileRequest = functions.firestore
  .document('requests/{requestId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data();
    const before = change.before.data();
    
    // Only process when status changes to 'approved'
    if (before.status !== 'approved' && after.status === 'approved') {
      const { type, fileId, fileName, newFileName } = after;
      
      try {
        if (type === 'delete') {
          // Delete file from storage and firestore
          const fileDoc = await db.collection('files').doc(fileId).get();
          if (fileDoc.exists) {
            const fileData = fileDoc.data();
            
            // Delete from storage
            const bucket = storage.bucket();
            await bucket.file(fileData.fullPath).delete();
            
            // Delete from firestore
            await db.collection('files').doc(fileId).delete();
            
            console.log(`File ${fileName} deleted successfully`);
          }
        } else if (type === 'rename') {
          // Update file name in firestore
          await db.collection('files').doc(fileId).update({
            name: newFileName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          console.log(`File ${fileName} renamed to ${newFileName}`);
        }
      } catch (error) {
        console.error('Error processing file request:', error);
        
        // Update request with error status
        await db.collection('requests').doc(context.params.requestId).update({
          status: 'error',
          adminResponse: `Error: ${error.message}`,
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  });

// Cloud function to initialize admin user
exports.createAdminUser = functions.https.onCall(async (data, context) => {
  try {
    const { email, password } = data;
    
    // Create user
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password
    });
    
    // Set admin role in Firestore
    await db.collection('users').doc(userRecord.uid).set({
      email: email,
      role: 'admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: true, uid: userRecord.uid };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Error creating admin user', error);
  }
});

// Cloud function to get user statistics
exports.getUserStats = functions.https.onCall(async (data, context) => {
  // Check if user is admin
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!userDoc.exists || userDoc.data().role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'User must be admin');
  }
  
  try {
    const usersSnapshot = await db.collection('users').get();
    const filesSnapshot = await db.collection('files').get();
    const requestsSnapshot = await db.collection('requests').get();
    
    const stats = {
      totalUsers: usersSnapshot.size,
      totalFiles: filesSnapshot.size,
      totalRequests: requestsSnapshot.size,
      pendingRequests: requestsSnapshot.docs.filter(doc => doc.data().status === 'pending').length
    };
    
    return stats;
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Error fetching stats', error);
  }
});

// OCR on image upload using Google Cloud Vision
const vision = require('@google-cloud/vision');
const visionClient = new vision.ImageAnnotatorClient();

exports.ocrOnUpload = functions.storage.object().onFinalize(async (object) => {
  try {
    const { name: fullPath, contentType } = object; // e.g., files/receipts/abc.jpg
    if (!fullPath || !contentType || !contentType.startsWith('image/')) return;

    // Run OCR
    const [result] = await visionClient.textDetection(`gs://${object.bucket}/${fullPath}`);
    const detections = result.textAnnotations || [];
    const text = (detections[0] && detections[0].description) ? detections[0].description : '';

    // Try to find corresponding Firestore doc by fullPath
    const filesSnap = await db.collection('files').where('fullPath', '==', fullPath).limit(1).get();
    if (!filesSnap.empty) {
      const docRef = filesSnap.docs[0].ref;
      await docRef.set({ ocrText: text, ocrStatus: text ? 'done' : 'error' }, { merge: true });
    }
  } catch (err) {
    console.error('OCR error:', err);
    try {
      // Mark error on doc if we can find it
      if (object && object.name) {
        const filesSnap = await db.collection('files').where('fullPath', '==', object.name).limit(1).get();
        if (!filesSnap.empty) await filesSnap.docs[0].ref.set({ ocrStatus: 'error' }, { merge: true });
      }
    } catch (_) {}
  }
});