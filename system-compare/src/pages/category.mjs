// Scored category page: answer first, one ranked table with instant filters, a capability matrix as a
// second view of the same products, then the buying guide, FAQ, comparisons and sources.
// (Documentary categories — category.mode === 'factual' — are rendered by category-factual.mjs.)

import { html, raw, text, cx, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes(ctx) {
  return ctx.scoredCategories.map((category) => ({ path: ctx.url.category(category.id), render: (c) => render(c, category) }));
}

const GROUP_ORDER = ['core', 'integrations', 'local', 'ai'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (iso) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');

function render(ctx, category) {
  const A = ctx.answers;
  const s = ctx.summary(category.id);
  const path = ctx.url.category(category.id);
  const group = ctx.groupOf(category);
  const noun = A.categoryNoun(category);
  const things = A.categoryThings(category);
  const ranked = s.ranked;
  const updated = ctx.categoryUpdated(category);
  const year = (ctx.catalog.checkedAt || '').slice(0, 4);

  // ---- features (checklist rows) with their score group and active flag — same for every vendor
  const sample = ranked[0] ? ctx.fit(category.id, ranked[0].id).rows : [];
  const features = sample.map((row, i) => ({ i, id: row.id, label: row.label, description: row.description, group: row.scoringGroup, active: row.active, tier: row.tier }));
  const groupMeta = Object.fromEntries(ctx.scoring.SCORE_GROUPS.map((g) => [g.id, g]));
  const activeCount = features.filter((f) => f.active).length;
  const yesIndex = (vendor) => ctx.fit(category.id, vendor.id).rows.map((r, i) => (r.effectiveStatus === 'yes' ? i : -1)).filter((i) => i >= 0).join(' ');
  const yesCount = features.map((f) => ranked.filter((v) => ctx.fit(category.id, v.id).rows[f.i].effectiveStatus === 'yes').length);

  // ---- facet counts for the filter chips
  const prices = ranked.map((v) => ctx.price(v, category.id));
  const nScored = s.scored;
  const nPriced = prices.filter((p) => p.hasAmount && p.currency === 'USD').length;
  const nAi = ranked.filter((v) => ['native', 'agent'].includes(v.ai?.level)).length;

  // ---- head
  const scoredList = ranked.filter((v) => !ctx.fit(category.id, v.id).isPending);
  const top = scoredList.slice(0, 3).map((v) => `${v.name} ${ctx.fit(category.id, v.id).score}/100`);
  const base = category.description.replace(/\.$/, '');
  const live = ctx.liveHead(path) || {};
  const title = seoTitle(`${category.name}: ${s.total} tools compared`, year);
  const description = describe([
    top.length >= 2 && `${base}. ${s.total} tools; top documented fit: ${top.slice(0, 2).join(', ')}. Checked ${monYear(ctx.catalog.checkedAt)}.`,
    top.length >= 1 && `${base}. ${s.total} tools; top documented fit: ${top[0]}. Checked ${monYear(ctx.catalog.checkedAt)}.`,
    top.length >= 1 && `${base}. ${s.total} tools; top fit: ${top[0]}.`,
    `${base}. ${s.total} tools compared with dated official sources; scores pending.`,
    `${base}. ${s.total} tools compared.`,
    `${base}.`,
    live.description,
  ]);

  const quick = A.categoryQuickAnswer(category);
  const faqItems = A.categoryFaq(category);
  const pf = A.categoryPriceFacts(category);
  const vsPages = ctx.comparisonsInCategory(category.id);
  const guides = ctx.guidesForCategory(category.id);
  const partner = ctx.site.categoryPartners[category.id];
  const related = group.categories.filter((c) => c.id !== category.id);

  // ---------------------------------------------------------------- "at a glance": picks by situation, from data only
  const link = (v) => html`<a href="${ctx.url.software(v.id)}">${v.name}</a>`;
  const topScore = scoredList[0] ? ctx.fit(category.id, scoredList[0].id).score : null;
  const glance = [
    scoredList.length && {
      label: 'Highest documented fit',
      value: s.recommended.length > 1 ? `${s.recommended.length} products tie` : link(scoredList[0]),
      sub: s.recommended.length > 1 ? `at ${topScore}/100: ${s.recommended.slice(0, 3).map((v) => v.name).join(', ')}${s.recommended.length > 3 ? '…' : ''}` : `${topScore}/100`,
    },
    pf.min && {
      label: 'Lowest verified starting price',
      value: link(pf.min.v),
      sub: `${pf.min.p.headline} ${pf.min.p.unit}`.trim(),
    },
    { label: 'Scored so far', value: `${nScored} of ${s.total}`, sub: s.pending ? `${s.pending} pending under the 80% evidence gate` : 'every product has a published score' },
    { label: 'Native AI or AI agents', value: `${nAi} of ${s.total}`, sub: 'documented in official sources' },
  ];

  // ---------------------------------------------------------------- page head
  const head = html`<header class="wrap page-head page-head--wide">
    <p class="eyebrow"><a href="/categories/#${group.id}">${group.label}</a></p>
    <h1>${noun}: ${s.total} tools compared</h1>
    ${category.buyerQuestion ? html`<p class="lede">${category.buyerQuestion}</p>` : ''}
    ${ui.trustline([
      html`Evidence checked ${ui.time(ctx, ctx.catalog.checkedAt)}`,
      `${nScored} scored · ${s.pending} pending`,
      'Desk research, not hands-on testing',
      html`<a href="/methodology/">How we score</a>`,
    ])}
  </header>
  <div class="wrap cat-answer">
    ${ui.answer(ctx, quick)}
    ${ui.facts(glance)}
  </div>`;

  const nav = ui.subnav(
    [
      { href: '#products', label: 'Ranking' },
      { href: '#features', label: 'Capabilities' },
      { href: '#costs', label: 'Costs' },
      { href: '#buying-guide', label: 'How to choose' },
      category.demoQuestions?.length && { href: '#demo', label: 'Demo questions' },
      { href: '#faq', label: 'FAQ' },
      vsPages.length && { href: '#comparisons', label: 'Comparisons' },
    ].filter(Boolean),
  );

  // ---------------------------------------------------------------- ranking table + filters
  const mustGroups = GROUP_ORDER.map((gid) => ({ gid, label: groupMeta[gid].label, items: features.filter((f) => f.group === gid) })).filter((g) => g.items.length);
  const controls = html`<div class="toolbar" data-table-controls="products" data-nosnippet>
    <div class="chips" role="group" aria-label="Filter products">
      <button type="button" class="chip" data-filter="scored" aria-pressed="false">Scored only <span class="n">${nScored}</span></button>
      <button type="button" class="chip" data-filter="priced" aria-pressed="false">Public price <span class="n">${nPriced}</span></button>
      ${nAi ? html`<button type="button" class="chip" data-filter="ai" aria-pressed="false">Native AI or agents <span class="n">${nAi}</span></button>` : ''}
      <details class="pop mustpop" data-pop>
        <summary class="chip">${ui.icon('filter')} Must-have capabilities <span class="n" data-must-count hidden></span></summary>
        <div class="pop__panel mustpop__panel">
          <p class="fineprint">Show only products where the capability is fully documented. Filters change what you see, never the published score.</p>
          ${mustGroups.map(
            (g) => html`<fieldset>
              <legend>${g.label}</legend>
              ${g.items.map(
                (f) => html`<label class="check"><input type="checkbox" data-must="${f.i}"${raw(yesCount[f.i] ? '' : ' disabled')}><span>${f.label}</span><span class="n">${yesCount[f.i]}</span></label>`,
              )}
            </fieldset>`,
          )}
        </div>
      </details>
      <button type="button" class="chip chip--link" data-filter-reset hidden>Clear filters</button>
    </div>
    <label class="toolbar__sort"><span class="sr-only">Sort products</span>
      <select class="select select--sm" data-sort-select aria-label="Sort products">
        <option value="score">Sort: score</option>
        <option value="price">Sort: price, low to high</option>
        <option value="name">Sort: name A–Z</option>
      </select>
    </label>
  </div>
  <p class="toolbar__count" role="status" aria-live="polite" data-count data-total="${s.total}"><b>${s.total}</b> ${things}</p>`;

  const table = ui.productTable(
    ctx,
    category.id,
    ranked.map((vendor) => ({ vendor })),
    { featureIndex: yesIndex, caption: `${category.name}: ${s.total} products ranked by documented-fit score` },
  );

  const products = html`<section class="wrap cat-products" aria-labelledby="products-h">
    <div class="cat-products__head">
      <h2 id="products-h">${category.name} ranking</h2>
      ${ui.scoreHelp(ctx)}
    </div>
    ${controls}
    ${table}
    <p class="empty" data-empty hidden><b>No product matches these filters.</b>Unverified support does not mean a product lacks a feature. <button type="button" class="btn btn--quiet btn--sm" data-filter-reset>Clear filters</button></p>
    ${ui.tableNote(ctx)}
  </section>`;

  // ---------------------------------------------------------------- capability matrix
  const ST_CODE = { yes: 'yes', partial: 'partial', no: 'no', unknown: 'unknown' };
  const cell = (vendor, f) => {
    const st = ctx.fit(category.id, vendor.id).rows[f.i].effectiveStatus;
    return html`<td><button type="button" class="cellbtn st st--${ST_CODE[st] || 'unknown'} st--icon" data-c="${f.i}"><span>${ui.STATUS_LABELS[st]}</span></button></td>`;
  };
  // Only the checks that count toward the score are in the HTML; the "not scored yet" deep checks
  // are added on demand from /data/cat-<id>.js (they are fully listed on every product profile).
  const matrixRows = (list) =>
    list.map(
      (f) => html`<tr data-f="${f.i}">
        <th scope="row">${f.label}</th>
        ${ranked.map((v) => cell(v, f))}
      </tr>`,
    );
  const matrix = html`<section class="wrap section cat-matrix" id="features" aria-labelledby="features-h">
    <div class="section-head">
      <div>
        <h2 id="features-h">Which capabilities are documented?</h2>
        <p>${activeCount} checks count toward the score today. Select a mark to see the evidence note, its date and the official source.</p>
      </div>
    </div>
    <div class="toolbar" data-nosnippet>
      ${ui.statusLegend()}
      <div class="chips">
        <button type="button" class="chip" data-matrix-picked aria-pressed="false" hidden>Only my shortlist</button>
        ${features.length > activeCount ? html`<button type="button" class="chip" data-matrix-all aria-pressed="false">Show ${features.length - activeCount} checks not scored yet</button>` : ''}
      </div>
    </div>
    <div class="scroller" id="feature-evidence">
      <table class="dtable matrix" data-matrix data-category="${category.id}">
        <caption class="sr-only">${category.name}: documented capability status per product</caption>
        <thead>
          <tr>
            <th scope="col">Capability</th>
            ${ranked.map((v) => html`<th scope="col" data-v="${v.id}"><a href="${ctx.url.software(v.id)}">${ui.logo(ctx, v, { size: 'sm' })}<span>${v.name}</span></a></th>`)}
          </tr>
        </thead>
        <tbody>
          ${GROUP_ORDER.map((gid) => {
            const items = features.filter((f) => f.group === gid && f.active);
            if (!items.length) return '';
            return html`<tr class="is-group" data-g="${gid}"><th scope="colgroup" colspan="${ranked.length + 1}">${groupMeta[gid].label}</th></tr>${matrixRows(items)}`;
          })}
        </tbody>
      </table>
    </div>
    ${features.length > activeCount ? html`<p class="table-note">${ctx.scoring.LABELS.inactiveCheck.replace('this deep check has', `${features.length - activeCount} deep checks have`)} They stay listed so you can see what is already documented.</p>` : ''}
  </section>`;

  // ---------------------------------------------------------------- costs
  const cheapest = pf.priced.slice(0, 5);
  const costs = html`<section class="wrap section" id="costs" aria-labelledby="costs-h">
    ${ui.sectionHead(`How much does ${noun} cost?`, { id: 'costs-h' })}
    <div class="cat-two">
      <div class="prose">
        ${
          pf.priced.length >= 2
            ? html`<p>Among the ${pf.priced.length} ${things} with a verified public starting price, list prices range from <strong>${pf.min.p.headline} ${pf.min.p.unit}</strong> (${pf.min.v.name}) to <strong>${pf.max.p.headline} ${pf.max.p.unit}</strong> (${pf.max.v.name}). ${
                pf.unpriced ? `${ctx.plural(pf.unpriced, 'product')} ${pf.unpriced === 1 ? 'is' : 'are'} quote-only, usage-based or without a verified public price.` : ''
              } Units differ between vendors, so compare a full quote for the same team size.</p>`
            : html`<p>Most ${things} in this ranking do not publish a verified starting price for US buyers. Ask each vendor to quote the same scope, term and team size.</p>`
        }
        ${category.costDrivers?.length ? html`<h3>What drives the total cost</h3>${ui.ticks(category.costDrivers, 'dots')}` : ''}
        <p><a class="link-arrow" href="/tools/cost/?scope=${category.id}">Model your own costs in the calculator</a></p>
      </div>
      ${
        cheapest.length
          ? html`<div>
              <table class="dtable">
                <caption class="sr-only">Lowest verified public starting prices in ${category.name}</caption>
                <thead><tr><th scope="col">Lowest verified starting prices</th><th scope="col" class="num">From</th></tr></thead>
                <tbody>
                  ${cheapest.map(
                    ({ v, p }) => html`<tr><th scope="row"><a href="${ctx.url.software(v.id)}#pricing">${v.name}</a><small>${[p.plan && `${p.plan} plan`, p.unit, p.billingNote].filter(Boolean).join(' · ')}</small></th><td class="num">${p.headline}</td></tr>`,
                  )}
                </tbody>
              </table>
              <p class="table-note">Public list prices as observed on the dates shown on each profile. Not quotes; taxes and add-ons are excluded.</p>
            </div>`
          : ''
      }
    </div>
  </section>`;

  // ---------------------------------------------------------------- buying guide
  const guide = html`<section class="wrap section" id="buying-guide" aria-labelledby="guide-h">
    ${ui.sectionHead(`How to choose ${noun}`, { id: 'guide-h' })}
    <div class="cat-two">
      <div class="prose">
        ${category.intro ? String(category.intro).split(/\n\s*\n/).map((p) => html`<p>${p}</p>`) : ''}
        ${(category.buyingAdvice || []).map((b) => (typeof b === 'string' ? html`<p>${b}</p>` : html`<h3>${b.title}</h3><p>${b.body}</p>`))}
      </div>
      <div class="cat-aside">
        ${
          category.criteria?.length
            ? html`<h3>What to compare</h3>
                <ul class="cat-criteria">${category.criteria.map((c) => html`<li><b>${c.label}</b>${c.why ? html`<span>${c.why}</span>` : ''}</li>`)}</ul>`
            : ''
        }
        ${category.pitfalls?.length ? html`<h3>Common pitfalls</h3>${ui.ticks(category.pitfalls, 'crosses')}` : ''}
      </div>
    </div>
  </section>`;

  const demo = category.demoQuestions?.length
    ? html`<section class="wrap section" id="demo" aria-labelledby="demo-h">
        ${ui.sectionHead('Questions to ask in a demo', { id: 'demo-h', sub: 'Tasks to run with each vendor on your own data. We did not perform these tests.' })}
        <ol class="steps cat-demo">${category.demoQuestions.map((q) => html`<li>${q}</li>`)}</ol>
      </section>`
    : '';

  // ---------------------------------------------------------------- what the score measures
  const sampleScore = scoredList[0] ? ctx.score(category.id, scoredList[0].id) : ranked[0] ? ctx.score(category.id, ranked[0].id) : null;
  const activeGroups = sampleScore ? sampleScore.groups.filter((g) => g.totalCount > 0) : [];
  const pt = ctx.scoring.pointText;
  const criteria = html`<section class="wrap section" id="criteria" aria-labelledby="criteria-h">
    ${ui.sectionHead('What the score measures', { id: 'criteria-h', link: { href: '/methodology/', label: 'Full method' } })}
    <div class="cat-two">
      <div class="prose">
        <p>${ui.methodSentence(ctx)}</p>
        <p>In ${category.name}, ${activeCount} of ${features.length} checklist items are scored today${features.length > activeCount ? `; the other ${features.length - activeCount} are deep checks that join the score once they have been checked for every listed product` : ''}. Every product that shares the highest published score is marked “Recommended”.</p>
      </div>
      <div>
        <table class="dtable">
          <caption class="sr-only">Score groups and their weight in ${category.name}</caption>
          <thead><tr><th scope="col">Score group</th><th scope="col" class="num">Scored checks</th><th scope="col" class="num">Points</th></tr></thead>
          <tbody>
            ${activeGroups.map((g) => html`<tr><th scope="row">${g.label}</th><td class="num">${g.totalCount}</td><td class="num">${pt(g.weight)}</td></tr>`)}
          </tbody>
        </table>
        <p class="table-note">Published weights are core 45, integrations 20, local suitability 20 and AI 15. A group with no scored check is left out and the rest are scaled to 100.</p>
      </div>
    </div>
  </section>`;

  // ---------------------------------------------------------------- FAQ, comparisons, guides, sources, related
  const faq = html`<div class="wrap wrap--narrow section">${ui.faq(ctx, faqItems, { heading: `${category.name}: questions buyers ask` })}</div>`;

  const comparisons = vsPages.length
    ? html`<section class="wrap section" id="comparisons" aria-labelledby="vs-h">
        ${ui.sectionHead(`${category.name} head-to-head comparisons`, { id: 'vs-h', link: { href: `/compare/?scope=${category.id}`, label: 'Compare any products' } })}
        ${ui.linkList(
          vsPages.map((x) => {
            const names = ctx.comparisonNames(x);
            const scores = names.map((n) => ctx.score(category.id, n.id)).filter(Boolean);
            return { href: ctx.url.vs(x.id), title: names.map((n) => n.name).join(' vs '), meta: scores.length === 2 ? scores.map((sc) => (sc.pending ? 'pending' : sc.value)).join(' vs ') : '' };
          }),
          { cols: 2 },
        )}
      </section>`
    : '';

  const guidesBlock = guides.length
    ? html`<section class="wrap section" aria-labelledby="guides-h">
        ${ui.sectionHead('Buying guides', { id: 'guides-h' })}
        ${ui.linkList(guides.map((g) => ({ href: ctx.url.guide(g.id), title: g.title, sub: g.description })), { cols: 1 })}
      </section>`
    : '';

  const partnerBlock = partner
    ? html`<aside class="wrap section--tight" data-partner-ad data-nosnippet aria-label="Advertisement">
        <p class="note"><span class="tag tag--ad">Ad · Partner link</span><span>${partner.name} is an advertising partner and is not one of the ranked products above. <a class="ext" href="${partner.url}" target="_blank" rel="sponsored nofollow noopener noreferrer" data-partner-link="${partner.name}">${partner.label}</a> We may earn a commission; it never changes a score.</span></p>
      </aside>`
    : '';

  const sourcesBlock = category.sources?.length
    ? html`<section class="wrap section" id="sources" aria-labelledby="sources-h">
        ${ui.sectionHead('Sources', { id: 'sources-h', sub: 'Category-level references. Each product profile lists its own official sources.' })}
        ${ui.sources(category.sources)}
      </section>`
    : '';

  const relatedBlock = related.length
    ? html`<section class="wrap section" aria-labelledby="related-h">
        ${ui.sectionHead(`More in ${group.label}`, { id: 'related-h', link: { href: '/categories/', label: 'All categories' } })}
        ${ui.chipLinks(related.map((c) => ({ href: ctx.url.category(c.id), label: c.name })))}
      </section>`
    : '';

  return {
    title,
    description,
    ogTitle: `${noun}: ${s.total} tools compared`,
    nav: 'categories',
    breadcrumbs: [
      { name: 'Categories', url: '/categories/' },
      { name: category.name, url: path },
    ],
    pageType: 'CollectionPage',
    dateModified: updated,
    accountable: true,
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    jsonld: [
      ctx.seo.itemListNode(
        path,
        ranked.map((v) => ({ name: v.name, url: ctx.url.software(v.id) })),
        { name: `${category.name}: products ranked by documented-fit score` },
      ),
    ],
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#primary-list` }, about: { '@type': 'Thing', name: noun } },
    scripts: ['js/table.js'],
    body: html`${head}${nav}${products}${matrix}${costs}${guide}${demo}${criteria}${faq}${comparisons}${guidesBlock}${partnerBlock}${sourcesBlock}${relatedBlock}`,
  };
}
