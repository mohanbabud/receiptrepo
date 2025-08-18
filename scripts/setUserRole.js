// Set Firebase Auth custom claims for user roles
// Usage: node setUserRole.js <uid> <role>

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const [,, uid, role] = process.argv;

if (!uid || !role) {
  console.error('Usage: node setUserRole.js <uid> <role>');
  process.exit(1);
}

admin.auth().setCustomUserClaims(uid, { role })
  .then(() => {
    console.log(`Custom claim 'role' set to '${role}' for user ${uid}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error setting custom claim:', error);
    process.exit(1);
  });
