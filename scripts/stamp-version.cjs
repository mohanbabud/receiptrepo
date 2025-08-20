#!/usr/bin/env node
const { writeFileSync, readFileSync } = require('fs');
const { join } = require('path');
const manifestPath = join(__dirname, '..', 'build', 'asset-manifest.json');
let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) {
  console.error('stamp-version: unable to read asset-manifest.json');
  process.exit(1);
}
const mainJs = manifest.files && manifest.files['main.js'];
const mainCss = manifest.files && manifest.files['main.css'];
const stamp = {
  timestamp: new Date().toISOString(),
  mainJs,
  mainCss,
};
writeFileSync(join(__dirname, '..', 'build', 'version.txt'), JSON.stringify(stamp, null, 2));
console.log('Version stamp written:', stamp);
