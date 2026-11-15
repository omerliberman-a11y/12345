// Build context: loads the catalog + captured server-side content once, computes every score with
// the verified scoring module, and exposes the helpers page modules use. Nothing here renders HTML.
//
// The public shape (what templates may rely on) is documented in ARCHITECTURE.md.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as sc from './scoring.mjs';
import config from '../../site.config.mjs';

export { fmtDate, isoDate, maxDate, fmtMoney, plural, listText, planLabel } from './format.mjs';
import { fmtDate, isoDate, maxDate, fmtMoney, plural, listText, planLabel } from './format.mjs';
import { createSeo } from './seo.mjs';
import { createAnswers } from './answers.mjs';

const AI_LEVELS = {
  native: { label: 'Native AI', short: 'Native', rank: 5, help: 'AI features are built into the product and documented by the vendor.' },
  agent: { label: 'AI agents', short: 'Agents', rank: 6, help: 'Documented AI agents that can take actions, not only assist.' },
  assistant: { label: 'AI assistant', short: 'Assistant', rank: 4, help: 'A documented assistant that drafts, summarises or answers.' },
  predictive: { label: 'Predictive AI', short: 'Predictive', rank: 3, help: 'Documented predictive or scoring models.' },
  integration: { label: 'AI via integration', short: 'Integration', rank: 2, help: 'AI is available through a documented integration or add-on.' },
  'not-verified': { label: 'AI not verified', short: 'Not verified', rank: 0, help: 'We found no official documentation of AI features. Not verified does not mean absent.' },
};

const PRICING_MODELS = {
  subscription: 'Subscription',
  mixed: 'Subscription + usage',
  quote: 'Quote only',
  usage: 'Usage-based',
  free: 'Free',
};

