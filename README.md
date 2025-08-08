# Firebase File Manager

A comprehensive React + Firebase application for secure file management with role-based access control, drag-and-drop upload, file preview, and admin approval system.

## Features

### 🔐 **Authentication & Authorization**
- Username/email login system
- Role-based access control (Admin, User, Viewer)
- Secure Firebase Authentication

### 📁 **File Management**
- Drag-and-drop file upload
- Folder tree navigation
- File preview (images, PDFs)
- File download functionality
- File size and type information

### 👥 **Role System**
- **Admin**: Full access - upload, delete, rename files directly, manage users, approve requests
- **User**: Can upload files, submit delete/rename requests for admin approval
- **Viewer**: Read-only access, can view and download files

### 🔄 **Request System**
- Users can submit file operation requests
- Admin approval workflow for delete/rename operations
- Request status tracking and history

### 🛠️ **Admin Panel**
- User management and role assignment
- Request approval interface
- File overview and statistics
- System monitoring

## Technology Stack

- **Frontend**: React 18, React Router, React Icons
- **Backend**: Firebase (Firestore, Storage, Functions, Authentication)
- **Styling**: CSS3 with modern design
- **Build Tool**: Create React App

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Firebase CLI (`npm install -g firebase-tools`)

### 1. Firebase Setup
1. Create a new Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Enable Authentication (Email/Password)
3. Enable Firestore Database
4. Enable Cloud Storage
5. Enable Cloud Functions

### 2. Configure Firebase
1. Update `src/firebase.js` with your Firebase configuration:
```javascript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id"
};
```

2. Update `.firebaserc` with your project ID:
```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

### 3. Install Dependencies
```bash
# Install main dependencies
npm install

# Install functions dependencies
cd functions
npm install
cd ..
```

### 4. Deploy Firebase Configuration
```bash
# Login to Firebase
firebase login

# Deploy Firestore rules and storage rules
firebase deploy --only firestore:rules,storage:rules

# Deploy Cloud Functions
firebase deploy --only functions
```

### 5. Development
```bash
# Start development server
npm start

# Or run with Firebase emulators (recommended for development)
firebase emulators:start
```

### 6. Create Admin User
After setting up, create your first admin user by:
1. Register a new account through the app
2. Manually update the user's role to 'admin' in Firestore, or
3. Use the `createAdminUser` Cloud Function

### 7. Production Deployment
```bash
# Build the project
npm run build

# Deploy to Firebase Hosting
firebase deploy
```

## 🚀 Deploying to Another Laptop

If you need to set up this project on a new laptop or share it with someone else, follow these detailed steps:

### Method 1: Git Repository Transfer (Recommended)

#### Step 1: Prepare Current Project for Git
```bash
# Navigate to your project folder
cd c:\Users\mohan\OneDrive\Desktop\firebase_file_manager

# Initialize git repository (if not already done)
git init

# Add all files
git add .

# Commit changes
git commit -m "Initial commit - Firebase File Manager"

# Create GitHub repository and push
git remote add origin https://github.com/yourusername/firebase_file_manager.git
git branch -M main
git push -u origin main
```

#### Step 2: Setup on New Laptop
```bash
# Clone the repository
git clone https://github.com/yourusername/firebase_file_manager.git
cd firebase_file_manager

# Install Node.js dependencies
npm install

# Install Firebase CLI globally
npm install -g firebase-tools

# Login to Firebase
firebase login
```

#### Step 3: Firebase Configuration on New Laptop
```bash
# Initialize Firebase in the project (optional if firebase.json exists)
firebase init

# Deploy security rules
firebase deploy --only firestore:rules,storage:rules

# Deploy functions
firebase deploy --only functions

# Start development server
npm start
```

### Method 2: Direct Project Copy

#### Step 1: Copy Project Files
1. Copy the entire `firebase_file_manager` folder to the new laptop
2. Transfer to any location (e.g., `C:\Users\[username]\Documents\firebase_file_manager`)

#### Step 2: Install Prerequisites on New Laptop
```bash
# Download and install Node.js from https://nodejs.org/
# Verify installation
node --version
npm --version

# Install Firebase CLI globally
npm install -g firebase-tools
```

#### Step 3: Setup Project Dependencies
```bash
# Navigate to project folder
cd C:\Users\[username]\Documents\firebase_file_manager

