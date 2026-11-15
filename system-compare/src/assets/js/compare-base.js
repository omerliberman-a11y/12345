/* System Compare — comparison basics: everything a server-rendered comparison (/vs/{id}/) needs, and what the
 * compare tool (compare.js, /compare/ only) builds on.
 *
 *  - the view control (Differences / Scored checks / All checks, kept in ?diff=) and #cap-<check> deep links
 *  - "Add both to shortlist", "Export evidence (CSV)" (same 12 columns as the previous site) and "Print"
 *  - table roles for the stacked layout on phones
 *  - SC.cmp: the shared model (the same arithmetic as src/lib/scoring.mjs) and helpers, for compare.js
 *
 * Copy link, the popovers and the sticky product bar need no code here (core.js and CSS).
 * Class names and structure mirror vs.mjs + css/pages/compare.css — change them together.
 * DOM is built with SC.el / textContent only.
 */
(function () {
  'use strict';
  var w = window, d = document, SC = w.SC;
  if (!SC || !SC.el) return;
  var el = SC.el, $ = SC.$, $$ = SC.$$;

  // ------------------------------------------------------------------ constants (same wording as the server templates)
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ST = { y: ['yes', 'Supported'], p: ['partial', 'Limited'], n: ['no', 'Not supported'], u: ['unknown', 'Not verified'] };
  var GROUP_ORDER = ['core', 'integrations', 'local', 'ai'];
  var BASE_WEIGHT = { core: 45, integrations: 20, local: 20, ai: 15 }; // the published group weights
  var VIEWS = { diff: 1, scored: 1, all: 1 };
  var MAX = 4;
  var CSV_HEAD = ['Category', 'Product', 'Evidence scope', 'Check', 'Support', 'Earned points', 'Possible points', 'Maximum points', 'Evidence coverage %', 'Note', 'Source', 'Checked at'];

  // ------------------------------------------------------------------ small helpers
  function fmtDate(iso) { return iso ? MON[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4) : ''; }
  function pt(v) { return Number(Number(v || 0).toFixed(1)).toString(); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function listText(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function add(node, kids) {
    (Array.isArray(kids) ? kids : [kids]).forEach(function (k) { if (k != null && k !== '') node.appendChild(typeof k === 'string' ? d.createTextNode(k) : k); });
    return node;
  }

  // ------------------------------------------------------------------ model: the same arithmetic as src/lib/scoring.mjs
  function buildModel(data, ids) {
    var counts = {}, activeBase = 0, byId = {}, groupLabel = {};
    data.groups.forEach(function (g) { groupLabel[g[0]] = g[1]; });
    var feats = data.features.map(function (f, idx) { return { idx: idx, id: f[0], label: f[1], group: f[2], active: !!f[3], desc: f[4] || '', tier: f[5] || '', demo: f[6] || '' }; });
    feats.forEach(function (f) { if (f.active) counts[f.group] = (counts[f.group] || 0) + 1; });
    GROUP_ORDER.forEach(function (g) { if (counts[g]) activeBase += BASE_WEIGHT[g]; });
    feats.forEach(function (f) { f.weight = f.active && activeBase && BASE_WEIGHT[f.group] ? ((BASE_WEIGHT[f.group] / activeBase) * 100) / counts[f.group] : 0; });
    data.vendors.forEach(function (v) { byId[v.id] = v; });
    var items = ids.map(function (id, i) { return { i: i, v: byId[id] }; });
    var rows = feats.map(function (f) {
      var seen = {}, kinds = 0;
      var cells = items.map(function (it) {
        var c = it.v.c[f.idx] || ['u'], st = ST[c[0]] ? c[0] : 'u';
        if (!seen[st]) { seen[st] = 1; kinds++; }
        return { st: st, note: c[1] || '', ver: c[2] || '', date: c[3] || '', src: c[4] || '', weight: f.weight, earned: f.weight * (st === 'y' ? 1 : st === 'p' ? 0.5 : 0) };
      });
      return { f: f, cells: cells, diff: kinds > 1 };
    });
    var active = rows.filter(function (r) { return r.f.active; });
    items.forEach(function (it) {
      it.groups = GROUP_ORDER.map(function (g) {
        var list = active.filter(function (r) { return r.f.group === g; });
        return {
          id: g, label: groupLabel[g] || g, total: list.length,
          checked: list.filter(function (r) { return r.cells[it.i].st !== 'u'; }).length,
          weight: list.reduce(function (s, r) { return s + r.f.weight; }, 0),
          earned: list.reduce(function (s, r) { return s + r.cells[it.i].earned; }, 0),
        };
      }).filter(function (g) { return g.total; });
      it.documented = active.filter(function (r) { var s = r.cells[it.i].st; return s === 'y' || s === 'p'; }).length;
    });
    var diff = active.filter(function (r) { return r.diff; });
    var inactive = rows.filter(function (r) { return !r.f.active; }), offDiff = inactive.filter(function (r) { return r.diff; });
    var byWeight = function (list) { return list.slice().sort(function (x, y) { return y.f.weight - x.f.weight; }); };
    return {
      data: data, items: items, rows: rows, active: active, inactive: inactive, diff: diff, offDiff: offDiff, allDiff: rows.filter(function (r) { return r.diff; }), groupLabel: groupLabel,
      // checks that are not scored yet and documented as supported for this product only (checklist order)
      aheadOff: items.map(function (it) {
        return offDiff.filter(function (r) { return r.cells[it.i].st === 'y' && r.cells.some(function (c, j) { return j !== it.i && c.st !== 'y'; }); });
      }),
      ahead: items.map(function (it) {
        return byWeight(diff.filter(function (r) { return r.cells[it.i].st === 'y' && r.cells.some(function (c, j) { return j !== it.i && c.st !== 'y'; }); }));
      }),
      other: byWeight(diff.filter(function (r) { return r.cells.every(function (c) { return c.st !== 'y'; }); })),
    };
  }
  /** Share of the scored checklist weight that is checked, unrounded (exact fraction like the server). */
  function coverage(it) {
    if (typeof BigInt === 'function') {
      var num = BigInt(0), den = BigInt(1), base = 0;
      it.groups.forEach(function (g) {
        var itemDen = BigInt(g.total);
        num = num * itemDen + BigInt(BASE_WEIGHT[g.id] * g.checked) * den;
        den = den * itemDen;
        base += BASE_WEIGHT[g.id];
      });
      return base ? Number(num * BigInt(100)) / Number(den * BigInt(base)) : 0;
    }
    var sum = 0, total = 0;
    it.groups.forEach(function (g) { sum += (BASE_WEIGHT[g.id] * g.checked) / g.total; total += BASE_WEIGHT[g.id]; });
    return total ? (sum / total) * 100 : 0;
  }

  // ------------------------------------------------------------------ CSV export (same 12 columns as the previous site)
  function toCsv(m) {
    var out = [CSV_HEAD];
    m.items.forEach(function (it) {
      var cov = coverage(it);
      m.rows.forEach(function (r) {
        var c = r.cells[it.i];
        out.push([m.data.name, it.v.n, 'Product-wide evidence', r.f.label, ST[c.st][1], pt(c.earned), pt(c.earned), pt(c.weight), cov, c.note, c.src, c.date]);
      });
    });
    var cell = function (value) {
      var text = String(value == null ? '' : value);
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; // spreadsheet formula-injection guard
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return out.map(function (row) { return row.map(cell).join(','); }).join('\r\n');
  }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type })), a = el('a', { href: url, download: name });
    d.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ------------------------------------------------------------------ view control (both pages)
  var current = null; // { root, category, ids }
  function query() { return new URLSearchParams(w.location.search); }
  function setQuery(q, push) {
    var s = q.toString(), url = w.location.pathname + (s ? '?' + s : '') + w.location.hash;
    try { w.history[push ? 'pushState' : 'replaceState'](null, '', url); } catch (e) { /* file:// */ }
  }
  function applyView(root, view, opts) {
    var table = $('[data-cmp-caps]', root);
    if (!table) return;
    if (!VIEWS[view]) view = 'scored';
    var shown = 0, shownScored = 0, scored = 0, total = 0, group = null, rows = $$('tbody tr', table), show = [];
    // read every row first, then write only what changes (no layout or style work for rows that stay as they are)
    rows.forEach(function (tr, i) {
      if (tr.classList.contains('cmp-group')) { show[i] = false; group = i; return; }
      var a = tr.getAttribute('data-a') === '1', differs = tr.getAttribute('data-d') === '1';
      var on = view === 'all' || (view === 'scored' ? a : differs); // "diff" = every differing check, scored or not
      total++; if (a) scored++;
      show[i] = on;
      if (on) { shown++; if (a) shownScored++; if (group != null) show[group] = true; }
    });
    rows.forEach(function (tr, i) { if (tr.hidden === show[i]) tr.hidden = !show[i]; });
    root.setAttribute('data-view', view);
    $$('[data-cmp-view] [data-view]', root).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false'); });
    var count = $('[data-cmp-count]', root);
    if (count) {
      count.textContent = '';
      if (view === 'diff') add(count, ['Showing the ', el('b', { text: String(shown) }), (shown === 1 ? ' check that differs' : ' checks that differ') + (shown === shownScored ? (shown === 1 ? '; it is scored.' : ', all scored.') : ': ' + shownScored + ' scored and ' + (shown - shownScored) + ' not scored yet.')]);
      else if (view === 'all') add(count, ['Showing all ', el('b', { text: String(total) }), ' checks: ' + scored + ' scored and ' + (total - scored) + ' not scored yet.']);
      else add(count, ['Showing the ', el('b', { text: String(shown) }), ' checks that count toward the score.']);
      count.hidden = !shown;
    }
    var empty = $('[data-cmp-empty]', root);
    if (empty) empty.hidden = shown > 0;
    table.hidden = !shown;
    if (!opts || opts.url !== false) {
      var q = query();
      if (view === 'scored') q.delete('diff'); else q.set('diff', view);
      setQuery(q, false);
    }
  }
  function viewFromUrl() { var v = query().get('diff'); return VIEWS[v] ? v : 'scored'; }
  /** #cap-<feature> may point at a row the current view hides: switch to a view that shows it and scroll to it. */
  function revealHash() {
    if (!current || !/^#cap-/.test(w.location.hash)) return;
    var row = d.getElementById(decodeURIComponent(w.location.hash.slice(1)));
    if (row && row.hidden && current.root.contains(row)) { applyView(current.root, row.getAttribute('data-d') === '1' ? 'diff' : 'all'); row.scrollIntoView(); }
  }

  /**
   * Below 1024px the rows are laid out as grids (two product columns under a full-width label), and browsers drop
   * the native table semantics of elements whose display changes. Stating the roles keeps the tables announced as
   * tables with row and column headers at every width.
   */
  function tableRoles(root) {
    $$('.cmp-table', root).forEach(function (t) {
      t.setAttribute('role', 'table');
      $$('thead, tbody', t).forEach(function (x) { x.setAttribute('role', 'rowgroup'); });
      $$('tr', t).forEach(function (x) { x.setAttribute('role', 'row'); });
      $$('td', t).forEach(function (x) { x.setAttribute('role', 'cell'); });
      $$('th', t).forEach(function (x) {
        x.setAttribute('role', x.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader');
        if (x.colSpan > 1) x.setAttribute('aria-colspan', String(x.colSpan));
      });
    });
  }

  // ------------------------------------------------------------------ tools (both pages)
  function sameList(o) {
    if (!current || o.category !== current.category) return false;
    return current.ids.every(function (id) { return o.ids.indexOf(id) >= 0; });
  }
  function syncSave() {
    var b = $('[data-cmp-save]');
    if (!b || !current) return;
    var onNow = sameList(SC.shortlist.get());
    b.setAttribute('aria-pressed', onNow ? 'true' : 'false');
    if (!b.getAttribute('data-label')) b.setAttribute('data-label', b.textContent);
    b.textContent = onNow ? 'In your shortlist ✓' : b.getAttribute('data-label');
  }
  function saveToShortlist() {
    if (!current) return;
    var o = SC.shortlist.get(), ids = current.ids.slice(0, MAX), category = current.category;
    var openLink = function () { return SC.shortlist.saved && !SC.shortlist.saved() ? null : { label: 'Open shortlist', href: SC.url('/shortlist/') }; };
    if (sameList(o)) { SC.toast('These products are already in your shortlist.', [openLink()]); return; }
    var merged = o.category === category ? o.ids.concat(ids.filter(function (id) { return o.ids.indexOf(id) < 0; })) : ids;
    // Where the shortlist tray shows the result (/vs/), it is confirmation enough: no toast, just an announcement.
    // Nothing is called saved unless the browser saved it: with saved data blocked the list lasts for this page.
    var done = function (ok, msg) {
      if (ok === false) { SC.toast('This browser is blocking saved data, so these products are in your shortlist only until you leave this page.'); return; }
      if (d.body.getAttribute('data-page') !== 'compare' && SC.announce) SC.announce(msg);
      else SC.toast(msg, [openLink()]);
    };
    var replace = function () { done(SC.shortlist.replace(ids, category), 'Shortlist saved in this browser.'); };
    if (!o.ids.length) return replace();
    if (o.category !== category) {
      SC.toast('Your shortlist holds ' + plural(o.ids.length, 'product') + ' from another category.', [{ label: 'Replace it with this comparison', fn: replace }]);
      return;
    }
    if (merged.length > MAX) {
      SC.toast('A shortlist holds up to ' + MAX + ' products.', [{ label: 'Replace it with this comparison', fn: replace }]);
      return;
    }
    done(SC.shortlist.replace(merged, category), 'Added to your shortlist.');
  }
  function exportCsv() {
    if (!current) return;
    var ids = current.ids;
    SC.load('cat-' + current.category).then(function (data) {
      var known = {};
      data.vendors.forEach(function (v) { known[v.id] = 1; });
      download('system-compare-evidence.csv', toCsv(buildModel(data, ids.filter(function (id) { return known[id]; }))), 'text/csv;charset=utf-8');
    }).catch(function () { SC.toast('The evidence file could not be prepared. Please try again.'); });
  }
  d.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-cmp-save],[data-cmp-export],[data-cmp-print],[data-view]');
    if (!t || !current) return;
    if (t.hasAttribute('data-cmp-save')) saveToShortlist();
    else if (t.hasAttribute('data-cmp-export')) exportCsv();
    else if (t.hasAttribute('data-cmp-print')) w.print();
    else if (current.root.contains(t)) applyView(current.root, t.getAttribute('data-view'));
  });
  d.addEventListener('sc:shortlist-updated', syncSave);
  w.addEventListener('hashchange', revealHash);

  // ------------------------------------------------------------------ shared with the compare tool (compare.js)
  SC.cmp = {
    ST: ST, GROUP_ORDER: GROUP_ORDER, MAX: MAX, MON: MON,
    fmtDate: fmtDate, pt: pt, plural: plural, listText: listText, add: add,
    buildModel: buildModel, coverage: coverage, toCsv: toCsv,
    query: query, setQuery: setQuery, applyView: applyView, viewFromUrl: viewFromUrl, revealHash: revealHash, tableRoles: tableRoles, syncSave: syncSave,
    /** The comparison on screen ({ root, category, ids }), or null while none is (the tool's pickers). */
    current: function (c) { if (arguments.length) current = c; return current; },
  };

  // ================================================================== /vs/ — server-rendered component
  var serverRoot = $('[data-cmp]');
  if (serverRoot) {
    current = { root: serverRoot, category: serverRoot.getAttribute('data-category'), ids: (serverRoot.getAttribute('data-ids') || '').split(' ').filter(Boolean) };
    var v0 = viewFromUrl();
    if (v0 !== 'scored') applyView(serverRoot, v0, { url: false });
    tableRoles(serverRoot);
    revealHash();
    syncSave();
  }
})();
