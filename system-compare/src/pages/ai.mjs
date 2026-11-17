// AI research hub (/ai/): what the catalog documents about AI, per category and per product.
// The explainer copy is the publisher's own and is kept verbatim; every number comes from vendor.ai.level.

import { html, raw, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes(ctx) {
  return [{ path: '/ai/', render }];
}

// column order of the evidence table (ctx.AI_LEVELS ids)
const LEVELS = ['native', 'agent', 'assistant', 'predictive', 'integration', 'not-verified'];
const COLUMN = { native: 'Native AI', agent: 'AI agents', assistant: 'AI assistant', predictive: 'Predictive AI', integration: 'Via integration', 'not-verified': 'Not verified' };

const EXPLAINER = [
  { n: '01', kind: 'Assistance', title: 'Drafting & summaries', body: 'Does the tool generate a suggestion for a person to review? Check grounding, language and data access.' },
  { n: '02', kind: 'Prediction', title: 'Signals & decisions', body: 'Does it predict a result or recommend an action? Check data requirements and how a person can challenge it.' },
  { n: '03', kind: 'Execution', title: 'Agents & actions', body: 'Can it change an external system? Check permissions, approval, escalation, evaluation and usage limits.' },
];
const CAVEAT = 'Documented does not mean included in every plan. Not verified does not mean the product has no AI.';
const WEIGHT_TEXT =
  'AI has a base weight of 15 alongside core capabilities 45, integrations 20 and local suitability 20. In categories whose main job is AI, those main functions are core. Empty groups are omitted and the other weights normalized. The same method applies to every vendor.';
const FIVE_QUESTIONS = [
  'Which exact task can it complete, and which steps still need a person?',
  'What is included in this plan, and what consumes credits, sessions, minutes or outcomes?',
  'What customer and company data can it access?',
  'Can a user approve, reverse or stop an action and reach a human?',
  'Can you test quality and cost using your own representative cases?',
];
const DISCLAIMER = 'The hub is a research map across categories. It does not create an overall ranking of unrelated products.';

function render(ctx) {
  const levelOf = (v) => ctx.aiLevel(v).id;
  const tally = (vendors) => {
    const t = Object.fromEntries(LEVELS.map((l) => [l, 0]));
    for (const v of vendors) t[levelOf(v)] += 1;
    return t;
  };
  const byName = (a, b) => a.name.localeCompare(b.name, 'en');

  const all = tally(ctx.vendors);
  const total = ctx.vendors.length;
  // the AI field of a product was read with its evidence check, and again by a later source check that updated it
  const aiDates = [
    ...ctx.vendors.map((v) => v.checkedAt),
    ...ctx.vendors.filter((v) => v.researchReview?.changedFields?.includes('ai')).map((v) => v.researchReview.observedAt),
  ]
    .map((d) => ctx.isoDate(d))
    .filter(Boolean)
    .sort();
  const span = (dates) => {
    const from = dates[0];
    const to = dates[dates.length - 1];
    return from === to ? ui.time(ctx, to) : html`${ui.time(ctx, from)} – ${ui.time(ctx, to)}`;
  };
  const aiChecked = span(aiDates);

  // ---- (1) evidence by scored category, in the site's category groups
  const scoredGroups = ctx.groups
    .map((g) => ({ group: g, cats: g.categories.filter((c) => !ctx.isFactual(c)) }))
    .filter((x) => x.cats.length);
  const catRow = (c) => {
    const vendors = ctx.summary(c.id).ranked;
    return { c, n: vendors.length, t: tally(vendors) };
  };
  // data-l is the unit shown after the number when the table is stacked on small screens ("7 native AI")
  const SHORT = { native: 'native AI', agent: 'agent-level', assistant: 'assistant', predictive: 'predictive', integration: 'via integration', 'not-verified': 'not verified' };
  const num = (n, l) => html`<td class="${n ? 'num' : 'num gd-zero'}" data-l="${SHORT[l]}">${n}</td>`;

  const categoryTable = html`<div class="scroller">
    <table class="dtable gd-aitable">
      <caption class="sr-only">Documented AI level of the products in each scored category</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col" class="num">Products</th>
          ${LEVELS.map((l) => html`<th scope="col" class="num">${COLUMN[l]}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${scoredGroups.map(
          ({ group, cats }) => html`<tr class="is-group"><th scope="colgroup" colspan="${LEVELS.length + 2}">${group.label}</th></tr>
          ${cats.map((c) => {
            const r = catRow(c);
            return html`<tr>
              <th scope="row"><a href="${ctx.url.category(c.id)}">${c.name}</a></th>
              <td class="num" data-l="products">${r.n}</td>
              ${LEVELS.map((l) => num(r.t[l], l))}
            </tr>`;
          })}`,
        )}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">All products, each counted once</th>
          <td class="num" data-l="products">${total}</td>
          ${LEVELS.map((l) => num(all[l], l))}
        </tr>
      </tfoot>
    </table>
  </div>
  <p class="table-note">Counts are products per documented AI level, from official vendor sources checked ${aiChecked}. A product listed in several categories is counted in each of them, so category rows add up to more than the ${total} products in the last row. ${CAVEAT}</p>`;

  // ---- (2) products with documented AI agents
  const agents = ctx.vendors.filter((v) => levelOf(v) === 'agent').sort(byName);
  const agentTable = html`<div class="scroller">
    <table class="dtable gd-agents">
      <caption class="sr-only">Products with documented AI agents: what is documented and the stated limits</caption>
      <thead>
        <tr><th scope="col">Product</th><th scope="col">What is documented</th><th scope="col">Limits to confirm</th></tr>
      </thead>
      <tbody>
        ${agents.map(
          (v) => html`<tr>
            <th scope="row">
              <a class="gd-prod" href="${ctx.url.software(v.id)}#ai">${ui.logo(ctx, v, { size: 'sm' })}<span>${v.name}</span></a>
              <small>${ui.join(ctx.vendorCategories(v).map((c) => html`<a href="${ctx.url.category(c.id)}">${c.name}</a>`), ', ')}</small>
            </th>
            <td>${v.ai.summary}${v.ai.capabilities?.length ? html`<small>${v.ai.capabilities.join(' · ')}</small>` : ''}${v.ai.source ? html`<small>${ui.sourceLink(v.ai.source, 'Official source')}</small>` : ''}</td>
            <td data-l="Limits to confirm">${v.ai.limits?.length ? html`<ul class="gd-limits">${v.ai.limits.map((l) => html`<li>${l}</li>`)}</ul>` : 'No limit recorded'}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>`;

  // ---- products per level (names link to the AI section of each profile)
  const perLevel = LEVELS.filter((l) => l !== 'agent' && all[l]).map((l) => ({
    id: l,
    meta: ctx.AI_LEVELS[l],
    vendors: ctx.vendors.filter((v) => levelOf(v) === l).sort(byName),
  }));
  const levelLists = html`<div class="acc gd-levels">
    ${perLevel.map(
      (lv) => html`<details id="level-${lv.id}">
        <summary><h3>${lv.meta.label} <span class="gd-count">${ctx.plural(lv.vendors.length, 'product')}</span></h3></summary>
        <div class="acc__body">
          <p>${lv.meta.help}</p>
          <ul class="gd-names">${lv.vendors.map((v) => html`<li><a href="${ctx.url.software(v.id)}#ai">${v.name}</a></li>`)}</ul>
        </div>
      </details>`,
    )}
  </div>`;

  // ---- (3) AI-tool categories (documentary) in their three groups, then every other documentary category
  const isAiTool = (c) => ctx.isFactual(c) && c.group === 'AI tools';
  const supplierCount = (c) => c.factual?.suppliers?.length || 0;
  // every documentary category documents the same number of suppliers today; say it once instead of on every row
  const uniform = new Set(ctx.factualCategories.map(supplierCount)).size === 1 ? supplierCount(ctx.factualCategories[0]) : 0;
  const docItem = (c) => ({ href: ctx.url.category(c.id), title: c.name, meta: uniform ? '' : ctx.plural(supplierCount(c), 'supplier') });
  const aiToolGroups = ctx.groups.map((g) => ({ group: g, cats: g.categories.filter(isAiTool) })).filter((x) => x.cats.length);
  const aiToolCount = aiToolGroups.reduce((n, x) => n + x.cats.length, 0);
  const otherDocs = ctx.categories.filter((c) => ctx.isFactual(c) && !isAiTool(c));
  const docChecked = span(ctx.factualCategories.map((c) => ctx.isoDate(c.factual?.checkedAt)).filter(Boolean).sort());

  // ---- head
  const head = html`<header class="wrap page-head page-head--wide gd-hub">
    <p class="eyebrow">The AI research desk</p>
    <h1>Less AI hype.<br>More workflow evidence.</h1>
    <p class="lede">Every product has an AI research field. ${CAVEAT}</p>
    ${ui.trustline([
      html`AI evidence checked ${aiChecked}`,
      `${total} products · ${ctx.categories.length} categories`,
      'Desk research, not hands-on testing',
      html`<a href="/methodology/">How we score</a>`,
    ])}
  </header>
  <div class="wrap gd-answer">
    ${ui.answer(
      ctx,
      html`Of the <strong>${total} products</strong> we researched, <strong>${all.native}</strong> document native AI features, <strong>${all.agent}</strong> document AI agents that can take actions, <strong>${all.assistant}</strong> an AI assistant, <strong>${all.predictive}</strong> predictive AI and <strong>${all.integration}</strong> AI through an integration. For <strong>${all['not-verified']}</strong> we found no official AI documentation, which is not proof that the product has none.`,
    )}
    ${ui.facts(
      LEVELS.map((l) => ({ label: ctx.AI_LEVELS[l].label, value: `${all[l]} of ${total}`, sub: ctx.AI_LEVELS[l].help })),
      { cols: 3 },
    )}
  </div>`;

  const nav = ui.subnav([
    { href: '#kinds', label: 'Kinds of AI' },
    { href: '#by-category', label: 'By category' },
    { href: '#agents', label: 'AI agents' },
    { href: '#levels', label: 'By AI level' },
    { href: '#ai-tools', label: 'AI tools' },
    { href: '#score', label: 'AI in the score' },
    { href: '#faq', label: 'FAQ' },
  ]);

  const kinds = html`<section class="wrap section section--flush" id="kinds" aria-labelledby="kinds-h">
    ${ui.sectionHead('Three kinds of AI, three different checks', { id: 'kinds-h' })}
    <ol class="gd-kinds">
      ${EXPLAINER.map((e) => html`<li><span class="gd-kinds__n">${e.n} / ${e.kind}</span><h3>${e.title}</h3><p>${e.body}</p></li>`)}
    </ol>
  </section>`;

  const byCategory = html`<section class="wrap section" id="by-category" aria-labelledby="by-category-h">
    ${ui.sectionHead('AI evidence by category', {
      id: 'by-category-h',
      sub: `How the products in each of the ${ctx.scoredCategories.length} scored categories document AI. Open a category to see the AI checks in its capability table.`,
    })}
    ${categoryTable}
  </section>`;

  const agentSection = html`<section class="wrap section" id="agents" aria-labelledby="agents-h">
    ${ui.sectionHead('Products with documented AI agents', {
      id: 'agents-h',
      sub: `${ctx.plural(agents.length, 'product')} document an agent that can take actions, not only assist. Confirm permissions, approval and usage limits on the plan you intend to buy.`,
    })}
    ${agentTable}
  </section>`;

  const levelSection = html`<section class="wrap section" id="levels" aria-labelledby="levels-h">
    ${ui.sectionHead('Products by documented AI level', { id: 'levels-h', sub: 'Each name opens the AI section of the product profile, with its sources and limits.' })}
    ${levelLists}
  </section>`;

  // documented head-to-heads of the dedicated AI-tool categories (this hub is their natural entry point)
  const aiToolCatIds = new Set(aiToolGroups.flatMap(({ cats }) => cats.map((c) => c.id)));
  const aiVs = ctx.comparisons.filter((k) => aiToolCatIds.has(k.categoryId) && ctx.comparisonKind(k) === 'factual');
  const aiTools = html`<section class="wrap section" id="ai-tools" aria-labelledby="ai-tools-h">
    ${ui.sectionHead('AI tool categories', {
      id: 'ai-tools-h',
      sub: html`${aiToolCount} categories of dedicated AI tools${uniform ? `, ${uniform} suppliers documented in each` : ''}. AI evidence and open questions; score pending. Official sources checked ${docChecked}.`,
    })}
    <div class="gd-doccols">
      ${aiToolGroups.map(
        ({ group, cats }) => html`<div>
          <h3>${group.label}</h3>
          <p>${group.blurb}</p>
          ${ui.linkList(cats.map(docItem), { cols: 1 })}
        </div>`,
      )}
    </div>
    <h3 class="gd-subhead" id="documentary">Other categories with AI evidence and open questions</h3>
    <p class="gd-sub">${otherDocs.length} more documentary categories${uniform ? `, ${uniform} suppliers in each` : ''}. Each page states what suppliers document about AI and what remains open; score pending.</p>
    <div class="gd-chiplinks">${ui.chipLinks(otherDocs.map((c) => ({ href: ctx.url.category(c.id), label: c.name })))}</div>
    ${
      aiVs.length
        ? html`<h3 class="gd-subhead" id="ai-comparisons">AI tools head to head</h3>
            <p class="gd-sub">${ctx.plural(aiVs.length, 'documented comparison')} of named AI offers: prices, limits and criteria side by side, with no score assigned.</p>
            ${ui.linkList(
              // the category goes on the second line: long names ("AI runtime security and guardrails") do not fit beside the pair on a phone
              aiVs.map((k) => ({ href: ctx.url.vs(k.id), title: ctx.comparisonNames(k).map((n) => n.name).join(' vs '), sub: ctx.category(k.categoryId).name })),
              { cols: 2 },
            )}`
        : ''
    }
  </section>`;

  const score = html`<section class="wrap section gd-score" id="score" aria-labelledby="score-h">
    ${ui.sectionHead('AI has a published weight.', { id: 'score-h', sub: 'A visible part of the score.', link: { href: '/methodology/', label: 'Full method' } })}
    <div class="gd-two">
      <div>
        <p class="gd-weight">${WEIGHT_TEXT}</p>
        <table class="dtable gd-weights">
          <caption class="sr-only">Base weight of each score group, out of 100</caption>
          <thead><tr><th scope="col">Score group</th><th scope="col" class="num">Base weight</th></tr></thead>
          <tbody>
            ${ctx.scoring.SCORE_GROUPS.map((g) => html`<tr><th scope="row">${g.label}</th><td class="num">${g.weight}</td></tr>`)}
          </tbody>
        </table>
      </div>
      <div>
        <h3 class="gd-subhead gd-subhead--flush">Five questions before you buy AI</h3>
        <ol class="steps">${FIVE_QUESTIONS.map((q) => html`<li>${q}</li>`)}</ol>
      </div>
    </div>
  </section>`;

  // ---- FAQ: answers restate the copy and the counts above
  const agentNames = ctx.listText(agents.map((v) => v.name));
  const faqItems = [
    {
      q: 'What is the difference between an AI assistant and an AI agent in business software?',
      a: `An assistant generates a suggestion for a person to review, such as a draft or a summary. An agent can change an external system. For an assistant, check grounding, language and data access; for an agent, check permissions, approval, escalation, evaluation and usage limits. In this catalog ${all.assistant} products document an AI assistant and ${all.agent} document AI agents.`,
    },
    {
      q: 'Which products have documented AI agents?',
      a: `${agents.length} of the ${total} products document AI agents that can take actions: ${agentNames}. ${CAVEAT}`,
    },
    {
      q: 'Does AI change the score?',
      a: WEIGHT_TEXT,
    },
    {
      q: 'What does “AI not verified” mean?',
      a: `${ctx.AI_LEVELS['not-verified'].help} It applies to ${all['not-verified']} of the ${total} products.`,
    },
  ];
  const faq = html`<div class="wrap wrap--narrow section">
    ${ui.faq(ctx, faqItems, { heading: 'Questions about AI in business software', open: 0 })}
    <p class="fineprint gd-disclaimer">${DISCLAIMER}</p>
  </div>`;

  const listed = [...scoredGroups.flatMap((x) => x.cats), ...aiToolGroups.flatMap((x) => x.cats), ...otherDocs].filter((c) => ctx.isIndexable(ctx.url.category(c.id)));

  return {
    title: seoTitle('AI in business software: what is documented'),
    description: describe([
      `How ${total} business tools document AI: ${all.native} native, ${all.assistant} assistant, ${all.agent} agent-level and ${all['not-verified']} not verified. Limits, sources and categories.`,
      'Distinguish AI assistants, predictions and agents, and compare their effect on documented software fit.',
    ]),
    ogTitle: 'AI capability research',
    nav: 'categories',
    breadcrumbs: [{ name: 'AI capability research', url: '/ai/' }],
    pageType: 'CollectionPage',
    dateModified: ctx.isoDate(ctx.catalog.researchUpdatedAt),
    accountable: true,
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    pageExtra: { mainEntity: { '@id': `${ctx.abs('/ai/')}#primary-list` } },
    jsonld: [ctx.seo.itemListNode('/ai/', listed.map((c) => ({ name: c.name, url: ctx.url.category(c.id) })), { name: 'Software categories with AI research', ordered: false })],
    body: html`${head}${nav}${kinds}${byCategory}${agentSection}${levelSection}${aiTools}${score}${faq}`,
  };
}
