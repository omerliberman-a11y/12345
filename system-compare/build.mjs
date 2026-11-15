#!/usr/bin/env node
// System Compare — static site build. Zero dependencies (Node >= 20).
//
//   node build.mjs                      full build into ./dist (relative links, works at any base path)
//   node build.mjs --out=/tmp/x         build somewhere else
//   node build.mjs --only=category,vs   render only some page modules (assets + generators still run)
//   node build.mjs --links=absolute --base=/        root-absolute links (classic production output)
//   node build.mjs --links=portable     relative links ending in index.html (works from file:// and zip previews)
//   node build.mjs --strict             exit 1 on any page error
//   node build.mjs --outbound=direct    vendor links go straight to the vendor (hosts without the /go/ service)
//   node build.mjs --index=gated        also index generated /vs/ and /alternatives/ pages that pass the quality gate
//   node build.mjs --css=single|all     one stylesheet per page type / every page stylesheet everywhere (see below)
//
// Output that may be cached forever has a content hash in its name (/assets/css/, /assets/js/, /assets/fonts/,
// /assets/articles/sized/); /data/*.js is versioned by a hash of all generated data files. HOSTING.md has the policy.
//
// Page modules live in src/pages/*.mjs and export `routes(ctx)` → [{ path, render(ctx) → page }].
// Generators live in src/gen/*.mjs and export `generate(ctx, emit)`.

import { readdir, readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const OUT = path.resolve(ROOT, args.out || 'dist');
const LINKS = args.links || 'relative'; // relative | absolute | portable
const BASE = (args.base || '/').replace(/\/?$/, '/');
const ONLY = args.only ? String(args.only).split(',') : null;
const STRICT = !!args.strict;
const QUIET = !!args.quiet;

const t0 = performance.now();
const log = (...a) => QUIET || console.log(...a);
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

// ---------------------------------------------------------------- assets
// CSS (in /assets/css/; scripts in /assets/js/): every page blocks on at most two stylesheets, the shared core
// and one file for its page type:
//   site.<hash>.css                 tokens + base + layout + shared components (every page)
//   p-<name>.<hash>.css             src/assets/css/pages/<name>.css, for the page types mapped to it below
//   p-<name>-plus-<other>.<hash>.css  a page type whose pages also use rules of another page file: its own file
//                                   plus only those rules of the other file that can match on its pages
// A page borrows from another page file only when one of that file's selectors can match there: every class the
// selector needs is in the page's HTML or is set by a script, and one of them belongs to that file alone. So a
// stray class (".commercial-link--ad" is styled only inside ".sw-kf") never pulls a whole stylesheet in.
// --css=single folds site.css into each page-type file (one request per page, no shared core file). Measured on
// real Slow 4G it was slower: +24-40 ms FCP on a first view and +48-68 ms on each further page type, 34 KB more CSS
// over a 4-page visit, because the shared core is no longer cached once. Kept only for comparison.
// --css=all links every page file on every page (regression baseline).
const CSS_MODE = ['single', 'all'].includes(args.css) ? args.css : 'split';
const CSS_ORDER = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'utilities.css'];
const PAGE_CSS = {
  home: ['home'], category: ['category'], software: ['software'], vs: ['compare'], compare: ['compare'],
  'category-factual': ['factual'], 'vs-factual': ['factual'], 'vs-editorial': ['factual'],
  categories: ['indexes'], 'software-index': ['indexes'], alternatives: ['indexes'], comparisons: ['indexes'],
  shortlist: ['tools'], cost: ['tools'], guides: ['guides'], ai: ['guides'], 'research-updates': ['guides'],
  static: ['static'], countries: ['static'], contact: ['static'], 'partners-apply': ['static'],
  faq: ['search'], search: ['search'], notfound: ['search'],
};

// src/assets/static is copied verbatim to the site root, except these files, which only the build output links to:
// they get a content hash in their name so a host can cache them forever (HOSTING.md). Everything else keeps its
// name because other sites, social caches or the catalog link to it (og:images, logos, brand icons, legacy images).
const HASHED_STATIC = /^assets\/(?:fonts\/[^/]+\.woff2|articles\/sized\/[^/]+\.(?:webp|jpe?g|png|avif))$/;
const withHash = (rel, buf) => rel.replace(/(\.[a-z0-9]+)$/i, `.${hash(buf)}$1`);
/** Every file below a directory, as "a/b/c.ext" paths relative to it. */
async function filesUnder(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesUnder(p, base)));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
// Placeholders the page shell is rendered with; main() fills them in once the generated files exist.
const DATA_VERSION_SLOT = '__SC_DATA_VERSION__';
const cssSlot = (key) => `__SC_CSS:${key}__`;

