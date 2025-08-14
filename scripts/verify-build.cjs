#!/usr/bin/env node
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const buildDir = join(__dirname, '..', 'build');
const manifestPath = join(buildDir, 'asset-manifest.json');
const indexPath = join(buildDir, 'index.html');
if(!existsSync(manifestPath) || !existsSync(indexPath)){
  console.error('verify-build: build artifacts missing');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath,'utf8'));
const indexHtml = readFileSync(indexPath,'utf8');
const mainJs = manifest.files['main.js'];
if(!mainJs){
  console.error('verify-build: main.js entry missing in manifest');
  process.exit(1);
}
if(!indexHtml.includes(mainJs)){
  console.error('verify-build: index.html does not reference', mainJs);
  process.exit(2);
}
console.log('verify-build: OK main asset', mainJs);
