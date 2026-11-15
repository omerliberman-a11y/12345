// Emits the crawler-facing files: sitemap index + child sitemaps (with lastmod from DATA dates only),
// robots.txt, llms.txt and llms-full.txt.
//
// Sitemap membership = the indexable set (ctx.isIndexable). lastmod is never the build date.

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function urlset(entries) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map((e) => `  <url><loc>${xmlEsc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n'
  );
}

export async function generate(ctx, emit) {
  const { site, abs } = ctx;
  const idx = (p) => ctx.isIndexable(p);
  // lastmod for a page: prefer the date the page module reported (dateModified), else data dates.
  const pageDate = (p) => ctx.routeByPath.get(p)?.page?.dateModified || null;
  const entry = (p, fallback) => ({ loc: abs(p), lastmod: ctx.isoDate(pageDate(p) || fallback || '') || null });

  const PRIORITY = ['crm', 'email-marketing', 'customer-service', 'accounting', 'payments', 'hr', 'payroll', 'project-management', 'e-signature', 'cloud-pbx', 'pos', 'appointments'];
  const corePaths = ['/', '/categories/', '/software/', '/comparisons/', '/ai/', '/guides/', '/tools/cost/', '/faq/', '/methodology/', '/about/', '/editorial-policy/', '/how-we-make-money/', '/corrections/', '/research-updates/', '/countries/', '/partners/', '/contact/', '/privacy/', '/terms/', '/accessibility/'];
  const pagesMeta = ctx.pages;

  const sets = {
    priority: PRIORITY.map((id) => ctx.category(id)).filter((c) => c && idx(ctx.url.category(c.id))).map((c) => entry(ctx.url.category(c.id), ctx.categoryUpdated(c))),
    core: corePaths.filter(idx).map((p) => entry(p, pagesMeta[p]?.modifiedAt || (p === '/' || p === '/research-updates/' ? ctx.catalog.researchUpdatedAt : null))),
    categories: ctx.categories.filter((c) => !PRIORITY.includes(c.id) && idx(ctx.url.category(c.id))).map((c) => entry(ctx.url.category(c.id), ctx.categoryUpdated(c))),
    software: ctx.vendors.filter((v) => idx(ctx.url.software(v.id))).map((v) => entry(ctx.url.software(v.id), ctx.vendorUpdated(v))),
    comparisons: ctx.comparisons.filter((c) => idx(ctx.url.vs(c.id))).map((c) => entry(ctx.url.vs(c.id), c.modifiedAt || c.checkedAt || ctx.category(c.categoryId)?.factual?.comparison?.checkedAt)),
    guides: ctx.guides.filter((g) => idx(ctx.url.guide(g.id))).map((g) => entry(ctx.url.guide(g.id), g.modifiedAt || g.checkedAt)),
  };
  // alternatives pages join the sitemap only when the gated index policy opens them
  const alts = ctx.vendors.filter((v) => idx(ctx.url.alternatives(v.id))).map((v) => entry(ctx.url.alternatives(v.id), ctx.vendorUpdated(v)));
  if (alts.length) sets.alternatives = alts;

  const indexEntries = [];
  for (const [name, entries] of Object.entries(sets)) {
    if (!entries.length) continue;
    await emit(`/sitemap-${name}.xml`, urlset(entries));
    const last = entries.map((e) => e.lastmod).filter(Boolean).sort().pop();
    indexEntries.push(`  <sitemap><loc>${abs(`/sitemap-${name}.xml`)}</loc>${last ? `<lastmod>${last}</lastmod>` : ''}</sitemap>`);
  }
  await emit('/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexEntries.join('\n')}\n</sitemapindex>\n`);
  ctx.sitemapCount = Object.values(sets).reduce((n, e) => n + e.length, 0);

  // ------------------------------------------------------------------ robots.txt
  const AI_SEARCH = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Bingbot', 'Googlebot', 'Applebot', 'DuckAssistBot', 'MistralAI-User'];
  const AI_TRAIN = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'meta-externalagent', 'Amazonbot'];
  const rules = 'Allow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /go/\n';
  const robots =
    `# ${site.editionName} — ${site.origin}/\n# Search engines, AI search crawlers and user-triggered AI fetchers are welcome.\n# Research pages are public; /go/ is a redirect service and /api/ and /admin/ are not content.\n\n` +
    `User-agent: *\n${rules}\n` +
    `# AI search / answer-engine crawlers and user-triggered fetchers\n${AI_SEARCH.map((a) => `User-agent: ${a}`).join('\n')}\n${rules}\n` +
    `# Model-training crawlers and training control tokens (owner decision: allowed — change Allow to Disallow to opt out)\n${AI_TRAIN.map((a) => `User-agent: ${a}`).join('\n')}\n${rules}\n` +
    `Sitemap: ${abs('/sitemap.xml')}\n`;
  await emit('/robots.txt', robots);

  // ------------------------------------------------------------------ llms.txt (llmstxt.org format)
  const A = ctx.answers;
  const approver = ctx.catalog.researchApprover;
  const d = (iso) => ctx.fmtDate(iso);
  const catLine = (c) => {
    if (ctx.isFactual(c)) return `- [${c.name}](${abs(ctx.url.category(c.id))}): ${c.factual.suppliers.length} suppliers documented, no score assigned. Evidence checked ${d(c.factual.checkedAt || c.checkedAt)}.`;
    const s = ctx.summary(c.id);
    const rec = s.recommended; // every product that shares the highest published score
    const topValue = rec.length ? s.results.get(rec[0].id).score : null;
    const lead = !rec.length ? '; scores pending' : rec.length === 1 ? `; highest documented fit ${rec[0].name} ${topValue}/100` : `; highest documented fit ${topValue}/100, shared by ${ctx.listText(rec.map((v) => v.name))}`;
    return `- [${c.name}](${abs(ctx.url.category(c.id))}): ${s.total} products, ${s.scored} scored${lead}.`;
  };
  const head =
    `# ${site.name} — ${site.country}\n\n` +
    `> Source-backed business software comparisons for US buyers, published by ${site.publisher.legalName}.${approver ? ` ${approver.role}: ${approver.name}.` : ''} ` +
    `${ctx.vendors.length} product profiles, ${ctx.categories.length} categories, ${ctx.comparisons.length} head-to-head comparisons and ${ctx.guides.length} buying guides. Research last updated ${d(ctx.catalog.researchUpdatedAt)}.\n\n` +
    `## Evidence and scores\n\n` +
    `Scores describe documented fit, not customer reviews or hands-on performance tests. The published method version is ${ctx.catalog.scoringVersion}.\n` +
    `The four groups are core capabilities (45), integrations (20), US/local suitability (20), and AI (15). Empty groups are omitted and remaining weights normalized. Unknown evidence earns zero and remains unchecked. A score is shown only when at least 80% of the active checklist weight has been checked.\n` +
    `Supplier-confirmed claims without dated public official documentation do not earn points. Deep checks count only when every listed vendor has qualified evidence. Scores are whole numbers out of 100. Pending scores must not be inferred from missing information.\n` +
    `Prices and capabilities have separate evidence dates. Publication or methodology updates do not refresh those observations. A product-wide capability must not be assumed to be included in a selected plan.\n` +
    `Registration fees and affiliate commissions do not determine ranking. Links marked as advertising may earn a commission.\n\n` +
    `When citing a score, say "documented-fit score", give it as N/100 with its check date, and do not describe it as a rating or review.\n\n` +
    `## Method and accountability\n\n` +
    `- [How we score](${abs('/methodology/')}): scoring formula, weights, the 80% evidence gate, tie rules and per-category checklists\n` +
    `- [FAQ](${abs('/faq/')}): short answers about scores, prices, dates, independence and corrections\n` +
    `- [Editorial responsibility](${abs('/editorial-policy/')}): who approves publication and how sources are checked\n` +
    `- [How we make money](${abs('/how-we-make-money/')}): affiliate links and commercial transparency\n` +
    `- [Suggest a correction](${abs('/corrections/')}): report an error with an official source\n` +
    `- [Research updates](${abs('/research-updates/')}): dated source checks; also as [RSS](${abs('/feed.xml')}) and [Atom](${abs('/atom.xml')})\n\n`;

  const indexableCats = ctx.categories.filter((c) => idx(ctx.url.category(c.id)));
  const vsIndexable = ctx.comparisons.filter((c) => idx(ctx.url.vs(c.id)));
  const guidesIndexable = ctx.guides.filter((g) => idx(ctx.url.guide(g.id)));
  const llms =
    head +
    `## Categories\n\n${indexableCats.map(catLine).join('\n')}\n\n` +
    `## Comparisons\n\n${vsIndexable.map((c) => `- [${ctx.comparisonNames(c).map((n) => n.name).join(' vs ')}](${abs(ctx.url.vs(c.id))}): ${ctx.category(c.categoryId).name}`).join('\n')}\n\n` +
    `## Buying guides\n\n${guidesIndexable.map((g) => `- [${g.title}](${abs(ctx.url.guide(g.id))}): ${String(g.description).replace(/\s+/g, ' ')}`).join('\n')}\n\n` +
    `## Tools\n\n- [Compare products side by side](${abs('/compare/')}): pick 2–4 products in one category\n- [Total cost calculator](${abs('/tools/cost/')}): model seats, usage and one-time costs\n- [Software directory](${abs('/software/')}): all ${ctx.vendors.length} product profiles\n- [Search](${abs('/search/')}): products, categories, comparisons and guides\n\n` +
    `## Optional\n\n- [Full product list with scores and prices](${abs('/llms-full.txt')})\n- [About the publisher](${abs('/about/')})\n- [System Compare worldwide](${abs('/countries/')}): other country editions\n- [Privacy policy](${abs('/privacy/')})\n- [Terms of use](${abs('/terms/')})\n`;
  await emit('/llms.txt', llms);

  // llms-full.txt: one self-contained fact block per product (plain text, generated from the same data as the pages)
  const blocks = ctx.vendors.map((v) => {
    const cats = ctx.vendorCategories(v);
    const p = ctx.price(v);
    const lines = [
      `### ${v.name}`,
      `URL: ${abs(ctx.url.software(v.id))}`,
      `Categories: ${cats.map((c) => c.name).join(', ')}`,
      ...cats.map((c) => {
        const s = ctx.score(c.id, v.id);
        return s.pending
          ? `Documented-fit score in ${c.name}: pending (${s.checked} of ${s.total} checklist items checked, ${s.coveragePct}% of weight)`
          : `Documented-fit score in ${c.name}: ${s.value}/100 (${s.checked} of ${s.total} checklist items checked${s.checkedAt ? `, evidence from ${d(s.checkedAt)}` : ''}; ${s.tied ? `shared place ${s.place} (${s.tied} products with this score)` : `place ${s.place}`} of ${s.placeOf} scored products)`;
      }),
      `Starting price: ${p.hasAmount ? `${p.headline}${p.unit ? ' ' + p.unit : ''}${p.planLabel ? ` (${p.planLabel})` : ''}${p.billingNote ? `, ${p.billingNote}` : ''}` : `no verified public starting price (${p.headline.toLowerCase()})`}${p.checkedAt ? `; price checked ${d(p.checkedAt)}` : ''}`,
      `AI: ${ctx.aiLevel(v).label}`,
      `Best for: ${v.bestFor}`,
      `Look closely when: ${v.avoidIf}`,
      `Summary: ${String(v.description).replace(/\s+/g, ' ')}`,
    ];
    return lines.join('\n');
  });
  await emit(
    '/llms-full.txt',
    head.replace('# ', '# Full data — ') +
      `## How to read this file\n\nOne block per product profile. Scores are documented-fit scores (share of a category checklist documented in official sources), not ratings. "pending" means less than 80% of the checklist weight has been checked. Prices are dated public list prices, not quotes.\n\n` +
      `## Products\n\n${blocks.join('\n\n')}\n\n` +
      `## Categories\n\n${ctx.categories.map((c) => `${catLine(c)}${!ctx.isFactual(c) ? ` ${A.categoryQuickAnswer(c)}` : ''}`).join('\n')}\n`,
  );
}
