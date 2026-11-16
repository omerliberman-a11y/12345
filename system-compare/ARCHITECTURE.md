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
src/assets/css/          tokens.css, base.css, layout.css, components.css → /assets/css/site.<hash>.css;
                         pages/<type>.css → /assets/css/p-<type>[-plus-<other>].<hash>.css (a page that uses
                         another page file's rules gets only those rules folded in: at most two stylesheets)
src/assets/js/           core.js (every page), search.js (engine), compare-base.js (/vs/ + /compare/),
                         table.js, <module>.js → /assets/js/<name>.<hash>.js (minified when esbuild is installed)
src/assets/static/       copied to the site root (logos, brand, favicon, article images, research cards);
                         fonts and assets/articles/sized/ get a content hash in their name
scripts/                 check.mjs, seo-audit.mjs (QA) · serve.mjs (preview) · fetch-catalog.mjs (data) ·
                         make-article-social.py, make-hero-variants.py (article images) ·
                         optimize-logos.py, optimize-svg-logos.mjs (vendor logos; names stay as in the catalog)
HOSTING.md               cache policy, example headers file, the backend services the site expects
```

Every `/data/*.js` file is requested with `?v=<hash of all generated data files>` (`ctx.dataVersion`, filled in by
build.mjs), so a data change always reaches visitors; hashed assets can be cached forever (see HOSTING.md).

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
  When one action has to sit in two places for two layouts (the product profile's Visit / shortlist pair: under the
  name below 62em, in the decision block from 62em), both copies come from the same call and CSS renders exactly one
  at any width (`display: none` on the other), so tracking, `rel` and the label stay identical.
  Links to cited sources are plain followed links: `ui.sourceLink(url, label)` / `ui.sources(list)`.
  A `.ext` link shows "↗"; when it opens a new tab (`target="_blank"`) screen readers hear ", opens in a new tab" in
  the arrow's place (CSS alternative text in components.css). That is the one way the site says it: never add the
  words to a link's text, or they are read twice.
- **Scores**: use `ctx.score(categoryId, vendorId)` (`value`, `pending`, `checked`, `total`, `coveragePct`,
  `recommended`, `groups`, `rows`, verbatim `valueText`/`coverageText`/`documentedText`). Never compute a
  score yourself, never print a number for a pending score, never show stars or "rating"/"review" wording, and
  never emit rating/review JSON-LD. Say "documented-fit score" at least once per page that shows scores, with a
  check date nearby and the "not a customer rating or hands-on test" framing (ui.tableNote does this for tables).
- **Places and ties**: products with the same published score share a place, and score-pending products have
  none. Print `score.placeText` ("3", "=1", "") or `score.placeLabel` ("#3 of 7 scored", "Tied #1 of 12"),
  never `score.rank` (that is only the listing order, alphabetical inside a tie). Sentences about who leads
  come from `ctx.answers.leaders(categoryId, vendors)`, which names or counts a whole tie group; a "top 5"
  list is cut with `ctx.topWithTies(categoryId, list, 5)` so a tie is never split.
- **Images**: article images with sized variants (`assets/articles/sized/`, made by `scripts/make-hero-variants.py`)
  get `srcset`/`sizes` from `ctx.imageSet(src, sizes)` (spread it with `attrs()`); only images that are the LCP on
  desktop are preloaded, with a desktop media query.
- **Prices**: use `ctx.price(vendor, categoryId)` (`headline`, `unit`, `billingNote`, `plan`, `checkedAt`,
  `sourceUrl`, `summary`, `extras`, `hasAmount`, `state`, `basis`). Render with `ui.priceCell` (it prints the
  recorded pricing basis under "Custom quote" / "Usage-based" / "Price not verified"; options `plan`, `checked` and
  `source: vendor.name` add the plan, the check date and "Source ↗", a direct, followed new-tab link to `sourceUrl`
  — a cited source like the live cards' "Official pricing source", never `/go/`; a plan named after the product keeps
  its name, "RingEX plan", never a bare "plan"; "billed annually" is not added to a unit that already says it). In the
  `sms-marketing` context some vendors intentionally show "SMS price not verified" — always pass the category id.
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
- Type: `--fs-xs` (12px, captions only) … `--fs-3xl`; body 16px; weights 400/600/700 (the word-mark keeps its
  own). One heading scale in base.css (h2 28px → 22px on phones, h3 18px, h4 16px). Headings use
  `--font-display`. Use the tokens in `tokens.css` — never raw colours, sizes or radii in page CSS. The fonts are
  not preloaded: `--font` and `--font-display` start with metric-matched fallback faces (Inter local, Inter
  fallback, SC Rubik fallback in tokens.css) so nothing moves when the web fonts arrive — if the fonts or their
  weights change, re-measure `size-adjust` as the tokens.css comment describes (including the digits faces that
  keep `ch` widths stable).
- Text-size preference (`html[data-a11y-size]`): the compact header is used at every width and stacked table rows
  wrap by word. Product tables stay stacked until their scaled columns fit (125%: below 75em, 150%: below 90em; from
  48em the score, price and AI tag share the line under the product); `.dtable` column heads, button, chip, tag and
  status labels, score notes, a link list's end note (it moves under the title first) and long host names in vendor
  links may wrap. Reduce-motion preference: no smooth scrolling, no animation.
- Header (layout.css): from 62em the brand keeps its size and the search field takes the room left (icon only below
  6.5rem, which only a reader's extra letter spacing reaches); a word-mark wider than its room is clipped at the brand's
  edge, never drawn over a button. A `.note` is one paragraph (links stay in its sentence); a leading `.tag` is a column
  beside the text from 48em and runs into the first line on phones.
- Plain words in the interface: "Score", "checked", "Score pending", "Shortlist", "Source", "How we score".
- Every interactive target ≥ 44px tall on touch; visible focus; no horizontal page scroll at 390px (wide
  tables go inside `<div class="scroller">`); no nested vertical scrolling ever.
- Sticky chrome budget: header (56/64px) + optional `.subnav` (48px) + compare tray when non-empty. On category
  pages the `.subnav` takes no room in the first screen: it waits under the opaque page head (`.cat-top`, stacked
  above it, `margin-top: -(3rem + 1px)` on the menu) and comes into view, sticky, as the head scrolls away; keyboard
  focus raises it at once (category.css, so it also works without script) and table.js then scrolls the page until
  the menu sits where it sticks, so it never covers the end of the head (smooth, or instant with reduced motion;
  documentary category pages load table.js for this alone). The menu's links carry `scroll-margin-top: -4.5rem`:
  stuck inside the page's `scroll-padding-top`, they were taken for hidden and every Tab scrolled the page ~430px up
  (the same rule would help the shared `.subnav` on other templates).
- Page CSS goes in `src/assets/css/pages/<module>.css` and must be namespaced with a page prefix
  (`.sw-…`, `.vs-…`). Do not edit tokens/base/layout/components CSS or the shared lib files from a page task;
  if a shared change is needed, note it in your report.

## Shared components (`import * as ui from '../lib/components.mjs'`)

`ui.productTable(ctx, categoryId, rows, opts)` ranked table · `ui.scoreToken` · `ui.scoreRing` ·
`ui.breakdown` (group meters) · `ui.scoreHelp` · `ui.priceCell` · `ui.aiTag` · `ui.status(st)` /
`ui.statusLegend()` · `ui.logo` · `ui.pick` / `ui.shortlistButton` · `ui.outLink` · `ui.sourceLink` ·
`ui.sources` · `ui.answer` · `ui.trustline` · `ui.sectionHead` · `ui.faq` · `ui.linkList` · `ui.tile` ·
`ui.facts` · `ui.subnav` · `ui.toc` · `ui.chipLinks` · `ui.ticks(items, 'ticks'|'crosses'|'dots')` ·
`ui.searchField` · `ui.time` · `ui.tag` · `ui.tableNote` · `ui.methodSentence` · `ui.icon(name)` ·
`ui.dated(text)` (plain generated text → HTML with every printed date in `<time>`; `ui.answer` and `ui.faq`
apply it to string input). `ui.productTable` options: `action(vendor)` + `actionLabel` + `actionClass` add a
trailing column; `focalId`/`focalTag` mark the reference row; `priceChecked` prints each price's provenance —
plan (from 48em always on the line under the amount, the unit under it; without an amount the plan list and the pricing
basis share one quieter line; screen-reader text on phones, where a row keeps one price line when it fits), "Checked
<date> · Source ↗" whole on a line (category pages, as the live category cards; other tables show the price only, as
theirs did) — the table carries `ptable--dated`, whose price column is 16.75rem from 75em;
`lazyFrom` (default 4) lazy-loads row logos after the rows a first screen shows; `eagerIds` (a Set) keeps the
first rows of a table the script re-orders eager.
- `ui.answer(ctx, text, { label, meta, more })`: with `more: true` the passage is clamped to 3 lines on phones with a
  native `<details>` "Show the full answer" (CSS only; the full text stays in the HTML; the meta note opens with it).
- `ui.trustline(items, { compact })`: an item given as `{ more: text }` is visually collapsed on phones (screen
  readers keep it); never pass a link as a `more` item.
- `ui.logo`: product-row plates (no `size`) carry `data-xwide` from a 5.5:1 aspect ratio (phones show initials) and
  `data-xwide="2"` from 8:1 (tablets too); small tiles carry `data-wide` from 2.5:1. The ratios are exported
  (`WIDE_LOGO_RATIO`, `XWIDE_LOGO_RATIO`, `XXWIDE_LOGO_RATIO`) and mirrored in the data files (`wd`, `xw`), so
  rows and tiles drawn by scripts behave the same (`SC.monogram`).
- Prices in sentences: `ctx.answers.pricePhrase(p)` / `proseUnit(p.unitPhrase)` — a plain "per …" unit stays in
  the sentence, anything else is bracketed as published; never splice `p.unit` into prose.

Layout rules learned the hard way:
- Phone product rows: a compact plate floated beside the name, the fit line and price at full width under it.
- Script-rendered tools reserve their space before the first paint (compare mount min-height while empty or
  loading, and with a saved shortlist the category picker keeps its room unpainted (`data-wait`) until its "Your
  shortlist" box is in place; the shortlist paints only its status line while `data-state="loading"`; `/search/` results keep a
  min-height, and with a query its "Start from a category" stays unpainted until the results are in, so the "No
  results" note appears above it without moving it) — target CLS under 0.1, also when the script arrives late. The cost calculator (`[data-cost]`,
  js/cost.js sets `data-state` "loading" → "ready") keeps its fine print and everything after it unpainted from the
  first paint until its first state is drawn — an element hidden only after it was painted still counts as moved
  when it reappears — with a 2.5s CSS fallback if the script never runs. Its sticky totals bar shares a grid cell
  with the inputs, so it can grow (names wrap, amounts never shorten; with the text-size preference a phone shows
  one product per line) without taking room in the page.
- Text that only just fits a line can wrap with the fallback face and not with the web font: re-run a fallback-vs-
  web-font row-height comparison after changing table text (the price cell's end padding and the dated ranking's
  16.75rem price column were chosen that way).
- The compare tray is filled while it is still below the screen and slides in a frame later (core.js
  `renderTray`): growing and appearing in the same frame counted as a layout shift on every page. A closed tray is
  `visibility: hidden` once it has slid away, so Tab never reaches its old buttons.
- Do not use `content-visibility` on blocks above anchored sections: placeholder heights moved 434 deep links
  under the sticky header.
- Category first screen (category.mjs, category-factual.mjs): head → quick answer (with the evidence line as a
  column beside it from 78em, where that column holds its longest item next to the answer's full 54rem) → filters.
  Nothing in it may depend on whether a line only just fits: the web font and its fallback differ by ~0.6% (up to
  2.4% for a title), and a line that wraps in one and not the other moves the page when the font arrives. So the
  ranking's controls are a grid of two rows at every width (filters; then the live count left, the sort and the score
  help in a slot at the right end; from 75em the sort and help end the filter row and the count is the line above
  the table), and the title, the lede (buyer's question; a documentary page's description) and the evidence line
  get their line breaks from the text: an upper bound of its width in every face (per-character advances,
  category.mjs "line breaks in the page head") in `--fit` (one line only where the line is at least that wide, else
  at most `--fitb`, 90% of the text: two balanced lines in every face; one text node, never split into elements),
  and for narrower lines `--fitN` (a line that surely holds it in N lines, its words wrapped by their sums) and
  `--fitbN` (at most that wide it surely takes N), compared with the line's width in CSS (`.cat-fitline`, container
  units; up to 3% short of fewer lines, the text is set up to 3% smaller instead; the evidence line breaks after its
  second item, and after its fourth where five items do not fit two lines, `--tfit`/`--tfit2`/`--tfit3`). Re-measure
  those tables if a font, a fallback face or the heading letter-spacing changes. Only the answer paragraph (4-6
  lines of running text) can still gain or lose a line at some widths. The sort is a native `<select>` laid over a
  chip-sized face that table.js keeps in step; the face holds every order's short label stacked in one cell (one
  shown) and has a min-width over the longest, so a new order or the web font never resizes or moves it (phones
  show "Sort" only; the count's "· sorted by …" is then screen-reader text). Phones: the filter chips are one row
  from edge to edge that scrolls sideways (right edge faded), and the count line under it (44px) holds the sort and
  the help. A chip reached by keyboard is scrolled fully into view (table.js). The must-have panel is a disclosure (no focus
  trap): a popover on wide screens (fitted to the room below its chip), a full-width bottom sheet over a dimmed page on phones (the backdrop is the
  toolbar's `::after`, so a tap on it counts as outside), with a footer holding the live "n of N match" count and a
  Done button that closes it and returns focus to its chip.

CSS building blocks: `.wrap`, `.wrap--narrow`, `.section`, `.section--tint`, `.section-head`, `.page-head`,
`.eyebrow`, `.lede`, `.trustline`, `.btn` (`--ghost --quiet --soft --sm --lg`), `.chip` / `.chips`, `.tag`,
`.seg`, `.toolbar`, `.dtable` (+ `.scroller`), `.matrix`, `.facts`, `.proscons`, `.ticks/.crosses/.dots`,
`.steps`, `.linklist`, `.tile`, `.acc`, `.prose`, `.sources`, `.note`, `.fineprint`, `.subnav`, `.toc`,
`.with-rail`, `.grid --2/3/4`, `.stack`, `.cluster`, `.field/.input/.select/.textarea/.check`,
`.searchfield`, `.dialog/.sheet`, `.pop`, `.meter`, `.ring`, `.score`, `.price`, `.logo`, `.empty`.

## Client runtime (`SC`, from core.js)

`SC.url(path)` · `SC.load(name)` → data from `/data/<name>.js?v=<data version>` (e.g. `cat-crm`, `vendors`,
`search-index-1`, `search-index-2`) ·
`SC.shortlist.{get,has,toggle,remove,clear,replace,setPlan,compareUrl}` (localStorage `sc-us-shortlist`, same shape
as the previous site) · `SC.openSearch(q)` · `SC.el(spec, props, kids)` (build DOM with `textContent` — never
`innerHTML` with data) · `SC.$`, `SC.$$`, `SC.store`, `SC.save`.
Events: `sc:shortlist-updated`, `sc:comparison-add`, `sc:cost-calculation`.

Search: `SC.search.engine()` resolves with the engine and part 1 of the index (names, aliases, categories,
prices, logos — about 35 KB gzip, loaded after the palette has painted); `SC.search.engine({ full: true })`
resolves after part 2 (descriptions, features, integrations, best-for, AI capabilities, guide headings) is merged.
Entries carry no URL when `urlOf(type, id, …)` in search.js can rebuild it. The palette's Enter opens the Best
match (`data-top`): "X vs Y", "A vs B vs C", "compare A and B", "X alternatives", "X pricing", a product's name, a
category's exact name or synonym, or the site's own page / FAQ answer for questions about the site; "X vs", "X v",
"X or", "compare X" (X named exactly, no second product yet) open the compare tool with X chosen
(`/compare/?scope=<category>&a=<id>`; a documentary supplier: its category's `#factual-comparison`), listed above
X's head-to-heads. When nothing answers the query outright (`r.direct === false`, e.g. a loosely typed "crm vs"),
or the first row is about products the query does not name ("crm pricing", "crm alternatives", "phone
alternatives", "crm vs pipedrive": a category's word, a word several products share, a generic part of a name), the
first group is titled "Suggestions" and has no `data-top`; Enter then opens /search/, and the palette footer says
so ("Enter for all results"). A product counts as named by its name or an alias, by words a plain search reads as
that product, or by its brand word typed or misspelt ("malchimp pricing") unless that word is a category's own.
`SC.search.answers(engine, r, q)` holds this rule; the palette and the /search/ page heading both use it.
Shift+Enter always opens /search/. `SC.searchLimit` (120 characters, 20 words) and
its message are shared by the palette, /search/ and the directory filters. The site's own vocabulary lives in
`data/content/search-aliases.json` under `pages`
(by URL) and `faq` (by /faq/ item id); avoid words that also name software.

Shortlist storage: `replace`, `remove`, `clear` and `setPlan` return `true` once saved and `false` when the
browser refused (private mode, blocked storage); the list is then kept in memory for the page view,
`SC.shortlist.saved()` is `false`, and nothing says "saved". The tray then says so for as long as it shows: its
label ends "· this page only" from 48em, and below 48em a "Not saved · Kept only until you leave this page" line
sits above the chips (the full sentence is the `aria-describedby` of that tag and of the tray's compare link); the
header link's hidden "saved" after the count then reads "not saved".
On phones a one-product tray drops "Clear" (the chip's × does the same) and wraps "Add one more to compare" in
two lines; at any width the actions move under the chips rather than push them out. With two or more products a
phone tray shows each product as its logo (or initials) and × (`.tray__items--many`, fixed widths, so two fit
whole beside Clear and Compare from 375px); from 48em the names show until one would be cut short, then the chips
show logos too (`trayFit`, decided when the tray is drawn and on resize, never on a font swap). The name stays in
every chip as screen-reader text and as its `title`. A chip row wider than the tray scrolls sideways and fades at
the edge where more chips are (`trayFade`, `data-fade`); its scroll padding brings a focused × clear of the fade. Every page repairs the saved
list against `vendors.js` (rows `[name, logo, darkSurface, primaryCategoryId, wideWordmark, [indexes into scored]]`): unknown
products and products from another category are dropped, a list with an unknown or documentary category is
dropped, a missing category is inferred, and the list is written back in the old shape. `SC.shortlist.ready()`
resolves after that check; `SC.shortlist.repairNote()` returns what was removed (shown once on /shortlist/).
Tabs on the home page and on product profiles keep the chosen category in `?scope=<categoryId>`.

Messages and focus (keyboard and screen-reader users must be able to reach everything):
- `SC.announce(text)` — one polite live region for status messages; use it instead of a toast for confirmations.
- `SC.toast(msg, actions, { returnFocus, focus, after, say, ms })` — one toast at a time (a new one replaces the
  old). A toast with actions takes focus on its first action, has a Close button, closes on Escape and never times
  out while it has focus or hover; focus then returns to `returnFocus` (or the trigger). With `focus: false` and
  `after: element` it sits in the tab order right after that element and stays until closed (the shortlist Undo).
  No "added to your shortlist" toast is shown while the tray is visible: the tray and `SC.announce` confirm it.
- `SC.float.open(anchor, node, { align: 'center' })` / `SC.float.ready(node)` (call once its content is in place:
  focus moves into the popover) / `SC.float.close()` / `SC.float.anchor()` — the anchored, focus-managed popover
  (class `.evpop`, role dialog). Tab past its last link continues after the trigger; Shift+Tab before its first
  link closes it and returns to the trigger. Title it with `<p class="evpop__title">`, not a heading.
- `SC.syncBottomPad()` keeps `scroll-padding-bottom` on `<html>` equal to the tray, consent panel or toast that is
  showing, so a focused control is never hidden under them; a tray taller than the 4.5rem `body.has-tray` keeps
  free (the "Not saved" line, wrapped rows at a large text size) also sets the body's bottom padding and lifts the
  toasts above it. `SC.focusAfter(el)` moves focus to the next focusable element after `el`.
- The hero search field opens the palette on click, typing, Enter, ArrowDown or `/` — never on focus — so Tab
  passes through it. `a[role=button]` triggers (`data-search-open`, `data-menu-open`) answer to Space and carry
  `aria-haspopup="dialog"` + `aria-expanded`.

Any element with `data-shortlist="<vendorId>" data-category="<categoryId>" data-name="…"` is a working
shortlist toggle. Any element with `data-score-pop="<categoryId>:<vendorId>"` opens the score breakdown
("Why not 100?") — `ui.productTable` already does this for every score cell. `data-search-open`,
`data-copy="url"`, `data-pop` (popover `<details>`, closes on Escape, on a click outside and when focus moves on
to an element outside it; focus moving to an element around it does not close it: a press on the text of a panel
without `tabindex` focuses `<main tabindex="-1">`, and closing it then, mid-press, crashed Chromium's renderer.
Give the panel `tabindex="-1"` anyway, as `ui.scoreHelp`, the must-have panel and compare.js do, so the press keeps
focus inside it), `data-tabs`, `data-subnav`,
`data-toc` and `data-mega` (closes when focus leaves it) are wired automatically. On category pages every
capability-matrix cell button gets an accessible name built from its row and column headers
("Pipedrive, Contacts and relationship records: Supported").

Per-category data chunk `/data/cat-<id>.js` (see `src/gen/category-data.mjs`): features, and for every vendor
its score, price, fit text and one evidence cell per feature `[status, note, verification, date, source]`.
```
