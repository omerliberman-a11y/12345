// Policy and trust pages: about, methodology ("How we score"), editorial policy, how we make money,
// corrections, privacy, terms, accessibility, partners.
//
// The body text of every page is the publisher's own HTML (catalog.pages[path].html, or the captured
// server-only HTML for /how-we-make-money/ and the privacy suffix). It is printed verbatim: the only
// post-processing is adding ids to headings (for the "On this page" list), wrapping a leading
// "Effective/Updated <date>" in <time>, and swapping legacy class names for the new design system.
//
// Exports the small reading-page toolkit (prepareHtml, liftLead, docLayout …) that countries.mjs,
// contact.mjs and partners-apply.mjs reuse.

import { html, raw, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';

// ------------------------------------------------------------------ toolkit (shared with sibling modules)
export const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const RESERVED_IDS = ['main', 'page-data', 'sc-search-engine', 'related', 'top'];

/**
 * Add ids to the headings of publisher HTML (text untouched) and optionally demote them.
 * Returns { html, headings: [{ level, id, label }] }.
 */
export function prepareHtml(src, { demote = 0, reserved = [] } = {}) {
  const used = new Set([...RESERVED_IDS, ...reserved]);
  const headings = [];
  const out = String(src || '').replace(/<h([2-4])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g, (m, lvl, attr = '', inner) => {
    const level = Number(lvl) + demote;
    let id = (attr.match(/\sid="([^"]+)"/) || [])[1];
    if (!id) {
      const base = slug(text(inner)) || 'section';
      id = base;
      let n = 2;
      while (used.has(id)) id = `${base}-${n++}`;
    }
    used.add(id);
    headings.push({ level, id, label: text(inner) });
    return `<h${level}${attr.replace(/\sid="[^"]+"/, '')} id="${id}">${inner}</h${level}>`;
  });
  return { html: wrapDates(out), headings };
}

const MONTH_NAMES = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_RE = new RegExp(`\\b(?:(\\d{1,2}) (${MONTH_NAMES}) (\\d{4})|(${MONTH_NAMES}) (\\d{1,2}), (\\d{4}))\\b`, 'g');
/**
 * Wrap dates written out in publisher prose ("13 November 2026", "October 25, 2026") in <time datetime>.
 * Only text nodes are touched (never attributes), the wording is unchanged, and text already inside a
 * <time> element is left alone.
 */
export function wrapDates(src) {
  let inTime = 0;
  return String(src || '').replace(/<[^>]+>|[^<]+/g, (part) => {
    if (part[0] === '<') {
      if (/^<time[\s>]/i.test(part)) inTime++;
      else if (/^<\/time>/i.test(part)) inTime = Math.max(0, inTime - 1);
      return part;
    }
    if (inTime) return part;
    return part.replace(DATE_RE, (m, d1, mo1, y1, mo2, d2, y2) => {
      const month = MONTH_NAMES.split('|').indexOf(mo1 || mo2) + 1;
      const iso = `${y1 || y2}-${String(month).padStart(2, '0')}-${String(d1 || d2).padStart(2, '0')}`;
      return `<time datetime="${iso}">${m}</time>`;
    });
  });
}

/** Split a leading <p class="lead">…</p> off publisher HTML → { lead (inner HTML or null), rest }. */
export function liftLead(src) {
  const m = String(src || '').match(/^\s*<p class="lead">([\s\S]*?)<\/p>\s*/);
  return m ? { lead: m[1], rest: String(src).slice(m[0].length) } : { lead: null, rest: String(src || '') };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/**
 * Legal pages state their date in prose ("Effective October 25, 2026. …"). Wrap that date in <time>
 * (text unchanged) and return it so the page head and JSON-LD can use it. Nothing is invented: when the
 * text has no such date, `date` is null.
 */
export function liftProseDate(src) {
  let date = null;
  let kind = null;
  const out = String(src || '').replace(/^(\s*<p>)(Effective|Updated) ([A-Z][a-z]+) (\d{1,2}), (\d{4})\./, (m, open, word, month, day, year) => {
    const mi = MONTHS.indexOf(month.toLowerCase());
    if (mi < 0) return m;
    date = `${year}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    kind = word;
    return `${open}${word} <time datetime="${date}">${month} ${day}, ${year}</time>.`;
  });
  return { html: out, date, kind };
}

/** Labels for the cross-links between the trust, legal and vendor pages (one name per page, site-wide). */
export const PAGE_LINKS = {
  '/about/': { title: 'About the publisher', sub: 'Who publishes System Compare US and who approves it' },
  '/methodology/': { title: 'How we score', sub: 'The documented-fit score, step by step' },
  '/editorial-policy/': { title: 'Editorial responsibility', sub: 'How sources are checked and who is accountable' },
  '/how-we-make-money/': { title: 'How we make money', sub: 'Affiliate links and what they cannot change' },
  '/corrections/': { title: 'Suggest a correction', sub: 'Report a price or a feature that needs attention' },
  '/faq/': { title: 'FAQ', sub: 'Short answers about scores, prices and dates' },
  '/research-updates/': { title: 'Research updates', sub: 'Dated checks, changes and open questions' },
  '/contact/': { title: 'Contact', sub: 'Write to the research and support team' },
  '/privacy/': { title: 'Privacy policy', sub: 'What the site stores and your choices' },
  '/terms/': { title: 'Terms of use', sub: 'The terms for using the research and tools' },
  '/accessibility/': { title: 'Accessibility', sub: 'Display preferences, keyboard support, known limits' },
  '/partners/': { title: 'Partners', sub: 'How a software supplier applies to be assessed' },
  '/partners/apply/': { title: 'Supplier application', sub: 'Free, no payment taken when you apply' },
  '/countries/': { title: 'System Compare worldwide', sub: 'Country editions and their languages' },
  '/categories/': { title: 'All categories', sub: 'Browse software by business workflow' },
};

export const relatedLinks = (paths, { heading = 'Related pages', id = 'related' } = {}) =>
  html`<section class="doc-related" aria-labelledby="${id}-h">
    <h2 id="${id}-h">${heading}</h2>
    ${ui.linkList(
      paths.filter((p) => PAGE_LINKS[p]).map((p) => ({ href: p, title: PAGE_LINKS[p].title, sub: PAGE_LINKS[p].sub })),
      { cols: 2 },
    )}
  </section>`;

/** "On this page": the sticky rail on wide screens and a closed <details> above the text elsewhere. */
function tocBlocks(toc) {
  if (!toc || toc.length < 3) return { rail: '', inline: '' };
  const items = toc.map((t) => ({ href: `#${t.id}`, label: t.sub ? html`<span class="doc-toc-sub">${t.label}</span>` : t.label }));
  return {
    rail: html`<aside class="doc-rail">${ui.toc(items)}</aside>`,
    inline: html`<details class="doc-toc-m" data-nosnippet>
      <summary>On this page</summary>
      <ul>
        ${toc.map((t) => html`<li><a href="#${t.id}"${raw(t.sub ? ' class="doc-toc-sub"' : '')}>${t.label}</a></li>`)}
      </ul>
    </details>`,
  };
}

/**
 * The reading layout used by every page in this group: a narrow page head (same measure as /faq/),
 * then the text column with an optional "On this page" rail in the right margin.
 *   head:  { eyebrow, h1, lede (Raw|string), meta: [trustline items], after (Raw) }
 *   main:  Raw — the content of the text column
 *   toc:   [{ id, label, sub? }]
 *   wide:  true → full site width, left-aligned like the category pages (for pages built around a table)
 */
export function docLayout({ head, main, toc, cls = '', wide = false }) {
  const t = tocBlocks(toc);
  if (wide) cls = `doc-layout--wide ${cls}`;
  return html`<header class="wrap ${wide ? 'page-head--wide' : 'wrap--narrow'} page-head doc-head">
      ${head.eyebrow ? html`<p class="eyebrow">${head.eyebrow}</p>` : ''}
      <h1${raw(head.h1Id ? ` id="${head.h1Id}"` : '')}>${head.h1}</h1>
      ${head.lede ? html`<p class="lede">${head.lede}</p>` : ''}
      ${head.meta && head.meta.filter(Boolean).length ? ui.trustline(head.meta) : ''}
      ${head.after || ''}
    </header>
    <div class="doc-layout ${cls}">
      <div class="doc-main">
        ${t.inline}
        ${main}
      </div>
      ${t.rail}
    </div>`;
}

// ------------------------------------------------------------------ routes
const POLICY = {
  '/about/': { pageType: 'AboutPage', fullOrg: true, accountable: true, related: ['/methodology/', '/editorial-policy/', '/how-we-make-money/', '/corrections/', '/contact/', '/countries/'] },
  '/editorial-policy/': { accountable: true, related: ['/methodology/', '/how-we-make-money/', '/corrections/', '/research-updates/', '/about/', '/faq/'] },
  '/how-we-make-money/': { related: ['/methodology/', '/editorial-policy/', '/partners/', '/privacy/', '/faq/', '/contact/'] },
  '/corrections/': { related: ['/contact/', '/editorial-policy/', '/methodology/', '/research-updates/', '/partners/', '/faq/'] },
  '/privacy/': { related: ['/terms/', '/accessibility/', '/how-we-make-money/', '/contact/'] },
  '/terms/': { related: ['/privacy/', '/accessibility/', '/partners/', '/contact/'] },
  '/accessibility/': { related: ['/privacy/', '/terms/', '/contact/', '/faq/'] },
  '/partners/': { related: ['/partners/apply/', '/methodology/', '/how-we-make-money/', '/editorial-policy/', '/terms/', '/privacy/'] },
};

export function routes() {
  return [
    ...Object.keys(POLICY).map((path) => ({ path, render: (ctx) => renderPolicy(ctx, path) })),
    { path: '/methodology/', render: renderMethodology },
  ];
}

const stripSuffix = (title) => String(title || '').replace(/ \| System Compare( US)?$/, '');

/** Source HTML + H1 for a policy page (catalog, or the captured server-only content). */
function sourceFor(ctx, path) {
  const server = ctx.content.staticServer;
  if (path === '/how-we-make-money/') {
    const src = server.how_we_make_money_main_html;
    const h1 = text((src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || 'How we make money');
    const body = src
      .replace(/<nav class="crumb"[\s\S]*?<\/nav>/, '')
      .replace(/<article[^>]*>/, '')
      .replace(/<\/article>\s*$/, '')
      .replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '');
    return { h1, body, modifiedAt: null };
  }
  const page = ctx.pages[path];
  if (!page) throw new Error(`catalog.pages has no entry for ${path}`);
  let body = page.html;
  if (path === '/privacy/') {
    // the contact notice the live server appends to the privacy page (not in the catalog)
    body += server.privacy_server_added_suffix_html.replace(/^<section[^>]*>/, '').replace(/<\/section>\s*$/, '');
  }
  if (path === '/partners/') {
    // The page's one call to action moves into the page head (same link, same label); the body keeps
    // every sentence. The five onboarding steps get the numbered-steps style.
    body = body.replace(/<p>\s*<a class="button" href="\/partners\/apply\/">[\s\S]*?<\/a>\s*<\/p>/, '').replace('<ol>', '<ol class="steps">');
  }
  return { h1: page.title, body, modifiedAt: page.modifiedAt || null };
}

function renderPolicy(ctx, path) {
  const spec = POLICY[path];
  const live = ctx.liveHead(path) || {};
  const src = sourceFor(ctx, path);
  const { lead, rest } = liftLead(src.body);
  const dated = liftProseDate(rest);
  const { html: bodyHtml, headings } = prepareHtml(dated.html);
  const toc = headings.filter((h) => h.level === 2).map((h) => ({ id: h.id, label: h.label }));
  const p = ctx.site.publisher;

  const meta = [];
  if (src.modifiedAt) meta.push(html`Content updated ${ui.time(ctx, src.modifiedAt)}`);
  else if (dated.date) meta.push(html`${dated.kind} ${ui.time(ctx, dated.date)}`);
  let after = '';
  let extra = '';

  if (path === '/about/') {
    meta.push(html`Research updated ${ui.time(ctx, ctx.catalog.researchUpdatedAt)}`, html`<a href="/methodology/">Method version ${ctx.catalog.scoringVersion}</a>`);
    after = html`<div class="stats doc-stats">
      <div><b class="num">${ctx.vendors.length}</b><span>product profiles</span></div>
      <div><b class="num">${ctx.categories.length}</b><span>software categories</span></div>
      <div><b class="num">${ctx.comparisons.length}</b><span>head-to-head comparisons</span></div>
      <div><b class="num">${ctx.guides.length}</b><span>buying guides</span></div>
    </div>`;
    extra = html`<section class="doc-related" aria-labelledby="start-h">
      <h2 id="start-h">Start here</h2>
      ${ui.linkList(
        [
          { href: '/categories/', title: 'Explore by business workflow', sub: `${ctx.categories.length} categories in ${ctx.groups.length} groups` },
          { href: '/compare/', title: 'Compare products side by side', sub: 'Documented capabilities, one published method' },
          { href: '/ai/', title: 'AI capability research', sub: 'Assistance versus agents that take action' },
          { href: '/tools/cost/', title: 'Total cost calculator', sub: 'Estimate ownership costs before a demo' },
          { href: '/software/', title: 'Software directory', sub: `${ctx.vendors.length} profiles, each claim linked to its source` },
          { href: '/research-updates/', title: 'Research updates', sub: 'Dated checks, changes and open questions' },
        ],
        { cols: 2 },
      )}
    </section>`;
  }
  if (path === '/editorial-policy/') {
    meta.push('Desk research from official sources, not hands-on testing');
  }
  if (path === '/how-we-make-money/') {
    after = html`<div class="doc-answer">
      ${ui.answer(
        ctx,
        html`Some supplier links are affiliate links. Each one is labelled <strong>“Ad · affiliate link”</strong>, and we may receive a commission when a purchase is attributed to it. Suppliers can also buy a research and onboarding service through the <a href="/partners/">Partners program</a>. Neither changes a score or a ranking: no vendor pays for placement.`,
        { label: 'In short' },
      )}
    </div>`;
  }
  if (path === '/corrections/') {
    after = html`<p class="cluster doc-actions">
      <a class="btn" href="/contact/?topic=correction">Send a correction</a>
      <a class="btn btn--ghost" href="mailto:${p.supportEmail}?subject=System%20Compare%20US%20correction">Email ${p.supportEmail}</a>
    </p>`;
  }
  if (path === '/privacy/') {
    after = html`<p class="cluster doc-actions" data-nosnippet>
      <button type="button" class="btn" data-privacy-open>Open privacy choices</button>
      <a class="btn btn--ghost" href="/contact/?topic=privacy">Send a privacy request</a>
    </p>`;
  }
  if (path === '/accessibility/') {
    after = html`<p class="cluster doc-actions" data-nosnippet>
      <button type="button" class="btn" data-a11y-open>Open accessibility options</button>
      <a class="btn btn--ghost" href="mailto:${p.supportEmail}?subject=System%20Compare%20accessibility">Report a barrier</a>
    </p>`;
  }
  if (path === '/partners/') {
    meta.push('For businesses that represent a software supplier', html`<a href="/methodology/">Payment never changes a score</a>`);
    after = html`<div class="doc-cta">
      <a class="btn btn--lg" href="/partners/apply/">Apply for supplier onboarding</a>
      <p class="fineprint">Applying is free and creates no listing or payment obligation.</p>
    </div>`;
  }

  const body = docLayout({
    cls: `doc-layout--${path.replace(/\//g, '')}`,
    head: { h1: src.h1, lede: lead ? raw(lead) : '', meta, after },
    toc,
    main: html`<article class="prose doc-prose">${raw(bodyHtml)}</article>
      ${extra}
      ${relatedLinks(spec.related)}`,
  });

  const name = stripSuffix(live.title) || src.h1;
  const seo = ctx.seo;
  const pageExtra = {};
  if (path === '/about/') pageExtra.mainEntity = { '@id': seo.ORG_ID };
  if (path === '/editorial-policy/') {
    pageExtra.about = { '@id': seo.ORG_ID };
    if (seo.accountable()) pageExtra.mainEntity = seo.accountable();
  }

  return {
    title: live.title || `${src.h1} | System Compare US`,
    description: live.description || ctx.pages[path]?.description,
    body,
    breadcrumbs: [{ name, url: path }],
    pageType: spec.pageType || 'WebPage',
    pageExtra,
    fullOrg: Boolean(spec.fullOrg),
    accountable: Boolean(spec.accountable),
    dateModified: src.modifiedAt || dated.date || undefined,
  };
}

// ------------------------------------------------------------------ /methodology/ — "How we score"
// The "jump to a category" control is wired by src/assets/js/methodology.js.

/** Checklist rows of a scored category: label, score group, counts-toward-the-score flag, points. */
function checklistRows(ctx, category) {
  const first = ctx.summary(category.id).ranked[0];
  if (first) return ctx.fit(category.id, first.id).rows;
  const active = new Set(category.scoring?.activeFeatureIds || []);
  return (category.features || []).map((f) => ({ ...f, scoringGroup: category.scoring?.featureGroups?.[f.id] || null, active: active.has(f.id), weight: 0 }));
}

function renderMethodology(ctx) {
  const path = '/methodology/';
  const page = ctx.pages[path];
  const live = ctx.liveHead(path) || {};
  const sc = ctx.scoring;
  const pt = sc.pointText;
  const GROUPS = sc.SCORE_GROUPS;
  const version = ctx.catalog.scoringVersion;
  const checkedAt = ctx.catalog.checkedAt;

  const { lead, rest } = liftLead(page.html);
  const { html: fullHtml, headings } = prepareHtml(rest, {
    demote: 1,
    reserved: ['documented-fit-score', 'score-in-one-minute', 'worked-example', 'full-method', 'checklists', 'documentary', 'weights', 'values', 'rules', 'doc-jump'],
  });

  // ---- the published one-sentence method (verbatim), with its date as <time>
  const sentence = sc.LABELS.methodSentence;
  const [sBefore, sAfter] = sentence.split('<date>');
  const methodSentence = html`${sBefore}${ui.time(ctx, checkedAt)}${sAfter}`;

  // ---- group descriptions and item values, read from the publisher's own text (fallback: labels only)
  const groupText = [...page.html.matchAll(/<li>\s*<strong>([^:<]+):\s*(\d+)\.<\/strong>\s*([\s\S]*?)<\/li>/g)].map((m) => ({ weight: Number(m[2]), desc: text(m[3]) }));
  const groupDesc = (g, i) => (groupText.length === GROUPS.length && groupText[i].weight === g.weight ? groupText[i].desc : '');
  const VALUES = [
    { st: 'yes', name: 'Supported', value: '1', when: 'Official documentation establishes the complete defined capability.' },
    { st: 'partial', name: 'Limited or paid add-on', value: '0.5', when: 'Documented partial capability, or a separate paid add-on.' },
    { st: 'no', name: 'Not supported', value: '0', when: 'Official documentation explicitly establishes absence.' },
    { st: 'unknown', name: 'Not verified', value: '0', when: 'No qualifying official source and checked date. Excluded from checked coverage; not a claim that the capability is absent.' },
  ];

  const oneMinute = html`<section class="doc-sec" id="score-in-one-minute" aria-labelledby="score-in-one-minute-h">
    <h2 id="score-in-one-minute-h">The score in one minute</h2>
    <p id="documented-fit-score" class="doc-def">
      The <dfn>documented-fit score</dfn> is a whole number from 0 to 100: the weighted share of a category’s checklist that official vendor documentation supports. It describes documented support, not product quality — it is not a user rating and not a hands-on test.
    </p>

    <h3 id="weights">Four groups, 100 points</h3>
    <table class="dtable doc-table">
      <caption class="sr-only">Score groups and their weights</caption>
      <thead><tr><th scope="col">Group</th><th scope="col" class="num">Weight</th></tr></thead>
      <tbody>
        ${GROUPS.map(
          (g, i) => html`<tr>
            <th scope="row">${g.label}${groupDesc(g, i) ? html`<small>${groupDesc(g, i)}</small>` : ''}</th>
            <td class="doc-table__w"><b class="num">${g.weight}</b><span class="meter" aria-hidden="true"><i style="width:${Math.round((g.weight / GROUPS[0].weight) * 100)}%"></i></span></td>
          </tr>`,
        )}
      </tbody>
    </table>
    <p class="fineprint">Every check belongs to one group. A group with no active check is left out and the remaining weights are scaled to 100. Checks in a group share its weight equally.</p>

    <h3 id="values">What each check earns</h3>
    <table class="dtable doc-table">
      <caption class="sr-only">Share of a check’s points earned by each evidence status</caption>
      <thead><tr><th scope="col">Status</th><th scope="col" class="num">Value</th></tr></thead>
      <tbody>
        ${VALUES.map(
          (v) => html`<tr>
            <th scope="row">${ui.status(v.st, { iconOnly: true })} ${v.name}<small>${v.when}</small></th>
            <td class="num"><b class="num">${v.value}</b></td>
          </tr>`,
        )}
      </tbody>
    </table>
    <p class="fineprint">The value is the share of the check’s points that it earns: all, half or none.</p>

    <h3 id="rules">Rules that apply to every category</h3>
    <dl class="doc-rules">
      <div><dt>The ${sc.SCORE_GATE_PERCENT}% gate</dt><dd>A score is shown only when at least ${sc.SCORE_GATE_PERCENT}% of the active checklist weight has a checked status. Below that the product shows “Score pending” with how much has been checked.</dd></div>
      <div><dt>Whole numbers</dt><dd>The score is rounded once to a whole number; half values round away from zero. There are no ranges and no second score.</dd></div>
      <div><dt>Ties</dt><dd>Every product that shares the highest displayed score in a category is labelled Recommended.</dd></div>
      <div><dt>Order</dt><dd>Scored products come before pending ones. Equal displayed scores are ordered by unrounded score, then coverage, then fully documented checks, then name. Pending products are ordered by name.</dd></div>
    </dl>
    <blockquote class="doc-quote">
      <p>${methodSentence}</p>
      <footer>The sentence printed with every ranking on this site.</footer>
    </blockquote>
  </section>`;

  // ---- worked example, computed from the live data (CRM: the lowest published score shows every rule)
  const exCat = ctx.category('crm') || ctx.scoredCategories[0];
  const exRanked = ctx.summary(exCat.id).ranked;
  const exScored = exRanked.filter((v) => !ctx.score(exCat.id, v.id).pending);
  const exVendor = [...exScored].reverse().find((v) => ctx.score(exCat.id, v.id).rows.some((r) => r.active && r.value < 1)) || exScored[exScored.length - 1];
  let example = '';
  if (exVendor) {
    const s = ctx.score(exCat.id, exVendor.id);
    const activeRows = s.rows.filter((r) => r.active);
    const groups = s.groups.filter((g) => g.totalCount > 0);
    const omitted = s.groups.filter((g) => g.totalCount === 0);
    const baseSum = groups.reduce((n, g) => n + g.baseWeight, 0);
    const leader = exScored[0];
    const leaderScore = ctx.score(exCat.id, leader.id);
    const tied = ctx.summary(exCat.id).recommended;
    const pendingEx = exRanked
      .filter((v) => ctx.score(exCat.id, v.id).pending)
      .sort((a, b) => ctx.score(exCat.id, b.id).coveragePct - ctx.score(exCat.id, a.id).coveragePct)[0];
    const ps = pendingEx ? ctx.score(exCat.id, pendingEx.id) : null;
    const link = (v) => html`<a href="${ctx.url.software(v.id)}">${v.name}</a>`;
    // Exact figures for the arithmetic (the site's point display rounds to one decimal, which can make
    // the visible parts add up to 100.1 or 48 instead of 100 and 48.2).
    const exact = (n) => String(Math.round(n * 100) / 100);
    const shared = groups.find((g) => g.totalCount > 1 && exact(g.weight / g.totalCount) !== pt(g.weight / g.totalCount)) || groups.find((g) => g.totalCount > 1);

    example = html`<section class="doc-sec" id="worked-example" aria-labelledby="worked-example-h">
      <h2 id="worked-example-h">Worked example: ${exVendor.name}, ${s.valueText}</h2>
      <p>
        ${link(exVendor)} in <a href="${ctx.url.category(exCat.id)}">${exCat.name}</a> has a documented-fit score of <strong>${s.valueText}</strong>
        (evidence checked ${ui.time(ctx, s.checkedAt)}). These are the real numbers behind it.
      </p>
      <ol class="steps doc-steps">
        <li>
          <b>Which checks count.</b>
          The ${exCat.name} checklist has ${s.rows.length} checks. ${activeRows.length} count toward the score today; the other ${s.rows.length - activeRows.length} are deep checks that have not yet been checked for every product, so they carry no weight for anyone.
        </li>
        <li>
          <b>Which groups are active.</b>
          The ${activeRows.length} scored checks fall into ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}: ${ctx.listText(groups.map((g) => `${g.label} (${g.totalCount})`))}.
          ${
            omitted.length
              ? html`No ${ctx.listText(omitted.map((g) => g.label))} check is active, so ${omitted.length === 1 ? 'that group is' : 'those groups are'} left out and ${groups.map((g) => g.baseWeight).join(' + ')} = ${baseSum} is scaled to 100: ${ctx.listText(groups.map((g) => `${exact(g.weight)} points for ${g.label}`))}.`
              : ''
          }
        </li>
        <li>
          <b>What each check earns.</b>
          Checks in a group share its points equally${
            shared ? html` — each of the ${shared.totalCount} ${shared.label} checks is worth ${exact(shared.weight)} ÷ ${shared.totalCount} ${Number(exact(shared.weight / shared.totalCount)) === shared.weight / shared.totalCount ? '=' : '≈'} ${exact(shared.weight / shared.totalCount)} points` : ''
          }. A supported check earns all of its points, a limited one half, and a check that is not supported or not verified earns none.
        </li>
      </ol>
      <div class="scroller">
        <table class="dtable doc-ex">
          <caption class="sr-only">${exVendor.name} in ${exCat.name}: points per scored check</caption>
          <thead><tr><th scope="col">Scored check</th><th scope="col">Evidence</th><th scope="col" class="num">Points</th></tr></thead>
          ${groups.map(
            (g) => html`<tbody>
              <tr class="is-group"><th scope="colgroup" colspan="3">${g.label} · ${pt(g.earned)} of ${pt(g.weight)} points</th></tr>
              ${activeRows
                .filter((r) => r.scoringGroup === g.id)
                .map(
                  (r) => html`<tr>
                    <th scope="row">${r.label}</th>
                    <td>${ui.status(r.effectiveStatus)}</td>
                    <td class="num">${pt(r.earned)} of ${pt(r.weight)}</td>
                  </tr>`,
                )}
            </tbody>`,
          )}
          <tfoot>
            <tr><th scope="row">Total</th><td>${s.checked} of ${s.total} checked</td><td class="num"><b>${pt(s.raw.unroundedScore)} of 100</b></td></tr>
          </tfoot>
        </table>
      </div>
      <p class="fineprint">Points in the table are shown to one decimal place; the totals are added from the exact values.</p>
      <ol class="steps doc-steps" start="4">
        <li>
          <b>Add and round once.</b>
          ${groups.map((g) => pt(g.earned)).join(' + ')} = ${pt(s.raw.unroundedScore)} points, published as <strong>${s.valueText}</strong>.
        </li>
        <li>
          <b>Check the gate.</b>
          ${exVendor.name} has ${s.coverageText} — at or above the ${sc.SCORE_GATE_PERCENT}% gate, so the number is shown.
          ${
            ps
              ? html`${link(pendingEx)} has ${ps.coverageText}, below the gate, so it shows “Score pending” and no number.`
              : ''
          }
        </li>
        <li>
          <b>Rank.</b>
          ${exVendor.name} is number ${s.rank} of ${exRanked.length} in ${exCat.name}.
          ${
            tied.length > 1
              ? html`${tied.length} products share the top score of ${leaderScore.valueText} and all carry the Recommended label.`
              : html`${link(leader)} leads with ${leaderScore.valueText} and carries the Recommended label.`
          }
        </li>
      </ol>
      <div class="doc-breakdown">
        <p class="label">${exVendor.name}: points by group</p>
        ${ui.breakdown(ctx, s)}
      </div>
      <p class="fineprint">Numbers are generated from the published data each time the site is built. <a href="${ctx.url.category(exCat.id)}">See the full ${exCat.name} ranking</a>.</p>
    </section>`;
  }

  // ---- the publisher's full method text (verbatim)
  const fullMethod = html`<section class="doc-sec" id="full-method" aria-labelledby="full-method-h">
    <h2 id="full-method-h">The full method</h2>
    <p class="fineprint">Methodology version ${version}. The complete published text follows.</p>
    <div class="prose doc-prose doc-prose--sub">${raw(fullHtml)}</div>
  </section>`;

  // ---- per-category checklists
  const scored = ctx.scoredCategories;
  let totalChecks = 0;
  let totalActive = 0;
  const checklist = (category) => {
    const rows = checklistRows(ctx, category);
    const active = rows.filter((r) => r.active);
    totalChecks += rows.length;
    totalActive += active.length;
    const groups = GROUPS.map((g) => ({ g, on: active.filter((r) => r.scoringGroup === g.id), off: rows.filter((r) => !r.active && r.scoringGroup === g.id) })).filter((x) => x.on.length || x.off.length);
    // Compact markup on purpose: 33 categories × 28 checks live in this page's HTML (closed <details>).
    const group = ({ g, on, off }) => {
      const points = on.reduce((n, r) => n + r.weight, 0);
      const head = on.length
        ? `${pt(points)} points · ${on.length} scored ${on.length === 1 ? 'check' : 'checks'}${on.length > 1 ? `, ${pt(on[0].weight)} each` : ''}`
        : 'no scored check yet, so no weight today';
      return html`<div data-g="${g.id}"><p><b>${g.label}</b> <span>${head}</span></p>${
        on.length ? html`<ul class="ticks">${on.map((r) => html`<li>${r.label}</li>`)}</ul>` : ''
      }${off.length ? html`<p>Inactive deep ${off.length === 1 ? 'check' : 'checks'}, not scored yet (${off.length})</p><ul class="dots">${off.map((r) => html`<li>${r.label}</li>`)}</ul>` : ''}</div>`;
    };
    return html`<details class="doc-cl" id="checklist-${category.id}"><summary><span class="doc-cl__t"><b>${category.name} · ${rows.length} checks</b><span>${active.length} scored · ${rows.length - active.length} not scored yet</span></span></summary><div class="doc-cl__body">${groups.map(group)}<p class="doc-cl__more"><a class="link-arrow" href="${ctx.url.category(category.id)}">${category.name} ranking</a></p></div></details>`;
  };
  const byGroup = ctx.groups.map((grp) => ({ grp, cats: scored.filter((c) => ctx.groupOf(c) === grp) })).filter((x) => x.cats.length);
  const lists = byGroup.map(
    ({ grp, cats }) => html`<h3 class="doc-cl__group" id="checklists-${grp.id}">${grp.label}</h3>
      <div class="doc-cl__list">${cats.map(checklist)}</div>`,
  );
  const checklists = html`<section class="doc-sec" id="checklists" aria-labelledby="checklists-h">
    <h2 id="checklists-h">Checklists by category</h2>
    <p>
      Each of the ${scored.length} scored categories has its own checklist: ${totalChecks} checks in all, of which ${totalActive} count toward a score today.
      Every item has one group. An inactive deep check stays visible but contributes no weight until every listed vendor has a checked result. Groups with no active items are omitted and remaining group weights are normalized to 100.
    </p>
    <div class="field doc-jump" data-nosnippet>
      <label for="doc-jump">Open a category’s checklist</label>
      <div class="doc-jump__row">
        <select class="select" id="doc-jump" data-doc-jump>
          <option value="">Choose a category…</option>
          ${byGroup.map(({ grp, cats }) => html`<optgroup label="${grp.label}">${cats.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</optgroup>`)}
        </select>
        <button type="button" class="btn btn--ghost" data-doc-jump-go>Open</button>
      </div>
    </div>
    ${lists}
  </section>`;

  // ---- documentary categories (no score)
  const factual = ctx.factualCategories;
  const documentary = html`<section class="doc-sec" id="documentary" aria-labelledby="documentary-h">
    <h2 id="documentary-h">Categories without a score</h2>
    <p>
      ${factual.length} of the ${ctx.categories.length} categories are documentary. They list suppliers, plans, prices and dated official sources, but their evidence checklist has not yet been classified into the four score groups — so no supplier in them has a documented-fit score or a rank. Those pages say “${sc.LABELS.factualPending}”. Their evidence is published the same way, dated and linked to official sources; only the score is withheld.
    </p>
    <details class="doc-more">
      <summary>Show the ${factual.length} documentary categories</summary>
      ${ui.linkList(
        factual.map((c) => ({ href: ctx.url.category(c.id), title: c.name, meta: `${c.factual?.suppliers?.length || 0} suppliers` })),
        { cols: 2 },
      )}
    </details>
  </section>`;

  const toc = [
    { id: 'score-in-one-minute', label: 'The score in one minute' },
    { id: 'worked-example', label: 'Worked example' },
    { id: 'full-method', label: 'The full method' },
    ...headings.filter((h) => h.level === 3).map((h) => ({ id: h.id, label: h.label, sub: true })),
    { id: 'checklists', label: 'Checklists by category' },
    { id: 'documentary', label: 'Categories without a score' },
    { id: 'related-h', label: 'Questions and policies' },
  ].filter((t) => t.id !== 'worked-example' || example);

  const body = html`${docLayout({
      cls: 'doc-layout--methodology',
      head: {
        eyebrow: 'How we score',
        h1: page.title,
        lede: lead ? raw(lead) : '',
        meta: [
          `Method version ${version}`,
          page.modifiedAt ? html`Content updated ${ui.time(ctx, page.modifiedAt)}` : null,
          html`Evidence checked as of ${ui.time(ctx, checkedAt)}`,
          'Desk research, not hands-on testing',
        ],
        after: html`<div class="doc-answer">
          ${ui.answer(
            ctx,
            html`Score = the weighted share of a category’s checklist that official documentation supports, out of 100: <strong>core capabilities 45, integrations 20, local suitability 20, AI 15</strong>. A check that is not verified earns zero, and no score is shown until ${sc.SCORE_GATE_PERCENT}% of the checklist weight has been checked.`,
            { label: 'The formula' },
          )}
        </div>`,
      },
      toc,
      main: html`${oneMinute} ${example} ${fullMethod} ${checklists} ${documentary}
        ${relatedLinks(['/faq/', '/editorial-policy/', '/how-we-make-money/', '/corrections/', '/research-updates/', '/about/'], { heading: 'Questions and policies' })}`,
    })}`;

  const seo = ctx.seo;
  const termId = `${ctx.abs(path)}#documented-fit-score`;
  const activeBits = GROUPS.map((g) => `${g.id === 'ai' ? 'AI' : g.label.toLowerCase()} ${g.weight}`).join(', ');
  return {
    title: live.title || `${page.title} | System Compare US`,
    description: live.description || page.description,
    body,
    breadcrumbs: [{ name: stripSuffix(live.title) || page.title, url: path }],
    nav: 'methodology',
    scripts: ['js/methodology.js'],
    pageType: 'WebPage',
    pageExtra: { about: { '@id': termId } },
    accountable: true,
    dateModified: page.modifiedAt || undefined,
    jsonld: [
      {
        '@type': 'DefinedTerm',
        '@id': termId,
        name: 'Documented-fit score',
        description: `A 0–100 score: the weighted share of a category checklist that is documented in official vendor sources (${activeBits}; empty groups omitted and weights normalised). Unverified items score zero. Shown only when at least ${sc.SCORE_GATE_PERCENT}% of the checklist weight has been checked. Not a user rating or performance test.`,
        termCode: `documented-fit-score-v${version}`,
        url: ctx.abs(path),
        inDefinedTermSet: { '@type': 'DefinedTermSet', name: `System Compare methodology ${version}`, url: ctx.abs(path) },
      },
    ],
  };
}

export { stripSuffix };
