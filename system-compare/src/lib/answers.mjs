// Answer-first passages and FAQ items generated ONLY from catalog data + the verified scoring module.
// Every sentence must be quotable on its own: it names the entity, the number, the unit and the date.
// Wording rules: "highest documented-fit score" (never "best"); never a number for a pending score;
// prices are "from $X <unit>" only when a numeric public price exists.

import { fmtDate, listText, plural, planLabel } from './format.mjs';

// Lower-cases the first letter so a data sentence can continue another sentence — but never touches
// acronyms (SEO, US, AI, B2C), mixed-case brands (NordVPN, HubSpot) or known proper nouns.
const PROPER_WORDS = new Set(
  'I English American European British Microsoft Google Apple Amazon Meta Slack Zapier Stripe Shopify Salesforce Excel Outlook Gmail Android Windows Mac Linux Zoom Teams Notion Jira Monday January February March April May June July August September October November December'.split(' '),
);
let properNames = new Set();
function lowerFirst(s) {
  if (!s) return s;
  // "Product-led" is judged by its first part; "Zoho-centered" stays because Zoho is a product name
  const first = String(s).split(/[\s,;:]/)[0].replace(/['’]s$/, '').split('-')[0];
  if (!/^[A-Z][a-z]+$/.test(first)) return s;
  if (first !== 'Teams' && (PROPER_WORDS.has(first) || properNames.has(first))) return s;
  return s[0].toLowerCase() + s.slice(1);
}
const stripDot = (s) => String(s || '').trim().replace(/[.\s]+$/, '');
const sentence = (s) => (s ? stripDot(s) + '.' : '');
const firstSentence = (s) => {
  const m = String(s || '').match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : String(s || '');
};

/** Noun phrase for questions: "CRM & sales software", "Payroll software", "Business phone systems". */
export function categoryNoun(category) {
  const n = category.name;
  return /(software|systems|platforms|tools|agents|assistants|hosting)$/i.test(n) ? n : `${n} software`;
}
/** Plural phrase used inside sentences: "CRM & sales tools", "HR tools", "Business phone systems". */
export function categoryThings(category) {
  const n = category.name;
  if (/software$/i.test(n)) return n.replace(/\s*software$/i, ' tools');
  if (/(systems|platforms|tools|agents|assistants)$/i.test(n)) return n;
  return `${n} tools`;
}

export function createAnswers(ctx) {
  // product and supplier names (and their first words) keep their capital when a sentence starts with them
  properNames = new Set();
  const addName = (name) => {
    const w = String(name || '').split(/[\s/()]+/)[0];
    if (/^[A-Z][a-z]+$/.test(w)) properNames.add(w);
  };
  ctx.vendors.forEach((v) => addName(v.name));
  ctx.factualCategories.forEach((c) => (c.factual?.suppliers || []).forEach((sup) => addName(sup.name)));
  const onPlan = (plan) => (plan ? ` on the ${planLabel(plan)}` : '');
  const priceFrom = (vendor, categoryId) => {
    const p = ctx.price(vendor, categoryId);
    return p.hasAmount ? `from ${p.headline}${p.unit ? ' ' + p.unit : ''}` : null;
  };
  const scoredName = (vendor, categoryId, { withPrice = true } = {}) => {
    const s = ctx.score(categoryId, vendor.id);
    const p = withPrice ? priceFrom(vendor, categoryId) : null;
    return `${vendor.name} (${s.value}/100${p ? `, ${p}` : ''})`;
  };
  const asOf = () => fmtDate(ctx.catalog.checkedAt);

  // ---------------------------------------------------------------- category (scored)
  function categoryQuickAnswer(category) {
    const s = ctx.summary(category.id);
    const things = categoryThings(category);
    const scored = s.ranked.filter((v) => !s.results.get(v.id).isPending);
    const pendingText = s.pending ? ` ${s.pending} ${s.pending === 1 ? 'is' : 'are'} still score-pending.` : '';
    const tail = ` Scores reflect official documentation checked as of ${asOf()}, not user reviews.`;
    if (!scored.length) {
      const closest = [...s.ranked].sort((a, b) => s.results.get(b.id).coverage - s.results.get(a.id).coverage).slice(0, 2);
      return `No ${category.name} product has a published documented-fit score yet: all ${s.total} are below the 80% checked-evidence gate. The furthest along are ${listText(
        closest.map((v) => `${v.name} (${Math.floor(s.results.get(v.id).coverage)}% checked)`),
      )}. Evidence checked ${asOf()}.`;
    }
    if (s.recommended.length > 3) {
      const top = s.results.get(s.recommended[0].id).score;
      return `${s.recommended.length} of the ${s.total} ${things} we researched tie for the highest documented-fit score (${top}/100): ${listText(s.recommended.map((v) => v.name))}.${pendingText}${tail}`;
    }
    const lead = scoredName(scored[0], category.id);
    const next = scored.slice(1, 3).map((v) => scoredName(v, category.id));
    return `Of the ${s.total} ${things} we researched, ${lead} has the highest documented-fit score${next.length ? `, followed by ${listText(next)}` : ''}.${pendingText}${tail}`;
  }

  function categoryPriceFacts(category) {
    const s = ctx.summary(category.id);
    const priced = s.ranked
      .map((v) => ({ v, p: ctx.price(v, category.id) }))
      .filter((x) => x.p.hasAmount && x.p.currency === 'USD' && !(x.p.amount === 0 && x.v.pricing?.model === 'mixed'));
    priced.sort((a, b) => a.p.amount - b.p.amount);
    return { priced, unpriced: s.total - priced.length, min: priced[0] || null, max: priced[priced.length - 1] || null, total: s.total };
  }

  function categoryFaq(category) {
    const s = ctx.summary(category.id);
    const things = categoryThings(category);
    const out = (category.faq || []).map((f) => ({ q: f.q, a: f.a }));
    const scored = s.ranked.filter((v) => !s.results.get(v.id).isPending);
    if (scored.length) {
      out.push({
        q: `Which ${things} have the highest documented-fit score?`,
        a: `${categoryQuickAnswer(category)} Ties are ordered by unrounded score, then evidence coverage, then name.`,
      });
    }
    const pf = categoryPriceFacts(category);
    if (pf.priced.length >= 2) {
      const drivers = (category.costDrivers || []).slice(0, 2).map(stripDot);
      out.push({
        q: `How much does ${categoryNoun(category)} cost?`,
        a: `Among the ${pf.priced.length} ${things} with a verified public starting price, list prices range from ${pf.min.p.headline} ${pf.min.p.unit} (${pf.min.v.name}) to ${pf.max.p.headline} ${pf.max.p.unit} (${pf.max.v.name}). ${
          pf.unpriced ? `${plural(pf.unpriced, 'product')} ${pf.unpriced === 1 ? 'is' : 'are'} quote-only, usage-based or without a verified public price. ` : ''
        }Units differ between vendors, so compare a full quote for the same team size.${drivers.length ? ` Main cost drivers: ${drivers.join('; ')}.` : ''}`,
      });
    }
    const strongAi = s.ranked.filter((v) => ['native', 'agent'].includes(v.ai?.level));
    const unverified = s.ranked.filter((v) => (v.ai?.level || 'not-verified') === 'not-verified');
    if (strongAi.length) {
      const other = s.total - strongAi.length - unverified.length;
      out.push({
        q: `Which ${things} have native AI or AI agents?`,
        a: `Official documentation describes native AI or AI agents for ${listText(strongAi.map((v) => v.name))}.${other > 0 ? ` ${plural(other, 'more product')} ${other === 1 ? 'offers' : 'offer'} an assistant, predictive features or AI through an integration.` : ''}${
          unverified.length ? ` AI is not verified for ${listText(unverified.map((v) => v.name))} — not verified does not mean absent.` : ''
        } Documented does not mean included in every plan.`,
      });
    }
    if (s.pending) {
      out.push({
        q: `Why do some ${things} show “Score pending”?`,
        a: `${s.pending} of the ${s.total} ${things} have less than 80% of the checklist weight checked against official sources, so no score is published for them yet. Pending is not a negative finding: it means our evidence is incomplete, and the product stays listed with its checked coverage.`,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- product
  function productQuickAnswer(vendor, category = ctx.primaryCategory(vendor)) {
    const s = ctx.score(category.id, vendor.id);
    const total = ctx.summary(category.id).total;
    const p = ctx.price(vendor, category.id);
    const things = categoryThings(category);
    const scoreText = s.pending
      ? `Its documented-fit score is pending: ${s.checked} of ${s.total} checklist items (${s.coveragePct}% of the weight) are checked, below the 80% gate.`
      : `It scores ${s.value}/100 for documented fit (${s.checked} of ${s.total} checklist items checked${s.checkedAt ? `, evidence from ${fmtDate(s.checkedAt)}` : ''}).`;
    const priceText = p.hasAmount
      ? `Published pricing starts at ${p.headline}${p.unit ? ' ' + p.unit : ''}${onPlan(p.plan)}${p.billingNote ? `, ${p.billingNote}` : ''}${p.checkedAt ? ` (price checked ${fmtDate(p.checkedAt)})` : ''}.`
      : `No verified public starting price is recorded (${p.headline.toLowerCase()}).`;
    return `${vendor.name} is one of ${total} ${things} we researched. ${scoreText} ${priceText} Best for: ${lowerFirst(sentence(vendor.bestFor))}`;
  }

  function productFaq(vendor) {
    const cats = ctx.vendorCategories(vendor);
    const primary = ctx.primaryCategory(vendor);
    const p = ctx.price(vendor);
    const out = [];
    out.push(
      p.hasAmount
        ? {
            q: `How much does ${vendor.name} cost?`,
            a: `${vendor.name}’s published pricing starts at ${p.headline}${p.unit ? ' ' + p.unit : ''}${onPlan(p.plan)}${p.billingNote ? `, ${p.billingNote}` : ''}. ${sentence(p.summary)}${p.checkedAt ? ` Price checked ${fmtDate(p.checkedAt)}.` : ''}`.trim(),
          }
        : {
            q: `How much does ${vendor.name} cost?`,
            a: `${vendor.name} has no verified public starting price for US buyers (${p.headline.toLowerCase()}). ${sentence(p.summary)}`.trim(),
          },
    );
    if (p.extras.length) {
      out.push({ q: `What does ${vendor.name} cost beyond the subscription?`, a: `Budget separately for: ${p.extras.map(stripDot).join('; ')}.` });
    }
    const scoreLines = cats.map((c) => {
      const s = ctx.score(c.id, vendor.id);
      return s.pending
        ? `in ${c.name} its score is pending (${s.checked} of ${s.total} checklist items checked, ${s.coveragePct}% of the weight)`
        : `in ${c.name} it scores ${s.value}/100 (${s.checked} of ${s.total} checklist items checked)`;
    });
    out.push({
      q: `What is ${vendor.name}’s documented-fit score?`,
      a: `For ${vendor.name}, ${listText(scoreLines)}. The score is the share of the category checklist documented in official sources. It is not a user rating or a hands-on test.`,
    });
    const ai = vendor.ai || {};
    out.push(
      ai.level && ai.level !== 'not-verified'
        ? {
            q: `Does ${vendor.name} include AI?`,
            a: `${sentence(ai.summary)}${ai.capabilities?.length ? ` Documented capabilities include ${listText(ai.capabilities.slice(0, 3).map((c) => lowerFirst(stripDot(c))))}.` : ''}${ai.limits?.length ? ` Check before buying: ${lowerFirst(sentence(ai.limits[0]))}` : ''}`,
          }
        : {
            q: `Does ${vendor.name} include AI?`,
            a: `We have not verified AI capabilities for ${vendor.name} in official documentation. Not verified does not mean the product has no AI; ask the vendor which plan includes any AI features.`,
          },
    );
    out.push({ q: `Who is ${vendor.name} best for?`, a: `${sentence(vendor.bestFor)} Look more closely when: ${lowerFirst(sentence(vendor.avoidIf))}` });
    const s = ctx.summary(primary.id);
    const alts = s.ranked.filter((v) => v.id !== vendor.id && !s.results.get(v.id).isPending).slice(0, 3);
    if (alts.length >= 2) {
      out.push({
        q: `What are the alternatives to ${vendor.name}?`,
        a: `In ${primary.name}, the researched alternatives with the highest documented-fit scores are ${listText(alts.map((v) => scoredName(v, primary.id)))}. ${s.total - 1} alternatives are listed in total.`,
      });
    }
    if (vendor.integrations?.length) {
      out.push({ q: `What does ${vendor.name} integrate with?`, a: `Documented integrations include ${listText(vendor.integrations.map(stripDot))}.` });
    }
    return out;
  }

  // ---------------------------------------------------------------- comparison (scored pair)
  function pairFacts(category, a, b) {
    const sa = ctx.score(category.id, a.id);
    const sb = ctx.score(category.id, b.id);
    const rows = sa.rows.map((row, i) => ({ feature: row, a: row, b: sb.rows[i] }));
    const active = rows.filter((r) => r.feature.active);
    const diff = active.filter((r) => r.a.effectiveStatus !== r.b.effectiveStatus);
    const onlyA = active.filter((r) => r.a.effectiveStatus === 'yes' && r.b.effectiveStatus !== 'yes');
    const onlyB = active.filter((r) => r.b.effectiveStatus === 'yes' && r.a.effectiveStatus !== 'yes');
    return { sa, sb, rows, active, diff, onlyA, onlyB, pa: ctx.price(a, category.id), pb: ctx.price(b, category.id) };
  }

  function pairQuickAnswer(category, a, b) {
    const f = pairFacts(category, a, b);
    const side = (v, s, p) =>
      `${v.name} ${s.pending ? `is score-pending (${s.checked} of ${s.total} items checked)` : `scores ${s.value}/100`}${p.hasAmount ? ` and starts at ${p.headline}${p.unit ? ' ' + p.unit : ''}` : ', with no verified public starting price'}`;
    const diffText = f.diff.length
      ? `They differ on ${f.diff.length} of ${f.active.length} scored checks (${f.diff.slice(0, 3).map((r) => r.feature.label).join('; ')}).`
      : `Their documented status is the same on all ${f.active.length} scored checks.`;
    const dates = [f.sa.checkedAt, f.sb.checkedAt].filter(Boolean).sort();
    return `On the same ${category.name} checklist, ${side(a, f.sa, f.pa)}; ${side(b, f.sb, f.pb)}. ${diffText} Scores reflect official documentation${dates.length ? ` as of ${fmtDate(dates[0])}` : ''}, not user reviews or hands-on tests.`;
  }

  /** Rule-based verdict line for a pair. Never invents a winner when the data does not support one. */
  function pairVerdict(category, a, b) {
    const f = pairFacts(category, a, b);
    if (f.sa.pending && f.sb.pending) return { kind: 'none', text: `No verdict yet: both scores are pending because less than 80% of the checklist weight is checked for each product.` };
    if (f.sa.pending || f.sb.pending) {
      const [done, open] = f.sa.pending ? [b, a] : [a, b];
      const s = f.sa.pending ? f.sb : f.sa;
      return { kind: 'partial', leader: done, text: `Only ${done.name} has a published score (${s.value}/100). ${open.name} is still score-pending, so the two cannot be ranked against each other yet.` };
    }
    if (f.sa.value === f.sb.value) {
      return { kind: 'tie', text: `${a.name} and ${b.name} have the same documented-fit score (${f.sa.value}/100). Choose on the differences below, on price and on fit for your team.` };
    }
    const [hi, lo, sh, sl] = f.sa.value > f.sb.value ? [a, b, f.sa, f.sb] : [b, a, f.sb, f.sa];
    return { kind: 'lead', leader: hi, text: `${hi.name} has the higher documented-fit score: ${sh.value}/100 against ${sl.value}/100 for ${lo.name}. A higher score means more of the checklist is documented, not that the product is better for every team.` };
  }

  function pairFaq(category, a, b) {
    const f = pairFacts(category, a, b);
    const v = pairVerdict(category, a, b);
    const out = [
      {
        q: `Is ${a.name} or ${b.name} better for ${category.name}?`,
        a: `Neither is universally better. ${v.text} ${a.name} suits: ${lowerFirst(sentence(a.bestFor))} ${b.name} suits: ${lowerFirst(sentence(b.bestFor))}`,
      },
    ];
    if (f.diff.length) {
      const L = { yes: 'supported', partial: 'limited', no: 'not supported', unknown: 'not verified' };
      out.push({
        q: `What is the difference between ${a.name} and ${b.name}?`,
        a: `On the ${category.name} checklist they differ on ${f.diff.length} of ${f.active.length} scored checks: ${f.diff
          .slice(0, 3)
          .map((r) => `${r.feature.label} (${a.name}: ${L[r.a.effectiveStatus]}; ${b.name}: ${L[r.b.effectiveStatus]})`)
          .join('; ')}.`,
      });
    }
    out.push({
      q: `Which is cheaper, ${a.name} or ${b.name}?`,
      a:
        f.pa.hasAmount && f.pb.hasAmount
          ? `${a.name} starts at ${f.pa.headline} ${f.pa.unit}; ${b.name} starts at ${f.pb.headline} ${f.pb.unit}. Units and plan limits differ, so compare a full quote for the same team size and term.`
          : `A like-for-like price cannot be stated: ${listText([!f.pa.hasAmount && a.name, !f.pb.hasAmount && b.name].filter(Boolean))} ${!f.pa.hasAmount && !f.pb.hasAmount ? 'have' : 'has'} no verified public starting price. Ask both vendors to quote the same scope.`,
    });
    const aiLine = (x) => `${x.name}: ${lowerFirst(ctx.aiLevel(x).label)}${x.ai?.summary ? ` — ${firstSentence(x.ai.summary)}` : '.'}`;
    out.push({ q: `Do ${a.name} and ${b.name} both include AI?`, a: `${aiLine(a)} ${aiLine(b)} Documented does not mean included in every plan.` });
    return out;
  }

  // ---------------------------------------------------------------- alternatives
  function alternativesFacts(vendor, category) {
    const s = ctx.summary(category.id);
    const others = s.ranked.filter((v) => v.id !== vendor.id);
    const scored = others.filter((v) => !s.results.get(v.id).isPending);
    const focalPrice = ctx.price(vendor, category.id);
    const cheaper =
      focalPrice.hasAmount && focalPrice.currency === 'USD'
        ? others.map((v) => ({ v, p: ctx.price(v, category.id) })).filter((x) => x.p.hasAmount && x.p.currency === 'USD' && x.p.amount < focalPrice.amount).sort((x, y) => x.p.amount - y.p.amount)
        : [];
    return { s, others, scored, focalPrice, cheaper };
  }

  function alternativesQuickAnswer(vendor, category) {
    const f = alternativesFacts(vendor, category);
    const fs = ctx.score(category.id, vendor.id);
    const top = f.scored.slice(0, 3).map((v) => scoredName(v, category.id));
    const focalText = fs.pending ? `${vendor.name} itself is score-pending` : `${vendor.name} itself scores ${fs.value}/100`;
    if (!top.length) return `We researched ${plural(f.others.length, 'alternative')} to ${vendor.name} in ${category.name}. None has a published documented-fit score yet; ${focalText}. Evidence checked ${asOf()}.`;
    return `The ${f.others.length === 1 ? 'one alternative' : `${f.others.length} alternatives`} to ${vendor.name} we researched in ${category.name} ${f.others.length === 1 ? 'is' : 'are'} led by ${listText(top)} on documented fit. ${focalText}. Scores reflect official documentation checked as of ${asOf()}, not user reviews.`;
  }

  function alternativesFaq(vendor, category) {
    const f = alternativesFacts(vendor, category);
    const out = [];
    if (f.scored.length) out.push({ q: `What are the top alternatives to ${vendor.name}?`, a: alternativesQuickAnswer(vendor, category) });
    if (f.cheaper.length) {
      out.push({
        q: `Which ${vendor.name} alternatives have a lower starting price?`,
        a: `${vendor.name} starts at ${f.focalPrice.headline} ${f.focalPrice.unit}. Lower public starting prices are published by ${listText(f.cheaper.slice(0, 4).map((x) => `${x.v.name} (${x.p.headline} ${x.p.unit})`))}. Units and plan limits differ, so check what each entry price includes.`,
      });
    }
    const agents = f.others.filter((v) => ['native', 'agent'].includes(v.ai?.level));
    if (agents.length) out.push({ q: `Which alternatives to ${vendor.name} have native AI or AI agents?`, a: `Official documentation describes native AI or AI agents for ${listText(agents.map((v) => v.name))}. Documented does not mean included in every plan.` });
    if (vendor.avoidIf) {
      out.push({
        q: `Why look for an alternative to ${vendor.name}?`,
        a: `Look more closely when: ${lowerFirst(sentence(vendor.avoidIf))}${vendor.tradeoffs?.length ? ` Documented trade-offs include: ${vendor.tradeoffs.slice(0, 2).map((t) => lowerFirst(stripDot(t))).join('; ')}.` : ''}`,
      });
    }
    return out;
  }

  return {
    categoryNoun,
    categoryThings,
    categoryQuickAnswer,
    categoryPriceFacts,
    categoryFaq,
    productQuickAnswer,
    productFaq,
    pairFacts,
    pairQuickAnswer,
    pairVerdict,
    pairFaq,
    alternativesFacts,
    alternativesQuickAnswer,
    alternativesFaq,
    firstSentence,
    sentence,
    stripDot,
    lowerFirst,
  };
}
