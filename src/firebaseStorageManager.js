// firebaseStorageManager.js
// Module to manage connection and operations with Firebase Storage

import { storage } from './firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { db } from './firebase';
import { doc, setDoc, getDoc, updateDoc, query, collection, where, getDocs, limit } from 'firebase/firestore';

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
 * Sets tags metadata for a file in Firestore.
 * @param {string} fileId - Unique file ID or Firestore doc ID
 * @param {Object} tags - Key-value map of tags
 * @returns {Promise<void>}
 */
export async function setFileTags(fileId, tags) {
  const fileDoc = doc(db, 'files', fileId);
  await setDoc(fileDoc, { tags }, { merge: true });
}

/**
 * Gets tags metadata for a file from Firestore.
 * @param {string} fileId - Unique file ID or Firestore doc ID
 * @returns {Promise<Object>} key-value map
 */
export async function getFileTags(fileId) {
  const fileDoc = doc(db, 'files', fileId);
  const snap = await getDoc(fileDoc);
  return snap.exists() && snap.data().tags ? snap.data().tags : {};
}

/**
 * Updates tags metadata for a file in Firestore.
 * @param {string} fileId - Unique file ID or Firestore doc ID
 * @param {Object} tags - Key-value map
 * @returns {Promise<void>}
 */
export async function updateFileTags(fileId, tags) {
  const fileDoc = doc(db, 'files', fileId);
  await updateDoc(fileDoc, { tags });
}

/**
 * Resolves a file document by its Storage fullPath.
 * @param {string} fullPath
 * @returns {Promise<{id: string, data: any} | null>}
 */
export async function getFileDocByFullPath(fullPath) {
  if (!fullPath) return null;
  const q = query(collection(db, 'files'), where('fullPath', '==', fullPath), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, data: d.data() };
}

/**
 * Gets tags using a file's fullPath.
 * @param {string} fullPath
 * @returns {Promise<Object>} key-value map
 */
export async function getFileTagsByFullPath(fullPath) {
  const d = await getFileDocByFullPath(fullPath);
  if (!d) return {};
  const tags = (d.data && typeof d.data.tags === 'object' && !Array.isArray(d.data.tags)) ? d.data.tags : {};
  return tags;
}

/**
 * Updates tags using a file's fullPath.
 * @param {string} fullPath
 * @param {Object} tags - Key-value map
 */
export async function updateFileTagsByFullPath(fullPath, tags) {
  const d = await getFileDocByFullPath(fullPath);
  if (!d) throw new Error('No metadata document found for this file');
  await updateDoc(doc(db, 'files', d.id), { tags });
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
