// /tools/cost/ — one total-cost calculator (the previous page had two unrelated ones).
// Static HTML: the answer, the picker, which prices are modelled automatically (with dates and sources),
// how the totals are calculated, what is never included, the same-scope checklist and an FAQ.
// js/cost.js turns the picker into the live calculator; the cost model itself lives in that file and is
// loaded here too, so the worked example on the page is computed by the same code the browser runs.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { html, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';
import { createCostCatalog, readyOffers, UNREADY } from '../lib/cost-catalog.mjs';

export function routes() {
  return [{ path: '/tools/cost/', render }];
}

function loadModel(ctx) {
  const src = readFileSync(path.join(ctx.root, 'src/assets/js/cost.js'), 'utf8');
  const m = { exports: {} };
  new Function('module', src)(m);
  return m.exports;
}

const rateFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DISCLAIMER =
  'These are partial cost models, not quotes or a cheapest-product ranking. Products may have different included features, billing terms and exclusions. Blank extras remain excluded; they do not mean that a supplier charges nothing.';
const SAME_SCOPE = [
  'Name the same number of paid and light users. Include minimum commitments.',
  'Include message registration, carrier fees, AI credits, storage and transaction charges where applicable.',
  'Separate onboarding, migration, integration work, training and internal staff time.',
  'Ask about renewal rates, overages, cancellation dates and data export.',
  'Run a steady-state case and a growth case. A low starting price can hide a different cost curve.',
];

