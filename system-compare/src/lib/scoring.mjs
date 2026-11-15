// scoring.mjs — dependency-free reproduction of the system-compare.com (US edition)
// "documented-fit score" method v4.0: scores, score-pending gate, ranking and tie
// rules, "Recommended" logic, every score label string, price display strings and
// the home "Category leaders" selection. Pure functions over the parsed /api/catalog
// JSON (catalog.json); nothing here touches the network, the DOM or the clock.
//
// Fidelity: verify-scoring.mjs extracts the published values from the mirrored HTML
// (66 category pages, 149 product pages, /software/, 149 /alternatives/ pages,
// 117 /vs/ pages, /compare/, /, /categories/, /comparisons/, /methodology/,
// /tools/cost/) and compares them with this module: 50,030 comparisons, 0 mismatches
// (see scoring.md).
//
// The scoring core (sections 2–6, 12) is a line-for-line port of the functions the
// live site ships in /app.js (publicScoreEvidence, scoreEvidence, featureBreakdown,
// scoreWeightedFraction, fit, rankVendors, recommendedVendors, planSelection ...).
// Price strings (9, 13), the home leaders rule (10) and the comparison helpers (11)
// are server-side on the live site and were reconstructed from the rendered HTML.
//
// Quick start
//   import * as sc from './scoring.mjs';
//   const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
//   const category = catalog.categories.find((c) => c.id === 'crm');
//   const summary = sc.categorySummary(catalog, category);   // ranking, recommended, counts
//   const result  = sc.fit(category, summary.ranked[0]);     // score record of one pair
//   sc.scoreBlock(result);                                   // the label strings to print
//   sc.formatPrice(vendor, { categoryId: 'crm', variant: 'journey' });
//   sc.homeCategoryLeaders(catalog);                         // home "Category leaders" cards
//   sc.scoreCatalog(catalog).pairs;                          // all 239 scored + 132 factual pairs

// ---------------------------------------------------------------------------
// 1. Constants and verbatim label strings
// ---------------------------------------------------------------------------

export const SCORE_METHOD_VERSION = '4.0';

export const SCORE_GROUPS = Object.freeze([
  Object.freeze({ id: 'core', label: 'Core capabilities', weight: 45 }),
  Object.freeze({ id: 'integrations', label: 'Integrations', weight: 20 }),
  Object.freeze({ id: 'local', label: 'Local suitability', weight: 20 }),
  Object.freeze({ id: 'ai', label: 'AI capabilities', weight: 15 }),
]);

export const SCORE_GATE_PERCENT = 80;

export const LABELS = Object.freeze({
  scoreLabel: 'Documented-fit score',
  scorePending: 'Score pending',
  scoreGate: 'Shown after at least 80% of the checklist weight is checked.',
  factualPending: 'Score pending · evidence checklist not yet classified for scoring',
  recommended: 'Recommended',
  methodSentence:
    'Ranked by documented-fit score (0–100): the weighted share of the category checklist documented in official sources as of <date> (core capabilities 45, integrations 20, local suitability 20, AI 15). Unverified items score zero, and no score is shown until 80% of the checklist weight has been checked. No vendor pays for placement.',
  inactiveCheck: 'Not included in the score: this deep check has not been checked for every listed vendor.',
  tier: Object.freeze({ foundation: 'Foundation check', advanced: 'Shared deep check' }),
  tierSummary: Object.freeze({ foundation: 'Foundation checks', advanced: 'Shared deep checks' }),
  // effective (scored) evidence status -> label
  status: Object.freeze({ yes: 'Supported', partial: 'Limited', no: 'Not supported', unknown: 'Not verified' }),
  // evidence.verification -> label
  verification: Object.freeze({
    'public-documentation': 'Official documentation',
    'vendor-confirmed': 'Vendor confirmed',
    'not-verified': 'Not verified',
  }),
});

// ---------------------------------------------------------------------------
// 2. Evidence qualification
// ---------------------------------------------------------------------------

export function validScoreDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

// An evidence cell is "checked" only when it is public documentation, carries a
// real ISO date, a yes/partial/no/paid-add-on status and a credential-free https source.
export function publicScoreEvidence(evidence) {
  if (!evidence || evidence.verification !== 'public-documentation' || !validScoreDate(evidence.checkedAt)) return false;
  if (!['yes', 'partial', 'no', 'paid-add-on'].includes(evidence.status)) return false;
  try {
    const source = new URL(evidence.source);
    return source.protocol === 'https:' && Boolean(source.hostname) && !source.username && !source.password;
  } catch {
    return false;
  }
}

export function scoreEvidence(evidence) {
  const original = evidence || { status: 'unknown', verification: 'not-verified', note: 'This check has not been verified.' };
  const checked = publicScoreEvidence(original);
  const addOn =
    original.paidAddOn === true ||
    original.paidAddon === true ||
    original.entitlement === 'paid-add-on' ||
    original.status === 'paid-add-on';
  const status = !checked ? 'unknown' : original.status === 'no' ? 'no' : original.status === 'partial' || addOn ? 'partial' : original.status;
  const value = status === 'yes' ? 1 : status === 'partial' ? 0.5 : 0;
  return {
    checked,
    status,
    value,
    evidence: status === original.status ? original : { ...original, reportedStatus: original.status, status },
  };
}

