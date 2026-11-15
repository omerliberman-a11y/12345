// /categories/ — every category on one page: an instant filter, a sticky jump row of the 10 groups and
// dense rows (never tiles) that say what a buyer needs to pick: how many products, and who leads.
//
// The small view helpers exported here (findField, categorySelect, groupShort …) are shared by the other
// "find it" pages: software-index.mjs, comparisons.mjs and alternatives.mjs.

import { html, raw, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes(ctx) {
  return [{ path: ctx.url.categories(), render }];
}

// ------------------------------------------------------------------ shared helpers for the index pages
/** Short group names for the sticky jump row (the full label is the section heading). */
const GROUP_SHORT = {
  'sales-support': 'Sales & service',
  marketing: 'Marketing',
  finance: 'Finance',
  hr: 'HR & people',
  commerce: 'Commerce',
  work: 'Work & data',
  'it-security': 'IT & security',
  'ai-assistants': 'AI assistants',
  'ai-creative': 'AI creative',
  'ai-builders': 'AI for builders',
};
export const groupShort = (group) => GROUP_SHORT[group.id] || group.label;

/** Instant filter input. directory.js binds to [data-ix-find]; without JavaScript it is simply not shown. */
export const findField = ({ id, label, placeholder }) =>
  html`<label class="ix-find" for="${id}">${ui.icon('search')}<span class="sr-only">${label}</span><input class="input" id="${id}" type="search" maxlength="120" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="${placeholder}" data-ix-find></label>`;

/** Category <select> grouped by the 10 groups. `items` = [{ category, count }] (only these are listed). */
export function categorySelect(ctx, { id, label = 'Category', all = 'All categories', items }) {
  const byId = new Map(items.map((it) => [it.category.id, it]));
  return html`<label class="ix-select"><span class="sr-only">${label}</span>
    <select class="select" id="${id}" data-ix-category aria-label="${label}">
      <option value="">${all}</option>
      ${ctx.groups.map((g) => {
        const inGroup = g.categories.filter((c) => byId.has(c.id));
        if (!inGroup.length) return '';
        return html`<optgroup label="${g.label}">${inGroup.map((c) => html`<option value="${c.id}">${c.name}${byId.get(c.id).count != null ? ` (${byId.get(c.id).count})` : ''}</option>`)}</optgroup>`;
      })}
    </select>
  </label>`;
}

/** Search synonyms for a set of category ids, as one lower-case string per category (for page.pageData). */
export function synonymsFor(ctx, categoryIds) {
  const out = {};
  for (const id of categoryIds) {
    const list = ctx.content.synonyms[id];
    if (list && list.length) out[id] = list.join('|');
  }
  return out;
}

/**
 * Drops the template indentation between tags (never inside text). The index pages print hundreds of rows,
 * so this is a fifth of their weight; markup separated only by a line break is always block or flex here.
 */
export const squeeze = (fragment) => raw(String(fragment).replace(/>\s*\n\s*</g, '><'));

/** "No match" block shared by the index pages; directory.js fills in the site-search link. */
export const emptyState = (what) =>
  html`<p class="empty" data-ix-empty hidden><b>No ${what} matches.</b><span data-ix-empty-text>Try a shorter word or clear the filter.</span> <button type="button" class="btn btn--quiet btn--sm" data-ix-reset>Clear filter</button> <a class="btn btn--quiet btn--sm" href="/search/" data-ix-sitesearch>Search the whole site</a></p>`;

/** The trust strip used on the three index pages. */
export const indexTrustline = (ctx, extra = []) =>
  ui.trustline([html`Evidence checked ${ui.time(ctx, ctx.catalog.checkedAt)}`, ...extra, 'Desk research, not hands-on testing', html`<a href="/methodology/">How we score</a>`]);

// ------------------------------------------------------------------ page
function render(ctx) {
  const path = ctx.url.categories();
  const live = ctx.liveHead(path) || {};
  const total = ctx.categories.length;
  const nScored = ctx.scoredCategories.length;
  const nFactual = ctx.factualCategories.length;
  const nSuppliers = ctx.factualCategories.reduce((n, c) => n + (c.factual?.suppliers?.length || 0), 0);

  /** One row per category: name, what leads it, and how much is in it. */
  const row = (c) => {
    if (ctx.isFactual(c)) {
      const suppliers = c.factual?.suppliers || [];
      return {
        id: c.id,
        href: ctx.url.category(c.id),
        title: c.name,
        sub: `Documented comparison: ${suppliers.map((s) => s.name).join(', ')}`,
        meta: ctx.plural(suppliers.length, 'supplier'),
      };
    }
    const s = ctx.summary(c.id);
    const rec = s.recommended;
    const top = rec.length ? ctx.score(c.id, rec[0].id).value : null;
    // every product that shares the highest published score leads; name up to three, count the rest
    const sub = !rec.length ? 'Scores pending' : rec.length <= 3 ? `Top fit ${top}/100: ${ctx.listText(rec.map((v) => v.name))}` : `Top fit ${top}/100: ${rec.length} products tied`;
    return { id: c.id, href: ctx.url.category(c.id), title: c.name, sub, meta: ctx.plural(s.total, 'product') };
  };

  const head = html`<header class="wrap page-head page-head--wide">
    <h1>Software categories</h1>
    <p class="lede">${total} categories in ${ctx.groups.length} groups: ${nScored} scored rankings covering ${ctx.vendors.length} products, and ${nFactual} documented comparisons covering ${nSuppliers} suppliers.</p>
    ${indexTrustline(ctx)}
    <div class="ix-bar" data-ix-bar data-nosnippet>
      ${findField({ id: 'ix-find', label: `Filter ${total} categories by name, task or product`, placeholder: `Filter ${total} categories` })}
      <p class="toolbar__count" role="status" aria-live="polite" data-ix-count data-noun="categories"><b>${total}</b> categories</p>
    </div>
  </header>`;

  const nav = ui.subnav(
    ctx.groups.map((g) => ({ href: `#${g.id}`, label: groupShort(g) })),
    { label: 'Category groups' },
  );

  const groups = html`<div class="wrap ix-groups ix-cats" data-ix="categories">
    ${ctx.groups.map(
      (g) => html`<section class="ix-group" id="${g.id}" aria-labelledby="${g.id}-h" data-ix-group>
        <div class="ix-group__head"><h2 id="${g.id}-h">${g.label}</h2><p>${g.blurb}</p></div>
        <ul class="linklist linklist--3">
          ${g.categories.map((c) => {
            const r = row(c);
            return html`<li data-ix-row data-id="${r.id}"><a href="${r.href}"><span>${r.title}<small>${r.sub}</small></span><span>${r.meta}</span></a></li>`;
          })}
        </ul>
      </section>`,
    )}
    ${emptyState('category')}
    <p class="table-note">“Top fit” is the highest <a href="/methodology/">documented-fit score</a> in the category, out of 100: the share of that category’s checklist documented in official sources as of ${ui.time(ctx, ctx.catalog.checkedAt)}. It is not a customer rating or a hands-on test. “Scores pending” means no product has 80% of the checklist weight checked yet. Documented comparisons carry no score.</p>
  </div>`;

  const faqItems = [
    {
      q: 'How many software categories does System Compare cover?',
      a: `${total} categories in ${ctx.groups.length} groups. ${nScored} are scored categories, where ${ctx.vendors.length} products are checked against one checklist per category and ranked by documented-fit score. ${nFactual} are documented comparisons, where named plans from ${nSuppliers} suppliers are set side by side with dated official sources and no score is assigned.`,
    },
    {
      q: 'What is the difference between a scored category and a documented comparison?',
      a: 'In a scored category every product is checked against the same checklist and gets a documented-fit score out of 100, or “Score pending” until 80% of the checklist weight has been checked. A documented comparison is unranked: it compares named plans from a small set of suppliers using dated official sources, and no /100 score is assigned.',
    },
    {
      q: 'What does “Top fit” mean on this page?',
      a: 'It names the product with the highest documented-fit score in that category. Every product that shares the highest score counts, so a category can show several products tied. The score describes how much of the category checklist is documented in official sources; it is not a customer rating and no vendor pays for placement.',
    },
  ];
  // a plain wrapper: the FAQ inside is already a section labelled by its own heading (one landmark, one name)
  const faq = html`<div class="section ix-faq">
    <div class="wrap wrap--narrow">
      ${ui.faq(ctx, faqItems, { heading: 'Questions about the categories', open: 0 })}
      <p class="ix-after"><a class="link-arrow" href="/faq/">All questions and answers</a></p>
    </div>
  </div>`;

  const more = html`<section class="section" aria-labelledby="ix-more-h">
    <div class="wrap">
      ${ui.sectionHead('Other ways to find software', { id: 'ix-more-h' })}
      ${ui.linkList(
        [
          { href: '/software/', title: 'Software directory', sub: `All ${ctx.vendors.length} product profiles, A–Z, with filters` },
          { href: '/comparisons/', title: 'Software comparisons', sub: `${ctx.comparisons.length} head-to-head comparisons by category` },
          { href: '/guides/', title: 'Buying guides', sub: `${ctx.guides.length} guides with dated sources` },
        ],
        { cols: 3 },
      )}
    </div>
  </section>`;

  // Hidden match terms for the filter: synonyms per category and the product names inside scored categories.
  const pageData = {
    syn: synonymsFor(ctx, ctx.categories.map((c) => c.id)),
    products: Object.fromEntries(ctx.scoredCategories.map((c) => [c.id, ctx.summary(c.id).ranked.map((v) => v.name).join('|')])),
  };

  // the list follows the order on the page (group by group)
  const indexable = ctx.groups.flatMap((g) => g.categories).filter((c) => ctx.isIndexable(ctx.url.category(c.id)));

  return {
    title: seoTitle(`Business software categories: ${total} compared`),
    description: describe([
      `Browse ${total} US business software categories by workflow: ${nScored} scored rankings and ${nFactual} documented comparisons, with dated official sources.`,
      live.description,
    ]),
    ogTitle: 'Business software categories',
    nav: 'categories',
    breadcrumbs: [{ name: 'Categories', url: path }],
    pageType: 'CollectionPage',
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#primary-list` } },
    dateModified: ctx.isoDate(ctx.catalog.researchUpdatedAt),
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    jsonld: [
      ctx.seo.itemListNode(
        path,
        indexable.map((c) => ({ name: c.name, url: ctx.url.category(c.id) })),
        { name: 'Business software categories', ordered: false },
      ),
    ],
    scripts: ['js/directory.js'],
    pageData,
    body: squeeze(html`${head}${nav}${groups}${faq}${more}`),
  };
}
