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

// Lossless JPEG optimizer: strips non-essential metadata (COM, XMP/APP1 non-EXIF, APP13)
// and preserves EXIF (e.g., orientation) without re-encoding pixel data.
// Returns a Buffer. If parsing fails, returns the original buffer.
function stripJpegMetadataLosslessBuffer(inputBuf) {
  try {
    if (!Buffer.isBuffer(inputBuf) || inputBuf.length < 4) return inputBuf;
    const buf = inputBuf;
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return inputBuf; // Not JPEG SOI

    const chunks = [];
    // Write SOI
    chunks.push(Buffer.from([0xFF, 0xD8]));
    let i = 2;
    while (i + 3 < buf.length) {
      if (buf[i] !== 0xFF) {
        // Unexpected; bail out
        return inputBuf;
      }
      let marker = buf[i + 1];
      // Skip fill 0xFFs
      while (marker === 0xFF && i + 2 < buf.length) {
        i += 1;
        marker = buf[i + 1];
      }

      // EOI
      if (marker === 0xD9) {
        chunks.push(Buffer.from([0xFF, 0xD9]));
        i += 2;
        break;
      }

      // SOS: copy header + rest of file as-is
      if (marker === 0xDA) {
        if (i + 3 >= buf.length) return inputBuf;
        const len = (buf[i + 2] << 8) | buf[i + 3];
        const segEnd = i + 2 + len;
        if (segEnd > buf.length) return inputBuf;
        chunks.push(buf.subarray(i, segEnd));
        // Copy the remainder (scan data + EOI)
        chunks.push(buf.subarray(segEnd));
        return Buffer.concat(chunks);
      }

      if (i + 3 >= buf.length) return inputBuf;
      const len = (buf[i + 2] << 8) | buf[i + 3];
      const segEnd = i + 2 + len;
      if (len < 2 || segEnd > buf.length) return inputBuf; // malformed

      const isCOM = marker === 0xFE; // Comment
      const isAPP1 = marker === 0xE1; // APP1 (Exif or XMP)
      const isAPP13 = marker === 0xED; // APP13 (Photoshop IRB)
      let strip = false;

      if (isCOM) {
        strip = true;
      } else if (isAPP13) {
        strip = true;
      } else if (isAPP1) {
        // Inspect payload to decide EXIF vs XMP
        const payloadStart = i + 4;
        const payloadLen = len - 2;
        if (payloadLen > 0 && payloadStart + payloadLen <= buf.length) {
          const isExif = payloadLen >= 6 &&
            buf[payloadStart + 0] === 0x45 && // E
            buf[payloadStart + 1] === 0x78 && // x
            buf[payloadStart + 2] === 0x69 && // i
            buf[payloadStart + 3] === 0x66 && // f
            buf[payloadStart + 4] === 0x00 &&
            buf[payloadStart + 5] === 0x00;
          if (isExif) {
            strip = false; // keep EXIF
          } else {
            const needle = Buffer.from('http://ns.adobe.com/xap/1.0/');
            const seg = buf.subarray(payloadStart, payloadStart + Math.min(payloadLen, needle.length));
            strip = seg.equals(needle.subarray(0, seg.length)); // strip XMP
          }
        }
      }

      if (!strip) {
        chunks.push(buf.subarray(i, segEnd));
      }
      i = segEnd;
    }
    // If we get here without hitting SOS, return original
    return inputBuf;
  } catch (e) {
    console.warn('stripJpegMetadataLosslessBuffer failed:', e?.message || e);
    return inputBuf;
  }
}

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

    const prefix = (data && typeof data.prefix === 'string' ? data.prefix : 'files/')
      .toString()
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
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
      if (mode === 'balanced') {
        const image = sharp(inputBuf, { failOn: 'none' }).rotate();
        return image
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toBuffer();
      }
      // True lossless: strip metadata without re-encoding
      return stripJpegMetadataLosslessBuffer(inputBuf);
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

  // Only write back if we actually saved a meaningful number of bytes
  const minGain = 1024; // 1KB threshold to avoid churn from tiny differences
  const shouldWrite = !dryRun && (beforeSize > 0) && (afterSize + minGain < beforeSize);
        if (shouldWrite) {
          // Overwrite object with optimized JPEG, set metadata flag
          await file.save(optimizedBuf, {
            contentType: 'image/jpeg',
            metadata: { metadata: { optimized: mode, optimizedAt: new Date().toISOString() } },
            resumable: false,
            validation: false
          });
          // Also update Firestore metadata doc(s) if present so UI shows new size
          try {
            const q = await db.collection('files').where('fullPath', '==', file.name).get();
            if (!q.empty) {
              const payload = {
                size: afterSize,
                type: 'image/jpeg',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                optimized: mode,
                optimizedAt: admin.firestore.FieldValue.serverTimestamp(),
              };
              const batch = db.batch();
              q.forEach((docSnap) => batch.set(docSnap.ref, payload, { merge: true }));
              await batch.commit();
            }
          } catch (e) {
            console.warn('Failed to update Firestore size for', file.name, e.message || e);
          }
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

// Optimize JPEGs on upload automatically. Skips if already optimized or not image/jpeg.
exports.optimizeOnUpload = functions.storage.object().onFinalize(async (object) => {
  try {
    const { name: fullPath, contentType, bucket } = object || {};
    if (!fullPath || !contentType) return;
    // Only JPEGs (by ext or content type)
    const lower = fullPath.toLowerCase();
    const looksJpeg = lower.endsWith('.jpg') || lower.endsWith('.jpeg');
    const isJpegCT = typeof contentType === 'string' && contentType.startsWith('image/jpeg');
    if (!(looksJpeg || isJpegCT)) return;

  const md = (object && object.metadata) || {};
  if (md.optimized) return; // avoid reprocessing loop
  // Require explicit opt-in flag from uploader to run optimization
  if (!md.autoOptimize || md.autoOptimize !== '1') return;

    const gcs = storage.bucket(bucket).file(fullPath);
    // Download
    const [buf] = await gcs.download();
    // Lossless by default: strip metadata only
    const optimizedBuf = stripJpegMetadataLosslessBuffer(buf);

    // Skip if no meaningful gain
    const minGain = 1024;
    if (!(buf.length > 0 && optimizedBuf.length + minGain < buf.length)) {
      return;
    }

    // Save back with optimized metadata flag
    await gcs.save(optimizedBuf, {
      contentType: 'image/jpeg',
      metadata: { metadata: { optimized: 'lossless', optimizedAt: new Date().toISOString() } },
      resumable: false,
      validation: false,
    });

    // Update Firestore size/type for corresponding file doc(s)
    const q = await db.collection('files').where('fullPath', '==', fullPath).get();
    if (!q.empty) {
      const payload = {
        size: optimizedBuf.length,
        type: 'image/jpeg',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        optimized: 'lossless',
        optimizedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const batch = db.batch();
      q.forEach((docSnap) => batch.set(docSnap.ref, payload, { merge: true }));
      await batch.commit();
    }
  } catch (err) {
    console.error('optimizeOnUpload error:', err);
  }
});