// Explicit paid add-on entitlements: a product-level "yes" that exactly matches one
// of these records (vendor, category, feature, note, source, date) is scored as
// "partial" (half points). Copied verbatim from app.js `recordedScoreAddOns`.
export const RECORDED_SCORE_ADD_ONS = Object.freeze([
  { vendor: 'mailchimp', category: 'sms-marketing', features: ['us-sms', 'us-senders'], note: 'US SMS add-on needs application and sender approval.', source: 'https://mailchimp.com/solutions/sms-marketing-tools/', date: '2026-10-15' },
  { vendor: 'activecampaign', category: 'sms-marketing', features: ['us-sms', 'us-senders'], note: 'US SMS add-on requires 10DLC registration.', source: 'https://help.activecampaign.com/hc/en-us/articles/115000103510-Send-SMS-messages-with-automation', date: '2026-10-15' },
  { vendor: 'omnisend', category: 'sms-marketing', features: ['us-sms'], note: 'US SMS is available through the Pro add-on.', source: 'https://support.omnisend.com/en/articles/3533018-omnisend-pricing-plans-2026', date: '2026-10-15' },
  { vendor: 'nextiva', category: 'cloud-pbx', features: ['pbx-crm'], note: 'Salesforce/HubSpot connections require an add-on.', source: 'https://www.nextiva.com/nextiva-pricing', date: '2026-10-15' },
  { vendor: 'stripe', category: 'payments', features: ['payment-invoices'], note: 'Stripe Invoicing is separately priced from basic card processing.', source: 'https://stripe.com/pricing', date: '2026-10-15' },
  { vendor: 'stripe', category: 'payments', features: ['recurring-charges'], note: 'Subscription management uses the separately priced Billing product.', source: 'https://stripe.com/pricing', date: '2026-10-15' },
  { vendor: 'bill', category: 'spend-management', features: ['bill-intake'], note: 'Supplier invoice intake belongs to the separately priced AP product.', source: 'https://www.bill.com/product/pricing', date: '2026-10-15' },
  { vendor: 'justworks', category: 'payroll', features: ['hours_to_payroll'], note: 'Payroll time synchronization uses the time-tracking add-on.', source: 'https://www.justworks.com/platform/features/time-tracking', date: '2026-10-15' },
  { vendor: 'justworks', category: 'time-attendance', features: ['time_recording'], note: 'Time capture is supplied through a paid time-tracking add-on.', source: 'https://www.justworks.com/platform/features/time-tracking', date: '2026-10-15' },
  { vendor: 'onpay', category: 'hr', features: ['new_hire_onboarding'], note: 'Custom onboarding workflows require the HR add-on.', source: 'https://onpay.com/payroll/software/costs-pricing/', date: '2026-10-15' },
  { vendor: 'onpay', category: 'hr', features: ['onboarding_tasks'], note: 'Custom HR task workflows are part of the HR add-on.', source: 'https://onpay.com/payroll/software/costs-pricing/', date: '2026-10-15' },
  { vendor: 'intercom', category: 'customer-service', features: ['custom_service_analytics'], note: 'Operational AI analysis is offered as an add-on.', source: 'https://www.intercom.com/pricing', date: '2026-10-15' },
  { vendor: 'ahrefs', category: 'seo-tools', features: ['scheduled-reports'], note: 'Scheduled reports are available through the reporting add-on.', source: 'https://ahrefs.com/pricing', date: '2026-10-20' },
  { vendor: 'ahrefs', category: 'seo-tools', features: ['ai-content-assist'], note: 'Content Kit is a separately priced AI writing/review option.', source: 'https://ahrefs.com/pricing', date: '2026-10-20' },
  { vendor: 'vista-social', category: 'social-media-management', features: ['social-listening'], note: 'Broader social/web listening is a paid add-on.', source: 'https://vistasocial.com/pricing/', date: '2026-10-20' },
  { vendor: 'woodpecker', category: 'cold-email', features: ['cold-api-export'], note: 'CSV results; paid API/webhooks add-on.', source: 'https://woodpecker.co/pricing/', date: '2026-10-20' },
]);

export function scoredFeatureEvidence(category, vendor, feature, evidence) {
  if (!vendor.selectedPlan && evidence?.status === 'yes' && publicScoreEvidence(evidence)) {
    const recorded = RECORDED_SCORE_ADD_ONS.find(
      (row) =>
        row.vendor === vendor.id &&
        row.category === category.id &&
        row.features.includes(feature.id) &&
        row.note === evidence.note &&
        row.source === evidence.source &&
        row.date === evidence.checkedAt,
    );
    if (recorded) return scoreEvidence({ ...evidence, paidAddOn: true });
  }
  return scoreEvidence(evidence);
}

// ---------------------------------------------------------------------------
// 3. Category preparation (score groups + active checklist)
// ---------------------------------------------------------------------------

export const isFactual = (category) => category?.mode === 'factual';

export function scoreFeatureGroup(category, feature) {
  const group = category.scoring?.featureGroups?.[feature.id] || feature.scoringGroup;
  return SCORE_GROUPS.some((item) => item.id === group) ? group : null;
}

