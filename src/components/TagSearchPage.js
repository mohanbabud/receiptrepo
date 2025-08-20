import React, { useEffect, useRef, useState, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, addDoc, deleteDoc, doc, getDocs, query as fsQuery, where, limit } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import FilePreview from './FilePreview';
import { MacFileIcon } from './icons/MacIcons';
import { FaEye, FaDownload, FaSearch, FaPlus, FaTrash } from 'react-icons/fa';
import './TagSearchPage.css';

const ROOT_PATH = '/files/';

function SearchableComboBox({ options, value, onChange, placeholder = 'Select…', loading = false, className = '', allowCustom = false }) {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const typedRef = useRef(false);

  useEffect(() => {
    const onDoc = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = (options || []).filter(o => {
    const q = String(query || '').toLowerCase();
    const lbl = String(o.label || '').toLowerCase();
    const val = String(o.value || '').toLowerCase();
    return lbl.includes(q) || val.includes(q);
  });

  // Keep input text in sync with selected item when value/options change,
  // but don't clobber user's in-progress typing
  useEffect(() => {
    const current = (options || []).find(o => o.value === value) || null;
    if (!typedRef.current) setQuery(current ? (current.label ?? current.value ?? '') : '');
  }, [value, options]);

  const selectAt = (idx) => {
    const opt = filtered[idx];
    if (!opt) return;
    onChange && onChange(opt.value);
  setQuery(opt.label ?? opt.value ?? '');
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
    typedRef.current = false;
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') { setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0))); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHighlight((h) => Math.max(h - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      if (filtered.length > 0) selectAt(highlight);
      else if (allowCustom) { onChange && onChange(query.trim()); setOpen(false); }
      e.preventDefault();
    }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className={`combo ${className}`} ref={containerRef}>
      <input
        ref={inputRef}
        className="input combo-input"
        type="text"
        value={query}
        placeholder={loading ? 'Loading…' : placeholder}
        onChange={(e) => { typedRef.current = true; setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setOpen(true); setTimeout(() => { try { inputRef.current?.select(); } catch {} }, 0); }}
        onBlur={() => {
          if (allowCustom) {
            const trimmed = String(query || '').trim();
            const hasExact = (options || []).some(o => String(o.label) === trimmed || String(o.value) === trimmed);
            // If no exact option and user typed something, persist it as the selected value
            if (!hasExact && trimmed) onChange && onChange(trimmed);
          }
          typedRef.current = false;
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        aria-expanded={open}
  aria-haspopup="listbox"
        aria-autocomplete="list"
        role="combobox"
        aria-controls={listId}
  aria-activedescendant={open && filtered.length ? `${listId}-opt-${highlight}` : undefined}
      />
      {open && (
        <div className="combo-menu" role="listbox" id={listId}>
          {loading ? (
            <div className="combo-option muted">Loading…</div>
          ) : filtered.length > 0 ? (
            filtered.map((o, i) => (
              <div
                key={o.value}
                role="option"
                className={`combo-option${i === highlight ? ' is-active' : ''}`}
                aria-selected={String(o.value) === String(value)}
    id={`${listId}-opt-${i}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); selectAt(i); }}
              >
                {o.label}
              </div>
            ))
          ) : allowCustom && String(query || '').trim() ? (
            <div
              className="combo-option"
              role="option"
              aria-selected="false"
        id={`${listId}-opt-custom`}
              onMouseDown={(e) => { e.preventDefault(); onChange && onChange(String(query).trim()); setOpen(false); typedRef.current = false; }}
            >
              Use “{String(query).trim()}”
            </div>
          ) : (
            <div className="combo-option muted">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TagSearchPage() {
  const navigate = useNavigate();
  const [combine, setCombine] = useState('AND'); // AND | OR
  const [rows, setRows] = useState([{ key: '', value: '', op: 'eq' }]); // op: eq|contains|notcontains
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [saved, setSaved] = useState([]);
  const [savedIdx, setSavedIdx] = useState(-1);
  const [saveName, setSaveName] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [tagKeyOptions, setTagKeyOptions] = useState([]); // [{ value: 'ProjectName', label: 'ProjectName' }]

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;
    const unsub = onSnapshot(collection(db, 'users', u.uid, 'saved_searches'), (snap) => {
      const list = [];
      snap.forEach(d => {
        const data = d.data() || {};
        const r = Array.isArray(data.rows) ? data.rows.map(r => ({ key: String(r.key || '').trim(), value: String(r.value ?? ''), op: (r.op === 'contains' || r.op === 'notcontains') ? r.op : 'eq' })) : [];
        list.push({ id: d.id, name: data.name || '(unnamed)', rows: r, text: data.text || '', scope: !!data.scope, combine: (data.combine === 'OR' ? 'OR' : 'AND'), createdAt: data.createdAt || 0 });
      });
      list.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
      setSaved(list);
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  // Folder scoping removed for now

  const run = async () => {
    try {
      setBusy(true); setError(''); setResults([]);
      const r = (rows || []).map(x => ({ key: String(x.key || '').trim(), value: String(x.value ?? ''), op: (x.op === 'contains' || x.op === 'notcontains') ? x.op : 'eq' })).filter(x => x.key && x.value);
      const cmb = (combine === 'OR') ? 'OR' : 'AND';
      const canServer = (cmb === 'AND') && r.length > 0 && r.every(x => x.op === 'eq');

      const clientMatch = (tags, data) => {
        const evalRow = (row) => {
          const val = String((tags || {})[row.key] ?? '').toLowerCase();
          const vv = String(row.value || '').toLowerCase();
          if (row.op === 'eq') return val === vv;
          if (row.op === 'contains') return val.includes(vv);
          if (row.op === 'notcontains') return !val.includes(vv);
          return false;
        };
  const ok = r.length === 0 ? true : (cmb === 'AND' ? r.every(evalRow) : r.some(evalRow));
  return ok;
      };

      const buildItem = (d, data) => {
        const tags = (data.tags && typeof data.tags === 'object') ? data.tags : {};
        if (!clientMatch(tags, data)) return null;
        return {
          id: data.fullPath || d.id,
          name: data.name || (data.fullPath ? data.fullPath.split('/').pop() : d.id),
          path: (function() {
            // Prefer stored path if available; else derive from fullPath; else root
            const p = String(data.path || '').trim();
            if (p) return p;
            const fp = String(data.fullPath || '').replace(/\\/g,'/');
            if (fp.includes('/')) return '/' + fp.substring(0, fp.lastIndexOf('/'));
            return ROOT_PATH;
          })(),
          ref: data.fullPath ? ref(storage, data.fullPath) : null,
          size: data.size,
          type: data.type,
          tags,
          ownerUid: data.uploadedByUid,
        };
      };

      if (canServer) {
        try {
          let q = fsQuery(collection(db, 'files'));
          for (const c of r) q = fsQuery(q, where(`tags.${c.key}`, '==', c.value));
          // No folder scoping; limit results
          q = fsQuery(q, limit(300));
          const snap = await getDocs(q);
          const items = [];
          snap.forEach(d => {
            const data = d.data() || {};
            const item = buildItem(d, data);
            if (item) items.push(item);
          });
          setResults(items);
        } catch (e) {
          // Fallback without index: scan a page and client-filter
          const snap = await getDocs(fsQuery(collection(db, 'files'), limit(1000)));
          const items = [];
          snap.forEach(d => {
            const data = d.data() || {};
            const item = buildItem(d, data);
            if (item) items.push(item);
          });
          setResults(items);
          setError('Tip: Add a composite index for these tag filters to speed up this search.');
        }
      } else {
        // OR/Contains/NotContains or no rows: scan a page and filter client-side
        const snap = await getDocs(fsQuery(collection(db, 'files'), limit(1000)));
        let items = [];
        snap.forEach(d => {
          const data = d.data() || {};
          const item = buildItem(d, data);
          if (item) items.push(item);
        });
        setResults(items);
      }
    } catch (e) {
      setError(e?.message || 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const u = auth.currentUser; if (!u) { setError('Sign in required'); return; }
    const name = (saveName || '').trim(); if (!name) { setError('Enter a name'); return; }
    try {
      setSaveBusy(true); setError('');
      const r = (rows || []).map(x => ({ key: String(x.key || '').trim(), value: String(x.value ?? ''), op: (x.op === 'contains' || x.op === 'notcontains') ? x.op : 'eq' }));
      await addDoc(collection(db, 'users', u.uid, 'saved_searches'), {
        name,
        rows: r,
        scope: true,
        combine: combine === 'OR' ? 'OR' : 'AND',
        createdAt: Date.now(),
      });
      setSaveName('');
    } catch (e) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaveBusy(false);
    }
  };

  const applySaved = (s) => {
    if (!s) return;
    setRows((Array.isArray(s.rows) && s.rows.length) ? s.rows.map(r => ({ key: r.key || '', value: r.value || '', op: (r.op === 'contains' || r.op === 'notcontains') ? r.op : 'eq' })) : [{ key: '', value: '', op: 'eq' }]);
    setCombine(s.combine === 'OR' ? 'OR' : 'AND');
    run();
  };

  const delSaved = async (s) => {
    const u = auth.currentUser; if (!u || !s?.id) return;
    try { await deleteDoc(doc(db, 'users', u.uid, 'saved_searches', s.id)); } catch {}
  };

  const revealInDashboard = (path) => {
    try { localStorage.setItem('jumpToPath', String(path || ROOT_PATH)); } catch {}
    navigate('/dashboard');
  };

  const openPreview = (file) => setPreviewFile(file || null);
  const closePreview = () => setPreviewFile(null);
  const handleDownload = async (file) => {
    try {
      const fullPath = file?.ref?.fullPath || file?.id || '';
      if (!fullPath) return;
      const url = await getDownloadURL(ref(storage, fullPath));
      const a = document.createElement('a');
      a.href = url;
      a.download = file?.name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (_) {}
  };

  // Build Tag Name options from defaults + saved searches + current results + current rows
  useEffect(() => {
    const defaults = ['ProjectName', 'Value', 'Reciepent', 'Date', 'ExpenseName'];
    const fromSaved = saved.flatMap(s => (Array.isArray(s.rows) ? s.rows.map(r => r.key || '') : []));
    const fromResults = results.flatMap(f => Object.keys(f.tags || {}));
    const fromRows = rows.map(r => r.key || '');
    const all = [...defaults, ...fromSaved, ...fromResults, ...fromRows]
      .map(k => String(k || '').trim())
      .filter(Boolean);
    const uniq = Array.from(new Set(all)).sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    setTagKeyOptions(uniq.map(k => ({ value: k, label: k })));
  }, [saved, results, rows]);

  return (
    <div className="tag-search-page">
      <div className="search-header">
        <Link to="/dashboard" className="back-link">← Back</Link>
  <h2>Receipt Search</h2>
      </div>

  <div className="search-card">
        <div className="match-row" aria-label="Match mode">
          <span className="label">Match</span>
          <div className="segmented" role="tablist" aria-label="Combine conditions">
            <button
              type="button"
              className={`seg-btn${combine === 'AND' ? ' active' : ''}`}
              onClick={() => setCombine('AND')}
              role="tab"
              aria-selected={combine === 'AND'}
            >
              All (AND)
            </button>
            <button
              type="button"
              className={`seg-btn${combine === 'OR' ? ' active' : ''}`}
              onClick={() => setCombine('OR')}
              role="tab"
              aria-selected={combine === 'OR'}
            >
              Any (OR)
            </button>
          </div>
        </div>
        <div className="conditions-head">
          <div>Tag Name</div>
          <div>Operator</div>
          <div>Value</div>
          <div className="right">Actions</div>
        </div>
        {(rows || []).map((row, idx) => (
          <div key={idx} className="condition-row">
            <SearchableComboBox
              options={tagKeyOptions}
              value={row.key}
              onChange={(v) => setRows(prev => prev.map((r,i) => i===idx ? { ...r, key: v } : r))}
              placeholder="Tag Name"
              allowCustom
            />
            <select className="input" value={row.op || 'eq'} onChange={(e) => setRows(prev => prev.map((r,i) => i===idx ? { ...r, op: (e.target.value === 'contains' || e.target.value === 'notcontains') ? e.target.value : 'eq' } : r))}>
              <option value="eq">Equals</option>
              <option value="contains">Contains</option>
              <option value="notcontains">Doesn't contain</option>
            </select>
            <SearchableComboBox
              options={(function buildTagValues() {
                const k = String(row.key || '').trim();
                if (!k) return [];
                const fromSaved = saved.flatMap(s => (Array.isArray(s.rows) ? s.rows.filter(r => (r.key || '') === k).map(r => r.value || '') : []));
                const fromResults = results.flatMap(f => (f.tags && f.tags[k] != null ? [String(f.tags[k])] : []));
                const fromRows = rows.filter(r => (r.key || '') === k).map(r => r.value || '');
                const all = [...fromSaved, ...fromResults, ...fromRows]
                  .map(v => String(v || '').trim())
                  .filter(Boolean);
                const uniq = Array.from(new Set(all)).sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                return uniq.map(v => ({ value: v, label: v }));
              })()}
              value={row.value}
              onChange={(v) => setRows(prev => prev.map((r,i) => i===idx ? { ...r, value: v } : r))}
              placeholder="Value"
              allowCustom
            />
            <div className="row-actions">
              <button className="btn" onClick={() => setRows(prev => { const next = prev.filter((_,i)=>i!==idx); return next.length ? next : [{ key: '', value: '', op: 'eq' }]; })}>Remove</button>
            </div>
          </div>
        ))}
        <div className="conditions-footer">
          <button className="btn primary" onClick={run} disabled={busy}>
            <FaSearch style={{ marginRight: 6 }} /> {busy ? 'Searching…' : 'Search'}
          </button>
          <button className="btn" onClick={() => setRows(prev => [...prev, { key: '', value: '', op: 'eq' }])}><FaPlus style={{ marginRight: 6 }} /> Add Condition</button>
          <button className="btn" onClick={() => { setRows([{ key: '', value: '', op: 'eq' }]); setResults([]); setError(''); setCombine('AND'); }}>Clear</button>
        </div>

  <div className="toolbar-row">
          <div className="saved-block">
            <span className="label">Saved</span>
            <div className="saved-controls">
              <select
                className="input"
                value={savedIdx >= 0 ? String(savedIdx) : ''}
                onChange={(e) => {
                  const i = e.target.value === '' ? -1 : Number(e.target.value);
                  setSavedIdx(i);
                  if (!Number.isNaN(i) && i >= 0 && saved[i]) applySaved(saved[i]);
                }}
              >
                <option value="">Select…</option>
                {saved.map((s, i) => (<option key={s.id} value={i}>{s.name}</option>))}
              </select>
              <button
                className="btn icon danger"
                onClick={() => { if (savedIdx >= 0 && saved[savedIdx]) delSaved(saved[savedIdx]); }}
                disabled={savedIdx < 0}
                title="Delete saved search"
              >
                <FaTrash />
              </button>
            </div>
          </div>
          <div className="save-controls">
            <input className="input" type="text" placeholder="Save as…" value={saveName} onChange={e => setSaveName(e.target.value)} />
            <button className="btn primary" onClick={save} disabled={saveBusy || !saveName.trim()}>{saveBusy ? 'Saving…' : 'Save Search'}</button>
          </div>
        </div>

        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="results-card">
        <div className="results-head">Results: {results.length}</div>
        {results.length === 0 ? (
          <div className="empty">No matching files. Try adjusting conditions.</div>
        ) : (
          <div className="results-list">
            {results.map((f) => (
              <div key={f.id} className="result-item">
                <div className="file-icon"><MacFileIcon className="file-icon-inner" type={String(f.type || '').includes('pdf') ? 'pdf' : (String(f.type || '').startsWith('image/') ? 'image' : undefined)} /></div>
                <div className="file-main">
                  <div className="file-name" title={f.name}>{f.name}</div>
                  <div className="file-path" title={f.path}>{f.path}</div>
                  <div className="file-tags">
                    {f.tags && Object.entries(f.tags).map(([k,v]) => (
                      <span key={k} className="tag-pill">{k}{String(v??'')!==''?`=${v}`:''}</span>
                    ))}
                  </div>
                </div>
                <div className="file-actions">
                  <button className="btn icon" title="Preview" onClick={() => openPreview(f)}><FaEye /></button>
                  <button className="btn icon" title="Download" onClick={() => handleDownload(f)}><FaDownload /></button>
                  <button className="btn" onClick={() => revealInDashboard(f.path)}>Reveal</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewFile && (
        <FilePreview
          file={previewFile}
          onClose={closePreview}
          userRole="viewer"
          userId={auth.currentUser?.uid || ''}
          onFileAction={() => {}}
        />
      )}
    </div>
  );
}
