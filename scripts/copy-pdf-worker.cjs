#!/usr/bin/env node
// Copy PDF.js worker from pdfjs-dist into public so it can be served at /pdf.worker.min.mjs
const fs = require('fs');
const path = require('path');

function resolveWithCandidates(base, candidates) {
  for (const rel of candidates) {
    try {
      const toResolve = base ? require('path').join(base, rel) : rel;
      const p = require.resolve(toResolve);
      return p;
    } catch (_) { /* try next */ }
  }
  return null;
}

function findWorkers() {
  // Prefer the worker from the pdfjs-dist that react-pdf depends on to avoid version mismatch
  const mjsCandidates = [
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    'node_modules/pdfjs-dist/build/pdf.worker.mjs'
  ];
  const jsCandidates = [
    'node_modules/pdfjs-dist/build/pdf.worker.min.js',
    'node_modules/pdfjs-dist/build/pdf.worker.js'
  ];

  const results = { mjs: null, js: null, source: 'not-found' };

  // Try resolving relative to react-pdf package first
  try {
    const reactPdfPath = require.resolve('react-pdf');
    const reactPdfDir = require('path').dirname(reactPdfPath);
    const mjs = resolveWithCandidates(reactPdfDir, mjsCandidates);
    const js = resolveWithCandidates(reactPdfDir, jsCandidates);
    if (mjs || js) {
      results.mjs = mjs;
      results.js = js;
      results.source = 'react-pdf/pdfjs-dist';
      return results;
    }
  } catch (_) { /* ignore */ }

  // Fallback to top-level pdfjs-dist
  const topMjs = resolveWithCandidates(null, [
    'pdfjs-dist/build/pdf.worker.min.mjs',
    'pdfjs-dist/build/pdf.worker.mjs'
  ]);
  const topJs = resolveWithCandidates(null, [
    'pdfjs-dist/build/pdf.worker.min.js',
    'pdfjs-dist/build/pdf.worker.js'
  ]);
  if (topMjs || topJs) {
    results.mjs = topMjs;
    results.js = topJs;
    results.source = 'top-level/pdfjs-dist';
    return results;
  }
  return results;
}

function main() {
  const { mjs, js, source } = findWorkers();
  if (!mjs && !js) {
    console.error('⚠️ Could not locate pdf.js worker in node_modules/pdfjs-dist.');
    process.exit(0);
  }
  const projectRoot = process.cwd();
  const publicDir = path.join(projectRoot, 'public');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

  let version = 'unknown';
  const anyPath = mjs || js;
  try {
    const pkgJsonPath = require('path').join(require('path').dirname(anyPath), '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    version = pkg.version || version;
  } catch (_) {}

  if (mjs) {
    const dstMjs = path.join(publicDir, 'pdf.worker.min.mjs');
    try { fs.copyFileSync(mjs, dstMjs); console.log(`✅ Copied MJS PDF worker (${source}, v${version}) → ${path.relative(projectRoot, dstMjs)}`); } catch (e) { console.error('❌ Failed to copy MJS worker:', e.message); }
  }
  if (js) {
    const dstJs = path.join(publicDir, 'pdf.worker.min.js');
    try { fs.copyFileSync(js, dstJs); console.log(`✅ Copied JS PDF worker (${source}, v${version}) → ${path.relative(projectRoot, dstJs)}`); } catch (e) { console.error('❌ Failed to copy JS worker:', e.message); }
  } else if (mjs) {
    // Fallback: also provide a .js copy of the MJS worker so dev servers that don't set correct MIME for .mjs still work
    const dstJs = path.join(publicDir, 'pdf.worker.min.js');
    try { fs.copyFileSync(mjs, dstJs); console.log(`ℹ️  No JS worker found; copied MJS as JS → ${path.relative(projectRoot, dstJs)}`); } catch (e) { console.error('❌ Failed to create JS fallback from MJS:', e.message); }
  }
}

main();
