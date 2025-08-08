## 🚀 Firebase File Manager - Complete Setup Guide

### **Prerequisites Check**
- ✅ Node.js installed
- ✅ Project files created
- ✅ Dependencies installed (npm install completed)

### **PowerShell Execution Policy Fix**

You're encountering a PowerShell security restriction. Here are 3 solutions:

#### Option 1: Temporary Fix (Recommended)
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### Option 2: Use Command Prompt Instead
1. Press `Win + R`, type `cmd`, press Enter
2. Navigate to project: `cd "C:\Users\mohan\OneDrive\Desktop\firebase_file_manager"`
3. Run commands using `cmd` instead of PowerShell

#### Option 3: Run as Administrator
1. Right-click on PowerShell → "Run as Administrator"
2. Run: `Set-ExecutionPolicy RemoteSigned`

---

## **Step-by-Step Setup Process**

### **1. Fix PowerShell (Choose one option above)**

### **2. Install Firebase CLI**
```bash
npm install -g firebase-tools
```

### **3. Create Firebase Project**
1. Go to https://console.firebase.google.com
2. Click "Create a project"
3. Name it: `my-file-manager` (or your choice)
4. Disable Google Analytics (optional)
5. Click "Create project"

### **4. Enable Firebase Services**

#### Authentication:
1. Go to Authentication → Sign-in method
2. Enable "Email/Password"
3. Click "Save"

#### Firestore Database:
1. Go to Firestore Database
2. Click "Create database"
3. Start in "Test mode" → Next
4. Choose location → Done

#### Cloud Storage:
1. Go to Storage
2. Click "Get started"
3. Start in "Test mode" → Next
4. Choose location → Done

#### Cloud Functions (Optional):
1. Go to Functions
2. Upgrade to Blaze plan (pay-as-you-go)
3. This enables advanced features

### **5. Get Firebase Configuration**
1. Go to Project Settings (gear icon)
2. Scroll to "Your apps"
3. Click "Add app" → Web (</>) 
4. App nickname: "Firebase File Manager"
5. Don't enable Firebase Hosting yet
6. Copy the `firebaseConfig` object

### **6. Update Project Configuration**

**Update `src/firebase.js`:**
Replace the placeholder config with your actual config:
```javascript
const firebaseConfig = {
  apiKey: "your-actual-api-key",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```

**Update `.firebaserc`:**
```json
{
  "projects": {
    "default": "your-actual-project-id"
  }
}
```

### **7. Deploy Firebase Rules**
```bash
firebase login
firebase deploy --only firestore:rules,storage:rules
```

### **8. Start Development Server**
```bash
npm start
```

### **9. Test Your Application**
1. App opens at http://localhost:3000
2. Click "Need an account? Sign Up"
3. Create your first user account
4. Test file upload functionality

### **10. Create Admin User**
After creating your first user:
1. Go to Firebase Console → Firestore Database
2. Find the `users` collection
3. Find your user document
4. Edit the `role` field to `"admin"`
5. Save changes
6. Refresh your app and you'll see "Admin Panel" option

---

## **Quick Commands Reference**

```bash
# Install Firebase CLI (after fixing PowerShell)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase project (if needed)
firebase init

# Deploy security rules only
firebase deploy --only firestore:rules,storage:rules

# Start development server
npm start

# Build for production
npm run build

# Deploy everything to hosting
firebase deploy
```

---

## **Troubleshooting**

### **Common Issues:**

1. **PowerShell Execution Policy Error**
   - Use Command Prompt instead
   - Or run: `Set-ExecutionPolicy RemoteSigned`

2. **Firebase Login Issues**
   - Clear browser cache
   - Try: `firebase logout` then `firebase login`

3. **Permission Denied on File Upload**
   - Check Firebase Storage rules are deployed
   - Verify user is authenticated

4. **Can't See Admin Panel**
   - Check user role in Firestore console
   - Must be exactly `"admin"` (lowercase)

### **Need Help?**
- Check the browser console for errors (F12)
- Check Firebase console for error messages
- Verify all services are enabled in Firebase

---

**Your project is ready to go! Follow these steps and you'll have a fully functional file management system! 🎉**
