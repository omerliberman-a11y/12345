# System Compare — redesigned site (US edition)

A complete redesign of [system-compare.com](https://system-compare.com/), rebuilt as a static site that is
generated from the same public catalog the live site renders from. No framework and no runtime dependencies:
Node ≥ 20 builds all 543 pages in a few seconds.

```bash
node build.mjs --report            # build → dist/
node scripts/check.mjs dist        # QA every page (links, srcset, anchors, headings, titles, JSON-LD, alt text)
node scripts/seo-audit.mjs dist    # 36 SEO/GEO acceptance checks (index policy, sitemaps, JSON-LD, answers …)
node scripts/serve.mjs dist 4173   # preview at http://127.0.0.1:4173/ (caches hashed assets like production)
node scripts/fetch-catalog.mjs     # refresh data/catalog.json from the live catalog API, then rebuild
```

`dist/` uses relative links, so the same output works at a domain root (production) and under any sub-path
(a preview folder, GitHub Pages). `node build.mjs --links=absolute --base=/` writes classic root-absolute links;
`--links=portable --outbound=direct` writes a copy that can be opened from a zip or `file://`.
`npm install` is optional: it adds esbuild, which the build uses to minify the scripts when it is present.

**Deploying:** [HOSTING.md](HOSTING.md) has the cache policy (content-hashed `/assets/css`, `/assets/js`,
`/assets/fonts`, `/assets/articles/sized` are immutable; HTML, feeds, sitemaps and fixed-name images revalidate;
`/data` is versioned by `?v=`), an example `_headers` file, and the backend services the site expects
(`/go/`, `/api/partners/*`, the contact endpoint).

**Assets:** after adding or changing a guide or editorial hero image run `python3 scripts/make-hero-variants.py`
(and `make-article-social.py` for its share card); after adding or replacing vendor logos run
`python3 scripts/optimize-logos.py` and `node scripts/optimize-svg-logos.mjs` (file names stay as the catalog has them).

## What changed for visitors

| | Before | After |
|---|---|---|
| Finding something | Four different matchers; 40 of 70 realistic buyer queries returned nothing | One search (`/` or Ctrl/Cmd+K) that understands “X vs Y”, “A vs B vs C”, “X alternatives”, “free …”, “under $50”, typos, synonyms and questions about the site itself (“how we score”, “how do you make money”); Enter on a product or category name opens it; a full results page at `/search/` |
| Category page | 3 cards, then the same products again as 361px rows; the matrix hidden in a closed box 7 screens down | Answer first, then one ranked table with instant filters, sort and a shareable URL — the ranking starts on the first screen at every width, and using a filter or sort never moves the page; a capability matrix where every mark opens its evidence and every check explains itself |
| Comparing | ≥ 3 clicks and a 7.5 MB download; a 9,000px table inside a 646px scroll box | Tick rows → sticky tray → compare. Verdict and differences first; nothing scrolls inside the page |
| Score | Five repeated lines per card | One token; click it for the weighted groups and the exact checks that did not earn full credit |
| Ranking | Tied products listed in alphabetical order with no sign of the tie | Products with the same score share a place (“=1”); score-pending products have no place |
| Software directory | 94,191px tall (234,323px on a phone), 1 MB of HTML | One row per product, filterable, a few screens long |
| Header | 190px desktop / 284px mobile, two rows, two search boxes | 64px / 56px, one row, one search, a categories menu, a mobile menu — usable down to 320px and with large text |
| Page weight | CRM category 347 KB HTML, 135 KB CSS | ≈ 100 KB HTML; 13.6 KB (gzip) shared stylesheet + 0.7–4.9 KB for the page type, never more than two stylesheets; no render-blocking script; both web fonts preloaded with `font-display: optional`, so no page ever switches face |
| Accessibility | — | axe-core finds 0 violations on every page at desktop and phone width; every popover, toast and dialog works with the keyboard and a screen reader |

Nothing a buyer could read before has been removed: every score, price, evidence note, source link, date,
disclaimer and policy text is still published — arranged so the conclusion comes first. (On category pages the
per-cell evidence notes load on demand; they are in the static HTML of every product profile and comparison.)

## What stayed exactly the same

- **Every URL** (540 paths), every in-page anchor that is linked from outside, both feeds and their GUIDs.
- **Every published number.** Scores, order, “Recommended”, coverage and prices come from `src/lib/scoring.mjs`,
  a port of the live method verified against the live HTML (50,030 comparisons, 0 mismatches) and re-verified on
  the finished site by an independent recomputation (165,548 comparisons, 0 mismatches).
- **The saved shortlist.** Same `localStorage` keys and shapes, so lists and notes visitors already saved keep
  working; a list saved by an older version that no longer fits the catalog is repaired, and `/shortlist/` says so.
- **Commercial rules.** Vendor links go through `/go/{id}/…` with the same tracking attributes, destinations and
  `rel` values; affiliate links keep the visible “Ad · affiliate link” label and the page-level notice; the
  software directory and the four decision profiles keep their vendor-link placements; partner call-outs unchanged.
- **Privacy behaviour.** Analytics only after opt-in, Global Privacy Control respected, search terms never sent.
- **Index policy.** The same 255 URLs are indexable (plus the new `/faq/`). See “Decisions for the owner”.

## SEO and GEO (answer-engine) work

- An **answer-first passage** on every category, product, comparison and alternatives page: self-contained
  sentences with product names, scores, prices and the check date, generated from the data (`src/lib/answers.mjs`).
  The generator never names one of several tied products as the leader, never prints a number for a pending
  score, always states the billing term with a price and never splices free-text units into a sentence.
- **FAQ everywhere it helps**: category FAQs (curated + generated from data), product, comparison (including the
  three editorial briefs) and alternatives FAQs, and a site-wide hub at `/faq/`. Visible on the page and marked up
  as `FAQPage` (a question that appears on two pages is marked up on one of them, as Google asks).
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
  social, and the site card elsewhere).
