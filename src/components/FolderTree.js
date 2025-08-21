/* eslint-disable unicode-bom */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-loop-func */
import React, { useState, useEffect, useRef, useMemo } from 'react';
// import { Link } from 'react-router-dom';
import { ref, listAll, getMetadata, uploadBytes, deleteObject, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { storage, db, auth } from '../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, addDoc, serverTimestamp, getDocs, query as fsQuery, where, arrayUnion } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import StorageTreeView from './StorageTreeView';
import { FaTrash, FaEdit, FaCopy, FaCut, FaStar, FaRegStar, FaDownload, FaEye, FaArrowUp, FaEllipsisH, FaInfoCircle, FaTag, FaCheckCircle } from 'react-icons/fa';
import { MacFolderIcon, MacFileIcon } from './icons/MacIcons';
import './FolderTree.css';

const ROOT_PATH = '/files/';
const DEFAULT_TAG_KEYS = ['ProjectName', 'Value', 'Reciepent', 'Date', 'ExpenseName'];

const FolderTree = ({ currentPath, onPathChange, refreshTrigger, userRole, onFileSelect, filesOnly = false }) => {
  // State
  // Removed Firestore-backed files/folders; relying on Storage data only
  const [, setExpandedFolders] = useState(new Set([ROOT_PATH]));
  const [fileSort, setFileSort] = useState('name');
  const [fileSortDir, setFileSortDir] = useState('asc'); // 'asc' | 'desc'
  const [fileFilter, setFileFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [filePage, setFilePage] = useState(1);
  const [pageSize, setPageSize] = useState(50); // items per page for files
  const [storageFiles, setStorageFiles] = useState([]);
  const [storageFolders, setStorageFolders] = useState(new Set());
  const [loading, setLoading] = useState(true);
  // Nested files view toggle removed from UI; keep flag constant to avoid unused setter warning
  const [includeNestedFiles] = useState(false);
  const [folderView, setFolderView] = useState('cards'); // 'cards' | 'list'
  // Map of direct counts for each folder: { [folderPath]: { files: number, subfolders: number } }
  const [folderCounts, setFolderCounts] = useState({});
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, target: null, type: null });
  const [renamingFolder, setRenamingFolder] = useState(null); // Keeping this for context
  const [renameFolderName, setRenameFolderName] = useState(''); // Keeping this for context
  const [newFolderName, setNewFolderName] = useState(''); // Keeping this for context
  const [newFolderBasePath, setNewFolderBasePath] = useState(null); // Base path for creating new folder
  const [showNewFolderInput, setShowNewFolderInput] = useState(false); // Keeping this for context
  const [showSuccessPopup, setShowSuccessPopup] = useState(false); // Keeping this for context
  const [successMessage, setSuccessMessage] = useState(''); // Keeping this for context
  const [isError, setIsError] = useState(false); // Keeping this for context
  const [selection, setSelection] = useState({ type: 'background', target: null });
  // Removed unused fileInputRef and uploading state (was causing ESLint warnings)
  const [isDragging, setIsDragging] = useState(false);
  const [compact, setCompact] = useState(false);
  const [editingFileId, setEditingFileId] = useState(null);
  const [editingName, setEditingName] = useState('');
  // Removed authUser state; rely on auth.currentUser directly
  const [authReady, setAuthReady] = useState(false);
  const [clipboard, setClipboard] = useState(null); // { action: 'copy'|'cut', itemType: 'file'|'folder', payload }
  const [moveCopyModal, setMoveCopyModal] = useState({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH, overwrite: false });
  const [moveCopyBusy, setMoveCopyBusy] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  // Labels (tags + color) and Favorites state
  const [reviewedPaths, setReviewedPaths] = useState(new Set());
  const [reviewedFileIds, setReviewedFileIds] = useState(new Set());
  const [pendingPaths, setPendingPaths] = useState(new Set());
  const [pendingFileIds, setPendingFileIds] = useState(new Set());
  const [tagPopoverFor, setTagPopoverFor] = useState(null); // file id
  const [folderLabels, setFolderLabels] = useState({}); // { [path]: { tags: string[], color: string } }
  const [favoriteFolders, setFavoriteFolders] = useState(new Set()); // Set<string>
  // Reviews: reintroduced minimal send-for-review modal
  const [reviewModal, setReviewModal] = useState({ open: false, type: null, target: null }); // type: 'file'|'folder'
  const [reviewAdmins, setReviewAdmins] = useState([]); // [{id, email, username}]
  const [reviewAssignee, setReviewAssignee] = useState(''); // admin uid
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  // Bulk review modal state
  const [bulkReviewModal, setBulkReviewModal] = useState({ open: false, fileIds: [] });
  const [bulkReviewSubmitting, setBulkReviewSubmitting] = useState(false);
  // Bulk tags modal state
  const [bulkTagsModal, setBulkTagsModal] = useState({ open: false });
  const [bulkTagsText, setBulkTagsText] = useState('');
  const [bulkTagsOverwrite, setBulkTagsOverwrite] = useState(false);
  // UI feedback states for folder navigation
  const [clickingFolder, setClickingFolder] = useState(null); // path string
  const [navigatingTo, setNavigatingTo] = useState(null); // path string
  const [labelEditor, setLabelEditor] = useState({ open: false, path: null, tagsText: '', color: '#4b5563' });
  const menuRef = useRef(null);
  const longPressRef = useRef({ timer: null, fired: false, target: null, type: null, startX: 0, startY: 0 });
  // Cache for folder listings to reduce repeat listAll calls within a short window
  const folderCacheRef = useRef(new Map()); // Map<string, { items: any[], prefixes: any[], ts: number }>
  // Token to ignore outdated loadData results when props change quickly
  const loadTokenRef = useRef(0);
  // Cache for direct counts per folder to avoid repeated listAll; separate from folderCounts state
  const countsCacheRef = useRef(new Map()); // Map<string, { files: number, subfolders: number, ts: number }>
  const [progress, setProgress] = useState({ active: false, value: 0, total: 0, label: '' });
  const [editingTagsFor, setEditingTagsFor] = useState(null); // file id
  const [tagsRows, setTagsRows] = useState([{ key: '', value: '' }]);
  const [tagsError, setTagsError] = useState('');
  // Draggable position for Edit Tags modal
  const [tagsModalPos, setTagsModalPos] = useState({ x: 24, y: 24 });
  const [tagsModalSize, setTagsModalSize] = useState({ w: 520, h: 420 });
  const tagsDragRef = useRef({ active: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
  const tagsResizeRef = useRef({ active: false, startX: 0, startY: 0, startW: 520, startH: 420 });
  // Tag search moved to dedicated page; no local state here
  const [valueSuggestIdx, setValueSuggestIdx] = useState(null); // which row's value suggestions are open
  const [savingTags, setSavingTags] = useState(false);
  // Load admins for review assignment
  useEffect(() => {
    try {
      const q = fsQuery(collection(db, 'users'), where('role', '==', 'admin'));
      const unsub = onSnapshot(q, (snap) => {
        const arr = []; snap.forEach(d => { const u = d.data() || {}; arr.push({ id: d.id, email: u.email || '', username: u.username || '' }); });
        setReviewAdmins(arr);
      });
      return () => { unsub && unsub(); };
    } catch (_) { /* ignore */ }
  }, []);
  const [moreMenu, setMoreMenu] = useState({ open: false, kind: null, target: null }); // kind: 'file' | 'folder'

  // Catalog for tag suggestions from Firestore (global)
  const [catalogKeys, setCatalogKeys] = useState([]);
  const [catalogValues, setCatalogValues] = useState({}); // { [key]: Set<string> }
  const encodeKeyId = (k) => 'key_' + encodeURIComponent(String(k || ''));

  // Suggestions built from currently loaded files' tags (plus defaults)
  const tagKeySuggestions = useMemo(() => {
    const s = new Set([...DEFAULT_TAG_KEYS, ...catalogKeys]);
    try {
      (storageFiles || []).forEach(f => {
        const t = f && f.tags;
        if (t && typeof t === 'object') {
          Object.keys(t).forEach(k => { if (k) s.add(String(k)); });
        }
      });
    } catch { /* noop */ }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [storageFiles, catalogKeys]);
  const tagValueSuggestionsByKey = useMemo(() => {
    const m = new Map();
    try {
      (storageFiles || []).forEach(f => {
        const t = f && f.tags;
        if (!t || typeof t !== 'object') return;
        Object.entries(t).forEach(([k, v]) => {
          if (!k) return;
          const val = String(v ?? '');
          if (val === '') return;
          if (!m.has(k)) m.set(k, new Set());
          m.get(k).add(val);
        });
      });
    } catch { /* noop */ }
    try {
      Object.entries(catalogValues || {}).forEach(([k, setVals]) => {
        if (!m.has(k)) m.set(k, new Set());
        (setVals instanceof Set ? Array.from(setVals) : []).forEach(v => m.get(k).add(String(v)));
      });
    } catch { /* noop */ }
    return m;
  }, [storageFiles, catalogValues]);

  // Auto-close success popup after a short delay (2s for success, 5s for errors)
  useEffect(() => {
    if (!showSuccessPopup) return;
    const delay = isError ? 5000 : 2000;
    const t = setTimeout(() => setShowSuccessPopup(false), delay);
    return () => clearTimeout(t);
  }, [showSuccessPopup, isError]);

  // Global mouse listeners for dragging the Edit Tags modal
  useEffect(() => {
    const onMove = (e) => {
      if (tagsResizeRef.current.active) {
        const dx = e.clientX - tagsResizeRef.current.startX;
        const dy = e.clientY - tagsResizeRef.current.startY;
        const minW = 360, minH = 260, margin = 8;
        const maxW = Math.max(minW, (window.innerWidth || 0) - tagsModalPos.x - margin);
        const maxH = Math.max(minH, (window.innerHeight || 0) - tagsModalPos.y - margin);
        let nw = Math.min(Math.max(minW, tagsResizeRef.current.startW + dx), maxW);
        let nh = Math.min(Math.max(minH, tagsResizeRef.current.startH + dy), maxH);
        setTagsModalSize({ w: nw, h: nh });
        return;
      }
      if (tagsDragRef.current.active) {
        const dx = e.clientX - tagsDragRef.current.startX;
        const dy = e.clientY - tagsDragRef.current.startY;
        let nx = tagsDragRef.current.offsetX + dx;
        let ny = tagsDragRef.current.offsetY + dy;
        // Clamp within viewport bounds (leave small margins)
        const margin = 8;
        const maxX = Math.max(0, (window.innerWidth || 0) - tagsModalSize.w - margin);
        const maxY = Math.max(0, (window.innerHeight || 0) - tagsModalSize.h - margin);
        nx = Math.min(Math.max(margin, nx), maxX);
        ny = Math.min(Math.max(margin, ny), maxY);
        setTagsModalPos({ x: nx, y: ny });
      }
    };
    const onUp = () => {
      tagsDragRef.current.active = false;
      tagsResizeRef.current.active = false;
      try { document.body.style.userSelect = ''; document.body.style.cursor = ''; } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [tagsModalSize, tagsModalPos]);

  // Load global Tags Catalog (keys and values) for suggestions
  useEffect(() => {
    // Wait for auth to be initialized to avoid permission errors before sign-in
    if (!authReady) return;
    let unsubscribes = [];
    try {
      const keysUnsub = onSnapshot(collection(db, 'tags_catalog'), (snap) => {
        const keys = [];
        const valMap = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          const key = data.key || data.id || d.id;
          if (!key) return;
          keys.push(String(key));
          const vals = Array.isArray(data.values) ? data.values : [];
          valMap[String(key)] = new Set(vals.map(v => String(v)));
        });
        setCatalogKeys(keys.sort((a,b) => a.localeCompare(b)));
        setCatalogValues(valMap);
      });
      unsubscribes.push(keysUnsub);
    } catch (_) { /* ignore */ }
    return () => { try { unsubscribes.forEach(u => u && u()); } catch {} };
  }, [authReady]);
  // Receive external events to refresh the current folder (e.g., after optimization/resync)
  useEffect(() => {
    const handler = (e) => {
      try {
        const safe = normalizeFolderPath(currentPath || ROOT_PATH);
        const detail = (e && e.detail) || {};
        const pfx = String(detail.prefix || '').replace(/\\/g,'/');
        // If the event's prefix overlaps current path, refresh; otherwise do a light touch anyway
        const shouldReload = !pfx || safe.startsWith('/' + pfx) || ('/' + pfx).startsWith(safe);
        // Invalidate caches for the current path
        folderCacheRef.current.delete(safe);
        countsCacheRef.current.delete(safe);
        if (shouldReload) {
          loadData();
        }
      } catch (_) {
        // Fallback: best-effort reload
        loadData();
      }
    };
    window.addEventListener('storage-meta-refresh', handler);
    return () => window.removeEventListener('storage-meta-refresh', handler);
    // Intentionally exclude loadData (stable ref in this module)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const openContextMenuAt = (x, y, target, type) => {
    setContextMenu({ visible: true, x, y, target, type });
    setSelection({ type, target });
  };

  const startLongPress = (e, target, type) => {
    if (!e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    const lp = longPressRef.current;
    clearTimeout(lp.timer);
    lp.fired = false;
    lp.target = target;
    lp.type = type;
    lp.startX = x;
    lp.startY = y;
    lp.timer = setTimeout(() => {
      lp.fired = true;
      openContextMenuAt(x, y, target, type);
    }, 550);
  };

  const moveLongPress = (e) => {
    const lp = longPressRef.current;
    if (!lp.timer || !e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - lp.startX);
    const dy = Math.abs(touch.clientY - lp.startY);
    if (dx > 10 || dy > 10) {
      clearTimeout(lp.timer);
      lp.timer = null;
    }
  };

  const endLongPress = () => {
    const lp = longPressRef.current;
    if (lp.timer) {
      clearTimeout(lp.timer);
      lp.timer = null;
    }
    // If a long-press fired, suppress the immediate click that follows
    setTimeout(() => { lp.fired = false; }, 0);
  };

  // Utility: create .keep files in all empty subfolders under the current folder (deprecated; button hidden)
  // Keeping for reference but not used to avoid ESLint warning
  /* const createKeepFilesInEmptyFolders = async () => {
    try {
      const safe = normalizeFolderPath(currentPath || ROOT_PATH);
      const folderRef = ref(storage, safe.replace(/^\/+/, ''));
      const result = await listAll(folderRef);
      for (const prefix of result.prefixes) {
        const subRef = ref(storage, prefix.fullPath);
        const subResult = await listAll(subRef);
        if (subResult.items.length === 0) {
          const keepRef = ref(storage, `${prefix.fullPath}/.keep`);
          await uploadBytes(keepRef, new Uint8Array());
        }
      }
      await loadData();
      setIsError(false);
      setSuccessMessage('Added .keep files to all empty subfolders.');
      setShowSuccessPopup(true);
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Failed to add .keep files.');
      setShowSuccessPopup(true);
    }
  }; */

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authReady) return;
    loadData();
  }, [currentPath, refreshTrigger, includeNestedFiles, authReady]);

  // Global keydown shortcuts handler wiring
  useEffect(() => {
    const fn = (e) => { try { handleKeyDown(e); } catch {} };
    window.addEventListener('keydown', fn, { passive: false });
    return () => { window.removeEventListener('keydown', fn); };
    // Intentionally not including handleKeyDown to avoid re-binding on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for success messages dispatched from components like FilePreview
  useEffect(() => {
    const onSuccess = (e) => {
      const msg = (e && e.detail && e.detail.message) ? String(e.detail.message) : 'Action completed';
      setIsError(false);
      setSuccessMessage(msg);
      setShowSuccessPopup(true);
    };
    window.addEventListener('file-action-success', onSuccess);
    return () => window.removeEventListener('file-action-success', onSuccess);
  }, []);


  // Close the compact More menu on outside click (but keep it open when clicking inside)
  useEffect(() => {
    if (!moreMenu.open) return;
    const onDoc = (e) => {
      const insideInlineMenu = !!(e.target && e.target.closest && e.target.closest('.inline-menu'));
      if (!insideInlineMenu) setMoreMenu({ open: false, kind: null, target: null });
    };
    // Use bubble phase so stopPropagation on the menu can prevent this
    document.addEventListener('click', onDoc, false);
    return () => document.removeEventListener('click', onDoc, false);
  }, [moreMenu.open]);

  // Reviews: removed (send/assign/mark-reviewed)

  // Subscribe to Firestore metadata for labels and per-user favorites
  useEffect(() => {
    // Folder labels (global)
  const unsubLabels = onSnapshot(collection(db, 'folders_meta'), (snap) => {
      const map = {};
      snap.forEach((d) => {
        const data = d.data() || {};
    if (data.path) map[data.path] = { tags: Array.isArray(data.tags) ? data.tags : [], color: data.color || '#4b5563', pendingReviewFor: Array.isArray(data.pendingReviewFor) ? data.pendingReviewFor : [] };
      });
      setFolderLabels(map);
    }, (err) => console.warn('folders_meta listener error', err));

    // Favorites (per-user)
  let unsubFav = null;
  const unsubAuth = onAuthStateChanged(auth, (u) => {
      setAuthReady(true);
      if (unsubFav) { try { unsubFav(); } catch {} finally { unsubFav = null; } }
      
      if (!u) {
        setFavoriteFolders(new Set());
        return;
      }
      unsubFav = onSnapshot(collection(db, 'users', u.uid, 'favorites'), (snap) => {
        const set = new Set();
        snap.forEach((d) => {
          const data = d.data() || {};
          if ((data.kind || 'folder') === 'folder' && data.path) set.add(data.path);
        });
        setFavoriteFolders(set);
      }, (err) => console.warn('favorites listener error', err));

    });

    return () => {
  try { unsubLabels(); } catch {}
  try { unsubFav && unsubFav(); } catch {}
      try { unsubAuth(); } catch {}
    };
  }, []);
  // Reset page when filters, sort, or path changes
  useEffect(() => {
    setFilePage(1);
  }, [fileFilter, fileSort, currentPath, storageFiles.length]);

  // Clear filters and selection when navigating to a different folder
  useEffect(() => {
    setFileFilter('');
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    setFilePage(1);
  }, [currentPath]);

  // Clear navigating indicator when loading finishes
  useEffect(() => {
    if (!loading) {
      setNavigatingTo(null);
    }
  }, [loading]);

  // Ensure ancestors of the current path are expanded so the view reflects the selection
  useEffect(() => {
    const safe = normalizeFolderPath(currentPath || ROOT_PATH);
    const parts = safe.replace(/^\/+|\/+$/g, '').split('/'); // e.g., ['files','A','B']
    let acc = '/';
    const toExpand = new Set([ROOT_PATH]);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      if (p === 'files') { acc = ROOT_PATH; toExpand.add(ROOT_PATH); continue; }
      acc = acc + p + '/';
      toExpand.add(acc);
    }
    setExpandedFolders(prev => new Set([...(prev || []), ...toExpand]));
  }, [currentPath]);

  // Load current folder from Storage (no recursion, minimal metadata)
  // Retryable wrapper to mitigate early unauthorized/app-check timing
  // Listen for reviewed files to show green tick badge
  useEffect(() => {
    try {
      const q = fsQuery(collection(db, 'reviews'), where('status', '==', 'reviewed'));
      const unsub = onSnapshot(q, (snap) => {
        const pathSet = new Set();
        const idSet = new Set();
        snap.forEach((d) => {
          const r = d.data();
          if (r?.targetType === 'file') {
            if (r.fullPath) pathSet.add(r.fullPath);
            if (r.fileId) idSet.add(r.fileId);
          }
        });
        setReviewedPaths(pathSet);
        setReviewedFileIds(idSet);
      });
      return () => { try { unsub(); } catch {} };
    } catch {}
  }, []);

  // Close tags popover on outside click or Escape
  useEffect(() => {
    if (!tagPopoverFor) return;
    const onDocMouseDown = (e) => {
      const el = e.target;
      const inPopover = el && (el.closest && (el.closest('.tag-popover') || el.closest('.tags-button')));
      if (!inPopover) setTagPopoverFor(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setTagPopoverFor(null); };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      try { document.removeEventListener('mousedown', onDocMouseDown, true); } catch {}
      try { document.removeEventListener('keydown', onKey, true); } catch {}
    };
  }, [tagPopoverFor]);

  // Listen for pending files to show orange tick
  useEffect(() => {
    try {
      const q = fsQuery(collection(db, 'reviews'), where('status', '==', 'pending'));
      const unsub = onSnapshot(q, (snap) => {
        const pathSet = new Set();
        const idSet = new Set();
        snap.forEach((d) => {
          const r = d.data();
          if (r?.targetType === 'file') {
            if (r.fullPath) pathSet.add(r.fullPath);
            if (r.fileId) idSet.add(r.fileId);
          }
        });
        setPendingPaths(pathSet);
        setPendingFileIds(idSet);
      });
      return () => { try { unsub(); } catch {} };
    } catch {}
  }, []);

  // Close any open tags UI when preview closes
  useEffect(() => {
    const handler = () => {
      try { setTagPopoverFor(null); } catch {}
      try { setEditingTagsFor(null); } catch {}
    };
    window.addEventListener('close-tags-pane', handler);
    return () => window.removeEventListener('close-tags-pane', handler);
  }, []);
  const safeGetMetadata = async (storageRef, retries = 1) => {
    try {
      return await getMetadata(storageRef);
    } catch (e) {
      const code = e && e.code ? String(e.code) : '';
      if (retries > 0 && (code === 'storage/unauthorized' || code === 'storage/unknown')) {
        await new Promise(r => setTimeout(r, 600));
        return safeGetMetadata(storageRef, retries - 1);
      }
      throw e;
    }
  };
  // Helper: fallback to fetch size via HEAD on the download URL (reads Content-Length)
  const fetchSizeViaHead = async (storageRef) => {
    try {
      const url = await getDownloadURL(storageRef);
      const res = await fetch(url, { method: 'HEAD' });
      const len = res.headers.get('content-length') || res.headers.get('Content-Length');
      const parsed = len ? parseInt(len, 10) : NaN;
      return Number.isFinite(parsed) ? parsed : undefined;
    } catch (_) {
      return undefined;
    }
  };

  const loadData = async () => {
    setLoading(true);
    // Declare token in outer scope so it's visible to finally
    let myToken;
    try {
      const safe = normalizeFolderPath(currentPath || ROOT_PATH);
      const storagePath = safe.replace(/^\/+/, '').replace(/\/+$/, ''); // files/... (no leading/trailing slash)
      const folderRef = ref(storage, storagePath);
      const folderSet = new Set([ROOT_PATH, safe]);
      const fileList = [];
      const counts = {}; // will populate direct counts per folder
      myToken = ++loadTokenRef.current;
      if (!includeNestedFiles) {
        // Shallow listing: only direct subfolders and files
        // Use cached result if fresh (<= 30s)
        let result;
        const cacheKey = safe;
        const cached = folderCacheRef.current.get(cacheKey);
        const now = Date.now();
        if (cached && now - cached.ts <= 30_000) {
          result = cached;
        } else {
          const fresh = await listAll(folderRef);
          result = { items: fresh.items, prefixes: fresh.prefixes, ts: now };
          folderCacheRef.current.set(cacheKey, result);
        }
        // Count for current folder itself
        counts[safe] = {
          files: result.items.length,
          subfolders: result.prefixes.length
        };
        for (const prefix of result.prefixes) {
          const subFolderPath = safe + prefix.name + '/';
          folderSet.add(subFolderPath);
          // Don't count subfolder contents here; defer for visibility to avoid N+1 listAll
        }
        // Do not prefetch metadata to keep initial load fast; build minimal entries
        for (const item of result.items) {
          const filePath = safe; // direct files
          fileList.push({ id: item.fullPath, name: item.name, path: filePath, ref: item, isStorageFile: true });
        }
      } else {
        // Deep listing: include files in all nested subfolders
        const walk = async (baseSafe, baseRef) => {
          const res = await listAll(baseRef);
          // Files in this folder
          for (const item of res.items) {
            // Compute file's parent folder path in '/files/.../' form
            const full = item.fullPath; // 'files/.../name'
            const parent = '/' + full.substring(0, full.lastIndexOf('/') + 1); // '/files/.../'
            fileList.push({ id: item.fullPath, name: item.name, path: parent, ref: item, isStorageFile: true });
          }
          // Recurse into subfolders
          for (const prefix of res.prefixes) {
            const subSafe = baseSafe + prefix.name + '/';
            folderSet.add(subSafe);
            await walk(subSafe, prefix);
          }
        };
        await walk(safe, folderRef);

        // Build direct counts from the aggregated sets
        // Initialize counts for every folder we know
        for (const fp of folderSet) {
          if (!counts[fp]) counts[fp] = { files: 0, subfolders: 0 };
        }
        // Count files per parent
        for (const f of fileList) {
          const parent = f.path;
          if (!counts[parent]) counts[parent] = { files: 0, subfolders: 0 };
          counts[parent].files += 1;
        }
        // Count direct subfolders per parent
        for (const fp of folderSet) {
          if (fp === ROOT_PATH) continue;
          const parent = fp.replace(/[^/]+\/$/, '');
          if (!counts[parent]) counts[parent] = { files: 0, subfolders: 0 };
          counts[parent].subfolders += 1;
        }
      }

  // If another load started while awaiting, ignore stale results
      if (myToken !== loadTokenRef.current) return;
      // Replace folder entries under the current path to avoid stale names in cards view
      setStorageFolders(prev => {
        const next = new Set([...(prev || [])]);
        try {
          for (const fp of Array.from(next)) {
            if (fp.startsWith(safe)) next.delete(fp);
          }
        } catch (_) {}
        for (const fp of folderSet) next.add(fp);
        return next;
      });
      setStorageFiles(fileList);
      setFolderCounts(counts);

      // After load, if any files are missing size, fill sizes in the background for a limited batch.
      try {
    const missingAll = fileList.filter(f => typeof f.size !== 'number' && f?.ref);
        const missing = missingAll.slice(0, 100);
        if (missing.length) {
          const CONC = 6;
          let idx2 = 0;
          const runners = Array(Math.min(CONC, missing.length)).fill(0).map(async () => {
            while (idx2 < missing.length) {
              const j = idx2++;
              const f = missing[j];
              let sz;
              try {
                const m = await safeGetMetadata(f.ref, 1);
                sz = typeof m?.size === 'number' ? m.size : undefined;
              } catch (_) {
                sz = await fetchSizeViaHead(f.ref);
              }
              if (typeof sz === 'number') {
                setStorageFiles(prev => prev.map(x => x.id === f.id ? { ...x, size: sz } : x));
              }
            }
          });
          Promise.all(runners).catch(() => {});
        }
      } catch (_) { /* ignore */ }

      // Firestore fallback: try to map sizes from 'files' metadata docs by fullPath
      try {
        const unknown = fileList.filter(f => typeof f.size !== 'number' && f?.ref?.fullPath).slice(0, 60);
        if (unknown.length) {
          const byPath = new Map();
          const paths = unknown.map(f => f.ref.fullPath);
          // chunk in batches of 10 (Firestore 'in' limit)
          const batches = [];
          for (let i = 0; i < paths.length; i += 10) {
            const chunk = paths.slice(i, i + 10);
            batches.push(fsQuery(collection(db, 'files'), where('fullPath', 'in', chunk)));
          }
          const snaps = await Promise.all(batches.map(q => getDocs(q)));
          for (const snap of snaps) {
            snap.forEach(d => {
              const data = d.data() || {};
              if (data.fullPath) byPath.set(data.fullPath, data);
            });
          }
          if (byPath.size) {
            setStorageFiles(prev => prev.map(x => {
              if (typeof x.size === 'number') return x;
              const fp = x?.ref?.fullPath;
              if (fp && byPath.has(fp)) {
                const meta = byPath.get(fp);
                return { ...x, size: typeof meta.size === 'number' ? meta.size : x.size, type: meta.type || x.type };
              }
              return x;
            }));
          }
        }
      } catch (_) { /* ignore */ }
    } catch (error) {
      console.error('Error loading current folder:', error);
    } finally {
      // Only clear loading for the most recent load invocation
      if (myToken === loadTokenRef.current) setLoading(false);
    }
  };
  // Ensure current folder's direct counts are prefetched when path changes
  useEffect(() => {
    const safe = normalizeFolderPath(currentPath || ROOT_PATH);
    fetchDirectCounts(safe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  // Helper to fetch and cache direct counts for a specific folder path
  const fetchDirectCounts = async (folderPath) => {
    try {
      const key = normalizeFolderPath(folderPath);
      // If already in state with numbers, skip
      const existing = folderCounts[key];
      if (existing && typeof existing.files === 'number' && typeof existing.subfolders === 'number') return existing;
      // Use cache if fresh (<= 60s)
      const cached = countsCacheRef.current.get(key);
      const now = Date.now();
      if (cached && now - cached.ts <= 60_000) {
        setFolderCounts(prev => ({ ...prev, [key]: { files: cached.files, subfolders: cached.subfolders } }));
        return cached;
      }
      const folderRef = ref(storage, key.replace(/^\/+/, ''));
      const res = await listAll(folderRef);
      const data = { files: res.items.length, subfolders: res.prefixes.length, ts: now };
      countsCacheRef.current.set(key, data);
      setFolderCounts(prev => ({ ...prev, [key]: { files: data.files, subfolders: data.subfolders } }));
      return data;
    } catch (_) {
      // Ignore errors; leave counts unknown
      return null;
    }
  };

  // Prefetch counts for the first few immediate subfolders in the current folder to avoid showing 0
  useEffect(() => {
    const safe = normalizeFolderPath(currentPath || ROOT_PATH);
    if (includeNestedFiles) return;
    const all = Array.from(storageFolders).filter(fp => fp.startsWith(safe) && fp !== safe && fp.substring(safe.length).split('/').filter(Boolean).length === 1);
    if (all.length === 0) return;
    let cancelled = false;
    (async () => {
      const first = all.slice(0, 12);
      for (const fp of first) {
        if (cancelled) break;
        await fetchDirectCounts(fp);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, includeNestedFiles, storageFolders]);

  // Prefetch metadata lazily for currently visible page items to improve UX without blocking initial load
  useEffect(() => {
    const safe = normalizeFolderPath(currentPath || ROOT_PATH);
    // Only for shallow view; deep can be large
    if (includeNestedFiles) return;
    // Compute current page items similar to renderFilesForPath pagination
    let files = storageFiles.filter(f => f.path === safe && f.name !== '.keep' && f.name !== '.folder-placeholder');
    if (fileFilter) files = files.filter(f => f.name.toLowerCase().includes(fileFilter.toLowerCase()));
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    files = files.sort((a, b) => {
      let cmp = 0;
      if (fileSort === 'name') cmp = collator.compare(a.name || '', b.name || '');
      else if (fileSort === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (fileSort === 'type') cmp = collator.compare(a.type || '', b.type || '');
      return fileSortDir === 'asc' ? cmp : -cmp;
    });
    const start = (filePage - 1) * pageSize;
    const pageItems = files.slice(start, start + pageSize);
    // Fetch a few at a time
    let cancelled = false;
    const fetchOne = async (f) => { if (!cancelled) await ensureFileMeta(f); };
    (async () => {
      const BATCH = 4;
      const slice = pageItems.filter(f => typeof f.size !== 'number').slice(0, 24);
      for (let i = 0; i < slice.length; i += BATCH) {
        const chunk = slice.slice(i, i + BATCH);
        await Promise.all(chunk.map(fetchOne));
        if (cancelled) break;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageFiles, filePage, pageSize, fileFilter, fileSort, fileSortDir, includeNestedFiles, currentPath]);

  // Prefetch Firestore file docs (tags & owner) for visible page items
  useEffect(() => {
    const safe = normalizeFolderPath(currentPath || ROOT_PATH);
    if (includeNestedFiles) return;
    // Recompute page items similar to renderFilesForPath
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    let files = storageFiles.filter(f => f.path === safe && f.name !== '.keep' && f.name !== '.folder-placeholder');
    if (fileFilter) files = files.filter(f => f.name.toLowerCase().includes(fileFilter.toLowerCase()));
    files = files.sort((a, b) => {
      let cmp = 0;
      if (fileSort === 'name') cmp = collator.compare(a.name || '', b.name || '');
      else if (fileSort === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (fileSort === 'type') cmp = collator.compare(a.type || '', b.type || '');
      else if (fileSort === 'modified') {
        const da = a.uploadedAt instanceof Date ? a.uploadedAt.getTime() : 0;
        const db = b.uploadedAt instanceof Date ? b.uploadedAt.getTime() : 0;
        cmp = da - db;
      }
      return fileSortDir === 'asc' ? cmp : -cmp;
    });
    const start = (filePage - 1) * pageSize;
    const pageItems = files.slice(start, start + pageSize);
  const need = pageItems.filter(f => f?.ref?.fullPath && (typeof f.tags === 'undefined' || typeof f.ownerUid === 'undefined'));
    if (need.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const paths = need.map(f => f.ref.fullPath).slice(0, 60);
        const batches = [];
        for (let i = 0; i < paths.length; i += 10) {
          const chunk = paths.slice(i, i + 10);
          batches.push(fsQuery(collection(db, 'files'), where('fullPath', 'in', chunk)));
        }
        const snaps = await Promise.all(batches.map(q => getDocs(q)));
        if (cancelled) return;
        const byPath = new Map();
        for (const snap of snaps) {
          snap.forEach(d => { const data = d.data() || {}; if (data.fullPath) byPath.set(data.fullPath, data); });
        }
        if (byPath.size) {
          setStorageFiles(prev => prev.map(x => {
            const fp = x?.ref?.fullPath;
            if (!fp || !byPath.has(fp)) return x;
            const meta = byPath.get(fp);
            return { ...x, tags: (meta.tags && typeof meta.tags === 'object') ? meta.tags : x.tags, ownerUid: meta.uploadedByUid || x.ownerUid };
          }));
        }
      } catch (_) { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageFiles, filePage, pageSize, fileFilter, fileSort, fileSortDir, includeNestedFiles, currentPath]);

  // UI helpers
  const formatFileSize = (bytes) => {
    if (typeof bytes !== 'number') return 'Unknown';
    if (bytes === 0) return '0 Bytes';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
    return `${rounded} ${sizes[i]}`;
  };

  // Lazily ensure metadata for a specific file (size/type) if missing
  const ensureFileMeta = async (fileItem) => {
    try {
      if (!fileItem?.ref || typeof fileItem.size === 'number') return;
      let meta = null;
  try { meta = await safeGetMetadata(fileItem.ref, 1); } catch (_) { meta = null; }
      if (meta) {
        setStorageFiles(prev => prev.map(f => {
          if (f.id !== fileItem.id) return f;
          return {
            ...f,
            size: typeof meta?.size === 'number' ? meta.size : f.size,
            type: meta?.contentType || f.type,
            uploadedAt: meta?.updated ? new Date(meta.updated) : f.uploadedAt,
          };
        }));
        return;
      }
      // Fallback to HEAD if metadata blocked
      const sz = await fetchSizeViaHead(fileItem.ref);
      if (typeof sz === 'number') {
        setStorageFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, size: sz } : f));
      }
    } catch (_) {
      // ignore
    }
  };

  // Tag Search moved to dedicated page; all related logic removed from this component.

  const getFileIcon = (fileName, fileType) => {
  if (fileType?.startsWith('image/')) return <MacFileIcon type="image" className="file-icon image" />;
  if (fileType?.startsWith('video/')) return <MacFileIcon type="video" className="file-icon video" />;
  if (fileType?.startsWith('audio/')) return <MacFileIcon type="audio" className="file-icon audio" />;
  if (fileType === 'application/pdf') return <MacFileIcon type="pdf" className="file-icon pdf" />;
  return <MacFileIcon className="file-icon document" />;
  };

  // toggleFolder removed (UI no longer renders a recursive left tree inside this component)

  // Context menu logic
  const handleContextMenu = (e, target, type) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, target, type });
  setSelection({ type, target });
  };

  // Confirm helpers
  // For normal users: request deletion instead of direct delete
  const requestDelete = async (target, targetType /* 'file' | 'folder' */) => {
    try {
      const user = auth.currentUser;
      if (!user) { alert('Sign in required.'); return; }
      // Normalize payload for existing Admin/Request panels (collection: 'requests')
      // Expect fields: type: 'delete', path, fileName (optional), targetType: 'file'|'folder'
      const path = targetType === 'file' ? (target?.id || target?.ref?.fullPath || '') : String(target || '');
      const fileName = targetType === 'file'
        ? (target?.name || (path.split('/').pop() || ''))
        : (String(path).split('/').filter(Boolean).pop() || '');
      const req = {
        type: 'delete',
        targetType: targetType,
        path,
        fileName,
        requestedBy: user.uid,
        requestedEmail: user.email,
        requestedAt: serverTimestamp(),
        status: 'pending',
      };
      await addDoc(collection(db, 'requests'), req);
  setIsError(false);
  setSuccessMessage('Delete request submitted for admin review.');
  setShowSuccessPopup(true);
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Error submitting delete request.');
      setShowSuccessPopup(true);
    }
  };
  const confirmAndDeleteFolder = async (folderPath) => {
    if (userRole !== 'admin') {
      await requestDelete(folderPath, 'folder');
      return;
    }
    if (!folderPath) return;
    const name = String(folderPath).split('/').filter(Boolean).pop() || 'this folder';
    const ok = window.confirm(`Delete "${name}" and all its contents? This cannot be undone.`);
    if (!ok) return;
    await handleDeleteFolder(folderPath);
  };
  const confirmAndDeleteFile = async (fileItem) => {
    if (userRole !== 'admin') {
      await requestDelete(fileItem, 'file');
      return;
    }
    if (!fileItem) return;
    const name = fileItem?.name || 'this file';
    const ok = window.confirm(`Delete "${name}"? This cannot be undone.`);
    if (!ok) return;
    await handleDeleteFile(fileItem);
  };
  const confirmAndDeleteSelection = async (files, folders) => {
    const fc = (files?.length || 0);
    const dc = (folders?.length || 0);
    if (fc + dc === 0) return false;
    return window.confirm(`Permanently delete ${fc} file(s) and ${dc} folder(s)? This cannot be undone.`);
  };
  const hideContextMenu = () => setContextMenu({ visible: false, x: 0, y: 0, target: null, type: null });
  const toggleSelectFile = (fileItem) => {
    if (!fileItem?.id) return;
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileItem.id)) next.delete(fileItem.id); else next.add(fileItem.id);
      return next;
    });
  };
  const toggleSelectFolder = (folderPath) => {
    if (!folderPath) return;
    setSelectedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath); else next.add(folderPath);
      return next;
    });
  };
  const clearSelection = () => { setSelectedFiles(new Set()); setSelectedFolders(new Set()); };

  // Close context menu on outside click, Escape, scroll, or resize
  useEffect(() => {
    const onDocMouseDown = (ev) => {
      if (!contextMenu.visible) return;
      const el = menuRef.current;
      if (el && !el.contains(ev.target)) hideContextMenu();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') hideContextMenu();
    };
    const onDismiss = () => {
      if (contextMenu.visible) hideContextMenu();
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss, true);
    };
  }, [contextMenu.visible]);
  // eslint-disable-next-line no-unused-vars
  const openBulkModal = (mode) => {
    const files = storageFiles.filter(f => selectedFiles.has(f.id));
    const folders = Array.from(selectedFolders);
    if (files.length === 0 && folders.length === 0) return;
    setMoveCopyModal({ open: true, mode, itemType: 'bulk', target: { files, folders }, dest: normalizeFolderPath(currentPath || ROOT_PATH), overwrite: false });
  };
  // eslint-disable-next-line no-unused-vars
  const handleBulkDelete = async () => {
  if (userRole !== 'admin') { alert('Only admin can delete directly. Non-admins can submit delete requests.'); return; }
    const files = storageFiles.filter(f => selectedFiles.has(f.id));
    const folders = Array.from(selectedFolders);
    if (files.length === 0 && folders.length === 0) return;
    const ok = await confirmAndDeleteSelection(files, folders);
    if (!ok) return;
    try {
      // Delete files
      for (const f of files) {
        try { await deleteObject(f.ref); } catch (e) { console.warn('Failed to delete file', f.id, e); }
      }
      // Delete folders
      for (const p of folders) {
        try { await handleDeleteFolder(p); } catch (e) { console.warn('Failed to delete folder', p, e); }
      }
      clearSelection();
      await loadData();
  setIsError(false);
  setSuccessMessage(`Deleted ${files.length} file(s) and ${folders.length} folder(s).`);
  setShowSuccessPopup(true);
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Bulk delete encountered errors.');
      setShowSuccessPopup(true);
    }
  };

  // For non-admins: submit delete requests for selection
  const handleBulkDeleteOrRequest = async () => {
    const files = storageFiles.filter(f => selectedFiles.has(f.id));
    const folders = Array.from(selectedFolders);
    if (files.length === 0 && folders.length === 0) return;
    if (userRole === 'admin') {
      await handleBulkDelete();
      return;
    }
    try {
      const tasks = [];
      for (const f of files) tasks.push(requestDelete(f, 'file'));
      for (const p of folders) tasks.push(requestDelete(p, 'folder'));
      await Promise.allSettled(tasks);
      clearSelection();
      setIsError(false);
      setSuccessMessage('Delete requests submitted for admin review.');
      setShowSuccessPopup(true);
    } catch (_) {
      setIsError(true);
      setSuccessMessage('Some delete requests may have failed.');
      setShowSuccessPopup(true);
    }
  };
  const handleMenuAction = async (action) => {
    try {
      if (contextMenu.type === 'folder') {
        const folderPath = contextMenu.target;
        if (action === 'rename') {
          setRenamingFolder(folderPath);
          setRenameFolderName(folderPath.split('/').filter(Boolean).pop());
        } else if (action === 'create-folder') {
          setNewFolderBasePath(normalizeFolderPath(folderPath));
          setShowNewFolderInput(true);
        } else if (action === 'create-file') {
          await handleNewFile(folderPath);
        } else if (action === 'delete') {
          // Route through confirm helper which handles admin vs. user (request-delete) logic
          await confirmAndDeleteFolder(folderPath);
        } else if (action === 'copy') {
          setMoveCopyModal({ open: true, mode: 'copy', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'move') {
          setMoveCopyModal({ open: true, mode: 'move', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'details') {
          await showFolderDetails(folderPath);
        } else if (action === 'download') {
          await downloadFolderAsZip(folderPath);
        } else if (action === 'favorite') {
          await toggleFavorite(folderPath);
        } else if (action === 'labels') {
          openLabelEditor(folderPath);
        }
      } else if (contextMenu.type === 'file') {
        const fileItem = contextMenu.target; // storageFiles entry
        if (!fileItem) return;
        if (action === 'rename') {
          await handleRenameFile(fileItem);
        } else if (action === 'delete') {
          // Route through confirm helper which handles admin vs. user (request-delete) logic
          await confirmAndDeleteFile(fileItem);
        } else if (action === 'copy') {
          setMoveCopyModal({ open: true, mode: 'copy', itemType: 'file', target: fileItem, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'move') {
          setMoveCopyModal({ open: true, mode: 'move', itemType: 'file', target: fileItem, dest: normalizeFolderPath(currentPath || ROOT_PATH) });
        } else if (action === 'details') {
          showFileDetails(fileItem);
        } else if (action === 'create-file') {
          await handleNewFile(currentPath);
        } else if (action === 'create-folder') {
          setShowNewFolderInput(true);
        } else if (action === 'download') {
          await downloadSingleFile(fileItem);
        }
      } else if (contextMenu.type === 'background') {
        if (action === 'create-folder') {
          setNewFolderBasePath(normalizeFolderPath(currentPath || ROOT_PATH));
          setShowNewFolderInput(true);
        }
        if (action === 'create-file') await handleNewFile(currentPath);
      }
    } finally {
      hideContextMenu();
    }
  };

  // Favorites & Labels helpers
  const encodePathId = (p) => encodeURIComponent(p);
  const toggleFavorite = async (folderPath) => {
    const u = auth.currentUser; if (!u) { alert('Please sign in to use favorites.'); return; }
    const favRef = doc(db, 'users', u.uid, 'favorites', encodePathId(folderPath));
    if (favoriteFolders.has(folderPath)) await deleteDoc(favRef);
    else await setDoc(favRef, { kind: 'folder', path: folderPath, addedAt: Date.now() });
  };
  const openLabelEditor = (folderPath) => {
    const current = folderLabels[folderPath] || { tags: [], color: '#4b5563' };
    setLabelEditor({ open: true, path: folderPath, tagsText: current.tags.join(', '), color: current.color || '#4b5563' });
  };
  const saveLabels = async () => {
    const { path, tagsText, color } = labelEditor;
    if (!path) return;
    const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);
    await setDoc(doc(db, 'folders_meta', encodePathId(path)), { path, tags, color: color || '#4b5563' }, { merge: true });
    setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' });
  };
  const removeLabels = async () => {
    const { path } = labelEditor;
    if (!path) return;
    await setDoc(doc(db, 'folders_meta', encodePathId(path)), { path, tags: [], color: '' }, { merge: true });
    setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' });
  };

  const normalizeFolderPath = (inputPath) => {
    let p = String(inputPath || '').trim();
    if (!p) return ROOT_PATH;
    // Ensure starts with '/files/' and ends with '/'
    p = p.replace(/\\/g, '/');
    if (!p.startsWith('/')) p = '/' + p;
    if (!p.startsWith('/files/')) p = '/files' + (p === '/' ? '/' : p);
    if (!p.endsWith('/')) p += '/';
    return p.replace(/\/+/g, '/');
  };

  // Invalidate caches for a folder and optionally notify other views to refresh
  const invalidateFolderCaches = (folderPath) => {
    try {
      const safe = normalizeFolderPath(folderPath || currentPath || ROOT_PATH);
      folderCacheRef.current.delete(safe);
      countsCacheRef.current.delete(safe);
    } catch (_) {}
  };
  const notifyFolderChanged = (folderPath) => {
    try {
      const safe = normalizeFolderPath(folderPath || currentPath || ROOT_PATH);
      const normalized = safe.replace(/^\/+/, '').replace(/\\/g, '/');
      window.dispatchEvent(new CustomEvent('storage-meta-refresh', { detail: { prefix: normalized } }));
    } catch (_) {}
  };

  const handleNewFile = async (folderPath) => {
    if (userRole === 'viewer') { alert('You do not have permission to create files.'); return; }
    const name = prompt('Enter new file name (e.g., note.txt):');
    if (!name || !name.trim()) return;
    const safeFolder = normalizeFolderPath(folderPath || currentPath);
    const objectPath = `${safeFolder}${name.trim().replace(/^\/+|\/+$/g, '')}`.replace(/^\/+/, '');
    try {
      const fileRef = ref(storage, objectPath);
      await uploadBytes(fileRef, new Uint8Array());
  setSuccessMessage('File created');
  setIsError(false);
  setShowSuccessPopup(true);
      await loadData();
    } catch (err) {
      setIsError(true);
      setSuccessMessage('Error creating file: ' + (err.message || err.toString()));
      setShowSuccessPopup(true);
    }
  };

  const uploadFilesArray = async (files) => {
    if (!files?.length) return;
    const safeFolder = normalizeFolderPath(currentPath || ROOT_PATH);
  // uploading state removed
    try {
      for (const f of files) {
        const destPath = (safeFolder + f.name).replace(/^\/+/, '');
        const destRef = ref(storage, destPath);
        await uploadBytes(destRef, f);
      }
      await loadData();
  setSuccessMessage(`${files.length} file(s) uploaded`);
  setIsError(false);
  setShowSuccessPopup(true);
    } catch (e) {
      setIsError(true);
      setSuccessMessage('Upload failed: ' + (e?.message || String(e)));
      setShowSuccessPopup(true);
    } finally {
  // uploading state removed
    }
  };

  const goUpOne = () => {
    const cur = normalizeFolderPath(currentPath || ROOT_PATH);
    if (cur === ROOT_PATH) return;
    const parent = cur.replace(/[^/]+\/$/, '');
    try {
      setExpandedFolders(prev => new Set(prev).add(parent));
    } catch (_) {}
    if (typeof onPathChange === 'function') onPathChange(parent);
  };

  // const handleUploadFiles = async (evt) => {
  //   const files = Array.from(evt.target?.files || []);
  //   await uploadFilesArray(files);
  //   try { if (fileInputRef.current) fileInputRef.current.value = ''; } catch(_) {}
  // };

  // Keyboard shortcuts for selection
  const handleKeyDown = async (e) => {
    // Don't intercept typing/shortcuts inside form fields
    const t = e.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) {
      return;
    }
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    // Navigate up a folder
    if (!ctrl && !e.shiftKey && !e.altKey && key === 'Backspace') {
      e.preventDefault();
      goUpOne();
      return;
    }
    // Select All files in current folder (respects filter)
    if (ctrl && key.toLowerCase() === 'a') {
      e.preventDefault();
      const safe = normalizeFolderPath(currentPath || ROOT_PATH);
      let all = storageFiles.filter(f => f.path === safe && f.name !== '.keep' && f.name !== '.folder-placeholder');
      if (fileFilter) all = all.filter(f => f.name.toLowerCase().includes(fileFilter.toLowerCase()));
      setSelectedFiles(new Set(all.map(f => f.id)));
      return;
    }
    // New Folder
    if (ctrl && !e.shiftKey && key.toLowerCase() === 'n') {
      e.preventDefault();
      setShowNewFolderInput(true);
      return;
    }
    // New File
    if (ctrl && e.shiftKey && key.toLowerCase() === 'n') {
      e.preventDefault();
      await handleNewFile(currentPath);
      return;
    }
    // Rename
    if (key === 'F2') {
      e.preventDefault();
      if (selection.type === 'folder' && selection.target) {
        setRenamingFolder(selection.target);
        setRenameFolderName(selection.target.split('/').filter(Boolean).pop());
      } else if (selection.type === 'file' && selection.target) {
        await handleRenameFile(selection.target);
      }
      return;
    }
    // Delete: admins delete directly; non-admins submit a request
    if (key === 'Delete') {
      e.preventDefault();
      if (selection.type === 'folder' && selection.target) {
        await confirmAndDeleteFolder(selection.target);
      } else if (selection.type === 'file' && selection.target) {
        await confirmAndDeleteFile(selection.target);
      }
      return;
    }
    // Copy
    if (ctrl && key.toLowerCase() === 'c') {
      e.preventDefault();
      if (selection.type === 'folder' && selection.target) setClipboard({ action: 'copy', itemType: 'folder', payload: selection.target });
      if (selection.type === 'file' && selection.target) setClipboard({ action: 'copy', itemType: 'file', payload: selection.target });
      return;
    }
    // Cut (move)
    if (ctrl && key.toLowerCase() === 'x') {
      e.preventDefault();
      if (selection.type === 'folder' && selection.target) setClipboard({ action: 'cut', itemType: 'folder', payload: selection.target });
      if (selection.type === 'file' && selection.target) setClipboard({ action: 'cut', itemType: 'file', payload: selection.target });
      return;
    }
    // Paste
    if (ctrl && key.toLowerCase() === 'v') {
      e.preventDefault();
      await pasteIntoFolder(normalizeFolderPath(currentPath));
      return;
    }
  };

  // Helper: paste current clipboard into specified destination folder
  const pasteIntoFolder = async (destFolder) => {
    if (!clipboard) return;
    const dest = normalizeFolderPath(destFolder);
    try {
      if (clipboard.itemType === 'file') {
        const fileItem = clipboard.payload;
        const target = `${dest}${fileItem.name}`;
        const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
        const destRef = ref(storage, target.replace(/^\/+/, ''));
        await uploadBytes(destRef, data);
        if (clipboard.action === 'cut') {
          await deleteObject(fileItem.ref);
        }
      } else if (clipboard.itemType === 'folder') {
        const srcFolderPath = clipboard.payload;
        await copyFolder(srcFolderPath, dest, clipboard.action === 'cut');
      }
      setClipboard(null);
      await loadData();
      setSuccessMessage('Paste completed');
      setIsError(false);
      setShowSuccessPopup(true);
    } catch (e2) {
      setIsError(true);
      setSuccessMessage('Error pasting: ' + (e2.message || e2.toString()));
      setShowSuccessPopup(true);
    }
  };

  const previewFile = async (file) => {
    setSelection({ type: 'file', target: file });
    if (!onFileSelect) return;
    try {
      let meta = null, url = null;
      try { meta = await getMetadata(file.ref); } catch (_) {}
      try { url = await getDownloadURL(file.ref); } catch (_) {}
      const enriched = {
        ...file,
        downloadURL: url || file.downloadURL,
        type: meta?.contentType || file.type,
        size: typeof meta?.size === 'number' ? meta.size : file.size,
        uploadedAt: meta?.updated ? new Date(meta.updated) : file.uploadedAt,
        fullPath: file?.ref?.fullPath || file.fullPath
      };
      onFileSelect(enriched);
    } catch {
      onFileSelect(file);
    }
  };

  const handleRenameFileTo = async (fileItem, newName) => {
    const oldFull = fileItem?.ref?.fullPath || '';
    const name = String(newName || '').trim();
    if (!name) return;
    const newFull = oldFull.replace(/[^/]+$/, name);
    if (newFull === oldFull) return;
    try {
      const fileBytes = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const newRef = ref(storage, newFull);
      await uploadBytes(newRef, fileBytes);
  await deleteObject(fileItem.ref);
  setEditingFileId(null); setEditingName('');
  setSuccessMessage('File renamed successfully!');
  setIsError(false);
  setShowSuccessPopup(true);
  // Invalidate parent folder cache and notify listeners
  const parent = getParentFolderPath({ path: '/' + (oldFull.substring(0, oldFull.lastIndexOf('/') + 1)) });
  invalidateFolderCaches(parent);
  notifyFolderChanged(parent);
      await loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error renaming file: ' + (error.message || error.toString()));
      setShowSuccessPopup(true);
    }
  };

  // Rename folder in Firebase Storage (recursive, preserves structure)
  const handleRenameFolder = async () => {
    if (!renamingFolder || !renameFolderName.trim()) return;
    const oldPath = normalizeFolderPath(renamingFolder);
    const parent = oldPath.replace(/[^/]+\/$/, '');
    const newPath = (parent + renameFolderName.trim().replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/, '/');
    if (newPath === oldPath) {
      setRenamingFolder(null);
      setRenameFolderName('');
      return;
    }
    try {
      console.log('[Rename] oldPath:', oldPath, 'newPath:', newPath);
      // Try server-side rename for admins (fast, avoids client download/upload)
      if (userRole === 'admin') {
        try {
          const callable = httpsCallable(functions, 'renameFolder');
          await callable({ src: oldPath, dst: newPath, updateFirestore: true });
        } catch (e) {
          console.warn('Server rename failed; falling back to client copy:', e && e.message);
          await copyFolder(oldPath, newPath, true, true, { silent: true });
        }
      } else {
        // Non-admin fallback: client-side copy+delete
        await copyFolder(oldPath, newPath, true, true, { silent: true });
      }
  // Ensure new .keep exists (no-op if server move already placed content)
  try { await uploadBytes(ref(storage, newPath.replace(/^\/+/,'') + '.keep'), new Uint8Array()); } catch (_) {}

      // Update expanded folders and current path
      setExpandedFolders(prev => {
        const next = new Set(prev || []);
        next.delete(oldPath);
        next.add(newPath);
        return next;
      });
      try {
        const cur = normalizeFolderPath(currentPath || ROOT_PATH);
        if (cur.startsWith(oldPath) && typeof onPathChange === 'function') {
          const nextPath = (newPath + cur.substring(oldPath.length)).replace(/\/+/,'/');
          onPathChange(nextPath);
        }
      } catch {}

      setRenamingFolder(null);
      setRenameFolderName('');
  setIsError(false);
  setSuccessMessage('Folder renamed successfully!');
  setShowSuccessPopup(true);
  // Aggressively clear all folder/file state and caches, then force reload
  folderCacheRef.current.clear();
  countsCacheRef.current.clear();
  setStorageFolders(new Set());
  setStorageFiles([]);
  setSelection({ type: 'background', target: null });
  setExpandedFolders(new Set([ROOT_PATH]));
  setFileFilter('');
  setFolderFilter('');
  setFilePage(1);
  // Notify parent views (e.g., Dashboard list for the parent folder) to refresh
  try {
    const parentOfOld = oldPath.replace(/[^/]+\/$/, '');
    const parentOfNew = newPath.replace(/[^/]+\/$/, '');
    notifyFolderChanged(parentOfOld);
    if (parentOfNew !== parentOfOld) notifyFolderChanged(parentOfNew);
  } catch (_) {}
  // Immediate refresh
  await loadData();
  // Nudge path change to force parent-driven refresh (if provided)
  try { if (typeof onPathChange === 'function') onPathChange(normalizeFolderPath(currentPath || ROOT_PATH)); } catch {}
  // Handle Storage eventual consistency by scheduling extra refresh passes
  setTimeout(() => { try { loadData(); } catch {} }, 500);
  setTimeout(() => { try { loadData(); } catch {} }, 1500);
  console.log('[Rename] loadData called after rename.');
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error renaming folder: ' + (error.message || error.toString()));
      setShowSuccessPopup(true);
      console.error('Error renaming folder:', error);
    }
  };

  // File operations
  const handleRenameFile = async (fileItem) => {
    const oldFull = fileItem.ref.fullPath; // e.g., files/a/b/name.ext
    const newName = prompt('Enter new file name:', fileItem.name);
    if (!newName || !newName.trim()) return;
    const newFull = oldFull.replace(/[^/]+$/, newName.trim());
    try {
      const fileBytes = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const newRef = ref(storage, newFull);
      await uploadBytes(newRef, fileBytes);
  await deleteObject(fileItem.ref);
  setSuccessMessage('File renamed successfully!');
  setIsError(false);
  setShowSuccessPopup(true);
  const parent = getParentFolderPath({ path: '/' + (oldFull.substring(0, oldFull.lastIndexOf('/') + 1)) });
  invalidateFolderCaches(parent);
  notifyFolderChanged(parent);
      await loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error renaming file: ' + (error.message || error.toString()));
      setShowSuccessPopup(true);
    }
  };

  const handleDeleteFile = async (fileItem) => {
    setProgress({ active: true, value: 0, total: 1, label: 'Deleting file...' });
    try {
      await deleteObject(fileItem.ref);
      setProgress({ active: true, value: 1, total: 1, label: 'Deleting file...' });
  setSuccessMessage('File deleted successfully!');
  setIsError(false);
  setShowSuccessPopup(true);
  const parent = getParentFolderPath(fileItem);
  invalidateFolderCaches(parent);
  notifyFolderChanged(parent);
      await loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error deleting file');
      setShowSuccessPopup(true);
    }
    setProgress({ active: false, value: 0, total: 0, label: '' });
  };

  // Destination-aware helpers used by modal
  const handleCopyFileTo = async (fileItem, destFolder, overwrite = false, opts = {}) => {
    const { silent = false } = opts || {};
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    setProgress({ active: true, value: 0, total: 1, label: 'Copying file...' });
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      setProgress({ active: true, value: 0.5, total: 1, label: 'Copying file...' });
  const destRef = ref(storage, dest.replace(/^\/+/, ''));
      // Overwrite check
      let exists = false;
      try { await getMetadata(destRef); exists = true; } catch (e) { exists = false; }
      if (exists && !overwrite) {
        if (!silent) {
          setIsError(false);
          setSuccessMessage('Copy skipped: destination already has a file with this name.');
          setShowSuccessPopup(true);
        }
        setProgress({ active: false, value: 0, total: 0, label: '' });
        return;
      }
      await uploadBytes(destRef, data);
      setProgress({ active: true, value: 1, total: 1, label: 'Copying file...' });
      if (!silent) {
        setSuccessMessage('File copied');
        setIsError(false);
        setShowSuccessPopup(true);
  // Invalidate destination cache and notify
  const destSafe = normalizeFolderPath(destFolder);
  invalidateFolderCaches(destSafe);
  notifyFolderChanged(destSafe);
        await loadData();
      }
    } catch (e) {
      if (silent) {
        // Propagate to caller so bulk flow can count failures without per-item popups
        throw e;
      } else {
        setIsError(true);
        setSuccessMessage('Error copying file: ' + (e.message || e.toString()));
        setShowSuccessPopup(true);
      }
    }
    setProgress({ active: false, value: 0, total: 0, label: '' });
  };

  const handleMoveFileTo = async (fileItem, destFolder, overwrite = false, opts = {}) => {
    const { silent = false } = opts || {};
    const dest = normalizeFolderPath(destFolder) + fileItem.name;
    setProgress({ active: true, value: 0, total: 1, label: 'Moving file...' });
    try {
      const data = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      setProgress({ active: true, value: 0.5, total: 1, label: 'Moving file...' });
  const destRef = ref(storage, dest.replace(/^\/+/, ''));
      // Overwrite check
      let exists = false;
      try { await getMetadata(destRef); exists = true; } catch (e) { exists = false; }
      if (exists && !overwrite) {
        if (!silent) {
          setIsError(false);
          setSuccessMessage('Move skipped: destination already has a file with this name.');
          setShowSuccessPopup(true);
        }
        setProgress({ active: false, value: 0, total: 0, label: '' });
        return;
      }
      await uploadBytes(destRef, data);
      setProgress({ active: true, value: 0.8, total: 1, label: 'Moving file...' });
      await deleteObject(fileItem.ref);
      setProgress({ active: true, value: 1, total: 1, label: 'Moving file...' });
      if (!silent) {
        setSuccessMessage('File moved');
        setIsError(false);
        setShowSuccessPopup(true);
  // Invalidate both source and destination caches and notify
  const destSafe = normalizeFolderPath(destFolder);
  const srcSafe = getParentFolderPath(fileItem);
  invalidateFolderCaches(destSafe);
  invalidateFolderCaches(srcSafe);
  notifyFolderChanged(destSafe);
  notifyFolderChanged(srcSafe);
        await loadData();
      }
    } catch (e) {
      if (silent) {
        // Propagate to caller so bulk flow can count failures without per-item popups
        throw e;
      } else {
        setIsError(true);
        setSuccessMessage('Error moving file: ' + (e.message || e.toString()));
        setShowSuccessPopup(true);
      }
    }
    setProgress({ active: false, value: 0, total: 0, label: '' });
  };

  const getParentFolderPath = (fileItem) => normalizeFolderPath(fileItem?.path || ROOT_PATH);

  // Folder copy/move (recursive)
  const copyFolder = async (srcFolderPath, destFolderPath, removeOriginal = false, overwriteAll = false, opts = {}) => {
    const { silent = false } = opts || {};
    const src = normalizeFolderPath(srcFolderPath);
    const dst = normalizeFolderPath(destFolderPath);
    if (dst.startsWith(src)) {
      alert('Destination cannot be inside the source folder.');
      return;
    }
    try {
      let overwriteApproved = overwriteAll ? true : null;
      // Count total files/folders for progress
      let totalCount = 0;
      const countItems = async (fromPath) => {
        const fromRef = ref(storage, fromPath.replace(/^\/+/,''));
        const result = await listAll(fromRef);
        totalCount += result.items.length;
        for (const prefix of result.prefixes) {
          await countItems(prefix.fullPath);
        }
      };
      await countItems(src);
  setProgress({ active: true, value: 0, total: totalCount, label: removeOriginal ? 'Moving folder...' : 'Copying folder...' });
  let processedCount = 0;
      const walk = async (fromPath, toPath) => {
        const fromRef = ref(storage, fromPath.replace(/^\/+/,''));
        const baseFrom = fromPath.replace(/^\/+/,'')
        const result = await listAll(fromRef);
        // Copy files
        for (const item of result.items) {
          // Clone per-iteration values to avoid referencing changing outer variables
          const rel = item.fullPath.substring(baseFrom.length).replace(/^\/+/, '');
          const toFile = (toPath.replace(/^\/+/, '') + rel).replace(/^\/+/, '');
          const toRef = ref(storage, toFile);
          const bytes = await import('firebase/storage').then(mod => mod.getBytes(item));
          // Overwrite check per file
          let exists = false;
          try { await getMetadata(toRef); exists = true; } catch (e) { exists = false; }
          if (exists) {
            if (overwriteApproved === null) { overwriteApproved = false; }
            if (!overwriteApproved) {
              // Skip this file and do not delete original on move
              continue;
            }
          }
          await uploadBytes(toRef, bytes);
          if (removeOriginal) {
            await deleteObject(item);
          }
          processedCount++;
          setProgress({ active: true, value: processedCount, total: totalCount, label: removeOriginal ? 'Moving folder...' : 'Copying folder...' });
        }
        // Recurse folders
        for (const prefix of result.prefixes) {
          const relFolder = prefix.fullPath.substring(baseFrom.length);
          await walk(prefix.fullPath, (dst + relFolder).replace(/\/+/g, '/'));
          if (removeOriginal) {
            try { await deleteObject(ref(storage, prefix.fullPath + '/.keep')); } catch (e) {}
          }
        }
      };
      await walk(src, dst);
      setProgress({ active: false, value: 0, total: 0, label: '' });
      if (!silent) {
        setSuccessMessage(removeOriginal ? 'Folder moved successfully!' : 'Folder copied successfully!');
        setIsError(false);
        setShowSuccessPopup(true);
        // Invalidate and broadcast refresh for both source and destination parent folders
        try {
          const srcParent = src.replace(/[^/]+\/$/, '');
          const dstParent = dst.replace(/[^/]+\/$/, '');
          invalidateFolderCaches(srcParent);
          invalidateFolderCaches(dstParent);
          notifyFolderChanged(srcParent);
          notifyFolderChanged(dstParent);
        } catch (_) {}
        await loadData();
      }
    } catch (e) {
      setProgress({ active: false, value: 0, total: 0, label: '' });
      if (silent) {
        // Propagate to caller so bulk flow can count failures without per-item popups
        throw e;
      } else {
        setIsError(true);
        setSuccessMessage('Error processing folder: ' + (e.message || e.toString()));
        setShowSuccessPopup(true);
      }
    }
  };

  const showFolderDetails = async (folderPath) => {
    try {
      const base = normalizeFolderPath(folderPath);
      const folderRef = ref(storage, base.replace(/^\/+/, ''));
      // Shallow list only for quick stats
      const res = await listAll(folderRef);
      const filesHere = res.items.length;
      const subfolders = res.prefixes.length;
      alert(`Folder: ${base}\nSubfolders: ${subfolders}\nFiles (direct): ${filesHere}`);
    } catch (e) {
      alert('Error fetching details: ' + (e.message || e.toString()));
    }
  };

  const showFileDetails = (fileItem) => {
    const info = [
      `Name: ${fileItem.name}`,
      `Path: ${fileItem.path}`,
      `Size: ${formatFileSize(fileItem.size)}`,
      `Type: ${fileItem.type || 'unknown'}`,
      `Uploaded: ${fileItem.uploadedAt || 'unknown'}`
    ].join('\n');
    alert(info);
  };

  // Delete folder and its contents in Firebase Storage
  const handleDeleteFolder = async (folderPath) => {
    if (!folderPath) return;
    try {
      // Normalize to '/files/.../' and strip leading slash for Storage ref
      const base = normalizeFolderPath(folderPath);
      if (base === ROOT_PATH) { alert('Cannot delete the root folder.'); return; }
      const folderRef = ref(storage, base.replace(/^\/+/, ''));
      const result = await listAll(folderRef);

      // Delete files in this folder (ignore 404s for already-removed files)
      for (const item of result.items) {
        try {
          await deleteObject(item);
        } catch (e) {
          // Ignore not-found errors; surface others
          if (!(e && (e.code === 'storage/object-not-found' || /404/.test(String(e.status || ''))))) {
            throw e;
          }
        }
      }
      // Try to delete .keep if not already deleted
      try { await deleteObject(ref(storage, base.replace(/^\/+/,'') + '.keep')); } catch (e) { /* ignore */ }

      // Recurse into subfolders
      for (const prefix of result.prefixes) {
        try {
          // prefix.fullPath is like 'files/..'; normalize for our helper
          await handleDeleteFolder('/' + prefix.fullPath + '/');
        } catch (e) {
          // Continue deleting other subfolders; collect via outer catch if needed
          if (!(e && (e.code === 'storage/object-not-found' || /404/.test(String(e.status || ''))))) {
            throw e;
          }
        }
      }

  const deletedName = (base.split('/').filter(Boolean).pop()) || 'Folder';
  setSuccessMessage(`${deletedName} deleted successfully!`);
      setIsError(false);
      setShowSuccessPopup(true);
      // If we deleted the currently open folder, navigate to its parent
      try {
        const cur = normalizeFolderPath(currentPath || ROOT_PATH);
        if (cur === base) {
          const parent = base.replace(/[^/]+\/$/, '');
          if (parent && typeof onPathChange === 'function') onPathChange(parent || ROOT_PATH);
        }
      } catch {}
  folderCacheRef.current.clear();
  countsCacheRef.current.clear();
  setStorageFolders(new Set());
  setStorageFiles([]);
  setSelection({ type: 'background', target: null });
  // Notify and refresh so views update immediately
  notifyFolderChanged(base);
  await loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error deleting folder');
      setShowSuccessPopup(true);
      console.error('Error deleting folder:', error);
    }
  };

  // Create new folder in Firebase Storage
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setIsError(true);
      setSuccessMessage('Folder name cannot be empty.');
      setShowSuccessPopup(true);
      return;
    }
    let basePath = newFolderBasePath || normalizeFolderPath(currentPath || ROOT_PATH);
    if (!basePath.endsWith('/')) basePath += '/';
    let scopedBase = basePath;
    if (!scopedBase.startsWith('/files/')) {
      scopedBase = `/files${basePath}`.replace(/\/+/g, '/');
    }
    const folderPath = (scopedBase === '/' ? '' : scopedBase) + newFolderName + '/.keep';
    try {
      const folderRef = ref(storage, folderPath);
      await uploadBytes(folderRef, new Uint8Array());
      setShowNewFolderInput(false);
      setNewFolderName('');
      setNewFolderBasePath(null);
      setSuccessMessage('Folder created successfully!');
      setIsError(false);
      setShowSuccessPopup(true);
      loadData();
    } catch (error) {
      setIsError(true);
      setSuccessMessage('Error creating folder: ' + (error.message || error.toString()));
      setShowSuccessPopup(true);
      setNewFolderName('');
      setNewFolderBasePath(null);
      setShowNewFolderInput(true);
      console.error('Error creating folder:', error);
    }
  };

  // Downloads
  const downloadSingleFile = async (fileItem) => {
    try {
      const bytes = await import('firebase/storage').then(mod => mod.getBytes(fileItem.ref));
      const { saveAs } = await import('file-saver');
      const blob = new Blob([bytes], { type: fileItem.type || 'application/octet-stream' });
      saveAs(blob, fileItem.name);
    } catch (e) {
      try { if (fileItem.downloadURL) window.open(fileItem.downloadURL, '_blank'); } catch {}
    }
  };

  const downloadFolderAsZip = async (folderPath) => {
    try {
      const { default: JSZip } = await import('jszip');
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();
    const base = normalizeFolderPath(folderPath);
    const baseNoSlash = base.replace(/^\/+/, '');
      const baseName = base.split('/').filter(Boolean).pop() || 'folder';
      const addFolder = async (path, zipFolder) => {
        const folderRef = ref(storage, path.replace(/^\/+/, ''));
        const res = await listAll(folderRef);
        for (const item of res.items) {
      const relName = item.fullPath.substring(baseNoSlash.length).replace(/^\/+/, '');
          try {
            const bytes = await import('firebase/storage').then(mod => mod.getBytes(item));
            zipFolder.file(relName || item.name, bytes);
          } catch (_) {}
        }
        for (const prefix of res.prefixes) {
      const relFolder = prefix.fullPath.substring(baseNoSlash.length).replace(/^\/+|\/+$/g, '');
          await addFolder(prefix.fullPath, zipFolder.folder(relFolder));
        }
      };
      await addFolder(base, zip.folder(baseName));
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${baseName}.zip`);
    } catch (e) {
      alert('Error preparing ZIP: ' + (e.message || String(e)));
    }
  };

  const downloadSelectionAsZip = async () => {
    const files = storageFiles.filter(f => selectedFiles.has(f.id));
    const folders = Array.from(selectedFolders);
    if (files.length === 0 && folders.length === 0) return;
    try {
      const { default: JSZip } = await import('jszip');
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();
      const commonRoot = '/files/';
      for (const f of files) {
        try {
          const bytes = await import('firebase/storage').then(mod => mod.getBytes(f.ref));
          const rel = (f.path + f.name).replace(commonRoot, '').replace(/^\/+/, '');
          zip.file(rel, bytes);
        } catch (_) {}
      }
      for (const p of folders) {
        const base = normalizeFolderPath(p);
    const baseNoSlash = base.replace(/^\/+/, '');
        const baseLabel = base.replace(commonRoot, '').replace(/^\/+|\/+$/g, '');
        const zipFolder = zip.folder(baseLabel || 'folder');
        const addFolder = async (path, zf) => {
          const folderRef = ref(storage, path.replace(/^\/+/, ''));
          const res = await listAll(folderRef);
          for (const item of res.items) {
      const rel = item.fullPath.substring(baseNoSlash.length).replace(/^\/+/, '');
            try {
              const bytes = await import('firebase/storage').then(mod => mod.getBytes(item));
              zf.file(rel || item.name, bytes);
            } catch (_) {}
          }
          for (const prefix of res.prefixes) {
      const relFolder = prefix.fullPath.substring(baseNoSlash.length).replace(/^\/+|\/+$/g, '');
            await addFolder(prefix.fullPath, zf.folder(relFolder));
          }
        };
        await addFolder(base, zipFolder);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const name = files.length + folders.length === 1
        ? (files[0]?.name || (folders[0] || '').split('/').filter(Boolean).pop()) + '.zip'
        : 'selection.zip';
      saveAs(blob, name);
    } catch (e) {
      alert('Error preparing download: ' + (e.message || String(e)));
    }
  };

  // helper to render only the file grid for a specific path
  const renderFilesForPath = (path) => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    let filteredFiles = storageFiles.filter(file => {
      if (file.name === '.keep' || file.name === '.folder-placeholder') return false;
      if (includeNestedFiles) return file.path.startsWith(path);
      return file.path === path;
    });
  // Reviews filter removed
    if (fileFilter) {
      filteredFiles = filteredFiles.filter(file => file.name.toLowerCase().includes(fileFilter.toLowerCase()));
    }
    filteredFiles = filteredFiles.sort((a, b) => {
      let cmp = 0;
      if (fileSort === 'name') cmp = collator.compare(a.name || '', b.name || '');
      else if (fileSort === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (fileSort === 'type') cmp = collator.compare(a.type || '', b.type || '');
      else if (fileSort === 'modified') {
        const da = a.uploadedAt instanceof Date ? a.uploadedAt.getTime() : 0;
        const db = b.uploadedAt instanceof Date ? b.uploadedAt.getTime() : 0;
        cmp = da - db;
      }
      return fileSortDir === 'asc' ? cmp : -cmp;
    });
    // Pagination
    const total = filteredFiles.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(filePage, totalPages);
    const start = (safePage - 1) * pageSize;
    const pageItems = filteredFiles.slice(start, start + pageSize);
    const selectedCount = selectedFiles.size + selectedFolders.size;
    return (
      <div
        key={path + '-file-grid'}
        className={`file-grid-view ${isDragging ? 'drag-over' : ''}`}
        role="grid"
        aria-label={`Files in ${path}`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!isDragging) setIsDragging(true); }}
        onDragLeave={() => { setIsDragging(false); }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragging(false);
          const files = Array.from(e.dataTransfer?.files || []);
          await uploadFilesArray(files);
        }}
      >
        {filteredFiles.length > 0 && (
          <div className="selection-controls" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', marginBottom: 6 }}>
            <button
              type="button"
              title="Select all files in this folder"
              onClick={() => setSelectedFiles(new Set(filteredFiles.map(f => f.id)))}
            >
              Select all
            </button>
            <button
              type="button"
              title="Clear selection"
              onClick={clearSelection}
            >
              Clear
            </button>
            {/* Reviews removed */}
          </div>
        )}
        {selectedCount > 0 && (
          <div className="bulk-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', background: '#f5f7fb', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 }}>
            <strong>{selectedCount}</strong> selected
            <button onClick={() => openBulkModal('copy')}>Copy</button>
            <button onClick={() => openBulkModal('move')}>Move</button>
            <button onClick={handleBulkDeleteOrRequest} style={{ color: userRole === 'admin' ? '#b42318' : undefined }}>Delete</button>
            <button onClick={downloadSelectionAsZip}>Download</button>
            {/* Bulk send for review (files only) */}
            <button onClick={() => {
              const files = storageFiles.filter(f => selectedFiles.has(f.id));
              if (!files.length) { alert('Select one or more files to send for review.'); return; }
              setBulkReviewModal({ open: true, fileIds: files.map(f => f.id) });
            }}>Send for review</button>
            {/* Bulk add tags (editors/admins) */}
            {(userRole === 'editor' || userRole === 'admin') && (
              <button onClick={() => setBulkTagsModal({ open: true })}>Add tags</button>
            )}
            <button onClick={clearSelection} style={{ marginLeft: 'auto' }}>Clear</button>
          </div>
        )}
        {filteredFiles.length === 0 ? (
          <div className="empty-state">No files found.</div>
        ) : (
          pageItems.map(file => (
            <div
              key={file.id}
              className={`file-grid-item ${selection.type === 'file' && selection.target?.id === file.id ? 'selected' : ''}`}
              onClick={() => setSelection({ type: 'file', target: file })}
              onDoubleClick={() => previewFile(file)}
              onContextMenu={e => handleContextMenu(e, file, 'file')}
              title={file.name}
              role="row"
            >
              <input
                type="checkbox"
                checked={selectedFiles.has(file.id)}
                onClick={(e) => { e.stopPropagation(); }}
                onChange={(e) => { e.stopPropagation(); toggleSelectFile(file); }}
                title="Select file"
                style={{ marginRight: 8 }}
              />
              <div className="item-content" role="gridcell">
                {getFileIcon(file.name, file.type)}
                {editingFileId === file.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleRenameFileTo(file, editingName); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditingFileId(null); setEditingName(''); }
                    }}
                    onBlur={() => { if (editingName && editingName !== file.name) handleRenameFileTo(file, editingName); else { setEditingFileId(null); setEditingName(''); } }}
                    autoFocus
                    style={{ fontSize: 14, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }}
                    title="Rename file"
                  />
                ) : (
                  <>
                    <span className="file-name" title={file.name} onDoubleClick={() => { setEditingFileId(file.id); setEditingName(file.name); }}>{file.name}</span>
                    {(() => {
                      const pathKey = file.fullPath || file?.ref?.fullPath || file.path;
                      const isPending = pendingFileIds.has(file.id) || pendingPaths.has(pathKey);
                      const isReviewed = reviewedFileIds.has(file.id) || reviewedPaths.has(pathKey);
                      const color = isPending ? '#f59e0b' : (isReviewed ? '#16a34a' : null);
                      return (
                        <span
                          className="review-status-slot"
                          title={isPending ? 'Pending review' : isReviewed ? 'Reviewed' : ''}
                          aria-hidden={!(isPending || isReviewed)}
                          style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}
                        >
                          {color ? (
                            <span className="review-status-badge" style={{ color }}>
                              <FaCheckCircle />
                            </span>
                          ) : (
                            <span className="review-status-badge" style={{ visibility: 'hidden' }}>
                              <FaCheckCircle />
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </>
                )}
                <span className="file-size">{formatFileSize(file.size)}</span>
                {file.uploadedAt && (
                  <span className="file-modified" title={file.uploadedAt.toLocaleString?.() || ''} style={{ marginLeft: 8, color: '#64748b', fontSize: 12 }}>
                    {new Date(file.uploadedAt).toLocaleDateString?.()}
                  </span>
                )}
              </div>
              <div className="file-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', paddingRight: 8 }} onClick={e => e.stopPropagation()}>
                {/* Tags popover shown only when the tag button is clicked */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                  {((userRole === 'admin') || (userRole === 'editor') || (auth?.currentUser && file.ownerUid === auth.currentUser.uid)) && (
                    <button className="icon-btn tags-button" title="Tags" onClick={(e) => { e.stopPropagation(); setTagPopoverFor(prev => prev === file.id ? null : file.id); }} style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 8px', background: '#fff' }}>🏷️</button>
                  )}
                  {tagPopoverFor === file.id && (
                    <div className="tag-popover" role="dialog" aria-label="File tags" style={{ position: 'absolute', top: 36, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,0.12)', padding: 10, minWidth: 220, maxWidth: 320, zIndex: 10002 }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <strong style={{ fontSize: 13, color: '#334155' }}>Tags</strong>
                        <button onClick={() => setTagPopoverFor(null)} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflow: 'auto', paddingBottom: 6 }}>
                        {(file.tags && Object.keys(file.tags).length) ? (
                          Object.entries(file.tags).map(([k, v]) => (
                            <span key={k} style={{ fontSize: 11, color: '#334155', background: '#eef2ff', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 8px', lineHeight: 1.6, whiteSpace: 'nowrap' }}>
                              {k}{String(v ?? '') !== '' ? `=${v}` : ''}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: 12, color: '#64748b' }}>No tags yet</span>
                        )}
                      </div>
                      {((userRole === 'admin') || (userRole === 'editor')) && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <button onClick={() => {
                            // Initialize editor rows then open full editor modal
                            const existing = (file.tags && Object.keys(file.tags).length)
                              ? Object.entries(file.tags).map(([k, v]) => ({ key: String(k), value: String(v ?? '') }))
                              : [];
                            const existingKeys = new Set(existing.map(r => r.key));
                            const suggested = DEFAULT_TAG_KEYS.filter(k => !existingKeys.has(k)).map(k => ({ key: k, value: '' }));
                            const rows = (existing.length + suggested.length) ? [...existing, ...suggested] : [{ key: '', value: '' }];
                            setTagsRows(rows);
                            setTagsError('');
                            setTagPopoverFor(null);
                            setEditingTagsFor(file.id);
                          }} style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}>Edit…</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button className="icon-btn preview" title="Preview" onClick={() => previewFile(file)}>
                  <FaEye />
                </button>
                <button className="icon-btn download" title="Download" onClick={() => downloadSingleFile(file)}>
                  <FaDownload />
                </button>
                {/* Compact More menu to reduce clutter */}
                <div style={{ position: 'relative' }}>
                  <button className="icon-btn" title="More" onClick={(e) => { e.stopPropagation(); setMoreMenu({ open: true, kind: 'file', target: file }); }}>
                    <FaEllipsisH />
                  </button>
                  {moreMenu.open && moreMenu.kind === 'file' && moreMenu.target?.id === file.id && (
                    <div
                      className="inline-menu"
                      style={{ minWidth: 200 }}
                      onMouseDown={(e)=>e.stopPropagation()}
                      onClick={(e)=>e.stopPropagation()}
                    >
                      {/* Send for review */}
                      <div className="menu-item" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); setReviewModal({ open: true, type: 'file', target: file }); }}>
                        📨 Send for review
                      </div>
                      {((userRole === 'admin') || (userRole === 'editor') || (auth?.currentUser && file.ownerUid === auth.currentUser.uid)) && (
                        <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); previewFile(file); setEditingTagsFor(file.id); const existing = (file.tags && Object.keys(file.tags).length) ? Object.entries(file.tags).map(([k, v]) => ({ key: String(k), value: String(v ?? '') })) : []; const existingKeys = new Set(existing.map(r => r.key)); const suggested = DEFAULT_TAG_KEYS.filter(k => !existingKeys.has(k)).map(k => ({ key: k, value: '' })); const rows = (existing.length + suggested.length) ? [...existing, ...suggested] : [{ key: '', value: '' }]; setTagsRows(rows); setTagsError(''); }}>
                          <FaTag /> Edit tags
                        </div>
                      )}
                      {userRole !== 'viewer' && (
                        <>
                          <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); setEditingFileId(file.id); setEditingName(file.name); }}>
                            <FaEdit /> Rename
                          </div>
                          <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); setMoveCopyModal({ open: true, mode: 'copy', itemType: 'file', target: file, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
                            <FaCopy /> Copy
                          </div>
                          <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); setMoveCopyModal({ open: true, mode: 'move', itemType: 'file', target: file, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
                            <FaCut /> Move
                          </div>
                          {userRole === 'admin' && (
                            <div className="menu-item danger" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={async () => { setMoreMenu({ open: false, kind: null, target: null }); await confirmAndDeleteFile(file); }}>
                              <FaTrash /> Delete
                            </div>
                          )}
                        </>
                      )}
                      <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setMoreMenu({ open: false, kind: null, target: null }); showFileDetails(file); }}>
                        <FaInfoCircle /> Details
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        {filteredFiles.length > 0 && (
          <div className="pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
            <span style={{ color: '#666', fontSize: 12 }}>
              Showing {Math.min(total, start + 1)}–{Math.min(total, start + pageSize)} of {total}
            </span>
            <button disabled={safePage <= 1} onClick={() => setFilePage(p => Math.max(1, p - 1))}>Prev</button>
            <span style={{ fontSize: 12 }}>Page {safePage} / {totalPages}</span>
            <button disabled={safePage >= totalPages} onClick={() => setFilePage(p => Math.min(totalPages, p + 1))}>Next</button>
            <span style={{ marginLeft: 'auto', fontSize: 12 }}>Per page:</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setFilePage(1); }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        )}
        {editingTagsFor && (() => {
          const tgt = pageItems.find(f => f.id === editingTagsFor);
          const close = () => { setEditingTagsFor(null); setTagsRows([{ key: '', value: '' }]); setTagsError(''); };
          const save = async () => {
            if (!tgt) { close(); return; }
            if (savingTags) return;
            setSavingTags(true);
            // Validate keys: no spaces, no duplicates
            setTagsError('');
            const raw = (tagsRows || []).map(r => ({ key: String(r.key || '').trim(), value: String(r.value ?? '') }));
            const nonEmpty = raw.filter(r => r.key.length > 0);
            if (nonEmpty.some(r => /\s/.test(r.key))) { setTagsError('Tag Name cannot contain spaces'); return; }
            const seen = new Set();
            for (const r of nonEmpty) { if (seen.has(r.key)) { setTagsError('Duplicate Tag Names are not allowed'); return; } seen.add(r.key); }
            const map = {};
            for (const r of nonEmpty) { map[r.key] = r.value; }
            try {
              // Find doc(s) in Firestore by fullPath
              const fullPath = tgt?.ref?.fullPath;
              if (fullPath) {
                const snaps = await getDocs(fsQuery(collection(db, 'files'), where('fullPath', '==', fullPath)));
                if (!snaps.empty) {
                  const batch = (await import('firebase/firestore')).writeBatch(db);
                  snaps.forEach(d => batch.update(d.ref, { tags: map, updatedAt: new Date() }));
                  await batch.commit();
                } else {
                  // Create a minimal file doc so tags persist even for Storage-only files
                  const name = tgt.name || fullPath.split('/').pop();
                  const parent = (() => {
                    const i = fullPath.lastIndexOf('/');
                    const dir = i >= 0 ? fullPath.substring(0, i + 1) : '';
                    return dir ? ('/' + dir) : '/files/';
                  })();
                  try {
                    await addDoc(collection(db, 'files'), {
                      name,
                      path: parent,
                      fullPath,
                      type: tgt.type || null,
                      size: typeof tgt.size === 'number' ? tgt.size : null,
                      uploadedAt: new Date(),
                      uploadedBy: 'system',
                      uploadedByUid: auth?.currentUser?.uid || null,
                      tags: map
                    });
                  } catch (e) {
                    console.warn('Failed to create file doc for tags', e);
                  }
                }
                // Update Tags Catalog keys and values
                try {
                  const keySet = new Set(Object.keys(map || {}));
                  for (const k of keySet) {
                    const keyDoc = doc(db, 'tags_catalog', encodeKeyId(k));
                    const values = Object.prototype.hasOwnProperty.call(map, k) ? [String(map[k] || '')].filter(Boolean) : [];
                    await setDoc(keyDoc, { key: k, values: [] }, { merge: true });
                    if (values.length) {
                      await setDoc(keyDoc, { values: arrayUnion(...values) }, { merge: true });
                    }
                  }
                } catch (e) { console.warn('Catalog update failed', e); }
              }
              // Update local state for immediate UI feedback
              setStorageFiles(prev => prev.map(x => x.id === tgt.id ? { ...x, tags: map } : x));
              setSuccessMessage('Tags updated'); setIsError(false); setShowSuccessPopup(true);
            } catch (e) {
              console.warn('Tag update failed', e);
              setIsError(true); setSuccessMessage('Failed to update tags'); setShowSuccessPopup(true);
            } finally { setSavingTags(false); close(); }
          };
          return (
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              style={{ position: 'fixed', top: tagsModalPos.y, left: tagsModalPos.x, zIndex: 1050, background: 'transparent', maxWidth: 560, cursor: 'default' }}
            >
              <div className="modal" style={{ padding: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, width: tagsModalSize.w, height: tagsModalSize.h, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', position: 'relative' }}>
                <h4
                  style={{ marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'move', WebkitUserSelect: 'none', userSelect: 'none' }}
                  onMouseDown={(e) => {
                    tagsDragRef.current.active = true;
                    tagsDragRef.current.startX = e.clientX;
                    tagsDragRef.current.startY = e.clientY;
                    tagsDragRef.current.offsetX = tagsModalPos.x;
                    tagsDragRef.current.offsetY = tagsModalPos.y;
                    try { document.body.style.userSelect = 'none'; document.body.style.cursor = 'grabbing'; } catch {}
                  }}
                >
                  <span>Edit Tags</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Preview is open on the right →</span>
                </h4>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
                    <div style={{ color: '#475569', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Current tags</div>
                    {tgt?.tags && Object.keys(tgt.tags).length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {Object.entries(tgt.tags).map(([k, v]) => (
                          <span key={k} style={{ fontSize: 11, color: '#334155', background: '#eef2ff', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 8px', lineHeight: 1.6 }}>
                            {k}{String(v ?? '') !== '' ? `=${v}` : ''}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 12 }}>No tags yet.</div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, paddingBottom: 4, borderBottom: '1px solid #e5e7eb', color: '#475569', fontSize: 12, fontWeight: 600 }}>
                    <div>Tag Name</div>
                    <div>Value</div>
                    <div style={{ textAlign: 'right' }}>Actions</div>
                  </div>
                  {(tagsRows || []).map((row, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                      <input
                        type="text"
                        placeholder="Tag Name"
                        list={`tag-key-list-${idx}`}
                        value={row.key}
                        onChange={(e) => { setTagsRows(prev => prev.map((r, i) => i === idx ? { ...r, key: e.target.value } : r)); setTagsError(''); }}
                        style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6 }}
                      />
                      <datalist id={`tag-key-list-${idx}`}>
                        {tagKeySuggestions.map(k => (
                          <option key={k} value={k} />
                        ))}
                      </datalist>
                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Value"
                          value={row.value}
                          onFocus={() => setValueSuggestIdx(idx)}
                          onBlur={(e) => {
                            // Delay close to allow click on suggestion
                            setTimeout(() => setValueSuggestIdx(prev => (prev === idx ? null : prev)), 120);
                          }}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTagsRows(prev => prev.map((r, i) => i === idx ? { ...r, value: val } : r));
                            setTagsError('');
                            if (valueSuggestIdx !== idx) setValueSuggestIdx(idx);
                          }}
                          style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, width: '100%' }}
                        />
                        {valueSuggestIdx === idx && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 6px 18px rgba(0,0,0,0.08)', zIndex: 2000, maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
                            {(() => {
                              const allVals = Array.from(tagValueSuggestionsByKey.get(row.key) || []).sort((a,b) => a.localeCompare(b));
                              const q = String(row.value || '').toLowerCase();
                              const filtered = q ? allVals.filter(v => v.toLowerCase().includes(q)) : allVals;
                              if (filtered.length === 0) {
                                return <div style={{ padding: '8px 10px', color: '#64748b', fontSize: 12 }}>No matches</div>;
                              }
                              return filtered.map(v => (
                                <div
                                  key={row.key + ':' + v}
                                  onMouseDown={(e) => { e.preventDefault(); }}
                                  onClick={() => {
                                    setTagsRows(prev => prev.map((r, i) => i === idx ? { ...r, value: v } : r));
                                    setValueSuggestIdx(null);
                                  }}
                                  style={{ padding: '8px 10px', cursor: 'pointer' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                                >{v}</div>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                      <button type="button" title="Remove" onClick={() => setTagsRows(prev => {
                        const next = prev.filter((_, i) => i !== idx);
                        return next.length > 0 ? next : [{ key: '', value: '' }];
                      })} style={{ padding: '6px 10px', border: '1px solid #fecaca', background: '#fff', color: '#b42318', borderRadius: 6 }}>
                        <FaTrash />
                      </button>
                    </div>
                  ))}
                  <div>
                    <button type="button" onClick={() => setTagsRows(prev => [...prev, { key: '', value: '' }])} title="Add tag" style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc' }}>+ Add</button>
                  </div>
                  {tagsError && (
                    <div style={{ color: '#b42318', fontSize: 13 }}>{tagsError}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  <button onClick={close} style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}>Cancel</button>
                  <button onClick={save} disabled={savingTags} style={{ padding: '8px 12px', background: savingTags ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {savingTags && <span className="spinner spinner-sm" aria-label="Saving" />}
                    {savingTags ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {/* Resize handle */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    tagsResizeRef.current.active = true;
                    tagsResizeRef.current.startX = e.clientX;
                    tagsResizeRef.current.startY = e.clientY;
                    tagsResizeRef.current.startW = tagsModalSize.w;
                    tagsResizeRef.current.startH = tagsModalSize.h;
                  }}
                  title="Resize"
                  style={{ position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, cursor: 'nwse-resize', opacity: 0.7, borderRight: '2px solid #cbd5e1', borderBottom: '2px solid #cbd5e1', borderRadius: 2 }}
                />
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // Render only direct subfolders for a given path (no recursive tree)
  const renderSubfoldersOnly = (path) => {
    const safe = normalizeFolderPath(path || ROOT_PATH);
    const actualFolders = new Set([...storageFolders]);
    let subfolders = Array.from(actualFolders)
      .filter(folder => {
        const relativePath = folder.substring(safe.length);
        const isDirectChild = folder.startsWith(safe) && folder !== safe && relativePath.split('/').filter(p => p).length === 1;
        if (!isDirectChild) return false;
        // Filter out empty folders (no files, no subfolders)
        const directCounts = folderCounts[folder];
        if (directCounts && directCounts.files === 0 && directCounts.subfolders === 0) return false;
        if (!folderFilter) return true;
        const name = folder.substring(safe.length).replace('/', '').toLowerCase();
        return name.includes(folderFilter.toLowerCase());
      })
      .sort((a, b) => {
        const nameA = a.substring(safe.length).replace('/', '').toLowerCase();
        const nameB = b.substring(safe.length).replace('/', '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
  // Reviews-based folder filter removed

  // If there are no direct subfolders, don't render an empty-state box — just render nothing.
  if (subfolders.length === 0) return null;

  if (folderView === 'cards') {
      return (
        <div className="folder-card-grid">
          {subfolders.map(folderPath => {
            const folderName = folderPath.substring(safe.length).replace('/', '');
      const directCounts = folderCounts[folderPath];
      const filesInFolder = typeof directCounts?.files === 'number' ? String(directCounts.files) : '…';
      const subfoldersInFolder = typeof directCounts?.subfolders === 'number' ? String(directCounts.subfolders) : '…';
            return (
              <div
                key={folderPath + '-card-only'}
                className={`folder-card ${currentPath === folderPath ? 'active' : ''} ${clickingFolder === folderPath ? 'clicking' : ''} ${navigatingTo === folderPath ? 'is-navigating' : ''}`}
                title={`Folder: ${folderName} (${subfoldersInFolder} subfolders, ${filesInFolder} files)`}
        onClick={(e) => {
          if (longPressRef.current.fired) { e.preventDefault(); return; }
          setClickingFolder(folderPath);
          setNavigatingTo(folderPath);
          setTimeout(() => { setClickingFolder(prev => (prev === folderPath ? null : prev)); }, 350);
          setExpandedFolders(prev => new Set(prev).add(folderPath));
          onPathChange(folderPath);
        }}
                onContextMenu={e => handleContextMenu(e, folderPath, 'folder')}
        onMouseEnter={() => { fetchDirectCounts(folderPath); }}
                onTouchStart={(e) => startLongPress(e, folderPath, 'folder')}
                onTouchMove={moveLongPress}
                onTouchEnd={endLongPress}
                onTouchCancel={endLongPress}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setClickingFolder(folderPath); setNavigatingTo(folderPath); setTimeout(() => { setClickingFolder(prev => (prev === folderPath ? null : prev)); }, 350); setExpandedFolders(prev => new Set(prev).add(folderPath)); onPathChange(folderPath); } }}
                aria-label={`Open folder ${folderName}`}
              >
                <div className="folder-card-main">
                  <MacFolderIcon className="folder-card-icon" />
                  <div className="folder-card-text">
                    <div className="folder-card-name" title={(folderLabels[folderPath]?.tags || []).join(', ')}>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: folderLabels[folderPath]?.color || 'transparent', display: 'inline-block', marginRight: 6, border: '1px solid #e5e7eb' }} />
                      {folderName}
                      <button className="icon-btn favorite" style={{ marginLeft: 8 }} aria-label={favoriteFolders.has(folderPath) ? 'Unfavorite folder' : 'Favorite folder'} aria-pressed={favoriteFolders.has(folderPath)} title={favoriteFolders.has(folderPath) ? 'Unfavorite' : 'Favorite'} onClick={(e) => { e.stopPropagation(); toggleFavorite(folderPath); }}>
                        {favoriteFolders.has(folderPath) ? <FaStar color="#f59e0b" /> : <FaRegStar />}
                      </button>
                      {navigatingTo === folderPath && (
                        <span className="spinner spinner-sm" aria-label="Loading" style={{ marginLeft: 8 }} />
                      )}
                    </div>
                    <div className="folder-card-meta">{subfoldersInFolder} subfolders • {filesInFolder} files</div>
                  </div>
                </div>
                {userRole !== 'viewer' && (
                  <div className="folder-card-actions" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedFolders.has(folderPath)}
                      onChange={(e) => { e.stopPropagation(); toggleSelectFolder(folderPath); }}
                      title="Select folder"
                    />
                    {/* Review badges removed */}
                    <button className="icon-btn rename" title="Rename" onClick={async () => {
                      const newName = prompt('Enter new folder name:', folderName);
                      if (!newName || !newName.trim() || newName.trim() === folderName) return;
                      const newPath = folderPath.replace(/[^/]+\/$/, newName.trim() + '/');
                      await copyFolder(folderPath, newPath, true, true);
                    }}>
                      <FaEdit />
                    </button>
                    {/* Compact More menu for folder actions */}
                    <div style={{ position: 'relative' }}>
                      <button className="icon-btn" title="More" onClick={(e) => { e.stopPropagation(); setMoreMenu({ open: true, kind: 'folder', target: folderPath }); }}>
                        <FaEllipsisH />
                      </button>
                      {moreMenu.open && moreMenu.kind === 'folder' && moreMenu.target === folderPath && (
                        <div
                          className="inline-menu"
                          style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 220, zIndex: 3000 }}
                          onMouseDown={(e)=>e.stopPropagation()}
                          onClick={(e)=>e.stopPropagation()}
                        >
                          <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); setMoveCopyModal({ open: true, mode: 'copy', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
                            <FaCopy /> Copy
                          </div>
                          <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); setMoveCopyModal({ open: true, mode: 'move', itemType: 'folder', target: folderPath, dest: normalizeFolderPath(currentPath || ROOT_PATH) }); }}>
                            <FaCut /> Move
                          </div>
                          {/* Send for review */}
                          <div className="menu-item" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); setReviewModal({ open: true, type: 'folder', target: folderPath }); }}>
                            📨 Send for review
                          </div>
                          <div className="menu-item" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={() => { setMoreMenu({ open: false, kind: null, target: null }); showFolderDetails(folderPath); }}>
                            <FaInfoCircle /> Details
                          </div>
                          {userRole === 'admin' && (
                            <div className="menu-item danger" style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={async () => { setMoreMenu({ open: false, kind: null, target: null }); await confirmAndDeleteFolder(folderPath); }}>
                              <FaTrash /> Delete
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    // list view
    return (
      <div className="subfolder-list" style={{ display: 'grid', gap: 8, padding: '8px 4px' }}>
        {subfolders.map(folderPath => {
          const folderName = folderPath.substring(safe.length).replace('/', '');
          const directCounts = folderCounts[folderPath];
          const filesInFolder = typeof directCounts?.files === 'number' ? String(directCounts.files) : '…';
          const subfoldersInFolder = typeof directCounts?.subfolders === 'number' ? String(directCounts.subfolders) : '…';
          return (
            <div
              key={folderPath + '-row-only'}
              className={`file-grid-item ${currentPath === folderPath ? 'selected' : ''} ${clickingFolder === folderPath ? 'clicking' : ''} ${navigatingTo === folderPath ? 'is-navigating' : ''}`}
              title={`Open folder ${folderName}`}
              onClick={(e) => { if (longPressRef.current.fired) { e.preventDefault(); return; } setClickingFolder(folderPath); setNavigatingTo(folderPath); setTimeout(() => { setClickingFolder(prev => (prev === folderPath ? null : prev)); }, 350); setExpandedFolders(prev => new Set(prev).add(folderPath)); onPathChange(folderPath); }}
              onContextMenu={(e) => handleContextMenu(e, folderPath, 'folder')}
              onMouseEnter={() => { fetchDirectCounts(folderPath); }}
            >
              <div className="item-content">
                <MacFolderIcon className="folder-icon" />
                <span className="folder-name">{folderName}</span>
                {navigatingTo === folderPath && (
                  <span className="spinner spinner-sm" aria-label="Loading" style={{ marginLeft: 8 }} />
                )}
                <span className="folder-card-meta" style={{ marginLeft: 8 }}>{subfoldersInFolder} subfolders • {filesInFolder} files</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) return <div className="loading">Loading files...</div>;

  function renderProgressBar() {
    if (!progress.active || progress.total === 0) return null;
    const percent = Math.round((progress.value / progress.total) * 100);
    return (
      <div className="folder-progress-modal-overlay">
        <div className="folder-progress-modal">
          <div className="folder-progress-modal-title">{progress.label}</div>
          <div className="folder-progress-modal-bar">
            <div className="folder-progress-modal-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="folder-progress-modal-label">{progress.value} / {progress.total}</div>
        </div>
      </div>
    );
  }

  return (
  <div
      className={`folder-tree${compact ? ' compact' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    > 
  {renderProgressBar()}
    <div className="tree-header" onContextMenu={e => handleContextMenu(e, currentPath, 'background')}>
        <div className="breadcrumb-path">
          <button
            type="button"
            className="breadcrumb-link up-button"
            onClick={goUpOne}
            title="Up one level"
            aria-label="Up one level"
            disabled={normalizeFolderPath(currentPath || ROOT_PATH) === ROOT_PATH}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <FaArrowUp />
          </button>
          <span className="path-label">📁</span>
          <div className="breadcrumb-nav">
            {(() => {
              // Build breadcrumbs from currentPath
              const safe = normalizeFolderPath(currentPath);
              const parts = safe.replace(/^\/files\/?/, '').split('/').filter(Boolean);
              const crumbs = [{ label: 'PNLM', path: ROOT_PATH }];
              let acc = ROOT_PATH;
              parts.forEach(p => {
                acc = acc + p + '/';
                crumbs.push({ label: p, path: acc });
              });
              return crumbs.map((c, idx) => (
                <span key={c.path} className="breadcrumb-item">
                  <button
                    type="button"
                    className={`breadcrumb-link ${currentPath === c.path ? 'active' : ''}`}
                    onClick={() => {
                      setExpandedFolders(prev => new Set(prev).add(c.path));
                      onPathChange(c.path);
                    }}
                  >
                    {c.label}
                  </button>
                  {idx < crumbs.length - 1 && <span className="breadcrumb-separator">/</span>}
                </span>
              ));
            })()}
          </div>
        </div>
        <div className="tree-controls">
          {/* Tag Search button removed from Files section */}
          {!filesOnly && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {userRole !== 'viewer' && (
                <>
                  <button
                    type="button"
                    title="Create new folder"
                    onClick={() => {
                      try {
                        const base = normalizeFolderPath(currentPath || ROOT_PATH);
                        setNewFolderBasePath(base);
                      } catch {}
                      setShowNewFolderInput(true);
                    }}
                  >
                    📁 New Folder <span className="plus-icon">+</span>
                  </button>
                  {showNewFolderInput && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        placeholder={`New folder name`}
                        autoFocus
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc' }}
                      />
                      <button onClick={handleCreateFolder}>Create</button>
                      <button onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); setNewFolderBasePath(null); }}>Cancel</button>
                    </span>
                  )}
                </>
              )}
              <button
                title={`Folder view: ${folderView === 'cards' ? 'Cards' : 'List'}`}
                onClick={() => setFolderView(v => (v === 'cards' ? 'list' : 'cards'))}
              >
                Folder View: {folderView === 'cards' ? 'Cards' : 'List'}
              </button>
            </div>
          )}
          <input
            type="text"
            className="file-filter-input"
            placeholder="Filter files by name..."
            value={fileFilter}
            onChange={e => setFileFilter(e.target.value)}
            style={{ marginRight: '8px' }}
          />
          {fileFilter && (
            <button
              type="button"
              title="Clear filter"
              onClick={() => setFileFilter('')}
              style={{ marginRight: 8 }}
            >
              ✕
            </button>
          )}
          {!filesOnly && (
            <input
              type="text"
              className="file-filter-input"
              placeholder="Filter folders..."
              value={folderFilter}
              onChange={e => setFolderFilter(e.target.value)}
              style={{ marginRight: '8px' }}
            />
          )}
          {/* placeholder gap removed after UI cleanup */}
          {/* Redundant inline Upload removed; use global Upload panel or drag-and-drop */}
          <select className="file-sort-select" value={fileSort} onChange={e => setFileSort(e.target.value)}>
            <option value="name">Sort by Name</option>
            <option value="size">Sort by Size</option>
            <option value="type">Sort by Type</option>
            <option value="modified">Sort by Modified</option>
          </select>
          <button
            type="button"
            className="file-sort-dir-toggle"
            title={fileSortDir === 'asc' ? 'Sort Z→A' : 'Sort A→Z'}
            onClick={() => setFileSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
            style={{ marginLeft: 8 }}
          >
            {fileSort === 'name' ? (fileSortDir === 'asc' ? 'A→Z' : 'Z→A') : (fileSortDir === 'asc' ? '↑' : '↓')}
          </button>
          <div className="tree-controls-right">
            {/* Removed 'Include nested files' toggle as nested files are always shown */}
            <label className="toggle-label" title="Compact list density">
              <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
              Compact
            </label>
          </div>
        </div>
  {/* Tag Search UI removed from dashboard; use the dedicated page instead */}
      </div>
      {/* Lightweight stats for the current folder to aid clarity */}
      {/* Manual refresh control */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px' }}>
          <button className="refresh-btn" title="Refresh current folder" onClick={() => { try {
            const safe = normalizeFolderPath(currentPath || ROOT_PATH);
            folderCacheRef.current.delete(safe);
            countsCacheRef.current.delete(safe);
            setStorageFolders(new Set());
            setStorageFiles([]);
            setSelection({ type: 'background', target: null });
          } catch (_) {} finally { loadData(); } }}>Refresh</button>
      </div>
      
      
      
  {(() => {
        const safe = normalizeFolderPath(currentPath || ROOT_PATH);
        const fc = folderCounts[safe];
        // Prefer cached counts; fall back to quick local compute; show … if loading
        const quickSubfolders = Array.from(storageFolders).filter(fp => fp.startsWith(safe) && fp !== safe && fp.substring(safe.length).split('/').filter(Boolean).length === 1).length;
        const quickFiles = storageFiles.filter(f => f.path === safe && f.name !== '.keep' && f.name !== '.folder-placeholder').length;
        const directSubfolders = typeof fc?.subfolders === 'number' ? fc.subfolders : (loading ? null : quickSubfolders);
        const directFiles = typeof fc?.files === 'number' ? fc.files : (loading ? null : quickFiles);
        const nestedFiles = includeNestedFiles ? (loading ? null : storageFiles.filter(f => f.path.startsWith(safe) && f.name !== '.keep' && f.name !== '.folder-placeholder').length) : null;
        return (
          <div className="folder-stats" style={{ margin: '8px 4px', fontSize: 12, color: '#556', display: 'flex', gap: 12 }}>
            <span title="Current folder path">Path: {safe}</span>
            <span title="Direct subfolders count">Subfolders: {directSubfolders == null ? '…' : directSubfolders}</span>
            <span title="Direct files count">Files: {directFiles == null ? '…' : directFiles}{nestedFiles !== null ? ` (including nested: ${nestedFiles == null ? '…' : nestedFiles})` : ''}</span>
          </div>
        );
      })()}
      {/* Custom context menu */}
      {contextMenu.visible && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 10000, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 220 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.type === 'folder' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>Folder</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('rename')}>✏️ Rename</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('copy')}>📄 Copy</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('move')}>📦 Move (picker)</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer', color: '#b42318' }} onClick={() => handleMenuAction('delete')}>🗑️ Delete</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('details')}>ℹ️ Details</div>
            </>
          )}
          {contextMenu.type === 'file' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>File</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('rename')}>✏️ Rename</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('copy')}>📄 Copy</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('move')}>📦 Move (picker)</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer', color: '#b42318' }} onClick={() => handleMenuAction('delete')}>🗑️ Delete</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('download')}>⬇️ Download</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('details')}>ℹ️ Details</div>
            </>
          )}
          {contextMenu.type === 'background' && (
            <>
              <div className="context-menu-title" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#444', borderBottom: '1px solid #eee' }}>Here</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-folder')}>📁 New Folder <span className="plus-icon">+</span></div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => handleMenuAction('create-file')}>📄 New File</div>
              <div className="context-menu-item" style={{ padding: '8px 16px', cursor: clipboard ? 'pointer' : 'not-allowed', opacity: clipboard ? 1 : 0.5 }} onClick={() => { if (clipboard) pasteIntoFolder(normalizeFolderPath(currentPath)); }}>📎 Paste</div>
            </>
          )}
        </div>
      )}
  {/* New Folder Input (inline, convenient placement) */}
      {/* Rename Folder Input UI */}
      {renamingFolder && (
        <div className="rename-folder-popup" role="dialog" aria-modal="true" aria-labelledby="rename-folder-title" style={{ position: 'fixed', top: contextMenu.y + 20, left: contextMenu.x, zIndex: 10000, background: '#fff', border: '1px solid #ccc', borderRadius: '4px', padding: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          <div id="rename-folder-title" style={{ fontWeight: 600, marginBottom: 8 }}>Rename folder</div>
          <input
            type="text"
            value={renameFolderName}
            onChange={e => setRenameFolderName(e.target.value)}
            placeholder="Enter new folder name"
            autoFocus
            style={{ marginRight: '8px' }}
          />
          <button onClick={handleRenameFolder}>Rename</button>
          <button onClick={() => { setRenamingFolder(null); setRenameFolderName(''); }}>Cancel</button>
        </div>
      )}
      {/* Success/Error Popup */}
      {showSuccessPopup && (
        <div className="success-popup" role="status" aria-live="polite" style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 20000, background: isError ? '#ffeaea' : '#eaffea', border: '1px solid #ccc', borderRadius: '6px', padding: '10px 12px', boxShadow: '0 6px 18px rgba(0,0,0,0.2)', maxWidth: 420 }}>
          {successMessage}
          <button style={{ marginLeft: '12px' }} onClick={() => setShowSuccessPopup(false)}>Close</button>
        </div>
      )}
  {/* Review Modal removed */}
      {/* Label Editor Modal */}
      {labelEditor.open && (
        <div className="label-editor-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10003 }}>
          <div style={{ background: '#fff', width: 420, borderRadius: 8, boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 600 }}>Edit labels</div>
              <button onClick={() => setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' })} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              <label style={{ fontSize: 13, color: '#555' }}>Tags (comma separated)</label>
              <input type="text" value={labelEditor.tagsText} onChange={e => setLabelEditor(prev => ({ ...prev, tagsText: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
              <label style={{ fontSize: 13, color: '#555' }}>Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={labelEditor.color} onChange={e => setLabelEditor(prev => ({ ...prev, color: e.target.value }))} />
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: labelEditor.color, border: '1px solid #ddd' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button onClick={() => setLabelEditor({ open: false, path: null, tagsText: '', color: '#4b5563' })}>Cancel</button>
                <button onClick={removeLabels} style={{ color: '#b42318' }}>Clear</button>
                <button onClick={saveLabels} style={{ background: '#0b5ed7', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 6 }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
  <div className="tree-content" role="group" aria-label="Folder contents" onContextMenu={(e) => { if (!e.defaultPrevented) handleContextMenu(e, currentPath, 'background'); }}>
        {(() => {
          const safe = normalizeFolderPath(currentPath || ROOT_PATH);
          if (filesOnly) return renderFilesForPath(safe);
          // Show subfolders first, then files for the selected folder
          return (
            <>
              {renderSubfoldersOnly(safe)}
              {renderFilesForPath(safe)}
            </>
          );
        })()}
      </div>
      {moveCopyModal.open && (
        <div className="move-copy-modal" role="dialog" aria-modal="true" aria-labelledby="move-copy-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }} onKeyDown={(e) => {
          if (e.key === 'Escape') setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH });
          if (e.key === 'Enter') (document.getElementById('confirm-move-copy') || {}).click?.();
        }}>
          <div style={{ background: '#fff', width: '840px', maxWidth: '95vw', maxHeight: '90vh', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div id="move-copy-title" style={{ fontWeight: 600 }}>
                {moveCopyModal.mode === 'copy' ? 'Copy to…' : 'Move to…'}
              </div>
              <button onClick={() => setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH })} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
              <div style={{ padding: 12, borderRight: '1px solid #eee', maxHeight: '70vh', overflow: 'auto' }}>
                <StorageTreeView
                  currentPath={(moveCopyModal.dest || ROOT_PATH).replace(/^\/+/, '').replace(/\\/g,'/')}
                  initialDepth={6}
                  onFolderSelect={(p) => {
                    // Normalize to '/files/.../' form
                    const normalized = (() => {
                      let pp = String(p || '').trim().replace(/\\/g, '/');
                      if (!pp.startsWith('/')) pp = '/' + pp;
                      // If it already starts with '/files' (with or without trailing slash), don't prefix again
                      if (!pp.startsWith('/files')) {
                        pp = '/files' + (pp === '/' ? '/' : pp);
                      }
                      // Ensure exactly '/files/' prefix
                      if (pp === '/files') pp = '/files/';
                      if (!pp.startsWith('/files/')) pp = pp.replace(/^\/files(?!\/)/, '/files/');
                      if (!pp.endsWith('/')) pp += '/';
                      return pp.replace(/\/+/g, '/');
                    })();
                    setMoveCopyModal(prev => ({ ...prev, dest: normalized }));
                  }}
                  userRole="viewer"
                />
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>Destination</div>
                <input type="text" value={moveCopyModal.dest} onChange={e => setMoveCopyModal(prev => ({ ...prev, dest: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }} />
                <div style={{ marginTop: 12, padding: '8px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6, fontSize: 13, color: '#555' }}>
                  <div>
                    <strong>Item:</strong>{' '}
                    {(() => {
                      if (moveCopyModal.itemType === 'file') {
                        return moveCopyModal.target?.name || '(file)';
                      }
                      if (moveCopyModal.itemType === 'folder') {
                        const fp = String(moveCopyModal.target || '');
                        return fp.split('/').filter(Boolean).pop() || '(folder)';
                      }
                      if (moveCopyModal.itemType === 'bulk') {
                        const files = moveCopyModal.target?.files?.length || 0;
                        const folders = moveCopyModal.target?.folders?.length || 0;
                        return `${files} file(s) + ${folders} folder(s)`;
                      }
                      return '(none)';
                    })()}
                  </div>
                  <div><strong>Action:</strong> {moveCopyModal.mode === 'copy' ? 'Copy' : 'Move'}</div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: '#444' }}>
                  <input
                    type="checkbox"
                    checked={!!moveCopyModal.overwrite}
                    onChange={(e) => setMoveCopyModal(prev => ({ ...prev, overwrite: e.target.checked }))}
                  />
                  Overwrite existing files
                </label>
                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH, overwrite: false })} style={{ padding: '8px 12px' }} disabled={moveCopyBusy}>Cancel</button>
                  <button
                    id="confirm-move-copy"
                    onClick={async () => {
                      const dest = moveCopyModal.dest;
                      if (!dest) return;
                      // Guard against no-op moves (same folder)
                      if (moveCopyModal.itemType === 'file') {
                        const cur = getParentFolderPath(moveCopyModal.target);
                        if (normalizeFolderPath(dest) === normalizeFolderPath(cur) && moveCopyModal.mode === 'move') { setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH }); return; }
                      } else if (moveCopyModal.itemType === 'folder') {
                        const cur = normalizeFolderPath(moveCopyModal.target);
                        if (normalizeFolderPath(dest) === normalizeFolderPath(cur) && moveCopyModal.mode === 'move') { setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH }); return; }
                      }
                      try {
                        setMoveCopyBusy(true);
                        if (moveCopyModal.itemType === 'file') {
                          if (moveCopyModal.mode === 'copy') await handleCopyFileTo(moveCopyModal.target, dest, !!moveCopyModal.overwrite, { silent: true });
                          else await handleMoveFileTo(moveCopyModal.target, dest, !!moveCopyModal.overwrite, { silent: true });
                          await loadData();
                          setIsError(false);
                          setSuccessMessage(moveCopyModal.mode === 'copy' ? 'File copied' : 'File moved');
                          setShowSuccessPopup(true);
                        } else if (moveCopyModal.itemType === 'folder') {
                          await copyFolder(moveCopyModal.target, dest, moveCopyModal.mode === 'move', !!moveCopyModal.overwrite, { silent: true });
                          await loadData();
                          setIsError(false);
                          setSuccessMessage(moveCopyModal.mode === 'move' ? 'Folder moved successfully!' : 'Folder copied successfully!');
                          setShowSuccessPopup(true);
                        } else if (moveCopyModal.itemType === 'bulk') {
                          const tasks = [];
                          const files = Array.isArray(moveCopyModal.target?.files) ? moveCopyModal.target.files : [];
                          const folders = Array.isArray(moveCopyModal.target?.folders) ? moveCopyModal.target.folders : [];
                          for (const f of files) {
                            tasks.push(moveCopyModal.mode === 'copy'
                              ? handleCopyFileTo(f, dest, !!moveCopyModal.overwrite, { silent: true })
                              : handleMoveFileTo(f, dest, !!moveCopyModal.overwrite, { silent: true })
                            );
                          }
                          for (const p of folders) {
                            tasks.push(copyFolder(p, dest, moveCopyModal.mode === 'move', !!moveCopyModal.overwrite, { silent: true }));
                          }
                          // Run sequentially to limit bandwidth; collect errors
                          let failures = 0;
                          for (const t of tasks) { try { await t; } catch (e) { failures++; } }
                          clearSelection();
                          await loadData();
                          setIsError(failures > 0);
                          setSuccessMessage(failures > 0
                            ? `Completed with ${failures} error(s).`
                            : `Completed: ${files.length} file(s) and ${folders.length} folder(s).`);
                          setShowSuccessPopup(true);
                        }
                        setMoveCopyModal({ open: false, mode: 'copy', itemType: null, target: null, dest: ROOT_PATH, overwrite: false });
                      } catch (e) {
                        // Error is surfaced via inner functions
                      } finally {
                        setMoveCopyBusy(false);
                      }
                    }}
                    disabled={moveCopyBusy}
                    style={{ padding: '8px 12px', background: moveCopyBusy ? '#6ea8fe' : '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }}
                  >
                    {moveCopyBusy ? 'Working…' : (moveCopyModal.mode === 'copy' ? 'Copy here' : 'Move here')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {reviewModal.open && (
        <div className="move-copy-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }} onKeyDown={(e) => {
          if (e.key === 'Escape' && !reviewSubmitting) setReviewModal({ open: false, type: null, target: null });
          if (e.key === 'Enter' && !reviewSubmitting) (document.getElementById('confirm-send-review') || {}).click?.();
        }}>
          <div style={{ background: '#fff', width: '560px', maxWidth: '95vw', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div id="review-title" style={{ fontWeight: 600 }}>Send for review</div>
              <button onClick={() => { if (!reviewSubmitting) setReviewModal({ open: false, type: null, target: null }); }} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div>
                <div style={{ marginBottom: 6, color: '#666', fontSize: 13 }}>Assign to admin</div>
                <select value={reviewAssignee} onChange={e => setReviewAssignee(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }}>
                  <option value="">Select…</option>
                  {reviewAdmins.map(a => (<option key={a.id} value={a.id}>{a.username || a.email || a.id}</option>))}
                </select>
              </div>
              <div style={{ fontSize: 13, color: '#555' }}>
                Target:{' '}
                {reviewModal.type === 'file' ? (reviewModal.target?.name || reviewModal.target?.fullPath || reviewModal.target?.ref?.fullPath) : String(reviewModal.target || '')}
              </div>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { if (!reviewSubmitting) setReviewModal({ open: false, type: null, target: null }); }} style={{ padding: '8px 12px' }} disabled={reviewSubmitting}>Cancel</button>
              <button id="confirm-send-review" onClick={async () => {
                if (!reviewAssignee || reviewSubmitting) return;
                setReviewSubmitting(true);
                try {
                  const cur = auth?.currentUser;
                  const base = reviewModal.type === 'file' ? {
                    targetType: 'file',
                    fileId: reviewModal.target?.id || null,
                    fileName: reviewModal.target?.name || null,
                    fullPath: reviewModal.target?.fullPath || reviewModal.target?.ref?.fullPath || null,
                    path: reviewModal.target?.path || null,
                  } : {
                    targetType: 'folder',
                    fileId: null,
                    fileName: null,
                    fullPath: String(reviewModal.target || ''),
                    path: String(reviewModal.target || ''),
                  };
                  await addDoc(collection(db, 'reviews'), {
                    ...base,
                    assignedTo: reviewAssignee,
                    assignedToEmail: (reviewAdmins.find(a => a.id === reviewAssignee)?.email) || null,
                    requestedBy: cur?.uid || null,
                    requestedByEmail: cur?.email || null,
                    status: 'pending',
                    requestedAt: serverTimestamp(),
                  });
                  setReviewModal({ open: false, type: null, target: null });
                  setReviewAssignee('');
                  try { window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: 'Sent for review' } })); } catch {}
                } catch (e) {
                  console.error('send review error', e);
                  alert('Failed to send for review');
                } finally {
                  setReviewSubmitting(false);
                }
              }} style={{ padding: '8px 12px', background: reviewSubmitting ? '#6ea8fe' : '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }} disabled={reviewSubmitting || !reviewAssignee}>{reviewSubmitting ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
      {bulkReviewModal.open && (
        <div className="move-copy-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-review-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }} onKeyDown={(e) => {
          if (e.key === 'Escape' && !bulkReviewSubmitting) setBulkReviewModal({ open: false, fileIds: [] });
          if (e.key === 'Enter' && !bulkReviewSubmitting) (document.getElementById('confirm-bulk-send-review') || {}).click?.();
        }}>
          <div style={{ background: '#fff', width: '560px', maxWidth: '95vw', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div id="bulk-review-title" style={{ fontWeight: 600 }}>Send {bulkReviewModal.fileIds.length} file(s) for review</div>
              <button onClick={() => { if (!bulkReviewSubmitting) setBulkReviewModal({ open: false, fileIds: [] }); }} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div>
                <div style={{ marginBottom: 6, color: '#666', fontSize: 13 }}>Assign to admin</div>
                <select value={reviewAssignee} onChange={e => setReviewAssignee(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }}>
                  <option value="">Select…</option>
                  {reviewAdmins.map(a => (<option key={a.id} value={a.id}>{a.username || a.email || a.id}</option>))}
                </select>
              </div>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { if (!bulkReviewSubmitting) setBulkReviewModal({ open: false, fileIds: [] }); }} style={{ padding: '8px 12px' }} disabled={bulkReviewSubmitting}>Cancel</button>
              <button id="confirm-bulk-send-review" onClick={async () => {
                if (!reviewAssignee || bulkReviewSubmitting) return;
                setBulkReviewSubmitting(true);
                try {
                  const cur = auth?.currentUser;
                  const idSet = new Set(bulkReviewModal.fileIds);
                  const files = storageFiles.filter(f => idSet.has(f.id));
                  const tasks = files.map((f) => addDoc(collection(db, 'reviews'), {
                    targetType: 'file',
                    fileId: f.id,
                    fileName: f.name || null,
                    fullPath: f.ref?.fullPath || f.id,
                    path: f.path || null,
                    assignedTo: reviewAssignee,
                    assignedToEmail: (reviewAdmins.find(a => a.id === reviewAssignee)?.email) || null,
                    requestedBy: cur?.uid || null,
                    requestedByEmail: cur?.email || null,
                    status: 'pending',
                    requestedAt: serverTimestamp(),
                  }));
                  await Promise.allSettled(tasks);
                  setBulkReviewModal({ open: false, fileIds: [] });
                  setReviewAssignee('');
                  try { window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: 'Sent for review' } })); } catch {}
                } catch (e) {
                  console.error('bulk send review error', e);
                  alert('Failed to send some items for review');
                } finally {
                  setBulkReviewSubmitting(false);
                }
              }} style={{ padding: '8px 12px', background: bulkReviewSubmitting ? '#6ea8fe' : '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }} disabled={bulkReviewSubmitting || !reviewAssignee}>{bulkReviewSubmitting ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
      {bulkTagsModal.open && (
        <div className="move-copy-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-tags-title" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }} onKeyDown={(e) => {
          if (e.key === 'Escape') setBulkTagsModal({ open: false });
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (document.getElementById('confirm-bulk-tags') || {}).click?.();
        }}>
          <div style={{ background: '#fff', width: '560px', maxWidth: '95vw', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 28px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div id="bulk-tags-title" style={{ fontWeight: 600 }}>Add tags to selected files</div>
              <button onClick={() => setBulkTagsModal({ open: false })} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#555' }}>Enter tags to add or update for all selected files. Use one per line in the form Key: Value.</div>
              <textarea value={bulkTagsText} onChange={(e) => setBulkTagsText(e.target.value)} placeholder={"ProjectName: ACME\nDate: 2024-12-31"} style={{ minHeight: 140, padding: '10px', border: '1px solid #d1d5db', borderRadius: 6 }} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={bulkTagsOverwrite} onChange={(e) => setBulkTagsOverwrite(e.target.checked)} /> Overwrite these keys if present
              </label>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setBulkTagsModal({ open: false })} style={{ padding: '8px 12px' }}>Cancel</button>
              <button id="confirm-bulk-tags" onClick={async () => {
                // Parse tags
                const lines = String(bulkTagsText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                const entries = [];
                for (const ln of lines) {
                  const m = ln.split(/[:=]/);
                  if (m.length >= 2) {
                    const k = m[0].trim();
                    const v = m.slice(1).join(':').trim();
                    if (k) entries.push([k, v]);
                  }
                }
                if (entries.length === 0) { alert('Enter at least one tag.'); return; }
                try {
                  const idSet = new Set(Array.from(selectedFiles));
                  const files = storageFiles.filter(f => idSet.has(f.id));
                  if (!files.length) { alert('No files selected.'); return; }
                  const BATCH = 4;
                  let idx = 0; let updated = 0; let skipped = 0; let failed = 0;
                  const runners = Array(Math.min(BATCH, files.length)).fill(0).map(async () => {
                    while (idx < files.length) {
                      const i = idx++;
                      const f = files[i];
                      try {
                        // Find corresponding Firestore 'files' doc by fullPath
                        const full = f.ref?.fullPath || f.id;
                        const q = fsQuery(collection(db, 'files'), where('fullPath', '==', full));
                        const snap = await getDocs(q);
                        if (snap.empty) { skipped++; continue; }
                        const docRef = snap.docs[0].ref;
                        const data = snap.docs[0].data() || {};
                        const current = (data.tags && typeof data.tags === 'object') ? { ...data.tags } : {};
                        for (const [k, v] of entries) {
                          if (bulkTagsOverwrite || !Object.prototype.hasOwnProperty.call(current, k)) current[k] = v;
                          else current[k] = v; // overwrite when checkbox set; already handled
                        }
                        await setDoc(docRef, { tags: current, updatedAt: serverTimestamp() }, { merge: true });
                        updated++;
                      } catch (_) {
                        failed++;
                      }
                    }
                  });
                  await Promise.allSettled(runners);
                  setBulkTagsModal({ open: false });
                  setBulkTagsText('');
                  try { window.dispatchEvent(new CustomEvent('file-action-success', { detail: { message: `Tags updated: ${updated}, skipped: ${skipped}${failed ? `, failed: ${failed}` : ''}` } })); } catch {}
                } catch (e) {
                  alert('Failed to update tags');
                }
              }} style={{ padding: '8px 12px', background: '#0b5ed7', color: '#fff', border: 'none', borderRadius: 6 }}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FolderTree;
