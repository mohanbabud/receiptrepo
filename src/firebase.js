// Firebase configuration
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
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
// Initialize Firestore with robust transport for constrained networks
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  cacheSizeBytes: 1048576 // 1MB (keep small)
});

// Choose the Storage bucket: env override preferred, else use config.storageBucket
const overrideBucket = process.env.REACT_APP_FIREBASE_STORAGE_BUCKET;

function normalizeBucketHost(host) {
  if (!host) return host;
  const trimmed = host.trim();
  // Prefer the modern firebasestorage.app host; some environments still expose appspot.com
  if (trimmed.endsWith('.appspot.com')) {
    return trimmed.replace(/\.appspot\.com$/, '.firebasestorage.app');
  }
  return trimmed;
}

function toGsUrl(bucketLike) {
  if (!bucketLike) return undefined;
  // If already gs://, return as-is
  if (bucketLike.startsWith('gs://')) return bucketLike;
  // If it's a host-style string, normalize
  // Accept forms like my-bucket.appspot.com or my-project.firebasestorage.app
  const host = normalizeBucketHost(bucketLike);
  return `gs://${host}`;
}

// Always pass an explicit bucket to getStorage to avoid ambiguity
let selectedBucket = overrideBucket || firebaseConfig.storageBucket;
if (!selectedBucket) {
  // Fallback to <projectId>.firebasestorage.app if not explicitly set
  const pid = process.env.REACT_APP_FIREBASE_PROJECT_ID;
  if (pid) {
    selectedBucket = `${pid}.firebasestorage.app`;
  }
}
selectedBucket = normalizeBucketHost(selectedBucket);
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
