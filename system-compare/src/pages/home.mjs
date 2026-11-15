// Home: one search, top documented fit per popular category, browse by group, comparisons, guides, FAQ.

import { html, raw, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { siteFaq } from '../lib/site-faq.mjs';

export function routes(ctx) {
  return [{ path: '/', render }];
}

function render(ctx) {
  const A = ctx.answers;
  const { site } = ctx;
  const live = ctx.liveHead('/') || {};

  // Category previews follow the published method (/methodology/, "Category previews …"): catalogue order,
  // only categories with at least two scored products, and a later category is skipped when one of its tied
  // leaders already leads an earlier preview. Rows are scored products only and a tie is never cut apart.
  const leadersSeen = new Set();
  const spotlights = [];
  for (const c of ctx.scoredCategories) {
    const s = ctx.summary(c.id);
    if (s.scored < 2 || s.recommended.some((v) => leadersSeen.has(v.id))) continue;
    s.recommended.forEach((v) => leadersSeen.add(v.id));
    spotlights.push(c);
    if (spotlights.length === 6) break;
  }

  const totalSuppliers = ctx.factualCategories.reduce((n, c) => n + (c.factual?.suppliers?.length || 0), 0);
  const indexableVs = ctx.comparisons.filter((c) => ctx.isIndexable(ctx.url.vs(c.id)));
  // Popular head-to-heads: one or two per spotlight category (scored pairs with a real difference first).
  const popular = [];
  for (const c of spotlights) {
    const inCat = ctx.comparisonsInCategory(c.id).filter((x) => ctx.comparisonKind(x) !== 'factual');
    for (const x of inCat.slice(0, 2)) popular.push(x);
  }
  for (const x of indexableVs) if (popular.length < 12 && !popular.includes(x)) popular.push(x);

  const faqGroups = siteFaq(ctx);
  const homeFaq = faqGroups.flatMap((g) => g.items).filter((i) => i.home);

  const hero = html`<section class="hero">
    <div class="wrap">
      <h1>Find the right software.<br><span>Know the trade&#8209;offs.</span></h1>
      <p class="lede">Compare capabilities, prices and limits side by side. Every claim links to a dated official source — research, not star ratings.</p>
      <div class="hero__search">
        ${ui.searchField(ctx, { id: 'hero-q', placeholder: 'Search software or a category' })}
      </div>
      <p class="hero__try" data-nosnippet>Try
        <button type="button" data-search-open data-query="HubSpot vs Salesforce">HubSpot vs Salesforce</button> ·
        <button type="button" data-search-open data-query="QuickBooks alternatives">QuickBooks alternatives</button> ·
        <button type="button" data-search-open data-query="free email marketing">free email marketing</button>
      </p>
      <div class="hero__chips">
        <span class="hero__chips-label">Popular</span>
        ${ui.chipLinks(
          site.home.featuredCategories.filter((id) => ctx.category(id)).slice(0, 6).map((id) => ({ href: ctx.url.category(id), label: ctx.category(id).name })),
        )}
      </div>
      <p class="hero__proof">
        <span><b class="num">${ctx.vendors.length}</b> product profiles</span>
        <span><b class="num">${ctx.categories.length}</b> categories</span>
        <span><b class="num">${ctx.comparisons.length}</b> head-to-head comparisons</span>
        <span><b class="num">${ctx.guides.length}</b> buying guides</span>
      </p>
    </div>
  </section>`;

  const topPicks = html`<section class="section" aria-labelledby="top-h">
    <div class="wrap">
      ${ui.sectionHead('Highest documented fit, by category', {
        id: 'top-h',
        sub: 'The highest scores in each category; products with the same score are shown together. A score is the share of the category checklist documented in official sources.',
      })}
      <div class="tabs" data-tabs>
        <div class="seg tabs__list" role="tablist" aria-label="Category">
          ${spotlights.map(
            (c, i) => html`<button type="button" role="tab" id="tab-${c.id}" aria-controls="panel-${c.id}" aria-selected="${i === 0 ? 'true' : 'false'}"${raw(i === 0 ? '' : ' tabindex="-1"')}>${c.name}</button>`,
          )}
        </div>
        ${spotlights.map((c, i) => {
          const s = ctx.summary(c.id);
          const scored = s.ranked.filter((v) => !s.results.get(v.id).isPending);
          const rows = ctx.topWithTies(c.id, scored, 5).map((vendor) => ({ vendor }));
          return html`<div class="tabs__panel" role="tabpanel" id="panel-${c.id}" aria-labelledby="tab-${c.id}"${raw(i === 0 ? '' : ' hidden')}>
            ${ui.productTable(ctx, c.id, rows, { id: `top-${c.id}`, sortable: false, lazyFrom: i === 0 ? 5 : 0, caption: `${c.name}: the ${rows.length} highest documented-fit scores` })}
            <p class="tabs__more"><a class="link-arrow" href="${ctx.url.category(c.id)}">See all ${s.total} ${A.categoryThings(c)}</a></p>
          </div>`;
        })}
      </div>
      ${ui.tableNote(ctx)}
    </div>
  </section>`;

  const browse = html`<section class="section section--tint" aria-labelledby="browse-h">
    <div class="wrap">
      ${ui.sectionHead('Browse by what your business needs', { id: 'browse-h', link: { href: '/categories/', label: `All ${ctx.categories.length} categories` } })}
      <div class="groups">
        ${ctx.groups.map(
          (g) => html`<div class="groups__item">
            <h3><a href="/categories/#${g.id}">${g.label}</a></h3>
            <p>${g.blurb}</p>
            <ul>
              ${g.categories.map((c) => html`<li><a href="${ctx.url.category(c.id)}">${c.name}</a></li>`)}
            </ul>
          </div>`,
        )}
      </div>
    </div>
  </section>`;

  const comparisons = html`<section class="section" aria-labelledby="vs-h">
    <div class="wrap">
      ${ui.sectionHead('Popular head-to-head comparisons', { id: 'vs-h', link: { href: '/comparisons/', label: `All ${ctx.comparisons.length} comparisons` } })}
      ${ui.linkList(
        popular.slice(0, 12).map((x) => ({
          href: ctx.url.vs(x.id),
          title: ctx.comparisonNames(x).map((n) => n.name).join(' vs '),
          meta: ctx.category(x.categoryId).name,
        })),
        { cols: 3 },
      )}
      <p class="home__cta"><a class="btn btn--ghost" href="/compare/">Build your own comparison</a></p>
    </div>
  </section>`;

  const method = html`<section class="section section--tint" aria-labelledby="how-h">
    <div class="wrap">
      ${ui.sectionHead('Research you can check', {
        id: 'how-h',
        sub: 'No customer star ratings and no pay-to-rank. One published method, applied the same way to every vendor.',
        link: { href: '/methodology/', label: 'How we score' },
      })}
      <ol class="how">
        <li><h3>Official sources, dated</h3><p>Capabilities and prices come from vendor documentation and pricing pages. Each claim keeps its source link and the date we read it.</p></li>
        <li><h3>One checklist per category</h3><p>Every product in a category is checked against the same list. The score is the documented share of that list, out of 100.</p></li>
        <li><h3>Gaps stay visible</h3><p>Not verified is not the same as not supported. Until 80% of the checklist is checked, a product shows “Score pending” instead of a number.</p></li>
      </ol>
    </div>
  </section>`;

  const guides = html`<section class="section" aria-labelledby="guides-h">
    <div class="wrap">
      ${ui.sectionHead('Buying guides', { id: 'guides-h', link: { href: '/guides/', label: `All ${ctx.guides.length} guides` } })}
      ${ui.linkList(
        ctx.guides
          .filter((g) => ctx.isIndexable(ctx.url.guide(g.id)))
          .slice(0, 6)
          .map((g) => ({ href: ctx.url.guide(g.id), title: g.title, sub: ui.time(ctx, g.checkedAt) ? html`Sources checked ${ui.time(ctx, g.checkedAt)}` : '' })),
        { cols: 2 },
      )}
    </div>
  </section>`;

  const faq = html`<section class="section" aria-label="Frequently asked questions">
    <div class="wrap wrap--narrow">
      ${ui.faq(ctx, homeFaq, { heading: 'Frequently asked questions', open: 1 })}
      <p class="home__cta"><a class="link-arrow" href="/faq/">All questions and answers</a></p>
    </div>
  </section>`;

  const leaders = spotlights.map((c) => ({ name: c.name, url: ctx.url.category(c.id) }));

  return {
    title: live.title || 'Compare business software in the US | System Compare US',
    description:
      live.description ||
      'Compare business software for the United States. Source-backed capabilities, pricing context, AI research and documented-fit comparisons.',
    ogTitle: 'Compare business software in the US',
    body: html`${hero}${topPicks}${browse}${comparisons}${method}${guides}${faq}`,
    hideCrumbs: true,
    fullOrg: true,
    bodyAttrs: { 'data-hero-search': '' },
    dateModified: ctx.isoDate(ctx.catalog.researchUpdatedAt),
    faq: homeFaq.map((f) => ({ q: f.q, a: text(f.a) })),
    jsonld: [ctx.seo.itemListNode('/', leaders, { name: 'Popular software categories', ordered: false })],
    pageExtra: { about: { '@id': ctx.seo.SITE_ID } },
    summaryForSearch: `${ctx.vendors.length} products, ${totalSuppliers} documented suppliers`,
  };
}
