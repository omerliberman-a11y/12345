// Head-to-head pages /vs/{id}/ for SCORED comparisons (two products of one scored category, same checklist).
// Editorial and documentary comparisons are rendered by vs-editorial.mjs / vs-factual.mjs.
//
// The comparison component (sticky product header + tables, class prefix .cmp-) is rendered here on the
// server and by src/assets/js/compare.js on /compare/ — keep class names and structure in sync.

import { html, text, cx, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe, fits } from '../lib/seo.mjs';

export function routes(ctx) {
  return ctx.comparisons
    .filter((c) => ctx.comparisonKind(c) === 'scored')
    .map((comparison) => ({ path: ctx.url.vs(comparison.id), render: (c) => render(c, comparison) }));
}

const GROUP_ORDER = ['core', 'integrations', 'local', 'ai'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (iso) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const ST_WORD = { yes: 'Supported', partial: 'Limited', no: 'Not supported', unknown: 'Not verified' };
// What each score group covers (the published definitions, same wording as /methodology/).
const GROUP_COVERS = {
  core: 'The category’s main job and generic security, reliability and support controls.',
  integrations: 'Exchange of records, events or identity with other systems, including APIs, connectors, import/export and SSO.',
  local: 'Explicit US suitability, including local language, law, tax, payroll, payment systems or data residency.',
  ai: 'AI or machine-learning capabilities and their controls. Main AI functions belong to core in AI categories.',
};

function render(ctx, comparison) {
  const A = ctx.answers;
  const S = ctx.scoring;
  const category = ctx.category(comparison.categoryId);
  const vendors = comparison.vendorIds.map((id) => ctx.vendor(id));
  const [a, b] = vendors;
  const path = ctx.url.vs(comparison.id);
  const pairName = `${a.name} vs ${b.name}`;
  const facts = A.pairFacts(category, a, b);
  const quick = A.pairQuickAnswer(category, a, b);
  const verdict = A.pairVerdict(category, a, b);
  const pt = S.pointText;
  // Workaround for two casing slips in the shared FAQ generator (answers.mjs pairFaq lower-cases the first letter
  // of bestFor and the whole AI label: "uS employers", "native ai"). Remove once the generator is fixed.
  const faqItems = A.pairFaq(category, a, b).map((f) => {
    if (typeof f.a !== 'string') return f;
    let answer = f.a;
    for (const v of vendors) {
      const bf = v.bestFor || '';
      if (/^[A-Z](?:[A-Z0-9]|[a-z0-9]+[A-Z])/.test(bf)) answer = answer.replace(`${v.name} suits: ${bf[0].toLowerCase()}${bf.slice(1, 16)}`, `${v.name} suits: ${bf.slice(0, 16)}`);
      const label = ctx.aiLevel(v).label;
      answer = answer.replace(`${v.name}: ${label.toLowerCase()}`, `${v.name}: ${label.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`);
    }
    return { ...f, a: answer };
  });

  // one record per compared product, in the published (vendorIds) order
  const items = vendors.map((v, i) => ({ i, v, s: ctx.score(category.id, v.id), p: ctx.price(v, category.id), ai: ctx.aiLevel(v) }));
  const n = items.length;
  // "Add a third product" opens the tool's product step with both products already ticked (pick=1)
  const compareUrl = `${ctx.url.compare({ scope: category.id, ids: vendors.map((v) => v.id) })}&pick=1`;

  // ---- dates: every evidence date of both score records
  const evidenceDates = items.flatMap((it) => it.s.rows.map((r) => r.evidence?.checkedAt).filter((d) => S.validScoreDate(d))).sort();
  const firstEvidence = evidenceDates[0] || null;
  const lastEvidence = evidenceDates[evidenceDates.length - 1] || null;
  const year = (lastEvidence || ctx.catalog.checkedAt || '').slice(0, 4);

  // ---- checklist rows
  const rows = facts.rows.map((r) => ({
    f: r.feature,
    cells: [r.a, r.b],
    active: r.feature.active,
    diff: r.a.effectiveStatus !== r.b.effectiveStatus,
  }));
  const activeRows = rows.filter((r) => r.active);
  const inactiveRows = rows.filter((r) => !r.active);
  const diffRows = activeRows.filter((r) => r.diff);
  const byWeight = (list) => [...list].sort((x, y) => y.cells[0].weight - x.cells[0].weight);
  const ahead = items.map((it) =>
    byWeight(diffRows.filter((r) => r.cells[it.i].effectiveStatus === 'yes' && r.cells.some((c, j) => j !== it.i && c.effectiveStatus !== 'yes'))),
  );
  const otherDiff = byWeight(diffRows.filter((r) => r.cells.every((c) => c.effectiveStatus !== 'yes')));
  // checks that are not scored yet can differ too (the previous site listed them); kept apart from the scored ones
  const allDiffRows = rows.filter((r) => r.diff);
  const offDiffRows = inactiveRows.filter((r) => r.diff);
  const aheadOff = items.map((it) => offDiffRows.filter((r) => r.cells[it.i].effectiveStatus === 'yes' && r.cells.some((c, j) => j !== it.i && c.effectiveStatus !== 'yes')));
  const differWord = (k) => (k === 1 ? 'differs' : 'differ');
  const groupMeta = Object.fromEntries(S.SCORE_GROUPS.map((g) => [g.id, g]));

  // ---------------------------------------------------------------- <head>
  const core = fits([`${pairName}: scores, pricing & AI`, `${pairName} compared`, pairName], 60) || pairName;
  const title = seoTitle(core, year);
  const st = (it) => (it.s.pending ? `${it.v.name} score pending` : `${it.v.name} ${it.s.value}/100`);
  const priced = items.every((it) => it.p.hasAmount && it.p.currency === 'USD');
  const from = priced ? `From ${items.map((it) => `${it.p.headline}${it.p.unit ? ' ' + it.p.unit : ''}`).join(' vs ')}. ` : '';
  const differ = diffRows.length ? `${diffRows.length} of ${activeRows.length} scored checks ${differWord(diffRows.length)}. ` : `Same status on all ${activeRows.length} scored checks. `;
  const checked = `checked ${monYear(lastEvidence || ctx.catalog.checkedAt)}`;
  const sv = (it) => `${it.v.name} (${it.s.pending ? 'score pending' : `${it.s.value}/100`})`;
  const scoredPair = `${sv(items[0])} vs ${sv(items[1])}`;
  const description = describe([
    `${scoredPair}, documented fit for ${category.name}. ${differ}${from}Official sources, ${checked}.`,
    `${scoredPair}, documented fit. ${differ}${from}Official sources, ${checked}.`,
    from && `${scoredPair}, documented fit. ${differ}${from.trim()}`,
    `${scoredPair}, documented fit for ${category.name}. ${differ}Official sources, ${checked}.`,
    `${scoredPair}, documented fit. ${differ}Official sources, ${checked}.`,
    `${scoredPair}, documented fit. ${differ.trim()}`,
    `${pairName} for ${category.name}: ${st(items[0])}, ${st(items[1])} documented fit. ${from}Same checklist, official sources, ${checked}.`,
    `${pairName} for ${category.name}: ${st(items[0])}, ${st(items[1])} documented fit. Same checklist, official sources, ${checked}.`,
    `${pairName}: ${st(items[0])}, ${st(items[1])} documented fit, on one checklist with official sources.`,
    `${pairName}: documented features, AI, pricing and sources on one checklist.`,
  ]);

  // ---------------------------------------------------------------- small pieces
  const dot = () => html`<i class="cmp-dot" aria-hidden="true"></i>`;
  const colHead = (label) =>
    html`<thead class="cmp-thead">
      <tr>
        <th scope="col">${label}</th>
        ${items.map((it) => html`<th scope="col" data-i="${it.i}">${it.v.name}</th>`)}
      </tr>
    </thead>`;
  const cols = () => html`<colgroup><col class="cmp-col-l">${items.map(() => html`<col>`)}</colgroup>`;
  const row = (label, cell, { sub, cls } = {}) =>
    html`<tr${attrs({ class: cls })}>
      <th scope="row">${label}${sub ? html`<small>${sub}</small>` : ''}</th>
      ${items.map((it) => html`<td data-i="${it.i}">${cell(it)}</td>`)}
    </tr>`;
  const list = (arr, empty) => (arr && arr.length ? html`<ul class="cmp-list">${arr.map((x) => html`<li>${x}</li>`)}</ul>` : html`<span class="cmp-none">${empty}</span>`);
  const leads = (it) => verdict.kind === 'lead' && verdict.leader.id === it.v.id;

  // ---------------------------------------------------------------- page head: answer + verdict + tools
  const sameDate = firstEvidence === lastEvidence;
  const head = html`<header class="wrap page-head page-head--wide">
    <p class="eyebrow"><a href="${ctx.url.category(category.id)}">${category.name}</a></p>
    <h1>${pairName}</h1>
    ${ui.trustline([
      lastEvidence
        ? sameDate
          ? html`Evidence checked ${ui.time(ctx, lastEvidence)}`
          : html`Evidence checked ${ui.time(ctx, firstEvidence)} to ${ui.time(ctx, lastEvidence)}`
        : html`Evidence checked ${ui.time(ctx, ctx.catalog.checkedAt)}`,
      `Same ${rows.length}-point checklist, ${activeRows.length} checks scored`,
      'Desk research, not hands-on testing',
      html`<a href="/methodology/">How we score</a>`,
    ])}
  </header>
  <div class="wrap cmp-answer">
    ${ui.answer(ctx, quick)}
    <p class="cmp-verdict" data-kind="${verdict.kind}"><b>Verdict</b> ${verdict.text}</p>
    <div class="cmp-tools" data-cmp-tools data-nosnippet>
      <button type="button" class="btn btn--ghost btn--sm" data-copy="url">Copy link</button>
      <button type="button" class="btn btn--ghost btn--sm" data-cmp-save>Add both to shortlist</button>
      <button type="button" class="btn btn--ghost btn--sm" data-cmp-export>Export evidence (CSV)</button>
      <button type="button" class="btn btn--ghost btn--sm" data-cmp-print>Print</button>
      <a class="link-arrow cmp-tools__more" href="${compareUrl}">Add a third product</a>
    </div>
  </div>`;

  // ---------------------------------------------------------------- sticky product header
  const slot = (it) => {
    const { v, s, p } = it;
    const scoreInline = s.pending ? 'Score pending' : html`<b class="num">${s.value}</b>/100`;
    const priceInline = p.hasAmount ? `${p.headline}${p.unit ? ' ' + p.unit : ''}` : p.headline;
    return html`<div class="cmp-slot" data-i="${it.i}">
      ${dot()}${ui.logo(ctx, v, { size: 'sm', lazy: false })}
      <div class="cmp-slot__text">
        <a class="cmp-slot__name" href="${ctx.url.software(v.id)}">${v.name}</a>
        <span class="cmp-slot__meta"><span class="cmp-slot__score">${scoreInline}</span><span class="cmp-slot__price">${priceInline}</span></span>
      </div>
    </div>`;
  };
  const bar = html`<div class="cmp-bar" data-cmp-bar data-nosnippet>
    <div class="wrap">
      <div class="cmp-bar__grid">
        <div class="cmp-bar__ctx">
          <span>Comparing in</span>
          <a href="${ctx.url.category(category.id)}">${category.name}</a>
        </div>
        ${items.map(slot)}
      </div>
    </div>
  </div>`;

  // ---------------------------------------------------------------- at a glance
  const scoreCell = (it) => html`${ui.scoreToken(ctx, it.s, { size: 'lg' })}
    ${leads(it) ? html`<span class="tag tag--top">Higher documented fit</span>` : ''}
    ${it.s.pending ? html`<small>${S.LABELS.scoreGate}</small>` : ''}`;
  const coverageCell = (it) => html`${it.s.coverageText}
    <small>${it.s.documentedText}</small>
    ${it.s.checkedAt ? html`<small>Evidence checked ${ui.time(ctx, it.s.checkedAt)}</small>` : ''}`;
  const priceCell = (it) => html`${ui.priceCell(ctx, it.p, { plan: true, checked: true })}${it.p.checkedAt ? '' : html`<small>Price-check date not recorded</small>`}`;
  const glance = html`<section class="wrap cmp-sec cmp-sec--first" id="glance" aria-labelledby="glance-h">
    <div class="cmp-sec__head">
      <h2 id="glance-h">At a glance</h2>
      ${ui.scoreHelp(ctx)}
    </div>
    <table class="cmp-table cmp-table--glance">
      <caption class="sr-only">${pairName}: score, evidence coverage, price, AI and fit at a glance</caption>
      ${cols()}${colHead('Key fact')}
      <tbody>
        ${row('Documented-fit score', scoreCell)}
        ${row('Points by score group', (it) => ui.breakdown(ctx, it.s))}
        ${row('Evidence coverage', coverageCell)}
        ${row('Starting price', priceCell)}
        ${row('Pricing model', (it) => it.p.modelLabel)}
        ${row('AI', (it) => html`${ui.aiTag(ctx, it.v)}<small>${it.ai.help}</small>`)}
        ${row('Best for', (it) => it.v.bestFor)}
        ${row('Look closely when', (it) => it.v.avoidIf)}
      </tbody>
    </table>
    ${ui.tableNote(ctx)}
  </section>`;

  // ---------------------------------------------------------------- where they differ
  const srcLinks = (cell) => S.evidenceLinks(cell.evidence).map((l) => html` ${ui.sourceLink(l.url, l.label)}`);
  const diffLine = (r) => html`<li>
    <a class="cmp-ahead__cap" href="#cap-${r.f.id}">${r.f.label}</a>
    <span class="cmp-ahead__st">
      ${items.map((it) => html`<span data-i="${it.i}">${dot()}<span class="sr-only">${it.v.name}: </span>${ui.status(r.cells[it.i].effectiveStatus)}${srcLinks(r.cells[it.i])}</span>`)}
    </span>
  </li>`;
  const differences = html`<section class="wrap section cmp-sec" id="differences" aria-labelledby="differences-h">
    <div class="section-head">
      <div>
        <h2 id="differences-h">Where they differ</h2>
        <p class="cmp-count">${
          diffRows.length
            ? html`<b>${diffRows.length} of ${activeRows.length}</b> scored checks differ between ${a.name} and ${b.name}.`
            : html`<b>None of the ${activeRows.length}</b> scored checks differ: ${a.name} and ${b.name} have the same documented status on every one. Equal statuses do not mean the products or prices are identical.`
        }</p>
      </div>
    </div>
    ${
      diffRows.length
        ? html`<div class="cmp-ahead">
            ${items.map((it) => {
              const other = items.filter((o) => o !== it).map((o) => o.v.name).join(' or ');
              return html`<div class="cmp-ahead__col" data-i="${it.i}">
                <h3>${dot()}Where ${it.v.name} is ahead (${ahead[it.i].length})</h3>
                ${
                  ahead[it.i].length
                    ? html`<ul class="cmp-ahead__list">${ahead[it.i].map(diffLine)}</ul>`
                    : html`<p class="cmp-none">No scored check is documented as supported for ${it.v.name} and not for ${other}.</p>`
                }
              </div>`;
            })}
            ${
              otherDiff.length
                ? html`<div class="cmp-ahead__col cmp-ahead__col--other">
                    <h3>Other differences (${otherDiff.length})</h3>
                    <ul class="cmp-ahead__list">${otherDiff.map(diffLine)}</ul>
                  </div>`
                : ''
            }
          </div>
          <p class="fineprint">A product is ahead on a check when official documentation supports it there and not for the other product. Lines are ordered by the points each check carries. “Not verified” means no qualifying public evidence was found, not that the capability is missing.</p>`
        : ''
    }
  </section>`;

  // ---------------------------------------------------------------- full capability table (all rows in the HTML)
  const cell = (r, it) => {
    const c = r.cells[it.i];
    const e = c.evidence || {};
    const kind = S.LABELS.verification[e.verification] || S.LABELS.verification['not-verified'];
    const dated = S.validScoreDate(e.checkedAt);
    const meta = [
      kind === ST_WORD[c.effectiveStatus] ? (dated ? html`Checked ${ui.time(ctx, e.checkedAt)}` : '') : html`${kind}${dated ? html` · ${ui.time(ctx, e.checkedAt)}` : ''}`,
      ...S.evidenceLinks(e).map((l) => ui.sourceLink(l.url, l.label)),
    ].filter((x) => String(x));
    return html`<td data-i="${it.i}" data-st="${c.effectiveStatus}">
      <span class="cmp-cell__top">${ui.status(c.effectiveStatus)}${r.active ? html`<span class="cmp-pts num">${S.contributionText(c)}</span>` : ''}</span>
      ${e.note ? html`<span class="cmp-note">${e.note}</span>` : ''}
      ${meta.length ? html`<span class="cmp-src">${ui.join(meta, ' · ')}</span>` : ''}
    </td>`;
  };
  const capRow = (r, { hidden, group }) => html`<tr id="cap-${r.f.id}" data-a="${r.active ? 1 : 0}" data-d="${r.diff ? 1 : 0}"${attrs({ hidden })}>
    <th scope="row">
      <span class="cmp-cap">${r.f.label}</span>
      <small><span class="cmp-tier">${[S.LABELS.tier[r.f.tier], group].filter(Boolean).join(' · ')}</span>${r.f.description ? html` <span class="cmp-desc">${r.f.description}</span>` : ''}</small>
    </th>
    ${items.map((it) => cell(r, it))}
  </tr>`;
  const sampleGroups = items[0].s.groups;
  const capabilities = html`<section class="wrap section cmp-sec" id="capabilities" aria-labelledby="capabilities-h">
    <div class="section-head">
      <div>
        <h2 id="capabilities-h">All capability checks</h2>
        <p>Every check with its documented status, the points it carries, the evidence note and the official source for ${a.name} and ${b.name}.</p>
      </div>
    </div>
    <div class="toolbar cmp-viewbar" data-nosnippet>
      <div class="seg cmp-view" role="group" aria-label="Which checks to show" data-cmp-view>
        <button type="button" data-view="diff" aria-pressed="false">Differences <span class="n">${diffRows.length}</span></button>
        <button type="button" data-view="scored" aria-pressed="true">Scored checks <span class="n">${activeRows.length}</span></button>
        <button type="button" data-view="all" aria-pressed="false">All checks <span class="n">${rows.length}</span></button>
      </div>
      ${ui.statusLegend()}
    </div>
    <p class="toolbar__count cmp-viewcount" role="status" aria-live="polite" data-cmp-count>Showing the <b>${activeRows.length}</b> checks that count toward the score.</p>
    <table class="cmp-table cmp-table--caps" data-cmp-caps>
      <caption class="sr-only">${category.name} checklist: documented status, points and evidence for ${items.map((it) => it.v.name).join(' and ')}</caption>
      ${cols()}${colHead('Capability check')}
      <tbody>
        ${GROUP_ORDER.map((gid) => {
          const inGroup = activeRows.filter((r) => r.f.scoringGroup === gid);
          if (!inGroup.length) return '';
          const g = sampleGroups.find((x) => x.id === gid);
          return html`<tr class="cmp-group" data-g="${gid}"><th scope="colgroup" colspan="${n + 1}">${groupMeta[gid].label}<small>${ctx.plural(inGroup.length, 'scored check')} · ${pt(g.weight)} of 100 points</small></th></tr>
            ${inGroup.map((r) => capRow(r, { hidden: false }))}`;
        })}
        ${
          inactiveRows.length
            ? html`<tr class="cmp-group cmp-group--off" data-g="off" hidden><th scope="colgroup" colspan="${n + 1}">Not scored yet<small>${ctx.plural(inactiveRows.length, 'deep check')}. ${S.LABELS.inactiveCheck}</small></th></tr>
                ${GROUP_ORDER.flatMap((gid) => inactiveRows.filter((r) => r.f.scoringGroup === gid).map((r) => capRow(r, { hidden: true, group: groupMeta[gid].label })))}
                ${inactiveRows.filter((r) => !GROUP_ORDER.includes(r.f.scoringGroup)).map((r) => capRow(r, { hidden: true }))}`
            : ''
        }
      </tbody>
    </table>
    <p class="empty" data-cmp-empty hidden><b>No scored check differs between these two products.</b>Equal statuses do not mean the products or prices are identical. <button type="button" class="btn btn--quiet btn--sm" data-view="scored">Show the scored checks</button></p>
    <noscript><style>.cmp-table tr[hidden]{display:table-row!important}.cmp-viewbar .seg,.cmp-viewcount{display:none}</style></noscript>
  </section>`;

  // ---------------------------------------------------------------- prices
  const priceLine = (it) =>
    it.p.hasAmount
      ? `${it.v.name} starts at ${it.p.headline}${it.p.unit ? ' ' + it.p.unit : ''}${it.p.billingNote ? `, ${it.p.billingNote}` : ''}${it.p.plan ? ` (${it.p.plan} plan)` : ''}`
      : `${it.v.name} has no verified public starting price${it.p.state === 'quote' ? ' (custom quote)' : it.p.state === 'usage' ? ' (usage-based pricing)' : ''}`;
  const priceDates = [...new Set(items.map((it) => it.p.checkedAt).filter(Boolean))].sort();
  const pricing = html`<section class="wrap section cmp-sec" id="pricing" aria-labelledby="pricing-h">
    <div class="section-head">
      <div>
        <h2 id="pricing-h">How do prices compare?</h2>
        <p>${priceLine(items[0])}; ${priceLine(items[1])}.${priceDates.length ? html` Prices observed ${ui.join(priceDates.map((d) => ui.time(ctx, d)), ' and ')}.` : ''}</p>
      </div>
    </div>
    <table class="cmp-table">
      <caption class="sr-only">${pairName}: public pricing, what it covers and extra costs</caption>
      ${cols()}${colHead('Pricing')}
      <tbody>
        ${row('What the price covers', (it) => it.p.summary || html`<span class="cmp-none">No pricing summary recorded.</span>`)}
        ${row('Additional costs to ask about', (it) => list(it.p.extras, 'None recorded.'))}
        ${row('Price source', (it) => ui.outLink(ctx, it.v, { intent: 'pricing', from: 'comparison', cls: 'cmp-out', explain: false }))}
      </tbody>
    </table>
    <p class="table-note">Public list prices as observed on the dates shown, not quotes. Different billing units are not directly comparable, and tax treatment is not documented. <a href="/tools/cost/?scope=${category.id}">Model your own costs in the calculator</a>.</p>
  </section>`;

  // ---------------------------------------------------------------- AI
  const aiSection = html`<section class="wrap section cmp-sec" id="ai" aria-labelledby="ai-h">
    <div class="section-head">
      <div>
        <h2 id="ai-h">How do their AI capabilities compare?</h2>
        <p>${items.map((it) => `${it.v.name}: ${it.ai.label}`).join('; ')}. Documented does not mean included in every plan.</p>
      </div>
    </div>
    <table class="cmp-table">
      <caption class="sr-only">${pairName}: documented AI level, capabilities and limits</caption>
      ${cols()}${colHead('AI')}
      <tbody>
        ${row('What is documented', (it) => it.v.ai?.summary || html`<span class="cmp-none">No AI summary recorded.</span>`)}
        ${items.some((it) => it.v.ai?.capabilities?.length) ? row('AI capabilities', (it) => list(it.v.ai?.capabilities, 'None recorded.')) : ''}
        ${row('Limits to check', (it) => list(it.v.ai?.limits, 'None recorded.'))}
        ${items.some((it) => it.v.ai?.source) ? row('Source', (it) => (it.v.ai?.source ? ui.sourceLink(it.v.ai.source, 'AI documentation') : html`<span class="cmp-none">No source recorded.</span>`)) : ''}
      </tbody>
    </table>
  </section>`;

  // ---------------------------------------------------------------- integrations + research record
  const integrations = html`<section class="wrap section cmp-sec" id="integrations" aria-labelledby="integrations-h">
    <div class="section-head">
      <div><h2 id="integrations-h">Integrations and research record</h2></div>
    </div>
    <table class="cmp-table">
      <caption class="sr-only">${pairName}: documented integrations and research dates</caption>
      ${cols()}${colHead('Record')}
      <tbody>
        ${row('Integrations', (it) => list(it.v.integrations, 'None recorded.'))}
        ${row('Research date', (it) => html`${ui.time(ctx, it.v.checkedAt)}<small><a href="${ctx.url.software(it.v.id)}#evidence">Full source record</a></small>`)}
      </tbody>
    </table>
  </section>`;

  // ---------------------------------------------------------------- when to choose which
  const choose = html`<section class="wrap section" id="choose" aria-labelledby="choose-h">
    ${ui.sectionHead(`When should you choose ${a.name}? When ${b.name}?`, { id: 'choose-h', sub: 'Neither is better for every team. These fit statements come from the same research as the scores.' })}
    <div class="cmp-choose">
      ${items.map(
        (it) => html`<div class="cmp-choose__col" data-i="${it.i}">
          <h3>${dot()}Choose ${it.v.name} when</h3>
          <p>${it.v.bestFor}</p>
          ${it.v.strengths?.length ? ui.ticks(it.v.strengths) : ''}
          <h4>Look more closely when</h4>
          <p>${it.v.avoidIf}</p>
          ${it.v.tradeoffs?.length ? ui.ticks(it.v.tradeoffs, 'crosses') : ''}
          <p class="cmp-choose__links">
            <a class="link-arrow" href="${ctx.url.software(it.v.id)}">${it.v.name} profile</a>
            ${ui.outLink(ctx, it.v, { intent: 'website', from: 'comparison', cls: 'btn btn--ghost btn--sm' })}
          </p>
        </div>`,
      )}
    </div>
  </section>`;

  // ---------------------------------------------------------------- demo questions
  const scenarios = rows.filter((r) => r.f.demoQuestion && r.f.demoQuestion !== r.f.description);
  const demo =
    category.demoQuestions?.length || scenarios.length
      ? html`<section class="wrap section" id="demo" aria-labelledby="demo-h">
          ${ui.sectionHead('Run the same demo with both vendors', {
            id: 'demo-h',
            sub: 'Use the same sample data and success criteria. Check the result, the handoff, the permissions and the final bill. We did not perform these tests.',
          })}
          ${category.demoQuestions?.length ? html`<ol class="steps cmp-demo">${category.demoQuestions.map((q) => html`<li>${q}</li>`)}</ol>` : ''}
          ${
            scenarios.length
              ? html`<details class="cmp-scenarios">
                  <summary>Demo scenarios for ${scenarios.length} individual checks</summary>
                  <p class="fineprint">Scenarios to run with each supplier; not completed product tests.</p>
                  <dl>
                    ${scenarios.map((r) => html`<div><dt><a href="#cap-${r.f.id}">${r.f.label}</a></dt><dd>${r.f.demoQuestion}</dd></div>`)}
                  </dl>
                </details>`
              : ''
          }
        </section>`
      : '';

  // ---------------------------------------------------------------- method
  const method = html`<section class="wrap section" id="method" aria-labelledby="method-h">
    ${ui.sectionHead('How these scores are calculated', { id: 'method-h', link: { href: '/methodology/', label: 'How scoring works' } })}
    <div class="cmp-method">
      <div class="prose">
        <p>${ui.methodSentence(ctx)}</p>
        <p>Both products are assessed against the same ${category.name} checklist: ${activeRows.length} of its ${rows.length} checks are scored today${
          inactiveRows.length ? `, and the other ${inactiveRows.length} are deep checks that join the score once they have been checked for every listed product` : ''
        }. Product-wide research may span several plans; confirm the package you intend to buy.</p>
      </div>
      <div class="scroller"><table class="dtable cmp-method__table">
        <caption class="sr-only">Score groups: what each covers, its base weight and its points in ${category.name}</caption>
        <thead><tr><th scope="col">Score group</th><th scope="col" class="num">Base weight</th><th scope="col" class="num">Scored checks</th><th scope="col" class="num">Points here</th></tr></thead>
        <tbody>
          ${sampleGroups.map(
            (g) => html`<tr><th scope="row">${g.label}<small>${GROUP_COVERS[g.id] || ''}</small></th><td class="num">${g.baseWeight}%</td><td class="num">${g.totalCount}</td><td class="num">${g.totalCount ? pt(g.weight) : '–'}</td></tr>`,
          )}
        </tbody>
      </table></div>
    </div>
  </section>`;

  // ---------------------------------------------------------------- FAQ + related
  const faq = html`<div class="wrap wrap--narrow section">${ui.faq(ctx, faqItems, { heading: `${pairName}: questions buyers ask` })}</div>`;

  const others = ctx.comparisonsInCategory(category.id).filter((x) => x.id !== comparison.id);
  const vsMeta = (x) => {
    if (ctx.comparisonKind(x) !== 'scored') return '';
    const sc = ctx.comparisonNames(x).map((nm) => ctx.score(category.id, nm.id)).filter(Boolean);
    return sc.length === 2 ? sc.map((s) => (s.pending ? 'pending' : s.value)).join(' vs ') : '';
  };
  const related = html`<section class="wrap section" id="related" aria-labelledby="related-h">
    ${ui.sectionHead('Keep researching', { id: 'related-h', link: { href: compareUrl, label: 'Add a third product' } })}
    ${ui.linkList(
      [
        ...items.flatMap((it) => [
          { href: ctx.url.software(it.v.id), title: `${it.v.name} profile`, sub: 'Pricing, AI, capabilities and the full source record' },
          { href: ctx.url.alternatives(it.v.id), title: `${it.v.name} alternatives`, sub: `Other ${A.categoryThings(category)} on the same checklist` },
        ]),
        { href: ctx.url.category(category.id), title: `${category.name} ranking and buying guide`, sub: `${ctx.summary(category.id).total} products on one checklist` },
        { href: `/compare/?scope=${category.id}`, title: `Compare other ${A.categoryThings(category)}`, sub: 'Pick any two to four products' },
      ],
      { cols: 2 },
    )}
    ${
      others.length
        ? html`<h3 class="cmp-related__h">Other ${category.name} head-to-heads</h3>
            ${ui.linkList(
              others.map((x) => ({ href: ctx.url.vs(x.id), title: x.title || ctx.comparisonNames(x).map((nm) => nm.name).join(' vs '), meta: vsMeta(x) })),
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
      { name: pairName, url: path },
    ],
    pageType: 'WebPage',
    dateModified: lastEvidence || undefined,
    accountable: true,
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    pageExtra: {
      about: vendors.map((v) => ({
        '@type': 'SoftwareApplication',
        '@id': `${ctx.abs(ctx.url.software(v.id))}#software`,
        name: v.name,
        url: v.url,
        applicationCategory: 'BusinessApplication',
        mainEntityOfPage: ctx.abs(ctx.url.software(v.id)),
      })),
      mainEntity: { '@id': `${ctx.abs(path)}#items` },
    },
    jsonld: [
      ctx.seo.itemListNode(
        path,
        vendors.map((v) => ({ name: v.name, url: ctx.url.software(v.id) })),
        { id: '#items', name: 'Products compared', ordered: false },
      ),
    ],
    scripts: ['js/compare.js'],
    body: html`${head}
      <div class="${cx('cmp', `cmp--n${n}`)}" data-cmp data-category="${category.id}" data-ids="${vendors.map((v) => v.id).join(' ')}" data-view="scored">
        ${bar}${glance}${differences}${capabilities}${pricing}${aiSection}${integrations}
      </div>
      ${choose}${demo}${method}${faq}${related}`,
  };
}