export function categoryVendors(catalog, category) {
  if (isFactual(category)) return category.factual?.suppliers || [];
  return catalog.vendors.filter((v) => v.categories?.includes(category.id));
}

// Recomputes category.scoring.activeFeatureIds the way prepareScoreCatalog does:
// every non-"advanced" feature is active; an "advanced" (deep) feature is active
// only when EVERY vendor of the category has a checked public-documentation cell
// for it. The catalog already ships the result; computeActiveFeatureIds lets the
// rebuild recompute it after an edit (verify-scoring.mjs asserts both agree).
export function computeActiveFeatureIds(catalog, category) {
  if (isFactual(category)) return [];
  const atomic = Array.isArray(category.features) && category.features.length > 0;
  const features = atomic ? category.features : category.criteria || [];
  const vendors = catalog.vendors.filter((v) => v.categories?.includes(category.id));
  return features
    .filter(
      (feature) =>
        feature.tier !== 'advanced' ||
        (vendors.length > 0 &&
          vendors.every((vendor) => {
            const evidence = (atomic ? vendor.featureAssessments : vendor.assessments)?.[category.id]?.[feature.id];
            return publicScoreEvidence(evidence);
          })),
    )
    .map((feature) => feature.id);
}

// ---------------------------------------------------------------------------
// 4. Per-feature breakdown and the score
// ---------------------------------------------------------------------------

// One row per checklist feature (active or not), in catalog order.
export function featureBreakdown(category, vendor) {
  if (isFactual(category)) return [];
  const atomic = Array.isArray(category.features) && category.features.length > 0;
  const activeIds = category.scoring ? new Set(category.scoring.activeFeatureIds || []) : null;
  const wrongPlan = vendor.selectedPlan && vendor.selectedPlan.categoryId !== category.id;
  const rows = (atomic ? category.features : category.criteria || []).map((feature) => {
    const scoringGroup = scoreFeatureGroup(category, feature);
    const active = Boolean(scoringGroup) && (activeIds ? activeIds.has(feature.id) : feature.tier !== 'advanced');
    const original = wrongPlan ? undefined : (atomic ? vendor.featureAssessments : vendor.assessments)?.[category.id]?.[feature.id];
    const qualified = scoredFeatureEvidence(category, vendor, feature, original);
    return {
      ...feature,
      scoringGroup,
      active,
      evidence: qualified.evidence,
      effectiveStatus: qualified.status,
      checked: qualified.checked,
      value: qualified.value,
    };
  });
  const counts = Object.fromEntries(
    SCORE_GROUPS.map((group) => [group.id, rows.filter((row) => row.active && row.scoringGroup === group.id).length]),
  );
  const activeWeight = SCORE_GROUPS.reduce((total, group) => total + (counts[group.id] ? group.weight : 0), 0);
  return rows.map((row) => {
    const groupWeight = SCORE_GROUPS.find((group) => group.id === row.scoringGroup)?.weight || 0;
    // points available for this check = normalised group weight / active checks in the group
    const weight = row.active && activeWeight ? ((groupWeight / activeWeight) * 100) / counts[row.scoringGroup] : 0;
    const earned = weight * row.value;
    return { ...row, weight, earned };
  });
}

// Exact rational arithmetic (BigInt) so a true x.5 never becomes x.4999.
function scoreWeightedFraction(rows, checkedOnly = false) {
  let numerator = 0n,
    denominator = 1n,
    activeBase = 0;
  const scale = checkedOnly ? 1 : 2;
  for (const group of SCORE_GROUPS) {
    const items = rows.filter((row) => row.scoringGroup === group.id);
    if (!items.length) continue;
    const units = items.reduce((sum, row) => sum + (checkedOnly ? (row.checked ? 1 : 0) : row.value * 2), 0);
    const itemDenominator = BigInt(items.length * scale);
    numerator = numerator * itemDenominator + BigInt(group.weight * units) * denominator;
    denominator *= itemDenominator;
    activeBase += group.weight;
  }
  return activeBase ? { numerator: numerator * 100n, denominator: denominator * BigInt(activeBase) } : null;
}

// round half up on an exact fraction
function roundedScoreFraction(fraction) {
  return Number((2n * fraction.numerator + fraction.denominator) / (2n * fraction.denominator));
}

function scoreFactualPending(category, supplier) {
  const criteria = category.factual?.criteria || [];
  const ids = new Set(criteria.map((row) => row.id));
  const sources = new Map((category.factual?.sources || []).map((source) => [source.evidence_id, source]));
  const checked = (supplier.productDecisions || []).filter(
    (row) =>
      ids.has(row.criterion_id) &&
      ['yes', 'partial', 'no'].includes(row.status) &&
      validScoreDate(row.verified_at) &&
      row.evidence_ids?.length &&
      row.evidence_ids.every((id) => sources.has(id)),
  );
  return {
    score: null,
    unroundedScore: null,
    isPending: true,
    pendingReason: 'factual-not-classified',
    coverage: null,
    checkedCount: checked.length,
    totalCount: criteria.length,
    documentedCount: checked.reduce((sum, row) => sum + (row.status === 'yes' ? 1 : row.status === 'partial' ? 0.5 : 0), 0),
    documentedItems: checked.filter((row) => row.status === 'yes' || row.status === 'partial').length,
    fullyDocumentedCount: checked.filter((row) => row.status === 'yes').length,
    countedCoverage: null,
    checkedAt: checked.map((row) => row.verified_at).sort()[0] || null,
    groupScores: [],
    rows: [],
  };
}

