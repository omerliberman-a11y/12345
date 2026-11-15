# System Compare — site architecture

A zero-dependency static build (Node ≥ 20). `data/catalog.json` (a snapshot of the public catalog API) plus a
few captured content files go in; a complete static site comes out.

```
node build.mjs                 # → dist/   (relative links: works at any base path)
node build.mjs --out=/tmp/x --only=software,alternatives     # render only some page modules
node scripts/check.mjs dist    # QA: links, anchors, one h1, titles, descriptions, JSON-LD, alt text …
node scripts/serve.mjs dist 4173
```

## Layout of the repo

```
site.config.mjs          product decisions (index policy, outbound links, partners, home picks)
build.mjs                assets → pages (src/pages/*.mjs) → generators (src/gen/*.mjs) → link rewriting
data/catalog.json        categories[66], vendors[149], guides[37], comparisons[117], pages{…}
data/content/*.json      server-side-only content captured from the live site (hreflang map, live titles,
                         affiliate ids, guide SEO titles, taxonomy, search synonyms/aliases, static HTML)
src/lib/
  html.mjs               html`` tagged template (auto-escapes everything; raw() to opt out), text(), clip(), cx()
  context.mjs            createContext(): data + scoring + URL/price/score helpers  → `ctx`
  scoring.mjs            verified port of the published scoring method (do not change behaviour)
  answers.mjs            answer-first passages + FAQ generators (category, product, pair, alternatives)
  seo.mjs                title()/describe() + JSON-LD node builders
  layout.mjs             document shell (<head>, header, footer), crumbs(), icon()
  components.mjs         shared HTML components (import * as ui)
  site-faq.mjs           the site-wide FAQ (used by /faq/ and the home page)
  indexing.mjs           which URLs are indexable (parity with the live site; optional gated mode)
src/pages/<module>.mjs   export function routes(ctx) → [{ path, render(ctx) → page }]
src/gen/<name>.mjs       export async function generate(ctx, emit) → writes non-page files (data, sitemaps …)
src/assets/css/          tokens.css, base.css, layout.css, components.css, pages/<module>.css  → one bundle
src/assets/js/           core.js (every page), search.js (engine), table.js, <module>.js   (copied, hashed)
src/assets/static/       copied verbatim to the site root (logos, fonts, brand, favicon)
```

## Writing a page module

```js
import { html, raw, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes(ctx) {
  return ctx.vendors.map((v) => ({ path: ctx.url.software(v.id), render: (c) => render(c, v) }));
}
function render(ctx, vendor) {
  return {
    title, description,            // ≤ 60 / ≤ 155 chars — use seoTitle(core, year) and describe([variants])
    body: html`…`,                 // content of <main>; exactly ONE <h1>; no skipped heading levels
    breadcrumbs: [{ name, url }],  // without Home; last = this page. Rendered AND emitted as JSON-LD
    nav: 'categories',             // active primary nav item: categories | compare | guides | methodology | shortlist
    pageType: 'WebPage',           // schema.org type of the page node
    pageExtra: {},                 // extra props for the page node (about, mainEntity …)
    jsonld: [ … ],                 // extra @graph nodes (ctx.seo.itemListNode, softwareNode, articleNode …)
    faq: [{ q, a }],               // → FAQPage JSON-LD. `a` must be the plain visible answer: text(a)
    dateModified,                  // ISO date from DATA only — never the build date
    accountable: true,             // adds the publication approver as accountablePerson
    scripts: ['js/<module>.js'],   // extra deferred scripts
    pageData: { … },               // JSON for the page script (#page-data)
    ogType, ogImage, robots, canonical, bodyAttrs, hideCrumbs, preload
  };
}
```

Rules that keep every page consistent:

- **Internal links are always root-absolute** (`/categories/crm/`). The build rewrites `href`, `src`, `action`,
  `data-href`, `data-src` for the chosen link mode. In client JS always wrap paths with `SC.url('/x/')`.
