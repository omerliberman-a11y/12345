// Shared HTML components. Every function takes ctx first and returns a Raw fragment (see html.mjs).
// Styles live in src/assets/css/components.css — class names here and there must stay in sync.

import { html, raw, attrs, cx, join } from './html.mjs';
import { icon } from './layout.mjs';

// ------------------------------------------------------------------ small pieces
export const time = (ctx, iso, opts) => (iso ? html`<time datetime="${ctx.isoDate(iso)}">${ctx.fmtDate(iso, opts)}</time>` : '');

export const tag = (label, kind) => html`<span class="${cx('tag', kind && `tag--${kind}`)}">${label}</span>`;

/** Vendor logo in a neutral frame. Falls back to initials when a logo is missing. */
export function logo(ctx, vendor, { size, wide = false, lazy = true } = {}) {
  const l = vendor.logo;
  const cls = cx('logo', size && `logo--${size}`, l?.surface === 'dark' && 'logo--dark', wide && l?.kind === 'wordmark' && 'logo--wide');
  if (!l?.path) {
    const initials = vendor.name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return html`<span class="${cls}" aria-hidden="true"><span class="logo__fallback">${initials}</span></span>`;
  }
  const w = Math.round(l.width || 64);
  const h = Math.round(l.height || 64);
  return html`<span class="${cls}"><img src="${l.path}" alt="${vendor.name} logo" width="${w}" height="${h}"${attrs({ loading: lazy ? 'lazy' : null, decoding: 'async' })}></span>`;
}

// ------------------------------------------------------------------ score
/** Compact score for table rows: "92/100" + "9/10 checked", or "Score pending" + coverage. */
export function scoreToken(ctx, s, { size } = {}) {
  if (!s) return '';
  if (s.pending) {
    return html`<span class="${cx('score score--pending', size && `score--${size}`)}">
      <span class="score__value">Score pending</span>
      <span class="score__meta">${s.checked}/${s.total} checked · ${s.coveragePct}%</span>
    </span>`;
  }
  return html`<span class="${cx('score', size && `score--${size}`)}">
    <span class="score__value num">${s.value}<small>/100</small></span>
    <span class="score__meta">${s.checked}/${s.total} checked</span>
  </span>`;
}

/** Circular score for heroes and compare headers. */
export function scoreRing(ctx, s, { size } = {}) {
  if (!s) return '';
  const r = 42;
  const c = 2 * Math.PI * r;
  const frac = s.pending ? s.coveragePct / 100 : s.value / 100;
  const label = s.pending ? `Score pending, ${s.coveragePct}% of checklist weight checked` : `Documented-fit score ${s.value} out of 100`;
  return html`<span class="${cx('ring', s.pending && 'ring--pending', size && `ring--${size}`)}" role="img" aria-label="${label}">
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring__track" cx="50" cy="50" r="${r}"/><circle class="ring__bar" cx="50" cy="50" r="${r}" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}"/></svg>
    <span class="ring__num" aria-hidden="true">${s.pending ? raw('Score<br>pending') : s.value}</span>
  </span>`;
}

/** Per-group breakdown with meters ("Core capabilities 48.2 of 56.3 points"). Empty groups are omitted. */
export function breakdown(ctx, s) {
  const pt = ctx.scoring.pointText;
  const groups = s.groups.filter((g) => g.totalCount > 0);
  return html`<div class="breakdown">
    ${groups.map(
      (g) => html`<div class="breakdown__row">
        <b>${g.label}</b><span>${pt(g.earned)} of ${pt(g.weight)} pts · ${g.checkedCount}/${g.totalCount} checked</span>
        <span class="meter" aria-hidden="true"><i style="width:${g.weight ? Math.round((g.earned / g.weight) * 100) : 0}%"></i></span>
      </div>`,
    )}
  </div>`;
}

/** The published method sentence (verbatim wording, date from the catalog). Print once per page/table. */
export const methodSentence = (ctx) =>
  ctx.scoring.LABELS.methodSentence.replace('<date>', ctx.isoDate(ctx.catalog.checkedAt));

/** "How is this scored?" popover used next to a score heading. */
export function scoreHelp(ctx, { align } = {}) {
  return html`<details class="${cx('pop', align === 'right' && 'pop--right')}" data-pop>
    <summary aria-label="How the score works"><i class="info" aria-hidden="true">i</i></summary>
    <div class="pop__panel">
      <h4>Documented-fit score</h4>
      <p>How much of this category’s checklist is documented in official sources, from 0 to 100. It is research, not a customer rating or a hands-on test.</p>
      <p>Unverified items score zero. No score is shown until 80% of the checklist weight has been checked — that is what “Score pending” means.</p>
      <p><a href="/methodology/">How we score</a></p>
    </div>
  </details>`;
}