- **Speed and stability**: static HTML, small shared CSS, deferred scripts; self-hosted fonts, preloaded, with
  `font-display: optional` and metric-matched fallback faces — a cached or fast view renders Inter and Rubik from
  the first paint, a slow first view keeps the fallback faces for that page, and no page ever switches face, so
  text never moves when a font arrives; responsive hero images (`srcset`); logos at no more than 2× their
  displayed size; the search index loads in two parts after the palette opens; no layout shift when the compare,
  shortlist, search and cost tools draw themselves; deep links land on their section at once.

## How it was verified

Every template was built by one engineer and reviewed by another against the mirrored live site. Then seven
rounds of independent site-wide verification ran on the finished build — SEO/GEO, content integrity,
accessibility (WCAG 2.2 AA), user journeys and compatibility, visual design and performance — each followed by a
fix round; the last design review found no blocker and no major issue. The verifiers' working scripts are not
part of the repository; `scripts/check.mjs` and `scripts/seo-audit.mjs` are, and both pass:

- `check.mjs`: 543 pages, 0 errors, 0 warnings (also for the portable and the sub-path builds).
- `seo-audit.mjs`: 36 checks, 0 failing (the remaining warnings are listed under “Decisions for the owner”).
- Content: 117,555 sentences of the old site traced to their new place — no catalog content lost; every number
  recomputed independently (0 mismatches); generated statements checked fact by fact.
- Accessibility: axe-core 0 violations on all 542 pages at 1440 and 390 px; keyboard walks of every template;
  reflow at 320 px and 400 % zoom; no page scrolls sideways at 320, 390, 820 or 1440 px with the site's 125 % and
  150 % text sizes or under the WCAG 1.4.12 text-spacing override; the site's own contrast, spacing and motion
  preferences.
- Journeys: the seven buyer jobs, 23 legacy URLs, every must-preserve anchor, old saved shortlists, private
  mode, no JavaScript, three link modes, failed data loads and 126 XSS probes.
- Performance: Lighthouse 12.8, served with gzip: desktop performance 100; phone performance 92–98 with the
  font preloads (95–99 without them); accessibility 100, best practices 100, SEO 100 on every indexable page
  (pages kept `noindex` by the index policy score 66–69, because Lighthouse counts `noindex` itself).
- Layout shift: 0 on every page type at 320–1440 px with the web fonts on time, 1–3 s late or blocked (the live
  search, compare and shortlist pages shifted by up to 0.59). Nothing moves when a font arrives, because no page
  ever switches face.
- First paint on an emulated Slow-4G first visit (1.6 Mbps, 150 ms RTT, gzip): 0.7–0.9 s on a phone, and that
  page keeps the metric-matched fallback faces. The font preloads cost 0.2–0.3 s there (0.5–0.7 s without them);
  on faster or repeat visits they are what lets Inter and Rubik render from the first paint (see decision 34).

## Decisions for the owner

Switches live in `site.config.mjs`; the rest are questions only the publisher can answer.

**Publishing and search**

