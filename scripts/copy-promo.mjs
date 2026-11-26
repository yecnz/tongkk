#!/usr/bin/env node
// Copy the standalone promo's published files after Vite has cleaned and built dist/.
// Keep source, test and build scripts out of the public deployment.
import { cpSync, mkdirSync } from 'node:fs';

const source = new URL('../promo/', import.meta.url);
const destination = new URL('../dist/promo/', import.meta.url);
const files = [
  'index.html', 'styles.css', 'script.js',
  'demo.js', 'demo.css', 'third-party-notices.txt',
  'features.html', 'features.js', 'features.css', 'features-third-party-notices.txt',
  'assets',
];

mkdirSync(destination, { recursive: true });
for (const file of files) {
  cpSync(new URL(file, source), new URL(file, destination), { recursive: true });
}
console.log('Standalone promo copied to dist/promo/');
