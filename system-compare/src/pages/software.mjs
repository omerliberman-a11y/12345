// Product profile /software/{id}/ — one template for all 149 vendors.
// Order: decision summary (score, price, actions) → quick answer + key facts → fit → pricing → capability
// evidence per category → AI → notes for US buyers → latest source check → alternatives → private notes →
// FAQ → sources. Scored checks are rows; the deep checks that are not scored yet sit in one closed <details>.

import { html, raw, text, cx, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes(ctx) {
  return ctx.vendors.map((vendor) => ({ path: ctx.url.software(vendor.id), render: (c) => render(c, vendor) }));
}

const GROUP_ORDER = ['core', 'integrations', 'local', 'ai'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (iso) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const hostOf = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// "hubspot.com/pricing/sales" — tells apart sources that share a generic label
const shortUrl = (url) => {
  try {
    const u = new URL(url);
    const tail = u.pathname.replace(/\/$/, '');
    const full = u.host.replace(/^www\./, '') + tail;
    return full.length > 48 ? full.slice(0, 47) + '…' : full;
  } catch {
    return '';
  }
};

// pricing.billing → label for the "Billing basis" fact and the plan table
const BILLING = { monthly: 'Monthly', annual: 'Annual', quote: 'By quote', usage: 'Usage-based', free: 'Free' };
const PLAN_BILLING = { annual: 'Annual commitment / prepayment', monthly: 'Monthly', quote: 'Quote', free: 'Free', usage: 'Usage-based' };
// vendor.researchReview labels (same wording as the research update log)
const REVIEW_STATUS = { partial: 'Scoped check with open questions', verified: 'Scoped source check complete' };
const REVIEW_FIELDS = { pricing: 'pricing and billing', tradeoffs: 'limitations', ai: 'AI scope and limits', strengths: 'documented strengths', description: 'product summary' };

function render(ctx, vendor) {
  const A = ctx.answers;
  const L = ctx.scoring.LABELS;
  const path = ctx.url.software(vendor.id);
  const name = vendor.name;
  const primary = ctx.primaryCategory(vendor);
  // the primary category (price context, hero score, default comparison scope) first, then catalog order
  const cats = [primary, ...ctx.vendorCategories(vendor).filter((c) => c.id !== primary.id)];
  const scores = new Map(cats.map((c) => [c.id, ctx.score(c.id, vendor.id)]));
  const s = scores.get(primary.id);
  const p = ctx.price(vendor, primary.id);
  const ai = vendor.ai || {};
  const aiLevel = ctx.aiLevel(vendor);
  const pricing = vendor.pricing || {};
  const updated = ctx.vendorUpdated(vendor);
  const review = vendor.researchReview || null;
  const summary = ctx.summary(primary.id);
  const others = summary.ranked.filter((v) => v.id !== vendor.id);
  const plural = ctx.plural;

  // ---------------------------------------------------------------- head
  const year = (ctx.maxDate(vendor.checkedAt, vendor.modifiedAt, pricing.verifiedAt) || '').slice(0, 4);
  const title =
    [`${name} pricing, features & AI`, `${name}: pricing & features`, `${name} pricing`, name].map((core) => seoTitle(core, year)).find((t) => t.includes('| System Compare') && !t.includes('…')) ||
    seoTitle(name, year);
  const live = ctx.liveHead(path) || {};
  // Description: what the product is (the curated summary sentence) first, then the score and price fact
  // when they fit in 155 characters. The summary alone is the fallback.
  const lead = A.stripDot(A.firstSentence(vendor.description));
  // the summary already names the product when it contains one of the name's own words ("Sales Hub combines …")
  const nameWords = name.split(/[^A-Za-z0-9.]+/).filter((w) => w.length >= 3);
  const named = nameWords.some((w) => lead.slice(0, 40).includes(w)) ? lead : `${name}: ${A.lowerFirst(lead)}`;
  const fact = s.pending ? `Score pending in ${primary.name}` : `${s.value}/100 documented fit in ${primary.name}`;
  const factPrice = p.hasAmount ? `, from ${A.pricePhrase(p)}` : '';
  const checkedMon = monYear(ctx.maxDate(vendor.checkedAt, pricing.verifiedAt));
  const description = describe([
    `${named}. ${fact}${factPrice}. Checked ${checkedMon}.`,
    `${named}. ${fact}${factPrice}.`,
    `${named}. ${fact}.`,
    `${lead}. ${fact}${factPrice}.`,
    `${lead}. ${fact}.`,
    `${named}.`,
    `${lead}.`,
    `${name} for ${primary.name}: ${fact}${factPrice}. AI, limits and official sources.`,
    live.description,
  ]);

  // ---------------------------------------------------------------- answers (generated from data)
  const quick = A.productQuickAnswer(vendor);
  const faqItems = A.productFaq(vendor);

  // ---------------------------------------------------------------- hero
  const chip = (c) => {
    const sc = scores.get(c.id);
    const total = ctx.summary(c.id).total;
    return html`<li><a class="chip chip--link" href="${ctx.url.category(c.id)}">${sc.pending ? html`${c.name} <span class="n">score pending</span>` : html`<b>${sc.placeLabel}</b> in ${c.name}`}</a>${sc.recommended ? html` ${ui.tag('Recommended', 'top')}` : ''}</li>`;
  };
  const planLine = p.plan ? html`<span class="price__unit">Plan: ${p.plan}</span>` : '';
  // Phones and tablets: score and starting price in one line under the name. It repeats the decision block
  // (which follows the answer there), so it is presentational only: aria-hidden, no links, and it sits AFTER
  // the answer in the source so the answer passage keeps its place near the top of <main>; CSS shows it under
  // the H1 (software.css). Wide screens show the decision block itself next to the title, and hide this line.
  const glanceLine = html`<p class="sw-glance" aria-hidden="true">${
    s.pending ? html`<span class="score">Score pending</span> in ${primary.name}` : html`<span class="score"><b>${s.value}</b>/100</span> documented fit in ${primary.name}`
  }<span class="sw-glance__sep"> · </span><span class="price">${p.hasAmount ? html`from <b>${p.headline}</b>${p.unitPhrase ? ` ${A.proseUnit(p.unitPhrase)}` : ''}` : p.headline}</span></p>`;
  const hero = html`<header class="wrap sw-hero">
    <div class="sw-hero__main">
      <div class="sw-hero__id">
        <span class="sw-logo">${ui.logo(ctx, vendor, { size: 'lg', wide: true, lazy: false })}</span>
        <h1>${name}</h1>
      </div>
      <p class="lede">${vendor.description}</p>
      <ul class="sw-cats" aria-label="Categories and published rank">${cats.map(chip)}</ul>
    </div>
    <div class="sw-hero__foot">
      ${ui.trustline(
        [
          html`Checked ${ui.time(ctx, vendor.checkedAt)}`,
          html`<a href="#evidence">${plural(vendor.sources.length, 'official source')}</a>`,
          // phones: said in the answer's note, which the "Show the full answer" disclosure opens
          { more: 'Desk research, not a hands-on test' },
          html`<a href="/methodology/">How we score</a>`,
        ],
        { compact: true },
      )}
      ${ui.answer(ctx, quick, {
        meta: html`The documented-fit score is the share of the category checklist documented in official sources. It is not a customer rating or a hands-on test. <a href="/methodology/">How we score</a>`,
        more: true,
      })}
    </div>
    ${glanceLine}
    <div class="sw-hero__side">
      <div class="sw-side__score">
        <a class="sw-side__ring" href="#capabilities" title="See the capability evidence">${ui.scoreRing(ctx, s)}</a>
        <div>
          <div class="sw-side__label">Documented-fit score ${ui.scoreHelp(ctx, { align: 'right' })}</div>
          <p class="sw-side__cat">in <a href="${ctx.url.category(primary.id)}">${primary.name}</a></p>
          <p class="sw-side__cov">${s.coverageText}</p>
          ${s.pending ? html`<p class="sw-side__cov">${L.scoreGate}</p>` : ''}
        </div>
      </div>
      <div class="sw-side__price">
        <p class="sw-side__label">Starting price</p>
        <span class="${cx('price price--lg')}">
          ${p.hasAmount ? html`<span class="price__main num">${p.headline}</span>` : html`<span class="price__main price__main--text">${p.headline}</span>`}
          ${[p.unit, p.billingNote].filter(Boolean).length ? html`<span class="price__unit">${[p.unit, p.billingNote].filter(Boolean).join(' · ')}</span>` : ''}
          ${planLine}
          ${p.checkedAt ? html`<span class="price__unit">Price checked ${ui.time(ctx, p.checkedAt)}</span>` : ''}
        </span>
        <p class="sw-side__more">${ui.outLink(ctx, vendor, { intent: 'pricing', from: 'profile-pricing', cls: 'sw-link' })}</p>
      </div>
      <div class="sw-side__cta">
        ${ui.outLink(ctx, vendor, { intent: 'website', from: 'profile', cls: 'btn' })}
        ${ui.shortlistButton(ctx, vendor, primary.id)}
        <a class="link-arrow sw-side__alts" href="${ctx.url.alternatives(vendor.id)}">${others.length === 1 ? '1 alternative' : `${others.length} alternatives`}</a>
      </div>
    </div>
  </header>`;

  // ---------------------------------------------------------------- key facts
  // Each fact is said once on the page: the scores are in the hero (ring + category chips) and in the
  // capability tabs, "Best for" / "Look closely when" open the Fit section right below — so Key facts keeps
  // the rest. Open on wide screens; software.js closes it on phones, where it would be a screen and more.
  const facts = [
    { label: cats.length > 1 ? 'Categories' : 'Category', value: cats.map((c, i) => html`${i ? ', ' : ''}<a href="${ctx.url.category(c.id)}">${c.name}</a>`), wide: cats.length > 1 },
    {
      label: 'Starting price',
      value: p.hasAmount
        ? html`<b>${p.headline}</b> ${[p.unit, p.billingNote].filter(Boolean).join(', ')}${p.plan ? html` · plan: ${p.plan}` : ''}`
        : /not verified/i.test(p.headline)
          ? 'No verified public starting price'
          : `No verified public starting price (${p.headline.toLowerCase()})`,
    },
    { label: 'Pricing model', value: `${p.modelLabel}${pricing.billing ? ` · billing: ${pricing.billing}` : ''}` },
    { label: 'Price checked', value: p.checkedAt ? ui.time(ctx, p.checkedAt) : 'Not recorded' },
    cats.length === 1 && { label: 'Capability evidence checked', value: s.checkedAt ? ui.time(ctx, s.checkedAt) : 'No checked evidence yet' },
    { label: 'AI', value: html`${aiLevel.label}` },
    { label: 'Official sources', value: html`<a href="#evidence">${plural(vendor.sources.length, 'source')} and ${plural(vendor.evidence.length, 'evidence item')}</a>` },
    { label: 'Official website', value: ui.outLink(ctx, vendor, { intent: 'website', from: 'profile-facts', cls: '', label: hostOf(vendor.url) || name }) },
  ].filter(Boolean);
  const brief = html`<div class="wrap sw-brief">
    <details class="sw-more sw-kfbox" open data-sw-kf>
      <summary>Key facts: ${name}</summary>
      <table class="sw-kf">
        <caption class="sr-only">Key facts: ${name}</caption>
        <tbody>
          ${facts.map((f) => html`<tr${attrs({ class: f.wide ? 'sw-kf__wide' : null })}><th scope="row">${f.label}</th><td>${f.value}</td></tr>`)}
        </tbody>
      </table>
    </details>
  </div>`;

  const researched = cats.map((c) => ({ category: c, plans: ctx.scoring.researchedPlans(vendor, c.id) })).filter((x) => x.plans.length);
  const publishedVs = ctx.comparisonsFor(vendor.id).filter((c) => ctx.comparisonKind(c) !== 'factual');

  const nav = ui.subnav([
    { href: '#fit', label: 'Fit' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#capabilities', label: 'Capabilities' },
    { href: '#ai', label: 'AI' },
    { href: '#alternatives', label: 'Alternatives' },
    { href: '#faq', label: 'FAQ' },
    { href: '#evidence', label: 'Sources' },
  ], {
    // the shortlist stays one click away while reading (desktop). The vendor link is not repeated here:
    // an affiliate link needs its label and explainer next to it, and they do not fit the bar.
    extra: ui.shortlistButton(ctx, vendor, primary.id, { cls: 'btn btn--ghost btn--sm' }),
  });

  // ---------------------------------------------------------------- fit
  const fit = html`<section class="wrap section" id="fit" aria-labelledby="fit-h">
    ${ui.sectionHead(`Who is ${name} a good fit for?`, { id: 'fit-h' })}
    <div class="proscons sw-fit">
      <div>
        <h3>Best for</h3>
        <p class="sw-fit__lead">${vendor.bestFor}</p>
        ${vendor.strengths?.length ? html`<p class="sw-over">Documented strengths</p>${ui.ticks(vendor.strengths)}` : ''}
      </div>
      <div>
        <h3>Look closely when</h3>
        <p class="sw-fit__lead">${vendor.avoidIf}</p>
        ${vendor.tradeoffs?.length ? html`<p class="sw-over">Trade-offs to check</p>${ui.ticks(vendor.tradeoffs, 'crosses')}` : ''}
      </div>
    </div>
  </section>`;

  // ---------------------------------------------------------------- pricing
  const money = (amount, currency) => ctx.fmtMoney(amount, currency || 'USD');
  const planOptions = vendor.planOptions?.length
    ? html`<div class="sw-sub" id="plan-options">
        <h3>Plans and feature boundaries</h3>
        <p class="fineprint">The feature score covers the product across documented plans. This table shows package differences; it does not claim that every scored feature is included in the starting price.</p>
        <table class="dtable sw-plans-table">
          <caption class="sr-only">${name}: published plans, prices, inclusions and limits</caption>
          <thead><tr><th scope="col">Plan</th><th scope="col">Published price</th><th scope="col">Documented inclusions</th><th scope="col">Limits and conditions</th></tr></thead>
          <tbody>
            ${vendor.planOptions.map(
              (o) => html`<tr>
                <th scope="row">${o.name} <small>${ui.sourceLink(o.source, 'Plan source')}</small></th>
                <td>${o.price == null ? 'Confirm price' : html`<b class="num">${money(o.price, o.currency)}</b>`} <small>${PLAN_BILLING[o.billing] || o.billing} · ${o.unit || 'Confirm billing unit in source'}</small></td>
                <td>${o.features?.length ? html`<ul class="sw-inline-list">${o.features.map((f) => html`<li>${f}</li>`)}</ul>` : ''}</td>
                <td>${o.limits}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`
    : '';

  const planScoreVm = (r) => ({ value: r.score, pending: r.score === null, checked: r.checkedCount, total: r.totalCount, coveragePct: Math.floor(r.coverage ?? 0) });
  const evidenceMeta = (ev, links) => {
    const label = L.verification[ev?.verification] || L.verification['not-verified'];
    const date = ev?.checkedAt && ctx.scoring.validScoreDate(ev.checkedAt) ? html` · ${ui.time(ctx, ev.checkedAt)}` : '';
    return html` <small>${label}${date}${links.map((l) => html` · ${ui.sourceLink(l.url, l.label)}`)}</small>`;
  };
  const researchedPlans = researched.map(
    ({ category, plans }) => html`<div class="sw-sub" id="plans-${category.id}">
      <h3>${category.name} plans</h3>
      <p class="fineprint">These scores use only evidence researched for the named plan. Product-wide capabilities are not carried over. Missing plan evidence earns no points and remains an evidence gap. The score stays pending until 80% of the checklist weight has been checked. Prices describe the stated audience and billing terms; confirm the current quote.</p>
      <div class="sw-plans">
        ${plans.map((plan) => {
          const r = ctx.scoring.planFit(category, vendor, plan.id);
          const vm = planScoreVm(r);
          const pp = plan.pricing || {};
          return html`<div class="sw-plan" id="plan-${category.id}-${plan.id}">
            <h4>${plan.name}</h4>
            <div class="sw-plan__top">
              ${ui.scoreRing(ctx, vm, { size: 'sm' })}
              <p class="sw-plan__score"><b>${ctx.scoring.scoreValueText(r)}</b>${r.score === null ? '' : ' plan-level documented-fit score'} <span>${ctx.scoring.scoreCoverageText(r)} · ${ctx.scoring.scoreCountText(r)}${
                r.checkedAt ? html` · Checked ${ui.time(ctx, r.checkedAt)}` : ''
              }</span>${r.score === null ? html` <span>${L.scoreGate}</span>` : ''}</p>
              <p class="price">${pp.amount == null ? html`<span class="price__main price__main--text">Price not verified</span>` : html`<span class="price__main num">${money(pp.amount, pp.currency)}</span>`} ${
                pp.unit ? html`<span class="price__unit">${pp.unit}</span>` : ''
              }</p>
            </div>
            ${pp.summary ? html`<p>${pp.summary}</p>` : ''}
            ${plan.limits?.length ? ui.ticks(plan.limits, 'dots') : ''}
            <p class="fineprint">${ui.sourceLink(plan.source, 'Official plan source')}${plan.checkedAt ? html` · Checked ${ui.time(ctx, plan.checkedAt)}` : ''}</p>
            <p class="cluster">
              <a class="btn btn--ghost" href="/compare/?scope=${category.id}&amp;a=${vendor.id}&amp;plan_a=${plan.id}">Compare this plan</a>
              <button type="button" class="btn btn--quiet" data-sw-plan="${plan.id}" data-vendor="${vendor.id}" data-category="${category.id}" data-name="${name}" data-plan-name="${plan.name}">Save ${plan.name} to shortlist</button>
            </p>
            <details class="sw-more">
              <summary>All ${r.rows.length} plan checks and evidence</summary>
              <table class="dtable sw-ev">
                <caption class="sr-only">${name} ${plan.name}: plan-level evidence for ${r.rows.length} ${category.name} checks</caption>
                <thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col" class="num">Points</th><th scope="col">Plan evidence</th></tr></thead>
                <tbody>
                  ${r.rows.map(
                    (row) => html`<tr>
                      <th scope="row">${row.label}</th>
                      <td>${ui.status(row.effectiveStatus)}</td>
                      ${row.active ? html`<td class="num">${ctx.scoring.contributionText(row)}</td>` : html`<td class="num sw-ns">Not scored</td>`}
                      <td>${row.evidence?.note || ''}${evidenceMeta(row.evidence, ctx.scoring.evidenceLinks(row.evidence))}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </details>
          </div>`;
        })}
      </div>
    </div>`,
  );

  // The LiveChat product-family note is publisher-supplied HTML (two sponsored links); only its wrapper is restyled.
  const family =
    vendor.id === 'livechat' && ctx.content.softwareServer.livechatTextProductFamilyHtml
      ? html`<div class="sw-sub sw-family" id="text-product-family" data-nosnippet>${raw(
          ctx.content.softwareServer.livechatTextProductFamilyHtml
            .replace(/^<section[^>]*>/, '')
            .replace(/<\/section>\s*$/, '')
            .replace(/<h2>/g, '<h3>')
            .replace(/<\/h2>/g, '</h3>'),
        )}</div>`
      : '';

  const priceFacts = [
    { label: 'Pricing model', value: p.modelLabel },
    pricing.billing && { label: 'Billing basis', value: BILLING[pricing.billing] || cap(pricing.billing) },
    pricing.unit && { label: 'Unit', value: pricing.unit },
    { label: 'Currency', value: pricing.currency || 'Not verified' },
    { label: 'Price checked', value: p.checkedAt ? ui.time(ctx, p.checkedAt) : 'Date not recorded' },
    p.sourceUrl && { label: 'Price source', value: ui.sourceLink(p.sourceUrl, hostOf(p.sourceUrl) || 'Source') },
  ].filter(Boolean);
  const pricingSection = html`<section class="wrap section" id="pricing" aria-labelledby="pricing-h">
    ${ui.sectionHead(`What does ${name} cost?`, { id: 'pricing-h' })}
    <div class="sw-two">
      <div class="sw-prose">
        <p class="sw-price-head">
          <span class="price price--lg">
            ${p.hasAmount ? html`<span class="price__main num">${p.headline}</span>` : html`<span class="price__main price__main--text">${p.headline}</span>`}
            ${[p.unit, p.billingNote].filter(Boolean).length ? html`<span class="price__unit">${[p.unit, p.billingNote].filter(Boolean).join(' · ')}</span>` : ''}
            ${planLine}
          </span>
        </p>
        ${p.summary ? html`<p>${p.summary}</p>` : ''}
        ${p.extras.length ? html`<h3>Budget separately for</h3>${ui.ticks(p.extras, 'dots')}` : ''}
        <p class="fineprint">The lowest advertised price and the complete feature set can belong to different packages. Ask for a quote that names every required capability.</p>
        <div class="cluster sw-price-actions">
          ${ui.outLink(ctx, vendor, { intent: 'pricing', from: 'profile-pricing-detail', cls: 'btn btn--ghost' })}
          <a class="link-arrow" href="/tools/cost/?scope=${primary.id}&amp;a=${vendor.id}">Model your costs</a>
        </div>
      </div>
      <dl class="sw-rows">
        ${priceFacts.map((f) => html`<div><dt>${f.label}</dt><dd>${f.value}</dd></div>`)}
      </dl>
    </div>
    ${planOptions}${family}${researchedPlans}
  </section>`;

  // ---------------------------------------------------------------- capabilities (one panel per category)
  const groupMeta = Object.fromEntries(ctx.scoring.SCORE_GROUPS.map((g) => [g.id, g]));
  const pt = ctx.scoring.pointText;
  const evRow = (c, row) => {
    const ev = row.evidence;
    return html`<tr id="cap-${c.id}-${row.id}">
      <th scope="row">${row.label}${row.description ? html` <small>${row.active && row.tier === 'advanced' ? `${L.tier.advanced} · ` : ''}${row.description}</small>` : ''}${
        row.demoQuestion && row.demoQuestion !== row.description ? html` <details class="sw-demo"><summary>How to test this</summary><p>${row.demoQuestion}</p></details>` : ''
      }</th>
      <td>${ui.status(row.effectiveStatus)}</td>
      ${row.active ? html`<td class="num">${ctx.scoring.contributionText(row)}</td>` : html`<td class="num sw-ns">Not scored</td>`}
      <td>${ev?.note || ''}${evidenceMeta(ev, ev?.source ? [{ url: ev.source, label: ctx.scoring.evidenceLinkLabel(ev) }] : [])}</td>
    </tr>`;
  };
  const evHead = (first) => html`<thead><tr><th scope="col">${first}</th><th scope="col">Status</th><th scope="col" class="num">Points</th><th scope="col">Evidence</th></tr></thead>`;
  const statusCount = (rows) => {
    const n = { yes: 0, partial: 0, no: 0, unknown: 0 };
    for (const r of rows) n[r.effectiveStatus in n ? r.effectiveStatus : 'unknown']++;
    return [n.yes && `${n.yes} supported`, n.partial && `${n.partial} limited`, n.no && `${n.no} not supported`, n.unknown && `${n.unknown} not verified`].filter(Boolean).join(', ');
  };
  const panel = (c, i) => {
    const sc = scores.get(c.id);
    const total = ctx.summary(c.id).total;
    const active = sc.rows.filter((r) => r.active);
    const inactive = sc.rows.filter((r) => !r.active);
    const groupsOf = (rows) => GROUP_ORDER.map((gid) => ({ gid, rows: rows.filter((r) => r.scoringGroup === gid) })).filter((g) => g.rows.length);
    const tabbed = cats.length > 1;
    return html`<div${attrs({ class: 'sw-panel', id: `caps-${c.id}`, role: tabbed ? 'tabpanel' : null, 'aria-labelledby': tabbed ? `tab-${c.id}` : null, 'data-category': c.id })}>
      <h3 class="sw-panel__title">${c.name}</h3>
      <div class="sw-score">
        <div class="sw-score__main">
          ${ui.scoreRing(ctx, sc)}
          <div>
            <p class="sw-score__value"><b>${sc.valueText}</b>${sc.pending ? '' : ` ${L.scoreLabel}`}</p>
            <p class="sw-score__lines"><span>${sc.coverageText}</span><span>${sc.documentedText}</span>${sc.checkedAt ? html`<span>Checked ${ui.time(ctx, sc.checkedAt)}</span>` : ''}</p>
            ${sc.pending ? html`<p class="sw-score__gate">${L.scoreGate}</p>` : ''}
            <p class="sw-score__links">
              <a class="link-arrow" href="${ctx.url.category(c.id)}">${sc.pending ? `${c.name} ranking` : `${sc.placeLabel} in ${c.name}`}</a>
              <a class="link-arrow" href="${ctx.url.compare({ scope: c.id, ids: [vendor.id] })}">Compare in ${c.name}</a>
            </p>
          </div>
        </div>
        ${ui.breakdown(ctx, sc)}
      </div>
      <table class="dtable sw-ev">
        <caption class="sr-only">${name}: evidence for the ${active.length} ${c.name} checks that count toward the score</caption>
        ${evHead('Scored check')}
        <tbody>
          ${groupsOf(active).map(({ gid, rows }) => {
            const g = sc.groups.find((x) => x.id === gid);
            return html`<tr class="is-group"><th scope="colgroup" colspan="4">${groupMeta[gid].label} <span>${pt(g.earned)} of ${pt(g.weight)} pts · ${g.checkedCount}/${g.totalCount} checked</span></th></tr>${rows.map((row) => evRow(c, row))}`;
          })}
        </tbody>
      </table>
      ${
        inactive.length
          ? html`<details class="sw-more" id="deep-${c.id}">
              <summary>${plural(inactive.length, 'deep check')} not scored yet <span>${statusCount(inactive)}</span></summary>
              <p class="table-note">${L.inactiveCheck.replace('this deep check has', inactive.length === 1 ? 'this deep check has' : `these ${inactive.length} deep checks have`)} They stay listed so you can see what is already documented.</p>
              <table class="dtable sw-ev">
                <caption class="sr-only">${name}: ${inactive.length} ${c.name} deep checks that are not scored yet</caption>
                ${evHead('Deep check')}
                <tbody>
                  ${groupsOf(inactive).map(({ gid, rows }) => html`<tr class="is-group"><th scope="colgroup" colspan="4">${groupMeta[gid].label}</th></tr>${rows.map((row) => evRow(c, row))}`)}
                </tbody>
              </table>
            </details>`
          : ''
      }
    </div>`;
  };
  const capabilities = html`<section class="wrap section" id="capabilities" aria-labelledby="capabilities-h">
    ${ui.sectionHead(`Which capabilities are documented for ${name}?`, {
      id: 'capabilities-h',
      sub: html`Scores use four weighted groups. Full support earns full points; limited support or a paid add-on earns half. Unverified items earn zero, and the score stays pending below 80% checked weight. Paid-plan requirements remain visible in the evidence.`,
      link: { href: '/methodology/', label: 'How we score' },
    })}
    <div${attrs({ class: 'sw-tabs', 'data-tabs': cats.length > 1 ? true : null })}>
      ${
        cats.length > 1
          ? html`<div class="sw-tablist" role="tablist" aria-label="${name}: capability evidence by category" data-nosnippet>
              ${cats.map((c, i) => {
                const sc = scores.get(c.id);
                return html`<button type="button" role="tab" id="tab-${c.id}" aria-controls="caps-${c.id}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${c.name} <span class="${cx('sw-tab__score', sc.pending && 'is-pending')}"><span class="sr-only">score </span>${
                  sc.pending ? 'pending' : sc.value
                }</span></button>`;
              })}
            </div>`
          : ''
      }
      ${cats.map(panel)}
    </div>
    <div class="sw-ev-foot">
      ${ui.statusLegend()}
      <p class="table-note">Points show what each check adds to the documented-fit score. “How to test this” prompts are scenarios to run with the supplier; they are not completed product tests.</p>
    </div>
  </section>`;

  // ---------------------------------------------------------------- AI
  const aiSection = html`<section class="wrap section" id="ai" aria-labelledby="ai-h">
    ${ui.sectionHead(`What does ${name}’s AI actually do?`, { id: 'ai-h' })}
    <div class="sw-two">
      <div class="sw-prose">
        <p>${ui.aiTag(ctx, vendor)}</p>
        ${ai.summary ? html`<p class="sw-fit__lead">${ai.summary}</p>` : ''}
        ${ai.source ? html`<p>${ui.sourceLink(ai.source, 'Official AI source')}</p>` : ''}
      </div>
      <div class="sw-ai-lists">
        ${ai.capabilities?.length ? html`<div><h3>Documented capabilities</h3>${ui.ticks(ai.capabilities)}</div>` : html`<div><h3>Documented capabilities</h3><p class="sw-muted">None documented in the official sources we checked. Not verified does not mean absent.</p></div>`}
        ${ai.limits?.length ? html`<div><h3>Limits to check</h3>${ui.ticks(ai.limits, 'crosses')}</div>` : ''}
      </div>
    </div>
  </section>`;

  // ---------------------------------------------------------------- integrations, security, US notes
  const detailRows = [
    vendor.integrations?.length && { label: 'Integrations', value: html`<ul class="sw-inline-list">${vendor.integrations.map((x) => html`<li>${x}</li>`)}</ul>` },
    vendor.securityNote && { label: 'Security and data', value: vendor.securityNote },
    vendor.usNote && { label: 'Buying in the US', value: vendor.usNote },
  ].filter(Boolean);
  const details = detailRows.length
    ? html`<section class="wrap section" id="details" aria-labelledby="details-h">
        ${ui.sectionHead(vendor.integrations?.length ? 'Integrations, security and US buying notes' : 'Security and US buying notes', { id: 'details-h' })}
        <dl class="sw-rows sw-rows--wide">${detailRows.map((r) => html`<div><dt>${r.label}</dt><dd>${r.value}</dd></div>`)}</dl>
      </section>`
    : '';

  // ---------------------------------------------------------------- latest dated source check (30 vendors)
  const reviewSection = review
    ? (() => {
        const srcById = new Map((review.sources || []).map((x) => [x.evidence_id, x]));
        const changed = (review.changedFields || []).map((f) => REVIEW_FIELDS[f] || f);
        return html`<section class="wrap section" id="source-review" aria-labelledby="source-review-h">
          ${ui.sectionHead(`What did the latest source check of ${name} cover?`, { id: 'source-review-h', link: { href: '/research-updates/', label: 'Research update log' } })}
          <div class="sw-two">
            <div class="sw-prose">
              <p>Sources checked ${ui.time(ctx, review.observedAt)}. This check covers public pricing, plan boundaries and the claims listed below. It is documentary research assisted by AI, not a hands-on product test. It does not re-score every capability or refresh older plan assessments.</p>
              ${review.verifiedFeatures?.length
                ? html`<ul class="ticks">${review.verifiedFeatures.map(
                    (f) => html`<li>${f.claim}${(f.evidence_ids || []).map((id) => srcById.get(id)).filter(Boolean).map((src) => html` <span class="sw-cite">${ui.sourceLink(src.url, src.title)}</span>`)}</li>`,
                  )}</ul>`
                : ''}
            </div>
            <div class="sw-prose">
              <dl class="sw-rows">
                ${REVIEW_STATUS[review.status] ? html`<div><dt>Result</dt><dd>${REVIEW_STATUS[review.status]}</dd></div>` : ''}
                <div><dt>Official sources recorded</dt><dd>${(review.sources || []).length}</dd></div>
                ${changed.length ? html`<div><dt>Updated in this profile</dt><dd>${cap(changed.join(', '))}</dd></div>` : ''}
              </dl>
              ${review.limitations?.length ? html`<h3>Limits and open questions</h3>${ui.ticks(review.limitations, 'crosses')}` : ''}
              <p class="fineprint"><a href="/editorial-policy/">Editorial responsibility</a> · <a href="/corrections/">Suggest a correction</a></p>
            </div>
          </div>
        </section>`;
      })()
    : '';

  // ---------------------------------------------------------------- alternatives (rows) + published comparisons
  const top = ctx.topWithTies(primary.id, others, 5);
  // the four profiles the publisher runs as decision pages link each listed alternative's site (live placement)
  const decisionTemplate = (ctx.content.softwareServer.decisionTemplateVendorIds || []).includes(vendor.id);
  const altRows = summary.ranked.filter((v) => v.id === vendor.id || top.includes(v)).map((v) => ({ vendor: v }));
  // per row: the published comparison when one exists, else the comparison tool with both products selected
  const vsLink = (other) => {
    if (other.id === vendor.id) return '';
    const pair = ctx.pairPage(primary.id, vendor.id, other.id);
    const href = pair ? ctx.url.vs(pair.id) : ctx.url.compare({ scope: primary.id, ids: [vendor.id, other.id] });
    return html`<a class="sw-vs" href="${href}">${pair ? 'Read comparison' : 'Compare'}<span class="sr-only"> ${name} with ${other.name}</span></a>${
      decisionTemplate ? html` <span class="sw-visit">${ui.outLink(ctx, other, { intent: 'website', from: 'decision-directory', cls: 'sw-visit__a', explain: false })}</span>` : ''
    }`;
  };
  const altTable = top.length
    ? ui.productTable(ctx, primary.id, altRows, {
        id: 'alternatives-table',
        focalId: vendor.id,
        focalTag: 'This product',
        sortable: false,
        lazyFrom: 0,
        action: vsLink,
        actionLabel: html`<span class="sr-only">Compare</span>`,
        caption: top.length === 1 ? `${name} and the one alternative we researched in ${primary.name}` : `${name} and the ${top.length} alternatives with the highest documented-fit scores in ${primary.name}`,
      })
    : '';
  const vsItems = publishedVs.map((x) => {
    const names = ctx.comparisonNames(x);
    const cat = ctx.category(x.categoryId);
    const sc = names.map((n) => ctx.score(x.categoryId, n.id)).filter(Boolean);
    return { href: ctx.url.vs(x.id), title: names.map((n) => n.name).join(' vs '), sub: cat?.name || '', meta: sc.length === 2 ? sc.map((y) => (y.pending ? 'pending' : y.value)).join(' vs ') : '' };
  });
  const alternatives = html`<section class="wrap section sw-alts" id="alternatives" aria-labelledby="alternatives-h">
    ${ui.sectionHead(`What are the alternatives to ${name}?`, {
      id: 'alternatives-h',
      sub: top.length
        ? top.length === 1
          ? `${primary.name}: the one other product we researched in this category, next to ${name}.`
          : `${primary.name}: the ${top.length} other products with the highest documented-fit scores, next to ${name}.`
        : null,
      link: { href: ctx.url.alternatives(vendor.id), label: others.length === 1 ? '1 alternative' : `All ${others.length} alternatives` },
    })}
    ${altTable}
    ${top.length ? ui.tableNote(ctx) : ''}
    ${
      vsItems.length
        ? html`<div class="sw-sub">
            <h3>Published comparisons with ${name}</h3>
            <p class="fineprint">These comparisons use the same category checklist. Check plan limits and evidence before choosing.</p>
            ${ui.linkList(vsItems, { cols: vsItems.length > 1 ? 2 : 1 })}
          </div>`
        : ''
    }
  </section>`;

  // ---------------------------------------------------------------- private notes (localStorage only)
  const notes = html`<section class="wrap section sw-notes" id="notes" aria-labelledby="notes-h" data-sw-notes="${vendor.id}" data-nosnippet>
    ${ui.sectionHead(`Your notes on ${name}`, { id: 'notes-h', sub: 'Saved only in this browser. Private to you and never published. Avoid recording sensitive information.' })}
    <div class="field sw-notes__field">
      <label for="sw-note">What do you want to check about ${name}?</label>
      <textarea class="textarea" id="sw-note" rows="4" maxlength="5000" placeholder="Questions for the demo, requirements, or quote details…" data-sw-note></textarea>
      <p class="sw-notes__meta"><span role="status" aria-live="polite" data-sw-note-status></span><span data-sw-note-count></span></p>
    </div>
    <noscript><p class="fineprint">Enable JavaScript to save private notes in this browser.</p></noscript>
    <p><a class="link-arrow" href="/shortlist/">Open your shortlist and saved notes</a></p>
  </section>`;

  // ---------------------------------------------------------------- FAQ
  const faq = html`<div class="wrap wrap--narrow section">${ui.faq(ctx, faqItems, { heading: `${name}: questions buyers ask` })}</div>`;

  // ---------------------------------------------------------------- sources and evidence
  const evidence = html`<section class="wrap section" id="evidence" aria-labelledby="evidence-h">
    ${ui.sectionHead('Sources and evidence', {
      id: 'evidence-h',
      sub: html`Research is based on official documentation, not a hands-on performance test. <a href="/corrections/">Report a correction</a>`,
    })}
    ${
      vendor.evidence?.length
        ? html`<h3 class="sw-h3">Evidence record</h3>
            <ul class="sw-claims">
              ${vendor.evidence.map((e) => html`<li><span>${e.claim}</span> ${ui.sourceLink(e.url, hostOf(e.url) || 'Source')}</li>`)}
            </ul>`
        : ''
    }
    <h3 class="sw-h3">Official sources (${vendor.sources.length})</h3>
    ${ui.sources(vendor.sources.map((x) => ({ ...x, note: shortUrl(x.url) })))}
    ${vendor.modifiedAt ? html`<p class="fineprint sw-updated">Content updated ${ui.time(ctx, vendor.modifiedAt)}</p>` : ''}
  </section>`;

  // ---------------------------------------------------------------- structured data
  const featureList = [...new Set(cats.flatMap((c) => scores.get(c.id).rows.filter((r) => r.active && r.effectiveStatus === 'yes').map((r) => r.label)))];
  const softwareId = `${ctx.abs(path)}#software`;

  return {
    title,
    description,
    nav: 'categories',
    breadcrumbs: [
      { name: 'Categories', url: '/categories/' },
      { name: primary.name, url: ctx.url.category(primary.id) },
      { name, url: path },
    ],
    pageType: 'WebPage',
    // the publisher's per-product share card (30 products have one); everything else uses the site card
    ogImage: vendor.researchSocialImage
      ? { url: vendor.researchSocialImage, width: 1200, height: 630, alt: `${name} — US pricing and plan research; source dates and limits on the page` }
      : undefined,
    pageExtra: { mainEntity: { '@id': softwareId } },
    dateModified: updated,
    accountable: true,
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    jsonld: [ctx.seo.softwareNode(vendor, { path, categoryNames: cats.map((c) => c.name), featureList }), ...cats.map((c) => ctx.seo.scoreObservation(vendor, c))],
    scripts: ['js/software.js'],
    // indentation of the templates is not content: drop it (a long profile lists up to 140 evidence rows)
    body: raw(String(html`${hero}${brief}${nav}${fit}${pricingSection}${capabilities}${aiSection}${details}${reviewSection}${alternatives}${notes}${faq}${evidence}`).replace(/\n\s+/g, '\n')),
  };
}
