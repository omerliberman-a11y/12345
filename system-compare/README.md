# System Compare — redesigned site (US edition)

A complete redesign of [system-compare.com](https://system-compare.com/), rebuilt as a static site that is
generated from the same public catalog the live site renders from. No framework and no dependencies: Node ≥ 20.

```bash
node build.mjs --report          # build → dist/
node scripts/check.mjs dist      # QA every page (links, anchors, headings, titles, JSON-LD, alt text)
node scripts/serve.mjs dist 4173 # preview at http://127.0.0.1:4173/
node scripts/fetch-catalog.mjs   # refresh data/catalog.json from the live catalog API, then rebuild
```

`dist/` uses relative links, so the same output works at a domain root (production) and under any sub-path
(a preview folder, GitHub Pages). `node build.mjs --links=absolute --base=/` writes classic root-absolute links;
`--links=portable --outbound=direct` writes a copy that can be opened from a zip or `file://`.

## What changed for visitors

| | Before | After |
|---|---|---|
| Finding something | Four different matchers; 40 of 70 realistic buyer queries returned nothing | One search (`/` or Ctrl/Cmd+K): understands “X vs Y”, “X alternatives”, “free …”, “under $50”, typos and synonyms; full results page at `/search/` |
| Category page | 3 cards + the same products again as 361px rows; matrix hidden in a closed box 7 screens down | Answer first, then one ranked table (≈75px rows) with instant filters, sort and a shareable URL; capability matrix with the evidence behind every mark |
| Comparing | ≥ 3 clicks and a 7.5 MB download; 9,000px table inside a 646px scroll box | Tick rows → sticky tray → compare. Verdict and differences first; nothing scrolls inside the page |
| Score | Five repeated lines per card | One token; click it for the weighted groups and the exact checks that did not earn full credit |
| Software directory | 94,191px tall (234,323px on a phone), 1 MB of HTML | One row per product, filterable, a few screens long |
| Header | 190px desktop / 284px mobile, two rows, two search boxes | 64px / 56px, one row, one search, mobile menu |
| Page weight | CRM category 347 KB HTML, 135 KB CSS | ≈ 90 KB HTML, one ≈ 12 KB (gzip) stylesheet, no render-blocking script |

Nothing a buyer could read before has been removed: every score, price, evidence note, source link, date,
disclaimer and policy text is still published — it is arranged so the conclusion comes first.

## What stayed exactly the same

- **Every URL** (540 paths), every in-page anchor that is linked from outside, the feeds and `llms.txt`.
- **Every published number.** Scores, rankings, “Recommended”, coverage and prices come from
  `src/lib/scoring.mjs`, a port of the live method that was verified against the live HTML
  (50,030 comparisons, 0 mismatches).
- **The saved shortlist.** Same `localStorage` keys and shapes, so lists and notes visitors already saved keep working.
- **Commercial rules.** Vendor links still go through `/go/{id}/…` with the same tracking attributes; affiliate
  links keep `rel="sponsored"`, the visible “Ad · affiliate link” label and the page-level notice.
- **Privacy behaviour.** Analytics only after opt-in, Global Privacy Control respected, search terms never sent.
- **Index policy.** The same 255 URLs are indexable (plus the new `/faq/`). See “Decisions for the owner”.

## SEO and GEO (answer-engine) work

- An **answer-first passage** on every page: one or two self-contained sentences with product names, scores,
  prices and the check date, generated from the data (`src/lib/answers.mjs`).
- **FAQ everywhere it helps**: category FAQs (curated + generated from data), product, comparison and
  alternatives FAQs, and a site-wide hub at `/faq/` — all visible on the page and marked up as `FAQPage`.
- **Structured data on every page**: `Organization` (previously only on the home page), `WebSite` with
  `SearchAction`, the page node, `BreadcrumbList`, plus `ItemList`, `SoftwareApplication` (with `offers` only
  for verified prices), `Article`, `FAQPage`. The documented-fit score is never marked up as a rating or review.
- **Titles ≤ 60 and descriptions ≤ 155 characters**, data-driven (counts, top scores, check month).
- **Dates** as `<time>` elements; `dateModified` and sitemap `lastmod` from evidence dates only — never the build date.
- **Sitemap index** with `lastmod` everywhere, **robots.txt** with explicit groups for AI search crawlers,
  **llms.txt + llms-full.txt** generated from the same data as the pages.
- **Speed**: static HTML, one stylesheet, deferred scripts, self-hosted fonts, no layout shift from late content.

## Decisions for the owner

These are switches in `site.config.mjs` or questions only the publisher can answer:

1. **Index more pages?** `indexPolicy: 'parity'` keeps today's policy. `'gated'` additionally opens generated
   head-to-head pages and alternatives pages that pass a data-quality gate (both products scored and really
   different; enough scored alternatives). Those pages now carry unique, data-driven answers — this is the
   largest SEO lever available, but it is a publishing decision.
2. **Outbound links** assume the existing `/go/{vendorId}/` redirect service stays in front of the site
   (`outbound: 'go'`). A host without it needs `outbound: 'direct'` (loses affiliate tracking).
3. **Backend-dependent pages**: the partner application (`/partners/apply/`, `/api/partners/*`) and the contact
   form endpoint are unchanged and still need their services.
4. **AI training crawlers** are allowed in `robots.txt` (as today, where nothing was disallowed). Flip the
   group to `Disallow` to opt out without affecting AI *search* crawlers.
5. **FAQ wording** on `/faq/` is condensed from the methodology, editorial, commercial and corrections pages —
   please read it against those pages before launch.

## How it is put together

See [ARCHITECTURE.md](ARCHITECTURE.md): data layer, page-module contract, design language, shared components
and the client runtime.
