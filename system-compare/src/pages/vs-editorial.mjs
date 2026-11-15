// Editorial /vs/ articles (3): a written buying brief for two scored products. Reading layout with an
// "On this page" rail (same family as the guide pages). Every sentence comes from the comparison record;
// the article links to the data comparison of the same two products and to both profiles.

import { html, text, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe, fits } from '../lib/seo.mjs';
import { tight } from './category-factual.mjs';

export function routes(ctx) {
  return ctx.comparisons.filter((c) => ctx.comparisonKind(c) === 'editorial').map((comparison) => ({ path: ctx.url.vs(comparison.id), render: (c) => render(c, comparison) }));
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const firstSentence = (s) => (String(s || '').match(/^.*?[.!?](?=\s|$)/) || [String(s || '')])[0];

function render(ctx, X) {
  const category = ctx.category(X.categoryId);
  const path = ctx.url.vs(X.id);
  const vendors = (X.vendorIds || []).map((id) => ctx.vendor(id)).filter(Boolean);
  const [A, B] = vendors;
  const names = vendors.map((v) => v.name);
  const checked = X.checkedAt;
  const modified = X.modifiedAt || X.checkedAt;
  const year = String(modified || '').slice(0, 4);
  const compareUrl = ctx.url.compare({ scope: X.categoryId, ids: X.vendorIds });
  const shortTitle = names.join(' vs ');
  const sourceByUrl = new Map((X.sources || []).map((s) => [s.url, s]));
  const live = ctx.liveHead(path) || {};

  // ---- head
  const core = fits([`${shortTitle}: ${category.name} compared`, `${shortTitle} compared`, shortTitle], 60) || shortTitle;
  const title = seoTitle(core, year);
  const description = describe([X.summary, firstSentence(X.summary), live.description]);

  const sections = (X.sections || []).map((s, i) => ({ ...s, id: slug(s.heading) || `section-${i + 1}` }));
  const tocItems = [
    { href: '#shortlist', label: 'Where to begin your shortlist' },
    X.rows?.length && { href: '#decision-points', label: 'Decision points' },
    ...sections.map((s) => ({ href: `#${s.id}`, label: s.heading })),
    X.limitations?.length && { href: '#limits', label: 'Scope and open questions' },
    { href: '#data', label: 'Scores and prices' },
    X.sources?.length && { href: '#sources', label: 'Primary sources' },
  ].filter(Boolean);

  const head = html`<header class="wrap page-head fx-article__head">
    <p class="eyebrow"><a href="${ctx.url.category(category.id)}">${category.name}</a></p>
    <h1>${X.title}</h1>
    <p class="lede">${X.summary}</p>
    ${ui.trustline([
      checked && html`Sources checked ${ui.time(ctx, checked)}`,
      X.publishedAt && html`Published ${ui.time(ctx, X.publishedAt)}`,
      modified && html`Content updated ${ui.time(ctx, modified)}`,
      'Buying brief from official documentation — not a hands-on test',
    ])}
    <p class="fx-cta" data-nosnippet>
      <a class="btn" href="${compareUrl}">See the full data comparison</a>
      ${vendors.map((v) => html`<a class="btn btn--ghost" href="${ctx.url.software(v.id)}">${v.name} profile</a>`)}
    </p>
  </header>`;

  const hero = X.image
    ? html`<figure class="fx-hero"><img src="${X.image.src}" alt="${X.image.alt}" width="${X.image.width}" height="${X.image.height}" decoding="async"></figure>`
    : '';

  const shortlist = html`<section class="prose fx-sec fx-sec--first" id="shortlist" aria-labelledby="shortlist-h">
    <h2 id="shortlist-h">Where to begin your shortlist</h2>
    ${ui.answer(
      ctx,
      html`${X.decision} This brief ${X.rows?.length ? html`compares ${ctx.plural(X.rows.length, 'decision point')} for ${shortTitle} using` : html`covers ${shortTitle} using`} ${ctx.plural((X.sources || []).length, 'official source')} checked ${ui.time(ctx, checked)}.`,
      { label: 'In short' },
    )}
    ${
      X.choices?.length
        ? html`<div class="fx-twocol">${X.choices.map((c) => html`<div><h3>${c.heading}</h3><p>${c.text}</p></div>`)}</div>`
        : ''
    }
    <p class="fineprint"><strong>Editorial score: — /100 (not assigned).</strong> This buying brief compares documented offer boundaries. It does not award a winner or revalidate older product assessments.</p>
  </section>`;

  const table = X.rows?.length
    ? html`<section class="fx-sec" id="decision-points" aria-labelledby="decision-points-h">
        <h2 id="decision-points-h">Decision points</h2>
        <table class="dtable fx-stack fx-decision">
            <caption class="sr-only">${shortTitle}: decision points checked ${ui.time(ctx, checked)}</caption>
            <thead><tr><th scope="col">Question</th>${names.map((n) => html`<th scope="col">${n}</th>`)}</tr></thead>
            <tbody>
              ${X.rows.map((r) => html`<tr><th scope="row">${r.label}</th><td data-l="${names[0]}">${r.left}</td><td data-l="${names[1]}">${r.right}</td></tr>`)}
            </tbody>
        </table>
        <p class="table-note">Decision points checked ${ui.time(ctx, checked)} against the official sources listed below.</p>
      </section>`
    : '';

  const body = sections.map(
    (s) => html`<section class="prose fx-sec" id="${s.id}" aria-labelledby="${s.id}-h">
      <h2 id="${s.id}-h">${s.heading}</h2>
      <p>${s.body}</p>
      ${s.bullets?.length ? html`<ul>${s.bullets.map((b) => html`<li>${b}</li>`)}</ul>` : ''}
      ${
        s.sourceUrls?.length
          ? html`<p class="fineprint">Sources: ${ui.join(
              s.sourceUrls.map((u) => ui.sourceLink(u, sourceByUrl.get(u)?.label || 'Official source')),
              ' · ',
            )}</p>`
          : ''
      }
    </section>`,
  );

  const limits = X.limitations?.length
    ? html`<section class="prose fx-sec" id="limits" aria-labelledby="limits-h">
        <h2 id="limits-h">Scope and open questions</h2>
        <ul>${X.limitations.map((l) => html`<li>${l}</li>`)}</ul>
      </section>`
    : '';

  // The same two products in our data: one row each (score, starting price), then the tool and profiles.
  const data = html`<section class="fx-sec" id="data" aria-labelledby="data-h">
    <h2 id="data-h">Scores and prices for ${shortTitle}</h2>
    <p class="fx-sec__sub">From the ${category.name} checklist and each product’s profile. These catalog assessments retain their own evidence dates and may use older plan definitions than this brief.</p>
    <div class="fx-data">
      ${ui.productTable(ctx, category.id, vendors.map((vendor) => ({ vendor })), { id: 'pair', rank: false, sortable: false, ai: false, lazyFrom: 0, caption: `${shortTitle}: documented-fit score and starting price in ${category.name}` })}
    </div>
    ${ui.tableNote(ctx)}
    <p class="fx-cta">
      <a class="btn" href="${compareUrl}">See the full data comparison</a>
      <a class="btn btn--ghost" href="${ctx.url.category(category.id)}">All ${category.name} tools</a>
    </p>
  </section>`;

  const sources = X.sources?.length
    ? html`<section class="fx-sec" id="sources" aria-labelledby="sources-h">
        <h2 id="sources-h">Primary sources</h2>
        <p class="fx-sec__sub">${ctx.plural(X.sources.length, 'official source')}, checked ${ui.time(ctx, checked)}.</p>
        ${ui.sources(X.sources, { cols: 1 })}
      </section>`
    : '';

  const page = html`<article class="fx-article">
    ${head}
    <div class="wrap with-rail fx-article__layout">
      <div class="rail">${ui.toc(tocItems)}</div>
      <div class="fx-article__main">
        ${shortlist}
        ${hero}
        ${table}
        ${body}
        ${limits}
        ${data}
        ${sources}
        <p class="fx-updated">Content updated ${ui.time(ctx, modified)}</p>
      </div>
    </div>
  </article>`;

  const softwareRef = (v) => ({ '@type': 'SoftwareApplication', '@id': `${ctx.abs(ctx.url.software(v.id))}#software`, name: v.name, url: v.url, applicationCategory: 'BusinessApplication' });

  return {
    title,
    description,
    ogTitle: X.title,
    ogType: 'article',
    // 1200×630 JPEG share card of the hero (scripts/make-article-social.py): social platforms do not read WebP
    ogImage: X.image ? { url: `/assets/articles/social/${X.image.src.split('/').pop().replace(/\.\w+$/, '')}.jpg`, width: 1200, height: 630, alt: X.image.alt } : undefined,
    nav: 'compare',
    breadcrumbs: [
      { name: 'Categories', url: '/categories/' },
      { name: category.name, url: ctx.url.category(category.id) },
      { name: shortTitle, url: path },
    ],
    pageType: 'WebPage',
    datePublished: ctx.isoDate(X.publishedAt) || undefined,
    dateModified: ctx.isoDate(modified) || undefined,
    accountable: true,
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#article` }, about: vendors.map(softwareRef) },
    jsonld: [
      ctx.seo.articleNode({
        path,
        headline: X.title,
        description,
        datePublished: ctx.isoDate(X.publishedAt) || undefined,
        dateModified: ctx.isoDate(modified) || undefined,
        image: X.image?.src,
        about: vendors.map((v) => ({ '@id': `${ctx.abs(ctx.url.software(v.id))}#software` })),
        citation: (X.sources || []).map((s) => ({ '@type': 'WebPage', name: s.label, url: s.url })),
      }),
    ],
    scripts: ['js/factual.js'], // ARIA table roles for the stacked decision table on phones
    body: tight(page),
  };
}
