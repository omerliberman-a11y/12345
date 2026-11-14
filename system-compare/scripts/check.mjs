#!/usr/bin/env node
// Static QA for a build:  node scripts/check.mjs [dir=dist] [--json] [--max=40]
// Checks every HTML file for broken internal links/anchors, SEO basics (one h1, title, description,
// canonical, valid JSON-LD), duplicate ids, images without alt, template leaks ("undefined", "NaN"…)
// and reports size budgets. Exit code 1 when errors are found.
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const dir = path.resolve(ROOT, argv.find((a) => !a.startsWith('--')) || 'dist');
const asJson = argv.includes('--json');
const max = Number((argv.find((a) => a.startsWith('--max=')) || '--max=40').split('=')[1]);

async function walk(d) {
  const out = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = await walk(dir);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const fileSet = new Set(files);
const errors = [];
const warnings = [];
const err = (file, msg) => errors.push({ file: path.relative(dir, file), msg });
const warn = (file, msg) => warnings.push({ file: path.relative(dir, file), msg });

const idsByFile = new Map();
const pages = [];

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

for (const file of htmlFiles) {
  const src = await readFile(file, 'utf8');
  const noScript = src.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const ids = new Set();
  const dupIds = new Set();
  for (const m of noScript.matchAll(/\sid="([^"]+)"/g)) {
    if (ids.has(m[1])) dupIds.add(m[1]);
    ids.add(m[1]);
  }
  idsByFile.set(file, ids);
  const links = [...noScript.matchAll(/<(a|link|script|img|source|form|iframe)\b[^>]*?\s(href|src|action)="([^"]*)"/gi)].map((m) => ({
    tag: m[1].toLowerCase(),
    url: decode(m[3]),
  }));
  for (const m of src.matchAll(/<script\b[^>]*\ssrc="([^"]*)"/gi)) links.push({ tag: 'script', url: decode(m[1]) });
  pages.push({ file, src, noScript, links, dupIds });
}

