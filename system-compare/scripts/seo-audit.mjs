#!/usr/bin/env node
// SEO + GEO acceptance audit for a built site.
//
//   node scripts/seo-audit.mjs [dir=dist] [--json] [--max=3] [--live=<dir>] [--today=YYYY-MM-DD]
//
// Reads the built HTML and crawler files in <dir> and compares them with the expectations stored in
// data/catalog.json and data/content/*.json (index policy, hreflang map, affiliate vendors, dates).
// It imports no site code: everything is measured on the output, the way a crawler sees it.
//
//   --live=<dir>   optional folder with the live site's sitemap-*.xml, feed.xml and atom.xml (searched in
//                  <dir> and <dir>/mirror). Adds "lastmod never older than live" from the XML files and
//                  "same feed GUIDs as live". Without it the live lastmod values in live-head.json are used.
//   --today=…      the build date to test "never the build date" against (default: today, UTC and local).
//   --max=N        examples printed per check (default 3).   --json   machine-readable result.
//
// Checks (ids as printed): 0 URL parity · 1 index policy + sitemaps · 2 titles, descriptions, headings ·
// 3 canonical, Open Graph, head basics · 4 hreflang · 5 JSON-LD (graph, breadcrumb, FAQ, ItemList,
// SoftwareApplication/offers, Article, no ratings, dates, @id references) · 6 answer-first passage and pending
// scores · 7 rating/review/"best" wording in template text · 8 dates in <time> · 9 internal link graph ·
// 10 robots.txt, llms.txt, feeds, 404, manifest · 11 outbound and affiliate links · 12 images and weight.
//
// Exit code 1 when any check FAILS. WARN = reported for review, does not fail the run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (name, dflt) => (argv.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${dflt}`).slice(name.length + 3);
const dirArg = argv.find((a) => !a.startsWith('--')) || 'dist';
// a relative dir is taken from the working directory first, then from the repository root (like check.mjs)
const DIR = path.isAbsolute(dirArg) || fs.existsSync(path.resolve(dirArg)) ? path.resolve(dirArg) : path.resolve(ROOT, dirArg);
const AS_JSON = argv.includes('--json');
const MAX = Number(opt('max', '3'));
const LIVE = opt('live', '');
const ORIGIN = 'https://system-compare.com';
const now = new Date();
const TODAY = new Set(opt('today', '') ? [opt('today', '')] : [now.toISOString().slice(0, 10), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`]);

if (!fs.existsSync(DIR)) {
  console.error(`seo-audit: ${DIR} does not exist — build first (node build.mjs)`);
  process.exit(2);
}

// ───────────────────────────────────────────────────────────── results
const CHECKS = new Map(); // id → { id, title, fails: [], warns: [], notes: [] }
function check(id, title) {
  if (!CHECKS.has(id)) CHECKS.set(id, { id, title, fails: [], warns: [], notes: [] });
  const c = CHECKS.get(id);
  return {
    fail: (where, msg) => c.fails.push({ where, msg }),
    warn: (where, msg) => c.warns.push({ where, msg }),
    note: (msg) => c.notes.push(msg),
  };
}

// ───────────────────────────────────────────────────────────── tiny tolerant HTML parser
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['script', 'style', 'textarea', 'title']);
const BLOCK = new Set('address article aside blockquote br caption dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol option p pre section summary table tbody td tfoot th thead tr ul'.split(' '));
const CLOSES = { li: ['li'], p: ['p'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], option: ['option'] };
const P_CLOSERS = new Set('address article aside blockquote details div dl fieldset figure footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul'.split(' '));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©', rarr: '→', larr: '←', times: '×', euro: '€', pound: '£', reg: '®', trade: '™' };
const decode = (s) =>
  String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENT[e] ?? m;
  });
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const squash = (s) => String(s).replace(/\s+/g, '');

function parseHtml(src) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][\w:-]*)\s*>|<([a-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let last = 0;
  let m;
  const addText = (t) => t && cur.children.push({ text: t, parent: cur });
  while ((m = re.exec(src))) {
    addText(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      let n = cur;
      while (n !== root && n.tag !== tag) n = n.parent;
      if (n !== root) cur = n.parent;
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = {};
      for (const a of m[3].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      if (CLOSES[tag] && CLOSES[tag].includes(cur.tag)) cur = cur.parent;
      else if (cur.tag === 'p' && P_CLOSERS.has(tag)) cur = cur.parent;
      const node = { tag, attrs, children: [], parent: cur };
      cur.children.push(node);
      if (RAWTEXT.has(tag)) {
        const close = src.toLowerCase().indexOf(`</${tag}`, last);
        const end = close < 0 ? src.length : close;
        node.children.push({ text: src.slice(last, end), parent: node, raw: true });
        last = close < 0 ? src.length : src.indexOf('>', close) + 1;
        re.lastIndex = last;
      } else if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) cur = node;
    }
  }
  addText(src.slice(last));
  return root;
}
const cls = (n) => (n.attrs?.class || '').split(/\s+/).filter(Boolean);
const hasClass = (n, c) => cls(n).includes(c);
function* walk(n) {
  for (const c of n.children || []) {
    if (c.tag) {
      yield c;
      yield* walk(c);
    }
  }
}
const all = (n, pred) => [...walk(n)].filter(pred);
const first = (n, pred) => {
  for (const c of walk(n)) if (pred(c)) return c;
  return null;
};
const closest = (n, pred) => {
  for (let p = n; p && p.tag !== '#root'; p = p.parent) if (pred(p)) return p;
  return null;
};
const SKIP_TEXT = new Set(['script', 'style', 'template', 'noscript']);
/** Text of a node the way a crawler reads it: tags dropped, block boundaries become spaces. */
function textOf(n, { skip } = {}) {
  let out = '';
  (function rec(x) {
    if (x.text !== undefined) {
      if (!x.raw) out += decode(x.text);
      return;
    }
    if (SKIP_TEXT.has(x.tag) || (skip && skip(x))) return;
    const block = BLOCK.has(x.tag);
    if (block) out += ' ';
    for (const c of x.children) rec(c);
    if (block) out += ' ';
  })(n);
  return norm(out);
}
/** Text nodes (decoded) under n with their parent element; skips script/style and <time>. */
function textNodes(n, { skip } = {}) {
  const out = [];
  (function rec(x) {
    if (x.text !== undefined) {
      if (!x.raw && x.text.trim()) out.push({ text: decode(x.text), el: x.parent });
      return;
    }
    if (SKIP_TEXT.has(x.tag) || (skip && skip(x))) return;
    for (const c of x.children) rec(c);
  })(n);
  return out;
}

// ───────────────────────────────────────────────────────────── expectations (data, not site code)
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const catalog = readJson('data/catalog.json');
const liveHead = readJson('data/content/live-head.json');
const hreflangMap = readJson('data/content/hreflang.json');
const serverData = readJson('data/content/software-server-data.json');
const staticServer = fs.existsSync(path.join(ROOT, 'data/content/static-server-content.json')) ? readJson('data/content/static-server-content.json') : {};

const vendorById = new Map(catalog.vendors.map((v) => [v.id, v]));
const categoryById = new Map(catalog.categories.map((c) => [c.id, c]));
const comparisonById = new Map(catalog.comparisons.map((c) => [c.id, c]));
const guideById = new Map(catalog.guides.map((g) => [g.id, g]));
const EXPECT_INDEXABLE = new Set([...Object.entries(liveHead).filter(([, v]) => v.indexable).map(([p]) => p), '/faq/']);
const NEW_URLS = new Set(['/faq/', '/search/', '/404.html']);

// every string in the data → one corpus (to tell catalog sentences from template text) + the set of data dates
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const LONG_DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? (\d{1,2}), (\d{4})\b/g;
const ISO_DATE = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
const toIso = (mon, d, y) => `${y}-${String(MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dataDates = new Set();
const corpusParts = [];
(function collect(v) {
  if (typeof v === 'string') {
    const s = decode(v);
    corpusParts.push(norm(s));
    for (const m of s.matchAll(ISO_DATE)) dataDates.add(m[0]);
    for (const m of s.matchAll(LONG_DATE)) dataDates.add(toIso(m[1], m[2], m[3]));
  } else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === 'object') Object.values(v).forEach(collect);
})([catalog, staticServer, serverData.livechatTextProductFamilyHtml || '']);
const CORPUS = corpusParts.join('\n');
const inData = (s) => {
  const t = norm(s);
  return t.length > 0 && CORPUS.includes(t);
};
const validIso = (s) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(String(s)) && !Number.isNaN(Date.parse(s));

// ───────────────────────────────────────────────────────────── load the build
function listFiles(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}
const FILES = listFiles(DIR);
const fileSet = new Set(FILES.map((f) => '/' + path.relative(DIR, f).split(path.sep).join('/')));
const readBuilt = (rel) => (fileSet.has(rel) ? fs.readFileSync(path.join(DIR, rel), 'utf8') : null);
const pathOfFile = (rel) => rel.replace(/index\.html$/, '');
const typeOf = (p) => {
  if (p === '/') return 'home';
  const m = p.match(/^\/(categories|software|vs|alternatives|guides)\/[^/]+\/$/);
  if (m) return { categories: 'category', software: 'software', vs: 'vs', alternatives: 'alternatives', guides: 'guide' }[m[1]];
  if (/^\/(categories|software|comparisons|guides|ai|countries|research-updates|faq|search|compare|shortlist)\/$/.test(p) || p === '/tools/cost/') return 'hub';
  return 'static';
};
/** Resolve an href found on `pagePath` → { external, path, query, hash } */
function resolve(pagePath, href) {
  if (/^(mailto:|tel:|javascript:|data:|sms:)/i.test(href)) return { external: true, other: true };
  let u;
  try {
    u = new URL(href, ORIGIN + pagePath);
  } catch {
    return { external: true, bad: true };
  }
  if (u.origin !== ORIGIN) return { external: true, url: u };
  return { external: false, path: u.pathname, query: u.search, hash: u.hash.slice(1), params: u.searchParams };
}

const pages = [];
const byPath = new Map();
for (const rel of [...fileSet].filter((f) => f.endsWith('.html')).sort()) {
  const src = fs.readFileSync(path.join(DIR, rel), 'utf8');
  const doc = parseHtml(src);
  const head = first(doc, (n) => n.tag === 'head') || doc;
  const body = first(doc, (n) => n.tag === 'body') || doc;
  const main = first(body, (n) => n.tag === 'main');
  const metas = all(head, (n) => n.tag === 'meta');
  const links = all(head, (n) => n.tag === 'link');
  const meta = (key) => metas.filter((m) => m.attrs.name === key || m.attrs.property === key).map((m) => m.attrs.content ?? '');
  const p = pathOfFile(rel);
  const ld = all(doc, (n) => n.tag === 'script' && n.attrs.type === 'application/ld+json').map((n) => n.children[0]?.text || '');
  let graph = null;
  let ldError = null;
  if (ld.length) {
    try {
      const j = JSON.parse(ld[0]);
      graph = Array.isArray(j['@graph']) ? j['@graph'] : null;
      if (!graph) ldError = 'no @graph array';
    } catch (e) {
      ldError = e.message;
    }
  }
  const page = {
    rel,
    path: p,
    type: typeOf(p),
    bytes: Buffer.byteLength(src),
    doc,
    head,
    body,
    main,
    lang: first(doc, (n) => n.tag === 'html')?.attrs.lang,
    titles: all(head, (n) => n.tag === 'title').map((n) => norm(decode(n.children[0]?.text || ''))),
    descriptions: meta('description'),
    robots: meta('robots'),
    canonicals: links.filter((l) => l.attrs.rel === 'canonical').map((l) => l.attrs.href),
    hreflang: links.filter((l) => l.attrs.rel === 'alternate' && l.attrs.hreflang).map((l) => [l.attrs.hreflang, l.attrs.href]),
    meta,
    ldCount: ld.length,
    ldBytes: ld.reduce((n, s) => n + Buffer.byteLength(s), 0),
    ldError,
    graph: graph || [],
    headSrc: src.slice(0, src.indexOf('</head>')),
  };
  page.noindex = page.robots.some((r) => /noindex/i.test(r));
  page.mainText = main ? textOf(main) : '';
  pages.push(page);
  byPath.set(p, page);
}
const indexable = pages.filter((p) => !p.noindex);
const nodesOf = (page, type) => page.graph.filter((n) => [].concat(n['@type'] || []).includes(type));

// pending / score pairs as shipped to the client (data/cat-<id>.js) — used to prove no page prints a number for a pending score
const scoreData = new Map(); // `${cat}:${vendor}` → { pending, score }
for (const f of [...fileSet].filter((x) => /^\/data\/cat-[^/]+\.js$/.test(x))) {
  const m = fs.readFileSync(path.join(DIR, f), 'utf8').match(/^SC\.define\("[^"]+",([\s\S]*)\);?\s*$/);
  if (!m) continue;
  try {
    const d = JSON.parse(m[1]);
    for (const v of d.vendors || []) scoreData.set(`${d.id}:${v.id}`, { pending: Boolean(v.pe), score: v.sc });
  } catch {
    /* reported below */
  }
}

// ───────────────────────────────────────────────────────────── 0. URL parity
{
  const c = check('0-url-parity', 'Every live URL still exists; only the documented new URLs were added');
  for (const p of Object.keys(liveHead)) if (!byPath.has(p)) c.fail(p, 'live URL missing from the build');
  for (const pg of pages) if (!liveHead[pg.path] && !NEW_URLS.has(pg.path)) c.fail(pg.path, 'page is not a live URL and not a documented new URL');
  c.note(`${pages.length} HTML pages; ${Object.keys(liveHead).length} live URLs`);
}

// ───────────────────────────────────────────────────────────── 1. index policy + sitemaps
const sitemap = new Map(); // path → { lastmod, file }
{
  const c = check('1a-index-policy', 'Robots meta: indexable set = live 255 + /faq/; noindex pages say "noindex,follow"');
  const INDEX = 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1';
  for (const pg of pages) {
    if (pg.robots.length !== 1) {
      c.fail(pg.path, `${pg.robots.length} robots meta tags`);
      continue;
    }
    const want = EXPECT_INDEXABLE.has(pg.path);
    if (want && pg.noindex) c.fail(pg.path, `should be indexable, has "${pg.robots[0]}"`);
    if (!want && !pg.noindex) c.fail(pg.path, `should be noindex, has "${pg.robots[0]}"`);
    if (pg.noindex && pg.robots[0] !== 'noindex,follow') c.fail(pg.path, `noindex page has "${pg.robots[0]}" (expected "noindex,follow")`);
    if (!pg.noindex && pg.robots[0] !== INDEX) c.warn(pg.path, `indexable page has "${pg.robots[0]}"`);
  }
  c.note(`${indexable.length} indexable, ${pages.length - indexable.length} noindex (expected ${EXPECT_INDEXABLE.size} indexable)`);

  const s = check('1b-sitemap-set', 'Sitemap index + children list exactly the indexable set');
  const l = check('1c-sitemap-lastmod', 'Every sitemap URL has a lastmod that is a data date, not the build date, not older than live');
  const indexXml = readBuilt('/sitemap.xml');
  const liveLastmod = new Map(Object.entries(liveHead).filter(([, v]) => v.lastmod).map(([p, v]) => [p, String(v.lastmod).slice(0, 10)]));
  if (LIVE) {
    for (const d of [LIVE, path.join(LIVE, 'mirror')]) {
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).filter((x) => /^sitemap-.*\.xml$/.test(x))) {
        for (const m of fs.readFileSync(path.join(d, f), 'utf8').matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)) {
          const p = m[1].replace(ORIGIN, '');
          if (m[2] && (!liveLastmod.has(p) || liveLastmod.get(p) < m[2].slice(0, 10))) liveLastmod.set(p, m[2].slice(0, 10));
        }
      }
    }
  }
  if (!indexXml) s.fail('/sitemap.xml', 'missing');
  else {
    const children = [...indexXml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)];
    if (!children.length) s.fail('/sitemap.xml', 'not a sitemap index');
    for (const [, loc, lastmod] of children) {
      const rel = loc.replace(ORIGIN, '');
      const xml = readBuilt(rel);
      if (!xml) {
        s.fail(rel, 'child sitemap listed in the index does not exist');
        continue;
      }
      let newest = '';
      if (/<priority>|<changefreq>/.test(xml)) s.warn(rel, 'contains <priority>/<changefreq> (ignored by search engines; spec says omit)');
      for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)) {
        const u = decode(m[1]);
        if (!u.startsWith(ORIGIN + '/')) {
          s.fail(rel, `loc is not on ${ORIGIN}: ${u}`);
          continue;
        }
        const p = u.slice(ORIGIN.length);
        if (sitemap.has(p)) s.warn(p, `listed in two sitemap files (${sitemap.get(p).file} and ${rel})`);
        sitemap.set(p, { lastmod: m[2] || null, file: rel });
        if (m[2] && m[2] > newest) newest = m[2];
      }
      if (!lastmod) l.warn(rel, 'sitemap index entry has no lastmod');
      else if (lastmod !== newest) l.fail(rel, `index lastmod ${lastmod} ≠ newest URL lastmod ${newest}`);
    }
    for (const pg of indexable) if (!sitemap.has(pg.path)) s.fail(pg.path, 'indexable page is not in any sitemap');
    for (const [p] of sitemap) {
      const pg = byPath.get(p);
      if (!pg) s.fail(p, 'sitemap URL has no built page');
      else if (pg.noindex) s.fail(p, 'sitemap lists a noindex page');
      else if (pg.canonicals[0] !== ORIGIN + p) s.fail(p, 'sitemap URL is not the canonical URL of its page');
    }
    s.note(`${sitemap.size} sitemap URLs in ${children.length} files; ${indexable.length} indexable pages`);
    let older = 0;
    for (const [p, e] of sitemap) {
      if (!e.lastmod) {
        // A page without any date in the data has no lastmod: the publisher's editorial policy leaves missing
        // dates unclaimed and never substitutes the build date. Only a page that HAS a date must carry one.
        const page = byPath.get(p);
        const hasDate = page && page.graph.some((node) => node && node.dateModified);
        if (hasDate) l.fail(p, 'no <lastmod> although the page has a dateModified');
        else l.warn(p, 'no <lastmod>: the data holds no modification date for this page (left unclaimed)');
        continue;
      }
      const d = e.lastmod.slice(0, 10);
      if (!validIso(e.lastmod)) l.fail(p, `lastmod "${e.lastmod}" is not a W3C date`);
      else if (!dataDates.has(d)) l.fail(p, `lastmod ${d} ${TODAY.has(d) ? 'is the build date and ' : ''}does not occur anywhere in the data`);
      const live = liveLastmod.get(p);
      if (live && d < live) {
        older++;
        l.fail(p, `lastmod ${d} is older than the live sitemap's ${live}`);
      }
      const pageNode = byPath.get(p)?.graph.find((n) => n['@id'] === `${ORIGIN}${p}#page`);
      if (pageNode && pageNode.dateModified && String(pageNode.dateModified).slice(0, 10) !== d) l.warn(p, `lastmod ${d} ≠ JSON-LD dateModified ${pageNode.dateModified}`);
      if (pageNode && !pageNode.dateModified) l.warn(p, `lastmod ${d} but the page's JSON-LD has no dateModified`);
    }
    l.note(`${[...sitemap.values()].filter((e) => e.lastmod).length}/${sitemap.size} URLs have lastmod; ${liveLastmod.size} live lastmod values compared, ${older} older than live`);
  }
}

