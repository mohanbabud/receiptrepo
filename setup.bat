@echo off
echo Firebase File Manager Setup
echo ========================

echo Step 1: Installing Firebase CLI globally...
npm install -g firebase-tools

echo.
echo Step 2: Setup complete!
echo.
echo Next steps:
echo 1. Create Firebase project at https://console.firebase.google.com
echo 2. Enable Authentication (Email/Password)
echo 3. Enable Firestore Database
echo 4. Enable Cloud Storage
echo 5. Get your Firebase config from Project Settings
echo 6. Update src/firebase.js with your config
echo 7. Update .firebaserc with your project ID
echo 8. Run: firebase login
echo 9. Run: firebase deploy --only firestore:rules,storage:rules
echo 10. Run: npm start
echo.
echo For detailed instructions, see COMPLETE_SETUP_GUIDE.md
pause
