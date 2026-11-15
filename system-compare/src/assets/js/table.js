/* System Compare — instant filter + sort for ranked product tables, and the capability matrix.
 *
 * Filters and sorting only change which rows are visible and in what order. They never change a
 * published score or rank (the "#" column always shows the published rank).
 * State lives in the URL (?sort=price&f=scored,priced&must=3,7&all=1) so a filtered view can be shared.
 */
(function () {
  'use strict';
  var d = document, SC = window.SC;
  if (!SC) return;
  var $ = SC.$, $$ = SC.$$, el = SC.el;
  var table = $('[data-ptable][id="products"]');
  var controls = $('[data-table-controls="products"]');
  var matrix = $('[data-matrix]');

  // ------------------------------------------------------------------ ranked table
  var state = { sort: 'score', f: {}, must: {} };
  var rows = table ? $$('tbody tr', table) : [];
  var tbody = table ? $('tbody', table) : null;

  function readUrl() {
    var q = new URLSearchParams(location.search);
    var s = q.get('sort'); if (s === 'price' || s === 'name' || s === 'score') state.sort = s;
    (q.get('f') || '').split(',').forEach(function (k) { if (k === 'scored' || k === 'priced' || k === 'ai') state.f[k] = 1; });
    (q.get('must') || '').split(',').forEach(function (k) { if (/^\d+$/.test(k)) state.must[k] = 1; });
    if (q.get('all') === '1') state.all = 1;
  }
  function writeUrl() {
    var q = new URLSearchParams(location.search);
    ['sort', 'f', 'must', 'all'].forEach(function (k) { q.delete(k); });
    if (state.sort !== 'score') q.set('sort', state.sort);
    var f = Object.keys(state.f); if (f.length) q.set('f', f.join(','));
    var m = Object.keys(state.must); if (m.length) q.set('must', m.join(','));
    if (state.all) q.set('all', '1');
    var s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  }
  function matches(tr) {
    // products already in the shortlist stay visible while you filter for challengers
    if (tr.classList.contains('is-picked')) return true;
    if (state.f.scored && Number(tr.getAttribute('data-score')) < 0) return false;
    if (state.f.priced && tr.getAttribute('data-pstate') !== 'amount') return false;
    if (state.f.ai) { var ai = tr.getAttribute('data-ai'); if (ai !== 'native' && ai !== 'agent') return false; }
    var must = Object.keys(state.must);
    if (must.length) {
      var have = ' ' + (tr.getAttribute('data-feat') || '') + ' ';
      for (var i = 0; i < must.length; i++) if (have.indexOf(' ' + must[i] + ' ') < 0) return false;
    }
    return true;
  }
  function apply(push) {
    if (!table) return;
    var visible = [];
    rows.forEach(function (tr) { var ok = matches(tr); tr.hidden = !ok; if (ok) visible.push(tr); });
    var sorted = rows.slice().sort(function (a, b) {
      if (state.sort === 'name') return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
      if (state.sort === 'price') {
        var pa = a.getAttribute('data-price'), pb = b.getAttribute('data-price');
        if (pa === '' && pb === '') return Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
        if (pa === '') return 1; if (pb === '') return -1;
        return Number(pa) - Number(pb) || Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
      }
      return Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
    });
    sorted.forEach(function (tr) { tbody.appendChild(tr); });
    // controls
    $$('[data-filter]', controls).forEach(function (b) { b.setAttribute('aria-pressed', state.f[b.getAttribute('data-filter')] ? 'true' : 'false'); });
    $$('[data-must]', controls).forEach(function (c) { c.checked = !!state.must[c.getAttribute('data-must')]; });
    var mustN = Object.keys(state.must).length, mc = $('[data-must-count]', controls), ms = $('.mustpop > summary', controls);
    if (mc) { mc.hidden = !mustN; mc.textContent = mustN || ''; }
    if (ms) ms.setAttribute('data-on', mustN ? '1' : '0');
    var sel = $('[data-sort-select]', controls); if (sel) sel.value = state.sort;
    $$('[data-sort-col]', table).forEach(function (th) {
      var k = th.getAttribute('data-sort-col');
      if (k === state.sort) th.setAttribute('aria-sort', k === 'score' ? 'descending' : 'ascending'); else th.removeAttribute('aria-sort');
    });
    var filtered = Object.keys(state.f).length + mustN > 0;
    $$('[data-filter-reset]').forEach(function (b) { if (b.closest('[data-table-controls]')) b.hidden = !filtered; });
    var count = $('[data-count]'), total = rows.length;
    if (count) {
      count.textContent = '';
      count.appendChild(el('b', { text: filtered ? visible.length + ' of ' + total : String(total) }));
      count.appendChild(d.createTextNode(' ' + (count.getAttribute('data-noun') || 'products') + (state.sort === 'price' ? ' · sorted by starting price (products without a public price last)' : state.sort === 'name' ? ' · sorted by name' : '')));
    }
    var empty = $('[data-empty]'); if (empty) empty.hidden = visible.length > 0;
    table.hidden = visible.length === 0;
    syncMatrixColumns();
    if (push !== false) writeUrl();
  }
  if (table && controls) {
    var count0 = $('[data-count]');
    if (count0) count0.setAttribute('data-noun', (count0.textContent || '').replace(/^\s*\d+\s*/, '').trim());
    readUrl();
    controls.addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]');
      if (b) { var k = b.getAttribute('data-filter'); if (state.f[k]) delete state.f[k]; else state.f[k] = 1; apply(); }
    });
    controls.addEventListener('change', function (e) {
      if (e.target.matches('[data-must]')) { var k = e.target.getAttribute('data-must'); if (e.target.checked) state.must[k] = 1; else delete state.must[k]; apply(); }
      else if (e.target.matches('[data-sort-select]')) { state.sort = e.target.value; apply(); }
    });
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-filter-reset]')) { state.f = {}; state.must = {}; apply(); }
      var sb = e.target.closest('[data-sort]');
      if (sb && table.contains(sb)) { state.sort = sb.getAttribute('data-sort'); apply(); }
    });
    apply(false);
  }

  // ------------------------------------------------------------------ capability matrix
  var onlyPicked = false;
  function syncMatrixColumns() {
    if (!matrix) return;
    var hiddenIds = {};
    rows.forEach(function (tr) { if (tr.hidden) hiddenIds[tr.getAttribute('data-id')] = 1; });
    var picked = SC.shortlist.get();
    var pickedHere = picked.category === matrix.getAttribute('data-category') ? picked.ids : [];
    var btn = $('[data-matrix-picked]');
    if (btn) { btn.hidden = pickedHere.length < 2; if (btn.hidden) onlyPicked = false; btn.setAttribute('aria-pressed', onlyPicked ? 'true' : 'false'); }
    // columns are addressed by position: header cell N belongs to the same vendor as cell N in every row
    var heads = $$('thead th[data-v]', matrix), off = {};
    heads.forEach(function (th, i) {
      var id = th.getAttribute('data-v');
      off[i] = !!hiddenIds[id] || (onlyPicked && pickedHere.indexOf(id) < 0);
      th.hidden = off[i];
    });
    $$('tbody tr', matrix).forEach(function (tr) {
      var tds = tr.children;
      for (var i = 1; i < tds.length; i++) if (tds[i].tagName === 'TD') tds[i].hidden = !!off[i - 1];
    });
  }
  var STC = { y: 'yes', p: 'partial', n: 'no', u: 'unknown' };
  var STL = { y: 'Supported', p: 'Limited', n: 'Not supported', u: 'Not verified' };
  var extraBuilt = false;
  /** Adds the deep checks that are not scored yet (loaded on demand; they are not in the HTML). */
  function buildExtraRows() {
    return SC.load('cat-' + matrix.getAttribute('data-category')).then(function (data) {
      if (extraBuilt) return;
      extraBuilt = true;
      var heads = $$('thead th[data-v]', matrix).map(function (th) { return th.getAttribute('data-v'); });
      var byId = {}; data.vendors.forEach(function (v) { byId[v.id] = v; });
      var body = $('tbody', matrix);
      data.groups.forEach(function (g) {
        var items = [];
        data.features.forEach(function (f, i) { if (f[2] === g[0] && !f[3]) items.push([f, i]); });
        if (!items.length) return;
        body.appendChild(el('tr.is-group', { 'data-extra': '' }, [el('th', { scope: 'colgroup', colspan: heads.length + 1, text: g[1] + ' — inactive deep checks, not scored yet' })]));
        items.forEach(function (it) {
          var tr = el('tr.is-inactive', { 'data-extra': '', 'data-f': it[1] }, [el('th', { scope: 'row', text: it[0][1] })]);
          heads.forEach(function (vid) {
            var c = (byId[vid] && byId[vid].c[it[1]]) || ['u'];
            tr.appendChild(el('td', null, [el('button.cellbtn.st.st--' + STC[c[0]] + '.st--icon', { type: 'button', 'data-c': it[1] }, [el('span', { text: STL[c[0]] })])]));
          });
          body.appendChild(tr);
        });
      });
    });
  }
  function showAll(on) {
    state.all = on ? 1 : 0;
    var b = $('[data-matrix-all]');
    if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (!b.getAttribute('data-label')) b.setAttribute('data-label', b.textContent); b.textContent = on ? 'Hide inactive deep checks' : b.getAttribute('data-label'); }
    var toggle = function () { $$('tr[data-extra]', matrix).forEach(function (tr) { tr.hidden = !on; }); syncMatrixColumns(); };
    if (on && !extraBuilt) buildExtraRows().then(toggle).catch(function () { SC.toast('Those checks could not load. Each product profile lists them all.'); });
    else toggle();
  }
  if (matrix) {
    var allBtn = $('[data-matrix-all]'), pickBtn = $('[data-matrix-picked]');
    if (allBtn) allBtn.addEventListener('click', function () { showAll(allBtn.getAttribute('aria-pressed') !== 'true'); writeUrl(); });
    if (pickBtn) pickBtn.addEventListener('click', function () { onlyPicked = !onlyPicked; syncMatrixColumns(); });
    if (state.all) showAll(true);
    d.addEventListener('sc:shortlist-updated', syncMatrixColumns);
    syncMatrixColumns();

    // evidence popover for a cell (data is loaded once per category, on first use)
    var pop = null, popFor = null;
    function closePop() { if (pop) { pop.remove(); pop = null; if (popFor) popFor.setAttribute('aria-expanded', 'false'); popFor = null; } }
    var VER = { d: 'Official documentation', v: 'Vendor confirmed', '': 'Not verified' };
    function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + +m[3] + ', ' + m[1] : ''; }
    matrix.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]');
      if (!b) return;
      if (popFor === b) { closePop(); return; }
      closePop();
      var td = b.parentNode, col = Array.prototype.indexOf.call(td.parentNode.children, td) - 1;
      var headCell = $$('thead th[data-v]', matrix)[col];
      if (!headCell) return;
      var vid = headCell.getAttribute('data-v'), fi = Number(b.getAttribute('data-c'));
      popFor = b; b.setAttribute('aria-expanded', 'true');
      pop = el('div.evpop', { role: 'dialog', 'aria-label': 'Evidence' }, [el('p', { text: 'Loading evidence…' })]);
      d.body.appendChild(pop);
      place(b);
      SC.load('cat-' + matrix.getAttribute('data-category')).then(function (data) {
        if (popFor !== b || !pop) return;
        var v = data.vendors.filter(function (x) { return x.id === vid; })[0], f = data.features[fi];
        if (!v || !f) return closePop();
        var c = v.c[fi] || ['u'];
        pop.textContent = '';
        pop.appendChild(el('span.st.st--' + STC[c[0]], { text: STL[c[0]] }));
        pop.appendChild(el('h4', { text: f[1] }));
        pop.appendChild(el('p.evpop__who', { text: v.n }));
        pop.appendChild(el('p', { text: c[1] || (c[0] === 'u' ? 'We have not verified this in official documentation. Not verified does not mean the product lacks it.' : 'No note recorded.') }));
        var meta = VER[c[2] || ''] + (c[3] ? ' · ' + fmtDate(c[3]) : '') + (f[3] ? '' : ' · not included in the score yet');
        pop.appendChild(el('p.evpop__meta', { text: meta }));
        var links = el('p');
        if (c[4]) { links.appendChild(el('a.ext', { href: c[4], target: '_blank', rel: 'noopener noreferrer', text: c[2] === 'v' ? 'Related documentation' : 'Source' })); links.appendChild(d.createTextNode(' · ')); }
        links.appendChild(el('a', { href: SC.url('/software/' + vid + '/#capabilities'), text: 'All evidence for ' + v.n }));
        pop.appendChild(links);
        place(b);
      }).catch(function () { if (pop) pop.textContent = 'Evidence could not load. Open the product profile for sources.'; });
    });
    function place(b) {
      var r = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      var left = Math.max(12, Math.min(window.innerWidth - pw - 12, r.left + r.width / 2 - pw / 2));
      var top = r.bottom + 8;
      if (top + ph > window.innerHeight - 12 && r.top - ph - 8 > 12) top = r.top - ph - 8;
      pop.style.left = left + window.scrollX + 'px';
      pop.style.top = top + window.scrollY + 'px';
    }
    d.addEventListener('click', function (e) { if (pop && !pop.contains(e.target) && !e.target.closest('[data-c]')) closePop(); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) { var f = popFor; closePop(); if (f) f.focus(); } });
    window.addEventListener('resize', closePop);
  }
})();
