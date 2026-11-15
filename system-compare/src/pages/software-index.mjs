// /software/ — the directory: ONE row per product (149), never one per category membership.
// Text filter, category, three quick filters and a sort, all instant and kept in the URL (directory.js).
// Every row is in the HTML (crawlers, no JavaScript); the script shows 50 at a time.
// Suppliers that are documented inside a category comparison (no profile page) are listed separately.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { html, text, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';
import { findField, categorySelect, synonymsFor, emptyState, indexTrustline, squeeze } from './categories.mjs';

export function routes(ctx) {
  return [{ path: ctx.url.softwareIndex(), render }];
}

const PAGE_SIZE = 50;
const SUPPLIERS_SHOWN = 6;

/** Product aliases for the filter ("sfdc" → Salesforce Sales). Editorial file shared with site search. */
export function loadAliases(ctx) {
  try {
    return JSON.parse(readFileSync(path.join(ctx.root, 'data/content/search-aliases.json'), 'utf8')).aliases || {};
  } catch {
    return {};
  }
}

/** The best published score of a vendor across its categories (catalog order wins ties), or its pending state. */
export function bestScore(ctx, vendor) {
  const cats = ctx.vendorCategories(vendor);
  let best = null;
  for (const c of cats) {
    const s = ctx.score(c.id, vendor.id);
    if (s && !s.pending && (!best || s.value > best.score.value)) best = { category: c, score: s };
  }
  if (best) return best;
  const primary = ctx.primaryCategory(vendor);
  return { category: primary, score: ctx.score(primary.id, vendor.id) };
}

