// /alternatives/{id}/ — the other products of a vendor's category, ranked on the same checklist, with the
// vendor itself pinned on top as the reference row and a "vs {Name}" link on every alternative.
// Vendors in several categories get one tab per category (all panels are in the HTML; the default is the
// first category in catalog order, as on the live site). ?scope={categoryId} selects a tab (directory.js).

import { html, raw, text, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';
import { squeeze } from './categories.mjs';

export function routes(ctx) {
  return ctx.vendors.map((v) => ({ path: ctx.url.alternatives(v.id), render: (c) => render(c, v) }));
}

/**
 * Adds one trailing column to a ui.productTable() result (the shared table has no slot for it).
 * Fails the build if the table markup ever stops matching, instead of silently dropping the links.
 */
function addColumn(table, rowCount, headCell, cellFor) {
  let heads = 0;
  let cells = 0;
  let s = String(table).replace(/<\/tr>\s*<\/thead>/, (m) => {
    heads++;
    return `${headCell}${m}`;
  });
  s = s.replace(/(<tr[^>]*\sdata-id="([^"]+)"[^>]*>)([\s\S]*?)<\/tr>/g, (m, open, id, inner) => {
    cells++;
    return `${open}${inner}${cellFor(id)}</tr>`;
  });
  if (heads !== 1 || cells !== rowCount) throw new Error(`alternatives: could not extend the product table (${heads} header, ${cells}/${rowCount} rows)`);
  return raw(s);
}

