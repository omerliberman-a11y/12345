/* System Compare — /search/ results page (uses the same engine and index as the header palette). */
(function () {
  'use strict';
  var d = document, SC = window.SC;
  if (!SC) return;
  var $ = SC.$, $$ = SC.$$, el = SC.el;
  var page = $('[data-search-page]');
  if (!page) return;
  var input = $('#search-q'), form = input && input.form;
  var results = $('[data-search-results]'), status = $('[data-search-status]'), start = $('[data-search-start]');
  var controls = $('[data-search-controls]'), facetsBox = $('[data-search-facets]'), typeChips = $('[data-type-chips]'), sortSel = $('[data-search-sort]');
  // the examples under the field ("Try a product …"): shown until there is a query, then the results come first
  var head = input && input.closest('.page-head'), hint = head && $('.fineprint', head);
  var TYPES = [['', 'All'], ['category', 'Categories'], ['product', 'Products'], ['comparison', 'Comparisons'], ['guide', 'Guides'], ['faq', 'Questions'], ['page', 'Pages']];
  var HEAD = { category: 'Categories', product: 'Products', comparison: 'Comparisons', guide: 'Buying guides', faq: 'Questions and answers', page: 'Pages' };
  var state = { q: '', type: '', sort: '', f: {} };
  var timer;

  // the previous site's limits: a query is read up to 120 characters and 20 words, and the page says so
  var limit = SC.searchLimit || { over: function () { return false; }, message: '' };
  function readUrl() {
    var p = new URLSearchParams(location.search);
    state.over = limit.over(p.get('q') || '');
    state.q = (p.get('q') || '').slice(0, 120);
    state.type = TYPES.some(function (t) { return t[0] === p.get('type'); }) ? p.get('type') : '';
    state.sort = p.get('sort') === 'score' || p.get('sort') === 'price' ? p.get('sort') : '';
    state.f = {};
    (p.get('f') || '').split(',').forEach(function (k) { if (k === 'scored' || k === 'priced' || k === 'free' || k === 'ai') state.f[k] = 1; });
  }
  function writeUrl(push) {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.type) p.set('type', state.type);
    if (state.sort) p.set('sort', state.sort);
    var f = Object.keys(state.f); if (f.length) p.set('f', f.join(','));
    var s = p.toString(), url = location.pathname + (s ? '?' + s : '');
    if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  }
  function productOk(r) {
    if (state.f.scored && r.best == null) return false;
    if (state.f.priced && r.amount == null) return false;
    if (state.f.free && !r.free) return false;
    if (state.f.ai && r.ai !== 'native' && r.ai !== 'agent') return false;
    return true;
  }
  function meta(r) {
    // a row into a section of a profile ("Attio pricing", "… score and evidence") has no id, score or profile flag of
    // its own: no label (it read "Documented supplier"); its second line already gives the price or what it opens
    if (r.type !== 'product' || !r.id) return '';
    var bits = [];
    bits.push(r.best != null ? r.best + '/100' : r.profile ? 'Score pending' : 'Documented supplier');
    if (r.amount != null && r.priceText) bits.push('from ' + r.priceText);
    return bits.join(' · ');
  }
  function row(r, extra) {
    var a = SC.search.hit(r, { meta: extra || meta(r) });
    a.removeAttribute('role');
    a.addEventListener('click', function () { SC.search.remember(state.q); });
    return el('li', null, [a]);
  }
  /** Type chips are updated in place (never rebuilt), so the chip that was just pressed keeps focus. */
  function syncChips(counts) {
    var have = {};
    $$('[data-type]', typeChips).forEach(function (b) { have[b.getAttribute('data-type')] = b; });
    var after = null;
    TYPES.forEach(function (t) {
      var n = counts[t[0]] || 0, b = have[t[0]];
      if (t[0] && !n) { if (b) b.remove(); return; }
      if (!b) b = el('button.chip', { type: 'button', 'data-type': t[0] }, [t[1] + ' ', el('span.n')]);
      $('.n', b).textContent = String(n);
      b.setAttribute('aria-pressed', state.type === t[0] ? 'true' : 'false');
      if (after ? after.nextSibling !== b : typeChips.firstChild !== b) typeChips.insertBefore(b, after ? after.nextSibling : typeChips.firstChild);
      after = b;
    });
  }
  var focusResults = false; // after "Show all …", focus moves to the first heading of the new list
  /** Phones: the result types and the product filters are rows that scroll sideways (search.css). The pressed type is
   *  kept in view (?type=guide opens with Guides visible), clear of the faded right edge (2rem) and the page margin. */
  function revealPressed(row) {
    var b = row && $('[aria-pressed="true"]', row);
    if (!b || row.scrollWidth <= row.clientWidth + 1) return;
    var r = row.getBoundingClientRect(), c = b.getBoundingClientRect(), rem = parseFloat(getComputedStyle(d.documentElement).fontSize) || 16;
    if (c.right > r.right - 2 * rem) row.scrollLeft += c.right - (r.right - 2 * rem);
    else if (c.left < r.left + rem) row.scrollLeft -= r.left + rem - c.left;
  }
  // a chip reached with the keyboard comes fully into view in its row, clear of the fade (the row's scroll padding), as
  // on category pages (table.js)
  [typeChips, facetsBox].forEach(function (row) {
    if (row) row.addEventListener('focusin', function (e) {
      var t = e.target, kbd = true;
      if (t.parentNode !== row || row.scrollWidth <= row.clientWidth + 1) return;
      try { kbd = t.matches(':focus-visible'); } catch (err) { /* older browsers: always */ }
      if (kbd) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });
  function render() {
    var q = state.q.trim();
    if (input && input.value !== state.q) input.value = state.q;
    // at once, in the same step that hides "Start from a category" and lets the block under the field be painted
    // (data-ready: until now it stayed unpainted, search.css), so nothing painted moves; the block keeps the footer out
    // of view until the results are in
    if (hint) hint.hidden = !!q;
    page.setAttribute('data-ready', '');
    d.title = (q ? '“' + q + '” — ' : '') + 'Search | System Compare';
    if (!q) {
      results.textContent = ''; status.textContent = ''; status.classList.remove('sr-only'); controls.hidden = true; facetsBox.hidden = true; start.hidden = false;
      var recent = SC.search.recent();
      if (recent.length) {
        results.appendChild(el('h2', { text: 'Recent searches' }));
        var chips = el('div.chips');
        recent.forEach(function (x) { chips.appendChild(el('a.chip.chip--link', { href: SC.url('/search/?q=' + encodeURIComponent(x)), text: x })); });
        results.appendChild(chips);
      }
      return;
    }
    // "Start from a category" shows only when nothing is found, under the "No results" note: until the results are
    // in it stays unpainted, so nothing on screen moves when that note arrives above it
    start.hidden = true;
    // the results page waits for the whole index (descriptions, features, integrations): one complete render
    SC.search.engine({ full: true }).then(function (engine) {
      if (state.q.trim() !== q) return;
      var r = engine.query(q), frag = d.createDocumentFragment();
      var groups = {}, counts = {};
      Object.keys(r.groups).forEach(function (k) {
        var list = r.groups[k];
        if (k === 'product') {
          list = list.filter(productOk);
          if (state.sort === 'score') list = list.slice().sort(function (a, b) { return (b.best == null ? -1 : b.best) - (a.best == null ? -1 : a.best) || b.score - a.score; });
          if (state.sort === 'price') list = list.slice().sort(function (a, b) { return (a.amount == null ? 1e9 : a.amount) - (b.amount == null ? 1e9 : b.amount) || b.score - a.score; });
        }
        groups[k] = list; counts[k] = list.length;
      });
      // every result counts once (a best match is usually also in its own group)
      var seen = {}, total = 0;
      Object.keys(groups).reduce(function (all, k) { return all.concat(groups[k]); }, r.top.slice()).forEach(function (x) { var key = x.type + ':' + (x.id || x.url); if (!seen[key]) { seen[key] = 1; total++; } });
      counts[''] = total;
      syncChips(counts);
      controls.hidden = !total; // nothing found: no "All 0" chip and no sort over nothing above the "No results" note
      facetsBox.hidden = !((r.groups.product || []).length) || (state.type && state.type !== 'product');
      $$('[data-facet]', facetsBox).forEach(function (b) { b.setAttribute('aria-pressed', state.f[b.getAttribute('data-facet')] ? 'true' : 'false'); });
      sortSel.value = state.sort;
      start.hidden = total > 0;
      // understood-as line: tells the user how the query was read
      var notes = [];
      if (r.q.filters.free) notes.push('free entry price');
      if (r.q.filters.maxPrice != null) notes.push('starting price up to $' + r.q.filters.maxPrice);
      if (r.q.sort === 'price') notes.push('lowest price first');
      if (r.q.sort === 'score') notes.push('highest score first');
      // the status line is the live region: it says how many results there are, or that there are none (the
      // visible "No results" note below already shows that, so the line itself is then read out only)
      var cut = state.over ? limit.message + ' ' : '';
      status.classList.toggle('sr-only', !total);
      status.textContent = cut + (total ? total + ' result' + (total === 1 ? '' : 's') + ' for “' + q + '”' + (notes.length ? ' · read as: ' + notes.join(', ') : '') : 'No results for “' + q + '”.');

      if (r.top.length && !state.type) {
        // the palette's rule: rows about products the query does not name ("crm vs", "crm pricing") are suggestions
        frag.appendChild(el('h2', { text: SC.search.answers(engine, r, q) ? 'Best match' : 'Suggestions' }));
        var ul0 = el('ul.srch__list');
        // a comparison, alternatives or tool row names its kind on its second line: no right-hand label
        r.top.forEach(function (t) { ul0.appendChild(row(t)); });
        frag.appendChild(ul0);
      }
      var shown = {}; r.top.forEach(function (t) { shown[t.type + ':' + t.id] = 1; });
      // products that only list the named product as an integration ("Works with HubSpot"): their own short
      // list in the overview; in the Products view they stay in the list, with the reason on their second line
      var via = r.via ? r.via : null, why = function (x) { return x.via && via ? Object.assign({}, x, { sub: (x.sub ? x.sub + ' · ' : '') + via.label }) : x; };
      ['category', 'product', 'comparison', 'guide', 'faq', 'page'].forEach(function (k) {
        if (state.type && state.type !== k) return;
        var list = (groups[k] || []).filter(function (x) { return state.type || (!shown[x.type + ':' + x.id] && !(via && x.via)); });
        var limit = state.type ? 200 : k === 'product' ? 12 : 6;
        if (list.length) {
          frag.appendChild(el('h2', { text: HEAD[k] + (list.length > limit ? ' (' + list.length + ')' : '') }));
          var ul = el('ul.srch__list');
          list.slice(0, limit).forEach(function (x) { ul.appendChild(row(why(x))); });
          frag.appendChild(ul);
          if (list.length > limit) frag.appendChild(el('p', null, [el('button.btn.btn--quiet.btn--sm', { type: 'button', 'data-type': k, text: 'Show all ' + list.length + ' ' + HEAD[k].toLowerCase() })]));
        }
        if (k === 'product' && via && !state.type) {
          var more = (groups.product || []).filter(function (x) { return x.via && !shown[x.type + ':' + x.id]; });
          if (more.length) {
            frag.appendChild(el('h2', { text: via.label }));
            var ulv = el('ul.srch__list');
            more.slice(0, 3).forEach(function (x) { ulv.appendChild(row(x)); });
            frag.appendChild(ulv);
            if (more.length > 3) frag.appendChild(el('p', null, [el('button.btn.btn--quiet.btn--sm', { type: 'button', 'data-type': 'product', text: 'Show all ' + (groups.product || []).length + ' products' })]));
          }
        }
      });
      if (!total) {
        frag.appendChild(el('div.empty', null, [el('b', { text: 'No results for “' + q + '”.' }), d.createTextNode(state.over ? limit.message : 'Check the spelling, try a category name such as “CRM” or “payroll”, or start from a category below.')]));
        if (r.catHits && r.catHits.length) {
          var ulc = el('ul.srch__list'); r.catHits.slice(0, 4).forEach(function (x) { ulc.appendChild(row(x)); }); frag.appendChild(ulc);
        }
      }
      results.textContent = '';
      results.appendChild(frag);
      revealPressed(typeChips);
      if (focusResults) {
        focusResults = false;
        var h = $('h2', results);
        if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
      }
    }).catch(function () {
      status.classList.remove('sr-only');
      status.textContent = 'Search could not load. Browse the categories below.';
      start.hidden = false;
    });
  }

  readUrl();
  if (input) {
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.over = limit.over(input.value); state.q = input.value.slice(0, 120); state.type = ''; writeUrl(false); render(); }, 90);
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); state.over = limit.over(input.value); state.q = input.value.slice(0, 120); SC.search.remember(state.q); writeUrl(true); render(); });
  }
  page.addEventListener('click', function (e) {
    var t = e.target.closest('[data-type]');
    if (t) {
      // a type chip keeps focus (chips are updated in place); "Show all …" is replaced, so focus goes to the new list
      focusResults = !typeChips.contains(t);
      state.type = t.getAttribute('data-type'); writeUrl(false); render(); window.scrollTo({ top: 0 });
      return;
    }
    var f = e.target.closest('[data-facet]');
    if (f) { var k = f.getAttribute('data-facet'); if (state.f[k]) delete state.f[k]; else state.f[k] = 1; writeUrl(false); render(); }
  });
  if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; writeUrl(false); render(); });
  window.addEventListener('popstate', function () { readUrl(); render(); });
  render();
})();
