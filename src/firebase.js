// Firebase configuration
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

export const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Optional: Initialize App Check if a site key is provided (helps if App Check is enforced)
const appCheckKey = process.env.REACT_APP_FIREBASE_APPCHECK_SITE_KEY;
if (appCheckKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckKey),
      isTokenAutoRefreshEnabled: true
    });
    // eslint-disable-next-line no-console
    console.info('[Firebase] App Check initialized with reCAPTCHA v3');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Firebase] App Check init failed:', e && e.message);
  }
}

// Initialize Firebase services
export const auth = getAuth(app);
// Force login on every access by keeping auth state in memory only (no persistence)
try {
  setPersistence(auth, inMemoryPersistence).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[Firebase] setPersistence(inMemory) failed:', e && e.message);
  });
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[Firebase] setPersistence threw:', e && e.message);
}
// Initialize Firestore with robust transport for constrained networks
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  cacheSizeBytes: 1048576 // 1MB (keep small)
});

// Choose the Storage bucket: env override preferred, else use config.storageBucket
const overrideBucket = process.env.REACT_APP_FIREBASE_STORAGE_BUCKET;

function toGsUrl(bucketLike) {
  if (!bucketLike) return undefined;
  // If already gs://, return as-is
  if (bucketLike.startsWith('gs://')) return bucketLike;
  // If it looks like a bucket name or host, pass as gs://<bucket-name>
  return `gs://${bucketLike.trim()}`;
}

// Always pass an explicit bucket to getStorage to avoid ambiguity
let selectedBucket = overrideBucket || firebaseConfig.storageBucket;
if (!selectedBucket) {
  // Fallback to <projectId>.appspot.com if not explicitly set
  const pid = process.env.REACT_APP_FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  if (pid) {
    selectedBucket = `${pid}.appspot.com`;
  }
}
export const storage = getStorage(app, toGsUrl(selectedBucket));
// Helpful one-time log for visibility (safe: shows bucket host only)
try {
  // eslint-disable-next-line no-console
  console.info('[Firebase] Using Storage bucket:', selectedBucket);
} catch (_) {}

// Reduce Functions timeout (example: 3 seconds)
export const functions = getFunctions(app, {
  timeout: 3000 // milliseconds
});

export default app;
