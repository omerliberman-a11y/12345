// Emits the client data files:
//   /data/search-index.js  — one unified index (categories, products, suppliers, comparisons, guides, pages, FAQs)
//   /data/vendors.js       — id → [name, logoPath, darkSurface, primaryCategoryId] for the shortlist tray
// Files are plain scripts that call SC.define(name, data) so they load from any host (and from file://).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { siteFaq } from '../lib/site-faq.mjs';
import { WIDE_LOGO_RATIO } from '../lib/components.mjs';

export async function loadEngine(root) {
  const src = await readFile(path.join(root, 'src/assets/js/search.js'), 'utf8');
  const m = { exports: {} };
  new Function('module', 'exports', 'self', src)(m, m.exports, undefined);
  return m.exports;
}

export async function buildSearchIndex(ctx, root) {
  const E = await loadEngine(root);
  const aliasData = JSON.parse(await readFile(path.join(root, 'data/content/search-aliases.json'), 'utf8'));
  const SYN = ctx.content.synonyms;
  const uniq = (arr) => [...new Set(arr)];
  const field = (...texts) => uniq(texts.flat().filter(Boolean).flatMap((t) => E.toks(t))).join(' ');
  const norm = (s) => E.words(s).join(' ');
  const docs = [];

  // ---- categories
  const cats = {};
  for (const c of ctx.categories) {
    const factual = ctx.isFactual(c);
    const count = factual ? c.factual.suppliers.length : ctx.summary(c.id).total;
    cats[c.id] = [c.name, factual ? 'f' : 's', count];
    docs.push({
      t: 'category',
      id: c.id,
      n: c.name,
      u: ctx.url.category(c.id),
      s: factual ? `${count} suppliers compared · ${ctx.groupOf(c).label}` : `${count} products ranked · ${ctx.groupOf(c).label}`,
      c: [c.id],
      m: factual ? 'f' : 's',
      k: count,
      f: {
        n: field(c.name),
        a: field(c.id.replace(/-/g, ' '), SYN[c.id] || [], factual ? c.factual.heading : ''),
        d: field(c.description, c.buyerQuestion || ''),
        f: field((factual ? c.factual.criteria : c.features).map((x) => x.label)),
      },
    });
  }

  // ---- products (full profiles)
  const byId = new Map();
  for (const v of ctx.vendors) {
    const vc = ctx.vendorCategories(v);
    const primary = ctx.primaryCategory(v);
    const catScores = {};
    for (const c of vc) {
      const s = ctx.score(c.id, v.id);
      if (s && !s.pending) catScores[c.id] = s.value;
    }
    const scores = Object.values(catScores);
    const p = ctx.price(v);
    const usd = p.hasAmount && p.currency === 'USD';
    const d = {
      t: 'product',
      id: v.id,
      n: v.name,
      u: ctx.url.software(v.id),
      s: vc.map((c) => c.name).slice(0, 2).join(' · ') + (vc.length > 2 ? ` +${vc.length - 2}` : ''),
      c: vc.map((c) => c.id),
      al: (aliasData.aliases[v.id] || []).map(norm),
      sc: scores.length ? Math.max(...scores) : null,
      cs: scores.length ? catScores : undefined,
      am: usd ? p.amount : null,
      pu: p.hasAmount ? `${p.headline}${p.unit ? ' ' + p.unit : ''}` : p.headline,
      fr: v.pricing?.model === 'free' || (usd && p.amount === 0) ? 1 : 0,
      ai: v.ai?.level || 'not-verified',
      pf: 1,
      lg: v.logo?.path || '',
      dk: v.logo?.surface === 'dark' || v.logo?.surface === 'brand-gradient' ? 1 : 0, // white artwork: show on the dark logo surface
      wd: (v.logo?.width || 64) / (v.logo?.height || 64) >= WIDE_LOGO_RATIO ? 1 : 0, // wordmark much wider than tall: small tiles show a monogram
      f: {
        n: field(v.name),
        a: field(aliasData.aliases[v.id] || []),
        c: field(vc.map((c) => c.name)),
        b: field(v.bestFor),
        d: field(v.description, v.strengths || []),
        i: field(v.integrations || []),
        ai: field(v.ai?.capabilities || []),
      },
    };
    void primary;
    byId.set(v.id, d);
    docs.push(d);
  }

  // ---- documentary suppliers (no profile page; link to their section on the category page)
  for (const c of ctx.factualCategories) {
    for (const s of c.factual.suppliers) {
      const existing = byId.get(s.id);
      if (existing) {
        if (!existing.c.includes(c.id)) existing.c.push(c.id);
        existing.f.c = uniq((existing.f.c + ' ' + field(c.name)).split(' ')).join(' ');
        continue;
      }
      const amounts = (s.plans || []).map((pl) => pl.pricing?.amount).filter((x) => typeof x === 'number');
      const d = {
        t: 'product',
        id: s.id,
        n: s.name,
        u: ctx.url.supplier(c.id, s.id),
        s: `${c.name} · documented supplier`,
        c: [c.id],
        al: (aliasData.aliases[s.id] || []).map(norm),
        sc: null,
        am: amounts.length ? Math.min(...amounts) : null,
        pu: '',
        fr: amounts.includes(0) ? 1 : 0,
        pf: 0,
        f: { n: field(s.name), a: field(aliasData.aliases[s.id] || []), c: field(c.name), b: field(s.fit), d: field(s.segment) },
      };
      byId.set(s.id, d);
      docs.push(d);
    }
  }

  // ---- comparisons
  for (const k of ctx.comparisons) {
    const names = ctx.comparisonNames(k);
    const c = ctx.category(k.categoryId);
    const title = names.map((n) => n.name).join(' vs ');
    docs.push({
      t: 'comparison',
      id: k.id,
      n: title,
      u: ctx.url.vs(k.id),
      s: `Head-to-head · ${c.name}`,
      c: [k.categoryId],
      pr: names.map((n) => n.id),
      f: {
        n: field(title, k.title || ''),
        a: field(names.flatMap((n) => aliasData.aliases[n.id] || [])),
        c: field(c.name),
        d: field(k.description || k.summary || ''),
      },
    });
  }

  // ---- guides
  for (const g of ctx.guides) {
    docs.push({
      t: 'guide',
      id: g.id,
      n: g.title,
      u: ctx.url.guide(g.id),
      s: 'Buying guide',
      c: g.categoryIds || [],
      f: { n: field(g.title), c: field((g.categoryIds || []).map((id) => ctx.category(id)?.name)), d: field(g.description), h: field((g.sections || []).map((s) => s.heading)) },
    });
  }

  // ---- pages
  const PAGES = [
    ['/methodology/', 'How we score', 'The documented-fit score, weights, the 80% gate and tie rules', 'methodology scoring method score weights documented fit recommended ranking'],
    ['/faq/', 'Frequently asked questions', 'Scores, prices, dates, independence and corrections', 'faq questions answers help'],
    ['/tools/cost/', 'Total cost calculator', 'Model seats, usage and one-time costs over time', 'cost calculator price total cost of ownership tco budget seats'],
    ['/compare/', 'Compare products side by side', 'Pick 2–4 products in a category', 'compare side by side comparison builder versus'],
    ['/shortlist/', 'Your shortlist', 'Saved products and private notes in this browser', 'shortlist saved workspace notes'],
    ['/comparisons/', 'Comparison library', `${ctx.comparisons.length} head-to-head comparisons`, 'comparisons library head to head versus vs'],
    ['/guides/', 'Buying guides', `${ctx.guides.length} practical guides`, 'guides buying guide checklist how to choose'],
    ['/ai/', 'AI capability research', 'What AI each product documents, and its limits', 'ai artificial intelligence research agents assistants capabilities'],
    ['/categories/', 'All categories', `${ctx.categories.length} software categories`, 'categories all browse directory'],
    ['/software/', 'Software directory', `${ctx.vendors.length} product profiles A–Z`, 'software directory all products a-z list'],
    ['/research-updates/', 'Research updates', 'Dated source checks and changes', 'research updates changelog news feed rss'],
    ['/how-we-make-money/', 'How we make money', 'Affiliate links and independence', 'affiliate advertising commission money business model disclosure'],
    ['/editorial-policy/', 'Editorial responsibility', 'Who approves publication and how sources are checked', 'editorial policy responsibility approver sources'],
    ['/corrections/', 'Suggest a correction', 'Report an error with an official source', 'correction error report mistake wrong fix'],
    ['/partners/', 'Partners — add your software', 'Vendor onboarding and independence', 'partners vendors suppliers list my software add product submit'],
    ['/about/', 'About the publisher', 'CLICSYNC LTD and the research approach', 'about publisher company clicsync who'],
    ['/contact/', 'Contact', 'Reach the research and support team', 'contact email support'],
    ['/countries/', 'System Compare worldwide', 'Local editions by country', 'countries editions international uk germany france israel poland'],
    ['/privacy/', 'Privacy policy', '', 'privacy cookies data analytics'],
    ['/terms/', 'Terms of use', '', 'terms conditions legal'],
    ['/accessibility/', 'Accessibility', '', 'accessibility a11y contrast text size'],
  ];
  for (const [u, n, s, kw] of PAGES) docs.push({ t: 'page', id: u, n, u, s: s || 'Page', f: { n: field(n), a: field(kw) } });

  // ---- FAQs (site-wide + category)
  for (const g of siteFaq(ctx)) for (const it of g.items) docs.push({ t: 'faq', id: `faq-${it.id}`, n: it.q, u: `/faq/#${it.id}`, s: 'FAQ', f: { n: field(it.q), d: field(it.a) } });
  for (const c of ctx.scoredCategories) {
    (c.faq || []).forEach((it, i) => docs.push({ t: 'faq', id: `faq-${c.id}-${i}`, n: it.q, u: `${ctx.url.category(c.id)}#faq`, s: `FAQ · ${c.name}`, c: [c.id], f: { n: field(it.q), c: field(c.name) } }));
  }

  // ---- phrase → categories (names, ids, synonyms, multi-category phrases)
  const phrase = {};
  for (const c of ctx.categories) {
    for (const p of [c.name, c.id.replace(/-/g, ' '), ...(SYN[c.id] || [])]) {
      const k = E.key(p);
      if (!k) continue;
      (phrase[k] ||= []).includes(c.id) || phrase[k].push(c.id);
    }
  }
  for (const [p, ids] of Object.entries(aliasData.multi || {})) phrase[E.key(p)] = ids;

  // drop empty fields to save bytes
  for (const d of docs) {
    for (const k of Object.keys(d.f)) if (!d.f[k]) delete d.f[k];
    for (const k of ['al', 'c']) if (Array.isArray(d[k]) && !d[k].length) delete d[k];
    for (const k of ['sc', 'am']) if (d[k] === null) delete d[k];
    for (const k of ['fr', 'pu', 'lg', 'dk', 'wd', 's']) if (!d[k]) delete d[k];
  }
  return { v: 1, cats, phrase, docs };
}

export async function generate(ctx, emit) {
  const root = ctx.root;
  const index = await buildSearchIndex(ctx, root);
  ctx.searchIndex = index;
  await emit('/data/search-index.js', `SC.define("search-index",${JSON.stringify(index)});`);

  const vendors = {};
  // [name, logoPath, darkSurface, primaryCategoryId, wideWordmark]
  for (const v of ctx.vendors) vendors[v.id] = [v.name, v.logo?.path || '', v.logo?.surface === 'dark' || v.logo?.surface === 'brand-gradient' ? 1 : 0, v.categories?.[0] || '', (v.logo?.width || 64) / (v.logo?.height || 64) >= WIDE_LOGO_RATIO ? 1 : 0];
  const catNames = Object.fromEntries(ctx.categories.map((c) => [c.id, c.name]));
  await emit('/data/vendors.js', `SC.define("vendors",${JSON.stringify({ vendors, categories: catNames })});`);
}
