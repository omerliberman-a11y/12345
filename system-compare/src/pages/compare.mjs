// /compare/ — the compare tool. The page is a shell: js/compare.js reads ?scope=&a=&b=&c=&d= and renders the
// same comparison component the /vs/ pages use (see vs.mjs and pages/compare.css) from /data/cat-<id>.js.
// With no selection it shows a picker (category → products), never a default pair.
//
// The category list of the picker is server-rendered (hidden until the script decides which state to show),
// so the script needs no extra data file for step 1 and the links exist in the HTML.

import { html } from '../lib/html.mjs';

export function routes() {
  return [{ path: '/compare/', render }];
}

function render(ctx) {
  const groups = ctx.groups
    .map((g) => ({ ...g, scored: g.categories.filter((c) => !ctx.isFactual(c)) }))
    .filter((g) => g.scored.length);
  const scoredCount = ctx.scoredCategories.length;
  // published head-to-head pages per category ("a-vs-b" ids) so the tool can link a chosen pair to its page
  const pairs = (category) =>
    ctx
      .comparisonsInCategory(category.id)
      .filter((x) => ctx.comparisonKind(x) !== 'factual' && x.vendorIds?.length === 2)
      .map((x) => x.id)
      .join(' ');

  const body = html`<header class="wrap page-head page-head--wide">
      <h1 data-cmp-title>Compare software side by side</h1>
      <p class="lede" data-cmp-lede>Choose a category, then two to four products. You get one table on the same checklist: documented-fit scores, prices, every capability check with its official source, and the checks where the products differ. Nothing is preselected for you, and every comparison has its own link to share.</p>
    </header>
    <div data-cmp-mount></div>
    <section class="wrap cmp-picker" data-cmp-picker aria-labelledby="cmp-pick-h" hidden>
      <div data-cmp-saved></div>
      <div class="cmp-picker__head">
        <h2 id="cmp-pick-h"><span class="cmp-stepno">1</span>Choose a category</h2>
        <div class="cmp-find">
          <label class="sr-only" for="cmp-q">Filter the ${scoredCount} scored categories</label>
          <input class="input" id="cmp-q" type="search" autocomplete="off" spellcheck="false" placeholder="Filter ${scoredCount} categories" data-cmp-filter>
        </div>
      </div>
      <div class="cmp-cats" data-cmp-cats>
        ${groups.map(
          (g) => html`<div class="cmp-cats__group" data-group>
            <h3>${g.label}</h3>
            <ul>
              ${g.scored.map(
                (c) => html`<li><a href="/compare/?scope=${c.id}" data-scope="${c.id}" data-vs="${pairs(c)}"><span>${c.name}</span><span class="n">${ctx.summary(c.id).total} products</span></a></li>`,
              )}
            </ul>
          </div>`,
        )}
      </div>
      <p class="empty" data-cmp-nocat hidden><b>No category matches.</b>Try a shorter word, or browse <a href="/categories/">all categories</a>.</p>
      <p class="fineprint cmp-picker__note">Products are compared inside one category because every category has its own checklist. Documentary categories (AI tools and some business software) have no scores yet; their suppliers are compared on the <a href="/categories/">category pages</a>. Ready-made head-to-heads are in the <a href="/comparisons/">comparison library</a>.</p>
    </section>
    <noscript>
      <div class="wrap cmp-noscript">
        <p class="note">The compare tool needs JavaScript. Without it, every category page below has the full ranked table and capability matrix, and the <a href="/comparisons/">comparison library</a> lists the ready-made head-to-heads.</p>
        <ul class="linklist linklist--3">
          ${ctx.scoredCategories.map((c) => html`<li><a href="${ctx.url.category(c.id)}"><span>${c.name}</span><span>${ctx.summary(c.id).total} products</span></a></li>`)}
        </ul>
      </div>
    </noscript>`;

  return {
    title: 'Compare software side by side | System Compare US',
    description: 'Choose products in the same category and compare documented capabilities, plans and AI using one published method.',
    ogTitle: 'Compare software side by side',
    nav: 'compare',
    breadcrumbs: [{ name: 'Compare', url: '/compare/' }],
    pageType: 'WebPage',
    scripts: ['js/compare.js'],
    body,
  };
}
