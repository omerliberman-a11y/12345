// Scored category page: answer first, one ranked table with instant filters, a capability matrix as a
// second view of the same products, then the buying guide, FAQ, comparisons and sources.
// (Documentary categories — category.mode === 'factual' — are rendered by category-factual.mjs.)

import { html, raw, text, cx, attrs } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { title as seoTitle, describe } from '../lib/seo.mjs';

export function routes(ctx) {
  return ctx.scoredCategories.map((category) => ({ path: ctx.url.category(category.id), render: (c) => render(c, category) }));
}

const GROUP_ORDER = ['core', 'integrations', 'local', 'ai'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (iso) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');

// ---------------------------------------------------------------- line breaks in the page head
// A line of the head that only just fits wraps differently in the web font and in the metric-matched fallback shown
// before it (about 0.6% apart, up to 2.4% for a title), and when the web font arrives everything below moves. So where
// the title, the lede (buyer's question, documentary description) or the evidence line could take a line more or less,
// the choice is made from the text, not from the rendered glyphs: its width in each face is the sum of its characters'
// advances (measured in Chromium at 100px with kerning off, which only ever narrows text: on all 66 category pages
// 0-0.7% over the rendered width for Inter and 2.7-3.7% for the title face), the widest face counts, and category.css
// compares that with the width of the line (.cat-fitline; the evidence line: .cat-sum > .trustline::after). Measure the
// tables again when a font, a fallback face or the heading letter-spacing changes.
const ADV_CHARS = '0123456789 !"#$%&\'()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~–—’‘“”·é…×€';
const ADV = Object.fromEntries(
  Object.entries({
    // h1: "SC Rubik" 600 and "SC Rubik fallback", letter-spacing -0.025em (thousandths of an em, in ADV_CHARS order)
    title: [
      '657 468 623 633 656 621 627 547 655 618 210 268 421 678 644 784 719 225 361 361 434 600 260 468 265 510 272 282 499 556 499 569 830 693 684 682 698 619 598 699 726 300 650 636 577 808 702 692 656 692 671 641 606 708 672 812 665 661 626 357 509 357 445 728 371 569 611 569 611 574 417 614 628 263 279 556 264 898 622 590 611 611 424 531 437 620 573 818 564 574 530 400 245 400 545 558 748 244 250 455 449 319 574 698 580 763',
      '657 657 657 657 657 657 657 657 657 657 272 328 472 556 556 895 725 232 328 328 386 584 272 328 272 272 328 328 584 584 584 611 982 725 725 725 725 668 611 781 725 272 556 725 611 837 725 781 668 781 725 668 611 725 668 950 668 668 611 328 272 328 584 556 328 556 611 556 611 556 328 611 611 272 272 556 272 895 611 611 611 611 386 556 328 611 556 781 556 556 498 386 274 386 584 556 1007 272 272 498 498 328 556 1007 584 556',
    ],
    // body text: "Inter" 400, "Inter local" (an installed Inter) and "Inter fallback"
    body: [
      '631 407 610 618 646 594 621 566 619 621 282 288 466 634 642 982 645 300 365 365 501 662 289 460 289 361 289 302 662 662 662 512 966 690 655 731 722 602 591 747 744 269 571 672 566 904 754 765 639 765 644 642 646 745 690 986 683 679 629 365 361 365 472 457 323 562 613 572 613 584 371 614 592 243 243 549 243 876 591 600 613 613 377 528 328 592 563 819 546 563 553 427 333 427 662 500 1000 261 261 441 441 289 584 865 662 667',
      '631 407 610 618 646 608 621 566 619 621 282 288 466 634 642 982 645 300 365 365 501 662 289 460 289 361 289 289 662 662 662 512 966 690 655 731 722 602 591 747 744 269 571 672 566 904 754 765 639 765 644 642 646 745 690 986 683 679 629 365 361 365 472 457 323 613 613 572 613 584 371 614 592 243 243 549 243 876 591 600 613 613 377 528 328 592 563 819 546 563 553 427 333 427 662 500 1000 299 299 512 512 289 584 865 662 667',
      '631 631 631 631 631 631 631 631 631 631 297 297 380 594 594 950 713 204 356 356 416 624 297 356 297 297 297 297 624 624 624 594 1085 713 713 772 772 713 653 831 772 297 534 713 594 890 772 831 713 831 772 713 653 772 713 1008 713 713 653 297 297 297 502 594 356 594 594 534 594 594 297 594 594 238 238 534 238 890 594 594 594 594 356 534 297 594 534 772 534 534 534 357 278 357 624 594 1068 238 238 356 356 356 594 1068 624 594',
    ],
  }).map(([role, faces]) => [role, faces.map((s) => s.split(' ').map(Number))]),
);
// the margin over the estimate: the title face's sums already run 2.7% or more over the rendered width (kerning), so
// a little of that is given back; the body faces' sums are the rendered width or a hair over, so 0.3% is added
const SLACK = { title: 0.985, body: 1.003 };
/** Width of a text in em of its face (role 'title' or 'body'), the widest face; a character outside the table counts 1em. */
export function textEm(text, role) {
  return Math.max(...ADV[role].map((t) => faceEm(text, t))) / 1000;
}
const faceEm = (text, t, other = 1000) => [...String(text)].reduce((n, ch) => n + (ADV_CHARS.includes(ch) ? t[ADV_CHARS.indexOf(ch)] : other), 0);
const emUp = (x, role) => (Math.ceil(x * SLACK[role] * 100) / 100).toFixed(2);
// for lines narrower than the text: a short run of words strays further from its sums than a whole text (every word
// and run of two or three words of the 66 titles and ledes, both faces, at 390 and 1440 px: a title is drawn at
// 92.8-98.1% of its sums, a lede at 96.2-101.0%), so a line's widest is its sums times STRICT, its narrowest times KMIN
const STRICT = { title: 0.985, body: 1.013 };
const KMIN = { title: 0.92, body: 0.955 };
/** Lines taken by a text wrapped into lines `w` em wide, as the browser wraps it: `words` holds each word's pieces
 *  (widths in em; a word may break after a piece), words are a space `sp` apart; a line breaks before a word or a
 *  piece that does not fit. */
function linesAt(words, sp, w) {
  let n = 1, x = null;
  for (const ps of words) ps.forEach((pw, i) => {
    const gap = i ? 0 : sp;
    if (x === null) x = pw; else if (x + gap + pw <= w) x += gap + pw; else { n++; x = pw; }
  });
  return n;
}
/**
 * Style for a heading or a lede (category.css .cat-fitline): --fit is the width of the whole text in em of its own
 * font; where its line is at least that wide it stays on one line. Where it is not, the element is at most --fitb wide
 * (90% of the text, narrower than the text in every face), so it takes two balanced lines in every face. The same for
 * more lines, where the line is narrower still: --fitN is a line that surely holds the text in N lines in every face
 * (its words wrapped at their spaces, by their sums), and at most --fitbN wide it surely takes N (cannot fit N - 1;
 * left out where no such width also holds it in N). Under --fit5 a phone line wraps freely.
 * The text stays one text node: a split into elements made a part jump from line to line where a phone line still
 * wraps freely, and the browser scores such a jump by its whole distance.
 */
export function fitStyle(text, role) {
  const w = textEm(text, role);
  const st = [`--fit:${emUp(w, role)}`, `--fitb:${(Math.floor(w * 90) / 100).toFixed(2)}`];
  // the most lines: whole words at their sums (the browser can only break more often, and draws narrower); the fewest:
  // words that may also break after a hyphen, a slash or a dash, at the least they can be drawn
  const words = String(text).split(' ');
  const faces = ADV[role].map((t) => {
    const em = (x, other) => faceEm(x, t, other) / 1000, sp = em(' ');
    return { most: [words.map((x) => [em(x) * STRICT[role]]), sp * STRICT[role]], fewest: [words.map((x) => x.split(/(?<=[-/–—])/).map((p) => em(p, 0) * KMIN[role])), sp * KMIN[role]] };
  });
  const search = (ok) => { let lo = 0, hi = w * 1.1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; } return hi; };
  // a line that surely holds it in k lines (and its longest word: a longer word would be broken); the widest line on
  // which it surely cannot take fewer than k
  const longest = Math.max(...faces.map((f) => Math.max(...f.most[0].map((p) => p[0]))));
  const need = (k) => Math.ceil(Math.max(longest, search((m) => faces.every((f) => linesAt(...f.most, m) <= k))) * 100) / 100;
  const under = (k) => Math.floor((search((m) => !faces.every((f) => linesAt(...f.fewest, m) >= k)) - 0.005) * 100) / 100;
  for (let k = 2; k <= 5; k++) {
    st.push(`--fit${k}:${need(k).toFixed(2)}`);
    if (under(k + 1) >= need(k + 1)) st.push(`--fitb${k + 1}:${under(k + 1).toFixed(2)}`);
  }
  return st.join(';');
}
/** The same for the evidence line (ui.trustline: 14px items 1.25rem apart, broken after its first `n` items, and
 *  after the next `n` too where that is not enough; category.css breaks after items 2 and 4): --tfit is the whole row,
 *  --tfit2 the wider of its two parts, --tfit3 the widest of its three (as --tfit2 for up to 2n items). */