// fit(category, vendor) -> the complete score record for one (category, vendor) pair.
export function fit(category, vendor) {
  if (isFactual(category)) return scoreFactualPending(category, vendor);
  const all = featureBreakdown(category, vendor);
  const rows = all.filter((row) => row.active);
  const supportFraction = scoreWeightedFraction(rows),
    checkedFraction = scoreWeightedFraction(rows, true);
  const coverage = checkedFraction ? Number(checkedFraction.numerator) / Number(checkedFraction.denominator) : 0;
  const unroundedScore = supportFraction ? Number(supportFraction.numerator) / Number(supportFraction.denominator) : null;
  const passesGate = checkedFraction !== null && checkedFraction.numerator >= 80n * checkedFraction.denominator;
  const score = passesGate ? roundedScoreFraction(supportFraction) : null;
  const documentedCount = rows.reduce((sum, row) => sum + row.value, 0);
  const groupScores = SCORE_GROUPS.map((group) => {
    const items = rows.filter((row) => row.scoringGroup === group.id);
    const weight = items.reduce((sum, row) => sum + row.weight, 0);
    const earned = items.reduce((sum, row) => sum + row.earned, 0);
    const checked = items.filter((row) => row.checked);
    const groupFraction = items.length
      ? { numerator: BigInt(items.reduce((sum, row) => sum + row.value * 2, 0)) * 100n, denominator: BigInt(items.length * 2) }
      : null;
    return {
      id: group.id,
      label: group.label,
      baseWeight: group.weight,
      weight, // points available (normalised group weight; 0 when the group has no active check)
      earned, // points earned
      score: groupFraction ? roundedScoreFraction(groupFraction) : null,
      coverage: items.length ? (checked.length / items.length) * 100 : 0,
      checkedCount: checked.length,
      totalCount: items.length,
    };
  });
  return {
    score, // integer 0..100 or null when pending
    unroundedScore,
    isPending: !passesGate,
    pendingReason: passesGate ? null : 'checked-weight-below-80',
    coverage, // % of active checklist weight that is checked (unrounded; label floors it)
    checkedCount: rows.filter((row) => row.checked).length,
    totalCount: rows.length,
    documentedCount, // yes = 1, partial = 0.5 (tie-break input, NOT the displayed count)
    documentedItems: rows.filter((row) => row.value > 0).length, // displayed "N of M capabilities documented": supported + limited
    fullyDocumentedCount: rows.filter((row) => row.value === 1).length,
    countedCoverage: rows.length ? (documentedCount / rows.length) * 100 : 0,
    checkedAt:
      rows
        .filter((row) => row.checked)
        .map((row) => row.evidence.checkedAt)
        .sort()[0] || null, // EARLIEST checkedAt among checked active rows
    groupScores,
    rows: all, // every checklist feature incl. inactive ones
  };
}

// ---------------------------------------------------------------------------
// 5. Label formatting (verbatim strings used by the rendered pages)
// ---------------------------------------------------------------------------

// "8", "56.3", "18.8", "0" — one decimal, trailing zero dropped.
export const pointText = (value) => Number(Number(value || 0).toFixed(1)).toString();
export const contributionText = (row) => `${pointText(row.earned)} / ${pointText(row.weight)} pts`;
export const maximumText = (row) => `${pointText(row.weight)} points maximum`;
export const groupPointsText = (group) => `${pointText(group.earned)} of ${pointText(group.weight)} points`;
export const groupChecksText = (group) => `${group.checkedCount} of ${group.totalCount} active checks checked`;

// "Oct 15, 2026"
export const dateLabel = (value) =>
  new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function scoreValueText(result) {
  return result.score === null ? LABELS.scorePending : `${result.score}/100`;
}

export function scoreCoverageText(result) {
  if (result.coverage === null) return `${result.checkedCount} of ${result.totalCount} checked · checklist weight pending`;
  // floor, so an unqualified score can never claim 80% checked
  const coverage = Math.floor(Math.max(0, Math.min(100, result.coverage)));
  return `${result.checkedCount} of ${result.totalCount} checked (${coverage}% of checklist weight)`;
}

// "9 of 10 capabilities documented": active checks that are Supported OR Limited
// (a limited / paid add-on check counts as one documented item here, although it
// earns only half its points).
export function scoreCountText(result) {
  return `${result.documentedItems} of ${result.totalCount} capabilities documented`;
}

export function scoreDateText(result) {
  return result.checkedAt ? `Checked ${result.checkedAt}` : '';
}

// the single-line variant used in <option> labels by app.js
export function scoreLineText(result) {
  const label = result.score === null ? LABELS.scorePending : `${result.score}/100 · ${LABELS.scoreLabel}`;
  return `${label} · ${scoreCoverageText(result)}${result.checkedAt ? ' · Checked ' + result.checkedAt : ''}`;
}

