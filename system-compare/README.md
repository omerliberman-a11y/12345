# System Compare — redesigned site (US edition)

A complete redesign of [system-compare.com](https://system-compare.com/), rebuilt as a static site that is
generated from the same public catalog the live site renders from. No framework and no runtime dependencies:
Node ≥ 20 builds all 543 pages in about three seconds.

```bash
node build.mjs --report            # build → dist/
node scripts/check.mjs dist        # QA every page (links, anchors, headings, titles, JSON-LD, alt text)
node scripts/seo-audit.mjs dist    # 36 SEO/GEO acceptance checks (index policy, sitemaps, JSON-LD, answers …)
node scripts/serve.mjs dist 4173   # preview at http://127.0.0.1:4173/
node scripts/fetch-catalog.mjs     # refresh data/catalog.json from the live catalog API, then rebuild
```

`dist/` uses relative links, so the same output works at a domain root (production) and under any sub-path
(a preview folder, GitHub Pages). `node build.mjs --links=absolute --base=/` writes classic root-absolute links;
`--links=portable --outbound=direct` writes a copy that can be opened from a zip or `file://`.
`npm install` is optional: it adds esbuild, which the build uses to minify the scripts when it is present.

## What changed for visitors

| | Before | After |
|---|---|---|
| Finding something | Four different matchers; 40 of 70 realistic buyer queries returned nothing | One search (`/` or Ctrl/Cmd+K) that understands “X vs Y”, “X alternatives”, “free …”, “under $50”, typos and synonyms; a full results page at `/search/` |
| Category page | 3 cards, then the same products again as 361px rows; the matrix hidden in a closed box 7 screens down | Answer first, then one ranked table with instant filters, sort and a shareable URL; a capability matrix where every mark opens its evidence and every check explains itself |
| Comparing | ≥ 3 clicks and a 7.5 MB download; a 9,000px table inside a 646px scroll box | Tick rows → sticky tray → compare. Verdict and differences first; nothing scrolls inside the page |
| Score | Five repeated lines per card | One token; click it for the weighted groups and the exact checks that did not earn full credit |
| Ranking | Tied products listed in alphabetical order with no sign of the tie | Products with the same score share a place (“=1”); score-pending products have no place |
| Software directory | 94,191px tall (234,323px on a phone), 1 MB of HTML | One row per product, filterable, about eight screens |
| Header | 190px desktop / 284px mobile, two rows, two search boxes | 64px / 56px, one row, one search, a categories menu, a mobile menu |
| Page weight | CRM category 347 KB HTML, 135 KB CSS | ≈ 95 KB HTML; 11 KB (gzip) shared stylesheet + 1–4 KB per page type; no render-blocking script |

Nothing a buyer could read before has been removed: every score, price, evidence note, source link, date,
disclaimer and policy text is still published — arranged so the conclusion comes first. (On category pages the
per-cell evidence notes load on demand; they are in the static HTML of every product profile and comparison.)

## What stayed exactly the same

- **Every URL** (540 paths), every in-page anchor that is linked from outside, both feeds and their GUIDs.
- **Every published number.** Scores, order, “Recommended”, coverage and prices come from `src/lib/scoring.mjs`,
  a port of the live method verified against the live HTML (50,030 comparisons, 0 mismatches) and re-verified on
  the finished site by an independent recomputation (165,548 comparisons, 0 mismatches).
- **The saved shortlist.** Same `localStorage` keys and shapes, so lists and notes visitors already saved keep working.
- **Commercial rules.** Vendor links go through `/go/{id}/…` with the same tracking attributes, destinations and
  `rel` values; affiliate links keep the visible “Ad · affiliate link” label and the page-level notice; the
  software directory and the four decision profiles keep their vendor-link placements; partner call-outs unchanged.
- **Privacy behaviour.** Analytics only after opt-in, Global Privacy Control respected, search terms never sent.
- **Index policy.** The same 255 URLs are indexable (plus the new `/faq/`). See “Decisions for the owner”.

## SEO and GEO (answer-engine) work

- An **answer-first passage** on every category, product, comparison and alternatives page: self-contained
  sentences with product names, scores, prices and the check date, generated from the data (`src/lib/answers.mjs`).
  The generator never names one of several tied products as the leader, never prints a number for a pending
  score, and always states the billing term with a price.
- **FAQ everywhere it helps**: category FAQs (curated + generated from data), product, comparison and
  alternatives FAQs, and a site-wide hub at `/faq/`. Visible on the page and marked up as `FAQPage` (a question
  that appears on two pages is marked up on one of them, as Google asks).
- **Structured data on every page**: `Organization`, `WebSite` with `SearchAction`, the page node,
  `BreadcrumbList`, plus `ItemList`, `SoftwareApplication` (with `offers` only for numeric public prices),
  `Article`, `FAQPage`, `DefinedTerm`. The documented-fit score is never marked up as a rating or review.
- **Titles ≤ 60 and descriptions ≤ 155 characters.** Product descriptions lead with the curated summary sentence,
  then the score and price when they fit.
- **Dates** as `<time>` elements; `dateModified` and sitemap `lastmod` from evidence and price dates only — never
  the build date. Pages with no date in the data carry none (the editorial policy forbids inventing one).
- **Sitemap index**, **robots.txt** with explicit groups for AI search crawlers, **llms.txt + llms-full.txt**
  generated from the same data as the pages and limited to the pages that are open to search engines.
- **Internal links**: comparison pages link to each other and to alternatives; alternatives pages link to their
  siblings; the AI hub lists the AI-tool comparisons; the categories menu lists the categories open to search
  engines (the rest are one click away on `/categories/`).
- **Social cards**: 1200×630 JPEG/PNG on every page (the 30 product research cards, article heroes re-framed for
  social — `scripts/make-article-social.py` — and the site card elsewhere).
- **Speed**: static HTML, small shared CSS, deferred scripts, self-hosted fonts, no layout shift from late content.

## How it was verified

Every template was built by one engineer and reviewed by another against the mirrored live site; then
independent site-wide passes ran on the finished build. Their working scripts are not part of the repository,
but `scripts/check.mjs` and `scripts/seo-audit.mjs` are, and both pass:

- `check.mjs`: 543 pages, 0 errors, 0 warnings (also for the portable and the sub-path builds).
- `seo-audit.mjs`: 36 checks, 0 failing (warnings are listed under “Decisions for the owner”).
- Content: 117,555 sentences of the old site traced to their new place — no catalog content lost; 5,271 generated
  statements checked fact by fact; affiliate, hreflang, verification tags, feeds and index policy at parity.

## Decisions for the owner

Switches live in `site.config.mjs`; the rest are questions only the publisher can answer.

**Publishing and search**

1. **Index more pages?** `indexPolicy: 'parity'` keeps today's policy: the documentary AI-tool categories and
   their guides, the smallest rankings, most generated head-to-heads and all alternatives pages stay `noindex`.
   `'gated'` additionally opens head-to-head and alternatives pages that pass a data-quality gate. Those pages now
   carry unique, data-driven answers — the largest SEO lever available, and a publishing decision.
2. **Dates for five pages.** `/how-we-make-money/`, `/corrections/`, `/countries/`, `/partners/` and `/contact/`
   have no `modifiedAt` in the catalog, so they have no `lastmod`. Add real dates in the catalog to get them.
3. **Offer markup.** 63 of the 81 marked-up prices have no recorded price-check date (the price itself is the
   published one). Keep, or restrict `offers` to prices with a check date.
4. **AI training crawlers** are allowed in `robots.txt` (as today, where nothing was disallowed). Flip the group
   to `Disallow` to opt out without affecting AI *search* crawlers.
5. **Per-page social cards** exist for 37 pages; everything else shares the site card.

**Commercial**

6. **Outbound links** assume the existing `/go/{vendorId}/` redirect service stays in front of the site
   (`outbound: 'go'`). A host without it needs `outbound: 'direct'` (loses affiliate tracking).
7. **Vendor-link placements** follow the live site: the directory links vendors of the two commercial-link
   categories, and the four decision profiles link their listed alternatives. Extending either is your call.
8. **Pricing-source links on comparison pages** go through `/go/{id}/?intent=pricing` (the live comparison pages
   linked the vendor's pricing URL directly). EngageBay's pricing link is therefore an affiliate link there too.
9. **Backend-dependent pages**: the partner application (`/partners/apply/`, `/api/partners/*`) and the contact
   form endpoint are unchanged and still need their services (and CORS for the contact endpoint if the static
   site is served from another origin). Analytics is off on those two pages, as the privacy text says.

**Wording introduced by the redesign — please read before launch**

10. **“Price not verified”** replaces “See pricing” for the 33 products whose pricing page was read but gave no
    single public starting amount; the recorded pricing basis is printed under it.
11. **Shared places** (“=1”) and **no place for score-pending products** are new: the live site showed no rank
    numbers. The methodology page explains both in its worked example.
12. **Verdict line** on comparison pages names the product with the higher documented-fit score (“… not that the
    product is better for every team”); for ties and pending scores it says so instead.
13. **Home page previews** follow the published rule (catalogue order, at least two scored products, tied leaders
    together) and show up to five scored products where the methodology text says “the top two”.
14. **Tax line**: category cost tables say “tax treatment is not documented and add-ons are not included”; the
    per-price line “Tax treatment not documented” of the old cards is gone (pricing.vat is recorded for 33 vendors).
15. **Disclaimer phrase**: “not a customer rating or a hands-on test” (the publisher's own phrase) is used
    everywhere; “Editorial score: — /100 (not assigned)” replaces “Editorial rating” on the three editorial briefs.
16. **/faq/** is condensed from the methodology, editorial, commercial and corrections pages; “How do I get my
    product listed?” says “through the free application” while `/partners/` also describes a paid service.
17. **Sub-cent prices** print in full everywhere (Twilio: $0.0083, where the live card rounded to $0.01).
18. **Documentary categories** state a “lowest published amount” only when all published prices are in one
    verified currency, and name every offer that shares it.

## How it is put together

See [ARCHITECTURE.md](ARCHITECTURE.md): data layer, page-module contract, design language, shared components
and the client runtime.
