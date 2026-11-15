// Site-wide FAQ. Answers are condensed from the publisher's own methodology, editorial-policy,
// how-we-make-money, corrections, about and partners pages (those pages remain the authority).
// Numbers are generated from the catalog at build time. Used by /faq/ and (a subset) the home page.

import { fmtDate } from './format.mjs';

export function siteFaq(ctx) {
  const scoredCats = ctx.scoredCategories;
  let pairs = 0;
  let pending = 0;
  for (const c of scoredCats) {
    const s = ctx.summary(c.id);
    pairs += s.total;
    pending += s.pending;
  }
  const suppliers = ctx.factualCategories.reduce((n, c) => n + (c.factual?.suppliers?.length || 0), 0);
  const p = ctx.site.publisher;
  const approver = ctx.catalog.researchApprover;
  const editions = (ctx.pages['/countries/']?.editions || []).length;

  return [
    {
      id: 'scores',
      title: 'Scores',
      items: [
        {
          id: 'score-meaning',
          q: 'What is the documented-fit score?',
          a: `A whole number from 0 to 100 showing the weighted share of a category’s checklist that official vendor documentation supports. It describes documented support for that checklist. It is not a measure of product quality, customer satisfaction or hands-on performance, and it is not a user rating. The published method version is ${ctx.catalog.scoringVersion}.`,
          home: true,
        },
        {
          id: 'score-calculation',
          q: 'How is the score calculated?',
          a: 'Every checklist item belongs to one of four groups: core capabilities (45), integrations (20), local US suitability (20) and AI (15). A group with no active items is dropped and the remaining weights are normalised to 100; items share their group’s weight equally. Supported counts 1, limited or paid add-on 0.5, not supported 0 and not verified 0. The result is rounded once to a whole number.',
        },
        {
          id: 'score-pending',
          q: 'Why does a product show “Score pending”?',
          a: `A score is published only when at least 80% of the active checklist weight has a checked status, including documented absence. Below that, the page shows how many items and how much weight have been checked. Pending is not a negative finding: unverified is not a claim that a capability is absent. Today ${pending} of ${pairs} product–category pairs in scored categories are pending.`,
          home: true,
        },
        {
          id: 'not-reviews',
          q: 'Are the scores user reviews or star ratings?',
          a: 'No. System Compare publishes research, not customer star ratings. Scores come only from official documentation that we checked on a stated date. We do not collect user reviews and we do not run hands-on product tests.',
          home: true,
        },
        {
          id: 'recommended',
          q: 'What does “Recommended” mean?',
          a: 'Every product that shares the highest published score in its category carries the label, so several products can be recommended at once. It reflects documented fit only; no vendor pays for it.',
        },
        {
          id: 'ordering',
          q: 'How are products ordered in a category?',
          a: 'Scored products come before pending ones. Products with the same displayed score are ordered by unrounded score, then evidence coverage, then number of fully documented items, then name. Pending products are ordered by name. Filters and sorting change what you see, never the published score.',
        },
        {
          id: 'plans',
          q: 'Does a documented capability apply to every plan?',
          a: 'No. Product-wide research can span several plans. A capability available only on a higher plan can earn full credit in a product-wide comparison when that plan is named. Always confirm the exact plan you intend to buy.',
        },
        {
          id: 'testing',
          q: 'Do you test the products?',
          a: 'No. The research compares official vendor documentation, pricing pages and plan boundaries. Suggested demo questions are tasks for you to run with the vendor, not tests we performed.',
        },
      ],
    },
    {
      id: 'prices-dates',
      title: 'Prices and dates',
      items: [
        {
          id: 'price-sources',
          q: 'Where do the prices come from?',
          a: 'From the vendor’s official pricing pages, linked beside each price. Prices are dated research snapshots of public list prices, not live quotes. Taxes, minimums, promotions and contract terms can change the amount you pay; confirm with the vendor.',
          home: true,
        },
        {
          id: 'dates',
          q: 'What do the dates on a page mean?',
          a: '“Evidence checked” is the date the capability sources were read. “Price checked” is the date the pricing source was read. “Sources checked” marks a scoped research review. “Content updated” marks an editorial change. A methodology or design update never changes these dates, and we never substitute the date the site was built.',
        },
        {
          id: 'update-frequency',
          q: 'How often is the research updated?',
          a: `Updates are logged with their real dates on the Research updates page and in the RSS and Atom feeds. The latest research update was ${fmtDate(ctx.catalog.researchUpdatedAt, { long: true })}.`,
        },
      ],
    },
    {
      id: 'independence',
      title: 'Money and independence',
      items: [
        {
          id: 'business-model',
          q: 'How does System Compare make money?',
          a: 'Some links to vendors are affiliate links, labelled “Ad · affiliate link”. We may receive a commission when a purchase is attributed to one of those referrals.',
          home: true,
        },
        {
          id: 'pay-to-rank',
          q: 'Do vendors pay for scores or placement?',
          a: 'No. Payment, registration or commission does not set a score or an order, and the same price, source and disclosure rules apply to every vendor.',
          home: true,
        },
        {
          id: 'vendor-links',
          q: 'What happens when I click a vendor link?',
          a: 'Our /go/ addresses redirect to the vendor without forwarding your query parameters and without setting an affiliate cookie of our own. The vendor or its partner network may use its own referral measurement and cookies after you arrive.',
        },
      ],
    },
    {
      id: 'corrections-publisher',
      title: 'Corrections, vendors and publisher',
      items: [
        {
          id: 'report-error',
          q: 'How do I report an error?',
          a: `Email ${p.supportEmail} with the page address, the claim, the plan or region, and a link to official documentation. We check the source and update the record when it is supported. A vendor request alone cannot change the scoring rules. We do not promise a response time.`,
        },
        {
          id: 'get-listed',
          q: 'How can a vendor be listed?',
          a: 'Through the free application on the Partners page, with the official product URL, category, US availability and a pricing or documentation link. Inclusion requires enough public evidence for a useful comparison; payment does not determine the result.',
        },
        {
          id: 'publisher',
          q: 'Who publishes System Compare and who is accountable?',
          a: `${p.legalName}, Israel, company number ${p.companyNumber}, ${p.street}, ${p.city} ${p.postalCode}.${approver ? ` The ${approver.role.toLowerCase()} for the US edition is ${approver.name}.` : ''}`,
        },
        {
          id: 'ai-assisted',
          q: 'Is AI used to produce the research?',
          a: 'Yes. Collection and drafting are AI-assisted; the work is documentary research, not hands-on testing, and a named person approves publication.',
        },
        {
          id: 'coverage',
          q: 'What does the site cover?',
          a: `${ctx.vendors.length} product profiles in ${scoredCats.length} scored categories, ${suppliers} suppliers in ${ctx.factualCategories.length} documented-only categories, ${ctx.comparisons.length} comparisons and ${ctx.guides.length} buying guides, for US buyers.${editions > 1 ? ` ${editions - 1} other country editions are listed on the Countries page.` : ''}`,
        },
      ],
    },
  ];
}