/** Whitespace/comment minifier that never touches strings or url(...) values. */
function minifyCss(css) {
  const keep = [];
  const stash = (m) => `\u0000${keep.push(m) - 1}\u0000`;
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, stash)
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/\s*>\s*/g, '>')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .replace(/\u0000(\d+)\u0000/g, (m, i) => keep[Number(i)])
    .trim();
}
const cssClasses = (css) => new Set([...css.replace(/url\([^)]*\)/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

/**
 * Blocks of minified CSS: style rules { prelude, body }, grouping rules (@media, @supports …) { prelude, kids },
 * statements (@import …;) { raw }. Braces inside strings are respected.
 */
function cssBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    let j = i, q = null, depth = 0, open = -1;
    for (; j < css.length; j++) {
      const ch = css[j];
      if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === ';' && open < 0) break; // a statement at-rule
      else if (ch === '{') { if (open < 0) open = j; depth++; }
      else if (ch === '}' && --depth === 0) break;
    }
    if (open < 0) {
      const raw = css.slice(i, j + 1).trim();
      if (raw && raw !== ';') out.push({ raw });
    } else {
      const prelude = css.slice(i, open).trim();
      const inner = css.slice(open + 1, j);
      out.push(/^@(?:media|supports|container|layer|document)\b/i.test(prelude) ? { prelude, kids: cssBlocks(inner) } : { prelude, body: inner });
    }
    i = j + 1;
  }
  return out;
}
const cssText = (blocks) =>
  blocks.map((b) => (b.raw ? b.raw : b.kids ? (b.kids.length ? `${b.prelude}{${cssText(b.kids)}}` : '') : `${b.prelude}{${b.body}}`)).join('');