// ------------------------------------------------------------------ price
export function priceCell(ctx, p, { size, plan = false, checked = false } = {}) {
  const main = p.hasAmount
    ? html`<span class="price__main num">${p.headline}</span>`
    : html`<span class="price__main price__main--text">${p.headline}</span>`;
  const unit = [p.unit, p.billingNote].filter(Boolean).join(' · ');
  return html`<span class="${cx('price', size && `price--${size}`)}">
    ${main}
    ${unit ? html`<span class="price__unit">${unit}</span>` : ''}
    ${plan && p.plan ? html`<span class="price__unit">${p.plan} plan</span>` : ''}
    ${checked && p.checkedAt ? html`<span class="price__unit">Checked ${time(ctx, p.checkedAt)}</span>` : ''}
  </span>`;
}

export const aiTag = (ctx, vendor) => {
  const ai = ctx.aiLevel(vendor);
  return html`<span class="${cx('tag', ai.rank >= 4 && 'tag--brand')}" title="${ai.help}">${ai.label}</span>`;
};

// ------------------------------------------------------------------ evidence status
const ST = { yes: 'Supported', partial: 'Limited', no: 'Not supported', unknown: 'Not verified' };
export const status = (st, { iconOnly = false } = {}) =>
  html`<span class="${cx('st', `st--${ST[st] ? st : 'unknown'}`, iconOnly && 'st--icon')}">${iconOnly ? html`<span>${ST[st] || ST.unknown}</span>` : ST[st] || ST.unknown}</span>`;
export const statusLegend = () =>
  html`<p class="legend" aria-label="Legend">${['yes', 'partial', 'no', 'unknown'].map((s) => status(s))}</p>`;
export const STATUS_LABELS = ST;

// ------------------------------------------------------------------ shortlist controls
/** Checkbox-style toggle used in table rows. */
export const pick = (ctx, vendor, categoryId) =>
  html`<button type="button" class="pick" data-shortlist="${vendor.id}" data-category="${categoryId}" data-name="${vendor.name}" aria-pressed="false" aria-label="Add ${vendor.name} to shortlist"></button>`;

/** Text button used on profiles and heroes. */
export const shortlistButton = (ctx, vendor, categoryId, { cls = 'btn btn--ghost', label = 'Add to shortlist' } = {}) =>
  html`<button type="button" class="${cls}" data-shortlist="${vendor.id}" data-category="${categoryId}" data-name="${vendor.name}" data-label-on="In your shortlist ✓" data-label-off="${label}" aria-pressed="false">${label}</button>`;

// ------------------------------------------------------------------ outbound vendor links (with disclosure)
/**
 * Link to a vendor's site or pricing page through the /go/ contract.
 * Affiliate links get rel=sponsored, a visible "Ad · affiliate link" label and the commission explainer.
 */
export function outLink(ctx, vendor, { intent = 'website', from = 'page', label, cls = 'btn', explain = true } = {}) {
  const o = ctx.outbound(vendor, { intent, from });
  const text = label || (intent === 'pricing' ? 'Official pricing' : `Visit ${vendor.name}`);
  const a = html`<a class="${cx(cls, 'ext')}" href="${o.href}" target="_blank" rel="${o.rel}"${attrs(o.attrs)}>${text}</a>`;
  if (!o.affiliate) return html`<span class="commercial-link">${a}</span>`;
  return html`<span class="commercial-link commercial-link--ad">${a} <span class="tag tag--ad">Ad · affiliate link</span>${
    explain ? html` <span class="fineprint">We may earn a commission if you buy through this link.</span>` : ''
  }</span>`;
}

