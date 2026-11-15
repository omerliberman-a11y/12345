// Buying guides: the index (/guides/) and one reading page per catalog guide (/guides/{id}/).
// Every word of a guide comes from catalog.guides[]; only the short <title> lives in
// data/content/guide-seo-titles.json. "Key takeaways" and "Next steps" are derived from the same data.

import { html, raw, cx, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes(ctx) {
  return [
    { path: ctx.url.guides(), render: renderIndex },
    ...ctx.guides.map((guide) => ({ path: ctx.url.guide(guide.id), render: (c) => renderGuide(c, guide) })),
  ];
}

// ------------------------------------------------------------------ shared helpers (also used by research-updates.mjs)

/**
 * Tiny instant filter, inlined on the two list pages (no data, no innerHTML).
 * Markup contract: [data-gd-filter] holds chips [data-gd-chip="<tag>"] ("" = all); rows carry
 * data-gd-tags="a b c"; groups [data-gd-sec] hide when they have no visible row; [data-gd-n] shows the count.
 * Chips may be links to the group heading, so the list is still navigable without JavaScript.
 */
const FILTER_JS = `(function(){var d=document,box=d.querySelector('[data-gd-filter]');if(!box)return;
var all=function(s,r){return [].slice.call((r||d).querySelectorAll(s))},chips=all('[data-gd-chip]',box),rows=all('[data-gd-tags]'),secs=all('[data-gd-sec]'),n=d.querySelector('[data-gd-n]'),useHash=box.hasAttribute('data-gd-hash');
box.hidden=false;
function apply(v){var c=0;rows.forEach(function(r){var on=!v||(' '+r.getAttribute('data-gd-tags')+' ').indexOf(' '+v+' ')>-1;r.hidden=!on;if(on)c++});
secs.forEach(function(s){s.hidden=!s.querySelector('[data-gd-tags]:not([hidden])')});
chips.forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-gd-chip')===v?'true':'false')});
if(n)n.textContent=c}
chips.forEach(function(b){if(b.tagName==='A')b.setAttribute('role','button');
b.addEventListener('click',function(e){e.preventDefault();var v=b.getAttribute('data-gd-chip');apply(v);
if(useHash&&history.replaceState)history.replaceState(null,'',v?'#'+v:location.pathname+location.search)});
b.addEventListener('keydown',function(e){if(e.key===' '&&b.tagName==='A'){e.preventDefault();b.click()}})});
var h=useHash?decodeURIComponent(location.hash.slice(1)):'';
apply(chips.some(function(b){return h&&b.getAttribute('data-gd-chip')===h})?h:'')})();`;
export const filterScript = () => html`<script>${raw(FILTER_JS)}</script>`;

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const firstSentence = (s) => (String(s || '').match(/^[\s\S]*?[.!?](?=\s|$)/) || [String(s || '')])[0].trim();
const paragraphs = (body) => String(body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const wordCount = (guide) =>
  guide.sections.reduce((n, s) => n + s.body.split(/\s+/).filter(Boolean).length + (s.bullets || []).join(' ').split(/\s+/).filter(Boolean).length, 0);
const readMinutes = (guide) => Math.max(1, Math.round(wordCount(guide) / 200));

/** Stored image path → the file we ship (the two 1.9 MB PNG heroes were re-encoded to WebP at the same size). */
const REENCODED = new Set(['/assets/articles/crm-clean-data.png', '/assets/articles/email-ready-to-send.png']);
const imageSrc = (src) => (REENCODED.has(src) ? src.replace(/\.png$/, '.webp') : src);
const imageType = (src) => (/\.webp$/.test(src) ? 'image/webp' : /\.png$/.test(src) ? 'image/png' : 'image/jpeg');

/** A cited source that points at this site opens in the same tab as a normal internal link. */
function sourceList(ctx, sources) {
  const origin = ctx.site.origin;
  return html`<ol class="sources">
    ${sources.map((s) => {
      const internal = s.url.startsWith(origin + '/');
      return internal
        ? html`<li><a href="${s.url.slice(origin.length)}">${s.label}</a></li>`
        : html`<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.label}</a></li>`;
    })}
  </ol>`;
}

/**
 * Key takeaways: one line per section — its first bullet, or its first sentence when the section has no
 * bullets. Checklist guides number their steps ("1. …"); there the numbered steps are the takeaways.
 * More than five candidates are thinned to five, evenly spread, first and last kept.
 */
function takeaways(sections) {
  let pool = sections.filter((s) => s.bullets?.length || s.body);
  const numbered = pool.filter((s) => /^\d+\.\s/.test(s.heading));
  if (numbered.length >= 3) pool = numbered;
  if (pool.length > 5) {
    const pickAt = [0, 1, 2, 3, 4].map((i) => Math.round((i * (pool.length - 1)) / 4));
    pool = pool.filter((_, i) => pickAt.includes(i));
  }
  return pool.map((s) => ({ section: s, text: s.bullets?.length ? s.bullets[0] : firstSentence(s.body) }));
}

// One extra onward link that the previous site hard-coded on the messaging guide ("Put the guide to work").
const EXTRA_NEXT = { 'us-messaging-stack-buying-guide': ['crm'] };

// ------------------------------------------------------------------ guide page
function renderGuide(ctx, guide) {
  const A = ctx.answers;
  const path = ctx.url.guide(guide.id);
  const shortTitle = ctx.content.guideSeoTitles[guide.id] || guide.title;
  const cats = (guide.categoryIds || []).map((id) => ctx.category(id)).filter(Boolean);
  const primary = cats[0];
  const modified = guide.modifiedAt || guide.checkedAt;
  const minutes = readMinutes(guide);

  // ---- sections with stable slug ids
  const used = new Set(['key-takeaways', 'research-method', 'sources', 'next-steps', 'related-guides', 'on-this-page', 'main']);
  const sections = guide.sections.map((s) => {
    let id = slugify(s.heading) || 'section';
    for (let n = 2; used.has(id); n++) id = `${slugify(s.heading)}-${n}`;
    used.add(id);
    return { ...s, id };
  });
  const keyPoints = takeaways(sections);

  // ---- head
  const image = guide.image ? { ...guide.image, src: imageSrc(guide.image.src) } : null;
  const head = html`<header class="wrap page-head page-head--wide gd-head">
    <p class="eyebrow gd-cats"><span class="sr-only">Related software: </span>${ui.join(
      cats.map((c) => html`<a href="${ctx.url.category(c.id)}">${c.name}</a>`),
      raw('<span aria-hidden="true">·</span>'),
    )}</p>
    <h1>${guide.title}</h1>
    <p class="lede">${guide.description}</p>
    ${ui.trustline([
      html`Sources checked ${ui.time(ctx, guide.checkedAt)}`,
      html`<a href="#sources">${ctx.plural(guide.sources.length, 'source')}</a>`,
      'US edition',
      guide.publishedAt && html`Published ${ui.time(ctx, guide.publishedAt)}`,
      guide.modifiedAt && html`Content updated ${ui.time(ctx, guide.modifiedAt)}`,
      'System Compare research desk',
      `${minutes} min read`,
    ])}
  </header>`;

  // ---- "On this page": rail on desktop, a closed disclosure on small screens
  const tocItems = [
    ...sections.map((s) => ({ href: `#${s.id}`, label: s.heading })),
    { href: '#research-method', label: 'How this guide was researched' },
    { href: '#sources', label: 'Sources' },
    { href: '#next-steps', label: 'Next steps' },
  ];
  const mobileToc = html`<details class="gd-toc-m" data-nosnippet>
    <summary>On this page</summary>
    <ol>${tocItems.map((it) => html`<li><a href="${it.href}">${it.label}</a></li>`)}</ol>
  </details>`;

  const takeawayBlock = html`<section class="gd-take" id="key-takeaways" aria-labelledby="key-takeaways-h">
    <h2 id="key-takeaways-h">Key takeaways</h2>
    <ul>
      ${keyPoints.map((k) => html`<li>${k.text} <a class="gd-take__jump" href="#${k.section.id}"><span class="sr-only">Read the section: </span>${k.section.heading.replace(/^\d+\.\s+/, '')}</a></li>`)}
    </ul>
  </section>`;

  const hero = image
    ? html`<figure class="gd-hero"><img src="${image.src}" alt="${image.alt}" width="${image.width}" height="${image.height}" loading="eager" decoding="async" fetchpriority="high"></figure>`
    : '';

  const body = sections.map(
    (s) => html`<section class="prose gd-sec" id="${s.id}" aria-labelledby="${s.id}-h">
      <h2 id="${s.id}-h">${s.heading}</h2>
      ${paragraphs(s.body).map((p) => html`<p>${p}</p>`)}
      ${s.bullets?.length ? html`<ul class="gd-checks">${s.bullets.map((b) => html`<li>${b}</li>`)}</ul>` : ''}
    </section>`,
  );

  const method = html`<section class="prose gd-sec" id="research-method" aria-labelledby="research-method-h">
    <h2 id="research-method-h">How this guide was researched</h2>
    <p>${guide.researchMethod}</p>
  </section>`;

  const sources = html`<section class="gd-sec" id="sources" aria-labelledby="sources-h">
    <h2 id="sources-h">Sources</h2>
    <p class="gd-sec__sub">${ctx.plural(guide.sources.length, 'source')}, checked ${ui.time(ctx, guide.checkedAt)}.</p>
    ${sourceList(ctx, guide.sources)}
  </section>`;

  // ---- next steps: the guide's categories, the first published comparison in each, the cost calculator
  const nextCats = [...cats, ...(EXTRA_NEXT[guide.id] || []).map((id) => ctx.category(id)).filter((c) => c && !cats.includes(c))];
  const nextItems = [];
  for (const c of nextCats) {
    const factual = ctx.isFactual(c);
    const n = factual ? c.factual?.suppliers?.length || 0 : ctx.summary(c.id).total;
    nextItems.push({
      href: ctx.url.category(c.id),
      title: `Compare ${A.categoryThings(c)}`,
      sub: factual ? `${ctx.plural(n, 'supplier')} documented with dated sources` : `${ctx.plural(n, 'product')} checked against one category checklist`,
      meta: 'Category',
    });
    const vs = ctx.comparisonsInCategory(c.id)[0];
    if (vs) {
      nextItems.push({
        href: ctx.url.vs(vs.id),
        title: ctx.comparisonNames(vs).map((x) => x.name).join(' vs '),
        sub: `Head-to-head in ${c.name}`,
        meta: 'Comparison',
      });
    }
  }
  if (primary) {
    nextItems.push({
      href: `/tools/cost/?scope=${primary.id}`,
      title: 'Model the total cost for your team',
      sub: `Cost calculator, opened on ${primary.name}`,
      meta: 'Calculator',
    });
  }
  const next = html`<section class="gd-sec" id="next-steps" aria-labelledby="next-steps-h">
    <h2 id="next-steps-h">Next steps</h2>
    <p class="gd-sec__sub">Compare the documented requirements and pricing context before contacting a supplier.</p>
    ${ui.linkList(nextItems, { cols: 1 })}
  </section>`;

  // ---- related guides: shared categories first, then the same category group
  const share = (g) => g.categoryIds.filter((id) => guide.categoryIds.includes(id)).length;
  const groupId = primary ? ctx.groupOf(primary)?.id : null;
  const others = ctx.guides.filter((g) => g.id !== guide.id);
  const related = [
    ...others.filter((g) => share(g) > 0).sort((a, b) => share(b) - share(a)),
    ...others.filter((g) => share(g) === 0 && groupId && ctx.groupOf(g.categoryIds[0])?.id === groupId),
  ].slice(0, 4);
  const relatedBlock = related.length
    ? html`<section class="gd-sec" id="related-guides" aria-labelledby="related-guides-h">
        <h2 id="related-guides-h">Related guides</h2>
        ${ui.linkList(related.map((g) => ({ href: ctx.url.guide(g.id), title: g.title, sub: g.description })), { cols: 1 })}
        <p class="gd-more"><a class="link-arrow" href="/guides/">All ${ctx.guides.length} buying guides</a></p>
      </section>`
    : '';

  const page = html`<article class="gd-article">
    ${head}
    <div class="wrap with-rail gd-layout">
      <div class="rail">${ui.toc(tocItems)}</div>
      <div class="gd-main">
        ${mobileToc}
        ${takeawayBlock}
        ${hero}
        ${body}
        ${method}
        ${sources}
        ${next}
        ${relatedBlock}
      </div>
    </div>
  </article>`;

  const description = describe([guide.description, `${shortTitle}. Practical buying questions, documented limits and sources for US teams.`]);

  return {
    title: seoTitle(shortTitle),
    description,
    ogTitle: shortTitle,
    ogType: 'article',
    ogImage: image ? { url: image.src, width: image.width, height: image.height, alt: image.alt } : undefined,
    preload: image ? [{ href: image.src, as: 'image', type: imageType(image.src), fetchpriority: 'high' }] : undefined,
    nav: 'guides',
    breadcrumbs: [
      { name: 'Guides', url: ctx.url.guides() },
      { name: shortTitle, url: path },
    ],
    pageType: 'WebPage',
    datePublished: guide.publishedAt || undefined,
    dateModified: modified,
    accountable: true,
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#article` } },
    jsonld: [
      {
        ...ctx.seo.articleNode({
          path,
          headline: guide.title,
          description: guide.description,
          datePublished: guide.publishedAt || undefined,
          dateModified: modified,
          image: image ? image.src : undefined,
          about: cats.map((c) => ({ '@type': 'Thing', name: A.categoryNoun(c), url: ctx.abs(ctx.url.category(c.id)) })),
          citation: guide.sources.map((s) => ({ '@type': 'WebPage', name: s.label, url: s.url })),
        }),
        ...(primary ? { articleSection: primary.name } : {}),
        wordCount: wordCount(guide),
        isAccessibleForFree: true,
      },
    ],
    body: page,
  };
}

// ------------------------------------------------------------------ guides index
function renderIndex(ctx) {
  const guides = ctx.guides;
  const groupOf = (g) => ctx.groupOf(g.categoryIds[0]);
  const tagsOf = (g) => [...new Set(g.categoryIds.map((id) => ctx.groupOf(id)?.id).filter(Boolean))];
  const sections = ctx.groups.map((group) => ({ group, items: guides.filter((g) => groupOf(g)?.id === group.id) })).filter((s) => s.items.length);
  const chipGroups = ctx.groups.map((group) => ({ group, n: guides.filter((g) => tagsOf(g).includes(group.id)).length })).filter((x) => x.n);
  const newest = ctx.maxDate(guides.map((g) => g.checkedAt));
  const oldest = guides.map((g) => ctx.isoDate(g.checkedAt)).filter(Boolean).sort()[0];
  const sourceTotal = guides.reduce((n, g) => n + g.sources.length, 0);
  const indexable = sections.flatMap((s) => s.items).filter((g) => ctx.isIndexable(ctx.url.guide(g.id)));
  const live = ctx.liveHead('/guides/') || {};

  const head = html`<header class="wrap page-head page-head--wide">
    <h1>Buying guides</h1>
    <p class="lede">Practical frameworks for the decisions that sit behind a software subscription.</p>
    ${ui.trustline([
      `${guides.length} guides`,
      `${sourceTotal} cited sources`,
      html`Sources checked ${ui.time(ctx, oldest)} – ${ui.time(ctx, newest)}`,
      'System Compare research desk',
    ])}
  </header>`;

  const filter = html`<div class="wrap gd-filter" data-nosnippet>
    <div class="chips" role="group" aria-label="Filter guides by topic" data-gd-filter data-gd-hash>
      <a class="chip" href="#guides" data-gd-chip="" aria-pressed="true">All <span class="n">${guides.length}</span></a>
      ${chipGroups.map(({ group, n }) => html`<a class="chip" href="#${group.id}" data-gd-chip="${group.id}">${group.label} <span class="n">${n}</span></a>`)}
    </div>
    <p class="toolbar__count" role="status" aria-live="polite"><b data-gd-n>${guides.length}</b> of ${guides.length} guides</p>
  </div>`;

  const row = (g) => {
    const cats = g.categoryIds.map((id) => ctx.category(id)).filter(Boolean);
    return html`<tr data-gd-tags="${tagsOf(g).join(' ')}">
      <th scope="row"><a href="${ctx.url.guide(g.id)}">${g.title}</a><small>${g.description}</small></th>
      <td class="gd-list__cat"><a href="${ctx.url.category(cats[0].id)}">${cats[0].name}</a>${cats.length > 1 ? html` <span title="${cats.slice(1).map((c) => c.name).join(', ')}">+${cats.length - 1} more</span>` : ''}</td>
      <td class="gd-list__date">Sources checked ${ui.time(ctx, g.checkedAt)}</td>
    </tr>`;
  };

  const list = html`<div class="wrap gd-index" id="guides">
    ${sections.map(
      ({ group, items }) => html`<section class="gd-group" id="${group.id}" data-gd-sec aria-labelledby="${group.id}-h">
        <h2 id="${group.id}-h">${group.label}</h2>
        <table class="dtable gd-list">
          <caption class="sr-only">${group.label}: ${ctx.plural(items.length, 'buying guide')}</caption>
          <thead class="sr-only"><tr><th scope="col">Guide</th><th scope="col">Software category</th><th scope="col">Sources checked</th></tr></thead>
          <tbody>${items.map(row)}</tbody>
        </table>
      </section>`,
    )}
  </div>`;

  // ---- FAQ: every answer restates data that is on this page or in the guides themselves
  const methods = new Map();
  for (const g of guides) methods.set(g.researchMethod, (methods.get(g.researchMethod) || 0) + 1);
  const [commonMethod, commonCount] = [...methods.entries()].sort((a, b) => b[1] - a[1])[0];
  const uncovered = ctx.categories.filter((c) => !guides.some((g) => g.categoryIds.includes(c.id))).length;
  const faqItems = [
    {
      q: 'How are the buying guides researched?',
      a: `Each guide lists its own sources and states its own research method. The most common method, used by ${commonCount} of the ${guides.length} guides, reads: “${commonMethod}”`,
    },
    {
      q: 'How current are the guides?',
      a: `The sources behind the ${guides.length} guides were checked between ${ctx.fmtDate(oldest)} and ${ctx.fmtDate(newest)}. Every guide shows its own “Sources checked” date, and a “Content updated” date when the text changed afterwards.`,
    },
    {
      q: 'Which software categories have a buying guide?',
      a: `${ctx.categories.length - uncovered} of the ${ctx.categories.length} categories are covered by at least one guide; ${uncovered} have none yet. Use the topic filter above, or open a category page, which links the guides written for it.`,
    },
    {
      q: 'Do the guides recommend a product?',
      a: 'No. The guides are checklists, scorecards and buying frameworks for your own evaluation. Product comparisons live on the category and comparison pages, where every claim links to a dated official source.',
    },
  ];
  const faq = html`<div class="wrap wrap--narrow section gd-faq">${ui.faq(ctx, faqItems, { heading: 'Questions about the guides', open: 0 })}</div>`;

  return {
    title: live.title || seoTitle('Software buying guides'),
    description: describe([
      `${guides.length} practical buying guides for US teams: procurement, migration, AI pilots and total cost — each with dated official sources.`,
      live.description,
    ]),
    ogTitle: 'Software buying guides',
    nav: 'guides',
    breadcrumbs: [{ name: 'Guides', url: ctx.url.guides() }],
    pageType: 'CollectionPage',
    dateModified: newest,
    faq: faqItems,
    pageExtra: { mainEntity: { '@id': `${ctx.abs(ctx.url.guides())}#primary-list` } },
    jsonld: [
      ctx.seo.itemListNode(
        ctx.url.guides(),
        indexable.map((g) => ({ name: g.title, url: ctx.url.guide(g.id) })),
        { name: 'Software buying guides', ordered: false },
      ),
    ],
    body: html`${head}${filter}${list}${faq}${filterScript()}`,
  };
}