1. **Index more pages?** `indexPolicy: 'parity'` keeps today's policy: the documentary AI-tool categories and
   their guides, the smallest rankings, most generated head-to-heads and all alternatives pages stay `noindex`.
   `'gated'` additionally opens head-to-head and alternatives pages that pass a data-quality gate. Those pages now
   carry unique, data-driven answers — the largest SEO lever available, and a publishing decision. (It also
   lifts the in-link counts of the 20 indexable AI-tool comparisons, which today are linked mostly from noindex
   pages.)
2. **Dates for five pages.** `/how-we-make-money/`, `/corrections/`, `/countries/`, `/partners/` and `/contact/`
   have no `modifiedAt` in the catalog, so they have no `lastmod`. Add real dates in the catalog to get them.
3. **Offer markup.** 63 of the 81 marked-up prices have no recorded price-check date (the price itself is the
   published one). Keep, or restrict `offers` to prices with a check date.
4. **AI training crawlers** are allowed in `robots.txt` (as today, where nothing was disallowed). Flip the group
   to `Disallow` to opt out without affecting AI *search* crawlers.
5. **Per-page social cards** exist for 37 pages; everything else shares the site card.
6. **Category names** come from the catalog in mixed capitalisation (9 of 66 in Title Case, such as “Payment
   Processing” next to “Email marketing”). Correct them in the catalog if you want one style.

**Commercial**

7. **Outbound links** assume the existing `/go/{vendorId}/` redirect service stays in front of the site
   (`outbound: 'go'`). A host without it needs `outbound: 'direct'` (loses affiliate tracking).
8. **Vendor-link placements** follow the live site: the directory links vendors of the two commercial-link
   categories, and the four decision profiles link their listed alternatives. Extending either is your call.