// ───────────────────────────────────────────────────────────── 2. titles, descriptions, headings
{
  const t = check('2a-titles', 'Title: exactly one, ≤ 60 chars, unique among indexable pages, no template leak');
  const d = check('2b-descriptions', 'Meta description: exactly one, 70–155 chars, unique among indexable pages, not boilerplate');
  const seenT = new Map();
  const seenD = new Map();
  const skeleton = new Map();
  const names = [...catalog.vendors.map((v) => v.name), ...catalog.categories.map((c) => c.name)].sort((a, b) => b.length - a.length);
  const nameRe = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  for (const pg of pages) {
    if (pg.titles.length !== 1) t.fail(pg.path, `${pg.titles.length} <title> elements`);
    const title = pg.titles[0] || '';
    if (!title) t.fail(pg.path, 'empty title');
    if (title.length > 60) t.fail(pg.path, `title is ${title.length} chars: "${title}"`);
    if (/\b(undefined|null|NaN)\b|\[object/.test(title)) t.fail(pg.path, `template leak in title: "${title}"`);
    if (/…$/.test(title)) t.warn(pg.path, `title is truncated: "${title}"`);
    if (pg.descriptions.length !== 1) d.fail(pg.path, `${pg.descriptions.length} meta descriptions`);
    const desc = pg.descriptions[0] || '';
    if (desc.length > 155) d.fail(pg.path, `description is ${desc.length} chars`);
    else if (desc.length < 70 && !pg.noindex) d.warn(pg.path, `description is only ${desc.length} chars: "${desc}"`);
    if (/\b(undefined|null|NaN)\b|\[object/.test(desc)) d.fail(pg.path, `template leak in description: "${desc}"`);
    if (/…$/.test(desc) || (desc && !/[.!?)”"]$/.test(desc))) d.warn(pg.path, `description does not end on a complete sentence: "…${desc.slice(-40)}"`);
    if (pg.noindex) continue;
    seenT.set(title, [...(seenT.get(title) || []), pg.path]);
    seenD.set(desc, [...(seenD.get(desc) || []), pg.path]);
    const sk = desc.replace(nameRe, '{name}').replace(/\d+([.,]\d+)?/g, '#');
    skeleton.set(sk, [...(skeleton.get(sk) || []), pg.path]);
  }
  for (const [title, list] of seenT) if (list.length > 1) t.fail(list[0], `duplicate title on ${list.length} indexable pages (${list.slice(0, 3).join(', ')}): "${title}"`);
  for (const [desc, list] of seenD) if (list.length > 1) d.fail(list[0], `duplicate description on ${list.length} indexable pages (${list.slice(0, 3).join(', ')}): "${desc.slice(0, 70)}…"`);
  for (const [sk, list] of skeleton) if (list.length >= 5) d.warn(list[0], `boilerplate description shared by ${list.length} indexable pages once names and numbers are masked: "${sk}"`);
  const lens = pages.map((p) => (p.titles[0] || '').length).sort((a, b) => a - b);
  t.note(`title length min/median/max ${lens[0]}/${lens[lens.length >> 1]}/${lens[lens.length - 1]}`);

  const h = check('2c-headings', 'Exactly one H1 (unique within its page type); levels never skip; headings are labels, not sentences');
  const h1ByType = new Map();
  for (const pg of pages) {
    const heads = all(pg.body, (n) => /^h[1-6]$/.test(n.tag));
    const h1s = heads.filter((n) => n.tag === 'h1');
    if (h1s.length !== 1) h.fail(pg.path, `${h1s.length} <h1> elements`);
    else {
      const key = `${pg.type}|${textOf(h1s[0])}`;
      h1ByType.set(key, [...(h1ByType.get(key) || []), pg.path]);
    }
    let last = 0;
    for (const n of heads) {
      const lvl = Number(n.tag[1]);
      const txt = textOf(n);
      if (last && lvl > last + 1) h.fail(pg.path, `heading level skips h${last} → h${lvl} at "${txt.slice(0, 60)}"`);
      last = lvl;
      if (!txt) h.fail(pg.path, `empty <${n.tag}>`);
      if (txt.length > 110) h.fail(pg.path, `<${n.tag}> is ${txt.length} chars: "${txt.slice(0, 90)}…"`);
      else if (/[a-z]\.$/.test(txt) && txt.split(' ').length >= 8) h.fail(pg.path, `<${n.tag}> is a full sentence: "${txt.slice(0, 100)}"`);
    }
  }
  for (const [key, list] of h1ByType) if (list.length > 1) h.fail(list[0], `same H1 on ${list.length} ${key.split('|')[0]} pages (${list.slice(0, 3).join(', ')}): "${key.split('|')[1]}"`);
}

// ───────────────────────────────────────────────────────────── 3. canonical, Open Graph, head basics
function imageSize(rel) {
  const f = path.join(DIR, rel);
  if (!fs.existsSync(f)) return null;
  const b = fs.readFileSync(f);
  if (b.slice(1, 4).toString() === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length, type: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9; ) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), bytes: b.length, type: 'jpeg' };
      i += 2 + len;
    }
    return { bytes: b.length, type: 'jpeg' };
  }
  return { bytes: b.length, type: path.extname(rel).slice(1) };
}
{
  const c = check('3a-canonical', 'Canonical: exactly one (none on 404), absolute, self-referencing, trailing slash, no query');
  const o = check('3b-open-graph', 'Open Graph + Twitter tags complete; og:url = canonical; og:type article on guides and editorial comparisons; image is a real 1200×630 PNG/JPEG');
  const b = check('3c-head-basics', 'lang="en-US", verification metas byte-identical, feed links, one JSON-LD script');
  const VERIFY = ['<meta name="5734a8eb53bdcd4" content="9fc1231f4ab88c8afcbadbb3e5d856b7" />', '<meta name="impact-site-verification" value="c3dee32d-33bb-4a2f-a830-d74ada451653">', '<meta name="msvalidate.01" content="0CA2714E2C757ACA8D0690F187E8F7F1">'];
  const imgCache = new Map();
  let noTwitterAlt = 0;
  for (const pg of pages) {
    const is404 = pg.path === '/404.html';
    if (is404) {
      if (pg.canonicals.length) c.fail(pg.path, '404 page must not have a canonical');
    } else if (pg.canonicals.length !== 1) c.fail(pg.path, `${pg.canonicals.length} canonical links`);
    else if (pg.canonicals[0] !== ORIGIN + pg.path) c.fail(pg.path, `canonical "${pg.canonicals[0]}" is not the page's own absolute URL`);
    else if (/[?#]/.test(pg.canonicals[0]) || !pg.canonicals[0].endsWith('/')) c.fail(pg.path, `canonical has a query/fragment or no trailing slash: ${pg.canonicals[0]}`);

    for (const key of ['og:type', 'og:site_name', 'og:locale', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      const v = pg.meta(key);
      if (v.length !== 1 || !v[0]) o.fail(pg.path, `${key}: ${v.length ? 'duplicate or empty' : 'missing'}`);
    }
    if (!is404 && pg.meta('og:url')[0] !== pg.canonicals[0]) o.fail(pg.path, `og:url ${pg.meta('og:url')[0]} ≠ canonical`);
    if (pg.meta('og:description')[0] !== pg.descriptions[0]) o.warn(pg.path, 'og:description differs from the meta description');
    if (!pg.meta('twitter:image:alt')[0]) noTwitterAlt++;
    const ogTitle = pg.meta('og:title')[0] || '';
    if (/ \| System Compare/.test(ogTitle)) o.warn(pg.path, `og:title carries the brand suffix: "${ogTitle}"`);
    if (ogTitle !== pg.meta('twitter:title')[0]) o.fail(pg.path, 'twitter:title ≠ og:title');
    const editorial = pg.type === 'vs' && comparisonById.get(pg.path.split('/')[2])?.mode === 'editorial';
    const wantType = pg.type === 'guide' || editorial ? 'article' : 'website';
    if (pg.meta('og:type')[0] !== wantType) o.fail(pg.path, `og:type "${pg.meta('og:type')[0]}" (expected "${wantType}")`);
    if (wantType === 'article' && !pg.meta('article:modified_time')[0]) o.warn(pg.path, 'article page without article:modified_time');
    const img = pg.meta('og:image')[0] || '';
    if (img !== pg.meta('twitter:image')[0]) o.fail(pg.path, 'twitter:image ≠ og:image');
    if (!img.startsWith(ORIGIN + '/')) o.fail(pg.path, `og:image is not an absolute URL on ${ORIGIN}: ${img}`);
    else {
      const rel = img.slice(ORIGIN.length);
      if (!imgCache.has(rel)) imgCache.set(rel, imageSize(rel));
      const info = imgCache.get(rel);
      if (!info) o.fail(pg.path, `og:image file is not in the build: ${rel}`);
      else {
        if (!['png', 'jpeg'].includes(info.type)) o.fail(pg.path, `og:image is ${info.type} (must be PNG or JPEG): ${rel}`);
        if (info.w && (String(info.w) !== pg.meta('og:image:width')[0] || String(info.h) !== pg.meta('og:image:height')[0])) o.fail(pg.path, `og:image is really ${info.w}×${info.h} but declared ${pg.meta('og:image:width')[0]}×${pg.meta('og:image:height')[0]}: ${rel}`);
        if (info.w && Math.abs(info.w / info.h - 1200 / 630) > 0.02) o.warn(pg.path, `og:image is ${info.w}×${info.h}, not 1.91:1: ${rel}`);
        if (info.bytes > 300 * 1024) o.warn(pg.path, `og:image weighs ${(info.bytes / 1024).toFixed(0)} KB (> 300 KB): ${rel}`);
      }
    }
    if (pg.lang !== 'en-US') b.fail(pg.path, `<html lang="${pg.lang}">`);
    for (const v of VERIFY) if (!pg.headSrc.includes(v)) b.fail(pg.path, `verification meta not byte-identical: ${v.slice(0, 40)}…`);
    if (!/<link rel="alternate" type="application\/rss\+xml"/.test(pg.headSrc) || !/<link rel="alternate" type="application\/atom\+xml"/.test(pg.headSrc)) b.fail(pg.path, 'RSS/Atom <link rel="alternate"> missing');
    if (pg.ldCount !== 1) b.fail(pg.path, `${pg.ldCount} JSON-LD scripts (expected exactly one @graph)`);
  }
  const generic = indexable.filter((p) => /\/assets\/social-preview\.png$/.test(p.meta('og:image')[0] || '')).length;
  o.note(`${indexable.length - generic}/${indexable.length} indexable pages have a page-specific og:image; ${generic} use the generic site card`);
  if (noTwitterAlt) o.note(`${noTwitterAlt} pages have no twitter:image:alt (optional)`);
}

// ───────────────────────────────────────────────────────────── 4. hreflang
{
  const c = check('4-hreflang', 'hreflang: mapped indexable pages carry exactly the mapped set (self + x-default); nobody else has any');
  let carried = 0;
  for (const pg of pages) {
    const want = hreflangMap[pg.path] && !pg.noindex ? hreflangMap[pg.path].map((h) => `${h.hreflang} ${h.href}`) : [];
    const got = pg.hreflang.map(([a, b]) => `${a} ${b}`);
    if (got.length) carried++;
    const missing = want.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !want.includes(x));
    if (missing.length) c.fail(pg.path, `missing hreflang: ${missing.join(' | ')}`);
    if (extra.length) c.fail(pg.path, `${want.length ? 'unexpected' : pg.noindex ? 'hreflang on a noindex page' : 'hreflang on an unmapped page'}: ${extra.slice(0, 3).join(' | ')}`);
    if (new Set(got).size !== got.length) c.fail(pg.path, 'duplicate hreflang entries');
    if (got.length) {
      if (!pg.hreflang.some(([l, h]) => l === 'en-US' && h === ORIGIN + pg.path)) c.fail(pg.path, 'no self-referencing en-US hreflang');
      if (!pg.hreflang.some(([l]) => l === 'x-default')) c.fail(pg.path, 'no x-default');
    }
  }
  for (const p of Object.keys(hreflangMap)) if (!byPath.has(p)) c.fail(p, 'hreflang map entry has no page');
  c.note(`${carried} pages carry hreflang; map has ${Object.keys(hreflangMap).length} entries`);
}

// ───────────────────────────────────────────────────────────── 5. JSON-LD
const BANNED_KEYS = new Set(['aggregateRating', 'review', 'reviews', 'reviewRating', 'ratingValue', 'reviewCount', 'ratingCount', 'bestRating', 'worstRating', 'starRating']);
const BANNED_TYPES = new Set(['AggregateRating', 'Review', 'Rating', 'EmployerAggregateRating', 'Product']);
const DATE_KEYS = new Set(['dateModified', 'datePublished', 'dateCreated', 'observationDate', 'uploadDate', 'validFrom', 'priceValidUntil', 'lastReviewed']);
const visibleFaq = new Map(); // path → [{q, a}]
{
  const s = check('5a-jsonld-graph', 'JSON-LD parses; one @graph with Organization, WebSite + SearchAction and a page node whose url = canonical');
  const bc = check('5b-breadcrumb', 'BreadcrumbList = visible breadcrumb (names, order, URLs); last item = this page');
  const fq = check('5c-faq', 'FAQPage questions and answers = visible text; every visible FAQ block is marked up; no Q&A repeated verbatim across pages');
  const il = check('5d-itemlist', 'ItemList order = order of the visible table/list');
  const sw = check('5e-software', 'SoftwareApplication on every profile; offers only for a numeric public price shown on the page');
  const ar = check('5f-article', 'Article on guides and editorial comparisons (headline, author/publisher = Organization, dates)');
  const rt = check('5g-no-ratings', 'No rating/review markup of any kind (JSON-LD keys, types, microdata)');
  const dt = check('5h-jsonld-dates', 'JSON-LD dates are valid ISO dates that exist in the data (never the build date)');
  const id = check('5i-id-refs', 'Every {"@id"} reference resolves inside the same graph');
  const qaSeen = new Map(); // marked-up question+answer → pages that mark it up
  const unmarked = []; // visible FAQ items without markup on their own page
  const markedQuestions = new Set();
  let crossRefs = 0;
  const definesId = (page, wanted) => {
    let found = false;
    (function scan(v) {
      if (found || !v || typeof v !== 'object') return;
      if (!Array.isArray(v) && v['@id'] === wanted && Object.keys(v).length > 1) found = true;
      else Object.values(v).forEach(scan);
    })(page.graph);
    return found;
  };
  let extraVisible = 0;
  let offers = 0;
  let softwareNodes = 0;
  for (const pg of pages) {
    const is404 = pg.path === '/404.html';
    if (pg.ldError) {
      s.fail(pg.path, `JSON-LD: ${pg.ldError}`);
      continue;
    }
    const g = pg.graph;
    const org = nodesOf(pg, 'Organization').find((n) => n['@id'] === `${ORIGIN}/#publisher`);
    const site = nodesOf(pg, 'WebSite')[0];
    if (!org) s.fail(pg.path, 'no Organization #publisher node');
    else for (const k of ['name', 'legalName', 'url', 'logo', 'publishingPrinciples']) if (!org[k]) s.fail(pg.path, `Organization.${k} missing`);
    if (!site) s.fail(pg.path, 'no WebSite node');
    else if (site.potentialAction?.['@type'] !== 'SearchAction' || !/\/search\/\?q=\{search_term_string\}$/.test(site.potentialAction?.target?.urlTemplate || '')) s.fail(pg.path, 'WebSite has no SearchAction → /search/?q={search_term_string}');
    const pageNode = g.find((n) => n['@id'] === `${ORIGIN}${pg.path}#page`);
    if (!is404) {
      if (!pageNode) s.fail(pg.path, 'no page node (@id = canonical#page)');
      else {
        if (pageNode.url !== pg.canonicals[0]) s.fail(pg.path, `page node url ${pageNode.url} ≠ canonical`);
        if (pageNode.description !== pg.descriptions[0]) s.warn(pg.path, 'page node description ≠ meta description');
        if (pageNode.inLanguage !== 'en-US') s.fail(pg.path, 'page node inLanguage ≠ en-US');
      }
    }
    const ids = new Set();
    const typeCount = new Map();
    (function scan(v, top) {
      if (Array.isArray(v)) return v.forEach((x) => scan(x, top));
      if (!v || typeof v !== 'object') return;
      if (v['@id'] && Object.keys(v).length > 1) {
        if (ids.has(v['@id']) && top) s.fail(pg.path, `duplicate @id ${v['@id']}`);
        ids.add(v['@id']);
      }
      for (const t of [].concat(v['@type'] || [])) {
        typeCount.set(t, (typeCount.get(t) || 0) + 1);
        if (BANNED_TYPES.has(t)) rt.fail(pg.path, `JSON-LD @type ${t}`);
      }
      if (!v['@type'] && !(v['@id'] && Object.keys(v).length === 1)) s.warn(pg.path, `JSON-LD object without @type: ${JSON.stringify(v).slice(0, 80)}`);
      for (const [k, x] of Object.entries(v)) {
        if (BANNED_KEYS.has(k)) rt.fail(pg.path, `JSON-LD property "${k}"`);
        if (DATE_KEYS.has(k)) {
          const day = String(x).slice(0, 10);
          if (!validIso(x)) dt.fail(pg.path, `${k} "${x}" is not a valid ISO date`);
          else if (!dataDates.has(day)) dt.fail(pg.path, `${k} ${x} ${TODAY.has(day) ? 'is the build date and ' : ''}does not occur in the data`);
        }
        scan(x, false);
      }
    })(g, true);
    (function refs(v) {
      if (Array.isArray(v)) return v.forEach(refs);
      if (!v || typeof v !== 'object') return;
      if (v['@id'] && Object.keys(v).length === 1 && !ids.has(v['@id'])) {
        // allowed: a node defined in the graph of the page the id points at (e.g. /methodology/#documented-fit-score)
        const other = byPath.get(String(v['@id']).replace(ORIGIN, '').split('#')[0]);
        if (!other || other === pg || !definesId(other, v['@id'])) id.fail(pg.path, `unresolved reference ${v['@id']}`);
        else crossRefs++;
      }
      Object.values(v).forEach(refs);
    })(g);
    if (all(pg.body, (n) => /rating|review/i.test(n.attrs.itemprop || '') || /Rating|Review/.test(n.attrs.itemtype || '')).length) rt.fail(pg.path, 'rating/review microdata in the body');
    // a product / comparison page must not report an older dateModified than the newest evidence or price date it prints
    if (pageNode?.dateModified && ['software', 'vs'].includes(pg.type) && pg.main) {
      const printed = all(pg.main, (n) => n.tag === 'time' && validIso(n.attrs.datetime || '')).map((n) => n.attrs.datetime.slice(0, 10)).filter((d) => ![...TODAY].some((t) => d > t)).sort();
      const newest = printed[printed.length - 1];
      if (newest && String(pageNode.dateModified).slice(0, 10) < newest) dt.warn(pg.path, `dateModified ${pageNode.dateModified} is older than the newest date printed on the page (${newest}, ${printed.filter((d) => d === newest).length}×)`);
    }

    // breadcrumb
    const visible = (() => {
      const nav = pg.main && first(pg.main, (n) => n.tag === 'nav' && /breadcrumb/i.test(n.attrs['aria-label'] || ''));
      if (!nav) return null;
      return all(nav, (n) => n.tag === 'li').map((li) => {
        const a = first(li, (n) => n.tag === 'a');
        return { name: textOf(li), url: a ? ORIGIN + resolve(pg.path, a.attrs.href).path : ORIGIN + pg.path };
      });
    })();
    const list = nodesOf(pg, 'BreadcrumbList');
    if (list.length > 1) bc.fail(pg.path, `${list.length} BreadcrumbList nodes`);
    if (visible && !list.length) bc.fail(pg.path, 'visible breadcrumb without BreadcrumbList');
    if (!visible && list.length) bc.fail(pg.path, 'BreadcrumbList without a visible breadcrumb');
    if (!visible && !list.length && !['/', '/404.html'].includes(pg.path)) bc.warn(pg.path, 'page has no breadcrumb at all');
    if (visible && list.length) {
      const items = [...(list[0].itemListElement || [])].sort((a, b) => a.position - b.position);
      const a = visible.map((x) => `${x.name} → ${x.url}`).join(' › ');
      const b = items.map((x) => `${x.name} → ${typeof x.item === 'string' ? x.item : x.item?.['@id']}`).join(' › ');
      if (a !== b) bc.fail(pg.path, `visible "${a}" ≠ JSON-LD "${b}"`);
      if (items.some((x, i) => x.position !== i + 1)) bc.fail(pg.path, 'ListItem positions are not 1..n');
      if (pageNode && pageNode.breadcrumb?.['@id'] !== list[0]['@id']) bc.fail(pg.path, 'page node does not reference the BreadcrumbList');
    }

    // FAQ: visible = <details> inside an accordion whose <summary> holds a heading
    // (a question, or any accordion item inside an element whose id contains "faq")
    const vis = pg.main
      ? all(pg.main, (n) => n.tag === 'details' && closest(n, (x) => hasClass(x, 'acc') || /faq/i.test(x.attrs.id || '')))
          .map((d) => {
            const sum = d.children.find((x) => x.tag === 'summary');
            const head = sum && first(sum, (n) => /^h[2-6]$/.test(n.tag));
            if (!head) return null;
            const q = textOf(head);
            if (!/\?$/.test(q) && !closest(d, (x) => /faq/i.test(x.attrs.id || ''))) return null;
            const body = { tag: 'div', attrs: {}, children: d.children.filter((x) => x !== sum) };
            return { q, a: textOf(body), nosnippet: Boolean(closest(d, (x) => 'data-nosnippet' in x.attrs)) };
          })
          .filter(Boolean)
      : [];
    visibleFaq.set(pg.path, vis);
    const ldQa = [];
    for (const n of g) {
      if (![].concat(n['@type'] || []).includes('FAQPage')) continue;
      for (const q of [].concat(n.mainEntity || [])) ldQa.push({ q: q.name, a: q.acceptedAnswer?.text });
    }
    for (const q of ldQa) {
      const v = vis.find((x) => squash(x.q) === squash(q.q || ''));
      if (!v) fq.fail(pg.path, `FAQPage question is not visible on the page: "${q.q}"`);
      else if (!squash(v.a).includes(squash(q.a || ''))) {
        const A = squash(v.a);
        const B = squash(q.a || '');
        let i = 0;
        while (i < A.length && A[i] === B[i]) i++;
        fq.fail(pg.path, `FAQPage answer is not the visible answer for "${q.q}" — visible "…${A.slice(Math.max(0, i - 25), i + 40)}" vs markup "…${B.slice(Math.max(0, i - 25), i + 40)}"`);
      } else if (squash(v.a) !== squash(q.a || '')) {
        extraVisible++; // markup text is on the page verbatim; the visible answer carries extra text (source links, "read more")
        if (squash(v.a).length > squash(q.a || '').length * 1.6 + 80) fq.warn(pg.path, `visible answer is much longer than the marked-up answer for "${q.q}" (${v.a.length} vs ${q.a.length} chars)`);
      }
      if (/<[a-z][^>]*>/i.test(q.a || '')) fq.fail(pg.path, `FAQPage answer contains markup: "${q.q}"`);
      if (!q.a || q.a.length < 20) fq.fail(pg.path, `FAQPage answer is empty/too short: "${q.q}"`);
    }
    // One marked-up instance per question for the whole site (Google's FAQPage guideline): a visible item may be
    // left out of this page's markup when the same question is marked up on another page — checked after the loop.
    for (const v of vis) {
      if (!ldQa.some((q) => squash(q.q || '') === squash(v.q))) unmarked.push({ path: pg.path, q: v.q });
      if (v.nosnippet) fq.fail(pg.path, `FAQ item sits inside data-nosnippet: "${v.q}"`);
    }
    for (const q of ldQa) {
      markedQuestions.add(squash(q.q || ''));
      const key = squash((q.q || '') + '|' + (q.a || ''));
      qaSeen.set(key, [...(qaSeen.get(key) || []), pg.path]);
    }
    if (new Set(ldQa.map((q) => q.q)).size !== ldQa.length) fq.fail(pg.path, 'the same question is marked up twice');

    // ItemList
    if (pg.main) {
      const containers = all(pg.main, (n) => ['table', 'ol', 'ul', 'tbody', 'section', 'div', 'dl'].includes(n.tag));
      for (const node of nodesOf(pg, 'ItemList')) {
        const want = [...(node.itemListElement || [])].sort((a, b) => a.position - b.position).map((x) => x.url || x.item?.url || x.item?.['@id'] || x.item);
        if (!want.length) {
          il.fail(pg.path, `ItemList ${node['@id']} is empty`);
          continue;
        }
        if (node.numberOfItems !== undefined && node.numberOfItems !== want.length) il.fail(pg.path, `ItemList ${node['@id']}: numberOfItems ${node.numberOfItems} ≠ ${want.length} elements`);
        const wantSet = new Set(want);
        if (/Unordered$/.test(node.itemListOrder || '')) {
          // unordered list: every item must be linked from the page content; the order is not asserted
          const linked = new Set(
            all(pg.main, (n) => n.tag === 'a' && n.attrs.href).map((a) => {
              const r = resolve(pg.path, a.attrs.href);
              return r.external ? String(r.url || a.attrs.href).replace(/\/$/, '') : ORIGIN + r.path;
            }),
          );
          const missing = want.filter((u) => !linked.has(u.split('#')[0]) && !linked.has(u.replace(/\/$/, '')));
          if (missing.length) il.fail(pg.path, `ItemList ${node['@id'].replace(ORIGIN, '')}: ${missing.length} of ${want.length} items are not linked in <main> (e.g. ${missing[0].replace(ORIGIN, '')})`);
          continue;
        }
        let best = { seq: [], score: -1 };
        let ok = false;
        for (const cnt of containers) {
          const seq = [];
          for (const a of walk(cnt)) {
            if (a.tag !== 'a' || !a.attrs.href) continue;
            const r = resolve(pg.path, a.attrs.href);
            const u = r.external ? a.attrs.href : ORIGIN + r.path + (r.hash && wantSet.has(ORIGIN + r.path + '#' + r.hash) ? '#' + r.hash : '');
            if (wantSet.has(u) && !seq.includes(u)) seq.push(u);
          }
          if (seq.length === want.length && seq.every((u, i) => u === want[i])) {
            ok = true;
            break;
          }
          if (seq.length > best.score) best = { seq, score: seq.length };
        }
        if (ok) continue;
        if (best.score < want.length) il.fail(pg.path, `ItemList ${node['@id'].replace(ORIGIN, '')}: only ${Math.max(best.score, 0)} of ${want.length} items are linked from one visible list (e.g. missing ${want.find((u) => !best.seq.includes(u)).replace(ORIGIN, '')})`);
        else {
          const i = want.findIndex((u, k) => u !== best.seq[k]);
          il.fail(pg.path, `ItemList ${node['@id'].replace(ORIGIN, '')}: order differs from the visible list at position ${i + 1}: markup ${want[i].replace(ORIGIN, '')}, visible ${best.seq[i].replace(ORIGIN, '')}`);
        }
      }
    }

    // SoftwareApplication
    const apps = nodesOf(pg, 'SoftwareApplication').filter((n) => Object.keys(n).length > 3);
    if (pg.type === 'software') {
      const vendor = vendorById.get(pg.path.split('/')[2]);
      const app = apps.find((n) => n['@id'] === `${ORIGIN}${pg.path}#software`);
      if (!app) sw.fail(pg.path, 'no SoftwareApplication node');
      else if (vendor) {
        softwareNodes++;
        if (app.name !== vendor.name) sw.fail(pg.path, `SoftwareApplication.name "${app.name}" ≠ "${vendor.name}"`);
        if (app.url !== vendor.url) sw.fail(pg.path, 'SoftwareApplication.url ≠ vendor.url');
        if (app.mainEntityOfPage?.['@id'] !== `${ORIGIN}${pg.path}#page`) sw.fail(pg.path, 'SoftwareApplication.mainEntityOfPage does not point at the page node');
        const pr = vendor.pricing || {};
        if (app.offers) {
          offers++;
          const o = app.offers;
          const amount = Number(o.price);
          const [int, frac = ''] = String(amount).split('.');
          const shown = new RegExp(`(?:\\$|USD |€|£)\\s?${Number(int).toLocaleString('en-US').replace(/,/g, ',?')}${frac ? `\\.${frac}0*` : '(?:\\.0+)?'}(?![\\d,]*\\d)`);
          if (typeof pr.amount !== 'number') sw.fail(pg.path, `offers.price ${o.price} but the catalog has no numeric amount`);
          else if (amount !== pr.amount) sw.fail(pg.path, `offers.price ${o.price} ≠ catalog amount ${pr.amount}`);
          if (o.priceCurrency !== pr.currency) sw.fail(pg.path, `offers.priceCurrency ${o.priceCurrency} ≠ ${pr.currency}`);
          if (amount === 0 && pr.model === 'mixed') sw.fail(pg.path, 'offers with a $0 base price on a mixed (fees) model');
          if (!shown.test(pg.mainText)) sw.fail(pg.path, `offers.price ${o.price} ${o.priceCurrency} is not printed on the page`);
          if (o.url && o.url !== pr.source) sw.warn(pg.path, 'offers.url is not the pricing source');
          if (!pr.verifiedAt) sw.warn(pg.path, `offers for a price without a price-check date (pricing.verifiedAt missing): ${o.price} ${o.priceCurrency}`);
        } else if (typeof pr.amount === 'number' && pr.currency && !(pr.amount === 0 && pr.model === 'mixed')) {
          sw.warn(pg.path, `numeric catalog price ${pr.amount} ${pr.currency} but no offers`);
        }
      }
      const pend = [...scoreData].filter(([k, v]) => k.endsWith(`:${pg.path.split('/')[2]}`) && v.pending).map(([k]) => k.split(':')[0]);
      for (const o of nodesOf(pg, 'Observation')) if (pend.some((cat) => String(o['@id']).endsWith(`#fit-${cat}`))) sw.fail(pg.path, `Observation node for a pending score: ${o['@id']}`);
    } else if (apps.some((n) => n.offers)) sw.fail(pg.path, 'offers on a non-profile page');

    // Article
    const editorial = pg.type === 'vs' && comparisonById.get(pg.path.split('/')[2])?.mode === 'editorial';
    const arts = nodesOf(pg, 'Article');
    if (pg.type === 'guide' || editorial) {
      const a = arts[0];
      if (!a) ar.fail(pg.path, 'no Article node');
      else {
        if (!a.headline || a.headline.length > 110) ar.fail(pg.path, `Article.headline missing or > 110 chars (${(a.headline || '').length})`);
        if (a.author?.['@id'] !== `${ORIGIN}/#publisher` || a.publisher?.['@id'] !== `${ORIGIN}/#publisher`) ar.fail(pg.path, 'Article author/publisher is not the Organization');
        if (a.mainEntityOfPage?.['@id'] !== `${ORIGIN}${pg.path}#page`) ar.fail(pg.path, 'Article.mainEntityOfPage does not point at the page node');
        if (!a.dateModified) ar.fail(pg.path, 'Article without dateModified');
        const data = pg.type === 'guide' ? guideById.get(pg.path.split('/')[2]) : comparisonById.get(pg.path.split('/')[2]);
        if (a.datePublished && String(a.datePublished).slice(0, 10) !== String(data?.publishedAt || '').slice(0, 10)) ar.fail(pg.path, `Article.datePublished ${a.datePublished} is not the item's publishedAt (${data?.publishedAt || 'none in the data'})`);
        if (!a.datePublished && data?.publishedAt) ar.warn(pg.path, 'data has publishedAt but Article has no datePublished');
        if (a.reviewedBy || (a.author && a.author['@type'] === 'Person')) ar.fail(pg.path, 'Article claims a human author/reviewer the data does not record');
      }
    } else if (arts.length) ar.warn(pg.path, 'Article node on a page that is not a guide or editorial comparison');
  }
  if (softwareNodes !== catalog.vendors.length) sw.fail('/software/', `${softwareNodes} SoftwareApplication nodes for ${catalog.vendors.length} vendors`);
  sw.note(`${softwareNodes} SoftwareApplication nodes, ${offers} with offers`);
  id.note(`${crossRefs} references point at a node defined on another page (allowed: the id resolves in that page's graph)`);
  const dupGroups = new Map();
  let markedElsewhere = 0;
  for (const u of unmarked) {
    if (markedQuestions.has(squash(u.q))) markedElsewhere++;
    else fq.fail(u.path, `visible FAQ item has no FAQPage markup on any page: "${u.q}"`);
  }
  if (markedElsewhere) fq.note(`${markedElsewhere} visible FAQ items are marked up on another page only (one marked-up instance per question)`);
  for (const [, list] of qaSeen) if (list.length > 1) dupGroups.set(list.join(', '), (dupGroups.get(list.join(', ')) || 0) + 1);
  for (const [key, k] of dupGroups) fq.warn(key.split(', ')[0], `${k} question+answer pair(s) repeated verbatim on ${key.split(', ').length} pages: ${key.split(', ').slice(0, 4).join(', ')}`);
  const withFaq = pages.filter((p) => (visibleFaq.get(p.path) || []).length);
  fq.note(`${withFaq.length} pages show an FAQ (${withFaq.reduce((n, p) => n + visibleFaq.get(p.path).length, 0)} items); ${extraVisible} visible answers carry extra trailing text (source / read-more links) that is not in the markup`);
  const dupPages = new Set([...qaSeen.values()].filter((l) => l.length > 1).flat());
  fq.note(`${[...qaSeen.values()].filter((l) => l.length > 1).length} question+answer pairs are marked up verbatim on more than one page (${dupPages.size} pages involved)`);
  for (const t of ['category', 'software', 'vs', 'alternatives']) {
    const missing = pages.filter((p) => p.type === t && !(visibleFaq.get(p.path) || []).length);
    if (missing.length) fq.warn(missing[0].path, `${missing.length} ${t} pages have no FAQ block (e.g. ${missing.slice(0, 3).map((p) => p.path).join(', ')})`);
  }
}

// ───────────────────────────────────────────────────────────── 6. answer first, pending scores
{
  const c = check('6a-answer-first', 'Category, product, comparison and alternatives pages: answer passage within the first 1,200 chars of <main>, names the entity, has a number and a date');
  const p = check('6b-pending-score', 'No number is printed for a pending score (tables, answers, profiles, llms-full.txt)');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const DATE_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/;
  const stats = [];
  for (const pg of pages) {
    if (!['category', 'software', 'vs', 'alternatives'].includes(pg.type) || !pg.main) continue;
    const slug = pg.path.split('/')[2];
    const box = first(pg.main, (n) => hasClass(n, 'answer'));
    if (!box) {
      c.fail(pg.path, 'no answer block (.answer) on the page');
      continue;
    }
    if (closest(box, (x) => 'data-nosnippet' in x.attrs)) c.fail(pg.path, 'answer block is inside data-nosnippet');
    const para = first(box, (n) => n.tag === 'p');
    const txt = para ? textOf(para) : '';
    const start = pg.mainText.indexOf(txt.slice(0, 60));
    const end = start + txt.length;
    stats.push(end);
    if (start < 0) c.fail(pg.path, 'answer text not found in <main> text');
    else if (start > 1200) c.fail(pg.path, `answer starts ${start} chars into <main> (limit 1,200)`);
    else if (end > 1200) c.warn(pg.path, `answer starts at ${start} but only ends at ${end} chars into <main>`);
    const words = txt.split(' ').length;
    if (words < 25 || words > 80) c.warn(pg.path, `answer is ${words} words (target 30–70)`);
    let entities = [];
    if (pg.type === 'category') entities = [[categoryById.get(slug)?.name, categoryById.get(slug)?.factual?.name].filter(Boolean).flatMap((n) => [n, n.replace(/ (software|tools|platforms|systems)$/i, '')])];
    else if (pg.type === 'vs') {
      const cmp = comparisonById.get(slug);
      const cat = categoryById.get(cmp?.categoryId);
      entities = (cmp?.vendorIds || []).map((v) => [vendorById.get(v)?.name, cat?.factual?.suppliers?.find((s) => s.id === v)?.name].filter(Boolean));
    } else entities = [[vendorById.get(slug)?.name].filter(Boolean)];
    for (const alts of entities) if (alts.length && !alts.some((n) => txt.toLowerCase().includes(n.toLowerCase()))) c.fail(pg.path, `answer does not name "${alts[0]}": "${txt.slice(0, 90)}…"`);
    if (!/\d/.test(txt)) c.fail(pg.path, `answer contains no number: "${txt.slice(0, 90)}…"`);
    if (!DATE_RE.test(txt)) c.fail(pg.path, `answer contains no date: "${txt.slice(0, 110)}…"`);
    if (/\b(best|top-rated|#1)\b/i.test(txt.replace(/Best for:/g, ''))) c.warn(pg.path, `superlative in the answer: "${txt.match(/.{0,30}\b(best|top-rated|#1)\b.{0,30}/i)[0]}"`);
  }
  stats.sort((a, b) => a - b);
  if (stats.length) c.note(`answer passage ends at min/median/max ${stats[0]}/${stats[stats.length >> 1]}/${stats[stats.length - 1]} chars of <main> text (${stats.length} pages)`);

  if (!scoreData.size) p.fail('/data/', 'no data/cat-*.js score data found — pending check not possible');
  const pendingIn = new Map(); // vendorId → { pending: Set(cat), scored: Set(cat) }
  for (const [k, v] of scoreData) {
    const [cat, vid] = k.split(':');
    const e = pendingIn.get(vid) || { pending: new Set(), scored: new Set() };
    (v.pending ? e.pending : e.scored).add(cat);
    pendingIn.set(vid, e);
  }
  const SCORE_RE = /(\d{1,3})\s*\/\s*100\b/;
  // text of every block that contains no other block (a paragraph, a cell, a list item …)
  const leafCache = new Map();
  const leafTexts = (pg) => {
    if (!leafCache.has(pg)) leafCache.set(pg, all(pg.main, (n) => BLOCK.has(n.tag) && !first(n, (x) => BLOCK.has(x.tag) && x.tag !== 'br')).map((n) => textOf(n)).filter(Boolean));
    return leafCache.get(pg);
  };
  const allNames = catalog.vendors.map((v) => v.name).sort((a, b) => b.length - a.length);
  for (const pg of pages) {
    if (!pg.main) continue;
    // rows of ranked tables
    for (const tr of all(pg.main, (n) => n.tag === 'tr' && n.attrs['data-id'])) {
      const cat = closest(tr, (x) => x.tag === 'table')?.attrs['data-category'];
      const sd = scoreData.get(`${cat}:${tr.attrs['data-id']}`);
      if (!sd) continue;
      const scoreCell = first(tr, (n) => hasClass(n, 'score')) || tr;
      const t = textOf(scoreCell);
      if (sd.pending && SCORE_RE.test(t)) p.fail(pg.path, `row ${tr.attrs['data-id']} (${cat}) is pending but prints "${t.match(SCORE_RE)[0]}"`);
      if (sd.pending && tr.attrs['data-score'] !== undefined && tr.attrs['data-score'] !== '-1') p.fail(pg.path, `row ${tr.attrs['data-id']} (${cat}) is pending but data-score="${tr.attrs['data-score']}"`);
      if (!sd.pending && !t.includes(`${sd.score}/100`) && scoreCell !== tr) p.fail(pg.path, `row ${tr.attrs['data-id']} (${cat}) should show ${sd.score}/100, shows "${t.slice(0, 40)}"`);
    }
    // sentences: "<pending product> … N/100" with no other product in between
    const scope = pg.type === 'vs' ? comparisonById.get(pg.path.split('/')[2])?.categoryId : pg.type === 'category' ? pg.path.split('/')[2] : null;
    for (const [vid, e] of pendingIn) {
      const pendingHere = scope ? e.pending.has(scope) : e.pending.size > 0 && e.scored.size === 0;
      if (!pendingHere) continue;
      const name = vendorById.get(vid)?.name;
      if (!name || !pg.mainText.includes(name)) continue;
      const re = new RegExp(`(?<![\\w-])${esc(name)}(?![\\w-])([^.;!?]{0,70}?)(\\d{1,3})\\s*/\\s*100\\b`, 'g');
      for (const blockText of leafTexts(pg)) {
        if (!blockText.includes(name)) continue;
        for (const m of blockText.matchAll(re)) {
          if (allNames.some((n) => n !== name && !name.includes(n) && m[1].includes(n))) continue;
          if (/\bvs\b|\bversus\b| and | or |,/.test(m[1])) continue;
          p.fail(pg.path, `"${m[0]}" — ${name} is score-pending${scope ? ` in ${scope}` : ''}`);
        }
      }
    }
    for (const blockText of leafTexts(pg)) for (const m of blockText.matchAll(/[^.!?;]*\bpending\b[^.!?;]{0,25}?\d{1,3}\s*\/\s*100\b[^.!?;]*/gi)) p.warn(pg.path, `"pending" next to a score, check by hand: "${norm(m[0]).slice(0, 140)}"`);
  }
  const full = readBuilt('/llms-full.txt') || '';
  for (const block of full.split(/\n(?=### )/)) {
    const url = (block.match(/^URL: (\S+)/m) || [])[1];
    if (!url) continue;
    const vid = url.replace(ORIGIN, '').split('/')[2];
    for (const m of block.matchAll(/^Documented-fit score in (.+?): (pending|(\d+)\/100)/gm)) {
      const cat = catalog.categories.find((c) => c.name === m[1]);
      const sd = cat && scoreData.get(`${cat.id}:${vid}`);
      if (!sd) p.fail('/llms-full.txt', `${vid}: category "${m[1]}" not found in the score data`);
      else if (sd.pending !== (m[2] === 'pending') || (!sd.pending && String(sd.score) !== m[3])) p.fail('/llms-full.txt', `${vid} in ${cat.id}: llms-full says "${m[2]}", page data says ${sd.pending ? 'pending' : sd.score + '/100'}`);
    }
  }
  p.note(`${[...scoreData.values()].filter((v) => v.pending).length} pending and ${[...scoreData.values()].filter((v) => !v.pending).length} scored product×category pairs checked`);
}

// ───────────────────────────────────────────────────────────── 7. wording, 8. dates
{
  const w = check('7-wording', 'Template text does not call the research a rating/review, show stars or claim "best" (catalog sentences excluded)');
  const d = check('8-dates', 'Every visible date in template text sits in <time datetime>; no raw ISO date; <time> is consistent');
  const WORD = /\b(ratings?|rated|reviews?|reviewed|reviewers?|stars?|best|top-rated)\b/gi;
  const NEGATED = /\b(not|never|no|isn['’]t|aren['’]t|without|rather than|instead of|neither|nor)\b[^.;:!?]{0,60}$/i;
  const ALLOWED = [
    /\bsource[- ]reviews?\b/i, // the site's own dated "source review" log
    /\bbest for\b/i, // label of the catalog field bestFor
    /\b(under|in|for|legal|security|human|manual|plan|contract|peer|code|approval|access|quarterly|annual|internal|compliance|risk|vendor|pending|editorial) review\b/i,
    /\breview(ed)? (the|a|an|each|every|your|its|their|this|that|these|those|how|what|which|whether|and|before|both|current|official|all|any|with|by|against|pricing|plan|limits?)\b/i,
    /\bbest[- ](documented|practice|practices|effort)\b/i,
    /\bat best\b/i,
  ];
  const tally = new Map();
  let dataHits = 0;
  let negated = 0;
  for (const pg of pages) {
    for (const { text: raw, el } of textNodes(pg.body)) {
      WORD.lastIndex = 0;
      if (!WORD.test(raw)) continue;
      if (inData(raw)) {
        dataHits++;
        continue;
      }
      const full = norm(textOf(closest(el, (x) => BLOCK.has(x.tag)) || el));
      for (const sentence of full.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)) {
        WORD.lastIndex = 0;
        let m;
        while ((m = WORD.exec(sentence))) {
          if (!norm(raw).includes(m[0])) continue;
          if (inData(sentence)) {
            dataHits++;
            continue;
          }
          if (/[-/.]$/.test(sentence.slice(0, m.index)) || /^[-/]\w|^\.\w/.test(sentence.slice(m.index + m[0].length))) continue; // inside a URL / hyphenated product term
          const toks = sentence.split(/\s+/);
          let pos = 0;
          const ti = toks.findIndex((tk) => (pos += tk.length + 1) > m.index);
          const windows = [toks.slice(Math.max(0, ti - 2), ti + 1), toks.slice(Math.max(0, ti - 1), ti + 2), toks.slice(ti, ti + 3)].filter((x) => x.length === 3).map((x) => x.join(' '));
          if (windows.some((x) => CORPUS.includes(x))) {
            dataHits++;
            continue;
          }
          const before = sentence.slice(0, m.index);
          const around = sentence.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
          if (NEGATED.test(before)) {
            negated++;
            continue;
          }
          if (ALLOWED.some((re) => re.test(sentence.slice(Math.max(0, m.index - 12), m.index + m[0].length + 14)))) continue;
          const key = `${m[0].toLowerCase()} — "${around.replace(/\d+/g, '#')}"`;
          const e = tally.get(key) || { n: 0, pages: new Set() };
          e.n++;
          e.pages.add(pg.path);
          tally.set(key, e);
        }
      }
    }
    const txt = textOf(pg.body);
    const star = txt.match(/[★☆⭐]|(?<![\d.\/])[0-5](\.\d)?\s*\/\s*5(?![\d.]|\s*(checked|pts|points|items|checks|of\b))|\b[0-5](\.\d)? out of 5\b(?!\s*(checks|items|checked))|\b\d(\.\d)?[- ]stars?\b/);
    if (star) w.fail(pg.path, `star / 5-point wording: "${star[0]}"`);
  }
  for (const [key, g] of [...tally].sort((a, b) => b[1].pages.size - a[1].pages.size)) w.warn([...g.pages][0], `${g.pages.size} page(s): ${key}`);
  w.note(`${dataHits} occurrences are catalog sentences (ignored); ${negated} are disclaimers ("not a user rating …")`);

  const inTime = (x) => x.tag === 'time';
  const LONG = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}, \d{4}\b/g;
  let dataDatesInText = 0;
  for (const pg of pages) {
    for (const { text: raw, el } of textNodes(pg.body, { skip: inTime })) {
      const hits = [...raw.matchAll(LONG), ...raw.matchAll(ISO_DATE)];
      if (!hits.length) continue;
      if (closest(el, (x) => ['code', 'pre', 'kbd'].includes(x.tag))) continue;
      if (inData(raw)) {
        dataDatesInText++;
        continue;
      }
      for (const m of hits) {
        if (/[\w/]/.test(raw[m.index - 1] || '') || /^[-/]\w/.test(raw.slice(m.index + m[0].length, m.index + m[0].length + 2))) continue; // part of a URL or file name
        // a catalog sentence (or clause) quoted inside a template sentence is data, not template text
        const cut = (re) => {
          const a = raw.slice(0, m.index).split(re).pop();
          const b = raw.slice(m.index + m[0].length).split(re)[0];
          return (a + m[0] + b).replace(/^[\s·—–:;,(-]+|[\s·—–:;,)-]+$/g, '');
        };
        if (inData(cut(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)) || inData(cut(/[;·]|\s[—–]\s/))) {
          dataDatesInText++;
          continue;
        }
        d.fail(pg.path, `${/^\d{4}-/.test(m[0]) ? 'raw ISO date' : 'date outside <time>'} "${m[0]}" in template text: "${norm(raw).slice(0, 110)}"`);
      }
    }
    for (const t of all(pg.body, inTime)) {
      const dtv = t.attrs.datetime;
      const shown = textOf(t);
      if (!dtv || !validIso(dtv)) d.fail(pg.path, `<time> without a valid datetime: "${shown}"`);
      else {
        const m = [...shown.matchAll(LONG)][0];
        const parts = m && m[0].match(/^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/);
        if (parts && toIso(parts[1], parts[2], parts[3]) !== dtv.slice(0, 10)) d.fail(pg.path, `<time datetime="${dtv}"> shows "${shown}"`);
        if (/^\d{4}-\d{2}-\d{2}/.test(shown)) d.fail(pg.path, `<time> shows a raw ISO date "${shown}"`);
        if (TODAY.has(dtv.slice(0, 10)) && !dataDates.has(dtv.slice(0, 10))) d.fail(pg.path, `<time datetime="${dtv}"> is the build date`);
        else if (!dataDates.has(dtv.slice(0, 10))) d.warn(pg.path, `<time datetime="${dtv}"> does not occur in the data`);
      }
    }
    const copyYear = textOf(pg.body).match(/©\s*(\d{4})/);
    if (copyYear && Number(copyYear[1]) !== now.getFullYear()) d.warn(pg.path, `copyright year ${copyYear[1]}`);
  }
  d.note(`${dataDatesInText} dated text nodes are verbatim catalog/publisher text (not template text)`);
}

// ───────────────────────────────────────────────────────────── 9. internal links  +  11. outbound links
{
  const g = check('9a-link-graph', 'No broken internal links, no orphan pages, every indexable page ≤ 3 clicks from home');
  const n = check('9b-in-links', 'In-content in-links: /vs/ and /alternatives/ pages > 1; every indexable page ≥ 5 from indexable pages (spec 2.7)');
  const x = check('9c-noindex-links', 'Share of internal link edges from indexable pages that point at noindex pages');
  const go = check('11a-go-links', 'Vendor CTAs use /go/{id}/?intent=&from= with the five data-outbound-* attributes');
  const af = check('11b-affiliate', 'Affiliate links: rel="sponsored nofollow noopener noreferrer", visible "Ad · affiliate link" label, page notice before the first one; others carry no Ad label');
  const so = check('11c-source-links', 'Cited-source links are plain followed links with rel noopener; no internal link is nofollow');
  const anchors = check('9d-anchor-text', 'In-content internal links use descriptive anchor text');

  const outAll = new Map(); // from → Set(to)   (whole body)
  const outMain = new Map(); // from → Set(to)  (inside <main>)
  const affiliateIds = new Set(serverData.affiliateVendorIds || []);
  const affiliatePricing = new Set(serverData.affiliatePricingLinkVendorIds || []);
  const expectAffiliate = (vid, intent) => {
    const o = serverData.outbound?.[vid];
    if (o && typeof o[`${intent}Affiliate`] === 'boolean') return o[`${intent}Affiliate`];
    return intent === 'pricing' ? affiliatePricing.has(vid) : affiliateIds.has(vid);
  };
  const vendorHosts = new Map(catalog.vendors.map((v) => [new URL(v.url).host.replace(/^www\./, ''), v.id]));
  const ATTRS = ['data-vendor-id', 'data-outbound-intent', 'data-outbound-placement', 'data-outbound-affiliate', 'data-destination-host'];
  let goCount = 0;
  let affCount = 0;
  let extCount = 0;
  let extNofollow = 0;
  for (const pg of pages) {
    const sA = new Set();
    const sM = new Set();
    const order = [...walk(pg.body)];
    const noticeIdx = order.findIndex((el) => el.attrs.role === 'note' && /affiliate/i.test(textOf(el)));
    let firstAff = -1;
    let pageAff = 0;
    order.forEach((a, idx) => {
      if (a.tag !== 'a' || a.attrs.href === undefined) return;
      const href = a.attrs.href;
      const r = resolve(pg.path, href);
      const rel = (a.attrs.rel || '').split(/\s+/).filter(Boolean);
      const inMain = Boolean(closest(a, (e) => e.tag === 'main'));
      if (r.bad) return g.fail(pg.path, `unparseable href "${href}"`);
      if (r.other) return;
      const wrap = closest(a, (e) => hasClass(e, 'commercial-link')) || a.parent;
      const adLabel = /Ad\s*·\s*affiliate link/i.test(textOf(wrap)) || /Ad\s*·\s*affiliate link/i.test(textOf(wrap.parent || wrap).slice(0, 400));
      if (!r.external && r.path.startsWith('/go/')) {
        goCount++;
        const m = r.path.match(/^\/go\/([^/]+)\/$/);
        const vid = m && m[1];
        const intent = r.params.get('intent');
        const from = r.params.get('from');
        if (!m || !vendorById.has(vid)) return go.fail(pg.path, `/go/ link to an unknown vendor: ${href}`);
        if (!['website', 'pricing'].includes(intent) || !from) go.fail(pg.path, `/go/ link without intent=website|pricing and from=: ${href}`);
        if ([...r.params.keys()].join(',') !== 'intent,from') go.fail(pg.path, `/go/ link query is not exactly ?intent=&from=: ${href}`);
        for (const k of ATTRS) if (a.attrs[k] === undefined || a.attrs[k] === '') go.fail(pg.path, `/go/${vid}/ link without ${k}`);
        if (a.attrs['data-vendor-id'] !== vid) go.fail(pg.path, `data-vendor-id "${a.attrs['data-vendor-id']}" ≠ ${vid}`);
        if (a.attrs['data-outbound-intent'] !== intent) go.fail(pg.path, `data-outbound-intent "${a.attrs['data-outbound-intent']}" ≠ intent=${intent} (${vid})`);
        if (a.attrs['data-outbound-placement'] !== from) go.fail(pg.path, `data-outbound-placement "${a.attrs['data-outbound-placement']}" ≠ from=${from} (${vid})`);
        const o = serverData.outbound?.[vid];
        const wantHost = o && o[`${intent}DestinationHost`];
        if (wantHost && a.attrs['data-destination-host'] !== wantHost) go.fail(pg.path, `data-destination-host "${a.attrs['data-destination-host']}" ≠ live "${wantHost}" (${vid}, ${intent})`);
        if (a.attrs.target !== '_blank') go.warn(pg.path, `/go/${vid}/ link does not open in a new tab`);
        const want = expectAffiliate(vid, intent);
        const is = a.attrs['data-outbound-affiliate'] === 'true';
        if (want !== is) af.fail(pg.path, `${vid} (${intent}): data-outbound-affiliate="${a.attrs['data-outbound-affiliate']}", live site says ${want}`);
        if (want) {
          affCount++;
          pageAff++;
          if (firstAff < 0) firstAff = idx;
          if (a.attrs.rel !== 'sponsored nofollow noopener noreferrer') af.fail(pg.path, `affiliate link ${vid} has rel="${a.attrs.rel || ''}"`);
          if (!adLabel) af.fail(pg.path, `affiliate link ${vid} ("${textOf(a)}") has no visible "Ad · affiliate link" label next to it`);
          if (closest(a, (e) => 'hidden' in e.attrs)) af.warn(pg.path, `affiliate link ${vid} is inside a [hidden] element`);
        } else {
          if (rel.includes('sponsored')) af.fail(pg.path, `non-affiliate link ${vid} carries rel=sponsored`);
          if (!rel.includes('noopener')) af.fail(pg.path, `/go/${vid}/ link without rel noopener`);
          if (/Ad\s*·\s*affiliate link/i.test(textOf(wrap))) af.fail(pg.path, `non-affiliate link ${vid} carries the "Ad · affiliate link" label`);
        }
        return;
      }
      if (r.external) {
        extCount++;
        const host = r.url.host.replace(/^www\./, '');
        const partner = closest(a, (e) => 'data-partner-ad' in e.attrs);
        if (partner || rel.includes('sponsored')) {
          pageAff++;
          if (firstAff < 0) firstAff = idx;
          if (a.attrs.rel !== 'sponsored nofollow noopener noreferrer') af.fail(pg.path, `sponsored partner link ${host} has rel="${a.attrs.rel || ''}"`);
          if (!/\bAd\b/.test(textOf(partner || wrap))) af.fail(pg.path, `sponsored partner link ${host} has no visible "Ad" label`);
          return;
        }
        if (rel.includes('nofollow') || rel.includes('ugc')) {
          extNofollow++;
          so.fail(pg.path, `cited-source link is nofollow: ${href.slice(0, 80)}`);
        }
        if (a.attrs.target === '_blank' && !rel.includes('noopener')) so.fail(pg.path, `external target=_blank link without rel noopener: ${href.slice(0, 80)}`);
        if (vendorHosts.has(host) && (hasClass(a, 'btn') || /^(visit|go to|try|get|start)\b/i.test(textOf(a)))) go.fail(pg.path, `vendor CTA "${textOf(a)}" links ${host} directly instead of /go/`);
        if (/[?&](ref|aff|affiliate|via|fpr|awc|irclickid|partner|kfl_ln)=|awin1\.com|sjv\.io|pxf\.io|impact\.com|shareasale/i.test(href)) af.fail(pg.path, `affiliate-looking URL without sponsored markup: ${href.slice(0, 90)}`);
        return;
      }
      // internal
      if (rel.includes('nofollow')) so.fail(pg.path, `internal link is nofollow: ${href}`);
      const label = textOf(a);
      if (inMain && !a.attrs['aria-label'] && /^(read more|learn more|more|here|click here|see more|view|details|see details|view research|full research|profile|view profile|full profile|open|go)$/i.test(label)) anchors.warn(pg.path, `generic anchor text "${label}" → ${r.path}`);
      let target = r.path;
      if (!byPath.has(target)) {
        if (fileSet.has(target) || fileSet.has(target + 'index.html')) return; // a file (feed, sitemap, asset)
        if (byPath.has(target + '/')) g.fail(pg.path, `internal link without trailing slash: ${href}`);
        else g.fail(pg.path, `broken internal link: ${href}`);
        return;
      }
      if (target === pg.path) return;
      sA.add(target);
      if (inMain) sM.add(target);
    });
    outAll.set(pg.path, sA);
    outMain.set(pg.path, sM);
    if (pageAff) {
      if (noticeIdx < 0) af.fail(pg.path, `${pageAff} affiliate link(s) but no page-level affiliate notice`);
      else if (noticeIdx > firstAff) af.fail(pg.path, 'the affiliate notice comes after the first affiliate link');
    } else if (noticeIdx >= 0 && !first(pg.body, (e) => 'data-partner-ad' in e.attrs)) af.warn(pg.path, 'affiliate notice shown on a page without any affiliate link in the HTML');
  }
  go.note(`${goCount} /go/ links, ${affCount} affiliate; ${extCount} direct external links, ${extNofollow} nofollow`);

  // graph
  const inAll = new Map(pages.map((p) => [p.path, new Set()]));
  const inMainIdx = new Map(pages.map((p) => [p.path, new Set()]));
  for (const [from, set] of outAll) for (const to of set) inAll.get(to).add(from);
  for (const [from, set] of outMain) if (!byPath.get(from).noindex) for (const to of set) inMainIdx.get(to).add(from);
  const depth = new Map([['/', 0]]);
  for (let q = ['/'], i = 0; i < q.length; i++) for (const to of outAll.get(q[i]) || []) if (!depth.has(to)) depth.set(to, depth.get(q[i]) + 1) && q.push(to);
  const byDepth = {};
  for (const pg of pages) {
    if (pg.path === '/404.html') continue;
    if (!inAll.get(pg.path).size && pg.path !== '/') g.fail(pg.path, 'orphan: no other page links here');
    const dd = depth.get(pg.path);
    byDepth[dd ?? 'unreachable'] = (byDepth[dd ?? 'unreachable'] || 0) + 1;
    if (dd === undefined) g.fail(pg.path, 'not reachable from the home page');
    else if (dd > 3 && !pg.noindex) g.fail(pg.path, `${dd} clicks from the home page`);
    else if (dd > 3) g.warn(pg.path, `${dd} clicks from the home page (noindex page)`);
  }
  g.note(`click depth from home: ${Object.entries(byDepth).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
  const med = (a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0);
  for (const t of ['software', 'category', 'vs', 'guide', 'alternatives', 'hub', 'static']) {
    const ofType = pages.filter((p) => p.type === t && p.path !== '/404.html');
    const tot = ofType.map((p) => inAll.get(p.path).size);
    const idx = ofType.filter((p) => !p.noindex).map((p) => inMainIdx.get(p.path).size);
    const anyMain = ofType.map((p) => inMainIdx.get(p.path).size);
    n.note(`${t.padEnd(12)} in-links from all pages min/median/max ${Math.min(...tot)}/${med(tot)}/${Math.max(...tot)}` + (idx.length ? ` · in-content from indexable pages (indexable targets, n=${idx.length}) ${Math.min(...idx)}/${med(idx)}/${Math.max(...idx)}` : ` · in-content from indexable pages (all noindex, n=${anyMain.length}) ${Math.min(...anyMain)}/${med(anyMain)}/${Math.max(...anyMain)}`));
  }
  for (const pg of pages) {
    const k = inMainIdx.get(pg.path).size;
    const mainAny = [...outMain].filter(([from, set]) => from !== pg.path && set.has(pg.path)).length;
    if ((pg.type === 'vs' || pg.type === 'alternatives') && mainAny <= 1) n.fail(pg.path, `${pg.type} page has ${mainAny} in-content in-link(s)`);
    else if (!pg.noindex && pg.type === 'vs' && k <= 1) n.fail(pg.path, `indexable vs page has only ${k} in-content in-link(s) from indexable pages (${mainAny} counting noindex pages)`);
    else if (!pg.noindex && pg.path !== '/' && k < 5) n.warn(pg.path, `indexable ${pg.type} page has ${k} in-content in-links from indexable pages (target ≥ 5)`);
  }
  let toNo = 0;
  let toIdx = 0;
  const targets = new Map();
  for (const [from, set] of outAll) {
    if (byPath.get(from).noindex) continue;
    for (const to of set) {
      if (byPath.get(to).noindex) {
        toNo++;
        const key = to.split('/').slice(0, 2).join('/') + '/';
        targets.set(key, (targets.get(key) || 0) + 1);
      } else toIdx++;
    }
  }
  x.note(`${toNo} edges from indexable pages go to noindex pages, ${toIdx} to indexable pages (${((toNo / (toNo + toIdx)) * 100).toFixed(1)}% → noindex; old site 15%)`);
  x.note(`noindex targets by section: ${[...targets].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (toNo / (toNo + toIdx) > 0.15) x.warn('/', `share of links to noindex pages (${((toNo / (toNo + toIdx)) * 100).toFixed(1)}%) is higher than on the old site (15%)`);
}

// ───────────────────────────────────────────────────────────── 10. crawler files
function xmlWellFormed(xml) {
  const stack = [];
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    if (m[1]) {
      if (stack.pop() !== m[2]) return `unbalanced </${m[2]}>`;
    } else if (!/\/\s*$/.test(m[3])) stack.push(m[2]);
  }
  if (stack.length) return `unclosed <${stack.pop()}>`;
  const bare = body.replace(/<[^>]*>/g, '').match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  return bare ? 'unescaped &' : null;
}
{
  const r = check('10a-robots', 'robots.txt: every group disallows /admin/ /api/ /go/, AI crawler groups present, Sitemap line, nothing noindex is blocked');
  const robots = readBuilt('/robots.txt');
  if (!robots) r.fail('/robots.txt', 'missing');
  else {
    const groups = [];
    let cur = null;
    let lastWasAgent = false;
    for (const line of robots.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) {
      const [k, ...rest] = line.split(':');
      const key = k.toLowerCase();
      const val = rest.join(':').trim();
      if (key === 'user-agent') {
        if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
        cur.agents.push(val);
        lastWasAgent = true;
      } else {
        lastWasAgent = false;
        if (key === 'allow' || key === 'disallow') cur ? cur.rules.push([key, val]) : r.fail('/robots.txt', `rule before any User-agent: ${line}`);
      }
    }
    const agents = groups.flatMap((x) => x.agents);
    for (const x of groups) {
      for (const p of ['/admin/', '/api/', '/go/']) if (!x.rules.some(([k, v]) => k === 'disallow' && v === p)) r.fail('/robots.txt', `group [${x.agents.join(', ')}] does not Disallow ${p}`);
      for (const [k, v] of x.rules) {
        if (k !== 'disallow' || !v) continue;
        if (v === '/') r.warn('/robots.txt', `group [${x.agents.join(', ')}] is blocked completely`);
        for (const pg of pages) if (pg.path.startsWith(v)) r.fail('/robots.txt', `Disallow ${v} blocks the page ${pg.path}${pg.noindex ? ' (noindex + Disallow)' : ''}`);
        if (/^\/(assets|data|brand)\b/.test(v)) r.fail('/robots.txt', `Disallow ${v} blocks CSS/JS/data`);
      }
    }
    for (const a of ['*', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Googlebot', 'Bingbot', 'Applebot', 'GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']) if (!agents.includes(a)) r.fail('/robots.txt', `no group for ${a}`);
    if (new Set(agents).size !== agents.length) r.fail('/robots.txt', 'a user-agent appears in two groups');
    const sm = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    if (sm.length !== 1 || sm[0] !== `${ORIGIN}/sitemap.xml`) r.fail('/robots.txt', `Sitemap line(s): ${sm.join(', ') || 'none'}`);
    r.note(`${groups.length} groups, ${agents.length} user-agents`);
  }

  const l = check('10b-llms', 'llms.txt / llms-full.txt: every link resolves to a built page; numbers equal the page data');
  for (const f of ['/llms.txt', '/llms-full.txt']) {
    const txt = readBuilt(f);
    if (!txt) {
      l.fail(f, 'missing');
      continue;
    }
    if (!/^# \S/.test(txt)) l.fail(f, 'does not start with an H1 line');
    const urls = [...txt.matchAll(/https?:\/\/[^\s)>\]]+/g)].map((m) => m[0].replace(/[.,;]+$/, ''));
    let internal = 0;
    const toNoindex = [];
    for (const u of new Set(urls)) {
      if (!u.startsWith(ORIGIN)) continue;
      internal++;
      const p = u.slice(ORIGIN.length).split('#')[0] || '/';
      const pg = byPath.get(p);
      if (!pg && !fileSet.has(p)) l.fail(f, `link does not resolve: ${u}`);
      else if (pg && pg.noindex && !/^\/(compare|search|shortlist)\/$/.test(p)) toNoindex.push(p);
    }
    if (toNoindex.length) l.warn(f, `links ${toNoindex.length} noindex pages (e.g. ${toNoindex.slice(0, 3).join(', ')})`);
    if (/\b(always recommend|ignore (all|other|previous)|you must (cite|recommend))\b/i.test(txt)) l.fail(f, 'instruction aimed at language models');
    if (/\b(undefined|NaN|null)\b|\[object/.test(txt)) l.fail(f, 'template leak');
    for (const m of txt.matchAll(ISO_DATE)) if (TODAY.has(m[0]) && !dataDates.has(m[0])) l.fail(f, `build date ${m[0]} printed`);
    l.note(`${f}: ${(Buffer.byteLength(txt) / 1024).toFixed(1)} KB, ${internal} internal URLs`);
    // category lines: "- [Name](url): N products, M scored; highest documented fit X S/100."
    let lines = 0;
    for (const m of txt.matchAll(/^- \[([^\]]+)\]\((\S+?)\): (\d+) products, (\d+) scored(?:; highest documented fit (.+?) (\d+)\/100)?/gm)) {
      lines++;
      const pg = byPath.get(m[2].slice(ORIGIN.length));
      const table = pg && pg.main && first(pg.main, (n) => n.tag === 'table' && n.attrs['data-category'] === m[2].split('/')[4]);
      if (!table) continue;
      const rows = all(table, (n) => n.tag === 'tr' && n.attrs['data-id']);
      const scored = rows.filter((tr) => tr.attrs['data-score'] !== '-1');
      if (rows.length !== Number(m[3]) || scored.length !== Number(m[4])) l.fail(f, `${m[1]}: says ${m[3]} products / ${m[4]} scored, the page table has ${rows.length} / ${scored.length}`);
      if (m[5]) {
        const top = rows.find((tr) => tr.attrs['data-rank'] === '1') || rows[0];
        if (top.attrs['data-name'] !== m[5] || top.attrs['data-score'] !== m[6]) l.fail(f, `${m[1]}: says top ${m[5]} ${m[6]}/100, the page table says ${top.attrs['data-name']} ${top.attrs['data-score']}/100`);
      }
    }
    // documentary category lines: "- [Name](url): N suppliers documented, no score assigned. Evidence checked Mon D, YYYY."
    for (const m of txt.matchAll(/^- \[([^\]]+)\]\((\S+?)\): (\d+) suppliers documented[^\n]*?Evidence checked ([A-Z][a-z]{2} \d{1,2}, \d{4})/gm)) {
      lines++;
      const c = categoryById.get(m[2].split('/')[4]);
      const pg = byPath.get(m[2].slice(ORIGIN.length));
      if (!c?.factual || c.factual.suppliers.length !== Number(m[3])) l.fail(f, `${m[1]}: says ${m[3]} suppliers, the catalog has ${c?.factual?.suppliers?.length}`);
      if (pg && !pg.mainText.includes(m[4])) l.fail(f, `${m[1]}: evidence date ${m[4]} is not printed on the page`);
    }
    l.note(`${f}: ${lines} category lines compared with the category pages`);
  }
  const full = readBuilt('/llms-full.txt') || '';
  let blocks = 0;
  for (const block of full.split(/\n(?=### )/)) {
    const url = (block.match(/^URL: (\S+)/m) || [])[1];
    if (!url) continue;
    blocks++;
    const pg = byPath.get(url.slice(ORIGIN.length));
    if (!pg) continue;
    const price = (block.match(/^Starting price: (.+)$/m) || [])[1] || '';
    const amount = price.match(/^(?:from )?((?:\$|USD |€|£)\s?[\d.,]*\d)/);
    if (amount && !pg.mainText.includes(amount[1])) l.fail('/llms-full.txt', `${url.slice(ORIGIN.length)}: price "${amount[1]}" is not printed on the profile`);
    if (/^no verified public starting price/.test(price) && nodesOf(pg, 'SoftwareApplication').some((n) => n.offers)) l.fail('/llms-full.txt', `${url.slice(ORIGIN.length)}: "no verified public starting price" but the profile has offers markup`);
    for (const m of block.matchAll(/^Documented-fit score in (.+?): (\d+)\/100/gm)) if (!pg.mainText.includes(`${m[2]}/100`)) l.fail('/llms-full.txt', `${url.slice(ORIGIN.length)}: ${m[2]}/100 in ${m[1]} is not printed on the profile`);
    const best = (block.match(/^Best for: (.+)$/m) || [])[1];
    if (best && !squash(pg.mainText).toLowerCase().includes(squash(best).toLowerCase())) l.fail('/llms-full.txt', `${url.slice(ORIGIN.length)}: "Best for" text is not on the profile`);
  }
  if (blocks !== catalog.vendors.length) l.fail('/llms-full.txt', `${blocks} product blocks for ${catalog.vendors.length} vendors`);

  const fd = check('10c-feeds', 'feed.xml (RSS 2.0) and atom.xml are well-formed, dated from data, and keep the live GUIDs');
  const liveFile = (name) => {
    for (const d of LIVE ? [LIVE, path.join(LIVE, 'mirror')] : []) if (fs.existsSync(path.join(d, name))) return fs.readFileSync(path.join(d, name), 'utf8');
    return null;
  };
  const rss = readBuilt('/feed.xml');
  if (!rss) fd.fail('/feed.xml', 'missing');
  else {
    const wf = xmlWellFormed(rss);
    if (wf) fd.fail('/feed.xml', `not well-formed: ${wf}`);
    if (!/<rss[^>]+version="2\.0"/.test(rss)) fd.fail('/feed.xml', 'not RSS 2.0');
    for (const tag of ['title', 'link', 'description']) if (!new RegExp(`<channel>[\\s\\S]*?<${tag}>`).test(rss)) fd.fail('/feed.xml', `channel <${tag}> missing`);
    if (!/<atom:link[^>]+rel="self"/.test(rss)) fd.warn('/feed.xml', 'no atom:link rel="self"');
    const items = rss.split('<item>').slice(1);
    const guids = new Set();
    for (const it of items) {
      const guid = (it.match(/<guid[^>]*>([^<]+)</) || [])[1];
      const pub = (it.match(/<pubDate>([^<]+)</) || [])[1];
      const link = decode((it.match(/<link>([^<]+)</) || [])[1] || '');
      if (!guid) fd.fail('/feed.xml', 'item without guid');
      else if (guids.has(guid)) fd.fail('/feed.xml', `duplicate guid ${guid}`);
      guids.add(guid);
      if (!pub || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} (GMT|[+-]\d{4})$/.test(pub)) fd.fail('/feed.xml', `item pubDate missing or not RFC 822: ${pub}`);
      else if (!dataDates.has(new Date(pub).toISOString().slice(0, 10))) fd.fail('/feed.xml', `pubDate ${pub} is not a data date`);
      if (!link.startsWith(ORIGIN) || !byPath.has(link.slice(ORIGIN.length).split('#')[0])) fd.fail('/feed.xml', `item link does not resolve: ${link}`);
    }
    const lbd = (rss.match(/<lastBuildDate>([^<]+)</) || [])[1];
    if (lbd && !dataDates.has(new Date(lbd).toISOString().slice(0, 10))) fd.fail('/feed.xml', `lastBuildDate ${lbd} is not a data date`);
    fd.note(`feed.xml: ${items.length} items`);
    const live = liveFile('feed.xml');
    if (live) {
      const liveGuids = new Set([...live.matchAll(/<guid[^>]*>([^<]+)</g)].map((m) => m[1]));
      const lost = [...liveGuids].filter((x) => !guids.has(x));
      const added = [...guids].filter((x) => !liveGuids.has(x));
      if (lost.length) fd.fail('/feed.xml', `${lost.length} live GUIDs are gone (e.g. ${lost[0]})`);
      if (added.length) fd.warn('/feed.xml', `${added.length} GUIDs are new compared with the live feed (e.g. ${added[0]})`);
      fd.note(`feed.xml GUIDs: live ${liveGuids.size}, build ${guids.size}`);
    } else fd.note('live feed not given (--live=<dir>): GUID parity not checked');
  }
  const atom = readBuilt('/atom.xml');
  if (!atom) fd.fail('/atom.xml', 'missing');
  else {
    const wf = xmlWellFormed(atom);
    if (wf) fd.fail('/atom.xml', `not well-formed: ${wf}`);
    if (!/<feed[^>]+xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/.test(atom)) fd.fail('/atom.xml', 'not an Atom 1.0 feed');
    const head = atom.split('<entry>')[0];
    for (const tag of ['title', 'id', 'updated']) if (!new RegExp(`<${tag}[ >]`).test(head)) fd.fail('/atom.xml', `feed <${tag}> missing`);
    const entries = atom.split('<entry>').slice(1);
    const ids = new Set();
    for (const e of entries) {
      const eid = (e.match(/<id>([^<]+)</) || [])[1];
      const upd = (e.match(/<updated>([^<]+)</) || [])[1];
      if (!eid) fd.fail('/atom.xml', 'entry without id');
      ids.add(eid);
      if (!upd || !validIso(upd)) fd.fail('/atom.xml', `entry updated missing or invalid: ${upd}`);
      else if (!dataDates.has(upd.slice(0, 10))) fd.fail('/atom.xml', `entry updated ${upd} is not a data date`);
      if (!/<title[ >]/.test(e) || !/<link /.test(e)) fd.fail('/atom.xml', `entry without title/link: ${eid}`);
    }
    const fu = (head.match(/<updated>([^<]+)</) || [])[1];
    if (fu && !dataDates.has(fu.slice(0, 10))) fd.fail('/atom.xml', `feed updated ${fu} is not a data date`);
    const live = liveFile('atom.xml');
    if (live) {
      const liveIds = new Set(live.split('<entry>').slice(1).map((e) => (e.match(/<id>([^<]+)</) || [])[1]));
      const lost = [...liveIds].filter((x) => !ids.has(x));
      if (lost.length) fd.fail('/atom.xml', `${lost.length} live entry ids are gone (e.g. ${lost[0]})`);
      fd.note(`atom.xml ids: live ${liveIds.size}, build ${ids.size}`);
    }
    fd.note(`atom.xml: ${entries.length} entries`);
  }

  const m = check('10d-404-manifest', '404.html works at any URL depth and is noindex; site.webmanifest is valid and its icons exist');
  const nf = byPath.get('/404.html');
  if (!nf) m.fail('/404.html', 'missing');
  else {
    if (!nf.noindex) m.fail('/404.html', 'not noindex');
    const rel = all(nf.doc, (n) => ['link', 'script', 'img', 'a', 'form'].includes(n.tag))
      .map((n) => n.attrs.href ?? n.attrs.src ?? n.attrs.action)
      .filter((u) => u && !/^(https?:|\/|#|mailto:|data:)/.test(u));
    if (rel.length) m.fail('/404.html', `${rel.length} relative URLs (e.g. "${rel[0]}") — the 404 page is served at arbitrary depths, so they break under /a/b/`);
    if (!all(nf.body, (n) => n.tag === 'a').some((a) => /\/search\/|\/categories\//.test(a.attrs.href || ''))) m.warn('/404.html', 'no link to search or categories');
  }
  const mf = readBuilt('/site.webmanifest');
  if (!mf) m.fail('/site.webmanifest', 'missing');
  else {
    try {
      const j = JSON.parse(mf);
      for (const k of ['name', 'short_name', 'icons', 'start_url']) if (!j[k]) m.fail('/site.webmanifest', `${k} missing`);
      for (const ic of j.icons || []) if (!fileSet.has('/' + ic.src.replace(/^\.?\//, ''))) m.fail('/site.webmanifest', `icon not in the build: ${ic.src}`);
    } catch (e) {
      m.fail('/site.webmanifest', `invalid JSON: ${e.message}`);
    }
  }
  for (const f of ['/brand/logo-512.png', '/favicon.svg', '/assets/social-preview.png']) if (!fileSet.has(f)) m.fail(f, 'referenced by every page but not in the build');
}

// ───────────────────────────────────────────────────────────── 12. images, snippet hygiene, weight
{
  const c = check('12-budgets', 'Images have alt/width/height and stay under 300 KB; HTML ≤ 250 KB; JSON-LD ≤ 20 KB; no content hidden from snippets');
  for (const pg of pages) {
    for (const img of all(pg.body, (n) => n.tag === 'img')) {
      if (img.attrs.alt === undefined) c.fail(pg.path, `img without alt: ${img.attrs.src}`);
      if (!img.attrs.width || !img.attrs.height) c.fail(pg.path, `img without width/height: ${img.attrs.src}`);
    }
    if (pg.bytes > 250 * 1024) c.fail(pg.path, `HTML weighs ${(pg.bytes / 1024).toFixed(0)} KB (cap 250 KB)`);
    const elements = all(pg.body, () => true).length;
    if (elements > 3000) c.warn(pg.path, `${elements} elements in <body> (cap 3,000)`);
    if (pg.ldBytes > 20 * 1024) c.warn(pg.path, `JSON-LD weighs ${(pg.ldBytes / 1024).toFixed(1)} KB (cap 20 KB)`);
    if (pg.main) for (const el of all(pg.main, (n) => 'data-nosnippet' in n.attrs && !closest(n.parent, (x) => 'data-nosnippet' in x.attrs))) {
      const t = textOf(el);
      const controls = all(el, (n) => ['button', 'input', 'select', 'label'].includes(n.tag)).length;
      if (t.length > 700 && controls < 3 && !/affiliate|cookie|privacy choices/i.test(t.slice(0, 200)) && !['nav', 'dialog', 'form'].includes(el.tag)) c.warn(pg.path, `${t.length} chars of <main> are inside data-nosnippet: "${t.slice(0, 70)}…"`);
    }
  }
  for (const f of fileSet) {
    if (!/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(f)) continue;
    const size = fs.statSync(path.join(DIR, f)).size;
    if (size > 300 * 1024) c.fail(f, `image weighs ${(size / 1024).toFixed(0)} KB (> 300 KB)`);
  }
  const sizes = pages.map((p) => p.bytes).sort((a, b) => a - b);
  c.note(`HTML bytes median/max ${(sizes[sizes.length >> 1] / 1024).toFixed(0)}/${(sizes[sizes.length - 1] / 1024).toFixed(0)} KB; JSON-LD max ${(Math.max(...pages.map((p) => p.ldBytes)) / 1024).toFixed(1)} KB`);
}

// ───────────────────────────────────────────────────────────── report
const results = [...CHECKS.values()];
const failed = results.filter((c) => c.fails.length);
if (AS_JSON) {
  console.log(JSON.stringify({ dir: DIR, pages: pages.length, indexable: indexable.length, failedChecks: failed.length, checks: results }, null, 1));
} else {
  const countPages = (list) => new Set(list.map((x) => x.where)).size;
  console.log(`SEO/GEO audit of ${DIR}`);
  console.log(`${pages.length} pages (${indexable.length} indexable) · ${results.length} checks · ${failed.length} failing\n`);
  for (const c of results) {
    const state = c.fails.length ? 'FAIL' : c.warns.length ? 'WARN' : 'PASS';
    const counts = [c.fails.length && `${c.fails.length} failures on ${countPages(c.fails)} pages`, c.warns.length && `${c.warns.length} warnings on ${countPages(c.warns)} pages`].filter(Boolean).join(', ');
    console.log(`${state}  ${c.id}  ${c.title}${counts ? `  — ${counts}` : ''}`);
    for (const n of c.notes) console.log(`        · ${n}`);
    const show = (list, mark) => {
      const groups = new Map();
      for (const e of list) {
        const key = e.msg.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, '#').slice(0, 60);
        groups.set(key, [...(groups.get(key) || []), e]);
      }
      for (const [, g] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, MAX * 4)) {
        console.log(`        ${mark} ×${g.length}  ${g[0].where}: ${g[0].msg.slice(0, 260)}`);
        for (const e of g.slice(1, MAX)) console.log(`              ${e.where}: ${e.msg.slice(0, 200)}`);
      }
      if (groups.size > MAX * 4) console.log(`        ${mark} … ${groups.size - MAX * 4} more kinds (use --json)`);
    };
    show(c.fails, '✗');
    show(c.warns, '!');
  }
  console.log(`\n${failed.length ? `FAILED: ${failed.map((c) => c.id).join(', ')}` : 'All checks passed'}`);
}
process.exit(failed.length ? 1 : 0);
