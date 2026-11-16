/* System Compare — instant filter + sort for ranked product tables, the capability matrix, and the section menu under
 * a category page's head (also loaded by documentary category pages for that menu alone).
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
  // a category where nothing is scored yet sorts by the share of the checklist checked by default (data-sort-default="cov")
  var SORT0 = (controls && controls.getAttribute('data-sort-default')) || 'score';
  var state = { sort: SORT0, f: {}, must: {} };
  var rows = table ? $$('tbody tr', table) : [];
  var tbody = table ? $('tbody', table) : null;

  function readUrl() {
    var q = new URLSearchParams(location.search);
    var s = q.get('sort'); if (s === 'price' || s === 'name' || s === 'score' || s === 'cov') state.sort = s;
    (q.get('f') || '').split(',').forEach(function (k) { if (k === 'scored' || k === 'priced' || k === 'ai') state.f[k] = 1; });
    (q.get('must') || '').split(',').forEach(function (k) { if (/^\d+$/.test(k)) state.must[k] = 1; });
    if (q.get('all') === '1') state.all = 1;
  }
  function writeUrl() {
    var q = new URLSearchParams(location.search);
    ['sort', 'f', 'must', 'all'].forEach(function (k) { q.delete(k); });
    if (state.sort !== SORT0) q.set('sort', state.sort);
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
    // every row is read first; then only the rows that change are written (an unchanged order is not re-appended),
    // so a filter chip costs one small style and layout pass instead of re-laying out the whole table
    var visible = [], want = rows.map(function (tr) { var ok = matches(tr); if (ok) visible.push(tr); return ok; });
    rows.forEach(function (tr, i) { if (tr.hidden === want[i]) tr.hidden = !want[i]; });
    var sorted = rows.slice().sort(function (a, b) {
      if (state.sort === 'name') return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
      if (state.sort === 'price') {
        var pa = a.getAttribute('data-price'), pb = b.getAttribute('data-price');
        if (pa === '' && pb === '') return Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
        if (pa === '') return 1; if (pb === '') return -1;
        return Number(pa) - Number(pb) || Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
      }
      if (state.sort === 'cov') return Number(b.getAttribute('data-cov')) - Number(a.getAttribute('data-cov')) || Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
      return Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
    });
    var order = tbody.children, same = order.length === sorted.length;
    for (var i = 0; same && i < sorted.length; i++) same = order[i] === sorted[i];
    if (!same) sorted.forEach(function (tr) { tbody.appendChild(tr); });
    // controls
    $$('[data-filter]', controls).forEach(function (b) { b.setAttribute('aria-pressed', state.f[b.getAttribute('data-filter')] ? 'true' : 'false'); });
    $$('[data-must]', controls).forEach(function (c) { c.checked = !!state.must[c.getAttribute('data-must')]; });
    var mustN = Object.keys(state.must).length, mc = $('[data-must-count]', controls), ms = $('.mustpop > summary', controls);
    if (mc) { mc.hidden = !mustN; mc.textContent = mustN || ''; }
    if (ms) ms.setAttribute('data-on', mustN ? '1' : '0');
    var sel = $('[data-sort-select]', controls);
    if (sel) {
      sel.value = state.sort;
      // the chip-sized face over the select shows the current order in a few words ("lowest price"): every option's
      // words are in the face, stacked, and only the current one is shown, so the chip never changes its width
      var face = $('[data-sort-face]', controls), opt = sel.options[sel.selectedIndex], faces = face ? $$('[data-face]', face) : [];
      if (faces.length) faces.forEach(function (f) { var on = f.getAttribute('data-face') === sel.value; if (f.classList.contains('is-on') !== on) f.classList.toggle('is-on', on); });
      else if (face && opt) face.textContent = opt.getAttribute('data-short') || opt.textContent;
    }
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
      count.appendChild(d.createTextNode(' ' + (count.getAttribute('data-noun') || 'products')));
      // the order other than the default, in its own span: the sort face shows it on screen too, so on phones, where
      // the count shares a short line with the sort, the span is read by screen readers only (category.css)
      var order = state.sort === 'price' ? ' · sorted by starting price (products without a public price last)' : state.sort === 'name' ? ' · sorted by name' : '';
      if (order) count.appendChild(el('span.cat-order', { text: order }));
    }
    // the must-have panel repeats the count in its footer, so the effect of a box is visible while the sheet covers
    // the page (not a live region: the count above already announces it)
    var mustMatch = $('[data-must-n]', controls); if (mustMatch) mustMatch.textContent = String(visible.length);
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
      // "Done" in the must-have panel closes it and returns focus to its chip
      var done = e.target.closest('[data-must-done]'), pop = done && done.closest('details');
      if (pop) { pop.open = false; var sum = $('summary', pop); if (sum) sum.focus(); }
    });
    // Wide screens: the must-have popover opens under its chip and could reach past the bottom of the window. It is
    // fitted to the room below the chip instead (its list scrolls inside; the footer with the live count and Done
    // stays in view); only when that room is too small does the page scroll to show it. (Phones: a fixed bottom sheet.)
    var mustPop = $('.mustpop', controls);
    if (mustPop) {
      mustPop.addEventListener('toggle', function () {
        var panel = $('.mustpop__panel', mustPop);
        if (!panel) return;
        panel.style.maxHeight = '';
        if (!mustPop.open || getComputedStyle(panel).position === 'fixed') return;
        var r = panel.getBoundingClientRect(), room = Math.floor(window.innerHeight - r.top - 12);
        if (r.bottom <= window.innerHeight - 12) return;
        if (room >= 240) panel.style.maxHeight = room + 'px';
        else panel.scrollIntoView({ block: 'nearest' });
      });
    }
    // A chip reached with the keyboard comes fully into view in the sideways-scrolling filter row (phones, or a desktop
    // window at 400% zoom), clear of the faded edge: the row's scroll-padding keeps it off the fade.
    var chipRow = $('.cat-chips > .chips', controls);
    if (chipRow) {
      chipRow.addEventListener('focusin', function (e) {
        var t = e.target, own = t.parentNode === chipRow || (t.tagName === 'SUMMARY' && t.parentNode.parentNode === chipRow);
        if (!own || chipRow.scrollWidth <= chipRow.clientWidth + 1) return;
        var kbd = true;
        try { kbd = t.matches(':focus-visible'); } catch (err) { /* older browsers: always */ }
        if (kbd) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
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
      if (th.hidden !== off[i]) th.hidden = off[i];
    });
    // a cell is written only when its column changes (hundreds of cells, most of them unchanged)
    $$('tbody tr', matrix).forEach(function (tr) {
      var tds = tr.children;
      for (var i = 1; i < tds.length; i++) if (tds[i].tagName === 'TD' && tds[i].hidden !== !!off[i - 1]) tds[i].hidden = !!off[i - 1];
    });
  }
  var STC = { y: 'yes', p: 'partial', n: 'no', u: 'unknown' };
  var STL = { y: 'Supported', p: 'Limited', n: 'Not supported', u: 'Not verified' };
  /** The text a cell shows, without the logo (its monogram) or anything hidden from assistive technology. */
  function textOf(node) {
    var out = '';
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1 && !c.classList.contains('logo') && c.getAttribute('aria-hidden') !== 'true') walk(c);
      }
    })(node);
    return out.replace(/\s+/g, ' ').trim();
  }
  var colNames = null;
  /** "Pipedrive, Contacts and relationship records: Supported" (column k of the matrix). */
  function cellName(k, check, status) {
    if (!colNames) colNames = $$('thead th[data-v]', matrix).map(textOf);
    return (colNames[k] ? colNames[k] + ', ' : '') + check + ': ' + status;
  }
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
          var tr = el('tr.is-inactive', { 'data-extra': '', 'data-f': it[1] }, [el('th', { scope: 'row' }, [el('button.matrix__what', { type: 'button', 'data-what': it[1], 'aria-haspopup': 'dialog', 'aria-expanded': 'false', text: it[0][1] })])]);
          heads.forEach(function (vid, k) {
            var c = (byId[vid] && byId[vid].c[it[1]]) || ['u'];
            tr.appendChild(el('td', null, [el('button.cellbtn.st.st--' + STC[c[0]] + '.st--icon', { type: 'button', 'data-c': it[1], 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': cellName(k, it[0][1], STL[c[0]]) }, [el('span', { text: STL[c[0]] })])]));
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

    // Evidence popover for a cell, and "what this check covers" for a row (data is loaded once per category,
    // on first use). Both use the shared SC.float popover, which moves focus into it once the content is in
    // place and closes when focus leaves it.
    var VER = { d: 'Official documentation', v: 'Vendor confirmed', '': 'Not verified' };
    function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + +m[3] + ', ' + m[1] : ''; }
    var TIER = { foundation: 'Foundation check', advanced: 'Shared deep check' };
    /** Opens the popover for trigger b; fill(data, box) builds its content and returns false when there is none. */
    function openPop(b, label, loading, fill, failText) {
      if (SC.float.anchor() === b) { SC.float.close(); return; }
      var box = SC.float.open(b, el('div.evpop', { role: 'dialog', 'aria-label': label }, [el('p', { text: loading })]), { align: 'center' });
      SC.load('cat-' + matrix.getAttribute('data-category')).then(function (data) {
        if (SC.float.anchor() !== b) return;
        box.textContent = '';
        if (fill(data, box) === false) return SC.float.close();
        SC.float.ready(box);
      }).catch(function () { if (SC.float.anchor() === b) { box.textContent = failText; SC.float.ready(box); } });
    }
    /** The dialog is named by its title line(s) (paragraphs, not headings: the popover sits outside the page outline). */
    function nameBy(box, ids) { box.removeAttribute('aria-label'); box.setAttribute('aria-labelledby', ids); }
    /** What a check covers: description, tier, score group, the points it carries and the demo question. */
    function openWhat(b) {
      var fi = Number(b.getAttribute('data-what'));
      openPop(b, 'About this check', 'Loading…', function (data, pop) {
        var f = data.features[fi];
        if (!f) return false;
        // points: the group's share of the active groups, split evenly over its scored checks
        var counts = {}, base = {}, activeBase = 0, groupLabel = '';
        data.groups.forEach(function (g) { base[g[0]] = g[2]; if (g[0] === f[2]) groupLabel = g[1]; });
        data.features.forEach(function (x) { if (x[3]) counts[x[2]] = (counts[x[2]] || 0) + 1; });
        Object.keys(counts).forEach(function (g) { activeBase += base[g] || 0; });
        var pts = f[3] && activeBase && counts[f[2]] ? Math.round((((base[f[2]] / activeBase) * 100) / counts[f[2]]) * 10) / 10 : 0;
        pop.appendChild(el('p.evpop__who.evpop__title', { id: 'sc-float-title', text: f[1] }));
        nameBy(pop, 'sc-float-title');
        pop.appendChild(el('p', { text: f[4] || 'No description is recorded for this check.' }));
        pop.appendChild(el('p.evpop__meta', { text: [TIER[f[5]] || '', groupLabel, f[3] ? pts + ' of 100 points' : 'not included in the score yet'].filter(Boolean).join(' · ') }));
        if (f[6]) pop.appendChild(el('p', null, [el('b', { text: 'Ask in a demo: ' }), f[6]]));
      }, 'This could not load. The product profiles describe every check.');
    }
    matrix.addEventListener('click', function (e) {
      var w = e.target.closest('[data-what]');
      if (w) { openWhat(w); return; }
      var b = e.target.closest('[data-c]');
      if (!b) return;
      var td = b.parentNode, col = Array.prototype.indexOf.call(td.parentNode.children, td) - 1;
      var headCell = $$('thead th[data-v]', matrix)[col];
      if (!headCell) return;
      var vid = headCell.getAttribute('data-v'), fi = Number(b.getAttribute('data-c'));
      openPop(b, 'Evidence', 'Loading evidence…', function (data, pop) {
        var v = data.vendors.filter(function (x) { return x.id === vid; })[0], f = data.features[fi];
        if (!v || !f) return false;
        var c = v.c[fi] || ['u'];
        pop.appendChild(el('p', null, [el('span.st.st--' + STC[c[0]], { text: STL[c[0]] })]));
        pop.appendChild(el('p.evpop__who.evpop__title', { id: 'sc-float-title', text: f[1] }));
        if (f[4]) pop.appendChild(el('p.evpop__meta', { text: f[4] }));
        pop.appendChild(el('p.evpop__who', { id: 'sc-float-who', text: v.n }));
        nameBy(pop, 'sc-float-who sc-float-title'); // "Pipedrive Contacts and relationship records"
        pop.appendChild(el('p', { text: c[1] || (c[0] === 'u' ? 'We have not verified this in official documentation. Not verified does not mean the product lacks it.' : 'No note recorded.') }));
        var meta = VER[c[2] || ''] + (c[3] ? ' · ' + fmtDate(c[3]) : '') + (f[3] ? '' : ' · not included in the score yet');
        pop.appendChild(el('p.evpop__meta', { text: meta }));
        var links = el('p');
        if (c[4]) { links.appendChild(el('a.ext', { href: c[4], target: '_blank', rel: 'noopener noreferrer', text: c[2] === 'v' ? 'Related documentation' : 'Source' })); links.appendChild(d.createTextNode(' · ')); }
        links.appendChild(el('a', { href: SC.url('/software/' + vid + '/#capabilities'), text: 'All evidence for ' + v.n }));
        pop.appendChild(links);
      }, 'Evidence could not load. Open the product profile for sources.');
    });
    // A cell button names its product and check, not only its status, and says it opens a dialog.
    $$('tbody tr', matrix).forEach(function (tr) {
      var what = $('[data-what]', tr);
      if (!what) return;
      var check = textOf(what);
      $$('td', tr).forEach(function (td, k) {
        var b = $('[data-c]', td);
        if (!b) return;
        b.setAttribute('aria-haspopup', 'dialog');
        if (!b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', 'false');
        b.setAttribute('aria-label', cellName(k, check, textOf(b)));
      });
    });
  }

  // ------------------------------------------------------------------ section menu under the page head
  // Category pages (scored and documentary): the section menu waits under the opaque page head until the head has
  // scrolled away (category.css). Keyboard focus raises it at once, which covered the end of the head (the answer's
  // last line, "How we score") for as long as focus stayed in the menu. Now, when focus enters the menu while the head
  // is still in view, the page scrolls until the menu sits where it sticks, right under the site header. The scroll
  // follows the page's scroll-behavior: smooth, or instant with reduced motion (the system setting or the site's own
  // preference, base.css and tokens.css). Once the menu sticks (the only state in which it can be clicked) nothing moves.
  var catTop = $('.cat-top'), catMenu = catTop && catTop.nextElementSibling;
  if (catMenu && catMenu.classList.contains('subnav')) {
    catMenu.addEventListener('focusin', function () {
      var dy = catMenu.getBoundingClientRect().top - (parseFloat(getComputedStyle(catMenu).top) || 0);
      if (dy > 1) window.scrollTo(0, Math.round((window.pageYOffset || d.documentElement.scrollTop) + dy));
    });
  }

  // ------------------------------------------------------------------ sort buttons of a stacked table
  // While the ranked table is stacked (phones, large text) its header row is clipped out of sight, so the sort
  // buttons in it must not be tab stops (the toolbar's Sort select does the same job); restored when wide.
  var thead = table && $('thead', table), sortBtns = thead ? $$('button', thead) : [], stackedNow = null;
  function syncSortStops() {
    var r = thead.getBoundingClientRect(), stacked = getComputedStyle(thead).position === 'absolute' || r.width < 2 || r.height < 2;
    if (stacked === stackedNow) return; // writing the same attributes again would cost another style pass
    stackedNow = stacked;
    sortBtns.forEach(function (b) { if (stacked) b.setAttribute('tabindex', '-1'); else b.removeAttribute('tabindex'); });
  }
  if (sortBtns.length) {
    // the observer reports the first size once the table is laid out: no measuring in the middle of page scripts
    if ('ResizeObserver' in window) new ResizeObserver(syncSortStops).observe(table);
    else { syncSortStops(); window.addEventListener('resize', syncSortStops); }
  }
})();
