// Emits /data/cat-<id>.js for every scored category: the compact evidence data used by the capability
// matrix popovers, the compare tool and the shortlist page (a few KB per category instead of the whole catalog).
//
// Shape: { id, name, asOf, groups: [[id,label,weight]], features: [[id,label,groupId,active,description,tier,demoQuestion]],
//          vs: [[vendorA, vendorB, comparisonId]],
//          vendors: [{ id, n, lg, dk, sc, pe, rk, rec, ck, to, cov, da, gr, pr:{h,a,u,b,pl,s,d,src,x,m,go,aff,host}, bf, av,
//                      ai, aiS, aiL, aiU, ig, rd, go, aff, host,
//                      c: [[statusCode, note, verificationCode, date, source]] }] }
// statusCode: y | p | n | u   verificationCode: d (official documentation) | v (vendor confirmed) | '' (not verified)

const ST = { yes: 'y', partial: 'p', no: 'n', unknown: 'u' };
const VER = { 'public-documentation': 'd', 'vendor-confirmed': 'v' };

export function categoryData(ctx, category) {
  const s = ctx.summary(category.id);
  const rows0 = s.ranked[0] ? ctx.fit(category.id, s.ranked[0].id).rows : [];
  return {
    id: category.id,
    name: category.name,
    asOf: ctx.isoDate(ctx.catalog.checkedAt),
    groups: ctx.scoring.SCORE_GROUPS.map((g) => [g.id, g.label, g.weight]),
    features: rows0.map((r) => {
      const f = [r.id, r.label, r.scoringGroup, r.active ? 1 : 0, r.description || '', r.tier || '', r.demoQuestion || r.demo || ''];
      while (f.length > 5 && !f[f.length - 1]) f.pop();
      return f;
    }),
    // published head-to-head pages in this category: [vendorA, vendorB, comparisonId]
    vs: ctx.comparisonsInCategory(category.id).filter((c) => (c.vendorIds || []).length === 2).map((c) => [c.vendorIds[0], c.vendorIds[1], c.id]),
    vendors: s.ranked.map((v) => {
      const sc = ctx.score(category.id, v.id);
      const p = ctx.price(v, category.id);
      const out = ctx.outbound(v, { intent: 'website', from: 'comparison' });
      const outPricing = ctx.outbound(v, { intent: 'pricing', from: 'comparison' });
      return {
        id: v.id,
        n: v.name,
        lg: v.logo?.path || '',
        dk: v.logo?.surface === 'dark' || v.logo?.surface === 'brand-gradient' ? 1 : 0,
        sc: sc.value,
        pe: sc.pending ? 1 : 0,
        rk: sc.rank,
        rec: sc.recommended ? 1 : 0,
        ck: sc.checked,
        to: sc.total,
        cov: sc.coveragePct,
        da: sc.checkedAt || '',
        gr: sc.groups.filter((g) => g.totalCount > 0).map((g) => [g.id, +g.earned.toFixed(2), +g.weight.toFixed(2), g.checkedCount, g.totalCount]),
        pr: { h: p.headline, a: p.hasAmount && p.currency === 'USD' ? p.amount : null, u: p.unit, b: p.billingNote, pl: p.plan, s: p.summary, d: p.checkedAt || '', src: p.sourceUrl || '', x: p.extras, m: p.modelLabel, go: outPricing.href, aff: outPricing.affiliate ? 1 : 0, host: outPricing.attrs['data-destination-host'] },
        bf: v.bestFor || '',
        av: v.avoidIf || '',
        ai: ctx.aiLevel(v).label,
        aiS: v.ai?.summary || '',
        aiL: v.ai?.limits || [],
        aiU: v.ai?.source || '',
        ig: v.integrations || [],
        rd: ctx.isoDate(v.checkedAt) || '',
        go: out.href,
        aff: out.affiliate ? 1 : 0,
        host: out.attrs['data-destination-host'],
        c: sc.rows.map((r) => {
          const e = r.evidence || {};
          const cellData = [ST[r.effectiveStatus] || 'u', e.note || '', VER[e.verification] || '', e.checkedAt ? ctx.isoDate(e.checkedAt) : '', e.source || ''];
          while (cellData.length > 1 && !cellData[cellData.length - 1]) cellData.pop();
          return cellData;
        }),
      };
    }),
  };
}

export async function generate(ctx, emit) {
  for (const category of ctx.scoredCategories) {
    await emit(`/data/cat-${category.id}.js`, `SC.define("cat-${category.id}",${JSON.stringify(categoryData(ctx, category))});`);
  }
}
