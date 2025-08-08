# Firebase Setup Checklist

## 1. Firebase Console Setup
- [ ] Create Firebase project
- [ ] Enable Authentication (Email/Password method)
- [ ] Enable Firestore Database (Start in test mode for now)
- [ ] Enable Cloud Storage (Start in test mode for now)
- [ ] Enable Cloud Functions (Upgrade to Blaze plan required)

## 2. Get Firebase Configuration
- [ ] Go to Project Settings > General
- [ ] Scroll to "Your apps" section
- [ ] Click "Add app" > Web app
- [ ] Register app and copy the config object

## 3. Update Project Files
- [ ] Update src/firebase.js with your config
- [ ] Update .firebaserc with your project ID

## 4. Install Firebase CLI
- [ ] Install globally: npm install -g firebase-tools
- [ ] Login: firebase login

## 5. Deploy Security Rules
- [ ] Deploy rules: firebase deploy --only firestore:rules,storage:rules

## 6. Test the Application
- [ ] Start dev server: npm start
- [ ] Register first user
- [ ] Test file upload
- [ ] Create admin user in Firestore console