# Install main project dependencies
npm install

# Install functions dependencies
cd functions
npm install
cd ..

# Login to Firebase
firebase login
```

#### Step 4: Configure Firebase Access
```bash
# Connect to your Firebase project
firebase use your-project-id

# Deploy rules if needed
firebase deploy --only firestore:rules,storage:rules

# Start development server
npm start
```

### Important Notes for New Laptop Setup

#### 1. Firebase Configuration
- The `src/firebase.js` file contains your Firebase configuration
- This is already configured and doesn't need changes if using the same Firebase project
- Ensure the new laptop can access your Firebase project (same Google account)

#### 2. Environment Setup
- Make sure Node.js version is compatible (v14 or higher)
- Install latest version of npm or yarn
- Windows users may need to set execution policy:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

#### 3. File Exclusions (Already in .gitignore)
- `node_modules/` - Will be reinstalled via npm install
- `build/` - Generated during build process
- `.env.local` - Environment variables (if used)
- Firebase emulator cache files

### Verification Steps on New Laptop

1. **Test Development Server**
   ```bash
   npm start
   ```
   Should open http://localhost:3000

2. **Test Firebase Connection**
   - Try logging in with existing credentials
   - Upload a test file
   - Check if files appear in Firebase Console

3. **Test Admin Functions** (if you have admin access)
   - Access admin panel
   - Verify user management works
   - Test file operations

### Troubleshooting Common Issues

#### Node.js/npm Issues
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rmdir /s node_modules
npm install
```

#### Firebase Permission Issues
```bash
# Logout and login again
firebase logout
firebase login

# Check project access
firebase projects:list
```

#### Port Already in Use
```bash
# Start on different port
npm start -- --port 3001
```

#### Build Issues
```bash
# Clear cache and rebuild
npm run clean
npm run build
```

### Security Checklist for New Laptop

- [ ] Firebase CLI logged in with correct account
- [ ] Project has proper Firebase security rules deployed
- [ ] Admin access is properly configured
- [ ] Test user authentication works
- [ ] File upload/download permissions are correct
- [ ] Environment variables are configured (if any)

### Quick Start Commands for New Laptop
```bash
# Complete setup in one go
git clone <your-repo-url>
cd firebase_file_manager
npm install
npm install -g firebase-tools
firebase login
firebase use your-project-id
npm start
```

This should get your Firebase File Manager running on any new laptop with the same functionality and data access!

## Project Structure

```
firebase_file_manager/
├── public/                 # Static files
├── src/
│   ├── components/        # React components
│   │   ├── Login.js       # Authentication
│   │   ├── Dashboard.js   # Main dashboard
│   │   ├── FileUploader.js # Drag-and-drop upload
│   │   ├── FolderTree.js  # File navigation
│   │   ├── FilePreview.js # File preview modal
│   │   ├── RequestPanel.js # User requests
│   │   └── AdminPanel.js  # Admin interface
│   ├── firebase.js        # Firebase configuration
│   ├── App.js            # Main app component
│   └── index.js          # App entry point
├── functions/            # Cloud Functions
├── firestore.rules      # Database security rules
├── storage.rules        # Storage security rules
└── firebase.json        # Firebase configuration
```

## Security Features

- **Firestore Rules**: Role-based data access control
- **Storage Rules**: Secure file upload/download permissions
- **Authentication**: Required for all operations
- **Request System**: Admin approval for sensitive operations

## Usage

### For Users:
1. **Register/Login**: Create account or sign in
2. **Upload Files**: Drag and drop files or browse to select
3. **Navigate**: Use folder tree to browse files
4. **Preview**: Click files to preview (images/PDFs)
5. **Request Operations**: Submit delete/rename requests

### For Admins:
1. **Access Admin Panel**: Click "Admin Panel" in dashboard
2. **Manage Users**: Change user roles and permissions
3. **Approve Requests**: Review and approve/reject user requests
4. **Monitor System**: View file statistics and user activity

## Development

### Running with Emulators
```bash
firebase emulators:start
```
This starts local emulators for development without affecting production data.

### Building for Production
```bash
npm run build
firebase deploy
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the GitHub repository.