// The complete "documented-score" block as an ordered list of {cls,text}.
export function scoreBlock(result) {
  const parts = [];
  if (result.score === null) parts.push({ cls: 'score-pending', text: LABELS.scorePending });
  else {
    parts.push({ cls: 'score-value', text: `${result.score}/100` });
    parts.push({ cls: 'score-label', text: LABELS.scoreLabel });
  }
  parts.push({ cls: 'score-coverage', text: scoreCoverageText(result) });
  parts.push({ cls: 'score-count', text: scoreCountText(result) });
  if (result.checkedAt) parts.push({ cls: 'score-date', text: scoreDateText(result) });
  if (result.score === null) parts.push({ cls: 'score-gate', text: LABELS.scoreGate });
  return { state: result.score === null ? 'pending' : 'scored', parts };
}

// ---------------------------------------------------------------------------
// 6. Ranking, "Recommended", counts
// ---------------------------------------------------------------------------

const nameCompare = (a, b) =>
  a.name.localeCompare(b.name, 'en-US') || String(a.id || '').localeCompare(String(b.id || ''), 'en-US');

// Scored vendors first: score desc, then unrounded score desc, then documented
// share desc, then number of fully documented checks desc, then name (en-US
// collation), then id. Pending vendors follow, ordered by name then id only.
export function rankVendors(category, vendors) {
  const results = new Map(vendors.map((vendor) => [vendor, fit(category, vendor)]));
  return [...vendors].sort((a, b) => {
    const left = results.get(a),
      right = results.get(b);
    if (left.score === null && right.score === null) return nameCompare(a, b);
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return (
      right.score - left.score ||
      right.unroundedScore - left.unroundedScore ||
      right.countedCoverage - left.countedCoverage ||
      right.fullyDocumentedCount - left.fullyDocumentedCount ||
      nameCompare(a, b)
    );
  });
}

// Every vendor that shares the highest ROUNDED score (ties are all recommended).
// Empty when nothing in the set is scored.
export function recommendedVendors(category, vendors) {
  const ranked = rankVendors(category, vendors);
  const top = ranked[0] && fit(category, ranked[0]).score;
  return top === null || top === undefined ? [] : ranked.filter((vendor) => fit(category, vendor).score === top);
}

// "A + B + C"
export const recommendedText = (vendors) => vendors.map((v) => v.name).join(' + ');