- **Never build HTML by string concatenation.** Use `html```; interpolations are escaped automatically. Use
  `raw()` only for markup we generated or for the publisher's own page HTML from the catalog.
- **Dates**: `ui.time(ctx, iso)` → `<time datetime>` + "Nov 5, 2026". Never print a build date.
- **Outbound vendor links**: only through `ui.outLink(ctx, vendor, { intent: 'website'|'pricing', from: '<placement>' })`.
  It writes the `/go/{id}/?intent=&from=` URL, the five `data-outbound-*` attributes analytics reads, the right
  `rel`, and — for affiliate vendors — the visible "Ad · affiliate link" label. The layout adds the page-level
  affiliate notice automatically when a page contains an affiliate link. Never link `vendor.url` directly as a CTA.
  Links to cited sources are plain followed links: `ui.sourceLink(url, label)` / `ui.sources(list)`.
- **Scores**: use `ctx.score(categoryId, vendorId)` (`value`, `pending`, `checked`, `total`, `coveragePct`,
  `rank`, `recommended`, `groups`, `rows`, verbatim `valueText`/`coverageText`/`documentedText`). Never compute a
  score yourself, never print a number for a pending score, never show stars or "rating"/"review" wording, and
  never emit rating/review JSON-LD. Say "documented-fit score" at least once per page that shows scores, with a
  check date nearby and the "not a user rating or hands-on test" framing (ui.tableNote does this for tables).
- **Prices**: use `ctx.price(vendor, categoryId)` (`headline`, `unit`, `billingNote`, `plan`, `checkedAt`,
  `sourceUrl`, `summary`, `extras`, `hasAmount`, `state`). Render with `ui.priceCell`. In the `sms-marketing`
  context some vendors intentionally show "SMS price not verified" — always pass the category id.
- **Category-specific data**: a vendor has a different score per category. The price context and default
  comparison scope of a vendor is `ctx.primaryCategory(vendor)`; sections per category use
  `ctx.vendorCategories(vendor)` (catalog order).
- **Two kinds of categories**: scored (`ctx.scoredCategories`, products in `ctx.vendors`) and documentary
  (`ctx.isFactual(category)`; everything lives in `category.factual` — suppliers, plans, criteria, sources).
  Documentary suppliers have no profile page: link them to `ctx.url.supplier(categoryId, supplierId)`.
- **Indexing**: do not set `robots` yourself; the layout asks `ctx.isIndexable(path)` (live-site parity).
- **Answer first**: every page opens with the conclusion (ui.answer) in the first screen, then the table/tool,
  then method and caveats. Use the generators in `ctx.answers`.
- **Stable ids** used by existing deep links must survive: category `#products #features #feature-evidence
  #criteria #buying-guide #costs #demo #faq`; product `#fit #capabilities #ai #pricing #evidence #source-review
  #plan-options`; documentary category `#supplier-{id} #factual-comparison #decision-aid #buyer-checklist
  #research-method #sources`.

## Design language (see the live components on / and /categories/crm/)

- White canvas, ink text, one accent (indigo `--brand`); orange only as a small highlight. Hairlines and
  whitespace separate things; **no bordered cards around paragraphs**. Surfaces with a border/shadow are only
  for things that float (tray, popover, dialog) and for inputs. `.tile` is allowed only for navigating between
  unlike things on index pages.
- **Products are rows.** Anything comparable is a table (`ui.productTable`, `.dtable`, `.matrix`), never a
  card grid. One row component is reused everywhere.
- Type: `--fs-xs` (captions only) … `--fs-3xl`; body 16px. Headings use `--font-display`. Use the tokens in
  `tokens.css` — never raw colours, sizes or radii in page CSS.
- Plain words in the interface: "Score", "checked", "Score pending", "Shortlist", "Source", "How we score".
- Every interactive target ≥ 44px tall on touch; visible focus; no horizontal page scroll at 390px (wide
  tables go inside `<div class="scroller">`); no nested vertical scrolling ever.
