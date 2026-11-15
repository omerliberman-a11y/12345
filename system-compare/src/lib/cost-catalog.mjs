// Cost-calculator data. `createCostCatalog(ctx)` is a port of the previous site's server-side function
// (verified byte-identical against the JSON the live page embeds: scripts in the task notes).
// `compactCostCatalog()` turns it into the small per-category files the client loads on demand.
//
// Editorial rule kept exactly: an offer is modelled automatically ONLY when one adapter of the allow-list
// matches on every field (vendor, category, offer id, amount, plan, unit, billing, source URL, check date,
// USD and — for researched plans — pricing.scenarioReady). Any edit to the price record disables it.

export const ADAPTERS = [
  { vendorId: 'pipedrive', categoryId: 'crm', id: 'entry', amount: 14, plan: 'Lite', unit: 'per seat/month', billing: 'annual', source: 'https://www.pipedrive.com/en/pricing', checkedAt: '2026-11-05', kind: 'seat', commitmentMonths: 12 },
  { vendorId: 'salesforce-sales', categoryId: 'crm', id: 'entry', amount: 25, plan: 'Starter Suite', unit: 'per user/month', billing: 'monthly', source: 'https://www.salesforce.com/sales/pricing/', checkedAt: '2026-11-05', kind: 'seat', commitmentMonths: 1 },
  { vendorId: 'twilio', categoryId: 'sms-marketing', id: 'entry', amount: 0.0083, plan: 'Programmable Messaging', unit: 'per US SMS segment before fees', billing: 'usage', source: 'https://www.twilio.com/en-us/sms/pricing/us', checkedAt: '2026-11-05', kind: 'segment', commitmentMonths: 1 },
  ...[
    ['starter', 'Starter', 9],
    ['standard', 'Standard', 18],
  ].map(([id, plan, amount]) => ({
    vendorId: 'brevo',
    categoryId: 'email-marketing',
    id,
    plan,
    amount,
    unit: 'per month · starting offer',
    billing: 'monthly',
    source: 'https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans',
    checkedAt: '2026-10-26',
    kind: 'email-tier',
    commitmentMonths: 1,
    maxEmails: 5000,
    maxContacts: 500,
  })),
];

export const UNREADY =
  'This price is not ready for automatic cost modeling. Its unit, tier, commitment or included scope still needs confirmation. You can enter your own whole-scope USD quote below.';
export const SUPPLIER_UNREADY = 'No calculator-ready price has been established for this supplier. Enter your own whole-scope USD quote, or leave it pending.';
export const SUPPLIER_SUMMARY = 'Confirm the exact package with the supplier.';

// In the sms-marketing scope, products whose own price belongs to another product line get the synthetic
// "SMS price not verified" record from ctx.scoring.pricingFor(). The calculator additionally shows this
// summary and these two cost questions (verbatim from the previous site; the shared record has neither).
export const SMS_UNVERIFIED_SUMMARY =
  'An SMS-specific US price has not been verified for this product. Email or contact subscription prices are not used as SMS prices. Ask the supplier to confirm the eligible plan, message segments, sender registration, carrier fees and minimum spend.';
export const SMS_UNVERIFIED_EXTRAS = ['Confirm sender and registration costs', 'Confirm carrier fees, segment allowances, overages and any minimum spend'];

const safeUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.username && !x.password ? x.href : null;
  } catch {
    return null;
  }
};
const str = (v) => (typeof v === 'string' ? v : '');
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null);
const researchedPlans = (v, cid) => (Array.isArray(v?.researchedPlans?.[cid]) ? v.researchedPlans[cid] : []);