export function fitItems(items, n) {
  const w = items.map((t) => textEm(t, 'body') + 1.25 / 0.875), sum = (l) => l.reduce((x, y) => x + y, 0);
  const t2 = Math.max(sum(w.slice(0, n)), sum(w.slice(n))), t3 = Math.max(sum(w.slice(0, n)), sum(w.slice(n, 2 * n)), sum(w.slice(2 * n)));
  return `--tfit:${emUp(sum(w), 'body')};--tfit2:${emUp(t2, 'body')};--tfit3:${emUp(t3, 'body')}`;
}

function render(ctx, category) {
  const A = ctx.answers;
  const s = ctx.summary(category.id);
  const path = ctx.url.category(category.id);
  const group = ctx.groupOf(category);
  const noun = A.categoryNoun(category);
  const things = A.categoryThings(category);
  const ranked = s.ranked;
  const updated = ctx.categoryUpdated(category);
  const year = (ctx.catalog.checkedAt || '').slice(0, 4);

  // ---- features (checklist rows) with their score group and active flag — same for every vendor
  const sample = ranked[0] ? ctx.fit(category.id, ranked[0].id).rows : [];
  const features = sample.map((row, i) => ({ i, id: row.id, label: row.label, description: row.description, group: row.scoringGroup, active: row.active, tier: row.tier }));
  const groupMeta = Object.fromEntries(ctx.scoring.SCORE_GROUPS.map((g) => [g.id, g]));
  const activeCount = features.filter((f) => f.active).length;
  const yesIndex = (vendor) => ctx.fit(category.id, vendor.id).rows.map((r, i) => (r.effectiveStatus === 'yes' ? i : -1)).filter((i) => i >= 0).join(' ');
  const yesCount = features.map((f) => ranked.filter((v) => ctx.fit(category.id, v.id).rows[f.i].effectiveStatus === 'yes').length);

  // ---- facet counts for the filter chips
  const prices = ranked.map((v) => ctx.price(v, category.id));
  const nScored = s.scored;
  const nPriced = prices.filter((p) => p.hasAmount).length;
  const nAi = ranked.filter((v) => ['native', 'agent'].includes(v.ai?.level)).length;
  // Nothing scored yet (every product is under the 80% gate): the list is not a ranking. It is titled
  // "{things}", has no place column, offers no zero-count filter and sorts by the share checked (js/table.js).
  const unscored = nScored === 0;

  // ---- head
  const scoredList = ranked.filter((v) => !ctx.fit(category.id, v.id).isPending);
  // products that share the highest published score are named together, never one of them alone
  const topScore0 = scoredList.length ? ctx.fit(category.id, scoredList[0].id).score : null;
  const topTied = scoredList.filter((v) => ctx.fit(category.id, v.id).score === topScore0);
  const top =
    topTied.length > 1
      ? [topTied.length <= 3 ? `${ctx.listText(topTied.map((v) => v.name))} (${topScore0}/100 each)` : `${topTied.length} products tied at ${topScore0}/100`]
      : scoredList.slice(0, 2).map((v) => `${v.name} ${ctx.fit(category.id, v.id).score}/100`);
  const base = category.description.replace(/\.$/, '');
  const live = ctx.liveHead(path) || {};
  const title = seoTitle(`${category.name}: ${s.total} tools compared`, year);
  const description = describe([
    top.length >= 2 && `${base}. ${s.total} tools; top documented fit: ${top.slice(0, 2).join(', ')}. Checked ${monYear(ctx.catalog.checkedAt)}.`,
    top.length >= 1 && `${base}. ${s.total} tools; top documented fit: ${top[0]}. Checked ${monYear(ctx.catalog.checkedAt)}.`,
    top.length >= 1 && `${base}. ${s.total} tools; top fit: ${top[0]}.`,
    `${base}. ${s.total} tools compared with dated official sources; scores pending.`,
    `${base}. ${s.total} tools compared.`,
    `${base}.`,
    live.description,
  ]);

  const quick = A.categoryQuickAnswer(category);
  const faqItems = A.categoryFaq(category);
  const pf = A.categoryPriceFacts(category);
  const vsPages = ctx.comparisonsInCategory(category.id);
  const guides = ctx.guidesForCategory(category.id);
  const partner = ctx.site.categoryPartners[category.id];
  const related = group.categories.filter((c) => c.id !== category.id);

  // ---------------------------------------------------------------- "at a glance": picks by situation, from data only
  const link = (v) => html`<a href="${ctx.url.software(v.id)}">${v.name}</a>`;
  const topScore = scoredList[0] ? ctx.fit(category.id, scoredList[0].id).score : null;
  const glance = [
    scoredList.length && {
      label: 'Highest documented fit',
      value: s.recommended.length > 1 ? `${s.recommended.length} products tie` : link(scoredList[0]),
      sub: s.recommended.length > 1 ? `at ${topScore}/100: ${s.recommended.slice(0, 3).map((v) => v.name).join(', ')}${s.recommended.length > 3 ? '…' : ''}` : `${topScore}/100`,
    },
    pf.min && {
      label: 'Lowest verified starting price',
      value: pf.minGroup.length === 1 ? link(pf.min.v) : pf.minGroup.length <= 2 ? ui.join(pf.minGroup.map((x) => link(x.v)), ', ') : `${pf.minGroup.length} products`,
      sub: pf.minGroup.every((x) => x.p.phrase === pf.min.p.phrase) ? A.pricePhrase(pf.min.p) : `${pf.min.p.headline} each; units differ`,
    },
    { label: 'Scored so far', value: `${nScored} of ${s.total}`, sub: s.pending ? `${s.pending} pending under the 80% evidence gate` : 'every product has a published score' },
    { label: 'Native AI or AI agents', value: `${nAi} of ${s.total}`, sub: 'documented in official sources' },
  ];

  // ---------------------------------------------------------------- page head
  // The first screen leads to the ranking: on phones the trust strip keeps the date and the method link on one line
  // (the counts and the desk-research note are in the answer and under the table) and the answer shows three lines
  // with a "Show the full answer" disclosure; every word stays in the HTML. On wide screens the trust strip becomes
  // a column beside the answer (category.css). The head is one opaque block (.cat-top): the section menu after it
  // waits underneath and only comes into view, sticky, as the head scrolls away. The title, the buyer's question and
  // the evidence line break where their text says, not where the font does (see "line breaks in the page head").
  const h1 = `${noun}: ${s.total} tools compared`;
  // the evidence line's words, as ui.trustline prints them below (wide screens show every item)
  const trustText = [`Evidence checked ${ctx.fmtDate(ctx.catalog.checkedAt)}`, `${nScored} scored · ${s.pending} pending`, 'Desk research, not hands-on testing', 'How we score'];
  const head = html`<div class="cat-top">
    <header class="wrap page-head page-head--wide cat-head">
      <p class="eyebrow"><a href="/categories/#${group.id}">${group.label}</a></p>
      <h1 class="cat-fitline" style="${fitStyle(h1, 'title')}">${h1}</h1>
      ${category.buyerQuestion ? html`<p class="lede cat-fitline" style="${fitStyle(category.buyerQuestion, 'body')}">${category.buyerQuestion}</p>` : ''}
      <div class="cat-sum" style="${fitItems(trustText, 2)}">
        ${ui.trustline(
          [
            html`Evidence checked ${ui.time(ctx, ctx.catalog.checkedAt)}`,
            { more: `${nScored} scored · ${s.pending} pending` },
            { more: 'Desk research, not hands-on testing' },
            html`<a href="/methodology/">How we score</a>`,
          ],
          { compact: true },
        )}
        ${ui.answer(ctx, quick, { more: true })}
      </div>
    </header>
  </div>`;

  const nav = ui.subnav(
    [
      { href: '#products', label: unscored ? 'Products' : 'Ranking' },
      { href: '#features', label: 'Capabilities' },
      { href: '#costs', label: 'Costs' },
      { href: '#buying-guide', label: 'How to choose' },
      category.demoQuestions?.length && { href: '#demo', label: 'Demo questions' },
      { href: '#faq', label: 'FAQ' },
      vsPages.length && { href: '#comparisons', label: 'Comparisons' },
    ].filter(Boolean),
  );

  // ---------------------------------------------------------------- ranking table + filters
  const mustGroups = GROUP_ORDER.map((gid) => ({ gid, label: groupMeta[gid].label, items: features.filter((f) => f.group === gid) })).filter((g) => g.items.length);
  // The filters, the live count, then the sort and the score help: the order on screen and for the keyboard. Two rows
  // at every width (category.css lays them out as a grid, so no line break depends on the width of a text, which
  // changes a little when the web font replaces its fallback): the filters on top; under them the count on the left
  // and the sort with the help at the right end (from 75em the sort and the help end the filter row and the count is
  // the line right above the table). The sort is a native <select> laid over a chip-sized face; every option's short
  // label sits in the face, one shown at a time (js/table.js), so the face is always as wide as its widest label and
  // a new order never moves it. Phones show "Sort" only. A filter that would match nothing is not offered. The
  // must-have panel takes focus itself (tabindex -1, as in ui.scoreHelp), so a press on its text does not move focus
  // out and close it mid-press.
  const sortOptions = [
    unscored ? { v: 'cov', label: 'Sort: share checked', short: 'share checked' } : { v: 'score', label: 'Sort: score', short: 'score' },
    { v: 'price', label: 'Sort: price, low to high', short: 'lowest price' },
    { v: 'name', label: 'Sort: name A–Z', short: 'name A–Z' },
  ];
  const controls = html`<div class="toolbar cat-toolbar" data-table-controls="products"${attrs({ 'data-sort-default': unscored ? 'cov' : null })} data-nosnippet>
    <div class="cat-chips"><div class="chips" role="group" aria-label="Filter products">
      ${nScored ? html`<button type="button" class="chip" data-filter="scored" aria-pressed="false">Scored only <span class="n">${nScored}</span></button>` : ''}
      ${nPriced ? html`<button type="button" class="chip" data-filter="priced" aria-pressed="false">Public price <span class="n">${nPriced}</span></button>` : ''}
      ${nAi ? html`<button type="button" class="chip" data-filter="ai" aria-pressed="false">Native AI or agents <span class="n">${nAi}</span></button>` : ''}
      <details class="pop mustpop" data-pop>
        <summary class="chip">${ui.icon('filter')} Must-have capabilities <span class="n" data-must-count hidden></span></summary>
        <div class="pop__panel mustpop__panel" role="group" aria-labelledby="must-h" tabindex="-1">
          <div class="mustpop__body">
            <p class="pop__title mustpop__title" id="must-h">Must-have capabilities</p>
            <p class="fineprint">Show only products where the capability is fully documented. Filters change what you see, never the published score.</p>
            ${mustGroups.map(
              (g) => html`<fieldset>
                <legend>${g.label}</legend>
                ${g.items.map(
                  (f) => html`<label class="check"><input type="checkbox" data-must="${f.i}"${raw(yesCount[f.i] ? '' : ' disabled')}><span>${f.label}</span><span class="n">${yesCount[f.i]}</span></label>`,
                )}
              </fieldset>`,
            )}
          </div>
          <div class="mustpop__foot">
            <p class="mustpop__n"><b data-must-n>${s.total}</b> of ${s.total} match</p>
            <button type="button" class="btn btn--sm" data-must-done>Done</button>
          </div>
        </div>
      </details>
      <button type="button" class="chip chip--link" data-filter-reset hidden>Clear filters</button>
    </div></div>
    <p class="toolbar__count" role="status" aria-live="polite" data-count data-total="${s.total}"><b>${s.total}</b> ${things}</p>
    <div class="cat-toolbar__end">
      <label class="${cx('cat-sort', unscored && 'cat-sort--cov')}"><span class="cat-sort__face" aria-hidden="true">Sort<span class="cat-sort__v">: <span class="cat-sort__faces" data-sort-face>${sortOptions.map(
        (o, i) => html`<b data-face="${o.v}"${attrs({ class: i ? null : 'is-on' })}>${o.short}</b>`,
      )}</span></span></span>
        <select class="cat-sort__select" data-sort-select aria-label="Sort products">
          ${sortOptions.map((o) => html`<option value="${o.v}" data-short="${o.short}">${o.label}</option>`)}
        </select>
      </label>
      ${ui.scoreHelp(ctx, { align: 'right' })}
    </div>
  </div>`;

  // with nothing scored the script lists the rows by the share checked (js/table.js "cov": share, then listing order),
  // so the logos that load eagerly are those of the first rows in THAT order
  const covOrder = unscored
    ? [...ranked].sort((a, b) => ctx.score(category.id, b.id).coveragePct - ctx.score(category.id, a.id).coveragePct || ctx.score(category.id, a.id).rank - ctx.score(category.id, b.id).rank)
    : null;
  const table = ui.productTable(
    ctx,
    category.id,
    ranked.map((vendor) => ({ vendor })),
    // every price carries the date it was read (the source link is on the profile's pricing section);
    // with nothing scored there is no place to show and no score column to sort by
    {
      featureIndex: yesIndex,
      priceChecked: true,
      rank: !unscored,
      sortable: !unscored,
      eagerIds: covOrder ? new Set(covOrder.slice(0, 4).map((v) => v.id)) : null,
      caption: unscored ? `${category.name}: ${s.total} products, all score-pending` : `${category.name}: ${s.total} products ranked by documented-fit score`,
    },
  );

  // the "at a glance" figures follow the ranking (the answer above already names the leader and the pending count).
  // The section heading is for screen readers and the outline: on screen the count line, the section menu ("Ranking",
  // once it is in view) and the table header already label it, so the filters follow the answer directly.
  const products = html`<section class="wrap cat-products" aria-labelledby="products-h">
    <h2 id="products-h" class="sr-only">${unscored ? things[0].toUpperCase() + things.slice(1) : `${category.name} ranking`}</h2>
    ${controls}
    ${table}
    <p class="empty" data-empty hidden><b>No product matches these filters.</b>Unverified support does not mean a product lacks a feature. <button type="button" class="btn btn--quiet btn--sm" data-filter-reset>Clear filters</button></p>
    ${ui.tableNote(ctx)}
    <div class="cat-glance">${ui.facts(glance)}</div>
  </section>`;

  // ---------------------------------------------------------------- capability matrix
  const ST_CODE = { yes: 'yes', partial: 'partial', no: 'no', unknown: 'unknown' };
  const cell = (vendor, f) => {
    const st = ctx.fit(category.id, vendor.id).rows[f.i].effectiveStatus;
    return html`<td><button type="button" class="cellbtn st st--${ST_CODE[st] || 'unknown'} st--icon" data-c="${f.i}"><span>${ui.STATUS_LABELS[st]}</span></button></td>`;
  };
  // Only the checks that count toward the score are in the HTML; the "not scored yet" deep checks
  // are added on demand from /data/cat-<id>.js (they are fully listed on every product profile).
  const matrixRows = (list) =>
    list.map(
      (f) => html`<tr data-f="${f.i}">
        <th scope="row"><button type="button" class="matrix__what" data-what="${f.i}" aria-haspopup="dialog" aria-expanded="false">${f.label}</button></th>
        ${ranked.map((v) => cell(v, f))}
      </tr>`,
    );
  const matrix = html`<section class="wrap section cat-matrix" id="features" aria-labelledby="features-h">
    <div class="section-head">
      <div>
        <h2 id="features-h">Which capabilities are documented?</h2>
        <p>${activeCount} checks count toward the score today. Select a check to see what it covers, or a mark to see the evidence note, its date and the official source.</p>
      </div>
    </div>
    <div class="toolbar" data-nosnippet>
      ${ui.statusLegend()}
      <div class="chips">
        <button type="button" class="chip" data-matrix-picked aria-pressed="false" hidden>Only my shortlist</button>
        ${features.length > activeCount ? html`<button type="button" class="chip" data-matrix-all aria-pressed="false">Show ${features.length - activeCount} inactive deep checks</button>` : ''}
      </div>
    </div>
    <div class="scroller" id="feature-evidence">
      <table class="dtable matrix" data-matrix data-category="${category.id}">
        <caption class="sr-only">${category.name}: documented capability status per product</caption>
        <thead>
          <tr>
            <th scope="col">Capability</th>
            ${ranked.map((v) => html`<th scope="col" data-v="${v.id}"><a href="${ctx.url.software(v.id)}">${ui.logo(ctx, v, { size: 'sm' })}<span>${v.name}</span></a></th>`)}
          </tr>
        </thead>
        <tbody>
          ${GROUP_ORDER.map((gid) => {
            const items = features.filter((f) => f.group === gid && f.active);
            if (!items.length) return '';
            return html`<tr class="is-group" data-g="${gid}"><th scope="colgroup" colspan="${ranked.length + 1}">${groupMeta[gid].label}</th></tr>${matrixRows(items)}`;
          })}
        </tbody>
      </table>
    </div>
    ${features.length > activeCount ? html`<p class="table-note">${ctx.scoring.LABELS.inactiveCheck.replace('this deep check has', `${features.length - activeCount} deep checks have`)} They stay listed so you can see what is already documented.</p>` : ''}
  </section>`;

  // ---------------------------------------------------------------- costs
  // the five lowest, extended so products that share the fifth amount are not cut apart
  let cheapestEnd = Math.min(5, pf.priced.length);
  while (cheapestEnd < pf.priced.length && cheapestEnd < 8 && pf.priced[cheapestEnd].p.amount === pf.priced[cheapestEnd - 1].p.amount) cheapestEnd++;
  const cheapest = pf.priced.slice(0, cheapestEnd);
  // "<strong>$0 per workspace</strong> (Agile CRM and EngageBay)": every product that shares an amount is named
  const priceGroup = (g) =>
    g.every((x) => x.p.phrase === g[0].p.phrase)
      ? html`<strong>${A.pricePhrase(g[0].p)}</strong> (${ctx.listText(g.map((x) => x.v.name))})`
      : ui.join(g.map((x) => html`<strong>${A.pricePhrase(x.p)}</strong> (${x.v.name})`), ' and ');
  const costs = html`<section class="wrap section" id="costs" aria-labelledby="costs-h">
    ${ui.sectionHead(`How much does ${noun} cost?`, { id: 'costs-h' })}
    <div class="cat-two">
      <div class="prose">
        ${
          pf.priced.length >= 2
            ? html`<p>Among the ${pf.priced.length} ${things} with a verified public starting price, list prices range from ${priceGroup(pf.minGroup)} to ${priceGroup(pf.maxGroup)}. ${
                pf.unpriced ? `${ctx.plural(pf.unpriced, 'product')} ${pf.unpriced === 1 ? 'is' : 'are'} quote-only, usage-based or without a verified public price.` : ''
              } Units differ between vendors, so compare a full quote for the same team size.</p>`
            : html`<p>Most ${things} in this ranking do not publish a verified starting price for US buyers. Ask each vendor to quote the same scope, term and team size.</p>`
        }
        ${category.costDrivers?.length ? html`<h3>What drives the total cost</h3>${ui.ticks(category.costDrivers, 'dots')}` : ''}
        <p><a class="link-arrow" href="/tools/cost/?scope=${category.id}">Model your own costs in the calculator</a></p>
      </div>
      ${
        cheapest.length
          ? html`<div>
              <table class="dtable">
                <caption class="sr-only">Lowest verified public starting prices in ${category.name}</caption>
                <thead><tr><th scope="col">Lowest verified starting prices</th><th scope="col" class="num">From</th></tr></thead>
                <tbody>
                  ${cheapest.map(
                    ({ v, p }) => html`<tr><th scope="row"><a href="${ctx.url.software(v.id)}#pricing">${v.name}</a> <small>${[ctx.dropNamePrefix(v.name, p.planLabel), p.unit, p.billingNote].filter(Boolean).join(' · ')}</small></th><td class="num">${p.headline}</td></tr>`,
                  )}
                </tbody>
              </table>
              <p class="table-note">Public list prices as observed on the dates shown on each profile. Not quotes: tax treatment is not documented and add-ons are not included.</p>
            </div>`
          : ''
      }
    </div>
  </section>`;

  // ---------------------------------------------------------------- buying guide
  const guide = html`<section class="wrap section" id="buying-guide" aria-labelledby="guide-h">
    ${ui.sectionHead(`How to choose ${noun}`, { id: 'guide-h' })}
    <div class="cat-two">
      <div class="prose">
        ${category.intro ? String(category.intro).split(/\n\s*\n/).map((p) => html`<p>${p}</p>`) : ''}
        ${(category.buyingAdvice || []).map((b) => (typeof b === 'string' ? html`<p>${b}</p>` : html`<h3>${b.title}</h3><p>${b.body}</p>`))}
      </div>
      <div class="cat-aside">
        ${
          category.criteria?.length
            ? html`<h3>What to compare</h3>
                <ul class="cat-criteria">${category.criteria.map((c) => html`<li><b>${c.label}</b>${c.why ? html`<span>${c.why}</span>` : ''}</li>`)}</ul>`
            : ''
        }
        ${category.pitfalls?.length ? html`<h3>Common pitfalls</h3>${ui.ticks(category.pitfalls, 'crosses')}` : ''}
      </div>
    </div>
  </section>`;

  const demo = category.demoQuestions?.length
    ? html`<section class="wrap section" id="demo" aria-labelledby="demo-h">
        ${ui.sectionHead('Questions to ask in a demo', { id: 'demo-h', sub: 'Tasks to run with each vendor on your own data. We did not perform these tests.' })}
        <ol class="steps cat-demo">${category.demoQuestions.map((q) => html`<li>${q}</li>`)}</ol>
      </section>`
    : '';

  // ---------------------------------------------------------------- what the score measures
  const sampleScore = scoredList[0] ? ctx.score(category.id, scoredList[0].id) : ranked[0] ? ctx.score(category.id, ranked[0].id) : null;
  const activeGroups = sampleScore ? sampleScore.groups.filter((g) => g.totalCount > 0) : [];
  const pt = ctx.scoring.pointText;
  const criteria = html`<section class="wrap section" id="criteria" aria-labelledby="criteria-h">
    ${ui.sectionHead('What the score measures', { id: 'criteria-h', link: { href: '/methodology/', label: 'Full method' } })}
    <div class="cat-two">
      <div class="prose">
        <p>${ui.methodSentence(ctx)}</p>
        <p>In ${category.name}, ${activeCount} of ${features.length} checklist items are scored today${features.length > activeCount ? `; the other ${features.length - activeCount} are deep checks that join the score once they have been checked for every listed product` : ''}. Every product that shares the highest published score is marked “Recommended”.</p>
      </div>
      <div>
        <table class="dtable cat-weights">
          <caption class="sr-only">Score groups and their weight in ${category.name}</caption>
          <thead><tr><th scope="col">Score group</th><th scope="col" class="num">Scored checks</th><th scope="col" class="num">Points</th></tr></thead>
          <tbody>
            ${activeGroups.map((g) => html`<tr><th scope="row">${g.label}</th><td class="num">${g.totalCount}</td><td class="num">${pt(g.weight)}</td></tr>`)}
          </tbody>
        </table>
        <p class="table-note">Published weights are core 45, integrations 20, local suitability 20 and AI 15. A group with no scored check is left out and the rest are scaled to 100.</p>
      </div>
    </div>
  </section>`;

  // ---------------------------------------------------------------- FAQ, comparisons, guides, sources, related
  const faq = html`<div class="wrap wrap--narrow section">${ui.faq(ctx, faqItems, { heading: `${category.name}: questions buyers ask` })}</div>`;

  const comparisons = vsPages.length
    ? html`<section class="wrap section cat-vs" id="comparisons" aria-labelledby="vs-h">
        ${ui.sectionHead(`${category.name} head-to-head comparisons`, { id: 'vs-h', link: { href: `/compare/?scope=${category.id}`, label: 'Compare any products' } })}
        ${ui.linkList(
          vsPages.map((x) => {
            const names = ctx.comparisonNames(x);
            const scores = names.map((n) => ctx.score(category.id, n.id)).filter(Boolean);
            return { href: ctx.url.vs(x.id), title: names.map((n) => n.name).join(' vs '), meta: scores.length === 2 ? scores.map((sc) => (sc.pending ? 'pending' : sc.value)).join(' vs ') : '' };
          }),
          { cols: 2 },
        )}
      </section>`
    : '';

  const guidesBlock = guides.length
    ? html`<section class="wrap section" aria-labelledby="guides-h">
        ${ui.sectionHead('Buying guides', { id: 'guides-h' })}
        ${ui.linkList(guides.map((g) => ({ href: ctx.url.guide(g.id), title: g.title, sub: g.description })), { cols: 1 })}
      </section>`
    : '';

  const partnerBlock = partner
    ? html`<aside class="wrap section--tight" data-partner-ad data-nosnippet aria-label="Advertisement">
        <p class="note"><span class="tag tag--ad">Ad · Partner link</span><span>${partner.name} is an advertising partner and is not one of the ranked products above. <a class="ext" href="${partner.url}" target="_blank" rel="sponsored nofollow noopener noreferrer" data-partner-link="${partner.name}">${partner.label}</a> We may earn a commission; it never changes a score.</span></p>
      </aside>`
    : '';

  const sourcesBlock = category.sources?.length
    ? html`<section class="wrap section" id="sources" aria-labelledby="sources-h">
        ${ui.sectionHead('Sources', { id: 'sources-h', sub: 'Category-level references. Each product profile lists its own official sources.' })}
        ${ui.sources(category.sources)}
      </section>`
    : '';

  const relatedBlock = related.length
    ? html`<section class="wrap section" aria-labelledby="related-h">
        ${ui.sectionHead(`More in ${group.label}`, { id: 'related-h', link: { href: '/categories/', label: 'All categories' } })}
        ${ui.chipLinks(related.map((c) => ({ href: ctx.url.category(c.id), label: c.name })))}
      </section>`
    : '';

  return {
    title,
    description,
    ogTitle: `${noun}: ${s.total} tools compared`,
    nav: 'categories',
    breadcrumbs: [
      { name: 'Categories', url: '/categories/' },
      { name: category.name, url: path },
    ],
    pageType: 'CollectionPage',
    dateModified: updated,
    accountable: true,
    faq: faqItems.map((f) => ({ q: f.q, a: text(f.a) })),
    jsonld: [
      ctx.seo.itemListNode(
        path,
        ranked.map((v) => ({ name: v.name, url: ctx.url.software(v.id) })),
        { name: `${category.name}: products ranked by documented-fit score` },
      ),
    ],
    pageExtra: { mainEntity: { '@id': `${ctx.abs(path)}#primary-list` }, about: { '@type': 'Thing', name: noun } },
    scripts: ['js/table.js'],
    body: html`${head}${nav}${products}${matrix}${costs}${guide}${demo}${criteria}${faq}${comparisons}${guidesBlock}${partnerBlock}${sourcesBlock}${relatedBlock}`,
  };
}
