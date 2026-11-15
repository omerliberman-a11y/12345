/* System Compare — core client script (every page).
 *
 *  - SC.url / SC.load: base-path aware links and on-demand data files
 *  - Shortlist: localStorage "sc-us-shortlist" (same shape as the previous site, so saved lists survive),
 *    header count, toggle buttons, sticky compare tray
 *  - Search palette: "/" or Ctrl/Cmd+K, grouped results, intent shortcuts, recent searches (local only)
 *  - Categories menu, mobile menu sheet, tabs, popovers, section spy
 *  - Accessibility options and privacy choices dialogs
 *
 * No dependencies. Nothing typed into search leaves the browser.
 */
(function () {
  'use strict';
  var d = document, root = d.documentElement, w = window;
  var SC = (w.SC = w.SC || {});
  var BASE = root.getAttribute('data-base') || '/';
  var LINKS = root.getAttribute('data-links') || 'relative';
  var VERSION = root.getAttribute('data-v') || '1';
  var PAGE = d.body ? d.body.getAttribute('data-page') : '';

  // ------------------------------------------------------------------ helpers
  function $(sel, ctx) { return (ctx || d).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || d).querySelectorAll(sel)); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts); }
  /** el('a.btn', {href:'/x'}, [children|text]) */
  function el(spec, props, kids) {
    var parts = spec.split('.'), node = d.createElement(parts[0] || 'div'), k;
    if (parts.length > 1) node.className = parts.slice(1).join(' ');
    for (k in props || {}) {
      if (props[k] == null || props[k] === false) continue;
      if (k === 'text') node.textContent = props[k];
      else if (k === 'on') for (var e in props.on) node.addEventListener(e, props.on[e]);
      else node.setAttribute(k, props[k] === true ? '' : props[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return node;
  }
  /** Root-absolute site path → URL that works for this build ("/categories/crm/" → "../../categories/crm/"). */
  SC.url = function (path) {
    if (!/^\//.test(path) || /^\/\//.test(path)) return path;
    var m = path.match(/^([^?#]*)(.*)$/), p = m[1].slice(1), rest = m[2];
    if (LINKS === 'portable' && (p === '' || /\/$/.test(p))) p += 'index.html';
    return BASE + p + rest;
  };
  var defs = {}, waiting = {};
  SC.define = function (name, data) { defs[name] = data; (waiting[name] || []).forEach(function (fn) { fn(data); }); delete waiting[name]; };
  /** Load /data/<name>.js once (a script that calls SC.define). Works from any host and from file://. */
  SC.load = function (name) {
    return new Promise(function (resolve, reject) {
      if (defs[name]) return resolve(defs[name]);
      if (waiting[name]) return waiting[name].push(resolve);
      waiting[name] = [resolve];
      var s = d.createElement('script');
      s.src = SC.url('/data/' + name + '.js') + '?v=' + VERSION;
      s.onerror = function () { delete waiting[name]; reject(new Error('Could not load ' + name)); };
      d.head.appendChild(s);
    });
  };
  SC.loadScript = function (src) {
    return new Promise(function (resolve, reject) {
      var s = d.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; d.head.appendChild(s);
    });
  };
  function store(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function save(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // ------------------------------------------------------------------ toasts
  var toastBox;
  /** SC.toast('Saved', [{label:'Undo', fn}]) */
  SC.toast = function (msg, actions, ms) {
    if (!toastBox) { toastBox = el('div.toasts', { role: 'status', 'aria-live': 'polite', 'data-nosnippet': true }); d.body.appendChild(toastBox); }
    var t = el('div.toast', null, [el('span', { text: msg })]);
    (actions || []).forEach(function (a) {
      t.appendChild(a.href ? el('a', { href: a.href, text: a.label }) : el('button', { type: 'button', text: a.label, on: { click: function () { a.fn(); t.remove(); } } }));
    });
    toastBox.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || (actions && actions.length ? 9000 : 4500));
  };

  // ------------------------------------------------------------------ shortlist (compatible with the previous site's storage)
  var KEY = 'sc-us-shortlist', NOTES = 'sc-us-research-notes', MAX = 4, TTL = 180 * 864e5;
  function readList() {
    var o = store(KEY, null), empty = { ids: [], category: '', plans: {}, weights: {} };
    if (!o || !Array.isArray(o.ids)) return empty;
    if (o.at && Date.now() - new Date(o.at).getTime() > TTL) { save(KEY, null); return empty; }
    var seen = {}, ids = o.ids.filter(function (id) { return typeof id === 'string' && SLUG.test(id) && !seen[id] && (seen[id] = 1); }).slice(0, MAX);
    return { ids: ids, category: typeof o.category === 'string' && SLUG.test(o.category) ? o.category : '', plans: o.plans && typeof o.plans === 'object' ? o.plans : {}, weights: o.weights && typeof o.weights === 'object' ? o.weights : {}, at: o.at };
  }
  function writeList(o) {
    if (!o.ids.length) save(KEY, null);
    else { o.at = Date.now(); save(KEY, o); } // a number, as the previous site wrote it (readers accept a number or an ISO string)
    d.dispatchEvent(new CustomEvent('sc:shortlist-updated', { detail: readList() }));
  }
  SC.shortlist = {
    get: readList,
    has: function (id) { return readList().ids.indexOf(id) >= 0; },
    remove: function (id) { var o = readList(); o.ids = o.ids.filter(function (x) { return x !== id; }); if (o.plans) delete o.plans[id]; writeList(o); },
    clear: function () { writeList({ ids: [], category: '', plans: {}, weights: {} }); },
    replace: function (ids, category) { writeList({ ids: ids.slice(0, MAX), category: category, plans: {}, weights: {} }); },
    /** Returns 'added' | 'removed' | 'full' | 'other-category'. */
    toggle: function (id, category, name) {
      var o = readList();
      if (o.ids.indexOf(id) >= 0) { SC.shortlist.remove(id); return 'removed'; }
      if (o.ids.length && o.category && category && o.category !== category) {
        SC.toast('Your shortlist compares products in one category at a time.', [
          { label: 'Start a new shortlist with ' + (name || 'this product'), fn: function () { SC.shortlist.replace([id], category); announce(name, true); } },
        ]);
        return 'other-category';
      }
      if (o.ids.length >= MAX) {
        SC.toast('A shortlist holds up to ' + MAX + ' products. Remove one to add ' + (name || 'another') + '.', [{ label: 'Open shortlist', href: SC.url('/shortlist/') }]);
        return 'full';
      }
      o.ids.push(id); o.category = category || o.category;
      writeList(o);
      d.dispatchEvent(new CustomEvent('sc:comparison-add', { detail: { vendorId: id } }));
      announce(name, true);
      return 'added';
    },
    compareUrl: function (o) {
      o = o || readList();
      var q = ['scope=' + o.category];
      o.ids.forEach(function (id, i) { q.push('abcd'[i] + '=' + id); if (o.plans && o.plans[id]) q.push('plan_' + 'abcd'[i] + '=' + encodeURIComponent(o.plans[id])); });
      return SC.url('/compare/?' + q.join('&'));
    },
  };
  function announce(name, added) { if (name) SC.toast(added ? name + ' added to your shortlist.' : name + ' removed.'); }

  function syncButtons() {
    var o = readList();
    $$('[data-shortlist]').forEach(function (b) {
      var onNow = o.ids.indexOf(b.getAttribute('data-shortlist')) >= 0, name = b.getAttribute('data-name') || 'product';
      b.setAttribute('aria-pressed', onNow ? 'true' : 'false');
      if (b.hasAttribute('data-label-on')) b.textContent = b.getAttribute(onNow ? 'data-label-on' : 'data-label-off');
      else b.setAttribute('aria-label', (onNow ? 'Remove ' + name + ' from' : 'Add ' + name + ' to') + ' shortlist');
      var row = b.closest('tr'); if (row) row.classList.toggle('is-picked', onNow);
    });
    $$('[data-shortlist-count]').forEach(function (c) { c.textContent = o.ids.length; c.setAttribute('data-n', o.ids.length); });
  }

  var tray;
  function renderTray() {
    var o = readList();
    if (PAGE === 'shortlist' || PAGE === 'compare' || !o.ids.length) { if (tray) tray.classList.remove('is-open'); d.body.classList.remove('has-tray'); return; }
    if (!tray) {
      tray = el('div.tray', { role: 'region', 'aria-label': 'Shortlist', 'data-nosnippet': true });
      d.body.appendChild(tray);
    }
    SC.load('vendors').then(function (data) {
      var o2 = readList();
      if (!o2.ids.length) return;
      var items = el('div.tray__items');
      o2.ids.forEach(function (id) {
        var v = data.vendors[id] || [id, '', 0];
        var logo = el('span.logo' + (v[2] ? '.logo--dark' : ''));
        if (v[1]) logo.appendChild(el('img', { src: SC.url(v[1]), alt: '', width: 28, height: 28, loading: 'lazy' }));
        items.appendChild(el('span.tray__item', null, [logo, el('span', { text: v[0] }), el('button.tray__x', { type: 'button', 'aria-label': 'Remove ' + v[0] + ' from shortlist', text: '×', on: { click: function () { SC.shortlist.remove(id); } } })]));
      });
      var canCompare = o2.ids.length >= 2;
      var cmp = el('a.btn.btn--sm', { href: canCompare ? SC.shortlist.compareUrl(o2) : SC.url('/shortlist/'), text: canCompare ? 'Compare ' + o2.ids.length : 'Add one more to compare' });
      if (!canCompare) { cmp.className = 'btn btn--sm btn--ghost'; cmp.setAttribute('aria-disabled', 'true'); cmp.removeAttribute('href'); }
      var inner = el('div.wrap.tray__inner', null, [
        el('span.tray__label', { text: 'Shortlist' + (data.categories[o2.category] ? ' · ' + data.categories[o2.category] : '') }),
        items,
        el('div.tray__actions', null, [el('button.tray__clear', { type: 'button', text: 'Clear', on: { click: function () { SC.shortlist.clear(); } } }), cmp]),
      ]);
      tray.textContent = '';
      tray.appendChild(inner);
      tray.classList.add('is-open');
      d.body.classList.add('has-tray');
    }).catch(function () {});
  }

  on(d, 'click', function (e) {
    var b = e.target.closest && e.target.closest('[data-shortlist]');
    if (!b) return;
    e.preventDefault();
    var r = SC.shortlist.toggle(b.getAttribute('data-shortlist'), b.getAttribute('data-category'), b.getAttribute('data-name'));
    if (r === 'removed') announce(b.getAttribute('data-name'), false);
  });
  on(d, 'sc:shortlist-updated', function () { syncButtons(); renderTray(); });
  on(w, 'storage', function (e) { if (e.key === KEY) { syncButtons(); renderTray(); } });

  // ------------------------------------------------------------------ dialogs
  function dialog(cls, label) {
    var dlg = el('dialog.' + cls, { 'aria-label': label, 'data-nosnippet': true });
    on(dlg, 'click', function (e) { if (e.target === dlg) dlg.close(); });
    d.body.appendChild(dlg);
    return dlg;
  }
  function closeBtn(dlg) { return el('button.xbtn', { type: 'button', 'aria-label': 'Close', text: '×', on: { click: function () { dlg.close(); } } }); }

  // ------------------------------------------------------------------ menus
  var mega = $('[data-mega]');
  if (mega) {
    on(d, 'click', function (e) { if (mega.open && !mega.contains(e.target)) mega.open = false; });
    on(d, 'keydown', function (e) { if (e.key === 'Escape' && mega.open) { mega.open = false; $('summary', mega).focus(); } });
  }
  var menuDlg;
  function openMenu() {
    if (!menuDlg) {
      menuDlg = dialog('sheet', 'Menu');
      var list = el('div.menu-list');
      [['/compare/', 'Compare products'], ['/guides/', 'Buying guides'], ['/methodology/', 'How we score'], ['/tools/cost/', 'Cost calculator'], ['/shortlist/', 'Your shortlist']].forEach(function (l) {
        list.appendChild(el('a', { href: SC.url(l[0]), text: l[1] }));
      });
      var cats = el('div.menu-list');
      $$('.mega__group').forEach(function (g) {
        var ul = el('ul');
        $$('a', g).forEach(function (a) { ul.appendChild(el('li', null, [el('a', { href: a.getAttribute('href'), text: a.textContent })])); });
        cats.appendChild(el('details', null, [el('summary', { text: $('.mega__title', g).textContent }), ul]));
      });
      cats.appendChild(el('a', { href: SC.url('/categories/'), text: 'All categories' }));
      cats.appendChild(el('a', { href: SC.url('/software/'), text: 'All software A–Z' }));
      menuDlg.appendChild(el('div.dialog__head', null, [el('h2', { text: 'Menu' }), closeBtn(menuDlg)]));
      menuDlg.appendChild(el('div.dialog__body', null, [el('p.palette__group', { text: 'Categories' }), cats, el('p.palette__group', { text: 'Tools' }), list]));
    }
    menuDlg.showModal();
  }
  on(d, 'click', function (e) {
    var t = e.target.closest && e.target.closest('[data-menu-open]');
    if (t) { e.preventDefault(); openMenu(); }
  });

  // ------------------------------------------------------------------ search palette
  var RECENT = 'sc-us-recent-searches';
  var ICON = {
    category: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    product: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    comparison: '<path d="M12 4v16M6 20h12M5 8h14"/><path d="M5 8l-2.5 6a2.7 2.7 0 0 0 5 0zM19 8l-2.5 6a2.7 2.7 0 0 0 5 0z"/>',
    guide: '<path d="M5 5a2 2 0 0 1 2-2h12v16H7a2 2 0 0 0-2 2z"/><path d="M5 21V5"/>',
    faq: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    page: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
    recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  };
  ICON.compare = ICON.comparison; ICON.alternatives = ICON.category; ICON.notice = ICON.faq;
  function svg(name) {
    var s = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICON[name] || ICON.page; // static markup only
    return s;
  }
  var GROUPS = [['category', 'Categories', 4], ['product', 'Products', 6], ['comparison', 'Comparisons', 4], ['guide', 'Guides', 3], ['faq', 'Questions', 3], ['page', 'Pages', 2]];
  SC.search = {
    ready: null,
    /** Loads the engine + index once; resolves with the engine instance. */
    engine: function () {
      if (!SC.search.ready) {
        var link = d.getElementById('sc-search-engine');
        SC.search.ready = Promise.all([SC.load('search-index'), w.SC.searchEngine || !link ? null : SC.loadScript(link.href)]).then(function (r) { return w.SC.searchEngine.create(r[0]); });
      }
      return SC.search.ready;
    },
    recent: function () { return store(RECENT, []).filter(function (x) { return typeof x === 'string'; }).slice(0, 6); },
    remember: function (q) {
      q = String(q || '').trim().slice(0, 120);
      if (q.length < 2) return;
      var list = SC.search.recent().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
      list.unshift(q); save(RECENT, list.slice(0, 6));
    },
    meta: function (r) {
      if (r.type !== 'product') return '';
      if (r.best != null) return r.best + '/100';
      return r.profile ? 'Score pending' : '';
    },
    /** Result row. Built with textContent only — never innerHTML with user or index text. */
    hit: function (r, opts) {
      var icon = el('span.hit__icon');
      if (r.logo) { icon.className = 'logo logo--sm'; icon.appendChild(el('img', { src: SC.url(r.logo), alt: '', width: 32, height: 32, loading: 'lazy' })); }
      else icon.appendChild(svg(r.type));
      var a = el('a.hit', { href: SC.url(r.url), role: 'option', id: opts && opts.id }, [
        icon,
        el('span.hit__text', null, [el('span.hit__title', { text: r.name }), r.sub ? el('span.hit__sub', { text: r.sub }) : null]),
        el('span.hit__meta', { text: (opts && opts.meta) || SC.search.meta(r) || (r.priceText && r.type === 'product' && r.amount != null ? r.priceText : '') }),
      ]);
      return a;
    },
  };

  var pal, palInput, palResults, palIndex = -1, palTimer;
  function buildPalette() {
    pal = dialog('dialog.dialog--top.palette', 'Search');
    palInput = el('input', { type: 'search', name: 'q', maxlength: 120, autocomplete: 'off', spellcheck: 'false', placeholder: 'Search software, categories, comparisons…', 'aria-label': 'Search', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-results', 'aria-autocomplete': 'list' });
    var form = el('form.palette__input', { action: SC.url('/search/'), method: 'get', role: 'search' }, [svg('search'), palInput, closeBtn(pal)]);
    palResults = el('div.palette__results', { id: 'palette-results', role: 'listbox', 'aria-label': 'Search results' });
    var foot = el('div.palette__foot', null, [el('span', { text: '↑↓ to move' }), el('span', { text: 'Enter to open' }), el('span', { text: 'Esc to close' }), el('span', { text: 'Searches stay in your browser' })]);
    pal.appendChild(form); pal.appendChild(palResults); pal.appendChild(foot);
    on(palInput, 'input', function () { clearTimeout(palTimer); palTimer = setTimeout(renderPalette, 60); });
    on(palInput, 'keydown', function (e) {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); pal.close(); return; }
      var hits = $$('.hit', palResults);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!hits.length) return;
        palIndex = (palIndex + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        hits.forEach(function (h, i) { h.setAttribute('aria-selected', i === palIndex ? 'true' : 'false'); });
        hits[palIndex].scrollIntoView({ block: 'nearest' });
        palInput.setAttribute('aria-activedescendant', hits[palIndex].id);
      } else if (e.key === 'Enter') {
        var q = palInput.value.trim();
        if (palIndex >= 0 && hits[palIndex]) { e.preventDefault(); SC.search.remember(q); w.location.href = hits[palIndex].href; }
        else if (!q) e.preventDefault();
        else SC.search.remember(q);
      }
    });
    on(form, 'submit', function (e) {
      // "X vs Y" / "X alternatives" go straight to the answer when the first row is an intent result
      var first = $('.hit[data-top]', palResults);
      if (first && palIndex < 0) { e.preventDefault(); SC.search.remember(palInput.value); w.location.href = first.href; }
    });
    on(palResults, 'click', function (e) { if (e.target.closest('.hit')) SC.search.remember(palInput.value); });
  }
  function group(title) { return el('div.palette__group', { text: title, role: 'presentation' }); }
  function renderPalette() {
    var q = palInput.value.trim();
    palIndex = -1;
    palInput.removeAttribute('aria-activedescendant');
    if (!q) return renderPaletteEmpty();
    SC.search.engine().then(function (engine) {
      if (palInput.value.trim() !== q) return;
      var r = engine.query(q), n = 0, frag = d.createDocumentFragment();
      function add(item, opts) { var h = SC.search.hit(item, { id: 'hit-' + n++, meta: opts && opts.meta }); if (opts && opts.top) h.setAttribute('data-top', ''); frag.appendChild(h); }
      if (r.top.length) { frag.appendChild(group('Best match')); r.top.forEach(function (t, i) { add(t, { top: i === 0, meta: t.why || '' }); }); }
      var shown = {}; r.top.forEach(function (t) { shown[t.type + ':' + t.id] = 1; });
      GROUPS.forEach(function (g) {
        var list = (r.groups[g[0]] || []).filter(function (x) { return !shown[x.type + ':' + x.id]; });
        if (!list.length) return;
        frag.appendChild(group(g[1]));
        list.slice(0, r.top.length ? Math.min(3, g[2]) : g[2]).forEach(function (x) { add(x); });
      });
      if (!n) {
        frag.appendChild(el('div.palette__empty', null, [el('p', null, [el('strong', { text: 'No results for “' + q + '”.' })]), el('p', { text: 'Check the spelling, or start from a category.' })]));
        frag.appendChild(group('Popular categories'));
        popularCategories(engine).forEach(function (x) { add(x); });
      } else {
        var all = el('a.hit', { href: SC.url('/search/?q=' + encodeURIComponent(q)), role: 'option', id: 'hit-' + n++ }, [el('span.hit__icon', null, [svg('search')]), el('span.hit__text', null, [el('span.hit__title', { text: 'See all ' + r.total + ' results for “' + q + '”' })])]);
        frag.appendChild(all);
      }
      palResults.textContent = '';
      palResults.appendChild(frag);
    }).catch(function () {
      palResults.textContent = '';
      palResults.appendChild(el('div.palette__empty', null, [el('p', { text: 'Search could not load. Press Enter to open the search page.' })]));
    });
  }
  function popularCategories(engine) {
    var ids = ['crm', 'email-marketing', 'accounting', 'payroll', 'customer-service', 'project-management'];
    return engine.docs.filter(function (x) { return x.type === 'category' && ids.indexOf(x.id) >= 0; }).sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
  }
  function renderPaletteEmpty() {
    var frag = d.createDocumentFragment(), n = 0, recent = SC.search.recent();
    if (recent.length) {
      frag.appendChild(group('Recent searches'));
      recent.forEach(function (q) {
        frag.appendChild(el('a.hit', { href: SC.url('/search/?q=' + encodeURIComponent(q)), role: 'option', id: 'hit-' + n++ }, [el('span.hit__icon', null, [svg('recent')]), el('span.hit__text', null, [el('span.hit__title', { text: q })])]));
      });
    }
    frag.appendChild(group('Try'));
    ['HubSpot vs Salesforce', 'QuickBooks alternatives', 'free email marketing', 'payroll under $50'].forEach(function (q) {
      var b = el('a.hit', { href: SC.url('/search/?q=' + encodeURIComponent(q)), role: 'option', id: 'hit-' + n++ }, [el('span.hit__icon', null, [svg('search')]), el('span.hit__text', null, [el('span.hit__title', { text: q })])]);
      on(b, 'click', function (e) { e.preventDefault(); palInput.value = q; renderPalette(); palInput.focus(); });
      frag.appendChild(b);
    });
    palResults.textContent = '';
    palResults.appendChild(frag);
    SC.search.engine().then(function (engine) {
      if (palInput.value.trim()) return;
      palResults.appendChild(group('Popular categories'));
      popularCategories(engine).forEach(function (x) { palResults.appendChild(SC.search.hit(x, { id: 'hit-' + n++ })); });
    }).catch(function () {});
  }
  SC.openSearch = function (q) {
    if (!pal) buildPalette();
    palInput.value = q || '';
    if (!pal.open) pal.showModal();
    renderPalette();
    palInput.focus();
    if (q) palInput.select && palInput.setSelectionRange(q.length, q.length);
  };
  on(d, 'click', function (e) {
    var t = e.target.closest && e.target.closest('[data-search-open]');
    if (!t) return;
    e.preventDefault();
    SC.openSearch(t.getAttribute('data-query') || '');
  });
  // The hero / page search field opens the palette too (one search experience); Enter without JS still submits.
  on(d, 'focusin', function (e) {
    if (e.target.matches && e.target.matches('[data-search-input]') && !(pal && pal.open)) { var v = e.target.value; e.target.blur(); SC.openSearch(v); }
  });
  on(d, 'keydown', function (e) {
    if (e.defaultPrevented || e.isComposing) return;
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); SC.openSearch(''); }
    else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); SC.openSearch(''); }
  });

  // ------------------------------------------------------------------ tabs
  $$('[data-tabs]').forEach(function (box) {
    var tabs = $$('[role="tab"]', box);
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var onNow = t === tab;
        t.setAttribute('aria-selected', onNow ? 'true' : 'false');
        t.tabIndex = onNow ? 0 : -1;
        var p = d.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !onNow;
      });
      if (focus) tab.focus();
      syncButtons();
    }
    tabs.forEach(function (t, i) {
      on(t, 'click', function () { select(t); });
      on(t, 'keydown', function (e) {
        var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
      });
    });
  });

  // ------------------------------------------------------------------ popovers: one open at a time, close on outside click / Esc
  on(d, 'click', function (e) {
    $$('details[data-pop][open]').forEach(function (p) { if (!p.contains(e.target)) p.open = false; });
  });
  on(d, 'keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('details[data-pop][open]').forEach(function (p) { p.open = false; var s = $('summary', p); if (s) s.focus(); });
  });

  // ------------------------------------------------------------------ score breakdown ("why this score?")
  // Any element with data-score-pop="<categoryId>:<vendorId>" opens the breakdown: the weighted groups,
  // how much is checked, and the exact checks that did not earn full points — from /data/cat-<id>.js.
  var floatPop = null, floatFor = null;
  function closeFloat() { if (floatPop) { floatPop.remove(); floatPop = null; } if (floatFor) { floatFor.setAttribute('aria-expanded', 'false'); floatFor = null; } }
  function placeFloat(anchor) {
    var r = anchor.getBoundingClientRect(), pw = floatPop.offsetWidth, ph = floatPop.offsetHeight;
    var left = Math.max(12, Math.min(w.innerWidth - pw - 12, r.left));
    var top = r.bottom + 8;
    if (top + ph > w.innerHeight - 12 && r.top - ph - 8 > 12) top = r.top - ph - 8;
    floatPop.style.left = left + w.scrollX + 'px';
    floatPop.style.top = top + w.scrollY + 'px';
  }
  SC.float = { open: function (anchor, node) { closeFloat(); floatFor = anchor; anchor.setAttribute('aria-expanded', 'true'); floatPop = node; d.body.appendChild(node); placeFloat(anchor); return node; }, place: function () { if (floatPop && floatFor) placeFloat(floatFor); }, close: closeFloat };
  function fmtDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + +m[3] + ', ' + m[1] : ''; }
  SC.fmtDay = fmtDay;
  on(d, 'click', function (e) {
    var b = e.target.closest && e.target.closest('[data-score-pop]');
    if (!b) { if (floatPop && !floatPop.contains(e.target) && !(e.target.closest && e.target.closest('[data-float-anchor]'))) closeFloat(); return; }
    e.preventDefault();
    if (floatFor === b) return closeFloat();
    var parts = b.getAttribute('data-score-pop').split(':'), cat = parts[0], vid = parts[1];
    var box = SC.float.open(b, el('div.evpop.scorepop', { role: 'dialog', 'aria-label': 'Score breakdown' }, [el('p', { text: 'Loading…' })]));
    SC.load('cat-' + cat).then(function (data) {
      if (floatFor !== b) return;
      var v = data.vendors.filter(function (x) { return x.id === vid; })[0];
      if (!v) return closeFloat();
      var groups = {}; data.groups.forEach(function (g) { groups[g[0]] = g[1]; });
      box.textContent = '';
      box.appendChild(el('p.evpop__who', { text: v.n + ' · ' + data.name }));
      box.appendChild(el('p.scorepop__big', { text: v.pe ? 'Score pending' : v.sc + '/100' }));
      box.appendChild(el('p.evpop__meta', { text: (v.pe ? '' : 'Documented-fit score · ') + v.ck + ' of ' + v.to + ' checks checked (' + v.cov + '% of checklist weight)' + (v.da ? ' · evidence from ' + fmtDay(v.da) : '') }));
      if (v.pe) box.appendChild(el('p', { text: 'A score is published once 80% of the checklist weight has been checked. Pending is not a negative finding.' }));
      var bars = el('div.breakdown');
      (v.gr || []).forEach(function (g) {
        var pct = g[2] ? Math.round((g[1] / g[2]) * 100) : 0;
        var meter = el('span.meter', { 'aria-hidden': 'true' }, [el('i', { style: 'width:' + pct + '%' })]);
        bars.appendChild(el('div.breakdown__row', null, [el('b', { text: groups[g[0]] || g[0] }), el('span', { text: (+g[1].toFixed(1)) + ' of ' + (+g[2].toFixed(1)) + ' pts' }), meter]));
      });
      box.appendChild(bars);
      var STL = { p: 'limited', n: 'not supported', u: 'not verified' };
      var lost = [];
      data.features.forEach(function (f, i) { var c = (v.c[i] || ['u'])[0]; if (f[3] && c !== 'y') lost.push(f[1] + ' — ' + STL[c]); });
      if (lost.length) {
        box.appendChild(el('h4', { text: v.pe ? 'Checks without full credit so far' : 'Why not 100?' }));
        var ul = el('ul.dots');
        lost.slice(0, 8).forEach(function (t) { ul.appendChild(el('li', { text: t })); });
        box.appendChild(ul);
        if (lost.length > 8) box.appendChild(el('p.evpop__meta', { text: '+ ' + (lost.length - 8) + ' more on the profile' }));
      } else if (!v.pe) box.appendChild(el('p', { text: 'Every scored check is documented as supported.' }));
      var links = el('p');
      links.appendChild(el('a', { href: SC.url('/software/' + vid + '/#capabilities'), text: 'All evidence and sources' }));
      links.appendChild(d.createTextNode(' · '));
      links.appendChild(el('a', { href: SC.url('/methodology/'), text: 'How we score' }));
      box.appendChild(links);
      box.appendChild(el('p.evpop__meta', { text: 'Research, not a user rating or hands-on test.' }));
      SC.float.place();
    }).catch(function () { if (floatPop) floatPop.textContent = 'The breakdown could not load. Open the product profile for the evidence.'; });
  });
  on(d, 'keydown', function (e) { if (e.key === 'Escape' && floatPop) { var f = floatFor; closeFloat(); if (f) f.focus(); } });
  on(w, 'resize', closeFloat);

  // ------------------------------------------------------------------ section spy for sticky sub-navigation and "On this page"
  // The active item is the last section whose top has passed under the sticky chrome, so an item stays
  // highlighted for the whole section (also on flat prose pages where headings are far apart).
  var spies = [];
  $$('[data-subnav], [data-toc]').forEach(function (nav) {
    var links = $$('a[href^="#"]', nav), map = [];
    links.forEach(function (a) { var t = d.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); if (t) map.push([t, a]); });
    if (map.length) spies.push({ nav: nav, links: links, map: map, current: null });
  });
  function runSpies() {
    var header = $('.site-header'), sub = $('.subnav');
    var line = (header ? header.offsetHeight : 0) + (sub ? sub.offsetHeight : 0) + 28;
    spies.forEach(function (s) {
      var current = null;
      for (var i = 0; i < s.map.length; i++) {
        var el2 = s.map[i][0];
        if (el2.offsetParent === null && el2.tagName !== 'BODY') continue; // hidden (inside a closed panel)
        if (el2.getBoundingClientRect().top <= line) current = s.map[i][1]; else break;
      }
      if (current === s.current) return;
      s.current = current;
      s.links.forEach(function (a) { var onNow = a === current; a.classList.toggle('is-active', onNow); if (onNow) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      // keep the active tab visible when the sub-navigation itself scrolls sideways (phones)
      var ul = current && current.closest('ul');
      if (ul && ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left: Math.max(0, current.offsetLeft - 16), behavior: 'auto' });
    });
  }
  if (spies.length) {
    var spyTick = false;
    on(w, 'scroll', function () { if (!spyTick) { spyTick = true; w.requestAnimationFrame(function () { spyTick = false; runSpies(); }); } }, { passive: true });
    on(w, 'resize', runSpies);
    runSpies();
  }

  // ------------------------------------------------------------------ deep links into collapsed content
  // A link to #some-id must show that element: open any closed <details> around it and select the tab
  // panel it lives in (FAQ items, checklists, per-category capability panels).
  function revealHashTarget() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    if (!id) return;
    var t = d.getElementById(id), n = t, changed = false;
    if (!t) return;
    while (n && n !== d.body) {
      if (n.tagName === 'DETAILS' && !n.open && !n.hasAttribute('data-pop') && !n.hasAttribute('data-mega')) { n.open = true; changed = true; }
      if (n.getAttribute && n.getAttribute('role') === 'tabpanel' && n.hidden) {
        var tab = d.getElementById(n.getAttribute('aria-labelledby'));
        if (tab) { tab.click(); changed = true; }
      }
      n = n.parentNode;
    }
    if (changed) t.scrollIntoView();
  }
  on(w, 'hashchange', revealHashTarget);
  revealHashTarget();

  // ------------------------------------------------------------------ header search visibility on the home page
  if (d.body.hasAttribute('data-hero-search')) {
    var heroField = $('.hero__search');
    if (heroField && 'IntersectionObserver' in w) new IntersectionObserver(function (en) { d.body.classList.toggle('is-scrolled', !en[0].isIntersecting); }, { rootMargin: '-64px 0px 0px 0px' }).observe(heroField);
  }

  // ------------------------------------------------------------------ accessibility options
  var A11Y = 'sc-accessibility-v1';
  function applyA11y(p) {
    if (p.size && p.size !== 100) root.setAttribute('data-a11y-size', p.size); else root.removeAttribute('data-a11y-size');
    ['contrast', 'spacing', 'links', 'motion'].forEach(function (k) { if (p[k]) root.setAttribute('data-a11y-' + k, '1'); else root.removeAttribute('data-a11y-' + k); });
  }
  var a11yDlg;
  function openA11y() {
    if (!a11yDlg) {
      a11yDlg = dialog('dialog', 'Accessibility options');
      var body = el('div.dialog__body');
      var prefs = store(A11Y, {});
      body.appendChild(el('p.fineprint', { text: 'Adjust how the site looks. Preferences stay in this browser.' }));
      var sizes = el('div.seg', { role: 'group', 'aria-label': 'Text size' });
      [100, 125, 150].forEach(function (s) {
        sizes.appendChild(el('button', { type: 'button', text: s + '%', 'aria-pressed': (prefs.size || 100) === s ? 'true' : 'false', on: { click: function () {
          prefs.size = s; $$('button', sizes).forEach(function (b) { b.setAttribute('aria-pressed', b.textContent === s + '%' ? 'true' : 'false'); }); commit();
        } } }));
      });
      body.appendChild(el('p.label', { text: 'Text size', style: 'margin:1rem 0 .4rem' }));
      body.appendChild(sizes);
      var toggles = [['contrast', 'High contrast'], ['spacing', 'More text spacing'], ['links', 'Underline links'], ['motion', 'Reduce motion']];
      toggles.forEach(function (t) {
        var cb = el('input', { type: 'checkbox' }); cb.checked = !!prefs[t[0]];
        on(cb, 'change', function () { prefs[t[0]] = cb.checked; commit(); });
        body.appendChild(el('label.check', null, [cb, el('span', { text: t[1] })]));
      });
      body.appendChild(el('p.fineprint', { text: 'You can also use browser zoom (Ctrl/Cmd and +).' }));
      var status = el('span.fineprint', { role: 'status' });
      function commit() { save(A11Y, prefs); applyA11y(prefs); status.textContent = 'Preferences saved.'; }
      var reset = el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Reset to defaults', on: { click: function () {
        prefs = {}; save(A11Y, null); applyA11y(prefs); $$('input', body).forEach(function (c) { c.checked = false; });
        $$('button', sizes).forEach(function (b) { b.setAttribute('aria-pressed', b.textContent === '100%' ? 'true' : 'false'); }); status.textContent = 'Reset.';
      } } });
      a11yDlg.appendChild(el('div.dialog__head', null, [el('h2', { text: 'Accessibility options' }), closeBtn(a11yDlg)]));
      a11yDlg.appendChild(body);
      a11yDlg.appendChild(el('div.dialog__foot', null, [reset, status, el('a', { href: SC.url('/accessibility/'), text: 'Accessibility information' })]));
    }
    a11yDlg.showModal();
  }

  // ------------------------------------------------------------------ privacy choices
  var privDlg;
  function openPrivacy() {
    if (!privDlg) {
      privDlg = dialog('dialog', 'Your privacy choices');
      var body = el('div.dialog__body', null, [
        el('p', { text: 'Optional Google Analytics runs only with your permission. Your saved shortlist and research notes stay in this browser.' }),
      ]);
      // The analytics script announces itself (SC.hasAnalytics) only where it is allowed to run:
      // on the production hostname, and never on pages that opt out (contact form, partner application).
      var actions = el('div.cluster', { style: 'margin-top:1rem' }, [
        SC.hasAnalytics ? el('button.btn.btn--ghost', { type: 'button', text: 'Analytics cookie settings', on: { click: function () { privDlg.close(); d.dispatchEvent(new CustomEvent('sc:open-consent')); } } }) : null,
        el('button.btn.btn--ghost', { type: 'button', text: 'Clear saved shortlist and notes', on: { click: function () { save(NOTES, null); SC.shortlist.clear(); SC.toast('Saved shortlist and notes cleared from this browser.'); } } }),
      ]);
      if (!SC.hasAnalytics) body.appendChild(el('p.fineprint', { style: 'margin-top:.75rem', text: 'Optional analytics is not loaded on this page.' }));
      body.appendChild(actions);
      body.appendChild(el('p', { style: 'margin-top:1rem' }, [el('a', { href: SC.url('/privacy/'), text: 'Read the privacy policy' })]));
      privDlg.appendChild(el('div.dialog__head', null, [el('h2', { text: 'Your privacy choices' }), closeBtn(privDlg)]));
      privDlg.appendChild(body);
      privDlg.appendChild(el('div.dialog__foot', null, [el('span'), el('button.btn.btn--sm', { type: 'button', text: 'Done', on: { click: function () { privDlg.close(); } } })]));
    }
    privDlg.showModal();
  }
  on(d, 'click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-a11y-open]')) openA11y();
    else if (e.target.closest('[data-privacy-open]')) openPrivacy();
  });

  // ------------------------------------------------------------------ misc
  // Wide tables: make the scroll container keyboard-focusable and labelled.
  $$('.scroller').forEach(function (s) {
    if (s.scrollWidth > s.clientWidth + 2 && !s.hasAttribute('tabindex')) { s.tabIndex = 0; s.setAttribute('role', 'region'); if (!s.hasAttribute('aria-label')) s.setAttribute('aria-label', 'Data table — scroll horizontally'); }
  });
  // Skip link moves focus to main.
  on($('.skip-link'), 'click', function () { var m = d.getElementById('main'); if (m) setTimeout(function () { m.focus(); }, 0); });
  // Copy-to-clipboard buttons: <button data-copy="text or #selector">
  on(d, 'click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    var v = b.getAttribute('data-copy');
    var text = v === 'url' ? w.location.href : v;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { SC.toast('Link copied.'); }, function () { SC.toast('Copy failed — copy the address from your browser.'); });
  });

  SC.el = el; SC.$ = $; SC.$$ = $$; SC.store = store; SC.save = save; SC.syncButtons = syncButtons;
  syncButtons();
  renderTray();
})();
