// firebaseDiagnostics.js
// Utility functions to test and diagnose connection issues between your app and Firebase

import { auth, db, storage, firebaseConfig } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { ref, list } from 'firebase/storage';

// Utility to add timeout to a promise
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve('Timeout'), ms))
  ]);
}

/**
 * Test Firebase Auth connection
 * @returns {Promise<boolean>} true if connection works, false otherwise
 */
export async function testAuthConnection() {
  try {
    const result = await withTimeout(
      new Promise(resolve => {
        const unsubscribe = onAuthStateChanged(
          auth,
          () => {
            unsubscribe();
            resolve(true); // Auth reachable regardless of signed-in state
          },
          () => {
            unsubscribe();
            resolve(false);
          }
        );
      }),
      5000
    );
    if (result === 'Timeout') return 'timeout';
    return result ? 'connected' : 'disconnected';
  } catch (error) {
    console.error('Auth connection error:', error);
    return 'disconnected';
  }
}

/**
 * Test Firestore connection
 * @returns {Promise<boolean>} true if connection works, false otherwise
 */
export async function testFirestoreConnection() {
  try {
    const result = await withTimeout(
      (async () => {
        try {
          // Use a non-reserved collection for the connectivity probe
          const pingRef = doc(db, 'diagnostics', '__ping__');
          // Force a server round-trip to avoid stale cache false-positives
          await getDocFromServer(pingRef);
          return true;
        } catch (err) {
          // If we reached Firestore but rules or document state prevented a read,
          // that's still considered "reachable" for connectivity purposes.
          const reachableCodes = new Set([
            'permission-denied',
            'not-found',
            'unauthenticated',
            'failed-precondition', // e.g., App Check enforced without token
            'invalid-argument', // e.g., bad path still indicates SDK reachable
          ]);
          if (err && (reachableCodes.has(err.code) || reachableCodes.has(err?.name))) {
            return true;
          }
          // As a fallback, try Firestore REST API to test reachability and rules
          try {
            const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/diagnostics/__ping__?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
            const resp = await fetch(url, { method: 'GET' });
            if (
              resp.ok ||
              resp.status === 404 || // doc missing but reachable
              resp.status === 403 || // rules block but reachable
              resp.status === 401 || // unauthorized (e.g., App Check) but reachable
              resp.status === 429 || // throttled but reachable
              (resp.status >= 500 && resp.status <= 599) // server error but reachable
            ) {
              // Treat these as connected since they prove server reachability
              return true;
            }
          } catch (restErr) {
            // eslint-disable-next-line no-console
            console.warn('Firestore REST ping failed:', restErr);
          }
          // eslint-disable-next-line no-console
          console.warn('Firestore SDK ping failed:', err && (err.code || err.name), err && err.message);
          return false;
        }
      })(),
      5000
    );
    if (result === 'Timeout') return 'timeout';
    return result ? 'connected' : 'disconnected';
  } catch (error) {
    console.error('Firestore connection error:', error);
    return 'disconnected';
  }
}

/**
 * Test Firebase Storage connection by listing root folder
 * @returns {Promise<boolean>} true if connection works, false otherwise
 */
export async function testStorageConnection() {
  try {
    const result = await withTimeout(
      (async () => {
  // Probe under the permitted files/ root per storage.rules
  const storageRef = ref(storage, 'files/');
  await list(storageRef, { maxResults: 1 });
        return true;
      })(),
      5000
    );
    if (result === 'Timeout') return 'timeout';
    return result ? 'connected' : 'disconnected';
  } catch (error) {
    console.error('Storage connection error:', error);
    return 'disconnected';
  }
}

/**
 * Diagnose Firebase connection issues
 * @returns {Promise<object>} - Results for each service
 */
export async function diagnoseFirebase() {
  const [authRes, fsRes, stRes] = await Promise.allSettled([
    testAuthConnection(),
    testFirestoreConnection(),
    testStorageConnection()
  ]);
  const unwrap = r => (r.status === 'fulfilled' ? r.value : 'disconnected');
  return {
    auth: unwrap(authRes),
    firestore: unwrap(fsRes),
    storage: unwrap(stRes)
  };
}