/** A selector list split on its top-level commas. */
function selectorList(prelude) {
  const out = [];
  let cur = '', depth = 0, q = null;
  for (const ch of prelude) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
/** Classes the elements must carry for a selector to match. Arguments of :not() :is() :has() … are left out (never required). */
function selectorClasses(sel) {
  let s = sel.replace(/\[[^\]]*\]/g, ''); // attribute values may contain dots
  for (let prev; prev !== s; ) {
    prev = s;
    s = s.replace(/:[\w-]+\([^()]*\)/g, '');
  }
  return [...new Set([...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
}
/** Every style rule of a block list with a stable path ("3", "7.2") and the classes each of its selectors needs. */
function styleRules(blocks, prefix = '') {
  return blocks.flatMap((b, i) =>
    b.kids ? styleRules(b.kids, `${prefix}${i}.`) : b.body != null ? [{ path: prefix + i, sels: selectorList(b.prelude).map(selectorClasses) }] : [],
  );
}
/** Only the style rules whose path is in `keep` (grouping rules that end up empty are dropped; statements are kept). */
function pickRules(blocks, keep, prefix = '') {
  return blocks
    .map((b, i) => (b.kids ? { ...b, kids: pickRules(b.kids, keep, `${prefix}${i}.`) } : b.body != null && !keep.has(prefix + i) ? null : b))
    .filter((b) => b && !(b.kids && !b.kids.length));
}

/** Optional esbuild (npm i -D esbuild): smaller JS. The build works without it. */
async function loadMinifier() {
  if (args['no-minify']) return null;
  try {
    const esbuild = await import('esbuild');
    return async (code) => (await esbuild.transform(code, { minify: true, target: 'es2019', legalComments: 'none' })).code;
  } catch {
    return null;
  }
}

async function buildAssets() {
  const manifest = {};
  // content-hashed output only: /assets/css/, /assets/js/ (plus the HASHED_STATIC folders), so a host can mark
  // whole folders immutable (HOSTING.md)
  const outCss = path.join(OUT, 'assets/css');
  const outJs = path.join(OUT, 'assets/js');
  await mkdir(outCss, { recursive: true });
  await mkdir(outJs, { recursive: true });
  const min = (css) => (args['no-minify'] ? css : minifyCss(css));

  // static files → the site root (favicon, brand/, assets/logos/, og images …); HASHED_STATIC files under a
  // content-hashed name, listed in the manifest as "static:<path>"
  const staticDir = path.join(ROOT, 'src/assets/static');
  const imageSets = {}; // "crm-clean-data" → [{ w, url }] from assets/articles/sized/<name>-<width>.<ext>
  if (existsSync(staticDir)) {
    const relOf = (p) => path.relative(staticDir, p).split(path.sep).join('/');
    await cp(staticDir, OUT, { recursive: true, filter: (src) => !HASHED_STATIC.test(relOf(src)) });
    for (const rel of (await filesUnder(staticDir)).sort()) {
      if (!HASHED_STATIC.test(rel)) continue;
      const buf = await readFile(path.join(staticDir, rel));
      const out = withHash(rel, buf);
      await mkdir(path.dirname(path.join(OUT, out)), { recursive: true });
      await writeFile(path.join(OUT, out), buf);
      manifest[`static:${rel}`] = `/${out}`;
      const m = rel.match(/^assets\/articles\/sized\/(.+)-(\d+)\.\w+$/);
      if (m) (imageSets[m[1]] ||= []).push({ w: Number(m[2]), url: `/${out}` });
    }
    for (const set of Object.values(imageSets)) set.sort((a, b) => a.w - b.w);
  }
  /** url(fonts/x.woff2) in the CSS sources (written relative to /assets/) → the hashed file, relative to /assets/css/ */
  const hashUrls = (text) =>
    text.replace(/url\((["']?)([^"')]+)\1\)/g, (m, q, u) => {
      const hit = manifest[`static:assets/${u}`];
      return hit ? `url(${q}../${hit.slice('/assets/'.length)}${q})` : m;
    });

  // core CSS bundle
  const cssDir = path.join(ROOT, 'src/assets/css');
  const parts = [];
  for (const f of CSS_ORDER) {
    const p = path.join(cssDir, f);
    if (existsSync(p)) parts.push(await readFile(p, 'utf8'));
  }
  const css = min(hashUrls(parts.join('\n')));
  const cssName = `site.${hash(css)}.css`;
  await writeFile(path.join(outCss, cssName), css);
  manifest['site.css'] = `/assets/css/${cssName}`;
  const coreClasses = cssClasses(css);

  // page CSS files: parsed once; the page-type stylesheets are written by writePageCss() once every page is known
  const pageCss = new Map(); // name → { text, blocks, rules, own: Set(classes not defined in core), unique }
  const pagesDir = path.join(cssDir, 'pages');
  if (existsSync(pagesDir)) {
    for (const f of (await readdir(pagesDir)).filter((f) => f.endsWith('.css')).sort()) {
      const name = f.replace(/\.css$/, '');
      const text = min(hashUrls(await readFile(path.join(pagesDir, f), 'utf8')));
      const blocks = cssBlocks(text.replace(/\/\*[\s\S]*?\*\//g, ''));
      pageCss.set(name, { text, blocks, rules: styleRules(blocks), own: new Set([...cssClasses(text)].filter((c) => !coreClasses.has(c))) });
    }
    // a class that several page files define cannot identify one of them
    const seen = new Map();
    for (const { own } of pageCss.values()) for (const c of own) seen.set(c, (seen.get(c) || 0) + 1);
    for (const entry of pageCss.values()) entry.unique = new Set([...entry.own].filter((c) => seen.get(c) === 1));
  }

  // JS → copied one-to-one with a content hash (minified when esbuild is installed)
  const minifyJs = await loadMinifier();
  const jsDir = path.join(ROOT, 'src/assets/js');
  const scriptWords = new Set(['js']); // any word of a client script may be a class it sets at runtime ("js": the head script)
  if (existsSync(jsDir)) {
    for (const f of (await readdir(jsDir)).filter((f) => f.endsWith('.js')).sort()) {
      let buf = await readFile(path.join(jsDir, f), 'utf8');
      for (const w of buf.match(/[_a-zA-Z][\w-]*/g) || []) scriptWords.add(w);
      if (minifyJs) buf = await minifyJs(buf);
      const name = f.replace(/\.js$/, `.${hash(buf)}.js`);
      await writeFile(path.join(outJs, name), buf);
      manifest[`js/${f}`] = `/assets/js/${name}`;
    }
  }

  /**
   * The stylesheets of one page: site.css plus its page-type file, which is returned as a placeholder (the file
   * holds what every page of that type needs, so it is written by writePageCss() after the last page).
   * The page-type file = the module's own page files + the rules of other page files that can match on its pages.
   */
  const compositions = new Map(); // key → { own: [names], borrowed: Map(name → Set(rule paths)) }
  const stylesFor = (module, htmlStr, explicit) => {
    const site = manifest['site.css'];
    if (CSS_MODE === 'all') return [site, ...[...pageCss.keys()].map((n) => cssSlot(n))];
    const own = (explicit || PAGE_CSS[module] || (pageCss.has(module) ? [module] : [])).filter((n) => pageCss.has(n));
    const used = new Set();
    for (const m of String(htmlStr).matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) used.add(c);
    const has = (c) => used.has(c) || scriptWords.has(c);
    const borrowed = new Map();
    for (const [name, entry] of pageCss) {
      if (own.includes(name)) continue;
      const anchored = entry.rules.some((r) => r.sels.some((cls) => cls.some((c) => entry.unique.has(c) && used.has(c)) && cls.every(has)));
      if (anchored) borrowed.set(name, new Set(entry.rules.filter((r) => r.sels.some((cls) => cls.every(has))).map((r) => r.path)));
    }
    if (!own.length && !borrowed.size) return [site];
    const key = [own.join('-') || 'page', ...(borrowed.size ? ['plus', ...borrowed.keys()] : [])].join('-');
    let comp = compositions.get(key);
    if (!comp) compositions.set(key, (comp = { own, borrowed: new Map() }));
    for (const [name, paths] of borrowed) {
      const all = comp.borrowed.get(name) || new Set();
      for (const p of paths) all.add(p);
      comp.borrowed.set(name, all);
    }
    return CSS_MODE === 'single' ? [cssSlot(key)] : [site, cssSlot(key)];
  };

  /** Writes the page-type stylesheets the pages asked for; returns placeholder key → URL. */
  const writePageCss = async () => {
    const urls = new Map();
    let bytes = 0;
    const entries = CSS_MODE === 'all' ? [...pageCss.keys()].map((n) => [n, { own: [n], borrowed: new Map() }]) : [...compositions];
    for (const [key, { own, borrowed }] of entries) {
      // in file-name order, the order separate <link>s had, so the cascade is unchanged
      const text = [...pageCss.keys()]
        .filter((n) => own.includes(n) || borrowed.has(n))
        .map((n) => (own.includes(n) ? pageCss.get(n).text : cssText(pickRules(pageCss.get(n).blocks, borrowed.get(n)))))
        .join('\n');
      const body = CSS_MODE === 'single' ? `${css}\n${text}` : text;
      const file = `${CSS_MODE === 'single' ? 'site-' : 'p-'}${key}.${hash(body)}.css`;
      await writeFile(path.join(outCss, file), body);
      bytes += Buffer.byteLength(text);
      urls.set(key, `/assets/css/${file}`);
    }
    return { urls, bytes };
  };

  return { manifest, cssBytes: Buffer.byteLength(css), stylesFor, writePageCss, imageSets, minified: Boolean(minifyJs) };
}

// ---------------------------------------------------------------- link rewriting
// Templates always write root-absolute internal URLs ("/categories/crm/"). Depending on --links we keep them
// (prefixed with --base), or rewrite them relative to the page so the output works under any path.
const ATTR_RE = /(\s(?:href|src|action|poster|data-href|data-src)=")(\/(?!\/)[^"]*)"/g;

function relTo(fromPath, target) {
  // fromPath like "/categories/crm/" (always a directory URL or a file like "/404.html")
  const fromDir = fromPath.endsWith('/') ? fromPath : fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
  const m = target.match(/^([^?#]*)(.*)$/);
  let [, p, suffix] = m;
  const fromSeg = fromDir.split('/').filter(Boolean);
  const toSeg = p.split('/').filter(Boolean);
  const isDir = p.endsWith('/');
  let i = 0;
  while (i < fromSeg.length && i < toSeg.length - (isDir ? 0 : 1) && fromSeg[i] === toSeg[i]) i++;
  let rel = '../'.repeat(fromSeg.length - i) + toSeg.slice(i).join('/') + (isDir && toSeg.length > i ? '/' : '');
  if (rel === '') rel = './';
  if (LINKS === 'portable' && (rel.endsWith('/') || rel === './')) rel += 'index.html';
  return rel + suffix;
}

function rewriteLinks(htmlStr, pagePath, { forceAbsolute = false } = {}) {
  const absolute = forceAbsolute || LINKS === 'absolute';
  const baseAttr = absolute ? BASE : relTo(pagePath, '/').replace(/index\.html$/, '');
  const fix = (url) => (absolute ? `${BASE}${url.slice(1)}` : relTo(pagePath, url));
  let out = htmlStr.replace(ATTR_RE, (m, pre, url) => `${pre}${fix(url)}"`);
  // candidate lists: srcset="/a-640.webp 640w, /a-960.webp 960w" (and imagesrcset on image preloads)
  out = out.replace(/(\s(?:srcset|imagesrcset)=")([^"]*)"/g, (m, pre, list) =>
    `${pre}${list.split(',').map((c) => c.trim().replace(/^\/(?!\/)\S*/, fix)).join(', ')}"`,
  );
  out = out.replace('data-base="__BASE__"', `data-base="${baseAttr}" data-links="${absolute ? 'absolute' : LINKS}"`);
  return out;
}

// ---------------------------------------------------------------- build
async function main() {
  if (!args['no-clean']) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const { manifest, cssBytes, stylesFor, writePageCss, imageSets, minified } = await buildAssets();

  const { createContext } = await import(pathToFileURL(path.join(ROOT, 'src/lib/context.mjs')).href);
  const overrides = {};
  if (args.outbound) overrides.outbound = String(args.outbound); // go | direct
  if (args.index) overrides.indexPolicy = String(args.index); // parity | gated
  const ctx = await createContext({ root: ROOT, manifest, links: LINKS, base: BASE, overrides });
  ctx.stylesFor = stylesFor;
  // the ?v= that core.js appends to /data/*.js: a hash of the generated data files, filled in after the generators
  ctx.dataVersion = DATA_VERSION_SLOT;
  /**
   * <img> attributes for the responsive variants of an article image (assets/articles/sized/<name>-<width>.webp,
   * made by scripts/make-hero-variants.py): { srcset, sizes } — `sizes` is the template's layout — or null.
   */
  ctx.imageSet = (src, sizes) => {
    const set = imageSets[String(src || '').split('/').pop().replace(/\.\w+$/, '')];
    return set ? { srcset: set.map((v) => `${v.url} ${v.w}w`).join(', '), sizes } : null;
  };

  const written = [];
  const errors = [];
  const dataFiles = new Map(); // /data/… → content (for the data version)
  async function emit(relPath, content) {
    const file = path.join(OUT, relPath.replace(/^\//, ''));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    written.push({ path: relPath, bytes: Buffer.byteLength(content) });
    if (relPath.startsWith('/data/')) dataFiles.set(relPath, content);
  }

  // pages
  const { renderDocument } = await import(pathToFileURL(path.join(ROOT, 'src/lib/layout.mjs')).href);
  const pagesDir = path.join(ROOT, 'src/pages');
  const mods = (await readdir(pagesDir)).filter((f) => f.endsWith('.mjs')).sort();
  const routes = [];
  for (const f of mods) {
    const name = f.replace(/\.mjs$/, '');
    try {
      const mod = await import(pathToFileURL(path.join(pagesDir, f)).href);
      if (typeof mod.routes !== 'function') continue;
      for (const r of await mod.routes(ctx)) routes.push({ ...r, module: name });
    } catch (e) {
      errors.push({ where: `routes:${name}`, error: e });
    }
  }
  // every route is known to ctx before rendering (for link checks, sitemap, nav state)
  ctx.routes = routes;
  ctx.routeByPath = new Map(routes.map((r) => [r.path, r]));

  // The full planned URL space (independent of which page modules exist yet). `scripts/check.mjs --planned`
  // accepts links to these, so a partial build (--only=…) can still be link-checked.
  const planned = new Set([
    '/', '/categories/', '/software/', '/comparisons/', '/compare/', '/shortlist/', '/search/', '/faq/', '/tools/cost/', '/ai/', '/guides/',
    '/research-updates/', '/countries/', '/partners/', '/partners/apply/', '/about/', '/methodology/', '/editorial-policy/', '/how-we-make-money/',
    '/corrections/', '/contact/', '/privacy/', '/terms/', '/accessibility/', '/feed.xml', '/atom.xml', '/llms.txt', '/llms-full.txt', '/sitemap.xml', '/404.html',
    ...ctx.categories.map((c) => ctx.url.category(c.id)),
    ...ctx.vendors.flatMap((v) => [ctx.url.software(v.id), ctx.url.alternatives(v.id)]),
    ...ctx.comparisons.map((c) => ctx.url.vs(c.id)),
    ...ctx.guides.map((g) => ctx.url.guide(g.id)),
    ...routes.map((r) => r.path),
  ]);
  await writeFile(path.join(OUT, '.planned-routes.json'), JSON.stringify([...planned]));

  let pageCount = 0;
  const rendered = []; // written after the generators, when the data version and the page-type stylesheets exist
  for (const r of routes) {
    if (ONLY && !ONLY.includes(r.module)) continue;
    try {
      const page = await r.render(ctx);
      if (!page) continue;
      r.page = page; // generators (sitemap, feeds, search index) can read rendered metadata
      const doc = renderDocument(ctx, r, page);
      const isFile = /\.[a-z0-9]+$/i.test(r.path);
      const outPath = isFile ? r.path : r.path.replace(/\/?$/, '/') + 'index.html';
      rendered.push({ r, outPath, doc: String(doc) });
      pageCount++;
    } catch (e) {
      errors.push({ where: `render:${r.module}:${r.path}`, error: e });
    }
  }

  // generators (sitemap, robots, llms.txt, feeds, search index, data chunks …)
  const genDir = path.join(ROOT, 'src/gen');
  if (existsSync(genDir)) {
    for (const f of (await readdir(genDir)).filter((f) => f.endsWith('.mjs')).sort()) {
      try {
        const mod = await import(pathToFileURL(path.join(genDir, f)).href);
        if (typeof mod.generate === 'function') await mod.generate(ctx, emit);
      } catch (e) {
        errors.push({ where: `gen:${f}`, error: e });
      }
    }
  }

  // pages: fill in the data version (it follows the bytes of every generated /data/ file, so a code change that
  // alters them busts the cache as surely as a catalog change) and the page-type stylesheet
  const dataHash = createHash('sha256');
  for (const p of [...dataFiles.keys()].sort()) dataHash.update(`${p}\0`).update(dataFiles.get(p)).update('\0');
  const dataVersion = dataHash.digest('hex').slice(0, 10);
  const { urls: cssUrls, bytes: pageCssBytes } = await writePageCss();
  for (const { r, outPath, doc } of rendered) {
    const filled = doc
      .replaceAll(`data-v="${DATA_VERSION_SLOT}"`, `data-v="${dataVersion}"`)
      .replace(/__SC_CSS:([\w-]+)__/g, (m, key) => cssUrls.get(key) || m);
    if (/__SC_(?:CSS:|DATA_VERSION)/.test(filled)) errors.push({ where: `finalize:${r.path}`, error: new Error('a build placeholder was left in the page') });
    await emit(outPath, rewriteLinks(filled, r.path, { forceAbsolute: r.absoluteLinks }));
  }

  // report
  const htmlPages = written.filter((w) => w.path.endsWith('.html'));
  const total = written.reduce((s, w) => s + w.bytes, 0);
  log(
    `built ${pageCount} pages (${routes.length} routes) + ${written.length - htmlPages.length} files → ${path.relative(process.cwd(), OUT) || '.'}` +
      `  [${(total / 1e6).toFixed(1)} MB, core css ${(cssBytes / 1024).toFixed(1)} KB + page css ${(pageCssBytes / 1024).toFixed(1)} KB, js ${minified ? 'minified' : 'not minified'}, ${Math.round(performance.now() - t0)} ms, links=${LINKS}]`,
  );
  if (args.report) {
    const top = [...htmlPages].sort((a, b) => b.bytes - a.bytes).slice(0, 12);
    for (const w of top) log(`  ${(w.bytes / 1024).toFixed(0).padStart(5)} KB  ${w.path}`);
  }
  if (errors.length) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors.slice(0, 30)) console.error(`  ✗ ${e.where}\n    ${(e.error && e.error.stack) || e.error}`.split('\n').slice(0, 6).join('\n'));
    if (STRICT) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