function offer(v, c, id, price, date, limits = []) {
  const p = price || {};
  const source = safeUrl(p.source);
  const checkedAt = isoDate(date);
  const a = ADAPTERS.find(
    (x) =>
      x.vendorId === v.id &&
      x.categoryId === c.id &&
      x.id === id &&
      x.amount === p.amount &&
      x.plan === p.plan &&
      x.unit === p.unit &&
      x.billing === p.billing &&
      x.source === source &&
      x.checkedAt === checkedAt &&
      p.currency === 'USD' &&
      (id === 'entry' || p.scenarioReady === true),
  );
  return {
    id,
    name: str(p.plan) || 'Published offer',
    kind: a?.kind || 'unverified',
    amount: a ? p.amount : null,
    publishedAmount: Number.isFinite(p.amount) && p.amount >= 0 ? p.amount : null,
    currency: str(p.currency),
    unit: str(p.unit),
    billing: str(p.billing),
    summary: str(p.summary),
    source,
    checkedAt,
    extras: [...new Set([...(Array.isArray(p.extras) ? p.extras : []), ...limits].filter((x) => typeof x === 'string'))],
    commitmentMonths: a?.commitmentMonths || null,
    minimumQuantity: a?.minimumQuantity ?? null,
    maxEmails: a?.maxEmails ?? null,
    maxContacts: a?.maxContacts ?? null,
    unavailableReason: a ? '' : UNREADY,
  };
}

/** Full catalog in the previous site's shape: { categories: [{ id, name, products: [{ id, name, href, offers }] }] }. */
export function createCostCatalog(ctx) {
  const data = ctx.catalog;
  const pricingFor = ctx.scoring.pricingFor;
  return {
    categories: data.categories
      .map((c) => {
        const products = data.vendors
          .filter((v) => (v.categories || []).includes(c.id))
          .map((v) => {
            let price = pricingFor(v, c.id);
            if (price.smsUnverified) price = { ...price, summary: price.summary || SMS_UNVERIFIED_SUMMARY, extras: price.extras || SMS_UNVERIFIED_EXTRAS };
            const offers = [offer(v, c, 'entry', price, (typeof price.verifiedAt === 'string' ? price.verifiedAt.slice(0, 10) : null) || v.checkedAt)];
            for (const plan of researchedPlans(v, c.id)) offers.push(offer(v, c, plan.id, { ...plan.pricing, plan: plan.name }, plan.checkedAt, plan.limits));
            return { id: v.id, name: v.name, href: '/software/' + v.id + '/', offers };
          });
        for (const s of c.factual?.suppliers || []) {
          if (products.some((p) => p.id === s.id)) continue;
          products.push({
            id: s.id,
            name: s.name,
            href: '/categories/' + c.id + '/#supplier-' + s.id,
            offers: [
              {
                id: 'quote',
                name: 'Supplier quote',
                kind: 'unverified',
                amount: null,
                publishedAmount: null,
                currency: 'USD',
                unit: 'Scope to confirm',
                billing: 'quote',
                summary: s.caution || SUPPLIER_SUMMARY,
                source: null,
                checkedAt: null,
                extras: [],
                commitmentMonths: null,
                minimumQuantity: null,
                maxEmails: null,
                maxContacts: null,
                unavailableReason: SUPPLIER_UNREADY,
              },
            ],
          });
        }
        products.sort((a, b) => a.name.localeCompare(b.name, 'en'));
        return { id: c.id, name: c.name, products };
      })
      .filter((c) => c.products.length),
  };
}

/** The calculator-ready offers of a catalog: [{ categoryId, productId, productName, offer }]. */
export function readyOffers(catalog) {
  const out = [];
  for (const c of catalog.categories) for (const p of c.products) for (const o of p.offers) if (o.kind !== 'unverified') out.push({ categoryId: c.id, categoryName: c.name, productId: p.id, productName: p.name, offer: o });
  return out;
}