export function categorySummary(catalog, category) {
  const vendors = categoryVendors(catalog, category);
  if (isFactual(category)) {
    return {
      categoryId: category.id,
      factual: true,
      total: vendors.length,
      pending: vendors.length,
      scored: 0,
      ranked: vendors, // listed in catalog order ("by buying approach, not score")
      recommended: [],
      results: new Map(vendors.map((v) => [v.id, fit(category, v)])),
      metaText: null,
    };
  }
  const ranked = rankVendors(category, vendors);
  const results = new Map(ranked.map((v) => [v.id, fit(category, v)]));
  const pending = ranked.filter((v) => results.get(v.id).score === null).length;
  const recommended = recommendedVendors(category, vendors);
  return {
    categoryId: category.id,
    factual: false,
    total: ranked.length,
    pending,
    scored: ranked.length - pending,
    ranked,
    recommended,
    results,
    // category page <p class="journey-meta">: "14 products compared · 7 score pending · How we score"
    metaText: `${ranked.length} products compared · ${pending} score pending`,
    // method sentence "as of <date>": the catalog-wide checkedAt (same date on every page)
    asOf: catalog.checkedAt || null,
    // category page "journey-leaders": the first three SCORED vendors of the ranking (fewer if fewer are scored)
    leaders: ranked.filter((v) => results.get(v.id).score !== null).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// 7. Comparisons (/vs/<id>/ and /compare/)
// ---------------------------------------------------------------------------
//
// catalog.comparisons[] = {id, categoryId, vendorIds:[a,b], mode?, status?, ...}
//   - no mode/status, scored category  -> scored comparison page (87 pages)
//   - mode 'factual' (factual category) -> no scores: "Score pending. No /100 score has been assigned. ..." (27)
//   - status 'published' (editorial)    -> editorial article, no score blocks (3)
// The live /vs/ pages show NO "Recommended" tag and no per-row winner. They show both
// score blocks side by side (vendors stay in comparison.vendorIds order, they are
// NOT re-sorted by score), a per-row "different" flag and a "Fully documented here,
// not fully documented for every other selection: ..." line (see section 11).
// `recommended` is still returned for a rebuild that wants to surface it; among the
// selected vendors it follows the same rule as a category (all tied top scores).

export function comparisonKind(catalog, comparison) {
  const category = catalog.categories.find((c) => c.id === comparison.categoryId);
  if (isFactual(category) || comparison.mode === 'factual') return 'factual';
  if (comparison.status || comparison.mode) return 'editorial';
  return 'scored';
}

export function comparisonSummary(catalog, comparison) {
  const category = catalog.categories.find((c) => c.id === comparison.categoryId);
  const kind = comparisonKind(catalog, comparison);
  if (kind !== 'scored') return { comparison, category, kind, vendors: [], results: new Map(), recommended: [], recommendedText: '', rows: [] };
  const vendors = (comparison.vendorIds || []).map((id) => catalog.vendors.find((v) => v.id === id)).filter(Boolean);
  const results = new Map(vendors.map((v) => [v.id, fit(category, v)]));
  const recommended = recommendedVendors(category, vendors);
  return {
    comparison,
    category,
    kind,
    title: vendors.map((v) => v.name).join(' vs '),
    vendors, // display order = comparison.vendorIds
    results,
    recommended, // not displayed by the live site
    recommendedText: recommendedText(recommended),
    rows: comparisonRows(category, vendors), // [{feature, cells[], different}]
    distinctive: new Map(vendors.map((v) => [v.id, distinctiveFeatures(category, vendors, v)])),
  };
}

// ---------------------------------------------------------------------------
// 8. Whole-catalog convenience
// ---------------------------------------------------------------------------

// One flat record per (category, vendor) pair of the 33 scored categories, plus the
// per-category summaries. `status` is 'scored' or 'pending'.
export function scoreCatalog(catalog) {
  const categories = catalog.categories.map((category) => categorySummary(catalog, category));
  const pairs = [];
  for (const summary of categories) {
    summary.ranked.forEach((vendor, index) => {
      const result = summary.results.get(vendor.id);
      pairs.push({
        categoryId: summary.categoryId,
        vendorId: vendor.id,
        rank: index, // 0-based position in the published order (data-rank)
        recommended: summary.recommended.includes(vendor),
        status: result.score === null ? 'pending' : 'scored',
        label: scoreLineText(result),
        ...result,
      });
    });
  }
  return { categories, pairs };
}

// ---------------------------------------------------------------------------
// 9. Price display strings
// ---------------------------------------------------------------------------
//
// The price renderer is server-side only (not in app.js). The rules below were
// inferred from the rendered HTML and are verified for every vendor on every
// page type by verify-scoring.mjs.

export const PRICE_LABELS = Object.freeze({
  // "card" family: .card-price, .product-price, .decision-pricing
  cardNoAmount: 'See pricing',
  cardQuote: 'Custom quote',
  cardUsage: 'Usage based',
  cardSmsUnverified: 'SMS pricing not verified',
  cardDatePrefix: 'Price sources checked ',
  // "journey" family: .journey-price (category pages, /vs/, /compare/)
  journeyNoAmount: 'Public starting price not verified',
  journeyQuote: 'Quote only',
  journeyTax: 'Tax treatment not documented',
  journeyDatePrefix: 'Price checked ',
  journeyNoDate: 'Price-check date not recorded',
  journeySourceLink: 'Official pricing source',
  annualSuffix: ' · billed annually',
});

// In the SMS-marketing category a vendor whose PRIMARY category (categories[0]) is
// not sms-marketing gets this synthetic pricing record instead of its product
// pricing (its public price belongs to another product line).
export const SMS_UNVERIFIED_PRICING = Object.freeze({
  model: 'unverified',
  amount: null,
  currency: 'USD',
  unit: 'US SMS cost needs verification',
  plan: 'SMS-specific plan not verified',
  billing: 'unverified',
  source: null,
  verifiedAt: null,
  smsUnverified: true,
});

export function pricingFor(vendor, categoryId) {
  if (categoryId === 'sms-marketing' && vendor.categories?.[0] !== 'sms-marketing') return SMS_UNVERIFIED_PRICING;
  return vendor.pricing || {};
}

// "$35.00", "$30,000.00", "€119.00", "$0.00". Two decimals everywhere; in the
// sms-marketing context sub-cent rates keep up to four ("$0.0083" vs "$0.01").
export function formatMoney(amount, currency, categoryId) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: categoryId === 'sms-marketing' ? 4 : 2,
  }).format(amount);
}

// The category that gives a price its context when the page is not category
// specific (product profile, pricing box): the vendor's primary category.
export const primaryCategoryId = (vendor) => vendor.categories?.[0] || null;

// The vendor's categories in CATALOG order (the order used for the capability
// sections of a product page and for the /alternatives/ category selector, whose
// default is the first entry). Note this can differ from vendor.categories[0].
export function vendorCategoriesInCatalogOrder(catalog, vendor) {
  return catalog.categories.filter((c) => vendor.categories?.includes(c.id));
}

// Date attached to a product price. Price blocks show pricing.verifiedAt only
// ("Price sources checked <date>" / "Price checked <date>"); when it is missing the
// card family prints nothing and the journey family prints "Price-check date not
// recorded". The /tools/cost/ data set alone falls back to vendor.checkedAt.
export const priceCheckedDate = (vendor, categoryId = primaryCategoryId(vendor)) => {
  const p = pricingFor(vendor, categoryId);
  return typeof p.verifiedAt === 'string' ? p.verifiedAt.slice(0, 10) : null;
};

