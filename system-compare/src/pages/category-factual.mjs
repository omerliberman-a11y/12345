// Documentary ("factual") category page — the 33 categories without a score. Same shell as the scored
// category page (category.mjs): answer first, suppliers as rows of ONE table, prices in compact offer
// tables, the 30 criteria as a matrix with notes on demand, then the decision aid (FAQ), checklist,
// research limits and dated sources. Everything comes from category.factual.
//
// The helpers exported at the bottom are shared with vs-factual.mjs (same data model).

import { html, raw, esc, text, cx, attrs, join } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';
import { fmtDate } from '../lib/format.mjs';

export function routes(ctx) {
  return ctx.factualCategories.map((category) => ({ path: ctx.url.category(category.id), render: (c) => render(c, category) }));
}

// ---------------------------------------------------------------------------------------------- shared helpers
/** Status vocabulary of the documentary pages (documentation status, not a capability score). */
export const FX_STATUS = { yes: 'Documented', partial: 'Conditional', no: 'Not included', unknown: 'Not verified' };
const stKey = (st) => (FX_STATUS[st] && st !== 'unknown' ? st : 'unknown');

/** Status mark: icon + label (the label collapses to the icon in narrow matrix cells via CSS). */
// the label sits in its own span so a dense table can hide it visually (the icon stays) without hiding it from assistive tech
export const fxMark = (st) => html`<span class="st st--${stKey(st)}"><span>${FX_STATUS[stKey(st)]}</span></span>`;
export const fxLegend = () => html`<p class="legend" aria-label="Legend">${['yes', 'partial', 'no', 'unknown'].map((s) => html`<span class="st st--${s}">${FX_STATUS[s]}</span>`)}</p>`;

/**
 * Data sentences now and then carry an ISO date ("Page updated 2025-04-09; …"). The text is never rewritten;
 * the date is only wrapped in <time datetime> so every date on the page is machine-readable.
 */
/** The label every documentary page carries instead of a score (the methodology page quotes it). */
export const NO_SCORE_LABEL = 'Documented comparison — no score or ranked order';

