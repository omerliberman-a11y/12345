// Documentary /vs/ pages (27): two suppliers of a documentary category, compared on named offers.
// The body lives in category.factual.comparison; suppliers, plans, criteria and sources in category.factual.
// No score exists for these offers — the page says so once and never implies an order.

import { html, text, cx, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe, fits } from '../lib/seo.mjs';
import { fxMark, fxLegend, sourceMap, evidenceLinks, offerPrice, offerPriceCell, offerEvidence, decisionNote, researchLinks, tight, dated, NO_SCORE_LABEL } from './category-factual.mjs';

export function routes(ctx) {
  return ctx.comparisons
    .filter((c) => ctx.comparisonKind(c) === 'factual' && ctx.category(c.categoryId)?.factual?.comparison?.id === c.id)
    .map((comparison) => ({ path: ctx.url.vs(comparison.id), render: (c) => render(c, comparison) }));
}

function render(ctx, record) {
  const category = ctx.category(record.categoryId);
  const F = category.factual;
  const X = F.comparison;
  const path = ctx.url.vs(X.id);
  const srcMap = sourceMap(category);
  const approver = F.publicationApprover || null;
  const checked = X.checkedAt || record.checkedAt || F.checkedAt;
  const year = String(checked || '').slice(0, 4);
  const supplierById = new Map(F.suppliers.map((s) => [s.id, s]));
  const pair = (X.vendorIds || record.vendorIds || []).map((id) => supplierById.get(id)).filter(Boolean);
  const others = F.suppliers.filter((s) => !pair.includes(s));
  const offers = (X.offers || [])
    .map((o) => {
      const supplier = supplierById.get(o.vendorId);
      const plan = supplier?.plans?.find((p) => p.id === o.planId);
      return supplier && plan ? { key: `${supplier.id}--${plan.id}`, supplier, plan, price: offerPrice(ctx, plan.pricing), decisions: new Map((plan.decisions || []).map((d) => [d.criterion_id, d])) } : null;
    })
    .filter(Boolean);
  const criteria = (X.criterionIds || []).map((id) => F.criteria.find((c) => c.id === id)).filter(Boolean);
  const shortTitle = String(X.title).split(':')[0].trim();
  const [a, b] = pair.map((s) => s.name);

  // ---- head
  const core = fits([`${a} vs ${b}: ${category.name} compared`, `${a} vs ${b} compared`, `${a} vs ${b}`], 60) || `${a} vs ${b}`;
  const title = seoTitle(core, year);
  const live = ctx.liveHead(path) || {};
  const description = describe([
    X.description || record.description,
    `${shortTitle}: ${offers.length} named offers compared on ${criteria.length} documented criteria, prices and dated sources. No score assigned.`,
    live.description,
    `${shortTitle}: compare documented features, plan limits, pricing context and sources for US buyers.`,
  ]);

  // ---- every evidence id referenced on this page → the dated source list (in factual.sources order)
  const used = new Set();
  const use = (ids) => (ids || []).forEach((id) => used.add(id));
  offers.forEach((o) => use(o.plan.pricing?.evidence_ids));

  // ---- page head + answer
  const head = html`<header class="wrap page-head page-head--wide fx-vs-head">
    <p class="eyebrow"><a href="${ctx.url.category(category.id)}">${category.name}</a></p>
    <h1>${X.title}</h1>
    ${ui.trustline([
      html`Updated ${ui.time(ctx, checked)}`,
      `${ctx.plural(offers.length, 'selected offer')} · US buying context`,
      NO_SCORE_LABEL,
      approver && `${approver.name}, ${String(approver.role || '').toLowerCase()}`,
      html`<a href="/methodology/">How we score</a>`,
    ])}
  </header>
  <div class="wrap cat-answer">
    ${ui.answer(
      ctx,
      html`${ctx.listText(pair.map((s) => s.name))}: ${ctx.plural(offers.length, 'named offer')} compared on ${ctx.plural(criteria.length, 'documented criterion', 'documented criteria')}, with evidence checked ${ui.time(ctx, checked)}. ${X.intro}`,
      { meta: 'No /100 score has been assigned. This is an unranked comparison of documented offers, not a recommendation.' },
    )}
  </div>`;

  const nav = ui.subnav(
    [
      { href: '#offers', label: 'Offers & prices' },
      { href: '#criteria', label: 'Criteria' },
      X.choices?.length && { href: '#choose', label: 'Which to choose' },
      X.decisionAid?.rows?.length && { href: '#decision-aid', label: 'Buying questions' },
      X.demo?.length && { href: '#demo', label: 'Evaluation' },
      { href: '#sources', label: 'Sources' },
    ].filter(Boolean),
  );

  // ---------------------------------------------------------------- offers (rows) with observed prices
  const offersBlock = html`<section class="wrap fx-vs-offers" id="offers" aria-labelledby="offers-h">
    <div class="fx-head">
      <h2 id="offers-h">The offers compared</h2>
    </div>
    <table class="dtable fx-stack fx-offers">
      <caption class="sr-only">${shortTitle}: selected offers with observed price, billing, tax basis and dated sources</caption>
      <thead>
        <tr><th scope="col">Supplier and offer</th><th scope="col">Observed price</th><th scope="col">Billing and tax</th><th scope="col">Notes</th><th scope="col">Evidence</th></tr>
      </thead>
      <tbody>
        ${offers.map((o) => {
          const p = o.price;
          return html`<tr data-offer="${o.key}">
            <th scope="row"><a href="${ctx.url.supplier(category.id, o.supplier.id)}">${o.supplier.name}</a><small>${o.plan.name}</small></th>
            <td data-l="Observed price">${offerPriceCell(p)}</td>
            <td data-l="Billing and tax">${p.billing ? html`<span class="fx-p-bill">${p.billing}</span>` : ''}<span class="fx-p-tax">${p.tax}</span></td>
            <td${attrs({ 'data-l': p.note || p.upcoming ? 'Notes' : null, class: p.note || p.upcoming ? null : 'fx-empty' })}>${p.note ? html`<span class="fx-p-note">${p.note}</span>` : ''}${
              p.upcoming ? html`<span class="fx-p-up">Announced invoice change from ${ui.time(ctx, p.upcoming.date)}: ${p.upcoming.text}</span>` : ''
            }</td>
            <td data-l="Evidence">${offerEvidence(ctx, srcMap, p)}</td>
          </tr>`;
        })}
      </tbody>
    </table>
    <p class="table-note">Prices are observations of public pages, not quotes; confirm tax, renewals, setup and usage charges. <a href="${ctx.url.category(category.id)}#plans">See every documented offer of all ${F.suppliers.length} suppliers in ${category.name}</a>.</p>
  </section>`;

  // ---------------------------------------------------------------- criteria × offers (plan-level statements)
  const comparison = html`<section class="wrap section fx-compare" id="criteria" aria-labelledby="criteria-h" data-fx-compare>
    ${ui.sectionHead('Named plans side by side', {
      id: 'criteria-h',
      sub: 'Not verified means the evidence does not settle the plan entitlement; it does not mean the capability is absent. Product-wide statements do not fill a plan-level gap.',
    })}
    <div class="fx-compare__meta">
      ${fxLegend()}
      <div class="toolbar fx-controls" data-fx-controls data-nosnippet hidden>
        <p class="toolbar__count" role="status" aria-live="polite" data-fx-status></p>
        <button type="button" class="chip" data-fx-diff aria-pressed="false">Hide identical rows</button>
      </div>
    </div>
    <table class="dtable fx-cells" data-fx-table data-fx-noun="offers">
      <caption class="sr-only">${shortTitle}: selected plan boundaries and dated sources</caption>
      <thead>
        <tr>
          <th scope="col">Criterion</th>
          ${offers.map((o) => html`<th scope="col" data-s="${o.key}">${o.supplier.name}<small>${o.plan.name}</small></th>`)}
        </tr>
      </thead>
      <tbody>
        ${criteria.map((c) => {
          const ds = offers.map((o) => o.decisions.get(c.id) || null);
          const known = ds.map((d) => Boolean(d) && d.status !== 'unknown');
          ds.forEach((d, i) => known[i] && use(d.evidence_ids));
          return html`<tr class="fx-row">
            <th scope="row">${c.label}</th>
            ${offers.map((o, i) =>
              known[i]
                ? html`<td data-l="${o.supplier.name} ${o.plan.name}">${fxMark(ds[i].status)}<span class="fx-note">${decisionNote(ctx, srcMap, ds[i], checked)}</span></td>`
                : html`<td data-l="${o.supplier.name} ${o.plan.name}">${fxMark('unknown')}</td>`,
            )}
          </tr>`;
        })}
      </tbody>
    </table>
    <p class="table-note">Every statement was checked on ${ui.time(ctx, checked)} unless another date is shown. Statements describe the named offer only.</p>
  </section>`;

  // ---------------------------------------------------------------- which to choose
  (X.choices || []).forEach((c) => use(c.evidence_ids));
  const choose = X.choices?.length
    ? html`<section class="wrap section" id="choose" aria-labelledby="choose-h">
        ${ui.sectionHead('Which to choose', { id: 'choose-h' })}
        <div class="${cx('fx-choices', `fx-choices--${Math.min(X.choices.length, 3)}`)}">
          ${X.choices.map((c) => {
            const links = evidenceLinks(srcMap, c.evidence_ids);
            return html`<div><h3>${c.heading}</h3><p>${c.text}</p>${links ? html`<p class="fx-ev">Evidence: ${links}</p>` : ''}</div>`;
          })}
        </div>
      </section>`
    : '';

  // ---------------------------------------------------------------- decision aid as Q&A
  const aidRows = X.decisionAid?.rows || [];
  aidRows.forEach((r) => use(r.evidence_ids));
  const faqItems = aidRows.map((r) => {
    const links = evidenceLinks(srcMap, r.evidence_ids);
    return { q: r.question, a: html`<p>${r.decision}</p><p>${r.boundary}</p>${links ? html`<p class="fineprint">Evidence: ${links}</p>` : ''}`, plain: `${r.decision} ${r.boundary}` };
  });
  const aid = faqItems.length
    ? html`<div class="wrap section" id="decision-aid">
        <div class="fx-choose__faq">
          ${ui.faq(ctx, faqItems, { id: 'faq', heading: X.decisionAid.heading || 'Buying questions', sub: 'What the dated evidence supports for each buying situation, and the boundary to verify.' })}
        </div>
      </div>`
    : '';

  // ---------------------------------------------------------------- evaluation, limits, change log
  const demo = X.demo?.length
    ? html`<section class="wrap section" id="demo" aria-labelledby="demo-h">
        ${ui.sectionHead('Run the same evaluation with both suppliers', { id: 'demo-h', sub: 'A proposed buyer acceptance exercise, not a test performed by System Compare.' })}
        <ol class="steps fx-steps">${X.demo.map((q) => html`<li>${q}</li>`)}</ol>
      </section>`
    : '';

  const limits = html`<section class="wrap section" id="research-method" aria-labelledby="limits-h">
    ${ui.sectionHead('Research limits', { id: 'limits-h' })}
    <div class="prose">
      <p>Prepared with AI assistance from dated official public documentation. No supplier deployment, hands-on benchmark or ${
        approver ? 'final score approval' : 'human editorial sign-off'
      } is recorded. Prices are observations, not quotes; confirm tax, renewals, setup and usage charges. No lowest-cost or compliance winner is declared.</p>
      ${approver ? html`<p>${approver.name} — ${approver.role}. Publication responsibility does not imply a hands-on test or an approved score.</p>` : ''}
      ${researchLinks()}
    </div>
    ${
      X.changeLog?.length
        ? html`<h3 class="fx-also" id="change-log">Change log</h3>
            <ul class="fx-log">${X.changeLog.map((l) => html`<li>${ui.time(ctx, l.date)} ${l.text}</li>`)}</ul>`
        : ''
    }
  </section>`;

  const sourceList = F.sources.filter((s) => used.has(s.evidence_id));
  const sourcesBlock = html`<section class="wrap section" id="sources" aria-labelledby="sources-h">
    ${ui.sectionHead('Dated primary sources', { id: 'sources-h', sub: `${sourceList.length} official pages behind the prices and statements on this page, with the date each was checked and what it covers.` })}
    ${ui.sources(sourceList.map((s) => ({ label: s.title, url: s.url, note: html`Checked ${ui.time(ctx, s.observation_date)}${s.scope ? html` · ${dated(s.scope)}` : ''}` })))}
  </section>`;

  // ---------------------------------------------------------------- back to the category + sibling comparisons
  const guide = F.guide && ctx.guide(F.guide.id);
  // The next six documentary comparisons after this one (same business area first, wrapping around), so every
  // such page is linked from six others instead of only from the comparison library.
  const allFactual = ctx.comparisons
    .filter((k) => ctx.comparisonKind(k) === 'factual')
    .map((k) => ({ k, g: ctx.groupOf(ctx.category(k.categoryId))?.id || '' }))
    .sort((x, y) => x.g.localeCompare(y.g) || x.k.id.localeCompare(y.k.id))
    .map((x) => x.k);
  const at = allFactual.findIndex((k) => k.id === X.id);
  const moreVs = at < 0 ? [] : Array.from({ length: Math.min(6, allFactual.length - 1) }, (_, i) => allFactual[(at + 1 + i) % allFactual.length]);
  const more = html`<section class="wrap section" aria-labelledby="more-h">
    ${ui.sectionHead(`More on ${category.name}`, { id: 'more-h' })}
    ${ui.linkList(
      [
        { href: ctx.url.category(category.id), title: `All ${F.suppliers.length} documented suppliers in ${category.name}`, sub: `${F.suppliers.map((s) => s.name).join(', ')} — offers, prices and ${F.criteria.length} criteria.` },
        ...pair.map((s) => ({ href: ctx.url.supplier(category.id, s.id), title: `${s.name}: approach, offers and what to check`, sub: s.segment })),
        ...others.map((s) => ({ href: ctx.url.supplier(category.id, s.id), title: `Also documented: ${s.name}`, sub: s.segment })),
        guide && { href: ctx.url.guide(guide.id), title: guide.title, sub: guide.description || 'Buying guide' },
      ].filter(Boolean),
      { cols: 2 },
    )}
    ${
      moreVs.length
        ? html`<h3 class="fx-also">More documented comparisons</h3>
            ${ui.linkList(
              moreVs.map((k) => ({ href: ctx.url.vs(k.id), title: ctx.comparisonNames(k).map((n) => n.name).join(' vs '), meta: ctx.category(k.categoryId).name })),
              { cols: 2 },
            )}`
        : ''
    }
  </section>`;

  return {
    title,
    description,
    ogTitle: core,
    nav: 'compare',
    breadcrumbs: [
      { name: 'Categories', url: '/categories/' },
      { name: category.name, url: ctx.url.category(category.id) },
      { name: shortTitle, url: path },
    ],
    pageType: 'WebPage',
    dateModified: ctx.isoDate(checked) || undefined,
    accountable: Boolean(approver),
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.plain) })),
    jsonld: [
      ctx.seo.itemListNode(
        path,
        pair.map((s) => ({ name: s.name, url: ctx.url.supplier(category.id, s.id) })),
        { id: '#items', name: 'Suppliers compared (unranked)', ordered: false },
      ),
    ],
    pageExtra: {
      about: pair.map((s) => ({ '@type': 'SoftwareApplication', name: s.name, applicationCategory: 'BusinessApplication' })),
      mainEntity: { '@id': `${ctx.abs(path)}#items` },
    },
    scripts: ['js/factual.js'],
    body: tight(html`${head}${nav}${offersBlock}${comparison}${choose}${aid}${demo}${limits}${sourcesBlock}${more}`),
  };
}
