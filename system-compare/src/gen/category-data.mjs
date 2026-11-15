// Emits /data/cat-<id>.js for every scored category: the compact evidence data used by the capability
// matrix popovers, the compare tool and the shortlist page (a few KB per category instead of the whole catalog).
//
// Shape: { id, name, asOf, groups: [[id,label]], features: [[id,label,groupId,active,description]],
//          vendors: [{ id, n, lg, dk, sc, pe, ck, to, cov, da, pr:{h,u,b,pl,s,d,src}, bf, av, ai, aiS, url,
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
    groups: ctx.scoring.SCORE_GROUPS.map((g) => [g.id, g.label]),
    features: rows0.map((r) => [r.id, r.label, r.scoringGroup, r.active ? 1 : 0, r.description || '']),
    vendors: s.ranked.map((v) => {
      const sc = ctx.score(category.id, v.id);
      const p = ctx.price(v, category.id);
      const out = ctx.outbound(v, { intent: 'website', from: 'comparison' });
      return {
        id: v.id,
        n: v.name,
        lg: v.logo?.path || '',
        dk: v.logo?.surface === 'dark' ? 1 : 0,
        sc: sc.value,
        pe: sc.pending ? 1 : 0,
        rk: sc.rank,
        rec: sc.recommended ? 1 : 0,
        ck: sc.checked,
        to: sc.total,
        cov: sc.coveragePct,
        da: sc.checkedAt || '',
        gr: sc.groups.filter((g) => g.totalCount > 0).map((g) => [g.id, +g.earned.toFixed(2), +g.weight.toFixed(2), g.checkedCount, g.totalCount]),
        pr: { h: p.headline, a: p.hasAmount && p.currency === 'USD' ? p.amount : null, u: p.unit, b: p.billingNote, pl: p.plan, s: p.summary, d: p.checkedAt || '', src: p.sourceUrl || '', x: p.extras },
        bf: v.bestFor || '',
        av: v.avoidIf || '',
        ai: ctx.aiLevel(v).label,
        aiS: v.ai?.summary || '',
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
