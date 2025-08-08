# Firebase File Manager - Quick Start Script

# Set execution policy for current process only
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force

Write-Host "Firebase File Manager Setup" -ForegroundColor Green
Write-Host "==========================" -ForegroundColor Green

Write-Host "`nStep 1: Installing main dependencies..." -ForegroundColor Yellow
npm install

Write-Host "`nStep 2: Installing Functions dependencies..." -ForegroundColor Yellow
Set-Location functions
npm install
Set-Location ..

Write-Host "`nStep 3: Setup complete!" -ForegroundColor Green

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Update src/firebase.js with your Firebase configuration"
Write-Host "2. Update .firebaserc with your Firebase project ID"
Write-Host "3. Run 'firebase login' to authenticate"
Write-Host "4. Run 'firebase deploy --only firestore:rules,storage:rules' to deploy rules"
Write-Host "5. Run 'npm start' to start development server"
Write-Host "`nFor full setup instructions, see README.md"

Read-Host "`nPress Enter to continue..."
