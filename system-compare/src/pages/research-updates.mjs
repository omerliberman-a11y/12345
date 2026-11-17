// Research updates (/research-updates/): the dated log of completed public-source checks.
// One compact row per vendor.researchReview, newest first, grouped by month. The same records feed
// /feed.xml and /atom.xml (src/gen/feeds.mjs), which import researchUpdates() from here.

import { html, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';
import { filterScript } from './guides.mjs';

export function routes(ctx) {
  return [{ path: '/research-updates/', render }];
}

export const STATUS_LABEL = { partial: 'Scoped check with open questions', verified: 'Scoped source check complete' };
export const FIELD_LABEL = { pricing: 'pricing and billing', tradeoffs: 'limitations', ai: 'AI scope and limits', strengths: 'documented strengths', description: 'product summary' };
export const FEED_PREFIX = 'Public-source review of pricing, plan boundaries and selected product claims.';

/** The update records in publication order: observedAt descending, then product name. */
export function researchUpdates(ctx) {
  return ctx.vendors
    .filter((v) => v.researchReview)
    .sort((a, b) => b.researchReview.observedAt.localeCompare(a.researchReview.observedAt) || a.name.localeCompare(b.name, 'en'))
    .map((vendor) => ({ vendor, review: vendor.researchReview }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const LONG = 170; // characters of limitation text shown before the rest is folded away

function render(ctx) {
  const items = researchUpdates(ctx);
  const path = '/research-updates/';
  const pageData = ctx.pages[path] || {};
  const approver = ctx.catalog.researchApprover;
  const latest = items[0]?.review.observedAt;
  const count = (fn) => items.filter(fn).length;
  const nComplete = count((x) => x.review.status === 'verified');
  const nOpen = count((x) => x.review.status === 'partial');
  const fields = Object.keys(FIELD_LABEL).filter((f) => count((x) => x.review.changedFields.includes(f)));

  // ---- month groups (order preserved)
  const months = [];
  for (const it of items) {
    const ym = it.review.observedAt.slice(0, 7);
    if (!months.length || months[months.length - 1].ym !== ym) months.push({ ym, items: [] });
    months[months.length - 1].items.push(it);
  }

  const limitations = (list) => {
    const li = (l) => html`<li>${l}</li>`;
    const total = list.join(' ').length;
    if (list.length <= 1 || total <= LONG) return { shown: html`<ul class="gd-limits">${list.map(li)}</ul>`, fold: '' };
    return {
      shown: html`<ul class="gd-limits">${li(list[0])}</ul>`,
      fold: html`<details class="gd-fold"><summary>${ctx.plural(list.length - 1, 'more limitation')}</summary><ul class="gd-limits">${list.slice(1).map(li)}</ul></details>`,
    };
  };

  const row = ({ vendor, review }) => {
    const cat = ctx.primaryCategory(vendor);
    const tags = [review.status, ...review.changedFields].join(' ');
    const lim = limitations(review.limitations);
    return html`<tr data-gd-tags="${tags}">
      <th scope="row">
        <a class="gd-prod" href="${ctx.url.software(vendor.id)}">${ui.logo(ctx, vendor, { size: 'sm' })}<span>${vendor.name}</span></a>
        ${cat ? html`<small>${cat.name}</small>` : ''}
      </th>
      <td class="gd-upd__when">
        <time datetime="${review.observedAt}">${ctx.fmtDate(review.observedAt, { nbsp: true })}</time>
        <span class="tag ${review.status === 'verified' ? 'tag--ok' : 'tag--warn'}">${review.status === 'verified' ? 'Check complete' : 'Open questions'}</span>
      </td>
      <td class="gd-upd__what">
        <span class="gd-upd__label">Updated: </span>${review.changedFields.map((f) => FIELD_LABEL[f]).join(', ')}
        <small>${ctx.plural(review.sources.length, 'official source')} recorded</small>
      </td>
      <td class="gd-upd__limits">
        ${lim.shown}
        <div class="gd-upd__foot">${lim.fold}<a class="gd-upd__more" href="${ctx.url.software(vendor.id)}#source-review">Sources and checked claims<span class="sr-only"> for ${vendor.name}</span></a></div>
      </td>
    </tr>`;
  };

  const head = html`<header class="wrap page-head page-head--wide gd-hub">
    <p class="eyebrow">Traceable research</p>
    <h1>${pageData.title || 'Research updates'}</h1>
    <p class="lede">Completed public-source checks and their remaining limitations. Dates describe research activity; they do not establish when a product was first published, tested or indexed.</p>
    ${ui.trustline([
      `${ctx.plural(items.length, 'product check')}`,
      latest && html`Latest ${ui.time(ctx, latest)}`,
      approver && html`Publication approver: ${approver.name}`,
      html`<a href="/editorial-policy/">How this work is checked and approved</a>`,
      html`<a href="/feed.xml">RSS feed</a>`,
      html`<a href="/atom.xml">Atom feed</a>`,
    ])}
  </header>
  <div class="wrap gd-answer">
    ${ui.answer(
      ctx,
      html`Each check covered <strong>pricing, plan boundaries and selected product claims</strong> against official sources. Of the ${items.length} checks, <strong>${nComplete}</strong> are complete and <strong>${nOpen}</strong> still have open questions; every entry lists what was updated and the limitations that remain. Weighted capability scores retain their own evidence dates.`,
      { label: 'What these updates cover' },
    )}
  </div>`;

  const chip = (value, label, n) => html`<button type="button" class="chip" data-gd-chip="${value}" aria-pressed="${value ? 'false' : 'true'}">${label} <span class="n">${n}</span></button>`;
  // the chips are buttons, so they show only where scripts run (guides.css: html.js, which the head script sets before the
  // first paint): in place from the first paint, never revealed later by the filter script at the end of the page, which
  // moved the list down by their height when a paint came first
  const filter = html`<div class="wrap gd-filter" data-nosnippet>
    <div class="chips gd-filter__js" role="group" aria-label="Filter updates" data-gd-filter>
      ${chip('', 'All', items.length)}
      ${chip('verified', 'Check complete', nComplete)}
      ${chip('partial', 'Open questions', nOpen)}
      ${fields.map((f) => chip(f, `Updated: ${FIELD_LABEL[f]}`, count((x) => x.review.changedFields.includes(f))))}
    </div>
    <p class="toolbar__count" role="status" aria-live="polite"><b data-gd-n>${items.length}</b> of ${items.length} product checks</p>
  </div>`;

  const list = html`<div class="wrap gd-index">
    ${months.map(
      (m) => html`<section class="gd-group" id="m-${m.ym}" data-gd-sec aria-labelledby="m-${m.ym}-h">
        <h2 id="m-${m.ym}-h">${monthLabel(m.ym)} <small>${ctx.plural(m.items.length, 'product check')}</small></h2>
        <table class="dtable gd-upd">
          <caption class="sr-only">Product source checks in ${monthLabel(m.ym)}, newest first</caption>
          <thead><tr><th scope="col">Product</th><th scope="col">Checked</th><th scope="col">What was updated</th><th scope="col">Limitations that remain</th></tr></thead>
          <tbody>${m.items.map(row)}</tbody>
        </table>
      </section>`,
    )}
    <p class="table-note">“${STATUS_LABEL.verified}” is shown as “Check complete”; “${STATUS_LABEL.partial}” as “Open questions”. A check is scoped: it covers the stated sources on the stated date, not the whole product.</p>
  </div>`;

  const faqItems = [
    {
      q: 'What does an update cover?',
      a: 'Each entry is a completed public-source check of one product: pricing, plan boundaries and selected product claims, read on official sources. The entry names the catalog fields that were updated, the number of official sources recorded and the limitations that remain.',
    },
    {
      q: 'What is the difference between “Check complete” and “Open questions”?',
      a: `“Check complete” stands for “${STATUS_LABEL.verified}”: the scoped check was finished against the recorded sources. “Open questions” stands for “${STATUS_LABEL.partial}”: the check was carried out, but points listed with the entry could not be settled from public sources. Both kinds list their remaining limitations.`,
    },
    {
      q: 'Do update dates change a score?',
      a: 'No. Weighted capability scores retain their own evidence dates. An update date describes when pricing, plan boundaries and selected claims were checked.',
    },
    {
      q: 'What do the dates describe?',
      a: 'Dates describe research activity; they do not establish when a product was first published, tested or indexed.',
    },
    approver && {
      q: 'Who approves the updates?',
      a: html`<p>The publication approver is ${approver.name}. <a href="/editorial-policy/">Editorial responsibility</a> explains how research is checked and approved.</p>`,
    },
    {
      q: 'Can I subscribe to research updates?',
      a: html`<p>Yes. Subscribe to the <a href="/feed.xml">RSS feed</a> or the <a href="/atom.xml">Atom feed</a> to receive the same entries.</p>`,
    },
  ].filter(Boolean);
  const faq = html`<div class="wrap wrap--narrow section gd-faq">${ui.faq(ctx, faqItems, { heading: 'Questions about research updates', open: 0 })}</div>`;

  return {
    title: seoTitle(pageData.title || 'Research updates'),
    description: describe([
      `Dated log of public-source checks for US software: ${items.length} product checks, latest ${ctx.fmtDate(latest)}. What changed and what remains open.`,
      pageData.description,
    ]),
    ogTitle: pageData.title || 'Research updates',
    breadcrumbs: [{ name: 'Research updates', url: path }],
    pageType: 'CollectionPage',
    dateModified: ctx.isoDate(ctx.catalog.researchUpdatedAt || latest),
    accountable: true,
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#primary-list` } },
    jsonld: [
      {
        '@type': 'ItemList',
        '@id': `${ctx.abs(path)}#primary-list`,
        name: 'Research updates, newest first',
        numberOfItems: items.length,
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        itemListElement: items.map(({ vendor, review }, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${vendor.name}: source check`,
          description: `${ctx.isoDate(review.observedAt)}: ${STATUS_LABEL[review.status]}. Updated ${review.changedFields.map((f) => FIELD_LABEL[f]).join(', ')}.`,
          url: ctx.abs(ctx.url.software(vendor.id)),
        })),
      },
    ],
    body: html`${head}${filter}${list}${faq}${filterScript()}`,
  };
}
