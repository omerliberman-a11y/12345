#!/usr/bin/env node
// Refresh data/catalog.json from the public catalog API, then rebuild.
//   node scripts/fetch-catalog.mjs [url=https://system-compare.com/api/catalog]
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.argv[2] || 'https://system-compare.com/api/catalog';
const file = path.join(ROOT, 'data/catalog.json');

const res = await fetch(url, { headers: { accept: 'application/json' } });
if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
const text = await res.text();
const next = JSON.parse(text); // throws on a truncated/invalid response
for (const key of ['categories', 'vendors', 'guides', 'comparisons', 'pages']) {
  if (!next[key]) throw new Error(`catalog is missing "${key}" — not overwriting ${file}`);
}
let prev = null;
try {
  prev = JSON.parse(await readFile(file, 'utf8'));
} catch {}
await writeFile(file, text);
const n = (c) => `${c.categories.length} categories, ${c.vendors.length} vendors, ${c.guides.length} guides, ${c.comparisons.length} comparisons`;
console.log(`saved ${file}\n  now:    ${n(next)} (checkedAt ${next.checkedAt})`);
if (prev) console.log(`  before: ${n(prev)} (checkedAt ${prev.checkedAt})`);
console.log('next: node build.mjs && node scripts/check.mjs dist');
