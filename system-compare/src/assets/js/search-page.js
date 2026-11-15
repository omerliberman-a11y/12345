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
  var TYPES = [['', 'All'], ['category', 'Categories'], ['product', 'Products'], ['comparison', 'Comparisons'], ['guide', 'Guides'], ['faq', 'Questions'], ['page', 'Pages']];
  var HEAD = { category: 'Categories', product: 'Products', comparison: 'Comparisons', guide: 'Buying guides', faq: 'Questions and answers', page: 'Pages' };
  var state = { q: '', type: '', sort: '', f: {} };
  var timer;

  function readUrl() {
    var p = new URLSearchParams(location.search);
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
    if (r.type !== 'product') return '';
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
  function render() {
    var q = state.q.trim();
    if (input && input.value !== state.q) input.value = state.q;
    d.title = (q ? '“' + q + '” — ' : '') + 'Search | System Compare';
    if (!q) {
      results.textContent = ''; status.textContent = ''; controls.hidden = true; facetsBox.hidden = true; start.hidden = false;
      var recent = SC.search.recent();
      if (recent.length) {
        results.appendChild(el('h2', { text: 'Recent searches' }));
        var chips = el('div.chips');
        recent.forEach(function (x) { chips.appendChild(el('a.chip.chip--link', { href: SC.url('/search/?q=' + encodeURIComponent(x)), text: x })); });
        results.appendChild(chips);
      }
      return;
    }
    SC.search.engine().then(function (engine) {
      if (state.q.trim() !== q) return;
      var r = engine.query(q), frag = d.createDocumentFragment();
      var groups = {}, total = r.top.length;
      Object.keys(r.groups).forEach(function (k) {
        var list = r.groups[k];
        if (k === 'product') {
          list = list.filter(productOk);
          if (state.sort === 'score') list = list.slice().sort(function (a, b) { return (b.best == null ? -1 : b.best) - (a.best == null ? -1 : a.best) || b.score - a.score; });
          if (state.sort === 'price') list = list.slice().sort(function (a, b) { return (a.amount == null ? 1e9 : a.amount) - (b.amount == null ? 1e9 : b.amount) || b.score - a.score; });
        }
        groups[k] = list; total += list.length;
      });
      // type chips with counts
      typeChips.textContent = '';
      TYPES.forEach(function (t) {
        var n = t[0] ? (groups[t[0]] || []).length : total;
        if (t[0] && !n) return;
        typeChips.appendChild(el('button.chip', { type: 'button', 'data-type': t[0], 'aria-pressed': state.type === t[0] ? 'true' : 'false' }, [t[1] + ' ', el('span.n', { text: String(n) })]));
      });
      controls.hidden = false;
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
      status.textContent = total ? total + ' result' + (total === 1 ? '' : 's') + ' for “' + q + '”' + (notes.length ? ' · read as: ' + notes.join(', ') : '') : '';

      if (r.top.length && !state.type) {
        frag.appendChild(el('h2', { text: 'Best match' }));
        var ul0 = el('ul.srch__list');
        r.top.forEach(function (t) { ul0.appendChild(row(t, t.why || meta(t))); });
        frag.appendChild(ul0);
      }
      var shown = {}; r.top.forEach(function (t) { shown[t.type + ':' + t.id] = 1; });
      ['category', 'product', 'comparison', 'guide', 'faq', 'page'].forEach(function (k) {
        if (state.type && state.type !== k) return;
        var list = (groups[k] || []).filter(function (x) { return state.type || !shown[x.type + ':' + x.id]; });
        if (!list.length) return;
        var limit = state.type ? 200 : k === 'product' ? 12 : 6;
        frag.appendChild(el('h2', { text: HEAD[k] + (list.length > limit ? ' (' + list.length + ')' : '') }));
        var ul = el('ul.srch__list');
        list.slice(0, limit).forEach(function (x) { ul.appendChild(row(x)); });
        frag.appendChild(ul);
        if (list.length > limit) frag.appendChild(el('p', null, [el('button.btn.btn--quiet.btn--sm', { type: 'button', 'data-type': k, text: 'Show all ' + list.length + ' ' + HEAD[k].toLowerCase() })]));
      });
      if (!total) {
        frag.appendChild(el('div.empty', null, [el('b', { text: 'No results for “' + q + '”.' }), d.createTextNode('Check the spelling, try a category name such as “CRM” or “payroll”, or start from a category below.')]));
        if (r.catHits && r.catHits.length) {
          var ulc = el('ul.srch__list'); r.catHits.slice(0, 4).forEach(function (x) { ulc.appendChild(row(x)); }); frag.appendChild(ulc);
        }
      }
      results.textContent = '';
      results.appendChild(frag);
    }).catch(function () {
      status.textContent = 'Search could not load. Browse the categories below.';
      start.hidden = false;
    });
  }

  readUrl();
  if (input) {
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = input.value.slice(0, 120); state.type = ''; writeUrl(false); render(); }, 90);
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); state.q = input.value.slice(0, 120); SC.search.remember(state.q); writeUrl(true); render(); });
  }
  page.addEventListener('click', function (e) {
    var t = e.target.closest('[data-type]');
    if (t) { state.type = t.getAttribute('data-type'); writeUrl(false); render(); window.scrollTo({ top: 0 }); return; }
    var f = e.target.closest('[data-facet]');
    if (f) { var k = f.getAttribute('data-facet'); if (state.f[k]) delete state.f[k]; else state.f[k] = 1; writeUrl(false); render(); }
  });
  if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; writeUrl(false); render(); });
  window.addEventListener('popstate', function () { readUrl(); render(); });
  render();
})();