// ---------------------------------------------------------------- compact client files
// /data/cost-index.js   { g: [[groupLabel, [[categoryId, categoryName, productCount]]]], r: {categoryId: readyOfferCount} }
// /data/cost-<id>.js    { id, n, p: [product] }
//   product = { i: id, n: name, l?: logoPath, d?: 1 (dark logo surface), f?: 1 (documentary supplier → category anchor), o: [offer] }
//   offer   = { i: id, n: name, k?: kind (absent = unverified), a?: amount, pa?: publishedAmount, c?: currency (absent = USD),
//               u: unit, b: billing, s: summary, src?: source, d?: checkedAt, x?: extras, cm?, mq?, me?, mc?,
//               r?: 2 (supplier "not ready" sentence; absent on unverified offers = the standard sentence) }
// The client expands these back into the documented offer shape (see expandOffer in js/cost.js).

export function compactOffer(o) {
  const out = { i: o.id, n: o.name };
  if (o.kind !== 'unverified') out.k = o.kind;
  if (o.amount !== null) out.a = o.amount;
  if (o.publishedAmount !== null) out.pa = o.publishedAmount;
  if (o.currency !== 'USD') out.c = o.currency;
  if (o.unit) out.u = o.unit;
  if (o.billing) out.b = o.billing;
  if (o.summary) out.s = o.summary;
  if (o.source) out.src = o.source;
  if (o.checkedAt) out.d = o.checkedAt;
  if (o.extras.length) out.x = o.extras;
  if (o.commitmentMonths !== null) out.cm = o.commitmentMonths;
  if (o.minimumQuantity !== null) out.mq = o.minimumQuantity;
  if (o.maxEmails !== null) out.me = o.maxEmails;
  if (o.maxContacts !== null) out.mc = o.maxContacts;
  if (o.unavailableReason === SUPPLIER_UNREADY) out.r = 2;
  else if (o.unavailableReason && o.unavailableReason !== UNREADY) out.r = o.unavailableReason;
  return out;
}

/** Inverse of compactOffer (same code as the client uses) — lets the build prove the round trip is lossless. */
export function expandOffer(c) {
  return {
    id: c.i,
    name: c.n,
    kind: c.k || 'unverified',
    amount: c.a === undefined ? null : c.a,
    publishedAmount: c.pa === undefined ? null : c.pa,
    currency: c.c === undefined ? 'USD' : c.c,
    unit: c.u || '',
    billing: c.b || '',
    summary: c.s || '',
    source: c.src || null,
    checkedAt: c.d || null,
    extras: c.x || [],
    commitmentMonths: c.cm === undefined ? null : c.cm,
    minimumQuantity: c.mq === undefined ? null : c.mq,
    maxEmails: c.me === undefined ? null : c.me,
    maxContacts: c.mc === undefined ? null : c.mc,
    unavailableReason: c.k ? '' : c.r === 2 ? SUPPLIER_UNREADY : typeof c.r === 'string' ? c.r : UNREADY,
  };
}

export function compactCostCatalog(ctx, catalog = createCostCatalog(ctx)) {
  const byId = new Map(catalog.categories.map((c) => [c.id, c]));
  const files = {};
  const ready = {};
  for (const c of catalog.categories) {
    const n = c.products.reduce((s, p) => s + p.offers.filter((o) => o.kind !== 'unverified').length, 0);
    if (n) ready[c.id] = n;
    files[c.id] = {
      id: c.id,
      n: c.name,
      p: c.products.map((p) => {
        const vendor = p.href.startsWith('/software/') ? ctx.vendor(p.id) : null;
        const out = { i: p.id, n: p.name };
        if (vendor?.logo?.path) out.l = vendor.logo.path;
        if (vendor?.logo?.surface === 'dark') out.d = 1;
        if (!vendor) out.f = 1;
        out.o = p.offers.map(compactOffer);
        return out;
      }),
    };
  }
  const index = {
    g: ctx.groups
      .map((g) => [g.label, g.categories.filter((c) => byId.has(c.id)).map((c) => [c.id, c.name, byId.get(c.id).products.length])])
      .filter((g) => g[1].length),
    r: ready,
  };
  return { index, files };
}
