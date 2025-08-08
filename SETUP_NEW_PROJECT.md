# New Firebase Project Setup (PNLM-RECAPP)

Your app is now configured to use environment variables for Firebase config.

## 1) Project and App
- Project ID: pnlm-recapp
- Web App: recapp-web

## 2) .env
Already created with the SDK keys from the new app. Edit as needed.

## 3) Enable backends
- Firestore: Enabled and rules deployed
- Storage: Initialized; rules deployed
- Hosting: Deployed to https://pnlm-recapp.web.app

## 4) CORS
Applied from `cors.json` to bucket `pnlm-recapp.firebasestorage.app`.

## 5) Next
- Invite users and create `users/{uid}` docs to set roles: user/admin/viewer
- Upload some files under `files/` path to see them in the UI
- Optional: App Check — set `REACT_APP_FIREBASE_APPCHECK_SITE_KEY` in `.env` and rebuild
