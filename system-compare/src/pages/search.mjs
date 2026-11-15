// /search/?q= — full results page for the site search (the same engine as the header palette).
// Results are rendered in the browser; the query never leaves it. Without JavaScript the page still
// offers the category list.

import { html } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';

export function routes() {
  return [{ path: '/search/', render }];
}

function render(ctx) {
  const popular = ctx.site.home.featuredCategories.map((id) => ctx.category(id)).filter(Boolean);
  const body = html`<header class="wrap page-head">
      <h1>Search</h1>
      <div class="srch__field">${ui.searchField(ctx, { id: 'search-q', palette: false, placeholder: 'Search software, categories, comparisons…', autofocus: true })}</div>
      <p class="fineprint">Try a product (“HubSpot”), a need (“help desk”), a comparison (“Asana vs monday”), “QuickBooks alternatives”, “free email marketing” or “payroll under $50”. Searches run in your browser and are not sent anywhere.</p>
    </header>
    <div class="wrap srch" data-search-page>
      <div class="toolbar srch__bar" data-search-controls hidden>
        <div class="chips" role="group" aria-label="Result type" data-type-chips></div>
        <label class="toolbar__sort"><span class="sr-only">Sort products</span>
          <select class="select select--sm" data-search-sort aria-label="Sort products">
            <option value="">Sort: relevance</option>
            <option value="score">Sort: score</option>
            <option value="price">Sort: price, low to high</option>
          </select>
        </label>
      </div>
      <div class="chips srch__facets" role="group" aria-label="Filter products" data-search-facets hidden>
        <button type="button" class="chip" data-facet="scored" aria-pressed="false">Scored only</button>
        <button type="button" class="chip" data-facet="priced" aria-pressed="false">Public price</button>
        <button type="button" class="chip" data-facet="free" aria-pressed="false">Free entry price</button>
        <button type="button" class="chip" data-facet="ai" aria-pressed="false">Native AI or agents</button>
      </div>
      <p class="toolbar__count" role="status" aria-live="polite" data-search-status></p>
      <div class="srch__results" data-search-results></div>
      <section class="srch__start" data-search-start aria-labelledby="start-h">
        <h2 id="start-h">Start from a category</h2>
        ${ui.linkList(
          popular.map((c) => ({
            href: ctx.url.category(c.id),
            title: c.name,
            meta: ctx.isFactual(c) ? `${c.factual.suppliers.length} suppliers` : `${ctx.summary(c.id).total} products`,
          })),
          { cols: 2 },
        )}
        <p class="srch__all"><a class="link-arrow" href="/categories/">All ${ctx.categories.length} categories</a> · <a class="link-arrow" href="/software/">Software directory</a> · <a class="link-arrow" href="/comparisons/">Comparison library</a></p>
      </section>
      <noscript><p class="note">Search needs JavaScript. You can browse <a href="/categories/">all categories</a>, the <a href="/software/">software directory</a> or the <a href="/comparisons/">comparison library</a>.</p></noscript>
    </div>`;

  return {
    title: 'Search software, categories and comparisons | System Compare',
    description: `Search ${ctx.vendors.length} product profiles, ${ctx.categories.length} categories, ${ctx.comparisons.length} comparisons and ${ctx.guides.length} buying guides on System Compare US.`,
    ogTitle: 'Search System Compare',
    breadcrumbs: [{ name: 'Search', url: '/search/' }],
    pageType: 'SearchResultsPage',
    scripts: ['js/search-page.js'],
    body,
  };
}
