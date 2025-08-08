// firebaseStorageManager.js
// Module to manage connection and operations with Firebase Storage

import { storage } from './firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';

/**
 * Uploads a file to a specified path in Firebase Storage.
 * @param {string} path - The storage path (e.g., 'folder/file.txt')
 * @param {File|Blob} file - The file to upload
 * @returns {Promise<string>} - Download URL of the uploaded file
 */
export async function uploadFile(path, file) {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

/**
 * Gets the download URL for a file in Firebase Storage.
 * @param {string} path - The storage path
 * @returns {Promise<string>} - Download URL
 */
export async function getFileUrl(path) {
  const storageRef = ref(storage, path);
  return await getDownloadURL(storageRef);
}

/**
 * Deletes a file from Firebase Storage.
 * @param {string} path - The storage path
 * @returns {Promise<void>}
 */
export async function deleteFile(path) {
  const storageRef = ref(storage, path);
  await deleteObject(storageRef);
}

/**
 * Lists all files and folders under a given path in Firebase Storage.
 * @param {string} path - The storage folder path
 * @returns {Promise<Array>} - List of items (files/folders)
 */
export async function listFiles(path) {
  const storageRef = ref(storage, path);
  const result = await listAll(storageRef);
  return {
    folders: result.prefixes.map(prefix => prefix.name),
    files: result.items.map(item => item.name)
  };
}