for (const pg of pages) {
  const { file, src, noScript, links, dupIds } = pg;
  const rel = path.relative(dir, file);
  const is404 = rel === '404.html';

  // ---- head
  const title = (src.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  const desc = (src.match(/<meta name="description" content="([^"]*)"/i) || [])[1];
  const canonical = (src.match(/<link rel="canonical" href="([^"]*)"/i) || [])[1];
  const robots = (src.match(/<meta name="robots" content="([^"]*)"/i) || [])[1] || '';
  pg.title = title && decode(title);
  pg.desc = desc && decode(desc);
  pg.canonical = canonical;
  pg.noindex = /noindex/.test(robots);
  if (!title) err(file, 'missing <title>');
  else if (decode(title).length > 65) warn(file, `title ${decode(title).length} chars: "${decode(title)}"`);
  if (!desc) err(file, 'missing meta description');
  else if (decode(desc).length > 165 || decode(desc).length < 50) warn(file, `meta description ${decode(desc).length} chars`);
  if (!is404) {
    if (!canonical) err(file, 'missing canonical');
    else if (!/^https:\/\//.test(canonical)) err(file, `canonical not absolute: ${canonical}`);
  }
  if (!/<html[^>]*\slang="/i.test(src)) err(file, 'missing <html lang>');
  if (!/<meta name="viewport"/i.test(src)) err(file, 'missing viewport meta');

  // ---- body structure
  const h1s = [...noScript.matchAll(/<h1\b/gi)].length;
  if (h1s !== 1) err(file, `expected exactly one <h1>, found ${h1s}`);
  let last = 0;
  for (const m of noScript.matchAll(/<h([1-6])\b/gi)) {
    const lvl = Number(m[1]);
    if (last && lvl > last + 1) {
      warn(file, `heading level skips h${last} → h${lvl}`);
      break;
    }
    last = lvl;
  }
  if (!/<main\b/i.test(noScript)) err(file, 'missing <main>');
  for (const id of dupIds) err(file, `duplicate id="${id}"`);
  for (const m of noScript.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\salt="/i.test(m[0])) err(file, `img without alt: ${m[0].slice(0, 90)}`);
    if (!/\swidth="/i.test(m[0]) || !/\sheight="/i.test(m[0])) warn(file, `img without width/height: ${m[0].slice(0, 90)}`);
  }
  // template leaks
  const bodyText = noScript.replace(/<[^>]+>/g, ' ');
  for (const bad of ['undefined', '[object Object]', 'NaN', 'null/100', '__BASE__']) {
    const re = new RegExp(`(^|[^\\w-])${bad.replace(/[[\]]/g, '\\$&')}([^\\w-]|$)`);
    if (re.test(bodyText) || (bad === '__BASE__' && src.includes(bad))) err(file, `template leak: "${bad}"`);
  }
  if (/\s(href|src)="(undefined|null|)"/.test(noScript)) err(file, 'empty/undefined href or src');
  // empty links / buttons
  for (const m of noScript.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const inner = m[2].replace(/<[^>]+>/g, '').trim();
    if (!inner && !/aria-label=|title=/.test(m[1]) && !/<img[^>]*alt="[^"]+"/.test(m[2]) && !/<svg[^>]*aria-label=/.test(m[2]))
      err(file, `link without accessible name: ${m[0].slice(0, 100)}`);
  }
  for (const m of noScript.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const inner = m[2].replace(/<[^>]+>/g, '').trim();
    if (!inner && !/aria-label=|title=/.test(m[1])) err(file, `button without accessible name: ${m[0].slice(0, 100)}`);
  }

  // ---- JSON-LD
  for (const m of src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const graph = j['@graph'] || [j];
      for (const node of graph) if (!node['@type']) err(file, 'JSON-LD node without @type');
    } catch (e) {
      err(file, `invalid JSON-LD: ${e.message}`);
    }
  }

  // ---- links
  for (const { url, tag } of links) {
    if (!url) continue;
    if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(url)) continue;
    const [p, frag] = url.split('#');
    let target;
    if (p === '' || p === undefined) target = file;
    else {
      const clean = p.split('?')[0];
      const base = clean.startsWith('/') ? path.join(dir, clean) : path.resolve(path.dirname(file), clean);
      target = base;
      if (clean.endsWith('/') || (existsSync(base) && !fileSet.has(base))) target = path.join(base, 'index.html');
    }
    if (!fileSet.has(target)) {
      err(file, `broken ${tag} link: ${url}`);
      continue;
    }
    if (frag && target.endsWith('.html')) {
      const ids = idsByFile.get(target);
      if (ids && !ids.has(decodeURIComponent(frag)) && frag !== 'top') err(file, `broken anchor: ${url}`);
    }
  }

  const bytes = Buffer.byteLength(src);
  if (bytes > 300 * 1024) warn(file, `page weighs ${(bytes / 1024).toFixed(0)} KB`);
}

// duplicates across pages
const seenTitle = new Map();
const seenDesc = new Map();
const seenCanon = new Map();
for (const pg of pages) {
  if (pg.noindex) continue;
  const rel = path.relative(dir, pg.file);
  if (pg.title) seenTitle.set(pg.title, [...(seenTitle.get(pg.title) || []), rel]);
  if (pg.desc) seenDesc.set(pg.desc, [...(seenDesc.get(pg.desc) || []), rel]);
  if (pg.canonical) seenCanon.set(pg.canonical, [...(seenCanon.get(pg.canonical) || []), rel]);
}
for (const [t, fs] of seenTitle) if (fs.length > 1) errors.push({ file: fs.slice(0, 3).join(', '), msg: `duplicate title (${fs.length} pages): "${t}"` });
for (const [t, fs] of seenDesc) if (fs.length > 1) warnings.push({ file: fs.slice(0, 3).join(', '), msg: `duplicate meta description (${fs.length} pages)` });
for (const [t, fs] of seenCanon) if (fs.length > 1) errors.push({ file: fs.slice(0, 3).join(', '), msg: `duplicate canonical ${t}` });

const sizes = pages.map((p) => Buffer.byteLength(p.src)).sort((a, b) => a - b);
const summary = {
  dir,
  htmlPages: pages.length,
  files: files.length,
  errors: errors.length,
  warnings: warnings.length,
  medianHtmlKB: +(sizes[Math.floor(sizes.length / 2)] / 1024).toFixed(1),
  maxHtmlKB: +(sizes[sizes.length - 1] / 1024).toFixed(1),
  totalHtmlMB: +(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1),
};

if (asJson) {
  console.log(JSON.stringify({ summary, errors, warnings }, null, 1));
} else {
  const group = (list) => {
    const by = new Map();
    for (const e of list) {
      const key = e.msg.replace(/"[^"]*"/g, '"…"').replace(/: .*$/, '');
      by.set(key, [...(by.get(key) || []), e]);
    }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  console.log(summary);
  if (errors.length) {
    console.log(`\nERRORS (${errors.length})`);
    for (const [k, list] of group(errors).slice(0, max)) {
      console.log(`  ✗ ${k}  ×${list.length}`);
      for (const e of list.slice(0, 3)) console.log(`      ${e.file} — ${e.msg.slice(0, 160)}`);
    }
  }
  if (warnings.length) {
    console.log(`\nWARNINGS (${warnings.length})`);
    for (const [k, list] of group(warnings).slice(0, max)) {
      console.log(`  ! ${k}  ×${list.length}`);
      for (const e of list.slice(0, 2)) console.log(`      ${e.file} — ${e.msg.slice(0, 160)}`);
    }
  }
}
process.exit(errors.length ? 1 : 0);
