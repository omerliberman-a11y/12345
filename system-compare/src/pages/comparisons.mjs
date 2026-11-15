// /comparisons/ — the comparison library: every published head-to-head on ONE line, grouped by the 10
// groups and then by category, with an instant filter. Scored pairs show both scores, documentary pairs
// say "Documented plans", the three editorial briefs say "Editorial". A pair is listed under its own
// category only (the checklist it was compared on).

import { html, text, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';
import { findField, categorySelect, synonymsFor, emptyState, groupShort, squeeze } from './categories.mjs';
import { loadAliases } from './software-index.mjs';

export function routes(ctx) {
  return [{ path: ctx.url.comparisons(), render }];
}

function render(ctx) {
  const path = ctx.url.comparisons();
  const live = ctx.liveHead(path) || {};
  const aliases = loadAliases(ctx);
  const all = ctx.comparisons;
  const total = all.length;
  const kindOf = (x) => ctx.comparisonKind(x);
  const count = { scored: 0, factual: 0, editorial: 0 };
  for (const x of all) count[kindOf(x)]++;

  /** One line per comparison. */
  const row = (x) => {
    const kind = kindOf(x);
    const names = ctx.comparisonNames(x);
    const pair = names.map((n) => n.name).join(' vs ');
    // Curated pages have their own title ("A vs B: what the comparison is about"): the part after the colon
    // becomes the second line. Documentary titles name the compared plans, so their first part is kept as
    // written; editorial briefs keep the vendor names (as on the live site), so every name stays findable.
    let title = pair;
    let sub = '';
    if (x.title) {
      const cut = x.title.indexOf(': ');
      if (kind === 'factual') title = cut > 0 ? x.title.slice(0, cut) : x.title;
      sub = cut > 0 ? x.title.slice(cut + 2) : '';
    }
    let label;
    let checked;
    if (kind === 'scored') {
      const scores = names.map((n) => ctx.score(x.categoryId, n.id));
      label = scores.map((s) => (s.pending ? 'pending' : s.value)).join(' vs ');
      // a pair is only as fresh as its older evidence date
      checked = scores.map((s) => s.checkedAt).filter(Boolean).sort()[0] || null;
    } else {
      label = kind === 'editorial' ? 'Editorial' : 'Documented plans';
      checked = x.checkedAt || null;
    }
    const terms = names.flatMap((n) => aliases[n.id] || []);
    return html`<li${attrs({ 'data-ix-row': true, 'data-kind': kind, 'data-k': terms.length ? terms.join('|') : null })}><a href="${ctx.url.vs(x.id)}"><span>${title}${sub ? html`<small>${sub}</small>` : ''}</span><span class="ix-vsmeta"><b>${label}</b>${checked ? ui.time(ctx, checked) : ''}</span></a></li>`;
  };

  const groups = ctx.groups
    .map((g) => ({
      group: g,
      categories: g.categories.map((c) => ({ category: c, items: ctx.comparisonsInCategory(c.id) })).filter((x) => x.items.length),
    }))
    .filter((g) => g.categories.length);
  const nCategories = groups.reduce((n, g) => n + g.categories.length, 0);
  const listed = groups.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.items.length, 0), 0);
  if (listed !== total) throw new Error(`comparisons: ${listed} listed, ${total} in the catalog`);

  const head = html`<header class="wrap page-head page-head--wide">
    <h1>Software comparisons</h1>
    <p class="lede">${total} head-to-head comparisons in ${nCategories} categories: ${count.scored} on one scored checklist, ${count.factual} of named plans from documented sources and ${count.editorial} editorial buying briefs.</p>
    ${ui.trustline(['Each pair shares one category and its criteria', 'Desk research, not hands-on testing', html`<a href="/methodology/">How we score</a>`])}
    <div class="ix-bar" data-ix-bar data-nosnippet>
      ${findField({ id: 'ix-find', label: 'Filter comparisons by product or category', placeholder: 'Type a product, e.g. HubSpot' })}
      ${categorySelect(ctx, { id: 'ix-category', items: groups.flatMap((g) => g.categories.map((c) => ({ category: c.category, count: c.items.length }))) })}
      <p class="toolbar__count" role="status" aria-live="polite" data-ix-count data-noun="comparisons"><b>${total}</b> comparisons</p>
    </div>
    <p class="ix-cta">Not listed? <a class="link-arrow" href="/compare/">Compare any two products</a></p>
  </header>`;

  const nav = ui.subnav(
    groups.map((g) => ({ href: `#${g.group.id}`, label: groupShort(g.group) })),
    { label: 'Category groups' },
  );

  const body = html`<div class="wrap ix-groups ix-cmp" data-ix="comparisons">
    ${groups.map(
      ({ group: g, categories }) => html`<section class="ix-group" id="${g.id}" aria-labelledby="${g.id}-h" data-ix-group>
        <div class="ix-group__head"><h2 id="${g.id}-h">${g.label}</h2><p>${g.blurb}</p></div>
        <div class="ix-cmp__cols">
          ${categories.map(
            ({ category: c, items }) => html`<div class="ix-cmp__cat" data-ix-cat="${c.id}">
              <h3><a href="${ctx.url.category(c.id)}">${c.name}</a></h3>
              <ul class="linklist">${items.map(row)}</ul>
            </div>`,
          )}
        </div>
      </section>`,
    )}
    ${emptyState('comparison')}
    <p class="table-note">Numbers are <a href="/methodology/">documented-fit scores</a> out of 100 on the category checklist, from official documentation checked on the date shown — not user ratings or hands-on tests. “pending” means less than 80% of the checklist weight has been checked for that product. “Documented plans” compares named plans from dated sources without a score. “Editorial” is a buying brief with its own sources.</p>
  </div>`;

  const faqItems = [
    {
      q: 'How many software comparisons are published?',
      a: `${total}, in ${nCategories} categories. ${count.scored} are score comparisons: two products on the same category checklist, each with its documented-fit score or “Score pending”. ${count.factual} are documented plan comparisons: named plans from two suppliers with dated official sources and no score. ${count.editorial} are editorial buying briefs.`,
    },
    {
      q: 'What does “92 vs pending” mean?',
      a: 'The first product has a published documented-fit score of 92 out of 100. The second is score-pending: less than 80% of the checklist weight has been checked against official sources, so no number is published for it yet. Pending is not a negative finding.',
    },
    {
      q: 'Can I compare two products that are not listed here?',
      a: 'Yes. The compare tool puts up to four products from the same category side by side on that category’s checklist, with scores, prices and sources.',
    },
  ];
  const faq = html`<section class="section ix-faq" aria-label="Questions about the comparisons">
    <div class="wrap wrap--narrow">
      ${ui.faq(ctx, faqItems, { heading: 'Questions about the comparisons', open: 0 })}
      <p class="ix-after"><a class="btn btn--ghost" href="/compare/">Compare any two products</a></p>
    </div>
  </section>`;

  const indexable = all.filter((x) => ctx.isIndexable(ctx.url.vs(x.id)));
  const categoryIds = groups.flatMap((g) => g.categories.map((c) => c.category.id));

  return {
    title: seoTitle(`Software comparisons: ${total} head-to-heads`),
    description: describe([
      `${total} side-by-side software comparisons for US buyers, grouped by category: scores on one published checklist, documented plans, pricing and sources.`,
      `${total} side-by-side software comparisons for US buyers, grouped by category, with scores, pricing and sources.`,
      live.description,
    ]),
    ogTitle: 'Software comparisons',
    nav: 'compare',
    breadcrumbs: [{ name: 'Comparisons', url: path }],
    pageType: 'CollectionPage',
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#primary-list` } },
    dateModified: ctx.isoDate(ctx.catalog.researchUpdatedAt),
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    jsonld: [
      ctx.seo.itemListNode(
        path,
        indexable.map((x) => ({ name: x.title || ctx.comparisonNames(x).map((n) => n.name).join(' vs '), url: ctx.url.vs(x.id) })),
        { name: 'Published software comparisons', ordered: false },
      ),
    ],
    scripts: ['js/directory.js'],
    pageData: { syn: synonymsFor(ctx, categoryIds) },
    body: squeeze(html`${head}${nav}${body}${faq}`),
  };
}
