// /shortlist/ — the saved products as rows of the ranked table, with private notes, compare, share, CSV and print.
// Everything on this page comes from this browser's localStorage, so the list itself is rendered by
// js/shortlist.js; the static HTML carries the heading, the storage rule, the empty state and a no-JS note.

import { html } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes() {
  return [{ path: '/shortlist/', render }];
}

const POPULAR = ['crm', 'email-marketing', 'accounting', 'payroll', 'customer-service', 'project-management'];

function render(ctx) {
  const pagePath = '/shortlist/';
  const live = ctx.liveHead(pagePath) || {};
  const title = seoTitle('Your shortlist') || live.title;
  const description = describe([
    'The products you saved in this browser: scores, starting prices and your private notes. Compare them, copy a share link or export a CSV. No account.',
    live.description,
  ]);
  const popular = POPULAR.map((id) => ctx.category(id)).filter(Boolean);

  const body = html`<header class="wrap page-head">
      <h1>Your shortlist</h1>
      <p class="lede">Saved in this browser only, with no account: the shortlist expires 180 days after your last change, and your notes stay until you delete them.</p>
    </header>

    <div class="wrap tl-sl" data-shortlist-app data-state="loading" data-scored="${ctx.scoredCategories.map((c) => c.id).join(' ')}">
      <noscript>
        <p class="note">Your shortlist is stored in this browser and needs JavaScript to be shown. You can still <a href="/categories/">browse the categories</a> or <a href="/compare/">open the comparison builder</a>.</p>
      </noscript>
      <p class="tl-sl__status" role="status" aria-live="polite" data-sl-status>Loading your saved products…</p>

      <section class="tl-sl__list" data-sl-list aria-labelledby="sl-h" hidden>
        <div class="tl-sl__head">
          <div>
            <h2 id="sl-h" data-sl-title>Saved products</h2>
            <p data-sl-sub></p>
          </div>
          <div class="tl-sl__actions" data-nosnippet>
            <a class="btn" href="/compare/" data-sl-compare>Compare</a>
            <a class="btn btn--ghost" href="/tools/cost/" data-sl-cost>Compare costs</a>
            <button type="button" class="btn btn--ghost" data-sl-share>${ui.icon('share')}Copy share link</button>
            <button type="button" class="btn btn--ghost" data-sl-csv>Export CSV</button>
            <button type="button" class="btn btn--ghost" data-sl-print>Print</button>
          </div>
        </div>
        <div data-sl-table></div>
        ${ui.tableNote(ctx)}
        <p class="tl-sl__clear" data-nosnippet>
          <button type="button" class="btn btn--quiet" data-sl-clear>Clear shortlist</button>
          <button type="button" class="btn btn--quiet" data-sl-clear-all>Clear shortlist and notes</button>
        </p>
      </section>

      <section class="tl-sl__empty" data-sl-empty aria-labelledby="sl-empty-h">
        <h2 id="sl-empty-h">Nothing saved yet</h2>
        <p>Tick the box next to a product in any ranking, or choose “Add to shortlist” on a product page. A shortlist holds up to four products from one category, so you can compare them side by side, keep private notes and share the comparison with a link.</p>
        <p class="tl-sl__label">Start with a popular category</p>
        ${ui.chipLinks(popular.map((c) => ({ href: ctx.url.category(c.id), label: c.name })))}
        <p class="tl-sl__search">
          <a class="btn btn--ghost" href="/search/" data-search-open role="button">${ui.icon('search')}Search software</a>
          <a class="btn btn--quiet" href="/categories/">All ${ctx.categories.length} categories</a>
        </p>
      </section>

      <section class="tl-sl__other" data-sl-other aria-labelledby="sl-other-h" hidden>
        <h2 id="sl-other-h">Other notes</h2>
        <p class="tl-sl__othersub">Notes you wrote for products that are not in the shortlist right now. They stay in this browser until you delete them.</p>
        <div data-sl-other-list></div>
        <p class="tl-sl__clear" data-nosnippet><button type="button" class="btn btn--quiet" data-sl-clear-notes>Delete these notes</button></p>
      </section>

      <p class="fineprint tl-sl__fine">Notes are private to this browser and are never published; avoid recording sensitive information. Clearing your shortlist or notes does not change your analytics choice. <a href="/privacy/">Privacy choices and storage</a></p>
    </div>`;

  return {
    title,
    description,
    nav: 'shortlist',
    breadcrumbs: [{ name: 'Shortlist', url: pagePath }],
    pageType: 'WebPage',
    scripts: ['js/shortlist.js'],
    body,
  };
}
