/* System Compare — comparison component.
 *
 *  /vs/{id}/   the component is server-rendered (src/pages/vs.mjs); this script adds the view control
 *              (Differences / Scored checks / All checks, kept in ?diff=), the tools row and deep links to rows.
 *  /compare/   the component is rendered here for any 2–4 products of one scored category from
 *              /data/cat-<id>.js. URL contract: ?scope=<category>&a=&b=&c=&d= (legacy w_* and plan_* are
 *              accepted and ignored). With no selection the page is a picker — never a default pair.
 *
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
  var VER = { d: 'Official documentation', v: 'Vendor confirmed', '': 'Not verified' };
  var GROUP_ORDER = ['core', 'integrations', 'local', 'ai'];
  var BASE_WEIGHT = { core: 45, integrations: 20, local: 20, ai: 15 }; // the published group weights
  var TIER = { foundation: 'Foundation check', advanced: 'Shared deep check' };
  var GATE = 'Shown after at least 80% of the checklist weight is checked.';
  var INACTIVE = 'Not included in the score: this deep check has not been checked for every listed vendor.';
  var VIEWS = { diff: 1, scored: 1, all: 1 };
  var SLOTS = ['a', 'b', 'c', 'd'], MAX = 4;
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var CSV_HEAD = ['Category', 'Product', 'Evidence scope', 'Check', 'Support', 'Earned points', 'Possible points', 'Maximum points', 'Evidence coverage %', 'Note', 'Source', 'Checked at'];

  // ------------------------------------------------------------------ small helpers
  function fmtDate(iso) { return iso ? MON[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4) : ''; }
  function timeEl(iso) { return el('time', { datetime: iso.slice(0, 10), text: fmtDate(iso) }); }
  function pt(v) { return Number(Number(v || 0).toFixed(1)).toString(); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function listText(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function add(node, kids) {
    (Array.isArray(kids) ? kids : [kids]).forEach(function (k) { if (k != null && k !== '') node.appendChild(typeof k === 'string' ? d.createTextNode(k) : k); });
    return node;
  }
  function dot() { return el('i.cmp-dot', { 'aria-hidden': 'true' }); }
  function ext(url, label) { return el('a.ext', { href: url, target: '_blank', rel: 'noopener noreferrer', text: label }); }
  function hasAmount(v) { return /\d/.test(v.pr.h); }
  function priceText(v) { return hasAmount(v) ? v.pr.h + (v.pr.u ? ' ' + v.pr.u : '') : v.pr.h; }
  function scoreText(v) { return v.pe ? 'pending' : v.sc + '/100'; }

  function logo(v, size, lazy) {
    var node = el('span.logo' + (size ? '.logo--' + size : '') + (v.dk ? '.logo--dark' : ''));
    if (v.lg) node.appendChild(el('img', { src: SC.url(v.lg), alt: v.n + ' logo', width: 64, height: 64, loading: lazy ? 'lazy' : null, decoding: 'async' }));
    else {
      node.setAttribute('aria-hidden', 'true');
      node.appendChild(el('span.logo__fallback', { text: v.n.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map(function (x) { return x[0]; }).slice(0, 2).join('').toUpperCase() }));
    }
    return node;
  }
  function statusEl(code) { var s = ST[code] || ST.u; return el('span.st.st--' + s[0], { text: s[1] }); }
  function scoreToken(v, size) {
    var cls = 'span.score' + (v.pe ? '.score--pending' : '') + (size ? '.score--' + size : '');
    if (v.pe) return el(cls, null, [el('span.score__value', { text: 'Score pending' }), el('span.score__meta', { text: v.ck + '/' + v.to + ' checked · ' + v.cov + '%' })]);
    return el(cls, null, [el('span.score__value.num', null, [String(v.sc), el('small', { text: '/100' })]), el('span.score__meta', { text: v.ck + '/' + v.to + ' checked' })]);
  }
  function priceCell(v, opts) {
    var p = v.pr, unit = [p.u, p.b].filter(Boolean).join(' · ');
    var node = el('span.price', null, [el('span.price__main' + (hasAmount(v) ? '.num' : '.price__main--text'), { text: p.h })]);
    if (hasAmount(v) && unit) node.appendChild(el('span.price__unit', { text: unit }));
    if (opts && opts.plan && p.pl) node.appendChild(el('span.price__unit', { text: p.pl + ' plan' }));
    if (opts && opts.checked && p.d) node.appendChild(el('span.price__unit', null, ['Checked ', timeEl(p.d)]));
    return node;
  }
  function aiTag(v) { return el('span.tag' + (/^(Native AI|AI agents|AI assistant)$/.test(v.ai) ? '.tag--brand' : ''), { text: v.ai }); }
  function listEl(arr, empty) {
    if (!arr || !arr.length) return el('span.cmp-none', { text: empty });
    return el('ul.cmp-list', null, arr.map(function (x) { return el('li', { text: x }); }));
  }
  /** Outbound vendor link through the /go/ contract, with the affiliate label when it applies. */
  function outLink(v) {
    var a = el('a.btn.btn--ghost.btn--sm.ext', {
      href: SC.url(v.go), target: '_blank', rel: (v.aff ? 'sponsored ' : '') + 'nofollow noopener noreferrer', text: 'Visit ' + v.n,
      'data-vendor-id': v.id, 'data-outbound-intent': 'website', 'data-outbound-placement': 'comparison', 'data-outbound-affiliate': v.aff ? 'true' : 'false', 'data-destination-host': v.host || null,
    });
    var box = el('span.commercial-link' + (v.aff ? '.commercial-link--ad' : ''), null, [a]);
    if (v.aff) add(box, [' ', el('span.tag.tag--ad', { text: 'Ad · affiliate link' }), ' ', el('span.fineprint', { text: 'We may earn a commission if you buy through this link.' })]);
    return box;
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
    var byWeight = function (list) { return list.slice().sort(function (x, y) { return y.f.weight - x.f.weight; }); };
    return {
      data: data, items: items, rows: rows, active: active, inactive: rows.filter(function (r) { return !r.f.active; }), diff: diff, groupLabel: groupLabel,
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
    var shown = 0, scored = 0, total = 0, group = null;
    $$('tbody tr', table).forEach(function (tr) {
      if (tr.classList.contains('cmp-group')) { tr.hidden = true; group = tr; return; }
      var a = tr.getAttribute('data-a') === '1', differs = tr.getAttribute('data-d') === '1';
      var show = view === 'all' || (a && (view === 'scored' || differs));
      total++; if (a) scored++;
      tr.hidden = !show;
      if (show) { shown++; if (group) group.hidden = false; }
    });
    root.setAttribute('data-view', view);
    $$('[data-cmp-view] [data-view]', root).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false'); });
    var count = $('[data-cmp-count]', root);
    if (count) {
      count.textContent = '';
      if (view === 'diff') add(count, ['Showing the ', el('b', { text: String(shown) }), ' scored ' + (shown === 1 ? 'check that differs.' : 'checks that differ.')]);
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
  /** #cap-<feature> may point at a row the current view hides: switch to "All checks" and scroll to it. */
  function revealHash() {
    if (!current || !/^#cap-/.test(w.location.hash)) return;
    var row = d.getElementById(decodeURIComponent(w.location.hash.slice(1)));
    if (row && row.hidden && current.root.contains(row)) { applyView(current.root, 'all'); row.scrollIntoView(); }
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
    if (sameList(o)) { SC.toast('These products are already in your shortlist.', [{ label: 'Open shortlist', href: SC.url('/shortlist/') }]); return; }
    var merged = o.category === category ? o.ids.concat(ids.filter(function (id) { return o.ids.indexOf(id) < 0; })) : ids;
    var replace = function () { SC.shortlist.replace(ids, category); SC.toast('Shortlist saved in this browser.', [{ label: 'Open shortlist', href: SC.url('/shortlist/') }]); };
    if (!o.ids.length) return replace();
    if (o.category !== category) {
      SC.toast('Your shortlist holds ' + plural(o.ids.length, 'product') + ' from another category.', [{ label: 'Replace it with this comparison', fn: replace }]);
      return;
    }
    if (merged.length > MAX) {
      SC.toast('A shortlist holds up to ' + MAX + ' products.', [{ label: 'Replace it with this comparison', fn: replace }]);
      return;
    }
    SC.shortlist.replace(merged, category);
    SC.toast('Added to your shortlist.', [{ label: 'Open shortlist', href: SC.url('/shortlist/') }]);
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

  // ================================================================== /vs/ — server-rendered component
  var serverRoot = $('[data-cmp]');
  if (serverRoot) {
    current = { root: serverRoot, category: serverRoot.getAttribute('data-category'), ids: (serverRoot.getAttribute('data-ids') || '').split(' ').filter(Boolean) };
    var v0 = viewFromUrl();
    if (v0 !== 'scored') applyView(serverRoot, v0, { url: false });
    revealHash();
    syncSave();
    return;
  }

  // ================================================================== /compare/ — client-rendered tool
  var mount = $('[data-cmp-mount]');
  if (!mount) return;
  var picker = $('[data-cmp-picker]'), titleEl = $('[data-cmp-title]'), ledeEl = $('[data-cmp-lede]');
  var TITLE0 = titleEl ? titleEl.textContent : '', DOC0 = d.title;
  var cats = {}; // scored categories, read from the server-rendered picker: id → { name, vs: [pair ids] }
  $$('[data-scope]', picker).forEach(function (a) {
    cats[a.getAttribute('data-scope')] = { name: $('span', a).textContent, vs: (a.getAttribute('data-vs') || '').split(' ').filter(Boolean) };
  });
  var live = el('p.sr-only', { role: 'status', 'aria-live': 'polite' });
  d.body.appendChild(live);
  var pairState = { key: '', pair: [0, 1] };
  var token = 0; // guards against out-of-order data loads

  function readState() {
    var q = query(), seen = {}, ids = [], plans = false, scope = q.get('scope') || '';
    SLOTS.forEach(function (k) {
      var id = q.get(k);
      if (q.get('plan_' + k)) plans = true;
      if (id && SLUG.test(id) && !seen[id]) { seen[id] = 1; ids.push(id); }
    });
    return { scope: SLUG.test(scope) ? scope : '', rawScope: scope, ids: ids, plans: plans, pick: q.get('pick') === '1' };
  }
  /**
   * Canonical query for a selection; legacy w_* and plan_* parameters are dropped, anything else is kept.
   * pick=1 means "still choosing": the product list is shown with these products ticked.
   */
  function writeState(scope, ids, push, picking) {
    var q = query(), drop = [];
    q.forEach(function (v, k) { if (/^w_/.test(k) || /^plan_[a-d]$/.test(k) || SLOTS.indexOf(k) >= 0 || k === 'scope' || k === 'pick') drop.push(k); });
    drop.forEach(function (k) { q.delete(k); });
    var next = new URLSearchParams(), comparing = ids && ids.length >= 2 && !picking;
    if (scope) next.set('scope', scope);
    (ids || []).slice(0, MAX).forEach(function (id, i) { next.set(SLOTS[i], id); });
    if (picking && ids && ids.length >= 2) next.set('pick', '1');
    q.forEach(function (v, k) { if (k !== 'diff' || comparing) next.append(k, v); });
    setQuery(next, push);
  }
  function go(scope, ids) { writeState(scope, ids, true); route(true); }
  function setTitle(text) {
    if (titleEl) titleEl.textContent = text || TITLE0;
    if (ledeEl) ledeEl.hidden = !!text;
    d.title = text ? text + ' | Compare | System Compare US' : DOC0;
  }
  function focusTop(node) { if (node) { node.setAttribute('tabindex', '-1'); node.focus({ preventScroll: true }); } w.scrollTo(0, 0); }
  function notice(text, kids) { return el('div.wrap.cmp-notice', null, [add(el('p.note', { role: 'note' }), [el('span', null, [text].concat(kids || []))])]); }

  // ------------------------------------------------------------------ router
  function route(userAction) {
    var s = readState(), mine = ++token;
    if (!s.scope && !s.ids.length) return showCategories(s.rawScope ? notice('That category link is not valid. Choose a category below.') : null, userAction);
    if (!s.scope) {
      // ids without a category: use the first product's main category
      return SC.load('vendors').then(function (V) {
        if (mine !== token) return;
        var hit = s.ids.map(function (id) { return V.vendors[id] && V.vendors[id][3]; }).filter(function (c) { return c && cats[c]; })[0];
        if (!hit) return showCategories(notice('We could not find those products. Choose a category to start a comparison.'), userAction);
        writeState(hit, s.ids, false);
        route(userAction);
      }).catch(function () { showCategories(null, userAction); });
    }
    if (!cats[s.scope]) {
      return showCategories(notice('“' + s.scope + '” is not a scored category, so it has no side-by-side comparison here. ', [el('a', { href: SC.url('/categories/'), text: 'Browse all categories' }), '.']), userAction);
    }
    setTitle('');
    picker.hidden = true;
    var slow = setTimeout(function () { if (mine === token) { mount.textContent = ''; mount.appendChild(el('div.wrap', null, [el('p.cmp-loading', { text: 'Loading ' + cats[s.scope].name + '…' })])); } }, 250);
    SC.load('cat-' + s.scope).then(function (data) {
      clearTimeout(slow);
      if (mine !== token) return;
      var known = {};
      data.vendors.forEach(function (v) { known[v.id] = 1; });
      var valid = s.ids.filter(function (id) { return known[id]; }).slice(0, MAX), invalid = s.ids.filter(function (id) { return !known[id]; });
      var picking = s.pick || valid.length < 2;
      writeState(s.scope, valid, false, picking);
      var notes = [];
      if (invalid.length) notes.push(notice((invalid.length === 1 ? '“' + invalid[0] + '” is' : invalid.map(function (x) { return '“' + x + '”'; }).join(', ') + ' are') + ' not in ' + data.name + ' and ' + (invalid.length === 1 ? 'was' : 'were') + ' left out.'));
      if (s.plans && valid.length >= 2) notes.push(notice('This comparison uses product-wide evidence. Plan-level details are on each product profile.'));
      if (picking) showProducts(data, valid, notes, userAction);
      else renderComparison(data, valid, notes, userAction);
    }).catch(function () {
      clearTimeout(slow);
      if (mine !== token) return;
      showCategories(notice('The comparison data could not be loaded. Check your connection and try again.'), userAction);
    });
  }

  // ------------------------------------------------------------------ empty state, step 1: choose a category
  function showCategories(note, userAction) {
    current = null;
    setTitle('');
    mount.textContent = '';
    if (note) mount.appendChild(note);
    picker.hidden = false;
    renderSaved();
    if (userAction) focusTop($('h2', picker));
  }
  function renderSaved() {
    var box = $('[data-cmp-saved]', picker), o = SC.shortlist.get();
    box.textContent = '';
    if (!o.ids.length || !cats[o.category]) return;
    SC.load('vendors').then(function (V) {
      var ids = o.ids.filter(function (id) { return V.vendors[id]; }).slice(0, MAX);
      if (!ids.length) return;
      var names = ids.map(function (id) { return V.vendors[id][0]; });
      var btn = el('a.btn', { href: SC.shortlist.compareUrl({ category: o.category, ids: ids }), text: ids.length >= 2 ? 'Compare your shortlist (' + ids.length + ')' : 'Choose products to compare with ' + names[0] });
      btn.addEventListener('click', function (e) { e.preventDefault(); go(o.category, ids); });
      box.textContent = '';
      box.appendChild(el('div.cmp-saved', null, [
        el('div', null, [el('b', { text: 'Your shortlist' }), el('span', { text: names.join(', ') + ' · ' + cats[o.category].name })]),
        btn,
      ]));
    }).catch(function () {});
  }
  d.addEventListener('sc:shortlist-updated', function () { if (!picker.hidden) renderSaved(); });
  // category filter + category links
  var filter = $('[data-cmp-filter]', picker);
  if (filter) filter.addEventListener('input', function () {
    var terms = filter.value.toLowerCase().split(/\s+/).filter(Boolean), any = false;
    $$('[data-group]', picker).forEach(function (g) {
      var groupText = $('h3', g).textContent.toLowerCase(), shown = 0;
      $$('li', g).forEach(function (li) {
        var text = li.textContent.toLowerCase() + ' ' + groupText;
        var ok = terms.every(function (t) { return text.indexOf(t) >= 0; });
        li.hidden = !ok; if (ok) shown++;
      });
      g.hidden = !shown; if (shown) any = true;
    });
    $('[data-cmp-nocat]', picker).hidden = any;
  });
  picker.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-scope]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    go(a.getAttribute('data-scope'), []);
  });

  // ------------------------------------------------------------------ empty state, step 2: tick 2–4 products
  function showProducts(data, preselected, notes, userAction) {
    current = null;
    setTitle('');
    if (ledeEl) ledeEl.hidden = true;
    picker.hidden = true;
    mount.textContent = '';
    (notes || []).forEach(function (x) { mount.appendChild(x); });
    var picked = preselected.slice(), byId = {};
    data.vendors.forEach(function (v) { byId[v.id] = v; });

    var back = el('button.cmp-back', { type: 'button', text: '← All categories', on: { click: function () { go('', []); } } });
    var h2 = el('h2', null, [el('span.cmp-stepno', { text: '2' }), 'Choose two to four ' + data.name + ' products']);
    var tbody = el('tbody');
    data.vendors.forEach(function (v, i) {
      var btn = el('button.pick', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Select ' + v.n });
      var name = el('span.prod__text', null, [el('span.prod__name', { text: v.n })]);
      if (v.rec) name.appendChild(el('span.tag.tag--top', { text: 'Recommended' }));
      name.appendChild(el('span.prod__fit', { text: v.bf }));
      tbody.appendChild(el('tr', { 'data-id': v.id }, [
        el('td.ptable__c-pick', null, [btn]),
        el('td.ptable__c-rank.num', { text: String(v.rk || i + 1) }),
        el('th.ptable__c-name', { scope: 'row' }, [el('span.prod', null, [logo(v, '', i > 5), name])]),
        el('td.ptable__c-score', null, [scoreToken(v)]),
        el('td.ptable__c-price', null, [priceCell(v)]),
      ]));
    });
    var table = el('table.ptable.cmp-ptable', null, [
      el('caption.sr-only', { text: data.name + ': choose two to four products to compare' }),
      el('thead', null, [el('tr', null, [
        el('th.ptable__c-pick', { scope: 'col' }, [el('span.sr-only', { text: 'Select' })]),
        el('th.ptable__c-rank', { scope: 'col', text: '#' }),
        el('th.ptable__c-name', { scope: 'col', text: 'Product' }),
        el('th.ptable__c-score', { scope: 'col', text: 'Score' }),
        el('th.ptable__c-price', { scope: 'col', text: 'Starting price' }),
      ])]),
      tbody,
    ]);
    var countEl = el('span.cmp-go__n', { role: 'status', 'aria-live': 'polite' });
    var goBtn = el('button.btn', { type: 'button', on: { click: function () { if (picked.length >= 2) go(data.id, picked); } } });
    var bar = el('div.cmp-go', null, [el('div.wrap.cmp-go__in', null, [countEl, goBtn])]);
    function sync() {
      $$('tr', tbody).forEach(function (tr) {
        var id = tr.getAttribute('data-id'), onNow = picked.indexOf(id) >= 0, b = $('.pick', tr), full = !onNow && picked.length >= MAX;
        b.setAttribute('aria-pressed', onNow ? 'true' : 'false');
        b.setAttribute('aria-label', (onNow ? 'Remove ' : 'Select ') + byId[id].n);
        tr.classList.toggle('is-picked', onNow);
        tr.classList.toggle('is-full', full);
      });
      countEl.textContent = '';
      add(countEl, picked.length ? [el('b', { text: picked.length + ' of ' + MAX }), ' selected: ' + picked.map(function (id) { return byId[id].n; }).join(', ')] : ['Tick two to four products.']);
      goBtn.disabled = picked.length < 2;
      goBtn.textContent = picked.length < 2 ? 'Select ' + (picked.length ? 'one more' : 'two products') : 'Compare ' + picked.length + ' products';
    }
    tbody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr) return;
      var id = tr.getAttribute('data-id'), at = picked.indexOf(id);
      if (at >= 0) picked.splice(at, 1);
      else if (picked.length >= MAX) { SC.toast('You can compare up to four products. Remove one to add ' + byId[id].n + '.'); return; }
      else picked.push(id);
      sync();
      writeState(data.id, picked, false, true); // a reload restores the ticks; the comparison opens only after "Compare"
    });
    sync();

    var sec = el('section.wrap.cmp-step', { 'aria-label': 'Choose products' }, [
      back,
      el('div.cmp-step__head', null, [h2, el('p', { text: 'Ranked by documented-fit score on the same ' + data.name + ' checklist. Tick two to four, then compare.' })]),
      table,
    ]);
    var ready = (cats[data.id] ? cats[data.id].vs : []).map(function (id) {
      var pair = id.split('-vs-');
      return pair.length === 2 && byId[pair[0]] && byId[pair[1]] ? { href: SC.url('/vs/' + id + '/'), label: byId[pair[0]].n + ' vs ' + byId[pair[1]].n } : null;
    }).filter(Boolean);
    if (ready.length) {
      sec.appendChild(el('h3.cmp-step__h', { text: 'Ready-made head-to-heads' }));
      sec.appendChild(el('div.chips', null, ready.map(function (r) { return el('a.chip.chip--link', { href: r.href, text: r.label }); })));
    }
    mount.appendChild(sec);
    mount.appendChild(bar);
    if (userAction) focusTop(h2);
  }

  // ------------------------------------------------------------------ comparison (same structure as vs.mjs)
  function verdictOf(m) {
    var items = m.items, n = items.length, scored = items.filter(function (it) { return !it.v.pe; }), pending = items.filter(function (it) { return it.v.pe; });
    var nm = function (it) { return it.v.n; }, ns = function (it) { return it.v.n + ' (' + it.v.sc + '/100)'; };
    if (!scored.length) return { kind: 'none', text: 'No verdict yet: ' + (n === 2 ? 'both scores are' : 'all ' + n + ' scores are') + ' pending because less than 80% of the checklist weight is checked for each product.' };
    if (pending.length) {
      return {
        kind: 'partial',
        text: n === 2
          ? 'Only ' + nm(scored[0]) + ' has a published score (' + scored[0].v.sc + '/100). ' + nm(pending[0]) + ' is still score-pending, so the two cannot be ranked against each other yet.'
          : 'Only ' + listText(scored.map(ns)) + ' ' + (scored.length === 1 ? 'has' : 'have') + ' a published score. ' + listText(pending.map(nm)) + ' ' + (pending.length === 1 ? 'is' : 'are') + ' still score-pending, so the products cannot all be ranked against each other yet.',
      };
    }
    var top = Math.max.apply(null, items.map(function (it) { return it.v.sc; }));
    var leaders = items.filter(function (it) { return it.v.sc === top; }), rest = items.filter(function (it) { return it.v.sc !== top; });
    var tail = ' A higher score means more of the checklist is documented, not that the product is better for every team.';
    if (!rest.length) return { kind: 'tie', text: (n === 2 ? nm(items[0]) + ' and ' + nm(items[1]) : listText(items.map(nm))) + ' have the same documented-fit score (' + top + '/100). Choose on the differences below, on price and on fit for your team.' };
    if (n === 2) return { kind: 'lead', leader: leaders[0], text: nm(leaders[0]) + ' has the higher documented-fit score: ' + top + '/100 against ' + rest[0].v.sc + '/100 for ' + nm(rest[0]) + '.' + tail };
    if (leaders.length === 1) return { kind: 'lead', leader: leaders[0], text: nm(leaders[0]) + ' has the highest documented-fit score of the ' + n + ': ' + top + '/100, ahead of ' + listText(rest.map(ns)) + '.' + tail };
    return { kind: 'tie', text: listText(leaders.map(nm)) + ' share the highest documented-fit score (' + top + '/100), ahead of ' + listText(rest.map(ns)) + '.' + tail };
  }

  function tableEl(m, cls, caption, headLabel, rows, attrs) {
    var cols = el('colgroup', null, [el('col.cmp-col-l')].concat(m.items.map(function () { return el('col'); })));
    var head = el('thead.cmp-thead', null, [el('tr', null, [el('th', { scope: 'col', text: headLabel })].concat(m.items.map(function (it) { return el('th', { scope: 'col', 'data-i': it.i, text: it.v.n }); })))]);
    var t = el('table.cmp-table' + (cls || ''), attrs || null, [el('caption.sr-only', { text: caption }), cols, head, el('tbody', null, rows.filter(Boolean))]);
    return t;
  }
  function rowEl(m, label, cellFn, sub) {
    var th = el('th', { scope: 'row', text: label });
    if (sub) th.appendChild(el('small', { text: sub }));
    return el('tr', null, [th].concat(m.items.map(function (it) { return add(el('td', { 'data-i': it.i }), cellFn(it)); })));
  }
  function names(m, joiner) { return m.items.map(function (it) { return it.v.n; }).join(joiner || ' vs '); }

  function renderComparison(data, ids, notes, userAction) {
    var m = buildModel(data, ids), n = m.items.length, verdict = verdictOf(m), pairName = names(m);
    var others = data.vendors.filter(function (v) { return ids.indexOf(v.id) < 0; });
    var key = data.id + ':' + ids.join(',');
    if (pairState.key !== key) pairState = { key: key, pair: [0, 1] };
    picker.hidden = true;
    setTitle(pairName);
    mount.textContent = '';
    (notes || []).forEach(function (x) { mount.appendChild(x); });
    if (m.items.some(function (it) { return it.v.aff; })) {
      mount.appendChild(el('div.wrap.cmp-notice', null, [el('p.note', { role: 'note' }, [el('span.tag.tag--ad', { text: 'Ad' }), el('span', null, [
        el('strong', { text: 'Affiliate advertising.' }), ' Some links on this page are marked “Ad · affiliate link”. We may earn a commission if you buy through them. Commissions never change a score or a ranking. ',
        el('a', { href: SC.url('/how-we-make-money/'), text: 'How we make money' }),
      ])])]));
    }

    // ---- context line, verdict, tools
    var dates = m.rows.reduce(function (acc, r) { r.cells.forEach(function (c) { if (c.date) acc.push(c.date); }); return acc; }, []).sort();
    var trust = el('p.trustline', null, [
      el('span', null, [el('a', { href: SC.url('/categories/' + data.id + '/'), text: data.name })]),
      el('span', null, dates.length ? (dates[0] === dates[dates.length - 1] ? ['Evidence checked ', timeEl(dates[0])] : ['Evidence checked ', timeEl(dates[0]), ' to ', timeEl(dates[dates.length - 1])]) : ['Evidence checked ', timeEl(data.asOf)]),
      el('span', { text: 'Same ' + m.rows.length + '-point checklist, ' + m.active.length + ' checks scored' }),
      el('span', { text: 'Desk research, not hands-on testing' }),
      el('span', null, [el('a', { href: SC.url('/methodology/'), text: 'How we score' })]),
    ]);
    var staticId = n === 2 ? (cats[data.id].vs.filter(function (id) { return id === ids[0] + '-vs-' + ids[1] || id === ids[1] + '-vs-' + ids[0]; })[0] || '') : '';
    var staticUrl = staticId ? SC.url('/vs/' + staticId + '/') : '';
    var tools = el('div.cmp-tools', { 'data-cmp-tools': true }, [
      el('button.btn.btn--ghost.btn--sm', { type: 'button', 'data-copy': staticUrl ? new URL(staticUrl, w.location.href).href : 'url', text: 'Copy link' }),
      el('button.btn.btn--ghost.btn--sm', { type: 'button', 'data-cmp-save': true, text: n === 2 ? 'Add both to shortlist' : 'Add all ' + n + ' to shortlist' }),
      el('button.btn.btn--ghost.btn--sm', { type: 'button', 'data-cmp-export': true, text: 'Export evidence (CSV)' }),
      el('button.btn.btn--ghost.btn--sm', { type: 'button', 'data-cmp-print': true, text: 'Print' }),
      el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Change products', on: { click: function () { writeState(data.id, ids, true, true); route(true); } } }),
      staticUrl ? el('a.link-arrow.cmp-tools__more', { href: staticUrl, text: 'Full ' + pairName + ' page' }) : null,
    ]);
    mount.appendChild(el('div.wrap.cmp-answer.cmp-answer--tool', null, [
      trust,
      el('p.cmp-verdict', { 'data-kind': verdict.kind }, [el('b', { text: 'Verdict' }), ' ' + verdict.text]),
      tools,
    ]));

    // ---- sticky product header
    var optionText = function (v) { return v.n + ' — ' + (v.pe ? 'score pending' : v.sc + '/100'); };
    var slots = m.items.map(function (it) {
      var v = it.v;
      var swap = el('select', { 'aria-label': 'Replace ' + v.n + ' with another ' + data.name + ' product' }, [el('option', { value: '', text: 'Replace ' + v.n + ' with…' })].concat(
        data.vendors.map(function (o) { return el('option', { value: o.id, text: optionText(o), disabled: ids.indexOf(o.id) >= 0 }); })));
      swap.addEventListener('change', function () {
        if (!swap.value) return;
        var next = ids.slice(); next[it.i] = swap.value;
        live.textContent = v.n + ' replaced.';
        go(data.id, next);
      });
      return el('div.cmp-slot', { 'data-i': it.i }, [
        dot(), logo(v, 'sm'),
        el('div.cmp-slot__text', null, [
          el('a.cmp-slot__name', { href: SC.url('/software/' + v.id + '/'), text: v.n }),
          el('span.cmp-slot__meta', null, [
            el('span.cmp-slot__score', null, v.pe ? ['Score pending'] : [el('b.num', { text: String(v.sc) }), '/100']),
            el('span.cmp-slot__price', { text: priceText(v) }),
          ]),
        ]),
        others.length ? el('label.cmp-slot__swap', { title: 'Change product' }, [swap]) : null,
        el('button.cmp-slot__x', { type: 'button', 'aria-label': 'Remove ' + v.n + ' from the comparison', text: '×', on: { click: function () {
          live.textContent = v.n + ' removed.';
          go(data.id, ids.filter(function (id) { return id !== v.id; }));
        } } }),
      ]);
    });
    var ctx = el('div.cmp-bar__ctx', null, [el('span', { text: 'Comparing in' }), el('a', { href: SC.url('/categories/' + data.id + '/'), text: data.name })]);
    var addSel = null;
    if (n < MAX && others.length) {
      addSel = el('select.select.select--sm.cmp-add', { 'aria-label': 'Add a product to the comparison' }, [el('option', { value: '', text: '+ Add product' })].concat(others.map(function (o) { return el('option', { value: o.id, text: optionText(o) }); })));
      addSel.addEventListener('change', function () {
        if (!addSel.value) return;
        live.textContent = 'Product added.';
        go(data.id, ids.concat([addSel.value]));
      });
    }
    var root = el('div.cmp.cmp--n' + n, { 'data-cmp': true, 'data-category': data.id, 'data-ids': ids.join(' '), 'data-view': 'scored' });
    var pairRow = null;
    if (n > 2) {
      pairRow = el('div.cmp-pair', { role: 'group', 'aria-label': 'Which two products are shown side by side' }, m.items.map(function (it) {
        return el('button.cmp-pair__btn', { type: 'button', 'data-i': it.i, 'aria-pressed': 'false', on: { click: function () {
          if (pairState.pair.indexOf(it.i) >= 0) return;
          pairState.pair = [pairState.pair[1], it.i];
          syncPair();
        } } }, [dot(), logo(it.v, 'sm'), el('span', { text: it.v.n })]);
      }));
    }
    function syncPair() {
      var hide = m.items.map(function (it) { return it.i; }).filter(function (i) { return n > 2 && pairState.pair.indexOf(i) < 0; });
      root.setAttribute('data-hide', hide.join(' '));
      if (pairRow) $$('button', pairRow).forEach(function (b) { b.setAttribute('aria-pressed', pairState.pair.indexOf(Number(b.getAttribute('data-i'))) >= 0 ? 'true' : 'false'); });
    }
    var barGrid = el('div.cmp-bar__grid', null, [ctx].concat(slots));
    var addBox = addSel ? el('div.cmp-bar__add', null, [addSel]) : null;
    if (addBox) ctx.appendChild(addBox);
    root.appendChild(el('div.cmp-bar', { 'data-cmp-bar': true }, [el('div.wrap', null, [barGrid, pairRow])]));

    // ---- at a glance
    var leads = function (it) { return verdict.kind === 'lead' && verdict.leader === it; };
    var glanceRows = [
      rowEl(m, 'Documented-fit score', function (it) {
        return [scoreToken(it.v, 'lg'), leads(it) ? el('span.tag.tag--top', { text: n === 2 ? 'Higher documented fit' : 'Highest documented fit' }) : null, it.v.pe ? el('small', { text: GATE }) : null];
      }),
      rowEl(m, 'Points by score group', function (it) {
        return el('div.breakdown', null, it.groups.map(function (g) {
          return el('div.breakdown__row', null, [
            el('b', { text: g.label }), el('span', { text: pt(g.earned) + ' of ' + pt(g.weight) + ' pts · ' + g.checked + '/' + g.total + ' checked' }),
            el('span.meter', { 'aria-hidden': 'true' }, [el('i', { style: 'width:' + (g.weight ? Math.round((g.earned / g.weight) * 100) : 0) + '%' })]),
          ]);
        }));
      }),
      rowEl(m, 'Evidence coverage', function (it) {
        return [it.v.ck + ' of ' + it.v.to + ' checked (' + it.v.cov + '% of checklist weight)', el('small', { text: it.documented + ' of ' + it.v.to + ' capabilities documented' }), it.v.da ? el('small', null, ['Evidence checked ', timeEl(it.v.da)]) : null];
      }),
      rowEl(m, 'Starting price', function (it) { return [priceCell(it.v, { plan: true, checked: true }), it.v.pr.d ? null : el('small', { text: 'Price-check date not recorded' })]; }),
      m.items.some(function (it) { return it.v.pr.m; }) ? rowEl(m, 'Pricing model', function (it) { return it.v.pr.m || ''; }) : null,
      rowEl(m, 'AI', function (it) { return aiTag(it.v); }),
      rowEl(m, 'Best for', function (it) { return it.v.bf; }),
      rowEl(m, 'Look closely when', function (it) { return it.v.av; }),
    ];
    var help = el('details.pop', { 'data-pop': true }, [
      el('summary', { 'aria-label': 'How the score works' }, [el('i.info', { 'aria-hidden': 'true', text: 'i' })]),
      el('div.pop__panel', null, [
        el('p.pop__title', { text: 'Documented-fit score' }),
        el('p', { text: 'How much of this category’s checklist is documented in official sources, from 0 to 100. It is research, not a customer rating or a hands-on test.' }),
        el('p', { text: 'Unverified items score zero. No score is shown until 80% of the checklist weight has been checked — that is what “Score pending” means.' }),
        el('p', null, [el('a', { href: SC.url('/methodology/'), text: 'How we score' })]),
      ]),
    ]);
    root.appendChild(el('section.wrap.cmp-sec.cmp-sec--first', { id: 'glance', 'aria-labelledby': 'glance-h' }, [
      el('div.cmp-sec__head', null, [el('h2', { id: 'glance-h', text: 'At a glance' }), help]),
      tableEl(m, '.cmp-table--glance', pairName + ': score, evidence coverage, price, AI and fit at a glance', 'Key fact', glanceRows),
      el('p.table-note', null, ['Score = ', el('a', { href: SC.url('/methodology/'), text: 'documented-fit score' }), ' out of 100, from official documentation checked as of ', timeEl(data.asOf),
        ' — not a user rating or a hands-on test. “Score pending” means less than 80% of the checklist weight has been checked. Prices are dated observations of public list prices, not quotes. No vendor pays for placement.']),
    ]));

    // ---- where they differ
    var diffLine = function (r) {
      return el('li', null, [
        el('a.cmp-ahead__cap', { href: '#cap-' + r.f.id, text: r.f.label }),
        el('span.cmp-ahead__st', null, m.items.map(function (it) {
          var c = r.cells[it.i];
          return el('span', { 'data-i': it.i }, [dot(), el('span.sr-only', { text: it.v.n + ': ' }), statusEl(c.st), c.src ? ext(c.src, c.ver === 'v' ? 'Related documentation' : 'Source') : null]);
        })),
      ]);
    };
    var diffSec = el('section.wrap.section.cmp-sec', { id: 'differences', 'aria-labelledby': 'differences-h' }, [
      el('div.section-head', null, [el('div', null, [
        el('h2', { id: 'differences-h', text: 'Where they differ' }),
        el('p.cmp-count', null, m.diff.length
          ? [el('b', { text: m.diff.length + ' of ' + m.active.length }), ' scored checks differ between ' + listText(m.items.map(function (it) { return it.v.n; })) + '.']
          : [el('b', { text: 'None of the ' + m.active.length }), ' scored checks differ: ' + listText(m.items.map(function (it) { return it.v.n; })) + ' have the same documented status on every one. Equal statuses do not mean the products or prices are identical.']),
      ])]),
    ]);
    if (m.diff.length) {
      var colsBox = el('div.cmp-ahead', null, m.items.map(function (it) {
        var rest = m.items.filter(function (o) { return o !== it; }).map(function (o) { return o.v.n; }).join(' or ');
        return el('div.cmp-ahead__col', { 'data-i': it.i }, [
          el('h3', null, [dot(), 'Where ' + it.v.n + ' is ahead (' + m.ahead[it.i].length + ')']),
          m.ahead[it.i].length ? el('ul.cmp-ahead__list', null, m.ahead[it.i].map(diffLine)) : el('p.cmp-none', { text: 'No scored check is documented as supported for ' + it.v.n + ' and not for ' + rest + '.' }),
        ]);
      }));
      if (m.other.length) colsBox.appendChild(el('div.cmp-ahead__col.cmp-ahead__col--other', null, [el('h3', { text: 'Other differences (' + m.other.length + ')' }), el('ul.cmp-ahead__list', null, m.other.map(diffLine))]));
      diffSec.appendChild(colsBox);
      diffSec.appendChild(el('p.fineprint', { text: 'A product is ahead on a check when official documentation supports it there and not for ' + (n === 2 ? 'the other product' : 'at least one other product') + '. Lines are ordered by the points each check carries. “Not verified” means no qualifying public evidence was found, not that the capability is missing.' }));
    }
    root.appendChild(diffSec);

    // ---- full capability table
    var cellEl = function (r, it) {
      var c = r.cells[it.i], kind = VER[c.ver] || VER[''], meta = [];
      if (kind === ST[c.st][1]) { if (c.date) meta.push(el('span', null, ['Checked ', timeEl(c.date)])); }
      else meta.push(el('span', null, c.date ? [kind + ' · ', timeEl(c.date)] : [kind]));
      if (c.src) meta.push(ext(c.src, c.ver === 'v' ? 'Related documentation' : 'Source'));
      var src = el('span.cmp-src');
      meta.forEach(function (x, i) { if (i) src.appendChild(d.createTextNode(' · ')); src.appendChild(x); });
      return el('td', { 'data-i': it.i, 'data-st': ST[c.st][0] }, [
        el('span.cmp-cell__top', null, [statusEl(c.st), r.f.active ? el('span.cmp-pts.num', { text: pt(c.earned) + ' / ' + pt(c.weight) + ' pts' }) : null]),
        c.note ? el('span.cmp-note', { text: c.note }) : null,
        meta.length ? src : null,
      ]);
    };
    var capRow = function (r, hidden, group) {
      var tierText = [TIER[r.f.tier], group].filter(Boolean).join(' · ');
      var small = el('small', null, [tierText ? el('span.cmp-tier', { text: tierText }) : null, tierText && r.f.desc ? ' ' : null, r.f.desc ? el('span.cmp-desc', { text: r.f.desc }) : null]);
      var th = el('th', { scope: 'row' }, [el('span.cmp-cap', { text: r.f.label }), small.childNodes.length ? small : null]);
      return el('tr', { id: 'cap-' + r.f.id, 'data-a': r.f.active ? '1' : '0', 'data-d': r.diff ? '1' : '0', hidden: hidden }, [th].concat(m.items.map(function (it) { return cellEl(r, it); })));
    };
    var capRows = [];
    GROUP_ORDER.forEach(function (g) {
      var list = m.active.filter(function (r) { return r.f.group === g; });
      if (!list.length) return;
      var weight = list.reduce(function (s, r) { return s + r.f.weight; }, 0);
      capRows.push(el('tr.cmp-group', { 'data-g': g }, [el('th', { scope: 'colgroup', colspan: n + 1 }, [m.groupLabel[g] || g, el('small', { text: plural(list.length, 'scored check') + ' · ' + pt(weight) + ' of 100 points' })])]));
      list.forEach(function (r) { capRows.push(capRow(r, false)); });
    });
    if (m.inactive.length) {
      capRows.push(el('tr.cmp-group.cmp-group--off', { 'data-g': 'off', hidden: true }, [el('th', { scope: 'colgroup', colspan: n + 1 }, ['Not scored yet', el('small', { text: plural(m.inactive.length, 'deep check') + '. ' + INACTIVE })])]));
      GROUP_ORDER.forEach(function (g) { m.inactive.filter(function (r) { return r.f.group === g; }).forEach(function (r) { capRows.push(capRow(r, true, m.groupLabel[g])); }); });
      m.inactive.filter(function (r) { return GROUP_ORDER.indexOf(r.f.group) < 0; }).forEach(function (r) { capRows.push(capRow(r, true)); });
    }
    var segBtn = function (view, label, count) { return el('button', { type: 'button', 'data-view': view, 'aria-pressed': view === 'scored' ? 'true' : 'false' }, [label + ' ', el('span.n', { text: String(count) })]); };
    root.appendChild(el('section.wrap.section.cmp-sec', { id: 'capabilities', 'aria-labelledby': 'capabilities-h' }, [
      el('div.section-head', null, [el('div', null, [
        el('h2', { id: 'capabilities-h', text: 'All capability checks' }),
        el('p', { text: 'Every check with its documented status, the points it carries, the evidence note and the official source for ' + listText(m.items.map(function (it) { return it.v.n; })) + '.' }),
      ])]),
      el('div.toolbar.cmp-viewbar', null, [
        el('div.seg.cmp-view', { role: 'group', 'aria-label': 'Which checks to show', 'data-cmp-view': true }, [segBtn('diff', 'Differences', m.diff.length), segBtn('scored', 'Scored checks', m.active.length), segBtn('all', 'All checks', m.rows.length)]),
        el('p.legend', { 'aria-label': 'Legend' }, ['y', 'p', 'n', 'u'].map(statusEl)),
      ]),
      el('p.toolbar__count.cmp-viewcount', { role: 'status', 'aria-live': 'polite', 'data-cmp-count': true }),
      tableEl(m, '.cmp-table--caps', data.name + ' checklist: documented status, points and evidence for ' + listText(m.items.map(function (it) { return it.v.n; })), 'Capability check', capRows, { 'data-cmp-caps': true }),
      el('p.empty', { 'data-cmp-empty': true, hidden: true }, [el('b', { text: 'No scored check differs between these products.' }), 'Equal statuses do not mean the products or prices are identical. ', el('button.btn.btn--quiet.btn--sm', { type: 'button', 'data-view': 'scored', text: 'Show the scored checks' })]),
    ]));

    // ---- prices
    var priceLine = function (it) {
      var p = it.v.pr;
      return hasAmount(it.v)
        ? it.v.n + ' starts at ' + p.h + (p.u ? ' ' + p.u : '') + (p.b ? ', ' + p.b : '') + (p.pl ? ' (' + p.pl + ' plan)' : '')
        : it.v.n + ' has no verified public starting price' + (p.h === 'Custom quote' ? ' (custom quote)' : p.h === 'Usage-based' ? ' (usage-based pricing)' : '');
    };
    var priceDates = [];
    m.items.forEach(function (it) { if (it.v.pr.d && priceDates.indexOf(it.v.pr.d) < 0) priceDates.push(it.v.pr.d); });
    priceDates.sort();
    var priceLead = el('p', { text: m.items.map(priceLine).join('; ') + '.' });
    if (priceDates.length) { priceLead.appendChild(d.createTextNode(' Prices observed ')); priceDates.forEach(function (x, i) { if (i) priceLead.appendChild(d.createTextNode(' and ')); priceLead.appendChild(timeEl(x)); }); priceLead.appendChild(d.createTextNode('.')); }
    root.appendChild(el('section.wrap.section.cmp-sec', { id: 'pricing', 'aria-labelledby': 'pricing-h' }, [
      el('div.section-head', null, [el('div', null, [el('h2', { id: 'pricing-h', text: 'How do prices compare?' }), priceLead])]),
      tableEl(m, '', pairName + ': public pricing, what it covers and extra costs', 'Pricing', [
        rowEl(m, 'What the price covers', function (it) { return it.v.pr.s || el('span.cmp-none', { text: 'No pricing summary recorded.' }); }),
        rowEl(m, 'Additional costs to ask about', function (it) { return listEl(it.v.pr.x, 'None recorded.'); }),
        rowEl(m, 'Price source', function (it) { return it.v.pr.src ? ext(it.v.pr.src, 'Official pricing') : el('span.cmp-none', { text: 'No source recorded.' }); }),
      ]),
      el('p.table-note', null, ['Public list prices as observed on the dates shown, not quotes. Different billing units are not directly comparable, and tax treatment is not documented. ', el('a', { href: SC.url('/tools/cost/?scope=' + data.id), text: 'Model your own costs in the calculator' }), '.']),
    ]));

    // ---- AI, profiles and official sites
    root.appendChild(el('section.wrap.section.cmp-sec', { id: 'ai', 'aria-labelledby': 'ai-h' }, [
      el('div.section-head', null, [el('div', null, [
        el('h2', { id: 'ai-h', text: 'How do their AI capabilities compare?' }),
        el('p', { text: m.items.map(function (it) { return it.v.n + ': ' + it.v.ai; }).join('; ') + '. Documented does not mean included in every plan.' }),
      ])]),
      tableEl(m, '', pairName + ': documented AI capabilities, profiles and official sites', 'AI and next steps', [
        rowEl(m, 'What is documented', function (it) { return it.v.aiS || el('span.cmp-none', { text: 'No AI summary recorded.' }); }),
        m.items.some(function (it) { return it.v.aiL && it.v.aiL.length; }) ? rowEl(m, 'Limits to check', function (it) { return listEl(it.v.aiL, 'None recorded.'); }) : null,
        m.items.some(function (it) { return it.v.ig && it.v.ig.length; }) ? rowEl(m, 'Integrations', function (it) { return listEl(it.v.ig, 'None recorded.'); }) : null,
        rowEl(m, 'Full profile', function (it) { return el('a.link-arrow', { href: SC.url('/software/' + it.v.id + '/'), text: 'Limits, integrations and sources' }); }),
        rowEl(m, 'Official site', function (it) { return outLink(it.v); }),
      ]),
    ]));

    mount.appendChild(root);
    current = { root: root, category: data.id, ids: ids.slice() };
    syncPair();
    applyView(root, viewFromUrl(), { url: false });
    syncSave();
    if (userAction) { w.scrollTo(0, 0); if (titleEl) { titleEl.setAttribute('tabindex', '-1'); titleEl.focus({ preventScroll: true }); } }
    else revealHash();
  }

  w.addEventListener('popstate', function () { route(false); });
  route(false);
})();