- Sticky chrome budget: header (56/64px) + optional `.subnav` (48px) + compare tray when non-empty.
- Page CSS goes in `src/assets/css/pages/<module>.css` and must be namespaced with a page prefix
  (`.sw-…`, `.vs-…`). Do not edit tokens/base/layout/components CSS or the shared lib files from a page task;
  if a shared change is needed, note it in your report.

## Shared components (`import * as ui from '../lib/components.mjs'`)

`ui.productTable(ctx, categoryId, rows, opts)` ranked table · `ui.scoreToken` · `ui.scoreRing` ·
`ui.breakdown` (group meters) · `ui.scoreHelp` · `ui.priceCell` · `ui.aiTag` · `ui.status(st)` /
`ui.statusLegend()` · `ui.logo` · `ui.pick` / `ui.shortlistButton` · `ui.outLink` · `ui.sourceLink` ·
`ui.sources` · `ui.answer` · `ui.trustline` · `ui.sectionHead` · `ui.faq` · `ui.linkList` · `ui.tile` ·
`ui.facts` · `ui.subnav` · `ui.toc` · `ui.chipLinks` · `ui.ticks(items, 'ticks'|'crosses'|'dots')` ·
`ui.searchField` · `ui.time` · `ui.tag` · `ui.tableNote` · `ui.methodSentence` · `ui.icon(name)`.

CSS building blocks: `.wrap`, `.wrap--narrow`, `.section`, `.section--tint`, `.section-head`, `.page-head`,
`.eyebrow`, `.lede`, `.trustline`, `.btn` (`--ghost --quiet --soft --sm --lg`), `.chip` / `.chips`, `.tag`,
`.seg`, `.toolbar`, `.dtable` (+ `.scroller`), `.matrix`, `.facts`, `.proscons`, `.ticks/.crosses/.dots`,
`.steps`, `.linklist`, `.tile`, `.acc`, `.prose`, `.sources`, `.note`, `.fineprint`, `.subnav`, `.toc`,
`.with-rail`, `.grid --2/3/4`, `.stack`, `.cluster`, `.field/.input/.select/.textarea/.check`,
`.searchfield`, `.dialog/.sheet`, `.pop`, `.meter`, `.ring`, `.score`, `.price`, `.logo`, `.empty`.

## Client runtime (`SC`, from core.js)

`SC.url(path)` · `SC.load(name)` → data from `/data/<name>.js` (e.g. `cat-crm`, `vendors`, `search-index`) ·
`SC.shortlist.{get,has,toggle,remove,clear,replace,compareUrl}` (localStorage `sc-us-shortlist`, same shape
as the previous site) · `SC.toast(msg, actions)` · `SC.openSearch(q)` · `SC.el(spec, props, kids)` (build DOM
with `textContent` — never `innerHTML` with data) · `SC.$`, `SC.$$`, `SC.store`, `SC.save`.
Events: `sc:shortlist-updated`, `sc:comparison-add`, `sc:cost-calculation`.
Any element with `data-shortlist="<vendorId>" data-category="<categoryId>" data-name="…"` is a working
shortlist toggle. Any element with `data-score-pop="<categoryId>:<vendorId>"` opens the score breakdown
("Why not 100?") — `ui.productTable` already does this for every score cell. `SC.float.open(anchor, node)` /
`SC.float.close()` give you the same anchored popover (class `.evpop`) for your own evidence details. `data-search-open`, `data-copy="url"`, `data-pop` (popover `<details>`), `data-tabs`,
`data-subnav`, `data-toc` are wired automatically.

Per-category data chunk `/data/cat-<id>.js` (see `src/gen/category-data.mjs`): features, and for every vendor
its score, price, fit text and one evidence cell per feature `[status, note, verification, date, source]`.
```