export async function createContext({ root, manifest = {}, links = 'relative', base = '/', overrides = {} }) {
  const readJson = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));
  const catalogText = await readFile(path.join(root, 'data/catalog.json'), 'utf8');
  const catalog = JSON.parse(catalogText);
  const dataVersion = createHash('sha256').update(catalogText).digest('hex').slice(0, 8);
  const content = {
    softwareServer: await readJson('data/content/software-server-data.json'),
    staticServer: await readJson('data/content/static-server-content.json'),
    hreflang: await readJson('data/content/hreflang.json'),
    liveHead: await readJson('data/content/live-head.json'),
    guideSeoTitles: await readJson('data/content/guide-seo-titles.json'),
    taxonomy: await readJson('data/content/taxonomy.json'),
    synonyms: await readJson('data/content/search-synonyms.json'),
  };
  const site = { ...config, ...overrides };

  // ------------------------------------------------------------------ indexes
  const categoryById = new Map(catalog.categories.map((c) => [c.id, c]));
  const vendorById = new Map(catalog.vendors.map((v) => [v.id, v]));
  const guideById = new Map(catalog.guides.map((g) => [g.id, g]));
  const comparisonById = new Map(catalog.comparisons.map((c) => [c.id, c]));

  // ------------------------------------------------------------------ taxonomy (10 normalised groups)
  const groups = content.taxonomy.groups.map((g) => ({
    id: g.id,
    label: g.label,
    blurb: g.blurb,
    isAi: g.id.startsWith('ai-'),
    categories: g.categories.map((id) => categoryById.get(typeof id === 'string' ? id : id.id)).filter(Boolean),
  }));
  const groupOfCategory = new Map();
  for (const g of groups) for (const c of g.categories) groupOfCategory.set(c.id, g);
  const ungrouped = catalog.categories.filter((c) => !groupOfCategory.has(c.id));
  if (ungrouped.length) throw new Error(`categories missing from taxonomy: ${ungrouped.map((c) => c.id).join(', ')}`);

  // ------------------------------------------------------------------ scoring (computed once)
  const summaries = new Map();
  const summary = (categoryId) => {
    if (!summaries.has(categoryId)) {
      const category = categoryById.get(categoryId);
      if (!category) throw new Error(`unknown category ${categoryId}`);
      summaries.set(categoryId, sc.categorySummary(catalog, category));
    }
    return summaries.get(categoryId);
  };
  const isFactual = (category) => sc.isFactual(typeof category === 'string' ? categoryById.get(category) : category);
  /** Score record for a (category, vendor) pair of a scored category. */
  const fit = (categoryId, vendorId) => summary(categoryId).results.get(vendorId) || null;
  /** 1-based published rank inside the category (pending products follow scored ones). */
  const rankOf = (categoryId, vendorId) => {
    const i = summary(categoryId).ranked.findIndex((v) => v.id === vendorId);
    return i < 0 ? null : i + 1;
  };
  const isRecommended = (categoryId, vendorId) => summary(categoryId).recommended.some((v) => v.id === vendorId);
  /**
   * Published place inside the category. Products with the same published score share a place (the order
   * inside a tie is unrounded score, coverage, then name — not a ranking), and score-pending products have none.
   */
  const places = new Map();
  const placeOf = (categoryId, vendorId) => {
    if (!places.has(categoryId)) {
      const s = summary(categoryId);
      const scored = s.ranked.filter((v) => !s.results.get(v.id).isPending).map((v) => [v.id, s.results.get(v.id).score]);
      const m = new Map();
      for (const [id, value] of scored) m.set(id, { place: 1 + scored.filter((o) => o[1] > value).length, tied: scored.filter((o) => o[1] === value).length, of: scored.length });
      places.set(categoryId, m);
    }
    return places.get(categoryId).get(vendorId) || { place: null, tied: 0, of: places.get(categoryId).size };
  };

  /** Categories of a vendor in catalog order (the order the live site uses for sections). */
  const vendorCategories = (vendor) => catalog.categories.filter((c) => vendor.categories?.includes(c.id));
  /** The category used for a vendor's headline price / default comparison scope. */
  const primaryCategory = (vendor) => categoryById.get(vendor.categories?.[0]) || vendorCategories(vendor)[0] || null;

  // ------------------------------------------------------------------ price view-model
  // Units are free text in the catalog ("user/month", "account / month", "month plus fees").
  // Normalise only the shape, never the meaning: "user/month" → "per user/month".
  function normUnit(u) {
    u = String(u || '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
    if (!u) return '';
    if (/^month\b/i.test(u)) return 'per ' + u;
    if (/^(per|monthly|one-time|flat|annual|yearly|additional|core|starting|from|each)\b/i.test(u)) return u;
    if (/^[a-z][a-z -]*\/(month|year|mo|yr)\b/i.test(u)) return 'per ' + u;
    return u;
  }
  function price(vendor, categoryId = vendor.categories?.[0]) {
    const p = sc.pricingFor(vendor, categoryId);
    const hasAmount = p.amount !== null && p.amount !== undefined;
    const checked = typeof p.verifiedAt === 'string' ? p.verifiedAt.slice(0, 10) : null;
    let headline;
    let state;
    if (hasAmount) {
      headline = fmtMoney(p.amount, p.currency, categoryId);
      state = 'amount';
    } else if (p.smsUnverified) {
      headline = 'SMS price not verified';
      state = 'unverified';
    } else if (p.model === 'quote') {
      headline = 'Custom quote';
      state = 'quote';
    } else if (p.model === 'usage') {
      headline = 'Usage-based';
      state = 'usage';
    } else {
      headline = 'Price not verified';
      state = 'unverified';
    }
    // The unit is free text in the catalog ("per user/month", "account / month" …); the redundant
    // ", annual billing" tail is dropped when we already say "billed annually".
    let unit = normUnit(p.unit);
    const annual = hasAmount && p.billing === 'annual';
    if (annual) unit = unit.replace(/,?\s*(annual billing|billed annually)$/i, '');
    return {
      state, // amount | quote | usage | unverified
      hasAmount,
      amount: hasAmount ? Number(p.amount) : null,
      currency: p.currency || null,
      headline,
      unit: hasAmount ? unit : '',
      // the pricing basis as recorded, also when no amount is verified ("per sales seat/month, plus usage")
      basis: p.smsUnverified ? '' : normUnit(p.unit),
      billingNote: annual ? 'billed annually' : '',
      plan: p.plan || '',
      planLabel: planLabel(p.plan),
      model: p.model || null,
      modelLabel: PRICING_MODELS[p.model] || 'Not verified',
      summary: p.summary || '',
      extras: Array.isArray(p.extras) ? p.extras : [],
      sourceUrl: p.source || null,
      checkedAt: checked,
      checkedLabel: checked ? `Price checked ${fmtDate(checked)}` : 'Price-check date not recorded',
      smsUnverified: Boolean(p.smsUnverified),
      // one-line text for meta descriptions / answers: "$35 per user/month, billed annually"
      text: hasAmount ? `${headline}${unit ? ' ' + unit : ''}${annual ? ', billed annually' : ''}` : headline.toLowerCase(),
    };
  }

  // ------------------------------------------------------------------ score view-model
  /** Printable place: place 3 → "3" / "#3 of 7 scored"; a shared place → "=1" / "Tied #1 of 12"; pending → "". */
  function placeView(categoryId, vendorId) {
    const { place, tied, of } = placeOf(categoryId, vendorId);
    const total = summary(categoryId).total;
    return {
      place, // number | null (score pending)
      tied: tied > 1 ? tied : 0, // how many products share this place (0 = not shared)
      placeOf: of, // number of scored products in the category
      placeText: place ? `${tied > 1 ? '=' : ''}${place}` : '',
      placeLabel: place ? `${tied > 1 ? 'Tied ' : ''}#${place} of ${of}${of < total ? ' scored' : ''}` : '',
    };
  }
  function score(categoryId, vendorId) {
    const r = fit(categoryId, vendorId);
    if (!r) return null;
    const pct = Math.floor(r.coverage ?? 0);
    return {
      value: r.score, // integer or null
      pending: r.score === null,
      checked: r.checkedCount,
      total: r.totalCount,
      coveragePct: pct,
      documented: r.documentedItems,
      checkedAt: r.checkedAt,
      groups: r.groupScores,
      rows: r.rows,
      rank: rankOf(categoryId, vendorId), // position in the published order (sorting only — never print it)
      ...placeView(categoryId, vendorId),
      recommended: isRecommended(categoryId, vendorId),
      // verbatim strings of the published method
      valueText: r.score === null ? 'Score pending' : `${r.score}/100`,
      coverageText: `${r.checkedCount} of ${r.totalCount} checked (${pct}% of checklist weight)`,
      documentedText: `${r.documentedItems} of ${r.totalCount} capabilities documented`,
      raw: r,
    };
  }

  const aiLevel = (vendor) => ({ id: vendor.ai?.level || 'not-verified', ...(AI_LEVELS[vendor.ai?.level] || AI_LEVELS['not-verified']) });

  // ------------------------------------------------------------------ outbound links (/go/ contract)
  const affiliateIds = new Set(content.softwareServer.affiliateVendorIds || []);
  const affiliatePricingIds = new Set(content.softwareServer.affiliatePricingLinkVendorIds || []);
  const hostOf = (u) => {
    try {
      return new URL(u).host;
    } catch {
      return '';
    }
  };
  /**
   * Outbound vendor link. intent: 'website' | 'pricing'; from: placement id used by analytics.
   * Returns { href, rel, affiliate, attrs } — render with components.outLink().
   */
  function outbound(vendor, { intent = 'website', from = 'page' } = {}) {
    const affiliate = intent === 'pricing' ? affiliatePricingIds.has(vendor.id) : affiliateIds.has(vendor.id);
    const direct = intent === 'pricing' ? vendor.pricing?.source || vendor.url : vendor.url;
    const server = content.softwareServer.outbound?.[vendor.id] || {};
    const host = (intent === 'pricing' ? server.pricingDestinationHost : server.websiteDestinationHost) || hostOf(direct);
    const href = site.outbound === 'direct' ? direct : `/go/${vendor.id}/?intent=${intent}&from=${encodeURIComponent(from)}`;
    return {
      href,
      affiliate,
      rel: affiliate ? 'sponsored nofollow noopener noreferrer' : 'nofollow noopener noreferrer',
      attrs: {
        'data-vendor-id': vendor.id,
        'data-outbound-intent': intent,
        'data-outbound-placement': from,
        'data-outbound-affiliate': affiliate ? 'true' : 'false',
        'data-destination-host': host,
      },
    };
  }

  // ------------------------------------------------------------------ URLs
  const url = {
    home: () => '/',
    categories: () => '/categories/',
    category: (id) => `/categories/${id}/`,
    softwareIndex: () => '/software/',
    software: (id) => `/software/${id}/`,
    alternatives: (id) => `/alternatives/${id}/`,
    vs: (id) => `/vs/${id}/`,
    comparisons: () => '/comparisons/',
    guides: () => '/guides/',
    guide: (id) => `/guides/${id}/`,
    compare: ({ scope, ids = [] } = {}) => {
      const q = [];
      if (scope) q.push(`scope=${scope}`);
      ids.slice(0, 4).forEach((id, i) => q.push(`${'abcd'[i]}=${id}`));
      return `/compare/${q.length ? '?' + q.join('&') : ''}`;
    },
    shortlist: () => '/shortlist/',
    search: (q) => `/search/${q ? '?q=' + encodeURIComponent(q) : ''}`,
    cost: () => '/tools/cost/',
    faq: () => '/faq/',
    methodology: () => '/methodology/',
    supplier: (categoryId, supplierId) => `/categories/${categoryId}/#supplier-${supplierId}`,
  };
  const abs = (p) => site.origin + (p.startsWith('/') ? p : '/' + p);
  const asset = (name) => {
    const hit = manifest[name];
    if (!hit) throw new Error(`asset not in manifest: ${name}`);
    return hit;
  };

  // ------------------------------------------------------------------ comparisons
  const comparisonKind = (comparison) => sc.comparisonKind(catalog, comparison);
  /** Published head-to-head pages that involve a vendor (optionally inside one category). */
  const comparisonsFor = (vendorId, categoryId) =>
    catalog.comparisons.filter((c) => c.vendorIds?.includes(vendorId) && (!categoryId || c.categoryId === categoryId));
  const comparisonsInCategory = (categoryId) => catalog.comparisons.filter((c) => c.categoryId === categoryId);
  /** The published /vs/ page for a pair in a category, if one exists (either order). */
  const pairPage = (categoryId, a, b) =>
    catalog.comparisons.find((c) => c.categoryId === categoryId && c.vendorIds?.length === 2 && c.vendorIds.includes(a) && c.vendorIds.includes(b) && a !== b) || null;
  /** Human title of a comparison record ("HubSpot Sales Hub vs Attio" or the editorial/factual title). */
  function comparisonNames(comparison) {
    const category = categoryById.get(comparison.categoryId);
    if (isFactual(category)) {
      const suppliers = category.factual?.suppliers || [];
      const offers = category.factual?.comparison?.offers || [];
      const ids = comparison.vendorIds || category.factual?.comparison?.vendorIds || [];
      return ids.map((id) => {
        const s = suppliers.find((x) => x.id === id);
        const offer = offers.find((o) => o.vendorId === id);
        const plan = s?.plans?.find((p) => p.id === offer?.planId);
        return { id, name: s?.name || id, planName: plan?.name || '' };
      });
    }
    return (comparison.vendorIds || []).map((id) => ({ id, name: vendorById.get(id)?.name || id, planName: '' }));
  }

  const guidesForCategory = (categoryId) => catalog.guides.filter((g) => g.categoryIds?.includes(categoryId));

  // ------------------------------------------------------------------ indexing policy
  const { createIndexing } = await import('./indexing.mjs');
  const indexing = createIndexing({ catalog, categoryById, vendorById, summary, isFactual, price, comparisonKind, site, liveHead: content.liveHead });

  // ------------------------------------------------------------------ dates
  const today = site.buildDate || null; // never used as a content date; only for copyright year fallbacks
  const year = (catalog.researchUpdatedAt || catalog.checkedAt || '2026').slice(0, 4);
  /** Latest evidence/price/content date that concerns a vendor (for "Updated" lines and sitemap lastmod). */
  function vendorUpdated(vendor) {
    return maxDate(vendor.modifiedAt, vendor.checkedAt, vendor.pricing?.verifiedAt, vendor.researchReview?.observedAt);
  }
  function categoryUpdated(category) {
    if (isFactual(category)) return maxDate(category.factual?.checkedAt, category.checkedAt);
    const vendors = summary(category.id).ranked;
    return maxDate(category.depthMethodology?.checkedAt, vendors.map(vendorUpdated), catalog.checkedAt);
  }

  const ctx = {
    root,
    dataVersion,
    site,
    links,
    base,
    catalog,
    content,
    scoring: sc,
    // collections
    categories: catalog.categories,
    vendors: catalog.vendors,
    guides: catalog.guides,
    comparisons: catalog.comparisons,
    pages: catalog.pages,
    groups,
    // lookups
    category: (id) => categoryById.get(id) || null,
    vendor: (id) => vendorById.get(id) || null,
    guide: (id) => guideById.get(id) || null,
    comparison: (id) => comparisonById.get(id) || null,
    groupOf: (categoryOrId) => groupOfCategory.get(typeof categoryOrId === 'string' ? categoryOrId : categoryOrId.id),
    isFactual,
    scoredCategories: catalog.categories.filter((c) => !sc.isFactual(c)),
    factualCategories: catalog.categories.filter((c) => sc.isFactual(c)),
    // scoring
    summary,
    fit,
    score,
    rankOf,
    isRecommended,
    price,
    aiLevel,
    AI_LEVELS,
    PRICING_MODELS,
    // vendors
    vendorCategories,
    primaryCategory,
    outbound,
    isAffiliate: (vendorId) => affiliateIds.has(vendorId),
    // comparisons & guides
    comparisonKind,
    comparisonsFor,
    comparisonsInCategory,
    pairPage,
    comparisonNames,
    guidesForCategory,
    // urls & assets
    url,
    abs,
    asset,
    // seo
    indexing,
    isIndexable: (p) => indexing.isIndexable(p),
    hreflang: (p) => content.hreflang[p] || null,
    liveHead: (p) => content.liveHead[p] || null,
    // dates & text
    fmtDate,
    isoDate,
    maxDate,
    fmtMoney,
    plural,
    listText,
    planLabel,
    year,
    today,
    vendorUpdated,
    categoryUpdated,
    // filled by build.mjs before rendering
    routes: [],
    routeByPath: new Map(),
  };
  ctx.seo = createSeo(ctx);
  ctx.answers = createAnswers(ctx);
  return ctx;
}