// formatPrice(vendor, {categoryId, variant}) -> every string a price block shows.
//   variant 'card'    : .card-price / .product-price / .decision-pricing
//   variant 'journey' : .journey-price
export function formatPrice(vendor, { categoryId = primaryCategoryId(vendor), variant = 'card' } = {}) {
  const p = pricingFor(vendor, categoryId);
  const hasAmount = p.amount !== null && p.amount !== undefined;
  const money = hasAmount ? formatMoney(p.amount, p.currency, categoryId) : null;
  // " · billed annually" is appended only next to a verified amount
  const unitLine = `${p.unit || ''}${hasAmount && p.billing === 'annual' ? PRICE_LABELS.annualSuffix : ''}`;
  const date = typeof p.verifiedAt === 'string' ? p.verifiedAt.slice(0, 10) : null;
  if (variant === 'journey') {
    return {
      variant,
      headline: hasAmount ? money : p.model === 'quote' ? PRICE_LABELS.journeyQuote : PRICE_LABELS.journeyNoAmount,
      unitLine: hasAmount ? unitLine : null, // the unit is shown only next to a verified amount
      plan: p.plan || null,
      taxLine: PRICE_LABELS.journeyTax,
      date,
      dateLine: date ? PRICE_LABELS.journeyDatePrefix + date : PRICE_LABELS.journeyNoDate,
      sourceUrl: p.source || null, // no link for the SMS-unverified record
      sourceLabel: p.source ? PRICE_LABELS.journeySourceLink : null,
      summary: p.summary || null,
    };
  }
  return {
    variant,
    headline: hasAmount
      ? money
      : p.smsUnverified
        ? PRICE_LABELS.cardSmsUnverified
        : p.model === 'quote'
          ? PRICE_LABELS.cardQuote
          : p.model === 'usage'
            ? PRICE_LABELS.cardUsage
            : PRICE_LABELS.cardNoAmount,
    unitLine,
    plan: p.plan || null,
    date,
    dateLine: date ? PRICE_LABELS.cardDatePrefix + date : null,
    sourceUrl: p.source || null,
    summary: p.summary || null,
  };
}

