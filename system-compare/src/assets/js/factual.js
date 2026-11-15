/* Documentary category and /vs/ pages: the criteria comparison table.
 *  - supplier chips show 2–4 suppliers (columns)            → ?facts=id,id
 *  - "Hide identical rows" hides rows with the same status  → ?facts_diff=1
 *  - a criterion row opens its notes (conditions, sources, check date); "Show all notes" opens every row
 * Everything is already in the HTML; this script only shows and hides. The URL keeps the view shareable
 * (same parameters as the previous site), written with history.replaceState.
 */
(function () {
  'use strict';
  var w = window, d = document, SC = w.SC;
  if (!SC) return;
  var $ = SC.$, $$ = SC.$$;
  var MIN = 2;

  // Tables of these pages become stacked blocks on phones (display: block / grid). Explicit ARIA roles keep
  // them tables for assistive technology at every width.
  $$('table.fx-stack, table.fx-cells, table.fx-cmp').forEach(function (table) {
    table.setAttribute('role', 'table');
    $$('thead, tbody', table).forEach(function (g) { g.setAttribute('role', 'rowgroup'); });
    $$('tr', table).forEach(function (r) { r.setAttribute('role', 'row'); });
    $$('th', table).forEach(function (h) { h.setAttribute('role', h.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader'); });
    $$('td', table).forEach(function (c) { c.setAttribute('role', 'cell'); });
  });

  $$('[data-fx-compare]').forEach(function (root) {
    var table = $('[data-fx-table]', root);
    if (!table) return;
    var controls = $('[data-fx-controls]', root);
    var status = $('[data-fx-status]', root);
    var chips = $$('[data-fx-supplier]', root);
    var diffBtn = $('[data-fx-diff]', root);
    var notesBtn = $('[data-fx-notes]', root);
    var useUrl = table.hasAttribute('data-fx-url');
    var noun = table.getAttribute('data-fx-noun') || 'suppliers';
    var heads = $$('thead th[data-s]', table);
    var ids = heads.map(function (th) { return th.getAttribute('data-s'); });
    var rows = $$('tr.fx-row', table).map(function (tr) {
      var next = tr.nextElementSibling;
      var detail = next && next.classList.contains('fx-detail') ? next : null;
      // cells follow the column order of the header; a note carries the 1-based column index (data-i)
      var cells = $$('td', tr).map(function (td, i) { var m = $('.st', td); return { td: td, id: ids[i], st: m ? m.className : '' }; });
      var notes = detail ? $$('li[data-i]', detail).map(function (li) { return { li: li, id: ids[Number(li.getAttribute('data-i')) - 1] }; }) : [];
      return { tr: tr, detail: detail, btn: $('.fx-rowbtn', tr), cells: cells, notes: notes, span: detail ? $('td', detail) : null };
    });
    var state = { on: ids.slice(), diff: false };

    function readUrl() {
      if (!useUrl) return;
      var q = new URLSearchParams(w.location.search);
      var want = (q.get('facts') || '').split(',').filter(function (id, i, a) { return ids.indexOf(id) >= 0 && a.indexOf(id) === i; });
      if (want.length >= MIN && want.length <= ids.length) state.on = ids.filter(function (id) { return want.indexOf(id) >= 0; });
      state.diff = q.get('facts_diff') === '1';
    }
    function writeUrl() {
      if (!useUrl || !w.history || !w.history.replaceState) return;
      var u = new URL(w.location.href);
      // always written in the same order: ?facts=a,b&facts_diff=1 (other parameters are kept)
      u.searchParams.delete('facts');
      u.searchParams.delete('facts_diff');
      if (state.on.length !== ids.length) u.searchParams.set('facts', state.on.join(','));
      if (state.diff) u.searchParams.set('facts_diff', '1');
      // keep the commas readable, exactly like the links people already share
      var next = u.pathname + u.search.replace(/%2C/gi, ',') + u.hash;
      if (next !== w.location.pathname + w.location.search + w.location.hash) w.history.replaceState(w.history.state, '', next);
    }
    function setOpen(row, open) {
      if (!row.btn) return;
      row.tr.classList.toggle('is-open', open);
      row.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function syncNotesBtn() {
      if (!notesBtn) return;
      var openable = rows.filter(function (r) { return r.btn && !r.tr.hidden; });
      var all = openable.length > 0 && openable.every(function (r) { return r.tr.classList.contains('is-open'); });
      notesBtn.setAttribute('aria-pressed', all ? 'true' : 'false');
    }
    function apply() {
      var visible = state.on.length;
      table.style.setProperty('--fx-n', visible);
      heads.forEach(function (th) { th.hidden = state.on.indexOf(th.getAttribute('data-s')) < 0; });
      var shown = 0;
      rows.forEach(function (row) {
        var seen = {}, kinds = 0;
        row.cells.forEach(function (c) {
          var on = state.on.indexOf(c.id) >= 0;
          c.td.hidden = !on;
          if (on && !seen[c.st]) { seen[c.st] = 1; kinds++; }
        });
        var hide = state.diff && kinds < 2;
        row.tr.hidden = hide;
        if (row.detail) {
          row.detail.hidden = hide;
          row.span.colSpan = visible + 1;
          var any = false;
          row.notes.forEach(function (n) {
            var at = state.on.indexOf(n.id);
            n.li.hidden = at < 0;
            if (at >= 0) { n.li.style.gridColumn = String(at + 2); any = true; }
          });
          // a row whose only notes belong to hidden suppliers has nothing to open
          if (row.btn) { row.btn.disabled = !any; if (!any) setOpen(row, false); }
        }
        if (!hide) shown++;
      });
      chips.forEach(function (b) { b.setAttribute('aria-pressed', state.on.indexOf(b.getAttribute('data-fx-supplier')) >= 0 ? 'true' : 'false'); });
      if (diffBtn) diffBtn.setAttribute('aria-pressed', state.diff ? 'true' : 'false');
      syncNotesBtn();
      if (status) {
        status.textContent = '';
        var b1 = d.createElement('b');
        b1.textContent = visible + ' of ' + ids.length;
        status.appendChild(b1);
        status.appendChild(d.createTextNode(' ' + noun + ' · '));
        var b2 = d.createElement('b');
        b2.textContent = shown + ' of ' + rows.length;
        status.appendChild(b2);
        status.appendChild(d.createTextNode(' criteria' + (state.diff ? (shown ? ' — rows with the same status are hidden' : ' — every row has the same status for this selection') : '')));
      }
      writeUrl();
    }

    chips.forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-fx-supplier');
        var at = state.on.indexOf(id);
        if (at >= 0) {
          if (state.on.length <= MIN) { SC.toast('Keep at least two ' + noun + ' in the comparison.'); return; }
          state.on.splice(at, 1);
        } else {
          state.on = ids.filter(function (x) { return x === id || state.on.indexOf(x) >= 0; });
        }
        apply();
      });
    });
    if (diffBtn) diffBtn.addEventListener('click', function () { state.diff = !state.diff; apply(); });
    if (notesBtn) notesBtn.addEventListener('click', function () {
      var open = notesBtn.getAttribute('aria-pressed') !== 'true';
      rows.forEach(function (r) { if (r.btn && !r.btn.disabled) setOpen(r, open); });
      syncNotesBtn();
    });
    // A click anywhere on a criterion row (label or marks) opens its notes.
    table.addEventListener('click', function (e) {
      var tr = e.target.closest && e.target.closest('tr.fx-row');
      if (!tr || (e.target.closest('a') && !e.target.closest('.fx-rowbtn'))) return;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].tr === tr) {
          if (rows[i].btn && !rows[i].btn.disabled) { setOpen(rows[i], !tr.classList.contains('is-open')); syncNotesBtn(); }
          break;
        }
      }
    });

    readUrl();
    if (controls) controls.hidden = false;
    apply();
  });
})();
