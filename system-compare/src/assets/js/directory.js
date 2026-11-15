/* System Compare — instant filters for the "find it" pages.
 *
 *   /categories/          type to narrow 66 categories (names, synonyms, product names)
 *   /software/            text + category + quick filters + sort, 50 rows at a time; legacy ?q= → /search/
 *   /comparisons/         text + category over the comparison library
 *   /alternatives/{id}/   quick filters + sort per category tab; ?scope={categoryId} selects the tab
 *
 * Everything the script shows is already in the HTML: it only hides, reveals and re-orders nodes (on
 * /software/, with a category chosen, it also prints a product's score in that category from data-s).
 * Filters never change a published score or rank. State lives in the URL so a view can be shared.
 * What is typed stays in the browser (it is not sent anywhere).
 */
(function () {
  'use strict';
  var d = document, w = window, SC = w.SC;
  if (!SC) return;
  var $ = SC.$, $$ = SC.$$, el = SC.el;
  var root = $('[data-ix]');
  if (!root) return;
  var kind = root.getAttribute('data-ix');
  var data = {};
  try { var pd = d.getElementById('page-data'); if (pd) data = JSON.parse(pd.textContent) || {}; } catch (e) { data = {}; }
  var SYN = data.syn || {};
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // ------------------------------------------------------------------ text matching
  var MARKS = /[̀-ͯ]/g;
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFKD').replace(MARKS, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  /** Searchable text: words, plus the same text with hyphens and dots removed ("e-signature" also matches "esignature"). */
  function hayOf(parts) {
    var raw = parts.join(' | ');
    return ' ' + norm(raw) + ' ' + norm(raw.replace(/[-.'’]/g, '')) + ' ';
  }
  /** At most 120 characters and 20 words, as on the rest of the site. */
  var STOP = { a: 1, an: 1, and: 1, 'for': 1, 'in': 1, of: 1, or: 1, the: 1, to: 1, 'with': 1 };
  function tokens(q) {
    var n = norm(String(q || '').slice(0, 120));
    if (!n) return [];
    var all = n.split(' ').slice(0, 20), words = all.filter(function (t) { return !STOP[t]; });
    return words.length ? words : all; // "payroll for restaurants" looks for payroll + restaurants
  }
  /**
   * A word of four letters or more may match anywhere ("force" finds Salesforce). A shorter one must start a
   * word, so "ai" is not found inside "email", "erp" inside "enterprise" or "hr" inside "through".
   */
  function hit(hay, tok) {
    if (tok.length < 4) return hay.indexOf(' ' + tok) >= 0;
    return hay.indexOf(tok) >= 0 || (tok.charAt(tok.length - 1) === 's' && hay.indexOf(tok.slice(0, -1)) >= 0);
  }
  /** One typing slip apart: one letter added, dropped or replaced, or two neighbours swapped. */
  function near(a, b) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    while (i < la && i < lb && a.charAt(i) === b.charAt(i)) i++;
    if (la === lb) {
      if (i === la) return true;
      if (a.slice(i + 1) === b.slice(i + 1)) return true;
      return a.charAt(i) === b.charAt(i + 1) && a.charAt(i + 1) === b.charAt(i) && a.slice(i + 2) === b.slice(i + 2);
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  /** "Similar spelling": only for words of five letters or more, against the start of each word in the row. */
  function fuzzyHit(row, tok) {
    if (tok.length < 5) return false;
    if (!row.words) row.words = row.hay.split(' ').filter(function (w, i, all) { return w.length >= 4 && all.indexOf(w) === i; });
    for (var i = 0; i < row.words.length; i++) {
      var w = row.words[i];
      if (near(w, tok) || (w.length > tok.length + 1 && (near(w.slice(0, tok.length), tok) || near(w.slice(0, tok.length + 1), tok)))) return true;
    }
    return false;
  }
  /** Every word must be found in the row; with `fuzzy`, a similar spelling also counts. */
  function matches(row, toks, fuzzy) {
    for (var i = 0; i < toks.length; i++) if (!hit(row.hay, toks[i]) && !(fuzzy && fuzzyHit(row, toks[i]))) return false;
    return true;
  }
  /** Use similar spellings only when nothing matches as typed. `pass(row)` = the row passes the other filters. */
  function needFuzzy(lists, toks, pass) {
    if (!toks.length) return false;
    for (var l = 0; l < lists.length; l++) for (var i = 0; i < lists[l].length; i++) if ((!pass || pass(lists[l][i])) && matches(lists[l][i], toks, false)) return false;
    return true;
  }
  var SIMILAR = ' · nothing matches as typed, showing similar spellings', RELATED = ' · including related terms';
  /** True when a word was found only through a synonym or alias, not in what the row shows. */
  function viaRelated(row, toks) {
    for (var i = 0; i < toks.length; i++) if (!hit(row.vis, toks[i])) return true;
    return false;
  }

  // ------------------------------------------------------------------ URL state + small UI helpers
  function params() { return new URLSearchParams(location.search); }
  function writeParams(set) {
    var q = params(), k;
    for (k in set) { if (set[k]) q.set(k, set[k]); else q.delete(k); }
    var s = q.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) { /* file:// */ }
  }
  function setCount(node, shown, total, filtered, tail) {
    if (!node) return;
    var noun = node.getAttribute('data-noun') || 'results';
    node.textContent = '';
    node.appendChild(el('b', { text: filtered ? shown + ' of ' + total : String(total) }));
    node.appendChild(d.createTextNode(' ' + noun + (tail || '')));
  }
  function setEmpty(box, isEmpty, query, message) {
    if (!box) return;
    box.hidden = !isEmpty;
    var link = $('[data-ix-sitesearch]', box), txt = $('[data-ix-empty-text]', box);
    if (link) { link.hidden = !query; if (query) link.setAttribute('href', SC.url('/search/?q=' + encodeURIComponent(query))); }
    if (txt && message) txt.textContent = message;
  }
  function selectValue(sel, value) {
    if (!sel || !value || !SLUG.test(value)) return '';
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === value) { sel.value = value; return value; }
    return '';
  }
  /** Hide the jump-row entry of a group that has no visible row. */
  function syncJumpRow(groups) {
    var links = $$('[data-subnav] a[href^="#"]');
    links.forEach(function (a) {
      var g = d.getElementById(a.getAttribute('href').slice(1));
      if (g && groups.indexOf(g) >= 0) a.parentNode.hidden = g.hidden;
    });
  }

  // ------------------------------------------------------------------ /categories/
  function initCategories() {
    var input = $('[data-ix-find]'), count = $('[data-ix-count]'), empty = $('[data-ix-empty]', root);
    var groups = $$('[data-ix-group]', root);
    var products = data.products || {};
    var rows = $$('[data-ix-row]', root).map(function (li) {
      var id = li.getAttribute('data-id') || '';
      var terms = [];
      (SYN[id] || '').split('|').forEach(function (t) { if (t) terms.push({ t: t, kind: 'Related term: ', hay: hayOf([t]) }); });
      (products[id] || '').split('|').forEach(function (t) { if (t) terms.push({ t: t, kind: 'Includes ', hay: hayOf([t]) }); });
      var visible = hayOf([li.textContent, id.replace(/-/g, ' ')]);
      return { node: li, group: li.closest('[data-ix-group]'), vis: visible, terms: terms, hay: visible + terms.map(function (x) { return x.hay; }).join(' ') };
    });
    function why(r, toks) {
      for (var i = 0; i < toks.length; i++) {
        if (hit(r.vis, toks[i])) continue;
        for (var j = 0; j < r.terms.length; j++) if (hit(r.terms[j].hay, toks[i])) return r.terms[j].kind + r.terms[j].t;
      }
      return '';
    }
    function apply(push) {
      var toks = tokens(input.value), shown = 0, fuzzy = needFuzzy([rows], toks);
      rows.forEach(function (r) {
        var ok = matches(r, toks, fuzzy);
        r.node.hidden = !ok;
        if (ok) shown++;
        var old = $('.ix-why', r.node); if (old) old.remove();
        if (ok && toks.length) {
          var reason = fuzzy ? 'Similar spelling' : why(r, toks), slot = $('a > span', r.node);
          if (reason && slot) slot.appendChild(el('small.ix-why', { text: reason }));
        }
      });
      groups.forEach(function (g) { g.hidden = !$('[data-ix-row]:not([hidden])', g); });
      syncJumpRow(groups);
      setCount(count, shown, rows.length, toks.length > 0, fuzzy && shown ? SIMILAR : '');
      setEmpty(empty, shown === 0, input.value.trim());
      if (push !== false) writeParams({ find: input.value.trim() });
    }
    input.value = (params().get('find') || '').slice(0, 120);
    input.addEventListener('input', function () { apply(); });
    root.addEventListener('click', function (e) { if (e.target.closest('[data-ix-reset]')) { input.value = ''; apply(); input.focus(); } });
    if (input.value) apply(false);
  }

  // ------------------------------------------------------------------ /comparisons/
  function initComparisons() {
    var input = $('[data-ix-find]'), sel = $('[data-ix-category]'), count = $('[data-ix-count]'), empty = $('[data-ix-empty]', root);
    var groups = $$('[data-ix-group]', root), blocks = $$('[data-ix-cat]', root);
    var rows = $$('[data-ix-row]', root).map(function (li) {
      var block = li.closest('[data-ix-cat]'), cat = block.getAttribute('data-ix-cat'), h = $('h3', block);
      var shown = [li.textContent, h ? h.textContent : ''];
      return { node: li, cat: cat, vis: hayOf(shown), hay: hayOf(shown.concat([cat.replace(/-/g, ' '), SYN[cat] || '', li.getAttribute('data-k') || ''])) };
    });
    function apply(push) {
      var toks = tokens(input.value), cat = sel.value, shown = 0;
      var inCat = function (r) { return !cat || r.cat === cat; }, fuzzy = needFuzzy([rows], toks, inCat), related = false;
      rows.forEach(function (r) {
        var ok = inCat(r) && matches(r, toks, fuzzy);
        r.node.hidden = !ok;
        if (ok) { shown++; if (!fuzzy && !related && viaRelated(r, toks)) related = true; }
      });
      blocks.forEach(function (b) { b.hidden = !$('[data-ix-row]:not([hidden])', b); });
      groups.forEach(function (g) { g.hidden = !$('[data-ix-row]:not([hidden])', g); });
      syncJumpRow(groups);
      setCount(count, shown, rows.length, toks.length > 0 || !!cat, fuzzy && shown ? SIMILAR : related ? RELATED : '');
      setEmpty(empty, shown === 0, input.value.trim(), 'Try a shorter word, clear the filter, or build the comparison yourself in the compare tool.');
      if (push !== false) writeParams({ find: input.value.trim(), category: cat });
    }
    var q = params();
    input.value = (q.get('find') || '').slice(0, 120);
    selectValue(sel, q.get('category'));
    input.addEventListener('input', function () { apply(); });
    sel.addEventListener('change', function () { apply(); });
    root.addEventListener('click', function (e) { if (e.target.closest('[data-ix-reset]')) { input.value = ''; sel.value = ''; apply(); input.focus(); } });
    if (input.value || sel.value) apply(false);
  }

  // ------------------------------------------------------------------ /software/
  function initSoftware() {
    var q = params();
    // The old header and directory forms submitted /software/?q=…; site search answers that now.
    var legacy = (q.get('q') || '').trim().slice(0, 120);
    if (legacy) { location.replace(SC.url('/search/?q=' + encodeURIComponent(legacy))); return; }

    var input = $('[data-ix-find]'), sel = $('[data-ix-category]'), sortSel = $('[data-ix-sort]', root), count = $('[data-ix-count]', root);
    var empty = $('[data-ix-empty]', root), more = $('[data-ix-more]', root), legacyChip = $('[data-ix-ai-legacy]', root);
    var table = $('[data-ix-table]', root), tbody = $('tbody', table);
    var PAGE = Number(table.getAttribute('data-page-size')) || 50;
    /** Category ids of a row, read from its own links (/categories/{id}/ or /categories/{id}/#supplier-…). */
    function catsOf(node) {
      var out = [];
      $$('a[href*="categories/"]', node).forEach(function (a) {
        var m = /categories\/([a-z0-9-]+)\//.exec(a.getAttribute('href'));
        if (m && out.indexOf(m[1]) < 0) out.push(m[1]);
      });
      return out;
    }
    var text = function (sel, node) { var n = $(sel, node); return n ? n.textContent : ''; };
    var rows = $$('tr', tbody).map(function (tr, i) {
      var cats = catsOf(tr), link = $('a.prod', tr), idm = link ? /([a-z0-9-]+)\/(?:index\.html)?$/.exec(link.getAttribute('href')) : null;
      // what a product is — name, description, categories, aliases — not its score, price or AI label
      // (every row says "AI", "month" or "pending" somewhere; the quick filters cover those)
      var seen = [text('.prod__name', tr), text('.prod__fit', tr), text('.ix-c-cats', tr)];
      var parts = seen.concat([tr.getAttribute('data-k') || '', idm ? idm[1].replace(/-/g, ' ') : '']);
      cats.forEach(function (c) { parts.push(SYN[c] || ''); });
      var price = tr.getAttribute('data-price'), score = Number(tr.getAttribute('data-score'));
      // a product in several categories carries its score in each one: "crm:-1|project-management:92"
      var byCat = null, cell = $('.ptable__c-score', tr);
      (tr.getAttribute('data-s') || '').split('|').forEach(function (pair) {
        var at = pair.lastIndexOf(':');
        if (at > 0) { byCat = byCat || {}; byCat[pair.slice(0, at)] = Number(pair.slice(at + 1)); }
      });
      return { node: tr, i: i, score: score, cur: score, byCat: byCat, cell: cell, orig: null, shown: '', price: price === '' ? null : Number(price), priced: tr.hasAttribute('data-priced'), ai: tr.getAttribute('data-ai'), cats: cats, vis: hayOf(seen), hay: hayOf(parts) };
    });
    var scoreHead = $('thead .ptable__c-score', table), scoreHeadText = scoreHead ? scoreHead.textContent : '';
    function categoryLabel() {
      var opt = sel.options[sel.selectedIndex];
      return opt && opt.value ? opt.textContent.replace(/\s*\(\d+\)\s*$/, '') : '';
    }
    /**
     * With a category chosen, a product that is scored in several categories shows its published score in
     * THAT category (not its best one elsewhere), and the Scored filter and the score sort use it too.
     */
    function showScores(cat, label) {
      rows.forEach(function (r) {
        // rows without data-s have one scored category and nothing else: their cell is always right
        var listed = !!(cat && r.byCat && r.cats.indexOf(cat) >= 0);
        var own = listed && Object.prototype.hasOwnProperty.call(r.byCat, cat);
        r.cur = own ? r.byCat[cat] : listed ? -1 : r.score;
        var want = listed ? cat : '';
        if (r.shown === want || !r.cell) return;
        if (!r.orig) r.orig = Array.prototype.slice.call(r.cell.childNodes);
        while (r.cell.firstChild) r.cell.removeChild(r.cell.firstChild);
        if (own) {
          var where = el('span.score__meta.ix-in', { text: 'in ' + label });
          r.cell.appendChild(r.cur < 0
            ? el('span.score.score--pending', null, [el('span.score__value', { text: 'Score pending' }), where])
            : el('span.score', null, [el('span.score__value.num', null, [String(r.cur), el('small', { text: '/100' })]), where]));
        } else if (listed) {
          // a documented comparison (named plans, dated sources) assigns no score
          r.cell.appendChild(el('span.score.score--pending', null, [el('span.score__value', { text: 'No score' }), el('span.score__meta.ix-in', { text: 'documented comparison' })]));
        } else r.orig.forEach(function (n) { r.cell.appendChild(n); });
        r.shown = want;
      });
      if (scoreHead) scoreHead.textContent = cat ? 'Score' : scoreHeadText;
    }
    var supBox = $('[data-ix-suppliers]'), supMore = supBox && $('[data-ix-sup-more]', supBox), supEmpty = supBox && $('[data-ix-sup-empty]', supBox);
    var SUP = supBox ? Number(supBox.getAttribute('data-shown')) || 12 : 0;
    var supRows = supBox ? $$('[data-ix-row]', supBox).map(function (li) {
      var cat = catsOf(li)[0] || '';
      return { node: li, cat: cat, hay: hayOf([li.textContent, cat.replace(/-/g, ' '), SYN[cat] || '']) };
    }) : [];

    var catLink = $('[data-ix-catlink]', root);
    var state = { find: '', category: '', f: {}, ai: '', sort: 'name', n: PAGE, supAll: false }, lastOrder = 'name|';
    var AI_LEGACY = { documented: 'AI documented', 'not-verified': 'AI not verified' };

    /** Everything except the text: category, quick filters, AI level. */
    function pass(r) {
      if (state.category && r.cats.indexOf(state.category) < 0) return false;
      if (state.f.scored && r.cur < 0) return false;
      if (state.f.priced && !r.priced) return false;
      if (state.ai === 'native' && r.ai !== 'native' && r.ai !== 'agent') return false;
      if (state.ai === 'documented' && r.ai === 'not-verified') return false;
      if (state.ai === 'not-verified' && r.ai !== 'not-verified') return false;
      return true;
    }
    function supPass(r) { return !state.category || r.cat === state.category; }
    function cmp(a, b) {
      if (state.sort === 'score') return b.cur - a.cur || a.i - b.i;
      if (state.sort === 'price') {
        if (a.price === null && b.price === null) return a.i - b.i;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price || a.i - b.i;
      }
      return a.i - b.i;
    }
    function apply(push) {
      if (sel.value !== state.category) sel.value = state.category;
      var toks = tokens(state.find), order = rows, label = categoryLabel();
      showScores(state.category, label);
      // the score order depends on the chosen category
      var orderKey = state.sort + '|' + (state.sort === 'score' ? state.category : '');
      if (orderKey !== lastOrder) {
        order = rows.slice().sort(cmp);
        order.forEach(function (r) { tbody.appendChild(r.node); });
        rows = order; lastOrder = orderKey;
      }
      // similar spellings only when neither a product nor a documented supplier matches as typed
      var fuzzy = toks.length > 0 && needFuzzy([rows], toks, pass) && needFuzzy([supRows], toks, supPass);
      var m = 0, shown = 0, related = false;
      rows.forEach(function (r) {
        var good = pass(r) && matches(r, toks, fuzzy), vis = good && shown < state.n;
        if (good) { m++; if (!fuzzy && !related && viaRelated(r, toks)) related = true; }
        if (vis) shown++;
        r.node.hidden = !vis;
      });
      var filtered = toks.length > 0 || !!state.category || !!state.f.scored || !!state.f.priced || !!state.ai;
      setCount(count, m, rows.length, filtered, (fuzzy && m ? SIMILAR : related ? RELATED : '') + (state.sort === 'price' ? ' · sorted by starting price (products without a public US-dollar price last)' : state.sort === 'score' ? (state.category ? ' · sorted by score in ' + label : ' · sorted by best score') + ' (pending last)' : ''));
      table.hidden = m === 0;
      if (more) { more.hidden = m <= shown; more.textContent = 'Show ' + Math.min(PAGE, m - shown) + ' more (' + shown + ' of ' + m + ')'; }

      // documented suppliers follow the text and category filters only (they have no score, price or AI level here)
      var supFiltered = toks.length > 0 || !!state.category, sm = 0;
      supRows.forEach(function (r) {
        var good = supPass(r) && matches(r, toks, fuzzy);
        if (good) sm++;
        r.node.hidden = !good || (!supFiltered && !state.supAll && sm > SUP);
      });
      if (supMore) supMore.hidden = supFiltered || state.supAll || supRows.length <= SUP;
      if (supEmpty) supEmpty.hidden = sm > 0;

      setEmpty(empty, m === 0, state.find.trim(), sm > 0 ? sm + ' documented supplier' + (sm === 1 ? ' matches' : 's match') + ' — see the list below.' : 'Try a shorter word, or clear the category and quick filters.');

      // controls
      $$('[data-f]', root).forEach(function (b) {
        var k = b.getAttribute('data-f');
        b.setAttribute('aria-pressed', (k === 'ai' ? state.ai === 'native' : !!state.f[k]) ? 'true' : 'false');
      });
      if (legacyChip) { legacyChip.hidden = !AI_LEGACY[state.ai]; legacyChip.textContent = AI_LEGACY[state.ai] ? AI_LEGACY[state.ai] + ' ×' : ''; if (AI_LEGACY[state.ai]) legacyChip.setAttribute('aria-label', 'Remove filter: ' + AI_LEGACY[state.ai]); }
      $$('[data-ix-reset]', root).forEach(function (b) { if (!b.closest('[data-ix-empty]')) b.hidden = !filtered; });
      if (input.value !== state.find) input.value = state.find;
      sel.value = state.category; sortSel.value = state.sort;
      // a chosen category has its own page, where products are ranked on that category's checklist
      if (catLink) {
        catLink.hidden = !state.category;
        if (state.category) {
          catLink.setAttribute('href', SC.url('/categories/' + state.category + '/'));
          catLink.textContent = 'See the ' + label + ' comparison';
        }
      }
      if (push !== false) writeParams({ find: state.find.trim(), category: state.category, f: Object.keys(state.f).join(','), ai: state.ai, sort: state.sort === 'name' ? '' : state.sort });
    }

    // initial state from the URL (also the legacy ?category= and ?ai=documented|not-verified)
    state.find = (q.get('find') || '').slice(0, 120);
    state.category = selectValue(sel, q.get('category'));
    (q.get('f') || '').split(',').forEach(function (k) { if (k === 'scored' || k === 'priced') state.f[k] = 1; });
    var ai = q.get('ai'); if (ai === 'native' || ai === 'documented' || ai === 'not-verified') state.ai = ai;
    var so = q.get('sort'); if (so === 'score' || so === 'price') state.sort = so;

    input.addEventListener('input', function () { state.find = input.value; state.n = PAGE; apply(); });
    sel.addEventListener('change', function () { state.category = sel.value; state.n = PAGE; apply(); });
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; state.n = PAGE; apply(); });
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-f]');
      if (b && root.contains(b)) {
        var k = b.getAttribute('data-f');
        if (k === 'ai') state.ai = state.ai === 'native' ? '' : 'native';
        else if (state.f[k]) delete state.f[k]; else state.f[k] = 1;
        state.n = PAGE; apply(); return;
      }
      if (e.target.closest('[data-ix-ai-legacy]')) { state.ai = ''; state.n = PAGE; apply(); return; }
      if (e.target.closest('[data-ix-reset]')) { state.find = ''; state.category = ''; state.f = {}; state.ai = ''; state.n = PAGE; apply(); input.focus(); return; }
      if (e.target.closest('[data-ix-more]')) { state.n += PAGE; apply(false); return; }
      if (e.target.closest('[data-ix-sup-more]')) { state.supAll = true; apply(false); }
    });
    apply(false);
  }

  // ------------------------------------------------------------------ /alternatives/{id}/
  function initAlternatives() {
    var panels = $$('[data-ix-panel]', root).map(function (box) {
      var table = $('.ix-alts [data-ptable]', box), num = function (name) { var v = box.getAttribute(name); return v === '' || v == null ? null : Number(v); };
      return {
        box: box, scope: box.getAttribute('data-scope'), fscore: num('data-fscore'), fprice: num('data-fprice'),
        table: table, tbody: table ? $('tbody', table) : null, rows: table ? $$('tbody tr', table) : [],
        controls: $('[data-ix-controls]', box), count: $('[data-ix-count]', box), empty: $('[data-ix-empty]', box),
        state: { f: {}, sort: 'score' }
      };
    });
    var tabs = $$('[role="tab"][data-scope]', root), def = root.getAttribute('data-default');
    function active() {
      for (var i = 0; i < panels.length; i++) if (!panels[i].box.hidden) return panels[i];
      return panels[0];
    }
    function keep(P, tr) {
      if (tr.classList.contains('is-picked')) return true; // products already in the shortlist stay visible
      var s = Number(tr.getAttribute('data-score')), price = tr.getAttribute('data-price'), f = P.state.f;
      if (f.higher && !(P.fscore !== null && s > P.fscore)) return false;
      if (f.scored && s < 0) return false;
      if (f.cheaper && !(P.fprice !== null && price !== '' && Number(price) < P.fprice)) return false;
      if (f.priced && tr.getAttribute('data-pstate') !== 'amount') return false; // any public amount, any currency
      return true;
    }
    function rank(tr) { return Number(tr.getAttribute('data-rank')); }
    function apply(P, push) {
      if (!P.table) return;
      var shown = 0, st = P.state;
      P.rows.forEach(function (tr) { var good = keep(P, tr); tr.hidden = !good; if (good) shown++; });
      P.rows.slice().sort(function (a, b) {
        if (st.sort === 'name') return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
        if (st.sort === 'price') {
          var pa = a.getAttribute('data-price'), pb = b.getAttribute('data-price');
          if (pa === '' && pb === '') return rank(a) - rank(b);
          if (pa === '') return 1;
          if (pb === '') return -1;
          return Number(pa) - Number(pb) || rank(a) - rank(b);
        }
        return rank(a) - rank(b);
      }).forEach(function (tr) { P.tbody.appendChild(tr); });
      var filtered = Object.keys(st.f).length > 0;
      if (P.controls) {
        $$('[data-f]', P.controls).forEach(function (b) { b.setAttribute('aria-pressed', st.f[b.getAttribute('data-f')] ? 'true' : 'false'); });
        $$('[data-ix-reset]', P.controls).forEach(function (b) { b.hidden = !filtered; });
        var s = $('[data-ix-sort]', P.controls); if (s) s.value = st.sort;
      }
      setCount(P.count, shown, P.rows.length, filtered, st.sort === 'price' ? ' · sorted by starting price (products without a public price last)' : st.sort === 'name' ? ' · sorted by name' : '');
      if (P.empty) P.empty.hidden = shown > 0;
      P.table.hidden = shown === 0;
      if (push !== false) writeUrl();
    }
    function writeUrl() {
      var P = active();
      writeParams({ scope: P.scope === def ? '' : P.scope, f: Object.keys(P.state.f).join(','), sort: P.state.sort === 'score' ? '' : P.state.sort });
    }
    panels.forEach(function (P) {
      P.box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-f]');
        if (b) { var k = b.getAttribute('data-f'); if (P.state.f[k]) delete P.state.f[k]; else P.state.f[k] = 1; apply(P); return; }
        if (e.target.closest('[data-ix-reset]')) { P.state.f = {}; apply(P); }
      });
      P.box.addEventListener('change', function (e) { if (e.target.matches('[data-ix-sort]')) { P.state.sort = e.target.value; apply(P); } });
    });

    // ?scope={categoryId} selects that category's tab (the old site reloaded the page for this)
    var q = params(), scope = q.get('scope');
    if (scope && SLUG.test(scope)) tabs.forEach(function (t) { if (t.getAttribute('data-scope') === scope && t.getAttribute('aria-selected') !== 'true') t.click(); });
    var P0 = active();
    (q.get('f') || '').split(',').forEach(function (k) { if ((k === 'higher' || k === 'scored' || k === 'cheaper' || k === 'priced') && P0.controls && $('[data-f="' + k + '"]', P0.controls)) P0.state.f[k] = 1; });
    var so = q.get('sort'); if ((so === 'price' || so === 'name') && P0.controls) P0.state.sort = so;
    if (Object.keys(P0.state.f).length || P0.state.sort !== 'score') apply(P0, false);
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { setTimeout(writeUrl, 0); });
      t.addEventListener('keydown', function (e) {
        // the shared tabs handle the arrow keys; Home and End jump to the first and last category
        var to = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
        if (to) { e.preventDefault(); to.click(); to.focus(); }
        setTimeout(writeUrl, 0);
      });
    });
  }

  if (kind === 'categories') initCategories();
  else if (kind === 'comparisons') initComparisons();
  else if (kind === 'software') initSoftware();
  else if (kind === 'alternatives') initAlternatives();
})();