// ---------------------------------------------------------------------------
// 10. Home page "Category leaders" block
// ---------------------------------------------------------------------------
//
// Walk the scored (non-factual) categories in catalog order. A category gets a
// card when (a) its two top-ranked vendors both have a score and (b) none of its
// recommended vendors was already recommended on an earlier card ("distinct
// genuine category leaders"). Stop after `limit` cards. The pair shown is
// ranked[0] vs ranked[1]; "Recommended: " lists every tied first place.
export function homeCategoryLeaders(catalog, limit = 10) {
  const used = new Set();
  const cards = [];
  for (const category of catalog.categories) {
    if (cards.length >= limit) break;
    if (isFactual(category)) continue;
    const summary = categorySummary(catalog, category);
    const [first, second] = summary.ranked;
    if (!first || !second) continue;
    if (summary.results.get(first.id).score === null || summary.results.get(second.id).score === null) continue;
    if (summary.recommended.some((v) => used.has(v.id))) continue;
    summary.recommended.forEach((v) => used.add(v.id));
    cards.push({
      categoryId: category.id,
      categoryName: category.name,
      pair: [first, second],
      title: `${first.name} vs ${second.name}`,
      recommended: summary.recommended,
      recommendedText: `Recommended: ${recommendedText(summary.recommended)}`,
      results: [summary.results.get(first.id), summary.results.get(second.id)],
      total: summary.total,
      linkText: `Explore all ${summary.total} systems →`,
    });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// 11. Comparison-table helpers (/vs/, /compare/)
// ---------------------------------------------------------------------------

// A checklist row is "different" when the selected vendors do not all share the
// same effective status (drives data-journey-different / "Only capability differences").
export function comparisonRows(category, vendors) {
  const breakdowns = vendors.map((v) => featureBreakdown(category, v));
  return breakdowns[0].map((row, i) => {
    const cells = breakdowns.map((b) => b[i]);
    return { feature: row, cells, different: new Set(cells.map((c) => c.effectiveStatus)).size > 1 };
  });
}

// "Fully documented here, not fully documented for every other selection: A; B; C."
// = the first three checklist rows (catalog order) where this vendor is "yes"
// and at least one other selected vendor is not.
export function distinctiveFeatures(category, vendors, vendor, limit = 3) {
  const rows = comparisonRows(category, vendors);
  const index = vendors.indexOf(vendor);
  return rows
    .filter((r) => r.cells[index].effectiveStatus === 'yes' && r.cells.some((c, i) => i !== index && c.effectiveStatus !== 'yes'))
    .slice(0, limit)
    .map((r) => r.feature);
}

// Must-have filter data on category pages: ids of every feature with effective
// status "yes" (catalog order, active or not) -> data-supported.
export function supportedFeatureIds(category, vendor) {
  return featureBreakdown(category, vendor)
    .filter((row) => row.effectiveStatus === 'yes')
    .map((row) => row.id);
}

// Link under a check: "Source ↗" — or "Related documentation ↗" when the cell is
// only vendor-confirmed (a supplier statement is not a scoring source).
export const evidenceLinkLabel = (evidence) => (evidence?.verification === 'vendor-confirmed' ? 'Related documentation' : 'Source');

// Product page "Understand the full price" line.
export function pricingBasisText(vendor) {
  const p = vendor.pricing || {};
  return `Billing basis: ${p.billing}. Unit: ${p.unit}. Currency: ${p.currency || 'Not verified'}.`;
}

// Evidence line under a check: "Official documentation · Oct 15, 2026"
export function evidenceKindText(evidence) {
  const label = LABELS.verification[evidence?.verification] || LABELS.verification['not-verified'];
  return evidence?.checkedAt && validScoreDate(evidence.checkedAt) ? `${label} · ${dateLabel(evidence.checkedAt)}` : label;
}

// ---------------------------------------------------------------------------
// 12. Researched plans (plan-level scores)
// ---------------------------------------------------------------------------
//
// vendor.researchedPlans[categoryId] = [{id,name,source,checkedAt,pricing,limits,ai,features}]
// A plan score uses ONLY the plan's own evidence: a checklist feature missing from
// plan.features becomes an unverified placeholder; product-level evidence is never
// inherited and the recorded add-on downgrade (RECORDED_SCORE_ADD_ONS) is not applied.
// The category's active checklist (activeFeatureIds) and group weights are unchanged.

export function researchedPlans(vendor, categoryId) {
  return Array.isArray(vendor?.researchedPlans?.[categoryId]) ? vendor.researchedPlans[categoryId] : [];
}

export function planSelection(vendor, category, planId = '') {
  const plan = researchedPlans(vendor, category.id).find((p) => p.id === planId);
  if (!plan) return { vendor, planId: '', reset: Boolean(planId) };
  const features = Object.fromEntries(
    category.features.map((f) => [
      f.id,
      plan.features[f.id] || {
        status: 'unknown',
        note: 'Inclusion and limits for this check have not been verified for ' + plan.name + '. Product-level evidence is not inherited.',
        source: plan.source,
        verification: 'not-verified',
        checkedAt: plan.checkedAt,
      },
    ]),
  );
  return {
    planId: plan.id,
    reset: false,
    vendor: {
      ...vendor,
      selectedPlan: { id: plan.id, name: plan.name, categoryId: category.id, source: plan.source, checkedAt: plan.checkedAt, limits: plan.limits },
      featureAssessments: { [category.id]: features },
      assessments: {},
      pricing: { model: 'subscription', extras: plan.limits, ...plan.pricing, plan: plan.name },
      ai: { level: 'not-verified', capabilities: [], ...plan.ai },
      checkedAt: plan.checkedAt,
    },
  };
}

// Score record for one researched plan (same shape as fit()).
export function planFit(category, vendor, planId) {
  const selection = planSelection(vendor, category, planId);
  return selection.planId ? fit(category, selection.vendor) : null;
}

// "Source" + one "Supporting source" per additional distinct URL in cell.sources
export function evidenceLinks(evidence) {
  const links = [];
  if (evidence?.source) links.push({ label: evidenceLinkLabel(evidence), url: evidence.source });
  for (const url of evidence?.sources || []) if (url !== evidence.source && !links.some((l) => l.url === url)) links.push({ label: 'Supporting source', url });
  return links;
}

// ---------------------------------------------------------------------------
// 13. Factual categories: observed-offer price line
// ---------------------------------------------------------------------------
//
// category.factual.suppliers[].plans[].pricing =
//   {amount, currency, display_currency, status, billing, unit, tax_basis, note, observed_at, evidence_ids, upcoming?}
// Rendered in table.factual-plan-table as one " · "-joined sentence. No score is
// ever shown for these offers ("Score pending. No /100 score has been assigned.").

export const FACTUAL_TAX_LABELS = Object.freeze({
  not_verified: 'Tax basis not verified',
  applicable_tax_extra: 'Applicable taxes extra',
  applicable_sales_tax_extra: 'Applicable sales tax extra',
  VAT_excluded_US_sales_tax_unverified: 'VAT excluded; US sales tax not verified',
});

export function formatFactualOfferPrice(pricing) {
  const p = pricing || {};
  const parts = [];
  if (p.amount !== null && p.amount !== undefined) {
    // plain number, no thousands separator, no forced decimals: "USD 99", "USD 23.5", "$1250 (currency not verified)"
    parts.push(p.currency ? `${p.currency} ${p.amount}` : `${String(p.display_currency || '').trim()}${p.amount} (currency not verified)`);
  } else parts.push(String(p.status || '').startsWith('quote') ? 'Request a quote' : 'Price not verified');
  if (p.unit) parts.push(p.unit);
  if (p.billing) parts.push(`${p.billing} billing`);
  parts.push(FACTUAL_TAX_LABELS[p.tax_basis] || FACTUAL_TAX_LABELS.not_verified);
  if (p.note) parts.push(p.note);
  if (p.upcoming) parts.push(`Announced invoice change from ${p.upcoming.invoice_effective_date}: ${p.currency} ${p.upcoming.amount} per ${p.unit}`);
  return parts.join(' · ');
}

// "<source title> · <source title> · Observed 2026-11-04"
export function factualOfferSourceLine(category, pricing) {
  const titles = (pricing?.evidence_ids || []).map((id) => (category.factual?.sources || []).find((x) => x.evidence_id === id)?.title).filter(Boolean);
  return [...titles, `Observed ${pricing?.observed_at}`].join(' · ');
}
