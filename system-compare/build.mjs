#!/usr/bin/env node
// System Compare — static site build. Zero dependencies (Node >= 20).
//
//   node build.mjs                      full build into ./dist (relative links, works at any base path)
//   node build.mjs --out=/tmp/x         build somewhere else
//   node build.mjs --only=category,vs   render only some page modules (assets + generators still run)
//   node build.mjs --links=absolute --base=/        root-absolute links (classic production output)
//   node build.mjs --links=portable     relative links ending in index.html (works from file:// and zip previews)
//   node build.mjs --strict             exit 1 on any page error
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
const CSS_ORDER = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'utilities.css'];

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n+/g, '\n')
    .replace(/\s*([{};,>])\s*/g, (m, c) => (c === '>' ? m.replace(/\s+/g, ' ') : c))
    .replace(/;}/g, '}')
    .trim();
}

async function buildAssets() {
  const manifest = {};
  const outAssets = path.join(OUT, 'assets');
  await mkdir(outAssets, { recursive: true });

  // CSS → one bundle
  const cssDir = path.join(ROOT, 'src/assets/css');
  const parts = [];
  for (const f of CSS_ORDER) {
    const p = path.join(cssDir, f);
    if (existsSync(p)) parts.push(`/* ${f} */\n` + (await readFile(p, 'utf8')));
  }
  const pagesDir = path.join(cssDir, 'pages');
  if (existsSync(pagesDir)) {
    for (const f of (await readdir(pagesDir)).filter((f) => f.endsWith('.css')).sort()) {
      parts.push(`/* pages/${f} */\n` + (await readFile(path.join(pagesDir, f), 'utf8')));
    }
  }
  const css = args['no-minify'] ? parts.join('\n') : minifyCss(parts.join('\n'));
  const cssName = `site.${hash(css)}.css`;
  await writeFile(path.join(outAssets, cssName), css);
  manifest['site.css'] = `/assets/${cssName}`;

  // JS → copied one-to-one with a content hash
  const jsDir = path.join(ROOT, 'src/assets/js');
  if (existsSync(jsDir)) {
    for (const f of (await readdir(jsDir)).filter((f) => f.endsWith('.js')).sort()) {
      const buf = await readFile(path.join(jsDir, f));
      const name = f.replace(/\.js$/, `.${hash(buf)}.js`);
      await writeFile(path.join(outAssets, name), buf);
      manifest[`js/${f}`] = `/assets/${name}`;
    }
  }

  // static files copied verbatim to the site root (favicon, brand/, assets/logos/, og image …)
  const staticDir = path.join(ROOT, 'src/assets/static');
  if (existsSync(staticDir)) await cp(staticDir, OUT, { recursive: true });

  return { manifest, cssBytes: Buffer.byteLength(css) };
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
  let out = htmlStr.replace(ATTR_RE, (m, pre, url) =>
    absolute ? `${pre}${BASE}${url.slice(1)}"` : `${pre}${relTo(pagePath, url)}"`,
  );
  out = out.replace('data-base="__BASE__"', `data-base="${baseAttr}" data-links="${absolute ? 'absolute' : LINKS}"`);
  return out;
}

// ---------------------------------------------------------------- build
async function main() {
  if (!args['no-clean']) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const { manifest, cssBytes } = await buildAssets();

  const { createContext } = await import(pathToFileURL(path.join(ROOT, 'src/lib/context.mjs')).href);
  const ctx = await createContext({ root: ROOT, manifest, links: LINKS, base: BASE });

  const written = [];
  const errors = [];
  async function emit(relPath, content) {
    const file = path.join(OUT, relPath.replace(/^\//, ''));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    written.push({ path: relPath, bytes: Buffer.byteLength(content) });
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

  let pageCount = 0;
  for (const r of routes) {
    if (ONLY && !ONLY.includes(r.module)) continue;
    try {
      const page = await r.render(ctx);
      if (!page) continue;
      r.page = page; // generators (sitemap, feeds, search index) can read rendered metadata
      const doc = renderDocument(ctx, r, page);
      const isFile = /\.[a-z0-9]+$/i.test(r.path);
      const outPath = isFile ? r.path : r.path.replace(/\/?$/, '/') + 'index.html';
      await emit(outPath, rewriteLinks(String(doc), r.path, { forceAbsolute: r.absoluteLinks }));
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

  // report
  const htmlPages = written.filter((w) => w.path.endsWith('.html'));
  const total = written.reduce((s, w) => s + w.bytes, 0);
  log(
    `built ${pageCount} pages (${routes.length} routes) + ${written.length - htmlPages.length} files → ${path.relative(process.cwd(), OUT) || '.'}` +
      `  [${(total / 1e6).toFixed(1)} MB, css ${(cssBytes / 1024).toFixed(1)} KB, ${Math.round(performance.now() - t0)} ms, links=${LINKS}]`,
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
