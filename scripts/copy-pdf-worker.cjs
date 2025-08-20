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

function findWorker() {
  // Prefer the worker from the pdfjs-dist that react-pdf depends on to avoid version mismatch
  const candidates = [
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    'node_modules/pdfjs-dist/build/pdf.worker.mjs',
    'node_modules/pdfjs-dist/build/pdf.worker.min.js',
    'node_modules/pdfjs-dist/build/pdf.worker.js'
  ];

  // Try resolving relative to react-pdf package first
  try {
    const reactPdfPath = require.resolve('react-pdf');
    const reactPdfDir = require('path').dirname(reactPdfPath);
    const workerFromReactPdf = resolveWithCandidates(reactPdfDir, candidates);
    if (workerFromReactPdf) {
      return { path: workerFromReactPdf, source: 'react-pdf/pdfjs-dist' };
    }
  } catch (_) { /* react-pdf not found or resolution failed */ }

  // Fallback to top-level pdfjs-dist
  const topLevel = resolveWithCandidates(null, [
    'pdfjs-dist/build/pdf.worker.min.mjs',
    'pdfjs-dist/build/pdf.worker.mjs',
    'pdfjs-dist/build/pdf.worker.min.js',
    'pdfjs-dist/build/pdf.worker.js'
  ]);
  if (topLevel) {
    return { path: topLevel, source: 'top-level/pdfjs-dist' };
  }
  return { path: null, source: 'not-found' };
}

function main() {
  const { path: workerPath, source } = findWorker();
  if (!workerPath) {
    console.error('⚠️ Could not locate pdf.js worker in node_modules/pdfjs-dist.');
    process.exit(0);
  }
  const projectRoot = process.cwd();
  const publicDir = path.join(projectRoot, 'public');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const dst = path.join(publicDir, 'pdf.worker.min.mjs');
  try {
    fs.copyFileSync(workerPath, dst);
    // Try to read version of the pdfjs-dist we copied from for visibility
    let version = 'unknown';
    try {
      const pkgJsonPath = require('path').join(require('path').dirname(workerPath), '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      version = pkg.version || version;
    } catch (_) { /* ignore */ }
    console.log(`✅ Copied PDF worker (${source}, v${version}) to ${path.relative(projectRoot, dst)}`);
  } catch (e) {
    console.error('❌ Failed to copy PDF worker:', e.message);
    process.exit(1);
  }
}

main();