export const dated = (s) => {
  const parts = String(s ?? '').split(/\b(20\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/);
  return parts.length === 1 ? s : raw(parts.map((part, i) => (i % 2 ? `<time datetime="${part}">${fmtDate(part)}</time>` : esc(part))).join(''));
};

/** evidence_id → source record of a documentary category. */
export const sourceMap = (category) => new Map((category.factual?.sources || []).map((s) => [s.evidence_id, s]));

/** Linked source titles for a list of evidence ids ("Title ↗ · Title ↗"). */
export function evidenceLinks(srcMap, ids) {
  const list = [...new Set(ids || [])].map((id) => srcMap.get(id)).filter(Boolean); // the data repeats an id now and then
  return list.length ? join(list.map((s) => ui.sourceLink(s.url, s.title)), ' · ') : '';
}

/**
 * Structured parts of an observed-offer price. The parts joined with " · " are, by construction, the
 * published price line (ctx.scoring.formatFactualOfferPrice) — the build fails if they ever diverge.
 */
export function offerPrice(ctx, pricing) {
  const p = pricing || {};
  const TAX = ctx.scoring.FACTUAL_TAX_LABELS;
  const hasAmount = p.amount !== null && p.amount !== undefined;
  const verifiedCurrency = hasAmount && Boolean(p.currency);
  const amountText = hasAmount ? (p.currency ? `${p.currency} ${p.amount}` : `${String(p.display_currency || '').trim()}${p.amount}`) : '';
  const state = hasAmount ? 'amount' : String(p.status || '').startsWith('quote') ? 'quote' : 'unverified';
  const main = hasAmount ? amountText : state === 'quote' ? 'Request a quote' : 'Price not verified';
  const currencyNote = hasAmount && !p.currency ? '(currency not verified)' : '';
  const unit = p.unit || '';
  const billing = p.billing ? `${p.billing} billing` : '';
  const tax = TAX[p.tax_basis] || TAX.not_verified;
  const note = p.note || '';
  const upcoming = p.upcoming ? { date: p.upcoming.invoice_effective_date, text: `${p.currency} ${p.upcoming.amount} per ${p.unit}` } : null;
  const line = [[main, currencyNote].filter(Boolean).join(' '), unit, billing, tax, note, upcoming && `Announced invoice change from ${upcoming.date}: ${upcoming.text}`].filter(Boolean).join(' · ');
  if (line !== ctx.scoring.formatFactualOfferPrice(p)) throw new Error(`offer price parts diverge from the published line: "${line}"`);
  return { state, hasAmount, verifiedCurrency, amount: hasAmount ? Number(p.amount) : null, currency: p.currency || null, main, currencyNote, unit, billing, tax, note, upcoming, line, observedAt: p.observed_at || null, evidenceIds: p.evidence_ids || [] };
}

/** Price cell: amount (or state) + unit — the same visual as ui.priceCell on scored pages. */
export const offerPriceCell = (o) => html`<span class="price"><span class="${cx('price__main', !o.hasAmount && 'price__main--text', 'fx-p-price')}">${o.main}</span>${
  o.currencyNote ? html` <span class="price__unit fx-p-cur">${o.currencyNote}</span>` : ''
}${o.unit ? html` <span class="price__unit fx-p-unit">${o.unit}</span>` : ''}</span>`;

/** "Observed <date> · source · source" line of an offer. */
export const offerEvidence = (ctx, srcMap, o) => {
  const links = evidenceLinks(srcMap, o.evidenceIds);
  return html`<span class="fx-ev">${o.observedAt ? html`<span class="fx-ev__date">Observed ${ui.time(ctx, o.observedAt)}</span>` : ''}${links ? html`${o.observedAt ? ' · ' : ''}${links}` : ''}</span>`;
};

/**
 * Note for a status mark: scope sentence + linked sources. The check date is printed only when it differs
 * from `pageDate` (the page says once that everything else was checked on that date).
 */
export const decisionNote = (ctx, srcMap, d, pageDate) => {
  const links = evidenceLinks(srcMap, d.evidence_ids);
  const date = d.verified_at && ctx.isoDate(d.verified_at) !== ctx.isoDate(pageDate) ? html`Checked ${ui.time(ctx, d.verified_at)}` : '';
  return html`${dated(d.scope)}${links || date ? html` <small class="fx-ev">${links}${links && date ? ' · ' : ''}${date}</small>` : ''}`;
};

/** The supplier's lowest published numeric offer (its "entry price"), or its best non-numeric state. */
export function entryOffer(ctx, supplier) {
  const offers = (supplier.plans || []).map((plan) => ({ plan, price: offerPrice(ctx, plan.pricing) }));
  const numeric = offers.filter((o) => o.price.hasAmount).sort((a, b) => a.price.amount - b.price.amount);
  if (numeric.length) return { ...numeric[0], numeric: numeric.length, total: offers.length };
  const quote = offers.find((o) => o.price.state === 'quote');
  return { ...(quote || offers[0] || { plan: null, price: null }), numeric: 0, total: offers.length };
}

/** Research-limits copy shared by the documentary category and /vs/ pages (score wording, no "rating"). */
export const researchLinks = () => html`<p class="fx-links"><a href="/methodology/">How we score</a><a href="/how-we-make-money/">Commercial transparency</a><a href="/corrections/">Send a correction</a><a href="/partners/">Supplier applications</a></p>`;

/** Drop template indentation from the page body (any whitespace run renders as one space; there is no <pre>). */
export const tight = (h) => raw(String(h).replace(/\n\s+/g, '\n'));

const sentenceList = (ctx, items) => ctx.listText(items);

// ---------------------------------------------------------------------------------------------- page
function render(ctx, category) {
  const F = category.factual;
  const path = ctx.url.category(category.id);
  const group = ctx.groupOf(category);
  const suppliers = F.suppliers || [];
  const criteria = F.criteria || [];
  const srcMap = sourceMap(category);
  const checked = F.checkedAt || category.checkedAt;
  const year = String(checked || '').slice(0, 4);
  const nOffers = suppliers.reduce((n, s) => n + (s.plans?.length || 0), 0);
  const approver = F.publicationApprover || null;
  const names = suppliers.map((s) => s.name);
  const live = ctx.liveHead(path) || {};

  // ---- prices
  const entries = suppliers.map((s) => ({ supplier: s, ...entryOffer(ctx, s) }));
  const allOffers = suppliers.flatMap((s) => (s.plans || []).map((plan) => ({ supplier: s, plan, price: offerPrice(ctx, plan.pricing) })));
  const numericOffers = allOffers.filter((o) => o.price.hasAmount);
  const quoteOffers = allOffers.filter((o) => o.price.state === 'quote');
  const unverifiedOffers = allOffers.filter((o) => o.price.state === 'unverified');
  // Lowest published amount: stated only when every published price is in one verified currency (currencies and
  // units are never converted), and every offer that shares the amount is named or counted — never one of them.
  const currencyKeys = new Set(numericOffers.map((o) => (o.price.verifiedCurrency ? o.price.currency : '?')));
  const comparable = numericOffers.length === 1 || (numericOffers.length > 1 && currencyKeys.size === 1 && !currencyKeys.has('?'));
  const minAmount = comparable ? Math.min(...numericOffers.map((o) => o.price.amount)) : null;
  const lowestGroup = comparable ? numericOffers.filter((o) => o.price.amount === minAmount) : [];
  const lowest = lowestGroup[0] || null;
  const mixedCurrency = currencyKeys.size > 1;
  // "Adobe Firefly" + "Firefly Standard — individual" → "Adobe Firefly Standard — individual"
  const offerName = (o) => `${o.supplier.name} ${ctx.dropNamePrefix(o.supplier.name, o.plan.name)}`.trim();
  const priceWords = (o) => {
    const extra = [o.price.unit, o.price.currencyNote && 'currency not verified'].filter(Boolean).join('; ');
    return `${o.price.main}${extra ? ` (${extra})` : ''}`;
  };
  const nIs = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ---- head
  const title = seoTitle(`${category.name}: ${suppliers.length} suppliers compared`, year);
  const description = describe([
    category.description,
    `${category.name}: ${sentenceList(ctx, names)} compared on documented offers, prices and ${criteria.length} criteria. No score assigned.`,
    `${category.name}: ${suppliers.length} suppliers and ${nOffers} offers compared on documented prices and criteria. No score assigned.`,
    live.description,
    `${category.name}: ${suppliers.length} suppliers compared.`,
  ]);

  // ---- quick answer (data only)
  const havePrice =
    nOffers === 1 ? 'The one documented offer has' : numericOffers.length === nOffers ? `All ${nOffers} offers have` : `${numericOffers.length} of the ${nOffers} offers ${numericOffers.length === 1 ? 'has' : 'have'}`;
  const priceSentence = numericOffers.length
    ? `${havePrice} a published price${
        !comparable
          ? '; they are not all in one verified currency, so no single lowest amount is stated.'
          : lowestGroup.length === 1
            ? `; ${numericOffers.length === 1 ? 'it is' : 'the lowest published amount is'} ${priceWords(lowest)} for ${offerName(lowest)}.`
            : `; ${lowestGroup.length} offers share the lowest published amount, ${lowest.price.main}${lowestGroup.length <= 4 ? `: ${sentenceList(ctx, lowestGroup.map(offerName))}` : ''}.`
      }`
    : `None of the ${nOffers} offers has a published price${
        quoteOffers.length === nOffers
          ? `: all ${nOffers} are quote-only`
          : quoteOffers.length
            ? `: ${quoteOffers.length} ${quoteOffers.length === 1 ? 'is' : 'are'} quote-only${unverifiedOffers.length ? ` and ${unverifiedOffers.length} ${unverifiedOffers.length === 1 ? 'is' : 'are'} not verified` : ''}`
            : ''
      }.`;
  const quick = html`We documented <strong>${suppliers.length} suppliers and ${ctx.plural(nOffers, 'offer')}</strong> for ${category.name}: ${sentenceList(ctx, names)}. They are listed by buying approach, not by score — no /100 score is assigned in this category. ${priceSentence} Evidence checked ${ui.time(ctx, checked)}.`;

  const glance = [
    { label: 'Suppliers documented', value: String(suppliers.length), sub: 'listed by buying approach, not ranked' },
    { label: 'Offers documented', value: String(nOffers), sub: [numericOffers.length && `${numericOffers.length} with a published price`, quoteOffers.length && `${quoteOffers.length} quote-only`, unverifiedOffers.length && `${unverifiedOffers.length} not verified`].filter(Boolean).join(' · ') },
    lowestGroup.length === 1
      ? { label: 'Lowest published amount', value: html`<a href="#plans-${lowest.supplier.id}">${lowest.price.main}</a>`, sub: [lowest.price.currencyNote, offerName(lowest), lowest.price.unit].filter(Boolean).join(' · ') }
      : lowestGroup.length > 1
        ? { label: 'Lowest published amount', value: lowest.price.main, sub: `shared by ${lowestGroup.length} offers` }
        : numericOffers.length
          ? { label: 'Published prices', value: `${numericOffers.length} of ${nOffers} offers`, sub: 'not in one verified currency — no single lowest amount' }
          : { label: 'Published prices', value: 'None', sub: quoteOffers.length ? 'ask each supplier for a quote' : 'not verified for these offers' },
    { label: 'Criteria compared', value: html`<a href="#factual-comparison">${criteria.length}</a>`, sub: `${F.sources.length} dated official sources` },
  ];

  const head = html`<header class="wrap page-head page-head--wide">
    <p class="eyebrow"><a href="/categories/#${group.id}">${group.label}</a></p>
    <h1>${F.heading || category.name}</h1>
    <p class="lede">${category.description}</p>
    ${ui.trustline([
      html`Evidence checked ${ui.time(ctx, checked)}`,
      `${ctx.plural(suppliers.length, 'supplier')} · ${ctx.plural(nOffers, 'offer')}`,
      NO_SCORE_LABEL,
      approver && `${approver.name}, ${String(approver.role || '').toLowerCase()}`,
      html`<a href="/methodology/">How we score</a>`,
    ])}
  </header>
  <div class="wrap cat-answer">
    ${ui.answer(ctx, quick, { meta: lowest ? 'Units and billing terms differ between suppliers, so the lowest amount is not a like-for-like price.' : null })}
  </div>`;

  const hasAid = Boolean(F.decisionAid?.rows?.length);
  const nav = ui.subnav(
    [
      { href: '#suppliers', label: 'Suppliers' },
      { href: '#plans', label: 'Plans & prices' },
      { href: '#factual-comparison', label: 'Criteria' },
      { href: '#decision-aid', label: 'Which to choose' },
      { href: '#buyer-checklist', label: 'Checklist' },
      { href: '#sources', label: 'Sources' },
    ].filter(Boolean),
  );

  // ---------------------------------------------------------------- suppliers at a glance (ONE table; anchors #supplier-{id})
  const entryCell = (e) => {
    if (!e.price) return '';
    const sub = e.price.hasAmount ? [e.price.currencyNote, e.plan.name, e.price.unit].filter(Boolean).join(' · ') : e.plan ? e.plan.name : '';
    return html`<span class="price"><span class="${cx('price__main', !e.price.hasAmount && 'price__main--text')}">${e.price.main}</span>${sub ? html`<span class="price__unit">${sub}</span>` : ''}</span>`;
  };
  const suppliersBlock = html`<section class="wrap fx-suppliers" id="suppliers" aria-labelledby="suppliers-h">
    <div class="fx-head">
      <h2 id="suppliers-h">Suppliers at a glance</h2>
    </div>
    <table class="dtable fx-stack fx-glance">
      <caption class="sr-only">${category.name}: ${suppliers.length} documented suppliers by buying approach, with their lowest published offer</caption>
      <thead>
        <tr>
          <th scope="col">Supplier and approach</th>
          <th scope="col">Useful when</th>
          <th scope="col">Check before buying</th>
          <th scope="col">Lowest published offer</th>
          <th scope="col"><span class="sr-only">Offers</span></th>
        </tr>
      </thead>
      <tbody>
        ${entries.map((e) => {
          const s = e.supplier;
          const vendor = ctx.vendor(s.id);
          return html`<tr id="supplier-${s.id}">
            <th scope="row"><span class="fx-name">${s.name}</span><small>${s.segment}</small>${
              vendor ? html`<small><a href="${ctx.url.software(vendor.id)}">Scored ${vendor.name} profile</a></small>` : ''
            }</th>
            <td data-l="Useful when">${s.fit}</td>
            <td data-l="Check before buying">${s.caution}</td>
            <td data-l="Lowest published offer">${entryCell(e)}</td>
            <td class="fx-glance__go"><a class="link-arrow" href="#plans-${s.id}">${ctx.plural(s.plans.length, 'offer')}</a></td>
          </tr>`;
        })}
      </tbody>
    </table>
    ${/* the scope of the comparison follows the table it describes, so the table starts right under its heading */ ''}
    <p class="fx-scope">${F.intro}</p>
    <p class="table-note">A documented selection, not a complete market list and not a ranking. No /100 score has been assigned in this category; prices are dated observations of public pages, not quotes.</p>
    <div class="cat-glance">${ui.facts(glance)}</div>
  </section>`;

  // ---------------------------------------------------------------- plans and prices
  const planFacts = (s) => {
    const product = new Map((s.productDecisions || []).map((d) => [d.criterion_id, d]));
    const byPlan = s.plans.map((p) => new Map((p.decisions || []).map((d) => [d.criterion_id, d])));
    const known = (d) => d && d.status !== 'unknown';
    const rows = criteria.filter((c) => byPlan.some((m) => known(m.get(c.id))));
    const none = criteria.filter((c) => !rows.includes(c));
    if (!rows.length) return html`<p class="fineprint fx-more__none">No offer-level statement is verified for ${s.name}; see the product-wide notes in the <a href="#factual-comparison">criteria comparison</a>.</p>`;
    // When every offer of the supplier carries the same statement, it is printed once in a cell that spans
    // the offer columns ("Both offers" / "All 3 offers"); otherwise each offer gets its own cell.
    const sig = (d) => (known(d) ? JSON.stringify([d.status, d.scope, [...new Set(d.evidence_ids || [])], d.verified_at]) : 'unknown');
    const allLabel = byPlan.length === 2 ? 'Both offers' : `All ${byPlan.length} offers`;
    const cells = (c) => {
      const ds = byPlan.map((m) => m.get(c.id));
      const q = product.get(c.id);
      // Identical to the product-wide statement → the mark alone (the note is in the criteria table).
      const body = (d) => (q && sig(q) === sig(d) ? fxMark(d.status) : html`${fxMark(d.status)}<span class="fx-note">${decisionNote(ctx, srcMap, d, checked)}</span>`);
      if (byPlan.length > 1 && known(ds[0]) && ds.every((d) => sig(d) === sig(ds[0]))) {
        const d = ds[0];
        const same = q && sig(q) === sig(d);
        return html`<td colspan="${byPlan.length}" data-l="${allLabel}">${fxMark(d.status)}<span class="fx-all">${allLabel}</span>${same ? '' : html`<span class="fx-note">${decisionNote(ctx, srcMap, d, checked)}</span>`}</td>`;
      }
      return ds.map((d, k) => html`<td data-l="${s.plans[k].name}">${known(d) ? body(d) : fxMark('unknown')}</td>`);
    };
    return html`<details class="fx-more">
      <summary><span>What each ${s.name} offer includes</span><small>${rows.length} of ${criteria.length} criteria documented at offer level</small></summary>
      <div class="fx-more__body">
        <p class="fineprint">Offer-level statements. A mark without a note means the statement is identical to the product-wide note in the <a href="#factual-comparison">criteria comparison</a>${
          byPlan.length > 1 ? `; a statement marked “${allLabel.toLowerCase()}” applies to each of them` : ''
        }. “Not verified” means the evidence does not settle the entitlement for that offer — it does not mean the capability is absent.</p>
        <table class="dtable fx-cells fx-planfacts">
          <caption class="sr-only">${s.name}: documented statements per offer</caption>
          <thead><tr><th scope="col">Criterion</th>${s.plans.map((p) => html`<th scope="col">${p.name}</th>`)}</tr></thead>
          <tbody>
            ${rows.map((c) => html`<tr><th scope="row">${c.label}</th>${cells(c)}</tr>`)}
          </tbody>
        </table>
        ${none.length ? html`<p class="fineprint fx-more__none"><b>Not verified for any ${s.name} offer:</b> ${none.map((c) => c.label).join(' · ')}.</p>` : ''}
      </div>
    </details>`;
  };

  const plansBlock = html`<section class="wrap section fx-plans" id="plans" aria-labelledby="plans-h">
    ${ui.sectionHead('Plans and prices', {
      id: 'plans-h',
      sub: `${ctx.plural(nOffers, 'offer')} as observed on the suppliers’ public pages. ${numericOffers.length ? nIs(numericOffers.length, 'shows', 'show') : 'None shows'} a published price${
        quoteOffers.length ? `, ${nIs(quoteOffers.length, 'is', 'are')} quote-only` : ''
      }${unverifiedOffers.length ? `, ${unverifiedOffers.length} could not be verified` : ''}.`,
    })}
    ${suppliers.map((s) => {
      return html`<div class="fx-supplier" id="plans-${s.id}">
        <div class="fx-supplier__head">
          <h3>${s.name}</h3>
          <p>${s.segment}</p>
        </div>
        <table class="dtable fx-stack fx-offers">
          <caption class="sr-only">${s.name} — observed offers, checked ${ui.time(ctx, checked)}</caption>
          <thead>
            <tr><th scope="col">Offer</th><th scope="col">Observed price</th><th scope="col">Billing and tax</th><th scope="col">Notes</th><th scope="col">Evidence</th></tr>
          </thead>
          <tbody>
            ${s.plans.map((plan) => {
              const o = offerPrice(ctx, plan.pricing);
              return html`<tr data-plan="${plan.id}">
                <th scope="row">${plan.name}</th>
                <td data-l="Observed price">${offerPriceCell(o)}</td>
                <td data-l="Billing and tax">${o.billing ? html`<span class="fx-p-bill">${o.billing}</span>` : ''}<span class="fx-p-tax">${o.tax}</span></td>
                <td${attrs({ 'data-l': o.note || o.upcoming ? 'Notes' : null, class: o.note || o.upcoming ? null : 'fx-empty' })}>${o.note ? html`<span class="fx-p-note">${o.note}</span>` : ''}${
                  o.upcoming ? html`<span class="fx-p-up">Announced invoice change from ${ui.time(ctx, o.upcoming.date)}: ${o.upcoming.text}</span>` : ''
                }</td>
                <td data-l="Evidence">${offerEvidence(ctx, srcMap, o)}</td>
              </tr>`;
            })}
          </tbody>
        </table>
        ${planFacts(s)}
      </div>`;
    })}
    <p class="table-note">Prices are observations, not quotations. Confirm currency, tax, usage units, renewal, setup charges and exact contract scope before purchase. No lowest-cost winner is declared across unlike workloads.</p>
  </section>`;

  // ---------------------------------------------------------------- criteria × suppliers
  const product = suppliers.map((s) => new Map((s.productDecisions || []).map((d) => [d.criterion_id, d])));
  const counts = suppliers.map((s, i) => criteria.filter((c) => (product[i].get(c.id)?.status || 'unknown') !== 'unknown').length);
  const comparison = html`<section class="wrap section fx-compare" id="factual-comparison" aria-labelledby="cmp-h" data-fx-compare>
    ${ui.sectionHead('How do the suppliers compare on each criterion?', {
      id: 'cmp-h',
      sub: 'Product-wide documentation, not plan entitlements or performance. Select a criterion to read each supplier’s conditions, sources and check date.',
    })}
    <div class="toolbar fx-controls" data-fx-controls data-nosnippet hidden>
      <div class="chips" role="group" aria-label="Suppliers to compare — keep 2 to ${suppliers.length}">
        ${suppliers.map((s) => html`<button type="button" class="chip" data-fx-supplier="${s.id}" aria-pressed="true">${s.name}</button>`)}
      </div>
      <div class="chips fx-controls__view">
        <button type="button" class="chip" data-fx-diff aria-pressed="false">Hide identical rows</button>
        <button type="button" class="chip" data-fx-notes aria-pressed="false">Show all notes</button>
        <button type="button" class="chip chip--link" data-copy="url">${ui.icon('share')} Copy this comparison link</button>
      </div>
    </div>
    <div class="fx-compare__meta">
      ${fxLegend()}
      <p class="toolbar__count" role="status" aria-live="polite" data-fx-status></p>
    </div>
    <table class="dtable fx-cmp" data-fx-table data-fx-url style="--fx-n:${suppliers.length}">
      <caption class="sr-only">${category.name}: product-wide documentation status per criterion — no plan inclusion inferred</caption>
      <thead>
        <tr>
          <th scope="col">Criterion</th>
          ${suppliers.map((s, i) => html`<th scope="col" data-s="${s.id}"><a href="#supplier-${s.id}">${s.name}</a><small>${counts[i]} of ${criteria.length} verified</small></th>`)}
        </tr>
      </thead>
      <tbody>
        ${criteria.map((c, ci) => {
          const ds = suppliers.map((s, i) => product[i].get(c.id) || null);
          const known = ds.map((d) => Boolean(d) && d.status !== 'unknown');
          const any = known.some(Boolean);
          return html`<tr class="fx-row">
            <th scope="row">${any ? html`<button type="button" class="fx-rowbtn" aria-expanded="false" aria-controls="fxd-${ci}">${c.label}</button>` : html`<span class="fx-rowlabel">${c.label}</span>`}</th>
            ${suppliers.map((s, i) => html`<td>${fxMark(known[i] ? ds[i].status : 'unknown')}</td>`)}
          </tr>${
            any
              ? html`<tr class="fx-detail" id="fxd-${ci}"><td colspan="${suppliers.length + 1}"><ul class="fx-notes">${suppliers.map((s, i) =>
                  known[i] ? html`<li data-i="${i + 1}"><b>${s.name}</b> ${decisionNote(ctx, srcMap, ds[i], checked)}</li>` : '',
                )}</ul></td></tr>`
              : ''
          }`;
        })}
      </tbody>
    </table>
    <p class="table-note">Every statement was checked on ${ui.time(ctx, checked)} unless another date is shown. “Not verified” means the product-level documentation we checked does not settle the answer; it does not mean the feature is absent. Rows with the same status can still differ in their conditions. Product-wide capabilities must not be assumed to be included in every offer — see <a href="#plans">Plans and prices</a>.</p>
  </section>`;

  // ---------------------------------------------------------------- which to choose: decision aid as Q&A + what to confirm
  const aidItems = (F.decisionAid?.rows || []).map((r) => {
    const links = evidenceLinks(srcMap, r.evidence_ids);
    return {
      q: r.question,
      a: html`<p>${r.decision}</p><p>${r.boundary}</p>${links ? html`<p class="fineprint">Evidence: ${links}</p>` : ''}`,
      plain: `${r.decision} ${r.boundary}`,
    };
  });
  const supplierLine = `${suppliers.length === 4 ? 'Four' : suppliers.length} suppliers are documented: ${suppliers.map((s) => `${s.name} (${s.segment})`).join('; ')}. They are listed by buying approach, not ranked, and no /100 score is assigned.`;
  const costLine = entries
    .map((e) => {
      if (!e.price) return '';
      if (e.price.hasAmount) return `${e.supplier.name}: ${e.price.main}${e.price.currencyNote ? ' ' + e.price.currencyNote : ''} for ${e.plan.name}${e.price.unit ? ` (${e.price.unit})` : ''}`;
      return `${e.supplier.name}: ${e.price.state === 'quote' ? 'quote only' : 'price not verified'}`;
    })
    .filter(Boolean)
    .join('. ');
  const genItems = [
    { q: `${category.name}: which suppliers are compared here?`, a: supplierLine, plain: supplierLine },
    {
      q: `${category.name}: what do the documented offers cost?`,
      a: `Lowest published offer per supplier — ${costLine}. These are dated observations of public pages from ${ctx.fmtDate(checked)}, not quotes; units, billing terms and tax treatment differ.`,
    },
  ].map((f) => ({ ...f, plain: f.plain || f.a }));
  const faqItems = [...aidItems, ...genItems];

  const choose = html`<section class="wrap section fx-choose" id="decision-aid" aria-label="Which to choose">
    <div class="fx-choose__faq">
      ${ui.faq(ctx, faqItems, { id: 'faq', heading: hasAid ? F.decisionAid.heading : `${category.name}: questions buyers ask`, sub: hasAid ? 'What the dated evidence supports for each buying situation, and the boundary to verify.' : '' })}
    </div>
    <div class="fx-confirm">
      <h3 id="confirm-h">What to confirm with each supplier</h3>
      <div class="fx-confirm__grid">
        ${suppliers.map((s) => (s.questions?.length ? html`<div><h4><a href="#supplier-${s.id}">${s.name}</a></h4>${ui.ticks(s.questions, 'dots')}</div>` : ''))}
      </div>
    </div>
  </section>`;

  // ---------------------------------------------------------------- buyer checklist + local context
  const localLinks = evidenceLinks(srcMap, F.localSourceIds);
  const checklist = html`<section class="wrap section" id="buyer-checklist" aria-labelledby="checklist-h">
    ${ui.sectionHead(F.checklistHeading || 'Buyer checklist', { id: 'checklist-h' })}
    <div class="cat-two">
      <div>
        ${F.costNote ? html`<p class="fx-costnote">${F.costNote}</p>` : ''}
        ${F.buyingAdvice?.length ? html`<ol class="steps fx-steps">${F.buyingAdvice.map((b) => html`<li>${b}</li>`)}</ol>` : ''}
      </div>
      <div class="cat-aside fx-aside">
        ${F.migration?.length ? html`<h3>Before you migrate</h3>${ui.ticks(F.migration, 'dots')}` : ''}
        ${F.aiNote ? html`<h3>How to evaluate AI claims</h3><p class="fx-aside-p">${F.aiNote}</p>` : ''}
      </div>
    </div>
  </section>`;

  const local = F.localNote
    ? html`<section class="wrap section" id="local-context" aria-labelledby="local-h">
        ${ui.sectionHead(F.localHeading || 'US buying context', { id: 'local-h' })}
        <div class="prose">
          <p>${F.localNote}</p>
          ${localLinks ? html`<p class="fineprint">Sources: ${localLinks}</p>` : ''}
        </div>
      </section>`
    : '';

  // ---------------------------------------------------------------- go deeper: comparison, guides, related
  const cmp = F.comparison ? ctx.comparison(F.comparison.id) && F.comparison : null;
  const guideIds = new Set();
  const guides = [];
  if (F.guide && ctx.guide(F.guide.id)) {
    guideIds.add(F.guide.id);
    guides.push(ctx.guide(F.guide.id));
  }
  for (const g of ctx.guidesForCategory(category.id)) if (!guideIds.has(g.id)) guides.push(g);
  const deeper =
    cmp || guides.length
      ? html`<section class="wrap section" id="go-deeper" aria-labelledby="deeper-h">
          ${ui.sectionHead('Comparison and buying guide', { id: 'deeper-h' })}
          ${ui.linkList(
            [
              cmp && { href: ctx.url.vs(cmp.id), title: cmp.title, sub: 'Head-to-head: named plans, common buying decisions and dated sources on one page.' },
              ...guides.map((g) => ({ href: ctx.url.guide(g.id), title: g.title, sub: g.description || 'Buying guide' })),
            ].filter(Boolean),
            { cols: 1 },
          )}
        </section>`
      : '';

  const sameGroup = group.categories.filter((c) => c.id !== category.id);
  const overlap = [];
  for (const s of suppliers) {
    const v = ctx.vendor(s.id);
    for (const c of v ? ctx.vendorCategories(v) : []) if (c.id !== category.id && !overlap.includes(c) && !sameGroup.includes(c)) overlap.push(c);
  }
  const relatedBlock =
    sameGroup.length || overlap.length
      ? html`<section class="wrap section fx-related" aria-labelledby="related-h">
          ${ui.sectionHead(`More in ${group.label}`, { id: 'related-h', link: { href: '/categories/', label: 'All categories' } })}
          ${ui.chipLinks([...sameGroup, ...overlap].map((c) => ({ href: ctx.url.category(c.id), label: c.name })))}
          ${overlap.length ? html`<p class="table-note">${sentenceList(ctx, overlap.map((c) => c.name))} ${overlap.length === 1 ? 'is a scored category that includes' : 'are scored categories that include'} some of the same vendors.</p>` : ''}
        </section>`
      : '';

  // ---------------------------------------------------------------- research limits + sources
  const method = html`<section class="wrap section" id="research-method" aria-labelledby="method-h">
    ${ui.sectionHead('What we checked — and what we did not', { id: 'method-h' })}
    <div class="prose">
      <p><strong>No /100 score has been assigned.</strong> Suppliers are listed by buying approach, not by score, and the order is not a recommendation.${
        approver ? html` ${approver.name} — ${approver.role}. Publication responsibility does not imply a hands-on test or an approved score.` : ''
      }</p>
      <p>System Compare compared dated public product pages, package descriptions and pricing documentation. This page was prepared with AI assistance from that evidence. No supplier account, endpoint deployment, recovery exercise, accessibility scanner or live consent configuration was tested. Supplier documentation is not independent performance evidence.</p>
      <p>${
        approver ? 'Publication responsibility is identified above. A hands-on test and a final score are not recorded.' : 'Human editorial sign-off and a final score are not recorded.'
      } Unknown means the evidence does not settle the answer; it does not mean the feature is absent. Product-wide capabilities must not be assumed to be included in every offer.</p>
      <p>Prices are observations, not quotations. Confirm currency, tax, usage units, renewal, setup charges and exact contract scope before purchase. No lowest-cost winner is declared across unlike workloads.</p>
      ${researchLinks()}
    </div>
  </section>`;

  const sourcesBlock = html`<section class="wrap section" id="sources" aria-labelledby="sources-h">
    ${ui.sectionHead('Dated primary sources', { id: 'sources-h', sub: `${F.sources.length} official pages behind the prices and statements on this page, with the date each was checked and what it covers.` })}
    ${ui.sources(F.sources.map((s) => ({ label: s.title, url: s.url, note: html`Checked ${ui.time(ctx, s.observation_date)}${s.scope ? html` · ${dated(s.scope)}` : ''}` })))}
  </section>`;

  return {
    title,
    description,
    ogTitle: `${category.name}: ${suppliers.length} suppliers compared`,
    nav: 'categories',
    breadcrumbs: [
      { name: 'Categories', url: '/categories/' },
      { name: category.name, url: path },
    ],
    pageType: 'CollectionPage',
    dateModified: ctx.isoDate(checked) || undefined,
    accountable: Boolean(approver),
    // One marked-up instance per question site-wide: when this page is kept out of the index and its
    // comparison page is not, the shared decision-aid questions are marked up there (and stay visible here).
    faq: faqItems
      .filter(
        (f) =>
          !(
            !ctx.isIndexable(path) &&
            F.comparison &&
            ctx.isIndexable(ctx.url.vs(F.comparison.id)) &&
            (F.comparison.decisionAid?.rows || []).some((r) => r.question === f.q && `${r.decision} ${r.boundary}` === f.plain)
          ),
      )
      .map((f) => ({ q: f.q, a: text(f.plain) })),
    jsonld: [
      ctx.seo.itemListNode(
        path,
        suppliers.map((s) => ({ name: s.name, url: ctx.url.supplier(category.id, s.id) })),
        { name: `${category.name}: documented suppliers (unranked)`, ordered: false },
      ),
    ],
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#primary-list` }, about: { '@type': 'Thing', name: category.name } },
    scripts: ['js/factual.js'],
    body: tight(html`${head}${nav}${suppliersBlock}${plansBlock}${comparison}${choose}${checklist}${local}${deeper}${method}${sourcesBlock}${relatedBlock}`),
  };
}