function render(ctx, vendor) {
  const A = ctx.answers;
  const path = ctx.url.alternatives(vendor.id);
  const live = ctx.liveHead(path) || {};
  const cats = ctx.vendorCategories(vendor);
  const main = cats[0];
  const multi = cats.length > 1;
  const profile = ctx.url.software(vendor.id);
  const usd = (p) => p.hasAmount && p.currency === 'USD';

  // The shared generator lower-cases the first letter of "{Name} itself is score-pending" after a semicolon,
  // which turns "NordVPN" into "nordVPN"; restore the brand's own spelling.
  const lowered = vendor.name[0].toLowerCase() + vendor.name.slice(1);
  const quickAnswer = (category) => A.alternativesQuickAnswer(vendor, category).split(`; ${lowered} itself`).join(`; ${vendor.name} itself`);

  // ---------------------------------------------------------------- one panel per category
  const panel = (category, isDefault) => {
    const f = A.alternativesFacts(vendor, category);
    const n = f.others.length;
    const fs = ctx.score(category.id, vendor.id);
    const fp = f.focalPrice;
    const higher = fs.pending ? 0 : f.others.filter((v) => {
      const s = ctx.score(category.id, v.id);
      return !s.pending && s.value > fs.value;
    }).length;
    const priced = f.others.filter((v) => usd(ctx.price(v, category.id))).length;
    const chips = [
      !fs.pending && higher > 0 && { f: 'higher', label: `Higher score than ${vendor.name}`, n: higher },
      fs.pending && f.scored.length > 0 && f.scored.length < n && { f: 'scored', label: 'Scored only', n: f.scored.length },
      f.cheaper.length > 0 && { f: 'cheaper', label: 'Lower starting price', n: f.cheaper.length },
      priced > 0 && priced < n && { f: 'priced', label: 'Public price', n: priced },
    ].filter(Boolean);

    const vsCell = (otherId) => {
      const other = ctx.vendor(otherId);
      const pair = ctx.pairPage(category.id, vendor.id, otherId);
      const href = pair ? ctx.url.vs(pair.id) : ctx.url.compare({ scope: category.id, ids: [vendor.id, otherId] });
      return String(html`<td class="ix-c-vs"><a href="${href}" aria-label="${other.name} vs ${vendor.name}">vs ${vendor.name}</a></td>`);
    };

    const refTable = addColumn(
      ui.productTable(ctx, category.id, [{ vendor }], {
        id: `ref-${category.id}`,
        focalId: vendor.id,
        sortable: false,
        lazyFrom: isDefault ? 1 : 0,
        caption: `${vendor.name} in ${category.name}: the product the alternatives are compared with`,
      }),
      1,
      String(html`<th scope="col" class="ix-c-vs"><span class="sr-only">Links</span></th>`),
      () => String(html`<td class="ix-c-vs"><a class="link-arrow" href="${profile}">Profile</a></td>`),
    );
    const altTable = addColumn(
      ui.productTable(ctx, category.id, f.others.map((v) => ({ vendor: v })), {
        id: `alts-${category.id}`,
        sortable: false,
        lazyFrom: isDefault ? 5 : 0,
        caption: `Alternatives to ${vendor.name} in ${category.name}, ranked by documented-fit score`,
      }),
      n,
      String(html`<th scope="col" class="ix-c-vs">Head-to-head</th>`),
      vsCell,
    );

    // The old cards printed a check date under every score and price. The shared row has no room for them,
    // so the panel states the span of those dates once (the per-check dates are in each score breakdown).
    const span = (dates) => {
      const d = [...new Set(dates.filter(Boolean).map((x) => ctx.isoDate(x)))].sort();
      if (!d.length) return '';
      return d.length === 1 ? html`on ${ui.time(ctx, d[0])}` : html`between ${ui.time(ctx, d[0])} and ${ui.time(ctx, d[d.length - 1])}`;
    };
    const listed = [vendor, ...f.others];
    const evidenceSpan = span(listed.map((v) => ctx.score(category.id, v.id).checkedAt));
    const priceDates = listed.map((v) => ctx.price(v, category.id)).map((p) => (p.smsUnverified ? null : p.checkedAt));
    const priceSpan = span(priceDates);
    const datesLine = html`${evidenceSpan ? html` Evidence for these products was checked ${evidenceSpan}.` : ''}${
      priceSpan ? html` Price sources were checked ${priceSpan}${priceDates.every(Boolean) ? '' : ', where a check date is recorded'}.` : ''
    }`;

    // Quick filters (when the data offers any), the live count and the sort, in one toolbar.
    const controls =
      n > 1
        ? html`<div class="${chips.length ? 'toolbar ix-toolbar' : 'toolbar ix-toolbar ix-toolbar--plain'}" data-ix-controls data-nosnippet>
            ${
              chips.length
                ? html`<div class="chips ix-chips" role="group" aria-label="Filter alternatives">
                    ${chips.map((c) => html`<button type="button" class="chip" data-f="${c.f}" aria-pressed="false">${c.label} <span class="n">${c.n}</span></button>`)}
                    <button type="button" class="chip chip--link" data-ix-reset hidden>Clear filters</button>
                  </div>`
                : ''
            }
            <p class="toolbar__count" role="status" aria-live="polite" data-ix-count data-noun="alternatives"><b>${n}</b> alternatives</p>
            <label class="ix-select ix-bar__end"><span class="sr-only">Sort alternatives</span>
              <select class="select" data-ix-sort aria-label="Sort alternatives">
                <option value="score">Sort: score</option>
                <option value="price">Sort: price, low to high</option>
                <option value="name">Sort: name A–Z</option>
              </select>
            </label>
          </div>`
        : '';

    return html`<div${attrs({
      class: multi ? 'tabs__panel ix-panel' : 'ix-panel',
      role: multi ? 'tabpanel' : null,
      id: `alt-${category.id}`,
      'aria-labelledby': multi ? `alt-tab-${category.id}` : null,
      hidden: multi && !isDefault,
      'data-ix-panel': true,
      'data-scope': category.id,
      'data-fscore': fs.pending ? '' : fs.value,
      'data-fprice': usd(fp) ? fp.amount : '',
    })}>
      ${ui.answer(ctx, quickAnswer(category))}
      <div class="ix-panel__head">
        <h2 id="alt-h-${category.id}">${ctx.plural(n, 'researched alternative')} in ${category.name}</h2>
        ${/* the heading can be long: the help panel opens towards the left so it stays on a 768px screen */ ui.scoreHelp(ctx, { align: 'right' })}
      </div>
      ${controls}
      <div class="ix-ref">${refTable}</div>
      <div class="ix-alts">${altTable}</div>
      <p class="empty" data-ix-empty hidden><b>No alternative matches these filters.</b> <button type="button" class="btn btn--quiet btn--sm" data-ix-reset>Clear filters</button></p>
      <p class="fineprint ix-panel__note">Ranked on the ${category.name} checklist, highest documented-fit score first; “#” is the published rank in the category. Product-wide evidence can span multiple plans. Check the price, usage limits and exact plan before choosing.${datesLine}</p>
      <p class="cluster ix-panel__links">
        <a class="btn btn--ghost" href="${ctx.url.compare({ scope: category.id, ids: [vendor.id] })}">Compare with ${vendor.name}</a>
        <a class="link-arrow" href="${ctx.url.category(category.id)}">See the full ${category.name} ranking and sources</a>
      </p>
    </div>`;
  };

  // ---------------------------------------------------------------- head
  const mf = A.alternativesFacts(vendor, main);
  const n = mf.others.length;
  const link = html`<a href="${profile}">${vendor.name}</a>`;
  const lede = multi
    ? html`Other researched products, ranked on the same checklist as ${link}, for each of its ${cats.length} categories.`
    : n === 1
      ? html`One other product in ${main.name} is researched on the same checklist as ${link}.`
      : html`${n} other products in ${main.name}, ranked on the same checklist as ${link}.`;

  const head = html`<header class="wrap page-head page-head--wide">
    <h1>${vendor.name} alternatives</h1>
    <p class="lede">${lede} This view uses the current category evidence, not a separate ranking or an exhaustive market list.</p>
    ${ui.trustline([
      html`Evidence checked ${ui.time(ctx, ctx.catalog.checkedAt)}`,
      `${mf.scored.length} of ${ctx.plural(n, 'alternative')} scored${multi ? ` in ${main.name}` : ''}`,
      'Desk research, not hands-on testing',
      html`<a href="/methodology/">How we score</a>`,
    ])}
  </header>`;

  const panels = multi
    ? html`<div class="tabs" data-tabs>
        <div class="seg tabs__list" role="tablist" aria-label="Alternatives by category">
          ${cats.map(
            (c, i) =>
              html`<button type="button" role="tab" id="alt-tab-${c.id}" aria-controls="alt-${c.id}" data-scope="${c.id}" aria-selected="${i === 0 ? 'true' : 'false'}"${raw(i === 0 ? '' : ' tabindex="-1"')}>${c.name}</button>`,
          )}
        </div>
        ${cats.map((c, i) => panel(c, i === 0))}
      </div>`
    : panel(main, true);

  const body = html`<div class="wrap ix-alt" data-ix="alternatives" data-default="${main.id}">
    ${panels}
    ${ui.tableNote(ctx)}
  </div>`;

  // ---------------------------------------------------------------- FAQ + onward links
  const faqItems = A.alternativesFaq(vendor, main);
  const faq = faqItems.length ? html`<div class="wrap wrap--narrow section">${ui.faq(ctx, faqItems, { heading: `${vendor.name} alternatives: questions buyers ask` })}</div>` : '';

  const vsPages = ctx.comparisonsFor(vendor.id);
  const onward = html`<section class="wrap section" aria-labelledby="alt-more-h">
    ${ui.sectionHead(`Keep researching ${vendor.name}`, { id: 'alt-more-h' })}
    ${ui.linkList(
      [
        { href: profile, title: `${vendor.name} profile`, sub: 'Pricing, capabilities, AI and official sources' },
        ...cats.map((c) => ({ href: ctx.url.category(c.id), title: c.name, sub: `All ${ctx.plural(ctx.summary(c.id).total, 'product')} ranked on one checklist` })),
      ],
      { cols: 2 },
    )}
    ${
      vsPages.length
        ? html`<h3 class="ix-subhead">Published comparisons with ${vendor.name}</h3>
            ${ui.linkList(
              vsPages.map((x) => ({ href: ctx.url.vs(x.id), title: ctx.comparisonNames(x).map((nm) => nm.name).join(' vs '), meta: ctx.category(x.categoryId).name })),
              { cols: 2 },
            )}`
        : ''
    }
  </section>`;

  const year = (ctx.vendorUpdated(vendor) || ctx.catalog.checkedAt || '').slice(0, 4);

  return {
    title: seoTitle(`${vendor.name} alternatives`, year),
    description: describe([
      n === 1
        ? `1 researched ${main.name} alternative to ${vendor.name}, with its documented-fit score, US pricing and check dates.`
        : `${n} researched ${main.name} alternatives to ${vendor.name}, ordered by documented-fit score, with US pricing and check dates.`,
      `Researched ${main.name} alternatives to ${vendor.name}, with documented-fit scores and US pricing.`,
      `Researched alternatives to ${vendor.name}, with documented-fit scores and US pricing.`,
      live.description,
    ]),
    ogTitle: `${vendor.name} alternatives`,
    nav: 'categories',
    breadcrumbs: [
      { name: 'Categories', url: '/categories/' },
      { name: main.name, url: ctx.url.category(main.id) },
      { name: vendor.name, url: profile },
      { name: 'Alternatives', url: path },
    ],
    pageType: 'CollectionPage',
    pageExtra: {
      about: { '@type': 'SoftwareApplication', '@id': `${ctx.abs(profile)}#software`, name: vendor.name, url: vendor.url, applicationCategory: 'BusinessApplication' },
      mainEntity: { '@id': `${ctx.abs(path)}#primary-list` },
    },
    dateModified: ctx.categoryUpdated(main),
    faq: faqItems.map((q) => ({ q: q.q, a: text(q.a) })),
    jsonld: [
      ctx.seo.itemListNode(
        path,
        mf.others.map((v) => ({ name: v.name, url: ctx.url.software(v.id) })),
        { name: `Alternatives to ${vendor.name} in ${main.name} by documented-fit score` },
      ),
    ],
    scripts: ['js/directory.js'],
    body: squeeze(html`${head}${body}${faq}${onward}`),
  };
}
