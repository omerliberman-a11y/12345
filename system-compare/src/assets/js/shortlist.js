/* System Compare — /shortlist/: the saved products as table rows with private notes.
 *
 * Storage (same keys and shapes as the previous site, read tolerantly, never throws):
 *   sc-us-shortlist       { ids[≤4], category, plans{}, weights{}, at }   — owned by core.js (SC.shortlist), 180 days
 *   sc-us-research-notes  { vendorId: { text ≤ 5000, updatedAt } }        — owned here; no expiry
 * Rules: unknown ids and ids from another category are dropped (and removed from the saved list so the header
 * count is right), only the first four valid ids count, an expired or unreadable list is an empty list, notes
 * for products that are not in the shortlist are kept and listed under "Other notes".
 * Product details come from /data/cat-<category>.js (a few KB) — never from the full catalog.
 */
(function () {
  'use strict';
  var d = document, w = window, SC = w.SC;
  if (!SC) return;
  var $ = SC.$, $$ = SC.$$, el = SC.el;
  var app = $('[data-shortlist-app]');
  if (!app) return;

  var KEY = 'sc-us-shortlist', NOTES = 'sc-us-research-notes', MAX = 4, NOTE_MAX = 5000;
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, NOTE_ID = /^[a-z0-9-]+$/;
  var scored = (app.getAttribute('data-scored') || '').split(' ');
  var statusEl = $('[data-sl-status]', app), listEl = $('[data-sl-list]', app), emptyEl = $('[data-sl-empty]', app), otherEl = $('[data-sl-other]', app);
  var tableBox = $('[data-sl-table]', app), otherBox = $('[data-sl-other-list]', app), titleEl = $('[data-sl-title]', app), subEl = $('[data-sl-sub]', app);
  var compareBtn = $('[data-sl-compare]', app), costBtn = $('[data-sl-cost]', app);
  var view = { data: null, list: null, ids: [], other: [], names: null, plans: {} };
  var seq = 0, timers = {}, healing = false;

  // ------------------------------------------------------------------ storage (tolerant)
  function rawNotes() { var o = SC.store(NOTES, null); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
  function readNotes() {
    var raw = rawNotes(), out = {};
    Object.keys(raw).forEach(function (id) {
      var v = raw[id];
      if (!NOTE_ID.test(id) || !v || typeof v !== 'object' || typeof v.text !== 'string' || v.text.length > NOTE_MAX || !v.text.trim()) return;
      out[id] = { text: v.text, updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '' };
    });
    return out;
  }
  /** Saves (or, for empty text, deletes) one note. Entries this page does not understand are left untouched. */
  function writeNote(id, text) {
    var raw = rawNotes();
    text = String(text || '').trim().slice(0, NOTE_MAX);
    if (text) raw[id] = { text: text, updatedAt: new Date().toISOString() };
    else delete raw[id];
    return SC.save(NOTES, Object.keys(raw).length ? raw : null);
  }
  function readList() {
    var core = SC.shortlist.get(); // unreadable JSON, a missing ids array and an expired list all come back empty
    var ids = core.ids, raw = SC.store(KEY, null);
    if (ids.length && raw && Array.isArray(raw.ids)) {
      // the complete de-duplicated list (may hold more than four): invalid ids are dropped BEFORE the first four are taken
      var seen = {};
      ids = raw.ids.filter(function (id) { return typeof id === 'string' && SLUG.test(id) && !seen[id] && (seen[id] = 1); });
    }
    return { ids: ids, category: core.category, plans: core.plans || {}, saved: core.ids };
  }
  /** Writes the validated id list back (other fields untouched, expiry date unchanged) and tells the header. */
  function heal(ids) {
    var raw = SC.store(KEY, null);
    if (!raw || typeof raw !== 'object') return;
    raw.ids = ids;
    if (raw.plans && typeof raw.plans === 'object') Object.keys(raw.plans).forEach(function (id) { if (ids.indexOf(id) < 0) delete raw.plans[id]; });
    healing = true;
    SC.save(KEY, ids.length ? raw : null);
    d.dispatchEvent(new CustomEvent('sc:shortlist-updated', { detail: SC.shortlist.get() }));
    healing = false;
  }
  function snapshot() { try { return { list: localStorage.getItem(KEY), notes: localStorage.getItem(NOTES) }; } catch (e) { return null; } }
  function restore(snap, what) {
    if (!snap) return;
    try {
      if (what !== 'notes') { if (snap.list === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, snap.list); }
      if (what !== 'list') { if (snap.notes === null) localStorage.removeItem(NOTES); else localStorage.setItem(NOTES, snap.notes); }
    } catch (e) { SC.toast('This browser could not save the change.'); }
    d.dispatchEvent(new CustomEvent('sc:shortlist-updated', { detail: SC.shortlist.get() }));
  }

  // ------------------------------------------------------------------ small builders
  /** The reader's own timestamp, shown as a date in their time zone ("Nov 14, 2026"); '' when it cannot be read. */
  function fmtDate(iso) {
    var t = iso ? new Date(iso) : null;
    return t && !isNaN(t.getTime()) ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getMonth()] + ' ' + t.getDate() + ', ' + t.getFullYear() : '';
  }
  function logo(v) {
    var box = el('span.logo' + (v.dk ? '.logo--dark' : ''), { 'aria-hidden': 'true' });
    if (v.lg) {
      box.appendChild(el('img', { src: SC.url(v.lg), alt: '', width: 44, height: 44, loading: 'lazy', decoding: 'async' })); // the name is printed next to it
      if (v.xw && SC.monogram) SC.monogram(box, v.n, 'data-xwide', v.xw === 2 ? '2' : ''); // very long wordmark: initials on phones
    }
    else box.appendChild(el('span.logo__fallback', { text: v.n.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map(function (x) { return x.charAt(0); }).slice(0, 2).join('').toUpperCase() }));
    return box;
  }
  function scoreToken(v) {
    if (v.pe) return el('span.score.score--pending', null, [el('span.score__value', { text: 'Score pending' }), el('span.score__meta', { text: v.ck + '/' + v.to + ' checked · ' + v.cov + '%' })]);
    return el('span.score', null, [el('span.score__value.num', null, [String(v.sc), el('small', { text: '/100' })]), el('span.score__meta', { text: v.ck + '/' + v.to + ' checked' })]);
  }
  function priceCell(v) {
    var p = v.pr || {}, amount = /\d/.test(p.h || '');
    var unit = [p.u, p.b].filter(Boolean).join(' · ');
    return el('span.price', null, [el('span.price__main' + (amount ? '.num' : '.price__main--text'), { text: p.h || 'Price not verified' }), amount && unit ? el('span.price__unit', { text: unit }) : null]);
  }

  // ------------------------------------------------------------------ notes field (auto-saves; never loses text silently)
  function noteField(id, name, note, rows) {
    var fid = 'sl-note-' + id;
    var area = el('textarea.textarea.tl-notefield', { id: fid, rows: rows || 2, maxlength: NOTE_MAX, placeholder: 'Questions for the demo, requirements, or quote details…', 'data-note': id, 'aria-describedby': fid + '-s' });
    area.value = note ? note.text : '';
    var when = note ? fmtDate(note.updatedAt) : '';
    var state = el('span.tl-saved', { id: fid + '-s', role: 'status' }, when ? ['Saved ', el('time', { datetime: note.updatedAt, text: when })] : []);
    var print = el('p.tl-printnote', { 'aria-hidden': 'true', text: area.value });
    return el('div.tl-note', null, [el('label.sr-only', { for: fid, text: 'Private notes for ' + name }), area, state, print]);
  }
  function saveNote(area) {
    var id = area.getAttribute('data-note'), state = d.getElementById(area.id + '-s'), text = area.value;
    clearTimeout(timers[id]); delete timers[id];
    var ok = writeNote(id, text);
    var print = area.parentNode.querySelector('.tl-printnote');
    if (print) print.textContent = text;
    if (state) {
      state.textContent = !ok ? 'This browser could not save the note. Copy it before leaving this page.' : text.trim() ? 'Saved in this browser' : 'Note removed';
      state.classList.toggle('is-error', !ok);
      state.classList.toggle('is-ok', ok && !!text.trim());
    }
  }
  function flushNotes() { $$('[data-note]', app).forEach(function (a) { if (timers[a.getAttribute('data-note')]) saveNote(a); }); }
  app.addEventListener('input', function (e) {
    var a = e.target;
    if (!a.hasAttribute || !a.hasAttribute('data-note')) return;
    var id = a.getAttribute('data-note'), state = d.getElementById(a.id + '-s');
    if (state) { state.textContent = a.value.length >= NOTE_MAX ? 'Saving… (5,000 character limit reached)' : 'Saving…'; state.classList.remove('is-error', 'is-ok'); }
    clearTimeout(timers[id]);
    timers[id] = setTimeout(function () { saveNote(a); }, 500);
  });
  app.addEventListener('focusout', function (e) { var a = e.target; if (a.hasAttribute && a.hasAttribute('data-note') && timers[a.getAttribute('data-note')]) saveNote(a); });
  w.addEventListener('pagehide', flushNotes);
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') flushNotes(); });

  // ------------------------------------------------------------------ render
  // The status line (a live region) shows problems, and says what an action did ("… removed from your
  // shortlist") — the latter read out only (quiet), because the toast with Undo shows it. A changed message
  // is written into a region that is already rendered, so screen readers announce it.
  var statusNow = null;
  function setState(state, message, quiet) {
    app.setAttribute('data-state', state);
    message = message || '';
    if (message === statusNow) return;
    statusNow = message;
    statusEl.classList.toggle('sr-only', !!quiet);
    if (!message) { statusEl.textContent = ''; statusEl.hidden = true; return; }
    var wasHidden = statusEl.hidden;
    statusEl.hidden = false;
    if (!wasHidden && !quiet) { statusEl.textContent = message; return; }
    statusEl.textContent = '';
    setTimeout(function () { if (statusNow === message) statusEl.textContent = message; }, 60);
  }
  /** After a re-render: the next row's Remove button, else the list heading, else the empty-state heading. */
  function heading(sel) { var h = $(sel, app); if (!h || !h.getClientRects().length) return null; h.setAttribute('tabindex', '-1'); return h; }
  function rowFocus(id) { return function () { return (id && $('[data-remove="' + id + '"]', app)) || heading('#sl-h') || heading('#sl-empty-h'); }; }
  function noteFocus(id) { return function () { return (id && $('[data-delete-note="' + id + '"]', app)) || heading('#sl-other-h') || heading('#sl-h') || heading('#sl-empty-h'); }; }
  function render() {
    flushNotes();
    var active = d.activeElement && d.activeElement.id && app.contains(d.activeElement) ? { id: d.activeElement.id, a: d.activeElement.selectionStart, b: d.activeElement.selectionEnd } : null;
    var list = readList(), notes = readNotes(), my = ++seq;
    function finish(problem) {
      if (my !== seq) return;
      draw(notes, problem);
      if (active) { var again = d.getElementById(active.id); if (again && again !== d.activeElement) { again.focus(); if (again.setSelectionRange && active.a != null) { try { again.setSelectionRange(active.a, active.b); } catch (e) { /* not a text field */ } } } }
      // the control that had focus was rebuilt or removed: move focus to where the action leaves the visitor
      if (view.focusTo) { var to = view.focusTo(); view.focusTo = null; if (to && (!d.activeElement || d.activeElement === d.body || !d.activeElement.isConnected)) to.focus(); }
    }
    function done(data, ids, problem) {
      if (my !== seq) return;
      view.data = data; view.list = list; view.ids = ids;
      view.other = Object.keys(notes).filter(function (id) { return ids.indexOf(id) < 0; });
      var waits = [];
      // product names for notes outside the shortlist come from the small vendors file (loaded once, only when needed)
      if (view.other.length && !view.names) waits.push(SC.load('vendors').then(function (v) { view.names = v.vendors || {}; }, function () { /* ids are shown instead */ }));
      // a plan saved with a product ("Save Starter to shortlist" on a profile): its name comes from the category's offer file.
      // view.plans[id] = plan name | '' (the plan is no longer researched) | null (could not be checked)
      var plans = {}, withPlan = data ? ids.filter(function (id) { return typeof list.plans[id] === 'string' && list.plans[id]; }) : [];
      if (withPlan.length) waits.push(SC.load('cost-' + data.id).then(function (c) {
        withPlan.forEach(function (id) {
          var prod = (c.p || []).filter(function (x) { return x.i === id; })[0];
          var hit = prod && (prod.o || []).filter(function (o) { return o.i === list.plans[id] && o.i !== 'entry'; })[0];
          plans[id] = hit ? hit.n : '';
        });
      }, function () { withPlan.forEach(function (id) { plans[id] = null; }); }));
      function ready() { if (my === seq) { view.plans = plans; finish(problem); } }
      if (waits.length) Promise.all(waits).then(ready, ready); else ready();
    }
    if (!list.ids.length) return done(null, [], '');
    if (!list.category || scored.indexOf(list.category) < 0) {
      // every page repairs such a list (core.js: it drops it, or finds the category of a list saved without one);
      // the first time, wait for that check so that this page shows its outcome
      if (!view.waited && SC.shortlist.ready) { view.waited = true; SC.shortlist.ready().then(render, render); return; }
      return done(null, [], 'category');
    }
    SC.load('cat-' + list.category).then(function (data) {
      if (my !== seq) return;
      var known = {};
      data.vendors.forEach(function (v) { known[v.id] = v; });
      var ids = list.ids.filter(function (id) { return known[id]; }).slice(0, MAX);
      var dropped = list.ids.filter(function (id) { return !known[id]; }).length;
      done(data, ids, dropped ? 'dropped:' + dropped : '');
      if (ids.join(' ') !== list.saved.join(' ')) heal(ids);
    }, function () { done(null, [], 'load'); });
  }

  function nameOf(id, byId) { return (byId[id] && byId[id].n) || (view.names && view.names[id] && view.names[id][0]) || id; }
  function droppedText(k) { return k === 1 ? 'One saved product is no longer listed in this category and was removed from the shortlist.' : k + ' saved products are no longer listed in this category and were removed from the shortlist.'; }
  var works = null;
  /** Can this browser keep data for this site? (Asked once, with a key written and removed at once.) */
  function storageWorks() {
    if (works === null) works = SC.save('sc-us-storage-check', 1) && SC.save('sc-us-storage-check', null);
    return works;
  }
  function draw(notes, problem) {
    var data = view.data, ids = view.ids, n = ids.length, byId = {};
    if (data) data.vendors.forEach(function (v) { byId[v.id] = v; });

    // ---- saved products
    listEl.hidden = !n;
    emptyEl.hidden = !!n;
    tableBox.textContent = '';
    if (n) {
      titleEl.textContent = n + (n === 1 ? ' product' : ' products') + ' in ' + data.name;
      subEl.textContent = '';
      subEl.appendChild(d.createTextNode(n + ' of ' + MAX + ' places used. A shortlist holds products from one category. '));
      subEl.appendChild(el('a.link-arrow', { href: SC.url('/categories/' + data.id + '/'), text: n < MAX ? 'Add more from ' + data.name : 'Back to ' + data.name }));
      var o = { ids: ids, category: data.id, plans: view.list.plans };
      if (n >= 2) { compareBtn.textContent = 'Compare (' + n + ')'; compareBtn.setAttribute('href', SC.shortlist.compareUrl(o)); compareBtn.className = 'btn'; }
      else { compareBtn.textContent = 'Add one more to compare'; compareBtn.setAttribute('href', SC.url('/categories/' + data.id + '/')); compareBtn.className = 'btn btn--ghost'; }
      costBtn.setAttribute('href', SC.url('/tools/cost/?scope=' + data.id + ids.slice(0, 3).map(function (id, i) { return '&' + 'abc'[i] + '=' + id + (view.plans[id] ? '&offer_' + 'abc'[i] + '=' + encodeURIComponent(view.list.plans[id]) : ''); }).join('')));
      // the calculator compares up to three products: it says so when it opens with the first three of four
      // (cost.js); the button's name says it too (the visible label stays short enough for a 320px screen)
      if (n > 3) costBtn.setAttribute('aria-label', 'Compare costs of the first three products (the calculator compares up to three)');
      else costBtn.removeAttribute('aria-label');
      $('[data-sl-share]', app).disabled = n < 2;

      var rows = ids.map(function (id) {
        var v = byId[id], plan = view.plans[id], planLine = null;
        if (plan) planLine = el('span.tl-plan', { 'data-plan': '' }, ['Selected plan: ', el('b', { text: plan })]);
        else if (plan === '') planLine = el('span.tl-plan', { 'data-plan': 'stale', text: 'The previously saved plan is no longer researched here. This comparison uses product-wide evidence.' });
        return el('tr.tl-row', { 'data-id': id }, [
          el('th.ptable__c-name', { scope: 'row' }, [el('a.prod', { href: SC.url('/software/' + id + '/') }, [logo(v), el('span.prod__text', null, [el('span.prod__name', { text: v.n }), v.rec ? el('span.tag.tag--top', { text: 'Recommended' }) : null, el('span.prod__fit', { text: v.bf }), planLine])])]),
          el('td.ptable__c-score', null, [scoreToken(v)]),
          el('td.ptable__c-price', null, [priceCell(v)]),
          el('td.tl-c-note', null, [noteField(id, v.n, notes[id])]),
          el('td.tl-c-rm', null, [el('button.tl-remove', { type: 'button', 'data-remove': id, 'aria-label': 'Remove ' + v.n + ' from shortlist', text: 'Remove' })]),
        ]);
      });
      tableBox.appendChild(el('table.ptable.tl-savedtable', null, [
        el('caption.sr-only', { text: 'Your shortlist: ' + n + (n === 1 ? ' product' : ' products') + ' in ' + data.name + ', with documented-fit score, starting price and your private notes' }),
        el('thead', null, [el('tr', null, [
          el('th.ptable__c-name', { scope: 'col', text: 'Product' }), el('th.ptable__c-score', { scope: 'col', text: 'Score' }), el('th.ptable__c-price', { scope: 'col', text: 'Starting price' }),
          el('th.tl-c-note', { scope: 'col', text: 'Your notes' }), el('th.tl-c-rm', { scope: 'col' }, [el('span.sr-only', { text: 'Remove' })]),
        ])]),
        el('tbody', null, rows),
      ]));
    }

    // ---- notes for products outside the shortlist
    otherEl.hidden = !view.other.length;
    otherBox.textContent = '';
    var bulk = $('[data-sl-clear-notes]', app);
    if (bulk) bulk.parentNode.hidden = view.other.length < 2;
    if (view.other.length) {
      var items = view.other.map(function (id) {
        var name = nameOf(id, byId), listed = !!(byId[id] || (view.names && view.names[id]));
        return el('li.tl-othernote', { 'data-id': id }, [
          el('div.tl-othernote__head', null, [
            listed ? el('a', { href: SC.url('/software/' + id + '/'), text: name }) : el('span', { text: name + ' (no longer listed)' }),
            el('button.tl-remove', { type: 'button', 'data-delete-note': id, 'aria-label': 'Delete note for ' + name, text: 'Delete note' }),
          ]),
          noteField(id, name, notes[id], 3),
        ]);
      });
      otherBox.appendChild(el('ul.tl-othernotes', null, items));
    }

    // ---- status line
    var msg = '';
    if (problem === 'load') msg = 'Your saved products are still in this browser, but their details could not be loaded. Refresh to try again.';
    else if (problem === 'category') msg = 'A saved list from an earlier version of this site could not be shown here. Use “Clear saved list” to start a new one.';
    else if (problem && problem.indexOf('dropped:') === 0) msg = droppedText(Number(problem.slice(8)));
    // what the repair on an earlier page removed (core.js); it stays explained here until the next action
    var note = SC.shortlist.repairNote ? SC.shortlist.repairNote() : null;
    if (note) view.repaired = note;
    if (!msg && view.repaired) msg = view.repaired.all ? 'A saved list from an earlier version of this site could not be shown here and was removed.' : droppedText(view.repaired.n);
    if (!msg && !n && !storageWorks()) msg = 'This browser is blocking saved data, so a shortlist and notes cannot be kept here. Allow this site to store data to keep them.';
    if (msg) setState(n ? 'list' : 'empty', msg);
    else setState(n ? 'list' : 'empty', view.said || '', true); // what the last action did (shown by its toast)
    var stale = $('[data-sl-stale]', app);
    if (stale) stale.remove();
    if (problem === 'category') statusEl.parentNode.insertBefore(el('p.tl-sl__clear', { 'data-sl-stale': '' }, [el('button.btn.btn--ghost', { type: 'button', 'data-sl-clear': '', text: 'Clear saved list' })]), statusEl.nextSibling);
  }

  // ------------------------------------------------------------------ CSV (every cell quoted, CRLF, formula-injection guard)
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  var CSV_HEADER = ['Category', 'Product', 'In shortlist', 'Documented-fit score (0-100)', 'Score status', 'Checks verified', 'Checks in checklist', 'Checklist weight checked %', 'Evidence checked', 'Starting price', 'Price unit', 'Billing', 'Plan', 'Price checked', 'Pricing source', 'Best for', 'Check carefully', 'Notes', 'Notes updated', 'Profile', 'Selected plan'];
  function buildCsv() {
    flushNotes();
    var notes = readNotes(), byId = {}, rows = [CSV_HEADER];
    if (view.data) view.data.vendors.forEach(function (v) { byId[v.id] = v; });
    function abs(path) { return new URL(SC.url(path), location.href).href.replace(/index\.html$/, ''); }
    view.ids.forEach(function (id) {
      var v = byId[id], p = v.pr || {}, note = notes[id] || {};
      rows.push([view.data.name, v.n, 'Yes', v.pe ? '' : v.sc, v.pe ? 'Score pending' : 'Scored', v.ck, v.to, v.cov, v.da, p.h, /\d/.test(p.h || '') ? p.u : '', p.b, p.pl, p.d, p.src, v.bf, v.av, note.text, note.updatedAt, abs('/software/' + id + '/'), view.plans[id] || '']);
    });
    view.other.forEach(function (id) {
      var note = notes[id] || {}, name = nameOf(id, byId);
      rows.push(['', name, 'No', '', '', '', '', '', '', '', '', '', '', '', '', '', '', note.text, note.updatedAt, abs('/software/' + id + '/'), '']);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  SC.shortlistPage = { csv: buildCsv, csvCell: csvCell, readNotes: readNotes, render: render };

  // ------------------------------------------------------------------ actions
  app.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button, a') : null;
    if (!t || !app.contains(t)) return;
    var snap, id, name, listTop = function () { return heading('#sl-h') || heading('#sl-empty-h'); };
    if (!t.hasAttribute('data-sl-share') && !t.hasAttribute('data-sl-csv') && !t.hasAttribute('data-sl-print')) { view.said = ''; view.repaired = null; }
    if (t.hasAttribute('data-remove')) {
      // Focus stays in the list (the next row's Remove button); the status line says what happened, and the
      // Undo message sits in the tab order right after the list until it is closed or replaced.
      id = t.getAttribute('data-remove'); name = t.getAttribute('aria-label').replace(/^Remove | from shortlist$/g, '');
      flushNotes(); snap = snapshot();
      var at = view.ids.indexOf(id), next = view.ids[at + 1] || view.ids[at - 1] || '';
      var kept = readNotes()[id] ? ' Its note is kept under “Other notes”.' : '';
      view.said = name + ' removed from your shortlist.' + kept + ' An Undo button follows the list.';
      view.focusTo = rowFocus(next);
      SC.shortlist.remove(id);
      SC.toast(name + ' removed from your shortlist.' + kept, [{ label: 'Undo', fn: function () { view.said = name + ' is back in your shortlist.'; view.focusTo = rowFocus(id); restore(snap, 'list'); } }],
        { focus: false, after: next ? tableBox : listEl, say: '', returnFocus: rowFocus(next) });
    } else if (t.hasAttribute('data-delete-note')) {
      id = t.getAttribute('data-delete-note');
      var others = view.other.slice(), k = others.indexOf(id), nextNote = others[k + 1] || others[k - 1] || '';
      clearTimeout(timers[id]); delete timers[id];
      snap = snapshot();
      if (!writeNote(id, '')) return SC.toast('This browser could not remove the note.');
      render();
      SC.toast('Note deleted.', [{ label: 'Undo', fn: function () { view.focusTo = function () { return d.getElementById('sl-note-' + id); }; restore(snap, 'notes'); } }], { returnFocus: noteFocus(nextNote) });
    } else if (t.hasAttribute('data-sl-clear')) {
      flushNotes(); snap = snapshot();
      SC.shortlist.clear();
      SC.toast('Shortlist cleared. Your notes are kept.', [{ label: 'Undo', fn: function () { view.focusTo = listTop; restore(snap, 'list'); } }], { returnFocus: listTop });
    } else if (t.hasAttribute('data-sl-clear-all') || t.hasAttribute('data-sl-clear-notes')) {
      Object.keys(timers).forEach(function (k2) { clearTimeout(timers[k2]); delete timers[k2]; });
      snap = snapshot();
      var all = t.hasAttribute('data-sl-clear-all');
      if (!SC.save(NOTES, null)) return SC.toast('Some notes could not be removed. Clear site data in your browser settings.');
      if (all) SC.shortlist.clear(); else render();
      SC.toast(all ? 'Shortlist and notes cleared from this browser.' : 'Notes deleted.', [{ label: 'Undo', fn: function () { view.focusTo = listTop; restore(snap, all ? 'both' : 'notes'); } }], { returnFocus: listTop });
    } else if (t.hasAttribute('data-sl-share')) {
      var url = new URL(SC.shortlist.compareUrl({ ids: view.ids, category: view.data.id, plans: view.list.plans }), location.href).href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
        function () { SC.toast('Comparison link copied. It opens these products for anyone — no account needed.'); },
        function () { w.prompt('Copy this link to share your comparison:', url); }
      );
    } else if (t.hasAttribute('data-sl-csv')) {
      var a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + buildCsv()], { type: 'text/csv;charset=utf-8' })), download: 'system-compare-shortlist.csv' });
      d.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      SC.toast('Shortlist CSV downloaded.');
    } else if (t.hasAttribute('data-sl-print')) {
      flushNotes();
      w.print();
    }
  });

  d.addEventListener('sc:shortlist-updated', function () { if (!healing) render(); });
  w.addEventListener('storage', function (e) { if (e.key === KEY || e.key === NOTES || e.key === null) render(); });
  render();
})();