function render(ctx) {
  const pagePath = '/tools/cost/';
  const live = ctx.liveHead(pagePath) || {};
  const catalog = createCostCatalog(ctx);
  const ready = readyOffers(catalog);
  const offerCount = catalog.categories.reduce((n, c) => n + c.products.reduce((m, p) => m + p.offers.length, 0), 0);
  const dates = ready.map((r) => r.offer.checkedAt).filter(Boolean).sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const model = loadModel(ctx);

  const H1 = 'Total cost calculator';
  const title = seoTitle('Software total cost calculator') || live.title;
  const description = describe([
    `Total cost calculator for software: compare up to three products over 1–60 months from dated list prices or your own quote. Taxes excluded; not a quote.`,
    live.description,
  ]);

  // ---- examples for the empty state: one link per category that has calculator-ready offers
  const byCategory = new Map();
  for (const r of ready) {
    if (!byCategory.has(r.categoryId)) byCategory.set(r.categoryId, { name: r.categoryName, products: [] });
    const entry = byCategory.get(r.categoryId);
    if (!entry.products.some((p) => p.id === r.productId)) entry.products.push({ id: r.productId, name: r.productName });
  }
  const examples = [...byCategory].map(([id, c]) => ({
    href: `${pagePath}?scope=${id}${c.products.slice(0, 3).map((p, i) => `&${'abc'[i]}=${p.id}`).join('')}`,
    label: `${c.name}: ${ctx.listText(c.products.slice(0, 3).map((p) => p.name))}`,
  }));

  // ---- worked example, computed with the page's own model (an annual seat price shows the rounding rule best)
  const sample = ready.find((r) => r.offer.kind === 'seat' && r.offer.commitmentMonths === 12) || ready.find((r) => r.offer.kind === 'seat');
  let worked = '';
  if (sample) {
    const res = model.calculateCostScenario(sample.offer, { months: '18', quantity: '10', addons: '', setup: '' });
    if (res.status === 'modeled') {
      worked = html`<p class="tl-worked"><b>Worked example.</b> ${sample.productName} ${sample.offer.name} is listed at ${rateFmt.format(sample.offer.amount)} ${sample.offer.unit}${
        sample.offer.commitmentMonths === 12 ? ' with a 12-month commitment' : ''
      } (checked ${ui.time(ctx, sample.offer.checkedAt)}). For 10 paid seats over 18 months the model counts ${res.billableMonths} base-price months: 10 × ${rateFmt.format(
        sample.offer.amount,
      )} × ${res.billableMonths} = <strong>${usd.format(res.modeledTotal)}</strong>, before taxes and anything you did not enter.</p>`;
    }
  }

  const head = html`<header class="wrap page-head page-head--wide">
      <h1>${H1}</h1>
      ${ui.trustline([
        firstDate ? html`List prices checked ${ui.time(ctx, firstDate)}${lastDate !== firstDate ? html` – ${ui.time(ctx, lastDate)}` : ''}` : null,
        'Taxes excluded',
        'Not a quote',
      ])}
    </header>
    <div class="wrap tl-answer">
      ${ui.answer(
        ctx,
        html`Compare what up to three products in one category cost over the months you choose. The totals are <strong>partial cost models from dated public prices or your own quote</strong> — not supplier quotes, and not a cheapest-product ranking.`,
      )}
    </div>`;

  // ---- the tool (static shell; js/cost.js fills it)
  const numField = ({ key, id, label, min, max, value = '', hint, hidden = false, integer = true }) =>
    html`<div class="field"${hidden ? html` hidden` : ''}>
      <label for="${id}">${label}</label>
      <input class="input" id="${id}" type="number" inputmode="${integer ? 'numeric' : 'decimal'}" min="${min}" max="${max}" step="1" value="${value}" autocomplete="off" data-cost-shared="${key}" aria-describedby="${hint ? `${id}-hint ` : ''}${id}-err">
      ${hint ? html`<span class="hint" id="${id}-hint">${hint}</span>` : ''}
      <span class="error" id="${id}-err" hidden></span>
    </div>`;

  const tool = html`<section class="wrap tl-tool" id="calculator" data-cost aria-labelledby="calc-h">
    <h2 id="calc-h" class="sr-only">Calculator</h2>
    <noscript>
      <p class="note">The calculator needs JavaScript. Without it you can still read which prices are modelled, how the totals are calculated and what is excluded below, or open the <a href="/software/">software directory</a> for published pricing sources.</p>
    </noscript>
    <div class="tl-app">
      <div class="tl-setup">
        <div class="tl-setup__pick">
      <h3 class="tl-step"><span aria-hidden="true">1</span>Choose up to three products</h3>
      <div class="tl-pick">
        <div class="field">
          <label for="tl-cat">Category</label>
          <select class="select" id="tl-cat" data-cost-category>
            <option value="">Choose a category</option>
            ${ctx.groups.map(
              (g) => html`<optgroup label="${g.label}">${g.categories.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</optgroup>`,
            )}
          </select>
        </div>
        <div class="field">
          <label for="tl-add">Products <span class="tl-optional">up to three</span></label>
          <select class="select" id="tl-add" data-cost-add disabled>
            <option value="">Choose a category first</option>
          </select>
        </div>
      </div>
      <p class="tl-note" data-cost-note hidden></p>
        </div>
        <div class="tl-setup__scenario" data-cost-scenario hidden>
          <h3 class="tl-step"><span aria-hidden="true">2</span>Your scenario</h3>
          <div class="tl-shared">
            ${numField({ key: 'months', id: 'tl-months', label: 'Months to model', min: 1, max: 60, value: '12', hint: 'Between 1 and 60.' })}
            ${numField({ key: 'seats', id: 'tl-seats', label: 'Paid seats', min: 1, max: 10000000, value: '10', hint: 'Example input: 10 paid seats. Change this to your team size.' })}
            ${numField({ key: 'segments', id: 'tl-segments', label: 'US SMS segments per month', min: 0, max: 10000000, hidden: true, hint: 'Total inbound and outbound segments.' })}
            ${numField({ key: 'emails', id: 'tl-emails', label: 'Email sends per month', min: 0, max: 10000000, hidden: true })}
            ${numField({ key: 'contacts', id: 'tl-contacts', label: 'Stored contacts', min: 0, max: 10000000, hidden: true })}
          </div>
        </div>
      </div>

      <div class="tl-empty" data-cost-empty>
        <p><b>Nothing is selected yet.</b> Totals appear here as soon as you choose a product. If you saved a shortlist, the calculator starts from it.</p>
        ${
          examples.length
            ? html`<p class="tl-empty__label">Or open a scenario with a dated list price</p>
                <div class="chips">${examples.map((e) => html`<a class="chip chip--link" href="${e.href}">${e.label}</a>`)}</div>`
            : ''
        }
      </div>

      <div class="tl-body" data-cost-body hidden>
        <h3 class="tl-step tl-step--plain" id="tl-totals-h">Totals</h3>
        <div class="tl-totals-wrap" data-cost-totals></div>

        <div class="tl-per">
          <div class="tl-bar" data-cost-bar aria-hidden="true"></div>
          <div class="tl-per__grid">
            <div class="tl-per__label">
              <h3 class="tl-step"><span aria-hidden="true">3</span>Fine-tune each product</h3>
              <p class="hint">Add what you know: extras, one-time costs, or your own quote. Blank fields stay excluded.</p>
            </div>
            <div class="tl-products-wrap">
              <div data-cost-bar-sentinel></div>
              <div class="tl-products" data-cost-products></div>
            </div>
          </div>
        </div>

        <div class="tl-actions">
          <button type="button" class="btn btn--ghost" data-copy="url">${ui.icon('share')}Copy link to this scenario</button>
          <button type="button" class="btn btn--ghost" data-cost-csv disabled>Download assumptions CSV</button>
          <button type="button" class="btn btn--quiet" data-cost-reset hidden>Start over</button>
        </div>
      </div>

      <p class="tl-status" role="status" aria-live="polite" data-cost-status>Choose a category, then up to three products.</p>
      <p class="fineprint">${DISCLAIMER} Calculator-ready rates come from dated research snapshots, not live quotes. Confirm the current price and plan limits before buying.</p>
    </div>
  </section>`;

  // ---- which prices are modelled automatically
  const commitment = (o) => (o.commitmentMonths === 12 ? '12 months' : 'None assumed');
  const readyBlock = html`<section class="wrap section" id="modelled-prices" aria-labelledby="ready-h">
    ${ui.sectionHead('Prices the calculator models automatically', {
      id: 'ready-h',
      sub: `${ready.length} of ${offerCount} offers in ${catalog.categories.length} categories are calculator-ready today. Each is a dated research snapshot of a public list price, not a live quote.`,
    })}
    <div class="scroller">
      <table class="dtable tl-ready">
        <caption class="sr-only">Offers modelled from a dated public list price</caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Offer</th>
            <th scope="col">List price</th>
            <th scope="col">Commitment modelled</th>
            <th scope="col">Checked</th>
            <th scope="col">Source</th>
            <th scope="col"><span class="sr-only">Open in the calculator</span></th>
          </tr>
        </thead>
        <tbody>
          ${ready.map(
            (r) => html`<tr>
              <th scope="row"><a href="${ctx.url.software(r.productId)}">${r.productName}</a><small>${r.categoryName}</small></th>
              <td data-label="Offer">${r.offer.name}${
                r.offer.kind === 'email-tier' ? html`<small>Entry tier: up to ${r.offer.maxEmails.toLocaleString('en-US')} email sends and ${r.offer.maxContacts.toLocaleString('en-US')} stored contacts</small>` : ''
              }</td>
              <td class="tl-ready__price"><b class="num">${rateFmt.format(r.offer.amount)}</b> ${r.offer.unit}</td>
              <td data-label="Commitment modelled">${commitment(r.offer)}</td>
              <td data-label="Checked">${ui.time(ctx, r.offer.checkedAt)}</td>
              <td>${ui.sourceLink(r.offer.source, 'Pricing source')}</td>
              <td><a class="link-arrow" href="${pagePath}?scope=${r.categoryId}&a=${r.productId}${r.offer.id !== 'entry' && r.offer.id !== firstReadyId(ready, r) ? `&offer_a=${r.offer.id}` : ''}">Model it</a></td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <p class="table-note">Every other product is modelled from the quote you enter. The calculator states why: “${UNREADY.replace(' You can enter your own whole-scope USD quote below.', '')}” A price becomes calculator-ready only when its amount, plan, unit, billing basis, source and check date have all been confirmed.</p>
  </section>`;

  // ---- how it is calculated + what is never included
  const how = html`<section class="wrap section" id="how-it-works" aria-labelledby="how-h">
    ${ui.sectionHead('How the totals are calculated', { id: 'how-h' })}
    <div class="tl-two">
      <div>
        <ol class="steps tl-how">
          <li><b>Base price.</b> Paid seats or SMS segments are multiplied by the dated list price. An entry email tier is a flat monthly price; your sends and contacts only decide whether the tier still applies.</li>
          <li><b>Commitment.</b> An annual commitment is counted in whole years, so an 18-month window includes 24 base-price months. This is committed base spend, not a monthly-payment offer.</li>
          <li><b>Extras.</b> Entered monthly extras run for the requested months. One-time costs are added once; no separate commitment for extras is assumed.</li>
          <li><b>Your own quote.</b> For every product without a calculator-ready price — or whenever you prefer your quote — enter the monthly equivalent for the complete quantity and package, and its commitment. The whole-scope monthly quote and commitment are your assumptions, not a verified supplier price.</li>
          <li><b>Growth (own quote only).</b> You can also price a quote per seat or by usage. Each month then costs (paid seats × price per seat + usage units × cost per unit) × (1 + annual growth)<sup>month ÷ 12</sup>, plus any fixed monthly fee. Growth applies to seats and usage only.</li>
        </ol>
        ${worked}
      </div>
      <div class="tl-aside">
        <h3>Never included</h3>
        ${ui.ticks(
          [
            'Taxes, financing and currency changes',
            'Price changes and renewal-rate changes',
            'Costs not entered — blank extras remain excluded; they do not mean that a supplier charges nothing',
            'Each product’s known extra costs (listed per product under “Assumptions and excluded costs”), unless covered by the extras you enter',
          ],
          'crosses',
        )}
        <h3>What you can take away</h3>
        ${ui.ticks(
          ['A link that reopens the exact scenario — the page address updates as you type', 'A CSV of every input, assumption and exclusion', 'No account; nothing you enter is sent to us'],
          'ticks',
        )}
      </div>
    </div>
  </section>`;

  const scope = html`<section class="wrap section" id="same-scope" aria-labelledby="scope-h">
    ${ui.sectionHead('Make each quote cover the same scope', { id: 'scope-h', sub: 'Five checks before you compare two totals.' })}
    <ol class="steps tl-scope">${SAME_SCOPE.map((s) => html`<li>${s}</li>`)}</ol>
  </section>`;

  const faqItems = [
    {
      q: 'Are taxes included in the totals?',
      a: 'No. Taxes, price changes and renewal-rate changes, and any cost you did not enter are excluded from every scenario. Blank extras remain excluded; they do not mean that a supplier charges nothing.',
    },
    {
      q: 'Why does an 18-month scenario show 24 months of base cost?',
      a: 'Because of the annual commitment. Annual terms are counted in whole years, so 24 base-price months are included for an 18-month modeling window. This is committed base spend, not a monthly-payment offer.',
    },
    {
      q: 'Why is there no automatic price for my product?',
      a: `Only ${ready.length} offers are calculator-ready today. For every other product the price is not ready for automatic cost modeling: its unit, tier, commitment or included scope still needs confirmation. You can enter your own whole-scope USD quote instead, and the calculator treats it as your assumption.`,
    },
    {
      q: 'Is the lowest total the best choice?',
      a: DISCLAIMER,
    },
    {
      q: 'What is a billable SMS segment?',
      a: 'A text message can contain several billable segments. Enter total inbound and outbound segments; the base rate excludes carrier, number and registration fees.',
    },
    {
      q: 'Can I save or share a scenario?',
      a: 'Yes. The page address updates as you type, so “Copy link to this scenario” shares exactly what you see, and “Download assumptions CSV” exports every input, assumption and exclusion. Nothing is stored on our servers and no account is needed.',
    },
    firstDate && {
      q: 'How current are the modelled prices?',
      // visible answer with <time> elements; `plain` is the identical sentence for the FAQ JSON-LD
      plain: `Each modelled price is a dated research snapshot of a public list price with a link to its source. The current snapshots were checked between ${ctx.fmtDate(firstDate)} and ${ctx.fmtDate(lastDate)}. Reconfirm current terms with the supplier before buying.`,
      a: html`<p>Each modelled price is a dated research snapshot of a public list price with a link to its source. The current snapshots were checked between ${ui.time(ctx, firstDate)} and ${ui.time(ctx, lastDate)}. Reconfirm current terms with the supplier before buying.</p>`,
    },
  ].filter(Boolean);

  const faq = html`<div class="wrap wrap--narrow section">${ui.faq(ctx, faqItems, { heading: 'Cost calculator: questions buyers ask' })}</div>`;

  const next = html`<section class="wrap section" aria-labelledby="next-h">
    ${ui.sectionHead('Keep researching', { id: 'next-h' })}
    <div class="tl-next">${ui.chipLinks([
      { href: '/shortlist/', label: 'Your shortlist' },
      { href: '/compare/', label: 'Compare products side by side' },
      { href: '/categories/', label: 'All categories' },
      { href: '/methodology/', label: 'How we score' },
    ])}</div>
  </section>`;

  return {
    title,
    description,
    ogTitle: 'Software total cost calculator',
    breadcrumbs: [{ name: 'Cost calculator', url: pagePath }],
    pageType: 'WebPage',
    dateModified: lastDate || undefined,
    pageExtra: { mainEntity: { '@id': `${ctx.abs(pagePath)}#calculator` } },
    jsonld: [
      {
        '@type': 'WebApplication',
        '@id': `${ctx.abs(pagePath)}#calculator`,
        name: H1,
        url: ctx.abs(pagePath),
        description,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        inLanguage: ctx.site.lang,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
        featureList: ['Compare up to three products in one category', 'Dated list prices or your own quote', 'Annual-commitment rounding', 'Shareable scenario link', 'CSV export of assumptions and exclusions'],
        mainEntityOfPage: { '@id': `${ctx.abs(pagePath)}#page` },
        publisher: { '@id': `${ctx.site.origin}/#publisher` },
      },
    ],
    faq: faqItems.map((f) => ({ q: f.q, a: f.plain || text(f.a) })),
    scripts: ['js/cost.js'],
    body: html`${head}${tool}${readyBlock}${how}${scope}${faq}${next}`,
  };
}

// the offer a product opens with in the calculator (its first calculator-ready offer) needs no offer_a parameter
function firstReadyId(ready, r) {
  const first = ready.find((x) => x.categoryId === r.categoryId && x.productId === r.productId);
  return first ? first.offer.id : null;
}