9. **Pricing-source links on comparison pages** go through `/go/{id}/?intent=pricing` (the live comparison pages
   linked the vendor's pricing URL directly). EngageBay's pricing link is therefore an affiliate link there too.
10. **Backend-dependent pages**: the partner application (`/partners/apply/`, `/api/partners/*`, and its
    224 KB `partners-ui.js` kept from the live site) and the contact form endpoint still need their services (and
    CORS for the contact endpoint if the static site is served from another origin). On a host without them the
    partner form shows its server error. Analytics is off on those two pages, as the privacy text says.
11. **Cost calculator** models only the offers the live calculator allowed (Pipedrive, Salesforce Starter,
    Twilio, Brevo); other products ask for the visitor's own quote. Extending that list is an editorial call.

**Wording and presentation introduced by the redesign — please read before launch**

12. **“Price not verified”** replaces “See pricing” for the 33 products whose pricing page was read but gave no
    single public starting amount; the recorded pricing basis is printed under it.
13. **Shared places** (“=1”) and **no place for score-pending products** are new: the live site showed no rank
    numbers. The methodology page explains both in its worked example.
14. **“Recommended”** still goes to every product that shares the top score — six at once in Email marketing.
    Keep the rule, or show it only when the leader is alone?
15. **Verdict line** on comparison pages names the product with the higher documented-fit score (“… not that the
    product is better for every team”); for ties and pending scores it says so instead. The compare tool and
    `/vs/` open in the “Scored checks” view; “Differences only” is one click away — choose the default.
16. **Home page previews** follow the published method text: catalogue order, the top two scored products plus
    every product tied with the second, and a later category skipped when its tied leaders already appeared.
17. **Tax line**: category cost tables say “tax treatment is not documented and add-ons are not included”; the
    per-price line “Tax treatment not documented” of the old cards is gone (pricing.vat is recorded for 33 vendors).
18. **Disclaimer phrase**: “not a customer rating or a hands-on test” (the publisher's own phrase) is used
    everywhere; “Editorial score: — /100 (not assigned)” replaces “Editorial rating” on the three editorial briefs.
19. **/faq/** is condensed from the methodology, editorial, commercial and corrections pages; “How do I get my
    product listed?” says “through the free application” while `/partners/` also describes a paid service.
20. **Prices**: sub-cent prices print in full (Twilio: $0.0083, where the live card rounded to $0.01). Documentary
    categories print amounts exactly as the live site did (“USD 21.5”) while scored pages print “$35”; reformat
    those as “$21.50”? A “lowest published amount” is stated only when all published prices of a documentary
    category are in one verified currency, naming every offer that shares it. Ahrefs (€119) is not part of the
    price sort, which compares US-dollar amounts only.
21. **Editorial comparison heroes** (the illustrated “VS” images) are the only illustrations of that style on
    the site; keep, restyle or drop.
22. **Phones**: the quick answer is clamped to three lines with “Show the full answer” (the full text is in the
    HTML); key facts on product profiles are collapsed; removing a product from the compare tool on a phone goes
    through “Change products”. Below 62em, product profiles show Visit and Add to shortlist right under the name
    and score (one copy rendered per width, same placement and tracking attributes), so the quick answer starts
    about 60 px lower (up to 120 px on affiliate pages, where the per-link commission sentence also shows).
23. **Category first screen**: the section menu (Ranking, Capabilities, Costs …) slides in once the visitor scrolls
    past the page head, on every width (keyboard users reach it in normal tab order); from 1250 px the evidence line
    sits beside the quick answer; “Must-have capabilities” leads the filter row; on phones the sort shows one word
    (“Score”, “Price”, “A–Z”, “Coverage”) and a filtered count reads “N of M tools · Clear”. Please confirm.
24. **Search wording**: “X vs” with no second product opens the compare tool with X chosen (“Compare X with another
    product”; for documentary suppliers “Compare X with the other suppliers”); brand words shared by several
    products (zoho, google, microsoft …) list each product as Suggestions, Zoho CRM first because the alias “zoho”
    names it; category questions (“crm pricing”, “best crm”) lead with the category's costs section or ranking;
    “<supplier> pricing” opens that supplier's plans (“Plans and prices · <category>”). With a query, `/search/`
    hides its example paragraph and its privacy sentence (“Searches run in your browser …”) unless nothing is found;
    the palette footer still says it.
25. **Shortlist on phones**: with storage blocked (private mode) the tray says “Not saved · Kept only until you
    leave this page”; with two or more products the phone tray shows logos or initials (names in the accessible
    name and title).
26. **Pricing sources**: category tables now print the plan and a direct “Source ↗” link to the vendor's pricing
    page, as the live cards did (“Official pricing source ↗”); the comparison pages' price-source row goes through
    `/go/{id}/?intent=pricing` (decision 9). Choose one approach for both. Plan names are visible from 48em and read
    only by screen readers on phones (showing them adds a line to many phone rows).
27. **Tables on tablets**: from 768 to 1135 px alternatives rows use the phone's compact row (small logo beside the
    name) so names never break mid-word; on the brevo and pulseem profiles at 768–791 and 992–1011 px one row's logo
    plate is narrower so the table fits its column. Comparison library: groups show their first pairs in published
    order with the rest in a disclosure (4,251 px at 1440, was 5,152); featuring the editorial and indexable
    comparisons first would reorder the library.

**Accessibility and performance standards**

28. **Consent panel** now comes right after the skip link in reading order (its position on screen and the
    consent logic are unchanged), so keyboard and screen-reader users meet it first. Please sign off.
29. **/accessibility/ statement** (your text): Space activation, visible focus, text size and reduce motion now
    work as it promises; review its “Known limitations”. A VoiceOver check on an iPhone is recommended before launch:
    stacked tables keep their table semantics in Chromium, but WebKit could not be tested here.
30. **Touch targets**: WCAG 2.2 AA (24 px) is met everywhere; every control is 44 px on touch; small links inside
    text and tables use invisible 44 px hit areas; the in-row pricing “Source” link has a 31–46 px area so it does
    not take taps from the next row. Decide whether dense in-table source links must also be 44 px boxes.
31. **Small text**: nothing is under 12 px, but evidence tables on comparison and product pages keep 12–13 px
    captions, so more than 15 % of characters are under 14 px on about 250 pages. Density or the 15 % target?
32. **Page budgets**: every product profile carries all of its capability evidence in static HTML, so all 149 are
    over the 60 KB content-page budget (median 75 KB, gzip 15 KB) and three pages are over 3,000 elements. Accept a
    higher budget for evidence-carrying pages, or move non-primary categories to links.
33. **Hosting headers**: HOSTING.md proposes the policy; what the host can set, and whether its CDN keys `/data/`
    on the query string, is the host's call. The search engine is prefetched on every page (5–7 KB gzip); skip it
    on Save-Data connections if you prefer.
34. **Fonts**: both web fonts are preloaded and use `font-display: optional`. Every cached view and every fast
    first visit renders Inter and Rubik from the first paint, and no page ever switches face; a slow first visit
    paints about 0.25 s later than it would without the preloads and keeps the metric-matched fallback faces for
    that page. To drop the preloads (faster slow first paint, but the first page of every visit in the fallback
    faces), delete the `${fontPreloads(ctx)}` line in `src/lib/layout.mjs`. Inter is 48 KB, over the 40 KB
    per-file budget; subsetting it needs font tools that were not available here (`pyftsubset`).

## How it is put together

See [ARCHITECTURE.md](ARCHITECTURE.md): data layer, page-module contract, design language, shared components
and the client runtime. [HOSTING.md](HOSTING.md) covers deployment and caching.
