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

// Admin-set password (callable). Only users with role 'admin' in Firestore can call this.
exports.adminSetUserPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  const callerUid = context.auth.uid;
  const callerDoc = await db.collection('users').doc(callerUid).get();
  if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admin can set passwords');
  }
  const { uid, password } = data || {};
  if (!uid || typeof uid !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'uid is required');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters');
  }
  try {
    await admin.auth().updateUser(uid, { password });
    return { success: true };
  } catch (err) {
    console.error('adminSetUserPassword error:', err);
    throw new functions.https.HttpsError('internal', err?.message || 'Failed to update password');
  }
});

// Backfill optimization for existing JPEGs in Storage.
// Modes:
//   - lossless: strip metadata, preserve orientation, quality=100
//   - balanced: resize to max 2000px (inside), quality=85
// Options:
//   prefix (string, default 'files/'), limit (number), dryRun (bool), mode ('lossless'|'balanced'), overwrite (bool)
const sharp = require('sharp');

exports.optimizeExistingImages = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const callerUid = context.auth.uid;
    const callerDoc = await db.collection('users').doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', 'Only admin can run backfill');
    }

    const prefix = (data && typeof data.prefix === 'string' ? data.prefix : 'files/').replace(/^\/+/, '');
    const limit = Math.max(0, Math.floor(data && data.limit ? data.limit : 50));
    const dryRun = !!(data && data.dryRun);
    const overwrite = !!(data && data.overwrite);
    const mode = (data && (data.mode === 'lossless' || data.mode === 'balanced') ? data.mode : 'lossless');

    const bucket = storage.bucket();
    let pageToken = undefined;
    let scanned = 0;
    let processed = 0;
    let skipped = 0;
    let savedBytes = 0;
    const details = [];

    const shouldProcess = (file, metadata) => {
      const name = file.name || '';
      const ct = (metadata && (metadata.contentType || metadata['content-type'])) || '';
      const lower = name.toLowerCase();
      const looksJpeg = lower.endsWith('.jpg') || lower.endsWith('.jpeg');
      const isJpegCT = typeof ct === 'string' && ct.startsWith('image/jpeg');
      if (!(looksJpeg || isJpegCT)) return false;
      // Skip if already optimized in same mode unless overwrite
      const md = (metadata && metadata.metadata) || {};
      if (!overwrite && md && md.optimized && md.optimized === mode) return false;
      return true;
    };

    const optimizeBuffer = async (inputBuf) => {
      const image = sharp(inputBuf, { failOn: 'none' }).rotate();
      if (mode === 'balanced') {
        return image
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toBuffer();
      }
      // lossless-ish: strip metadata, keep orientation, max quality
      return image.jpeg({ quality: 100, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
    };

    outer: while (true) {
      const [files, nextQuery] = await bucket.getFiles({ prefix, autoPaginate: false, pageToken });
      for (const file of files) {
        if (limit && processed >= limit) break outer;
        // Fetch metadata
        let [meta] = await file.getMetadata().catch(() => [{}]);
        scanned++;
        if (!shouldProcess(file, meta)) { skipped++; continue; }
        const beforeSize = Number(meta && meta.size) || 0;
        // Download contents
        const [buf] = await file.download();
        let optimizedBuf;
        try {
          optimizedBuf = await optimizeBuffer(buf);
        } catch (e) {
          console.error('Optimize error for', file.name, e);
          skipped++;
          continue;
        }

        const afterSize = optimizedBuf.length;
        const delta = beforeSize > 0 ? beforeSize - afterSize : 0;
        savedBytes += delta > 0 ? delta : 0;
        details.push({ path: file.name, before: beforeSize, after: afterSize, saved: delta });

        if (!dryRun) {
          // Overwrite object with optimized JPEG, set metadata flag
          await file.save(optimizedBuf, {
            contentType: 'image/jpeg',
            metadata: { metadata: { optimized: mode, optimizedAt: new Date().toISOString() } },
            resumable: false,
            validation: false
          });
        }
        processed++;
      }
      if (nextQuery && nextQuery.pageToken) {
        pageToken = nextQuery.pageToken;
      } else {
        break;
      }
    }

    return {
      prefix,
      mode,
      dryRun,
      limit,
      scanned,
      processed,
      skipped,
      savedBytes,
      details
    };
  });