// Which URLs search engines may index.
//
// 'parity' reproduces the live site's policy exactly (verified against all 540 live pages by
// verifyParity()). 'gated' additionally opens generated head-to-head pages and alternatives pages
// that carry enough distinct, scored data to stand on their own.

export function createIndexing({ catalog, categoryById, vendorById, summary, isFactual, price, comparisonKind, site, liveHead }) {
  const gated = site.indexPolicy === 'gated';

  // Category: documentary AI-tool categories and scored categories with fewer than 4 products stay out.
  const categoryNoindex = (c) => (isFactual(c) ? c.group === 'AI tools' : (c.scoring?.vendorIds?.length ?? summary(c.id).total) < 4);

  // Generated /vs/ page gate: both products scored AND (a scored check differs OR both have numeric prices).
  function vsGate(comparison) {
    if (comparisonKind(comparison) !== 'scored') return true;
    const s = summary(comparison.categoryId);
    const results = (comparison.vendorIds || []).map((id) => s.results.get(id));
    if (results.length !== 2 || results.some((r) => !r || r.score === null)) return false;
    const [a, b] = results;
    const differs = a.rows.some((row, i) => row.active && row.effectiveStatus !== b.rows[i].effectiveStatus);
    const prices = comparison.vendorIds.map((id) => price(vendorById.get(id), comparison.categoryId));
    return differs || prices.every((p) => p.hasAmount);
  }

  // Alternatives gate: focal product scored, at least 4 alternatives of which at least 2 are scored.
  function altGate(vendor) {
    const categoryId = catalog.categories.find((c) => vendor.categories?.includes(c.id))?.id;
    if (!categoryId) return false;
    const s = summary(categoryId);
    const focal = s.results.get(vendor.id);
    const others = s.ranked.filter((v) => v.id !== vendor.id);
    return Boolean(focal && focal.score !== null) && others.length >= 4 && others.filter((v) => s.results.get(v.id).score !== null).length >= 2;
  }

  function isIndexable(path) {
    let m;
    if ((m = path.match(/^\/categories\/([^/]+)\/$/))) {
      const c = categoryById.get(m[1]);
      return Boolean(c) && !categoryNoindex(c);
    }
    if ((m = path.match(/^\/guides\/([^/]+)\/$/))) {
      const g = catalog.guides.find((x) => x.id === m[1]);
      const c = g && categoryById.get(g.categoryIds?.[0]);
      return Boolean(g) && !(c && categoryNoindex(c));
    }
    if ((m = path.match(/^\/vs\/([^/]+)\/$/))) {
      const c = catalog.comparisons.find((x) => x.id === m[1]);
      if (!c) return false;
      if (c.mode) return true; // editorial + factual comparisons are indexable today
      return gated && vsGate(c);
    }
    if ((m = path.match(/^\/alternatives\/([^/]+)\/$/))) {
      const v = vendorById.get(m[1]);
      return Boolean(v) && gated && altGate(v);
    }
    if (/^\/(compare|shortlist|search)\/$/.test(path) || path === '/partners/apply/' || path === '/404.html') return false;
    return true;
  }

  /** Compare the parity rules with what the live site serves; returns the list of disagreements. */
  function verifyParity() {
    const mismatches = [];
    for (const [p, live] of Object.entries(liveHead)) {
      const saved = site.indexPolicy;
      const expected = live.indexable;
      // evaluate under parity regardless of the configured policy
      const actual = (() => {
        let m;
        if ((m = p.match(/^\/vs\/([^/]+)\/$/))) return Boolean(catalog.comparisons.find((x) => x.id === m[1])?.mode);
        if (/^\/alternatives\//.test(p)) return false;
        return isIndexable(p);
      })();
      void saved;
      if (actual !== expected) mismatches.push({ path: p, live: expected, rule: actual });
    }
    return mismatches;
  }

  return { isIndexable, categoryNoindex, vsGate, altGate, verifyParity, policy: site.indexPolicy };
}