function render(ctx) {
  const url = ctx.url.softwareIndex();
  const live = ctx.liveHead(url) || {};
  const aliases = loadAliases(ctx);
  const vendors = [...ctx.vendors].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
  const total = vendors.length;
  const vendorIds = new Set(vendors.map((v) => v.id));

  // Suppliers of documentary categories. Ids that are also full profiles are shown on the profile's row instead.
  const suppliers = [];
  const documentedIn = new Map(); // vendorId → [{category, supplier}]
  for (const c of ctx.factualCategories) {
    for (const s of c.factual?.suppliers || []) {
      if (vendorIds.has(s.id)) {
        if (!documentedIn.has(s.id)) documentedIn.set(s.id, []);
        documentedIn.get(s.id).push({ category: c, supplier: s });
      } else suppliers.push({ category: c, supplier: s });
    }
  }
  suppliers.sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, 'en-US', { sensitivity: 'base' }));

  // ---- rows + facet counts
  const rows = vendors.map((v) => {
    const best = bestScore(ctx, v);
    const p = ctx.price(v);
    return { v, best, p, ai: ctx.aiLevel(v), cats: ctx.vendorCategories(v), extra: documentedIn.get(v.id) || [] };
  });
  const nScored = rows.filter((r) => !r.best.score.pending).length;
  const nPriced = rows.filter((r) => r.p.hasAmount).length;
  const nAi = rows.filter((r) => r.ai.id === 'native' || r.ai.id === 'agent').length;
  const nMulti = rows.filter((r) => r.cats.length > 1).length;

  const catCounts = ctx.categories.map((c) => ({ category: c, count: ctx.isFactual(c) ? c.factual.suppliers.length : ctx.summary(c.id).total }));

  const head = html`<header class="wrap page-head page-head--wide">
    <h1>Software directory</h1>
    <p class="lede">${total} products, one row each: best documented-fit score, starting price and AI level. Plus ${suppliers.length} suppliers documented inside <a href="#suppliers">category comparisons</a>.</p>
    ${indexTrustline(ctx)}
  </header>`;

  const controls = html`<div class="ix-bar" data-ix-bar data-nosnippet>
      ${findField({ id: 'ix-find', label: 'Filter products by name, category or task', placeholder: `Filter ${total} products` })}
      ${categorySelect(ctx, { id: 'ix-category', items: catCounts })}
      <label class="ix-select ix-bar__end"><span class="sr-only">Sort products</span>
        <select class="select" data-ix-sort aria-label="Sort products">
          <option value="name">Sort: name A–Z</option>
          <option value="score">Sort: score, high to low</option>
          <option value="price">Sort: price, low to high</option>
        </select>
      </label>
      <div class="chips ix-chips" role="group" aria-label="Quick filters">
        <button type="button" class="chip" data-f="scored" aria-pressed="false">Scored <span class="n">${nScored}</span></button>
        <button type="button" class="chip" data-f="priced" aria-pressed="false">Public price <span class="n">${nPriced}</span></button>
        <button type="button" class="chip" data-f="ai" aria-pressed="false">Native AI or agents <span class="n">${nAi}</span></button>
        <button type="button" class="chip" data-ix-ai-legacy aria-pressed="true" hidden>AI evidence filter</button>
        <button type="button" class="chip chip--link" data-ix-reset hidden>Clear filters</button>
      </div>
    </div>
    <p class="ix-status"><span class="toolbar__count" role="status" aria-live="polite" data-ix-count data-noun="products"><b>${total}</b> products</span> <a class="link-arrow" href="/categories/" data-ix-catlink hidden>See the category ranking</a></p>`;

  // A product in several categories has several scores: say which category the best one is from
  // (wide screens) or that it is the best of N (phones, where the categories sit right under the name).
  const scoreCell = ({ best, cats }) => {
    const s = best.score;
    const where = cats.length > 1 ? html`<span class="score__meta ix-in">in ${best.category.name}</span><span class="score__meta ix-of">highest of ${cats.length}</span>` : '';
    return s.pending
      ? html`<span class="score score--pending"><span class="score__value">Score pending</span><span class="score__meta ix-in">${s.checked}/${s.total} checked · ${s.coveragePct}%</span></span>`
      : html`<span class="score"><span class="score__value num">${s.value}<small>/100</small></span>${where}</span>`;
  };

  // Vendor-site links in the directory: the same placement the live directory has — products of the
  // publisher's commercial-link categories only, through /go/ with the affiliate label where it applies.
  const commercialCats = new Set(ctx.content.softwareServer.directoryCommercialLinkCategoryIds || []);
  const visit = (v) =>
    (v.categories || []).some((id) => commercialCats.has(id))
      ? html` <span class="ix-visit">${ui.outLink(ctx, v, { intent: 'website', from: 'decision-directory', cls: 'ix-visit__a', explain: false })}</span>`
      : '';

  const table = html`<table class="ptable ix-table" id="directory" data-ix-table data-page-size="${PAGE_SIZE}">
    <caption class="sr-only">Software directory: ${total} products with their highest documented-fit score, starting price and AI level</caption>
    <thead>
      <tr>
        <th scope="col" class="ptable__c-name">Product</th>
        <th scope="col" class="ix-c-cats">Categories</th>
        <th scope="col" class="ptable__c-score">Highest score</th>
        <th scope="col" class="ptable__c-price">Starting price</th>
        <th scope="col" class="ptable__c-ai">AI</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(({ v, best, p, ai, cats, extra }, i) => {
        return html`<tr${attrs({
          // the script reads the product id and the category ids from the row's own links
          'data-score': best.score.pending ? -1 : best.score.value,
          'data-price': p.hasAmount && p.currency === 'USD' ? p.amount : '',
          'data-priced': p.hasAmount,
          'data-ai': ai.id,
          // the score in each scored category, for products that are listed under more than one category:
          // with a category chosen the script shows THAT score, not the best one from another checklist
          'data-s':
            cats.length > 1 || extra.length
              ? cats
                  .map((c) => {
                    const s = ctx.score(c.id, v.id);
                    return `${c.id}:${s.pending ? -1 : s.value}`;
                  })
                  .join('|')
              : null,
          'data-k': aliases[v.id]?.length ? aliases[v.id].join('|') : null,
        })}>
          <th scope="row" class="ptable__c-name">
            <a class="prod" href="${ctx.url.software(v.id)}">
              ${ui.logo(ctx, v, { lazy: i >= 8 })}
              <span class="prod__text">
                <span class="prod__name">${v.name}</span>
                <span class="prod__fit">${ctx.answers.firstSentence(v.description)}</span>
              </span>
            </a>
          </th>
          <td class="ix-c-cats"><span class="ix-catlist">${ui.join(
            [
              ...cats.map((c) => html`<a href="${ctx.url.category(c.id)}">${c.name}</a>`),
              ...extra.map((x) => html`<a href="${ctx.url.supplier(x.category.id, x.supplier.id)}">${x.category.name}</a>`),
            ],
            ', ',
          )}</span>${visit(v)}</td>
          <td class="ptable__c-score">${scoreCell({ best, cats })}</td>
          <td class="ptable__c-price">${ui.priceCell(ctx, p)}</td>
          <td class="ptable__c-ai">${ui.tag(ai.label, ai.rank >= 4 && 'brand')}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;

  const products = html`<section class="wrap ix-dir" data-ix="software" aria-label="Products">
    ${controls}
    ${table}
    ${emptyState('product')}
    <p class="ix-more"><button type="button" class="btn btn--ghost" data-ix-more hidden>Show ${PAGE_SIZE} more (${PAGE_SIZE} of ${total})</button></p>
    <p class="table-note">Highest score = a product’s highest <a href="/methodology/">documented-fit score</a> (out of 100) across a product’s categories, from official documentation checked as of ${ui.time(ctx, ctx.catalog.checkedAt)} — not a customer rating or a hands-on test. “Score pending” means less than 80% of the checklist weight has been checked. Prices are dated public list prices, not quotes. No vendor pays for placement, and filters never change a published score.</p>
  </section>`;

  const supplierBlock = html`<section class="wrap section ix-sup" id="suppliers" aria-labelledby="suppliers-h" data-ix-suppliers data-shown="${SUPPLIERS_SHOWN}">
    ${ui.sectionHead('Documented suppliers', {
      id: 'suppliers-h',
      sub: `${suppliers.length} suppliers researched inside ${ctx.factualCategories.length} category comparisons: no separate profile and no score.`,
    })}
    <ul class="linklist linklist--3">
      ${suppliers.map(
        ({ category, supplier }) =>
          html`<li data-ix-row><a href="${ctx.url.supplier(category.id, supplier.id)}"><span>${supplier.name}<small>${category.name}</small></span><span>${ctx.plural((supplier.plans || []).length, 'plan')}</span></a></li>`,
      )}
    </ul>
    <p class="fineprint" data-ix-sup-empty hidden>No documented supplier matches this filter.</p>
    <p class="ix-more"><button type="button" class="btn btn--ghost" data-ix-sup-more hidden>Show all ${suppliers.length} suppliers</button></p>
  </section>`;

  const faqItems = [
    {
      q: 'How many products are in the software directory?',
      a: `${total} products have a full profile, across ${ctx.scoredCategories.length} scored categories. A further ${suppliers.length} suppliers are documented inside ${ctx.factualCategories.length} category comparisons; they have no separate profile and no score.`,
    },
    {
      q: 'Why does the directory show a “highest score”?',
      a: `A product is scored separately in each category it belongs to, against that category’s checklist, and ${nMulti} of the ${total} products are in more than one category. The directory shows the highest published documented-fit score and names its category; the product profile lists the score in every category. ${nScored} products have at least one published score and ${total - nScored} are score-pending.`,
    },
    {
      q: 'Where do the starting prices come from?',
      a: `From each vendor’s official pricing page, read on a stated date. ${nPriced} of the ${total} products have a public starting price; the others are quote-only, usage-based or not verified. Prices are dated observations of public list prices, not quotes, and units differ between vendors.`,
    },
  ];
  // a plain wrapper: the FAQ inside is already a section labelled by its own heading (one landmark, one name)
  const faq = html`<div class="section ix-faq">
    <div class="wrap wrap--narrow">
      ${ui.faq(ctx, faqItems, { heading: 'Questions about the directory', open: 0 })}
      <p class="ix-after"><a class="link-arrow" href="/faq/">All questions and answers</a></p>
    </div>
  </div>`;

  return {
    title: seoTitle(`Software directory: ${total} products researched`),
    description: describe([
      `All ${total} researched business software products for US buyers, by category, with documented-fit score, starting price and AI level. Search or filter.`,
      live.description,
    ]),
    ogTitle: 'Software directory',
    nav: 'categories',
    breadcrumbs: [{ name: 'Software directory', url }],
    pageType: 'CollectionPage',
    pageExtra: { mainEntity: { '@id': `${ctx.abs(url)}#primary-list` } },
    dateModified: ctx.isoDate(ctx.catalog.researchUpdatedAt),
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    jsonld: [
      ctx.seo.itemListNode(
        url,
        vendors.map((v) => ({ name: v.name, url: ctx.url.software(v.id) })),
        { name: 'Software directory: product profiles A–Z', ordered: false },
      ),
    ],
    scripts: ['js/directory.js'],
    pageData: { syn: synonymsFor(ctx, ctx.categories.map((c) => c.id)) },
    body: squeeze(html`${head}${products}${supplierBlock}${faq}`),
  };
}
