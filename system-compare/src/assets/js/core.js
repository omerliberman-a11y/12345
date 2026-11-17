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

  // ------------------------------------------------------------------ focus helpers (popovers, toasts)
  var TABBABLE = 'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]';
  function tabbable(x) {
    if (x.tabIndex < 0 || x.disabled || x.type === 'hidden' || (x.closest && x.closest('[inert]'))) return false;
    return x.getClientRects().length > 0 && getComputedStyle(x).visibility !== 'hidden';
  }
  function tabbablesIn(scope) { return $$(TABBABLE, scope).filter(tabbable); }
  /** Moves focus to the tab stop that follows ref (what Tab would do from ref), skipping anything inside skip. */
  function focusAfter(ref, skip) {
    var all = $$(TABBABLE);
    for (var i = 0; i < all.length; i++) {
      var x = all[i];
      if (x === ref || ref.contains(x) || (skip && skip.contains(x)) || !(ref.compareDocumentPosition(x) & 4)) continue;
      if (tabbable(x)) { x.focus(); return x; }
    }
    ref.focus();
    return ref;
  }
  /** target: an element, or a function that finds it once the page has re-rendered. */
  function giveFocus(target) {
    var tries = 0;
    (function go() {
      var x = typeof target === 'function' ? target() : target;
      if (x && x.isConnected && x.getClientRects().length) x.focus();
      else if (typeof target === 'function' && tries++ < 3) setTimeout(go, 40);
    })();
  }
  SC.focusAfter = focusAfter;

  // ------------------------------------------------------------------ announcements and toasts
  // One polite live region for short confirmations that need no action ("Pipedrive added to your shortlist").
  var liveBox = el('p.sr-only', { role: 'status', 'aria-live': 'polite', 'data-nosnippet': true }), liveTimer;
  d.body.appendChild(liveBox);
  SC.announce = function (text) {
    clearTimeout(liveTimer);
    liveBox.textContent = '';
    liveTimer = setTimeout(function () { liveBox.textContent = text; }, 80); // cleared first, so a repeat is read again
  };
  // At most one toast at a time: a new one replaces it. A toast with an action is a labelled group that takes
  // focus (its first action), has a Close button, never times out while hovered or focused, and gives focus
  // back (to opts.returnFocus or to what had focus) when it goes. Escape closes it; Tab out of it continues
  // after the control that raised it. With { focus: false, after: element } it does not take focus: it is
  // placed in the tab order right after that element instead and stays until it is closed or replaced.
  var toastBox = el('div.toasts', { 'data-nosnippet': true }), toastNow = null, toastSeq = 0, actionBack = null;
  d.body.appendChild(toastBox); // empty until a toast shows; a labelled region from then on
  function dropToast(restore) {
    var t = toastNow;
    if (!t) return;
    toastNow = null;
    clearTimeout(t.timer);
    t.node.remove();
    syncBottomPad();
    if (restore && t.back) giveFocus(t.back);
  }
  /** SC.toast('Saved', [{label:'Undo', fn} | {label, href}], { returnFocus, focus: false, after, say, ms }) */
  SC.toast = function (msg, actions, opts) {
    if (typeof opts === 'number') opts = { ms: opts };
    opts = opts || {};
    actions = (actions || []).filter(Boolean);
    if (!toastBox.hasAttribute('role')) { toastBox.setAttribute('role', 'region'); toastBox.setAttribute('aria-label', 'Notifications'); }
    var prev = toastNow, hadFocus = !!prev && prev.node.contains(d.activeElement);
    var act = actions.length > 0, id = 'sc-toast-' + ++toastSeq;
    var node = el('div.toast', act ? { role: 'group', 'aria-labelledby': id } : null, [el('span', { id: id, text: msg })]);
    var cur = d.activeElement && d.activeElement !== d.body ? d.activeElement : null;
    var t = { node: node, back: opts.returnFocus || (hadFocus ? prev.back : actionBack || cur), timer: 0 };
    dropToast(hadFocus && !act);
    // placed in the tab order after an element, or at the end of the page (never left inside a hidden section)
    var inline = !!(opts.after && opts.after.parentNode && opts.focus === false);
    if (inline) opts.after.parentNode.insertBefore(toastBox, opts.after.nextSibling);
    else if (toastBox.parentNode !== d.body) d.body.appendChild(toastBox);
    actions.forEach(function (a) {
      node.appendChild(a.href ? el('a', { href: a.href, text: a.label }) : el('button', { type: 'button', text: a.label, on: { click: function () {
        var back = t.back;
        dropToast(false);
        actionBack = back;
        try { a.fn(); } finally { actionBack = null; }
        if (back && !(toastNow && toastNow.node.contains(d.activeElement))) giveFocus(back); // unless the action raised a new toast that took focus
      } } }));
    });
    if (act) node.appendChild(el('button', { type: 'button', text: 'Close', on: { click: function () { dropToast(true); } } }));
    on(node, 'keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dropToast(true); return; }
      if (e.key !== 'Tab' || inline) return; // a toast placed in the tab order needs no help to be left
      var items = tabbablesIn(node);
      if (e.shiftKey ? d.activeElement !== items[0] : d.activeElement !== items[items.length - 1]) return;
      e.preventDefault();
      var back = typeof t.back === 'function' ? t.back() : t.back;
      dropToast(false);
      if (back && back.isConnected) { if (e.shiftKey) back.focus(); else focusAfter(back); }
    });
    toastBox.appendChild(node);
    toastNow = t;
    syncBottomPad(); // while it shows, focused controls are scrolled clear of it too
    if (!(act && inline)) (function arm(ms) {
      t.timer = setTimeout(function () {
        if (toastNow !== t) return;
        if (node.matches(':hover') || node.contains(d.activeElement)) return arm(2000);
        dropToast(false);
      }, ms);
    })(opts.ms || (act ? 9000 : 4500));
    if (act && opts.focus !== false) node.querySelector('a, button').focus({ preventScroll: true });
    else if (opts.say !== '') SC.announce(opts.say || msg);
    return node;
  };

  // ------------------------------------------------------------------ shortlist (compatible with the previous site's storage)
  var KEY = 'sc-us-shortlist', NOTES = 'sc-us-research-notes', MAX = 4, TTL = 180 * 864e5;
  // When this browser refuses to store the list (private browsing, blocked site data, a full quota), the list is
  // kept in memory for this page view instead: buttons, count, tray and the compare link keep working, nothing
  // claims that it was saved, and the visitor is told once (announce()).
  var memList = null, blockedTold = false;
  var BLOCKED = 'This browser is blocking saved data, so your shortlist lasts only until you leave this page.';
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function rawList() { return memList ? copy(memList) : store(KEY, null); }
  function readList() {
    var o = rawList(), empty = { ids: [], category: '', plans: {}, weights: {} };
    if (!o || !Array.isArray(o.ids)) return empty;
    if (o.at && Date.now() - new Date(o.at).getTime() > TTL) { if (!memList) save(KEY, null); return empty; }
    var seen = {}, ids = o.ids.filter(function (id) { return typeof id === 'string' && SLUG.test(id) && !seen[id] && (seen[id] = 1); }).slice(0, MAX);
    return { ids: ids, category: typeof o.category === 'string' && SLUG.test(o.category) ? o.category : '', plans: o.plans && typeof o.plans === 'object' ? o.plans : {}, weights: o.weights && typeof o.weights === 'object' ? o.weights : {}, at: o.at };
  }
  /** Stores the list. Returns false when the browser would not save it: it is then kept for this page view only. */
  function writeList(o) {
    var ok;
    if (!o.ids.length) ok = save(KEY, null);
    else { o.at = Date.now(); ok = save(KEY, o); } // a number, as the previous site wrote it (readers accept a number or an ISO string)
    memList = ok ? null : copy(o);
    d.dispatchEvent(new CustomEvent('sc:shortlist-updated', { detail: readList() }));
    return ok;
  }
  SC.shortlist = {
    get: readList,
    /** False while this browser refuses to store the list (it is kept for this page view only). */
    saved: function () { return !memList; },
    has: function (id) { return readList().ids.indexOf(id) >= 0; },
    // each change returns true once it is saved in this browser, false when it lasts for this page view only
    remove: function (id) { var o = readList(); o.ids = o.ids.filter(function (x) { return x !== id; }); if (o.plans) delete o.plans[id]; return writeList(o); },
    clear: function () { return writeList({ ids: [], category: '', plans: {}, weights: {} }); },
    replace: function (ids, category) { return writeList({ ids: ids.slice(0, MAX), category: category, plans: {}, weights: {} }); },
    /** Remember a researched plan for a shortlisted product ('' clears it). Returns false when it could not be saved. */
    setPlan: function (id, plan) {
      var o = readList();
      if (o.ids.indexOf(id) < 0) return false;
      if (plan) o.plans[id] = String(plan); else delete o.plans[id];
      return writeList(o) && (readList().plans[id] || '') === (plan || '');
    },
    /** Returns 'added' | 'removed' | 'full' | 'other-category'. */
    toggle: function (id, category, name) {
      var o = readList();
      if (o.ids.indexOf(id) >= 0) { SC.shortlist.remove(id); return 'removed'; }
      if (o.ids.length && o.category && category && o.category !== category) {
        SC.toast('Your shortlist compares products in one category at a time.', [
          { label: 'Start a new shortlist with ' + (name || 'this product'), fn: function () { announce(name, true, SC.shortlist.replace([id], category)); } },
        ]);
        return 'other-category';
      }
      if (o.ids.length >= MAX) {
        SC.toast('A shortlist holds up to ' + MAX + ' products. Remove one to add ' + (name || 'another') + '.', [SC.shortlist.saved() ? { label: 'Open shortlist', href: SC.url('/shortlist/') } : null]);
        return 'full';
      }
      o.ids.push(id); o.category = category || o.category;
      var ok = writeList(o);
      d.dispatchEvent(new CustomEvent('sc:comparison-add', { detail: { vendorId: id } }));
      announce(name, true, ok);
      return 'added';
    },
    compareUrl: function (o) {
      o = o || readList();
      var q = ['scope=' + o.category];
      o.ids.forEach(function (id, i) { q.push('abcd'[i] + '=' + id); if (o.plans && o.plans[id]) q.push('plan_' + 'abcd'[i] + '=' + encodeURIComponent(o.plans[id])); });
      return SC.url('/compare/?' + q.join('&'));
    },
  };
  // Where the tray shows the list (every page but /shortlist/ and /compare/), the tray itself confirms a change
  // and the live region says it; a toast only appears where nothing else on screen changes.
  function trayShows() { return PAGE !== 'shortlist' && PAGE !== 'compare'; }
  /** ok === false: the browser saved nothing. Then it never says "added to your shortlist", and once per page
   *  view it shows why (the list keeps working on this page; tray, count and compare link included). */
  function announce(name, added, ok) {
    if (!name) return;
    var n = readList().ids.length;
    if (added && ok === false) {
      var only = name + ' added for this page only';
      if (!blockedTold) { blockedTold = true; SC.toast(BLOCKED, null, { say: only + '. ' + BLOCKED }); }
      else if (trayShows() && n) SC.announce(only + ' (' + n + ' of ' + MAX + ').');
      else SC.toast(only + '.');
      return;
    }
    if (trayShows() && n) SC.announce(name + (added ? ' added to' : ' removed from') + ' your shortlist (' + n + ' of ' + MAX + ').');
    else SC.toast(added ? name + ' added to your shortlist.' : name + ' removed.');
  }

  function syncButtons() {
    var o = readList();
    $$('[data-shortlist]').forEach(function (b) {
      var onNow = o.ids.indexOf(b.getAttribute('data-shortlist')) >= 0, name = b.getAttribute('data-name') || 'product';
      b.setAttribute('aria-pressed', onNow ? 'true' : 'false');
      if (b.hasAttribute('data-label-on')) b.textContent = b.getAttribute(onNow ? 'data-label-on' : 'data-label-off');
      else b.setAttribute('aria-label', (onNow ? 'Remove ' + name + ' from' : 'Add ' + name + ' to') + ' shortlist');
      var row = b.closest('tr'); if (row) row.classList.toggle('is-picked', onNow);
    });
    $$('[data-shortlist-count]').forEach(function (c) {
      c.textContent = o.ids.length; c.setAttribute('data-n', o.ids.length);
      // the header link reads "Shortlist 2 saved"; while the browser refuses to store the list it must not say so
      var s = c.nextElementSibling;
      if (s && s.classList.contains('sr-only')) s.textContent = memList && o.ids.length ? ' not saved' : ' saved';
    });
  }

  // Fixed bars at the bottom of the screen (the tray, the privacy choices) must never hide the focused
  // element: while they show, their height is reserved as scroll padding (WCAG 2.4.11). A tray taller than the
  // 4.5rem the page keeps free for it (the "Not saved" line, or its rows wrapped at a large text size) also
  // keeps the end of the page and the toasts clear of it.
  function syncBottomPad() {
    var h = 0, cp = d.getElementById('sc-privacy-panel');
    if (tray && d.body.classList.contains('has-tray')) h = tray.offsetHeight; // open, or sliding in on the next frame
    var tall = h > parseFloat(getComputedStyle(root).fontSize) * 4.5;
    d.body.style.paddingBottom = tall ? h + 8 + 'px' : '';
    toastBox.style.bottom = tall ? h + 16 + 'px' : '';
    if (cp && !cp.hidden && cp.getClientRects().length) h = Math.max(h, w.innerHeight - cp.getBoundingClientRect().top);
    if (toastNow && toastNow.node.getClientRects().length) h = Math.max(h, w.innerHeight - toastNow.node.getBoundingClientRect().top);
    root.style.scrollPaddingBottom = h > 0 ? Math.ceil(h + 12) + 'px' : '';
  }
  SC.syncBottomPad = syncBottomPad;
  on(w, 'resize', syncBottomPad);

  // ------------------------------------------------------------------ an old or broken saved list is repaired on every page
  // A list saved by an earlier version of the site may name products that are gone, products of another category,
  // or a category that does not exist or has no scored ranking. With the vendors file (which the tray loads
  // anyway) those products are dropped — the whole list when its category is unknown or documentary; a list with
  // no category takes the scored category its products share — and the repaired list is written back in the same
  // shape, expiry date unchanged, so the header count, the buttons and the tray agree on every page and no raw id
  // is ever shown. /shortlist/ is the one place that explains a removal (SC.shortlist.repairNote()).
  var REPAIR = 'sc-us-shortlist-repaired', repairMem = null, checking = null;
  function noteRepair(n, all) {
    var o = SC.shortlist.repairNote(true) || { n: 0, all: 0 };
    o.n += n; if (all) o.all = 1;
    repairMem = o;
    try { sessionStorage.setItem(REPAIR, JSON.stringify(o)); } catch (e) { /* kept in memory for this page */ }
  }
  /** What repairs removed in this tab and was not explained yet: { n: products, all: whole list } or null. */
  SC.shortlist.repairNote = function (keep) {
    var o = repairMem;
    try { o = JSON.parse(sessionStorage.getItem(REPAIR)) || o; if (!keep) sessionStorage.removeItem(REPAIR); } catch (e) { /* in memory only */ }
    if (!keep) repairMem = null;
    return o && typeof o.n === 'number' ? o : null;
  };
  function repair(V) {
    var raw = rawList();
    if (!raw || !Array.isArray(raw.ids) || !raw.ids.length || !V || !V.vendors || !Array.isArray(V.scored)) return false; // an older vendors file: no check
    if (raw.at && Date.now() - new Date(raw.at).getTime() > TTL) return false; // expired: readList() empties it
    var seen = {}, ids = raw.ids.filter(function (id) { return typeof id === 'string' && SLUG.test(id) && !seen[id] && (seen[id] = 1); });
    var lists = function (id, c) { var v = V.vendors[id]; return !!v && (v[5] || []).some(function (i) { return V.scored[i] === c; }); };
    var cat = typeof raw.category === 'string' && SLUG.test(raw.category) ? raw.category : '';
    if (raw.category == null || raw.category === '') {
      // no category at all: the scored category (of the first known product) that lists most of them
      var first = ids.filter(function (id) { return V.vendors[id]; })[0], best = -1;
      ((first && V.vendors[first][5]) || []).forEach(function (i) {
        var c = V.scored[i], k = ids.filter(function (id) { return lists(id, c); }).length;
        if (k > best) { best = k; cat = c; }
      });
    }
    var whole = !cat || !V.categories[cat] || V.scored.indexOf(cat) < 0;
    var keep = whole ? [] : ids.filter(function (id) { return lists(id, cat); }).slice(0, MAX);
    if (!whole && cat === raw.category && keep.join(' ') === readList().ids.join(' ')) return false; // nothing to repair
    var dropped = whole ? ids.length : ids.filter(function (id) { return !lists(id, cat); }).length;
    raw.ids = keep; raw.category = cat;
    if (raw.plans && typeof raw.plans === 'object') Object.keys(raw.plans).forEach(function (id) { if (keep.indexOf(id) < 0) delete raw.plans[id]; });
    var ok = save(KEY, keep.length ? raw : null);
    memList = ok ? null : keep.length ? copy(raw) : { ids: [], category: '', plans: {}, weights: {} };
    if (dropped || whole) noteRepair(dropped, whole);
    return true;
  }
  /** The vendors data, once the saved list has been checked against it (and repaired when needed). */
  function vendorsChecked() {
    if (!checking) checking = SC.load('vendors').then(function (V) {
      if (repair(V)) d.dispatchEvent(new CustomEvent('sc:shortlist-updated', { detail: readList() }));
      return V;
    });
    return checking;
  }
  /** Resolves once a saved list has been checked (at once when there is none). */
  SC.shortlist.ready = function () { return readList().ids.length ? vendorsChecked().then(function () {}, function () {}) : Promise.resolve(); };

  var tray, trayFocus = null; // trayFocus: index of the tray button that had focus before a re-render (-1: Clear)
  var traySeq = 0; // a newer render (or closing) cancels a slide-in still waiting for its frame
  /** A chip row wider than the tray scrolls sideways: its edge fades where more chips are (data-fade "start" / "end"),
   *  kept in step when it scrolls and when it or a chip changes size (text size, the web font arriving). */
  function trayFade(box) {
    var x = box.scrollLeft, rest = box.scrollWidth - box.clientWidth - x;
    var f = [x > 1 ? 'start' : '', rest > 1 ? 'end' : ''].join(' ').trim();
    if ((box.getAttribute('data-fade') || '') !== f) { if (f) box.setAttribute('data-fade', f); else box.removeAttribute('data-fade'); }
  }
  /** A focused × and its focus ring stay clear of a fading edge: the browser only scrolls a control that is partly
   *  out of the row, so one just inside the fade is brought in by the fade's width (1.5rem) plus the ring (4px). */
  function trayReveal(box, x) {
    var b = box.getBoundingClientRect(), r = x.getBoundingClientRect(), max = box.scrollWidth - box.clientWidth;
    var room = parseFloat(getComputedStyle(root).fontSize) * 1.5 + 4;
    if (r.right > b.right - room && box.scrollLeft < max - 1) box.scrollLeft = Math.min(max, box.scrollLeft + r.right - (b.right - room));
    else if (r.left < b.left + room && box.scrollLeft > 1) box.scrollLeft = Math.max(0, box.scrollLeft - (b.left + room - r.left));
  }
  var trayRO = 'ResizeObserver' in w ? new ResizeObserver(function () { var b = tray && $('.tray__items', tray); if (b) trayFade(b); }) : null;
  /** From 48em the chips show the names while they fit; once a name would be cut short they show logos only, as on
   *  phones (two or more products: components.css). Decided when the tray is drawn and when the window is resized,
   *  never when only the text changes (the web font arriving), so nothing in the bar flips between the two. */
  function trayFit(box) {
    box.classList.remove('tray__items--logos');
    if ($$('.tray__item', box).length < 2 || !w.matchMedia('(min-width: 48em)').matches) return;
    if ($$('.tray__name', box).some(function (n) { return n.scrollWidth > n.clientWidth + 1; })) box.classList.add('tray__items--logos');
  }
  on(w, 'resize', function () { var b = tray && $('.tray__items', tray); if (b) { trayFit(b); trayFade(b); } });
  function renderTray() {
    var o = readList();
    traySeq++;
    if (PAGE === 'shortlist' || PAGE === 'compare' || !o.ids.length) {
      if (tray) tray.classList.remove('is-open');
      d.body.classList.remove('has-tray');
      syncBottomPad();
      if (trayFocus != null) { trayFocus = null; giveFocus($('.shortlist-link')); }
      return;
    }
    if (!tray) {
      tray = el('div.tray', { role: 'region', 'aria-label': 'Shortlist', 'data-nosnippet': true });
      d.body.appendChild(tray);
    }
    vendorsChecked().then(function (data) {
      var o2 = readList();
      o2.ids = o2.ids.filter(function (id) { return data.vendors[id]; }); // never a raw id (an older vendors file cannot repair)
      if (!o2.ids.length) return;
      // two or more products: on phones each chip is its logo (or initials) and its × (from 48em only once a name
      // would be cut short: trayFit); the name stays in the chip as screen-reader text and as its title
      // (components.css .tray__items--many, .tray__items--logos)
      var items = el('div.tray__items' + (o2.ids.length > 1 ? '.tray__items--many' : ''));
      o2.ids.forEach(function (id, i) {
        var v = data.vendors[id];
        var logo = el('span.logo' + (v[2] ? '.logo--dark' : ''));
        if (v[1]) logo.appendChild(el('img', { src: SC.url(v[1]), alt: '', width: 28, height: 28, loading: 'lazy' }));
        if (!v[1] || v[4]) SC.monogram(logo, v[0]); // a wide wordmark would be unreadable in the small chip
        items.appendChild(el('span.tray__item', { title: v[0] }, [logo, el('span.tray__name', { text: v[0] }), el('button.tray__x', { type: 'button', 'aria-label': 'Remove ' + v[0] + ' from shortlist', text: '×', on: { click: function () { trayFocus = i; SC.shortlist.remove(id); announce(v[0], false); } } })]));
      });
      on(items, 'scroll', function () { trayFade(items); }, { passive: true });
      on(items, 'focusin', function (e) { trayReveal(items, e.target); });
      var canCompare = o2.ids.length >= 2, mem = !!memList; // mem: the browser refused to store it (this page view only)
      var cmp = el('a.btn.btn--sm', { href: canCompare ? SC.shortlist.compareUrl(o2) : SC.url('/shortlist/'), text: canCompare ? 'Compare ' + o2.ids.length : 'Add one more to compare', 'aria-describedby': mem ? 'sc-tray-why' : null });
      if (!canCompare) { cmp.className = 'btn btn--sm btn--ghost tray__hint'; cmp.setAttribute('aria-disabled', 'true'); cmp.removeAttribute('href'); }
      var inner = el('div.wrap.tray__inner', null, [
        // Not saved: the toast that said why is gone after a few seconds; below 48em, where the label is not
        // shown, this line stays for as long as the tray does (the full sentence is its description)
        mem ? el('p.tray__note', null, [el('span.tag.tag--warn', { 'aria-describedby': 'sc-tray-why', text: 'Not saved' }), ' Kept only until you leave this page']) : null,
        el('span.tray__label', { text: 'Shortlist' + (data.categories[o2.category] ? ' · ' + data.categories[o2.category] : '') + (mem ? ' · this page only' : '') }),
        items,
        el('div.tray__actions' + (canCompare ? '' : '.tray__actions--one'), null, [el('button.tray__clear', { type: 'button', text: 'Clear', on: { click: function () { trayFocus = -1; SC.shortlist.clear(); SC.announce('Shortlist cleared.'); } } }), cmp]),
        mem ? el('span', { id: 'sc-tray-why', hidden: true, text: BLOCKED }) : null,
      ]);
      tray.textContent = '';
      tray.appendChild(inner);
      d.body.classList.add('has-tray');
      syncBottomPad();
      trayFit(items);
      trayFade(items);
      if (trayRO) { trayRO.disconnect(); trayRO.observe(items); $$('.tray__item', items).forEach(function (c) { trayRO.observe(c); }); }
      if (trayFocus != null) {
        var xs = $$('.tray__x', tray), next = xs[Math.min(trayFocus, xs.length - 1)] || $('.tray__clear', tray);
        trayFocus = null;
        next.focus();
      }
      // opening: the new rows are painted below the screen first and slide in from the next frame, so the tray's
      // appearance is a transform and never a layout shift (it used to grow and show up in the same frame)
      if (!tray.classList.contains('is-open')) { var seq = traySeq; afterPaint(function () { if (seq === traySeq) tray.classList.add('is-open'); }); }
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
  on(w, 'storage', function (e) {
    if (e.key !== KEY) return;
    memList = null; // another tab could save it, so this one reads the stored list again
    syncButtons(); renderTray();
    if (checking) checking.then(function (V) { if (repair(V)) d.dispatchEvent(new CustomEvent('sc:shortlist-updated', { detail: readList() })); }).catch(function () {});
  });

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
    // an open panel must not stay over the page once focus has moved on (WCAG 2.4.11)
    on(mega, 'focusout', function (e) { if (mega.open && e.relatedTarget && !mega.contains(e.relatedTarget)) mega.open = false; });
  }
  // Triggers of the search palette and the menu sheet say what they open, and whether it is open.
  function setExpanded(sel, open) { $$(sel).forEach(function (t) { t.setAttribute('aria-expanded', open ? 'true' : 'false'); }); }
  $$('[data-search-open], [data-menu-open]').forEach(function (t) { t.setAttribute('aria-haspopup', 'dialog'); t.setAttribute('aria-expanded', 'false'); });
  // Links that act as buttons (search, menu) also respond to Space, as the accessibility statement promises.
  on(d, 'keydown', function (e) {
    if ((e.key !== ' ' && e.key !== 'Spacebar') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t.matches && t.matches('a[role="button"]')) { e.preventDefault(); if (!e.repeat) t.click(); }
  });
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
      on(menuDlg, 'close', function () { setExpanded('[data-menu-open]', false); });
    }
    menuDlg.showModal();
    setExpanded('[data-menu-open]', true);
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
  /** Runs fn once the next frame has been painted (so a click shows its result before heavy work starts). */
  function afterPaint(fn) { (w.requestAnimationFrame || setTimeout)(function () { setTimeout(fn, 0); }); }
  function whenIdle(fn) { if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 600 }); else setTimeout(fn, 50); }
  /** Is a the word b, or b misspelt as far as the search engine tolerates (same first letter; one edit, two from
   *  8 letters)? */
  function nearWord(a, b) {
    if (a === b) return true;
    var max = a.length >= 8 ? 2 : 1, p2 = null, p1 = [], c, i, j;
    if (a.length < 4 || a.charAt(0) !== b.charAt(0) || Math.abs(a.length - b.length) > max) return false;
    for (j = 0; j <= b.length; j++) p1[j] = j;
    for (i = 1; i <= a.length; i++) {
      c = [i];
      for (j = 1; j <= b.length; j++) {
        c[j] = Math.min(p1[j] + 1, c[j - 1] + 1, p1[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) c[j] = Math.min(c[j], p2[j - 2] + 1);
      }
      p2 = p1; p1 = c;
    }
    return p1[b.length] <= max;
  }
  // the words around product names in "X vs Y", "X alternatives", "alternatives to X", "X pricing" …
  var INTENT_WORD = /^(?:vs|v|versus|compared?|comparisons?|to|with|against|and|or|alternatives?|competitors?|replacements?|substitutes?|for|of|similar|like|instead|replace|switch|from|pricing|prices?|costs?|plans?|reviews?|ratings?|score)$/;
  /**
   * For SC.search.answers, once per engine: every product's names as typed — its name in plain lower-case words
   * ("quickbooks online", never the "quick books" of its capitals) and its aliases —, its brand words (the first word
   * of its name, its one-word aliases) with the products that have each, and claim(run): the products with a name or
   * alias that is these words or starts with them as whole words.
   */
  var namesOf = { engine: null, data: null };
  function productNames(engine) {
    if (namesOf.engine === engine) return namesOf.data;
    var E = SC.searchEngine, doc = Object.create(null), names = Object.create(null), brands = Object.create(null);
    var brandOf = Object.create(null), byFirst = Object.create(null), claims = Object.create(null);
    engine.docs.forEach(function (x) {
      if (x.type !== 'product' || doc[x.id]) return;
      doc[x.id] = x; names[x.id] = [E.words(String(x.name).toLowerCase()).join(' ')].concat(x.al || []); brands[x.id] = [];
      names[x.id].forEach(function (n, i) {
        var first = n.split(' ')[0];
        (byFirst[first] = byFirst[first] || []).push([x.id, n]);
        if ((i === 0 || n.indexOf(' ') < 0) && brands[x.id].indexOf(first) < 0) {
          brands[x.id].push(first);
          (brandOf[first] = brandOf[first] || []).push(x.id);
        }
      });
    });
    function claim(run) {
      if (!(run in claims)) {
        claims[run] = [];
        (byFirst[run.split(' ')[0]] || []).forEach(function (p) {
          if ((p[1] === run || p[1].indexOf(run + ' ') === 0) && claims[run].indexOf(p[0]) < 0) claims[run].push(p[0]);
        });
      }
      return claims[run];
    }
    namesOf = { engine: engine, data: { doc: doc, names: names, brands: brands, brandOf: brandOf, claim: claim } };
    return namesOf.data;
  }
  // The previous site's limits for a search, and its message (search.js reads at most this much)
  SC.searchLimit = {
    chars: 120, words: 20, message: 'Use at most 120 characters and 20 words, then search again.',
    over: function (q) { q = String(q || '').trim(); return q.length >= 120 || q.split(/\s+/).length > 20; },
  };
  SC.search = {
    ready: null, full: null,
    /**
     * Loads the engine and the first part of the index once (names, aliases, categories: enough for the first
     * results); resolves with the engine. With { full: true }, it resolves once the second part (descriptions,
     * features, integrations) is in too — or without it, should that part not load. The palette asks for it after
     * its first results ({ idle: true }: merged when the browser is idle); /search/ asks at once, so that both
     * parts load in parallel and the page renders once.
     */
    engine: function (opts) {
      if (!SC.search.ready) {
        var link = d.getElementById('sc-search-engine');
        SC.search.ready = Promise.all([SC.load('search-index-1'), w.SC.searchEngine || !link ? null : SC.loadScript(link.href)]).then(function (r) { return w.SC.searchEngine.create(r[0]); });
      }
      if (!(opts && opts.full)) return SC.search.ready;
      if (!SC.search.full) {
        var more = SC.load('search-index-2').catch(function () { return null; }), idle = !!opts.idle;
        SC.search.full = Promise.all([SC.search.ready, more]).then(function (r) {
          var engine = r[0];
          if (!r[1] || engine.full || !engine.extend) return engine;
          if (!idle) { engine.extend(r[1]); return engine; }
          return new Promise(function (resolve) { whenIdle(function () { engine.extend(r[1]); resolve(engine); }); });
        });
      }
      return SC.search.full;
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
    /**
     * Does the first group of results answer the query, so that it is the "Best match" (the palette's Enter opens
     * it), or is it "Suggestions"? Not when the engine says so (r.direct === false: "crm vs", "marketing pricing"),
     * and not when that row is about particular products (a head-to-head, the compare tool, alternatives, a
     * product's pricing or score) that the query does not name: "phone alternatives", "crm vs pipedrive", "sales
     * pricing", "zoho vs". A product is named by its name or an alias, or by their first words when a search for
     * those words alone opens it ("monday"; never a word inside a name: "quick" of QuickBooks, and never a generic
     * word alone: "sales" of "Sales Cloud"), or by its brand word misspelt ("malchimp pricing"), unless that word is
     * a category's own ("crm", "chat"). Words that start several products' names ("zoho", "google", "microsoft")
     * name none of them, unless the other products of the query single one out ("zoho vs freshsales": Zoho CRM is
     * the one that can be compared with Freshsales). The palette and /search/ use this one rule.
     */
    answers: function (engine, r, q) {
      if (!r.top.length || r.direct === false) return false;
      var it = r.q.intent, ids = [];
      if (it && it.cmp) return true; // the exact title of a published head-to-head
      if (it && it.kind === 'vs') ids = [it.a.id, it.b.id];
      else if (it && it.kind === 'multi') ids = it.items.map(function (x) { return x.id; });
      else if (it && it.kind === 'alternatives') ids = [it.a.id];
      else if (r.q.vsOf && r.top[0].type === 'compare') ids = [r.q.vsOf.id]; // "attio vs": the compare tool with Attio chosen
      else if (r.q.suffix && r.top[0].type === 'product' && r.groups.product && r.groups.product[0]) ids = [r.top[0].of || r.groups.product[0].id]; // the product the row is about
      // a product named on its own, a category's own words ("crm pricing"), the site's own page: the engine read them
      if (!ids.length) return true;
      // the words that can name a product: runs of up to four words between "vs", "alternatives", "pricing" … (word by
      // word, so that a word typed twice stays twice: "zoho crm vs zoho books")
      var runs = [], seg = [], plainOf = Object.create(null), E = SC.searchEngine, N = productNames(engine);
      E.capped(q).toLowerCase().split(/\s+/).reduce(function (all, x) { return all.concat(E.words(x)); }, []).concat(['vs']).forEach(function (x) {
        if (!INTENT_WORD.test(x)) { seg.push(x); return; }
        for (var i = 0; i < seg.length; i++) for (var j = i + 1; j <= Math.min(seg.length, i + 4); j++) runs.push(seg.slice(i, j).join(' '));
        seg = [];
      });
      function plain(run) { // the product a search for these words alone opens ('' for none)
        if (!(run in plainOf)) {
          var r2 = engine.query(run), t = r2.top[0];
          plainOf[run] = t && t.type === 'product' && r2.direct !== false && !r2.q.intent && !r2.q.suffix && !r2.q.vsOf ? t.id : '';
        }
        return plainOf[run];
      }
      // how well a product compares with every other product the query names (engine.pairLevel: 3 a published
      // head-to-head … 1 a documentary criteria table, 0 not at all); 0 when the query names no other product
      function fit(w, id) {
        var others = ids.filter(function (o) { return o !== id; });
        if (!others.length || !engine.pairLevel) return 0;
        return others.reduce(function (m, o) { return N.doc[o] ? Math.min(m, engine.pairLevel(N.doc[w], N.doc[o])) : 0; }, 3);
      }
      // the one of the products that share these words ("zoho") that compares best with the other products of the query
      // ("zoho vs freshsales": Zoho CRM, a published head-to-head), or null
      function single(who, id) {
        var lv = who.map(function (w) { return fit(w, id); }), max = Math.max.apply(null, lv);
        return max > 0 && lv.filter(function (x) { return x === max; }).length === 1 ? who[lv.indexOf(max)] : null;
      }
      // the whole name or alias; its first words only when a search for them alone opens it ("monday", not "sales"), or
      // when they are its brand word and it compares with the other products of the query ("ahrefs vs se")
      function whole(run, id) {
        var who = N.claim(run);
        return who.length === 1 && who[0] === id && (N.names[id].indexOf(run) >= 0 || plain(run) === id || (N.brands[id].indexOf(run) >= 0 && fit(id, id) > 0));
      }
      // a brand word misspelt or typed apart ("malchimp", "quick books"; never a category's word): the first word of this
      // product's name or a one-word alias of it, as if typed right; or misspelt before the rest of a name ("elvenlabs
      // agents": ElevenLabs Agents, whole)
      function misspelt(run, id) {
        var ws = run.split(' ');
        if (Object.keys(engine.parse(ws[0]).cats).length) return false;
        return N.names[id].some(function (n) {
          var b = n.split(' ')[0], who;
          if (N.brands[id].indexOf(b) >= 0 && nearWord(ws.join(''), b)) { who = N.claim(b); return who.length > 1 ? single(who, id) === id : who[0] === id; }
          return ws.length > 1 && nearWord(ws[0], b) && whole([b].concat(ws.slice(1)).join(' '), id);
        });
      }
      return ids.every(function (id) {
        return !!N.doc[id] && runs.some(function (run) {
          var who = N.claim(run);
          // shared by several products: this one's own name (or alias), or the start of its name — "power" of the
          // aliases "Power BI" and "Power Automate" is not —, and the other products of the query single it out
          if (who.length > 1) return who.indexOf(id) >= 0 && (N.names[id].indexOf(run) >= 0 || N.names[id][0].indexOf(run + ' ') === 0) && single(who, id) === id;
          return who.length ? whole(run, id) : misspelt(run, id);
        });
      });
    },
    /** Result row. Built with textContent only — never innerHTML with user or index text. */
    hit: function (r, opts) {
      var icon = el('span.hit__icon');
      if (r.logo) { icon.className = 'logo logo--sm' + (r.dark ? ' logo--dark' : ''); icon.appendChild(el('img', { src: SC.url(r.logo), alt: '', width: 32, height: 32, loading: 'lazy' })); if (r.wide) SC.monogram(icon, r.name); }
      else icon.appendChild(svg(r.type));
      // the right-hand label is a product's score or price; a comparison, alternatives or tool row names its kind
      // on its second line already, so it gets none (on phones it would cut the title short)
      var meta = (opts && opts.meta) || SC.search.meta(r) || (r.priceText && r.type === 'product' && r.amount != null ? r.priceText : '');
      var a = el('a.hit', { href: SC.url(r.url), role: 'option', id: opts && opts.id }, [
        icon,
        el('span.hit__text', null, [el('span.hit__title', { text: r.name }), r.sub ? el('span.hit__sub', { text: r.sub }) : null]),
        meta ? el('span.hit__meta', { text: meta }) : null,
      ]);
      return a;
    },
  };

  var pal, palInput, palResults, palEmpty, palStatus, palHint, palFound = 1, palIndex = -1, palTimer, palFrom = null;
  function buildPalette() {
    pal = dialog('dialog.dialog--top.palette', 'Search');
    palInput = el('input', { type: 'search', name: 'q', maxlength: 120, autocomplete: 'off', spellcheck: 'false', placeholder: 'Search software, categories, comparisons…', 'aria-label': 'Search', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-results', 'aria-autocomplete': 'list' });
    var form = el('form.palette__input', { action: SC.url('/search/'), method: 'get', role: 'search' }, [svg('search'), palInput, closeBtn(pal)]);
    palResults = el('div.palette__results', { id: 'palette-results', role: 'listbox', 'aria-label': 'Search results' });
    palEmpty = el('div.palette__empty', { hidden: true }); // the "no results" note sits outside the listbox
    palStatus = el('p.sr-only', { role: 'status', 'aria-live': 'polite' }); // "7 results", "No results for …"
    palHint = el('span', { text: 'Enter to open' }); // says what Enter does right now (syncHint)
    var foot = el('div.palette__foot', null, [el('span', { text: '↑↓ to move' }), palHint, el('span', { text: 'Esc to close' }), el('span', { text: 'Searches stay in your browser' })]);
    pal.appendChild(form); pal.appendChild(palEmpty); pal.appendChild(palResults); pal.appendChild(palStatus); pal.appendChild(foot);
    on(pal, 'close', function () {
      setExpanded('[data-search-open]', false);
      // opened from the page's own search field: keep what was typed there (focus returns to it)
      if (palFrom) { if (palFrom.isConnected) palFrom.value = palInput.value; palFrom = null; }
    });
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
        syncHint();
      } else if (e.key === 'Enter') {
        var q = palInput.value.trim();
        if (!q && palIndex < 0) e.preventDefault();
        // Shift+Enter: every result on the search page, even where Enter would open the best match
        else if (e.shiftKey && q) { e.preventDefault(); SC.search.remember(q); w.location.href = SC.url('/search/?q=' + encodeURIComponent(q)); }
        else if (palIndex >= 0 && hits[palIndex]) { e.preventDefault(); SC.search.remember(q); w.location.href = hits[palIndex].href; }
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
  function setPalStatus(text) { if (palStatus.textContent !== text) palStatus.textContent = text; }
  /** The footer's Enter hint: Enter opens the highlighted row or the best match (data-top); otherwise it opens
   *  the search page for what was typed. */
  function syncHint() {
    var t = !palInput.value.trim() || palIndex >= 0 || $('.hit[data-top]', palResults) ? 'Enter to open' : palFound ? 'Enter for all results' : 'Enter to open the search page';
    if (palHint.textContent !== t) palHint.textContent = t;
  }
  var palSig = ''; // the rows on screen: refined results (second part of the index) replace them only when they differ
  function renderPalette() {
    var q = palInput.value.trim();
    palIndex = -1;
    palInput.removeAttribute('aria-activedescendant');
    if (!q) return renderPaletteEmpty();
    // the first time, the palette paints before the engine and the index load and build
    (SC.search.ready ? function (fn) { fn(); } : afterPaint)(function () { searchPalette(q); });
  }
  function searchPalette(q) {
    SC.search.engine().then(function (engine) {
      if (palInput.value.trim() !== q) return;
      paintResults(engine, q, false);
      if (!engine.full) SC.search.engine({ full: true, idle: true }).then(function (full) {
        // refine in place, unless the visitor has moved on or is choosing a row with the arrow keys
        if (pal.open && palInput.value.trim() === q && palIndex < 0) paintResults(full, q, true);
      }).catch(function () {});
    }).catch(function () {
      palResults.textContent = '';
      palEmpty.textContent = '';
      palEmpty.appendChild(el('p', { text: 'Search could not load. Press Enter to open the search page.' }));
      palEmpty.hidden = false;
      setPalStatus('Search could not load. Press Enter to open the search page.');
      palFound = 0; syncHint();
    });
  }
  function paintResults(engine, q, refine) {
    var r = engine.query(q), n = 0, frag = d.createDocumentFragment(), sig = [], over = SC.searchLimit.over(palInput.value);
    function add(item, opts) {
      var h = SC.search.hit(item, { id: 'hit-' + n++ });
      if (opts && opts.top) h.setAttribute('data-top', '');
      sig.push(h.getAttribute('href') + (opts && opts.top ? '*' : ''));
      frag.appendChild(h);
    }
    function head(title) { sig.push('§' + title); frag.appendChild(group(title)); }
    // data-top: Enter opens the first best match directly ("X vs Y", "X alternatives", "X pricing", "X vs", a
    // product's name, the site's own page for a question about it). Rows that do not answer the query outright
    // ("crm vs", "crm pricing": which product?) are only suggestions: Enter then opens the search page, and the
    // heading says so (SC.search.answers, the same rule as /search/).
    var direct = SC.search.answers(engine, r, q);
    if (r.top.length) { head(direct ? 'Best match' : 'Suggestions'); r.top.forEach(function (t, i) { add(t, { top: i === 0 && direct }); }); }
    var shown = {}; r.top.forEach(function (t) { shown[t.type + ':' + t.id] = 1; });
    // products that only list the named product as an integration: their own small, labelled group
    var via = r.via && r.via.items.length ? r.via : null;
    GROUPS.forEach(function (g) {
      var list = (r.groups[g[0]] || []).filter(function (x) { return !shown[x.type + ':' + x.id] && !(via && x.via); });
      if (list.length) {
        head(g[1]);
        // a query that is exactly a category's name ("crm"): Enter opens that category
        list.slice(0, r.top.length ? Math.min(3, g[2]) : g[2]).forEach(function (x) { add(x, { top: !!(r.exact && r.exact.type === x.type && r.exact.id === x.id) }); });
      }
      if (g[0] === 'product' && via) {
        var more = via.items.filter(function (x) { return !shown[x.type + ':' + x.id]; }).slice(0, 3);
        if (more.length) { head(via.label); more.forEach(function (x) { add(x); }); }
      }
    });
    var found = n;
    // the second part of the index changed nothing on screen: not a row, a heading, nor the total that "See all N
    // results" and the status give (it often adds results below the rows shown: "email marketing" 46 → 48)
    sig.push('#' + r.total);
    if (refine && sig.join('|') === palSig) return;
    palSig = sig.join('|');
    // the query was cut at 120 characters or 20 words: say so, as the previous site did (above the results, or in
    // the "No results" note)
    if (over && found) frag.insertBefore(el('p.note.palette__limit', { role: 'presentation', text: SC.searchLimit.message }), frag.firstChild);
    palEmpty.textContent = '';
    palEmpty.hidden = !!found;
    var limitSaid = over ? SC.searchLimit.message + ' ' : '';
    if (!found) {
      palEmpty.appendChild(el('p', null, [el('strong', { text: 'No results for “' + q + '”.' })]));
      palEmpty.appendChild(el('p', { text: over ? SC.searchLimit.message : 'Check the spelling, or start from a category.' }));
      frag.appendChild(group('Popular categories'));
      popularCategories(engine).forEach(function (x) { add(x); });
      setPalStatus(limitSaid + 'No results for “' + q + '”. Popular categories are listed instead.');
    } else {
      var all = el('a.hit', { href: SC.url('/search/?q=' + encodeURIComponent(q)), role: 'option', id: 'hit-' + n++ }, [el('span.hit__icon', null, [svg('search')]), el('span.hit__text', null, [el('span.hit__title', { text: 'See all ' + r.total + ' results for “' + q + '”' })])]);
      frag.appendChild(all);
      setPalStatus(limitSaid + found + (found === 1 ? ' result' : ' results') + (r.total > found ? ', ' + r.total + ' in all' : ''));
    }
    palResults.textContent = '';
    palResults.appendChild(frag);
    palFound = found; syncHint();
  }
  function popularCategories(engine) {
    var ids = ['crm', 'email-marketing', 'accounting', 'payroll', 'customer-service', 'project-management'];
    return engine.docs.filter(function (x) { return x.type === 'category' && ids.indexOf(x.id) >= 0; }).sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
  }
  function renderPaletteEmpty() {
    var frag = d.createDocumentFragment(), n = 0, recent = SC.search.recent();
    palEmpty.hidden = true;
    setPalStatus('');
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
    palSig = '';
    syncHint();
    // the palette paints first; the engine and the first part of the index load after that frame
    (SC.search.ready ? function (fn) { fn(); } : afterPaint)(function () {
      SC.search.engine().then(function (engine) {
        if (palInput.value.trim() || $('.palette__group[data-popular]', palResults)) return;
        palResults.appendChild(el('div.palette__group', { text: 'Popular categories', role: 'presentation', 'data-popular': '' }));
        popularCategories(engine).forEach(function (x) { palResults.appendChild(SC.search.hit(x, { id: 'hit-' + n++ })); });
      }).catch(function () {});
    });
  }
  SC.openSearch = function (q) {
    if (!pal) buildPalette();
    palInput.value = q || '';
    renderPalette(); // the rows are in place before the dialog opens: one style pass for both
    if (!pal.open) { pal.showModal(); setExpanded('[data-search-open]', true); }
    if (d.activeElement !== palInput) palInput.focus();
    if (q) palInput.select && palInput.setSelectionRange(q.length, q.length);
  };
  on(d, 'click', function (e) {
    var t = e.target.closest && e.target.closest('[data-search-open]');
    if (!t) return;
    e.preventDefault();
    SC.openSearch(t.getAttribute('data-query') || '');
  });
  // The hero / page search field opens the palette too (one search experience) — on a click or tap, on the
  // first typed character, on Enter or ArrowDown, and on "/" in an empty field; never on focus alone, so Tab
  // and Shift+Tab pass through it. Closing the palette returns focus to the field, with what was typed.
  function fromField(f) { if (pal && pal.open) return; SC.openSearch(f.value); palFrom = f; }
  on(d, 'click', function (e) {
    var box = e.target.closest && e.target.closest('[data-search-form]'), f = box && $('[data-search-input]', box);
    if (f && !(e.target.closest('button, a'))) fromField(f);
  });
  on(d, 'input', function (e) { if (!e.isComposing && e.target.matches && e.target.matches('[data-search-input]')) fromField(e.target); });
  on(d, 'compositionend', function (e) { if (e.target.matches && e.target.matches('[data-search-input]')) fromField(e.target); });
  on(d, 'keydown', function (e) {
    var f = e.target;
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey || !f.matches || !f.matches('[data-search-input]')) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown' || (e.key === '/' && !f.value)) { e.preventDefault(); fromField(f); }
  });
  on(d, 'keydown', function (e) {
    if (e.defaultPrevented || e.isComposing) return;
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); SC.openSearch(''); }
    else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); SC.openSearch(''); }
  });

  // ------------------------------------------------------------------ tabs
  // On the home page and on product profiles the chosen category tab is kept in the address (?scope=<category>,
  // as on /alternatives/), so Back, Forward and a reload return to it; the tab selected in the HTML adds nothing.
  $$('[data-tabs]').forEach(function (box) {
    var tabs = $$('[role="tab"]', box);
    var scopeOf = function (t) { var m = /^tab-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(t.id || ''); return m ? m[1] : ''; };
    var keepsScope = (PAGE === 'home' || PAGE === 'software') && tabs.length > 1 && tabs.every(scopeOf);
    var first = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
    function remember(tab) {
      if (!keepsScope) return;
      var q = new URLSearchParams(location.search);
      if (tab === first) q.delete('scope'); else q.set('scope', scopeOf(tab));
      var s = q.toString();
      try { history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) { /* file:// */ }
    }
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var onNow = t === tab;
        t.setAttribute('aria-selected', onNow ? 'true' : 'false');
        t.tabIndex = onNow ? 0 : -1;
        var p = d.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !onNow;
      });
      if (focus) tab.focus();
      remember(tab);
      syncButtons();
    }
    tabs.forEach(function (t, i) {
      on(t, 'click', function () { select(t); });
      on(t, 'keydown', function (e) {
        var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
        else if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
        else if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
      });
    });
    // panels are hidden by attribute (not only by CSS), so exactly one shows from the start
    tabs.forEach(function (t) { var p = d.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = t.getAttribute('aria-selected') !== 'true'; });
    var want = keepsScope ? new URLSearchParams(location.search).get('scope') : '';
    var from = want && tabs.filter(function (t) { return scopeOf(t) === want; })[0];
    if (from && from !== first) select(from, false);
  });

  // ------------------------------------------------------------------ popovers: one open at a time, close on outside click / Esc
  on(d, 'click', function (e) {
    $$('details[data-pop][open]').forEach(function (p) { if (!p.contains(e.target)) p.open = false; });
  });
  on(d, 'keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('details[data-pop][open]').forEach(function (p) { p.open = false; var s = $('summary', p); if (s) s.focus(); });
  });
  // ... and when focus moves on, so an open panel never covers the next focused control. Focus that moves to an
  // element around the popover is not focus moving on: a press on the text of a panel without tabindex focuses
  // <main tabindex="-1">, and closing the popover then, in the middle of the press, crashed Chromium's renderer.
  // A click outside still closes it (above), on release.
  on(d, 'focusout', function (e) {
    var p = e.target.closest && e.target.closest('details[data-pop][open]'), to = e.relatedTarget;
    if (p && to && !p.contains(to) && !to.contains(p)) p.open = false;
  });
  // keep an opened panel inside the viewport: at tablet widths its trigger can sit near either edge
  d.addEventListener('toggle', function (e) {
    var p = e.target;
    if (!p || !p.matches || !p.matches('details[data-pop]')) return;
    var panel = $('.pop__panel', p);
    if (!panel) return;
    panel.style.transform = '';
    if (!p.open || getComputedStyle(panel).position === 'fixed') return;
    var r = panel.getBoundingClientRect(), vw = d.documentElement.clientWidth, dx = 0;
    if (r.left < 12) dx = 12 - r.left; else if (r.right > vw - 12) dx = vw - 12 - r.right;
    if (dx) panel.style.transform = 'translateX(' + Math.round(dx) + 'px)';
  }, true);

  // ------------------------------------------------------------------ score breakdown ("why this score?")
  // Any element with data-score-pop="<categoryId>:<vendorId>" opens the breakdown: the weighted groups,
  // how much is checked, and the exact checks that did not earn full points — from /data/cat-<id>.js.
  //
  // SC.float is the one anchored popover (score breakdown, capability evidence, "what this check covers").
  // It is a labelled dialog (tabindex=-1): once its content is in place (SC.float.ready) focus moves into it;
  // Tab past its last link or Shift+Tab before its first closes it and continues from the trigger, as if it
  // sat right after it; Escape closes it and returns focus to the trigger; focus or a click elsewhere closes it.
  var floatPop = null, floatFor = null, floatAlign = '';
  function closeFloat() {
    if (floatPop) { floatPop.remove(); floatPop = null; }
    if (floatFor) { floatFor.setAttribute('aria-expanded', 'false'); floatFor.removeAttribute('aria-controls'); floatFor = null; }
  }
  function placeFloat(anchor) {
    var r = anchor.getBoundingClientRect(), pw = floatPop.offsetWidth, ph = floatPop.offsetHeight;
    var left = Math.max(12, Math.min(w.innerWidth - pw - 12, floatAlign === 'center' ? r.left + r.width / 2 - pw / 2 : r.left));
    var top = r.bottom + 8;
    if (top + ph > w.innerHeight - 12 && r.top - ph - 8 > 12) top = r.top - ph - 8;
    floatPop.style.left = left + w.scrollX + 'px';
    floatPop.style.top = top + w.scrollY + 'px';
  }
  function floatKeys(e) {
    if (e.key !== 'Tab' || !floatPop) return;
    var items = tabbablesIn(floatPop), a = d.activeElement, anchor = floatFor;
    if (e.shiftKey ? a !== floatPop && a !== items[0] : items.length && a !== items[items.length - 1]) return;
    e.preventDefault();
    closeFloat();
    if (e.shiftKey) anchor.focus(); else focusAfter(anchor);
  }
  SC.float = {
    /** opts.align: 'center' centres the popover under the anchor (matrix cells). */
    open: function (anchor, node, opts) {
      closeFloat();
      floatFor = anchor; floatPop = node; floatAlign = (opts && opts.align) || '';
      if (!node.id) node.id = 'sc-float';
      node.tabIndex = -1;
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', node.id);
      on(node, 'keydown', floatKeys);
      d.body.appendChild(node);
      placeFloat(anchor);
      return node;
    },
    /** The content is in place: re-anchor, and move focus into the popover unless focus is already elsewhere. */
    ready: function (node) {
      if (!node || node !== floatPop) return;
      placeFloat(floatFor);
      var a = d.activeElement;
      if (!a || a === d.body || a === floatFor) node.focus({ preventScroll: true });
    },
    anchor: function () { return floatFor; },
    place: function () { if (floatPop && floatFor) placeFloat(floatFor); },
    close: closeFloat,
  };
  on(d, 'focusin', function (e) { if (floatPop && !floatPop.contains(e.target) && e.target !== floatFor) closeFloat(); });
  $$('[data-score-pop]').forEach(function (b) { if (!b.hasAttribute('aria-haspopup')) b.setAttribute('aria-haspopup', 'dialog'); if (!b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', 'false'); });
  function fmtDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + '\u00a0' + +m[3] + ',\u00a0' + m[1] : ''; } // no-break spaces, as format.mjs fmtDate(…, { nbsp: true })
  SC.fmtDay = fmtDay;
  on(d, 'click', function (e) {
    var b = e.target.closest && e.target.closest('[data-score-pop]');
    if (!b) { if (floatPop && !floatPop.contains(e.target) && !(floatFor && floatFor.contains(e.target)) && !(e.target.closest && e.target.closest('[data-float-anchor]'))) closeFloat(); return; }
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
      box.appendChild(el('p.evpop__who', { id: 'sc-float-title', text: v.n + ' · ' + data.name }));
      box.removeAttribute('aria-label');
      box.setAttribute('aria-labelledby', 'sc-float-title');
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
        box.appendChild(el('p.evpop__who.evpop__title', { text: v.pe ? 'Checks without full credit so far' : 'Why not 100?' })); // a label, not a heading: the popover sits outside the page outline
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
      box.appendChild(el('p.evpop__meta', { text: 'Research, not a customer rating or hands-on test.' }));
      SC.float.ready(box);
    }).catch(function () { if (floatPop === box) { box.textContent = 'The breakdown could not load. Open the product profile for the evidence.'; SC.float.ready(box); } });
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
    afterPaint(runSpies); // it measures sections: after the first layout, not in the middle of the page scripts' DOM work
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

  // A deep link lands at once. With JavaScript <html> scrolls smoothly (base.css), so the browser's own scroll to the
  // target is an animation that starts a moment after the first paint (it scrolled past the whole page from the top for a
  // second: /categories/crm/#costs). Once the page scripts have run (DOMContentLoaded), before that animation has got
  // going, the page jumps to the target instead. Landing earlier, at the browser's first layout (no smooth scrolling while
  // loading), put the target on screen while the scripts were still changing the page above it (a phone profile's
  // collapsing facts, a documentary table's controls): those moves then counted as layout shifts (up to 0.75).
  // The arrival can still end short or long when something above the target settles later (a web font replacing the
  // fallback face): on phones the section heading ended under the sticky header and menu (1 load in 4 on some pages).
  // Once the page has settled — loaded, fonts ready, the scroll at rest — a target under the sticky chrome, or off where
  // the link puts it, is put back (scroll-padding-top, base.css), at once as well. Both only on a fresh visit (a reload or
  // back/forward visit is the browser's own scroll restoration) and only if the visitor has not scrolled, tapped,
  // clicked or pressed a key since the page opened.
  (function () {
    var hash = location.hash, nav = w.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (!hash || hash.length < 2 || (nav && nav.type && nav.type !== 'navigate') || !w.Promise) return;
    var touched = false, done = false, landed = false, timer = 0;
    function touch() { touched = true; }
    var INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown', 'mousedown'];
    INPUT.forEach(function (t) { on(w, t, touch, { capture: true, passive: true }); });
    function target() {
      var id, t;
      try { id = decodeURIComponent(hash.slice(1)); } catch (e) { return null; }
      return location.hash === hash && (t = d.getElementById(id)) && t.getClientRects().length ? t : null;
    }
    /** Scrolls to t at once, whatever the page's smooth scrolling (an inline style for this one call). */
    function jump(t) {
      var s = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      t.scrollIntoView({ block: 'start' });
      root.style.scrollBehavior = s;
    }
    function land() { if (landed) return; landed = true; var t = !touched && target(); if (t) jump(t); }
    // The deferred page scripts run before DOMContentLoaded; the jump comes a painted frame later, so their changes are
    // drawn first, where the page still is (out of view of the target): a change and the jump in one frame counted as
    // a shift at the target. Load as well, should DOMContentLoaded have passed already.
    function soon() { afterPaint(land); }
    if (d.readyState === 'complete') soon(); else { on(d, 'DOMContentLoaded', soon, { once: true }); on(w, 'load', soon, { once: true }); }
    function chrome() { // bottom of the sticky header and of a section menu stuck under it
      var bottom = 0;
      $$('.site-header, .subnav').forEach(function (e) {
        var p = getComputedStyle(e).position, r = e.getBoundingClientRect();
        if ((p === 'sticky' || p === 'fixed') && r.height > 0 && r.top <= bottom + 2 && r.bottom > bottom) bottom = r.bottom;
      });
      return bottom;
    }
    function check() {
      if (done) return;
      done = true;
      w.removeEventListener('scroll', rest);
      INPUT.forEach(function (t) { w.removeEventListener(t, touch, { capture: true }); });
      var t = !touched && target();
      if (!t) return;
      // under the sticky chrome, or not where the link puts it (scroll-padding-top; an early arrival can end a few px
      // off: 126 for 128 in 1 load of 20) unless the page cannot scroll that far: a jump, like the arrival it corrects
      var top = t.getBoundingClientRect().top, pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      var end = w.pageYOffset >= root.scrollHeight - w.innerHeight - 1;
      if (top < chrome() - 1 || (!end && Math.abs(top - pad) > 1)) jump(t);
    }
    // the scroll is at rest: no scroll event for 200 ms (the browser's own smooth scroll, where it ran, takes a second)
    function rest() { clearTimeout(timer); timer = setTimeout(check, 200); }
    var loaded = d.readyState === 'complete' ? Promise.resolve() : new Promise(function (r) { on(w, 'load', r, { once: true }); });
    loaded.then(function () { return d.fonts && d.fonts.ready; }).then(function () {
      w.requestAnimationFrame(function () { on(w, 'scroll', rest, { passive: true }); rest(); setTimeout(check, 5000); });
    }, function () {});
  })();

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
    syncBottomPad(); // the tray's height follows the text size
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
  // Wide tables: make the scroll container keyboard-focusable and labelled. Measured in a ResizeObserver callback,
  // which runs right after layout: nothing is forced while the page loads, and a table first laid out later
  // (content-visibility) or that overflows once the window narrows is labelled then.
  var scrollers = $$('.scroller');
  function labelScroller(s) {
    if (s.hasAttribute('tabindex') || s.scrollWidth <= s.clientWidth + 2) return;
    s.tabIndex = 0; s.setAttribute('role', 'region'); if (!s.hasAttribute('aria-label')) s.setAttribute('aria-label', 'Data table — scroll horizontally');
  }
  if (scrollers.length && 'ResizeObserver' in w) { var scrollRO = new ResizeObserver(function (en) { en.forEach(function (x) { labelScroller(x.target); }); }); scrollers.forEach(function (s) { scrollRO.observe(s); }); }
  else if (scrollers.length) afterPaint(function () { scrollers.forEach(labelScroller); });
  // Keyboard focus inside a wide table: browsers scroll only a fully hidden target into view, so a link half outside
  // the scroller stayed half hidden. Bring it fully into view (keyboard focus only, so a click never moves the table).
  if (scrollers.length) on(d, 'focusin', function (e) {
    var t = e.target, s = t && t.closest ? t.closest('.scroller') : null;
    if (!s || s === t || !t.scrollIntoView) return;
    try { if (!t.matches(':focus-visible')) return; } catch (err) { /* older browsers: always */ }
    var r = t.getBoundingClientRect(), b = s.getBoundingClientRect();
    if (r.left < b.left || r.right > b.right) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

  /** Small logo tiles: a wordmark much wider than tall shows the product's initials instead (CSS hides the image). */
  /** attr/value: 'data-wide' (small tiles) by default; product-row plates use 'data-xwide' with '' or '2'. */
  SC.monogram = function (tile, name, attr, value) {
    tile.setAttribute(attr || 'data-wide', value || '');
    tile.appendChild(el('span.logo__mono', { 'aria-hidden': 'true', text: String(name || '').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map(function (x) { return x.charAt(0); }).slice(0, 2).join('').toUpperCase() }));
    return tile;
  };
  syncButtons();
  renderTray();
  if (readList().ids.length) vendorsChecked().catch(function () {}); // the pages without a tray repair the list too
})();