/** Plain external link to a cited source (followed, new tab). */
export const sourceLink = (url, label = 'Source') =>
  url ? html`<a class="ext" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : '';

// ------------------------------------------------------------------ product table (the one row component)
/**
 * Ranked product table. `rows` = [{ vendor, note? }], all scored in `categoryId`.
 * opts: { id, caption, rank: true, pickable: true, focalId, sortable: true, ai: true, showCategory: false }
 * Each <tr> carries data-* used by js/table.js for instant sort + filter (never changes the score).
 */
export function productTable(ctx, categoryId, rows, opts = {}) {
  const { id = 'products', caption, rank = true, pickable = true, focalId, sortable = true, ai = true, featureIndex = null, lazyFrom = 6 } = opts;
  const category = ctx.category(categoryId);
  const th = (key, label, cls, sortKey) =>
    sortable && sortKey
      ? html`<th scope="col" class="${cls}" data-sort-col="${sortKey}"><button type="button" data-sort="${sortKey}">${label}</button></th>`
      : html`<th scope="col" class="${cls}">${label}</th>`;
  return html`<table class="ptable" id="${id}" data-ptable data-category="${categoryId}">
    <caption class="sr-only">${caption || `${category.name}: products ranked by documented-fit score`}</caption>
    <thead>
      <tr>
        ${pickable ? html`<th scope="col" class="ptable__c-pick"><span class="sr-only">Shortlist</span></th>` : ''}
        ${rank ? html`<th scope="col" class="ptable__c-rank"><span class="sr-only">Rank</span>#</th>` : ''}
        ${th('name', 'Product', 'ptable__c-name', 'name')}
        ${th('score', 'Score', 'ptable__c-score', 'score')}
        ${th('price', 'Starting price', 'ptable__c-price', 'price')}
        ${ai ? html`<th scope="col" class="ptable__c-ai">AI</th>` : ''}
      </tr>
    </thead>
    <tbody>
      ${rows.map(({ vendor, note }, i) => {
        const s = ctx.score(categoryId, vendor.id);
        const p = ctx.price(vendor, categoryId);
        const aiL = ctx.aiLevel(vendor);
        const feat = featureIndex ? featureIndex(vendor) : null;
        return html`<tr${attrs({
          class: cx(vendor.id === focalId && 'is-focal'),
          'data-id': vendor.id,
          'data-name': vendor.name,
          'data-rank': s.rank,
          'data-score': s.pending ? -1 : s.value,
          'data-cov': s.coveragePct,
          'data-price': p.hasAmount && p.currency === 'USD' ? p.amount : '',
          'data-pstate': p.state,
          'data-ai': aiL.id,
          'data-feat': feat,
        })}>
          ${pickable ? html`<td class="ptable__c-pick">${pick(ctx, vendor, categoryId)}</td>` : ''}
          ${rank ? html`<td class="ptable__c-rank num">${s.rank}</td>` : ''}
          <th scope="row" class="ptable__c-name">
            <a class="prod" href="${ctx.url.software(vendor.id)}">
              ${logo(ctx, vendor, { lazy: i >= lazyFrom })}
              <span class="prod__text">
                <span class="prod__name">${vendor.name}</span>${s.recommended ? tag('Recommended', 'top') : ''}${vendor.id === focalId ? tag('You are comparing against this') : ''}
                <span class="prod__fit">${note || vendor.bestFor}</span>
              </span>
            </a>
          </th>
          <td class="ptable__c-score">${scoreToken(ctx, s)}</td>
          <td class="ptable__c-price">${priceCell(ctx, p)}</td>
          ${ai ? html`<td class="ptable__c-ai">${aiTag(ctx, vendor)}</td>` : ''}
        </tr>`;
      })}
    </tbody>
  </table>`;
}

/** The one-line footnote under any scored table. */
export const tableNote = (ctx) =>
  html`<p class="table-note">Score = <a href="/methodology/">documented-fit score</a> out of 100, from official documentation checked as of ${time(ctx, ctx.catalog.checkedAt)} — not a user rating or a hands-on test. “Score pending” means less than 80% of the checklist weight has been checked. Prices are dated observations of public list prices, not quotes. No vendor pays for placement.</p>`;

// ------------------------------------------------------------------ text blocks
/** Answer-first summary. `text` may be a Raw fragment with <strong>. */
export const answer = (ctx, text, { label = 'Quick answer', meta } = {}) =>
  html`<div class="answer"><span class="answer__label">${label}</span><p>${text}</p>${meta ? html`<p class="fineprint">${meta}</p>` : ''}</div>`;

/** Trust strip under a title. items: array of strings / Raw fragments. */
export const trustline = (items) => html`<p class="trustline">${items.filter(Boolean).map((i) => html`<span>${i}</span>`)}</p>`;

export const sectionHead = (title, { id, sub, link, level = 2 } = {}) => {
  const h = raw(`h${level}`);
  return html`<div class="section-head">
    <div><${h}${attrs({ id })}>${title}</${h}>${sub ? html`<p>${sub}</p>` : ''}</div>
    ${link ? html`<a class="section-head__link link-arrow" href="${link.href}">${link.label}</a>` : ''}
  </div>`;
};

/**
 * FAQ accordion. items: [{q, a}] — `a` plain text or a Raw fragment (plain text is what goes to JSON-LD,
 * so pass page.faq = items.map(({q, a}) => ({q, a: text(a)})) to the layout).
 */
export function faq(ctx, items, { id = 'faq', heading = 'Questions buyers ask', level = 2, open = 1, sub } = {}) {
  if (!items || !items.length) return '';
  const h = raw(`h${level}`);
  const qh = raw(`h${level + 1}`);
  return html`<section id="${id}" aria-labelledby="${id}-h">
    <div class="section-head"><div><${h} id="${id}-h">${heading}</${h}>${sub ? html`<p>${sub}</p>` : ''}</div></div>
    <div class="acc">
      ${items.map(
        (f, i) => html`<details${attrs({ open: i < open, id: f.id || null })}>
          <summary><${qh}>${f.q}</${qh}></summary>
          <div class="acc__body">${typeof f.a === 'string' ? html`<p>${f.a}</p>` : f.a}${f.more ? html`<p>${f.more}</p>` : ''}</div>
        </details>`,
      )}
    </div>
  </section>`;
}

/** Dense list of links. items: [{href, title, sub?, meta?}] */
export const linkList = (items, { cols = 2 } = {}) =>
  html`<ul class="${cx('linklist', cols > 1 && `linklist--${cols}`)}">
    ${items.map((it) => html`<li><a href="${it.href}"><span>${it.title}${it.sub ? html`<small>${it.sub}</small>` : ''}</span>${it.meta ? html`<span>${it.meta}</span>` : ''}</a></li>`)}
  </ul>`;

/** Navigation tile (index pages only). */
export const tile = ({ href, title, text, meta }) =>
  html`<a class="tile" href="${href}"><b>${title}</b>${text ? html`<span>${text}</span>` : ''}${meta ? html`<em>${meta}</em>` : ''}</a>`;

/** Label/value pairs. items: [{label, value, sub?}] */
export const facts = (items, { cols } = {}) =>
  html`<dl class="${cx('facts', cols === 3 && 'facts--3')}">
    ${items.filter(Boolean).map((f) => html`<div><dt>${f.label}</dt><dd>${f.value}${f.sub ? html`<small>${f.sub}</small>` : ''}</dd></div>`)}
  </dl>`;

/** Numbered list of cited sources. sources: [{label, url}] */
export const sources = (list, { cols = 2 } = {}) =>
  html`<ol class="${cx('sources', cols > 1 && 'sources--2')}">
    ${list.map((s) => html`<li>${s.url ? html`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.label || s.title || s.url}</a>` : s.label || s.title}${s.note ? html` — ${s.note}` : ''}</li>`)}
  </ol>`;

/** Sticky in-page section tabs. items: [{href:'#pricing', label}] */
export const subnav = (items, { label = 'On this page' } = {}) =>
  html`<nav class="subnav" aria-label="${label}" data-subnav data-nosnippet><div class="wrap"><ul>${items.map((it) => html`<li><a href="${it.href}">${it.label}</a></li>`)}</ul></div></nav>`;

/** "On this page" rail for long reading pages. */
export const toc = (items, { title = 'On this page' } = {}) =>
  html`<nav class="toc" aria-label="${title}" data-toc data-nosnippet><h2>${title}</h2><ul>${items.map((it) => html`<li><a href="${it.href}">${it.label}</a></li>`)}</ul></nav>`;

/** Chip links (navigation shortcuts). items: [{href, label}] */
export const chipLinks = (items) => html`<div class="chips">${items.map((it) => html`<a class="chip chip--link" href="${it.href}">${it.label}</a>`)}</div>`;

export const ticks = (items, kind = 'ticks') => html`<ul class="${kind}">${items.map((t) => html`<li>${t}</li>`)}</ul>`;

/** Search field used on the home hero and the search page. Submits to /search/?q= without JS. */
export const searchField = (ctx, { id = 'q', placeholder = 'Search software, categories, comparisons…', value = '', autofocus = false, palette = true } = {}) =>
  html`<form class="searchfield" action="/search/" method="get" role="search" aria-label="Site search"${attrs({ 'data-search-form': palette || null })}>
    ${icon('search')}
    <label class="sr-only" for="${id}">Search software, categories, comparisons and guides</label>
    <input id="${id}" name="q" type="search" maxlength="120" autocomplete="off" spellcheck="false" placeholder="${placeholder}" value="${value}"${attrs({ autofocus: autofocus || null, 'data-search-input': palette || null })}>
    <kbd aria-hidden="true">/</kbd>
  </form>`;

export { icon, join };
