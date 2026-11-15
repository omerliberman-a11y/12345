/* System Compare — product profile enhancements.
 *
 * 0. Category tabs: Home/End keys and [hidden] on load (core.js handles click and the arrow keys).
 * 1. Deep links (#cap-<category>-<check>, #plan-…) open the tab panel and the closed list they live in.
 * 2. Private notes: autosaved in this browser only (localStorage "sc-us-research-notes", same shape as the
 *    previous site: { vendorId: { text, updatedAt } }). Nothing is sent anywhere.
 * 3. "Save <plan> to shortlist" stores the researched plan next to the product in the shortlist.
 */
(function () {
  'use strict';
  var d = document, w = window, SC = w.SC;
  if (!SC) return;
  var $ = SC.$, $$ = SC.$$;

  // ------------------------------------------------------------------ category tabs
  // core.js wires click and ArrowLeft/ArrowRight. Added here: Home/End, and the [hidden] state on load so
  // browsers without :has() also start with one panel (the stylesheet covers the first paint elsewhere).
  $$('.sw-tabs[data-tabs]').forEach(function (box) {
    var tabs = $$('[role="tab"]', box);
    tabs.forEach(function (t) {
      var panel = d.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = t.getAttribute('aria-selected') !== 'true';
      t.addEventListener('keydown', function (e) {
        var to = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
        if (!to) return;
        e.preventDefault();
        to.click();
        to.focus();
      });
    });
  });

  // ------------------------------------------------------------------ deep links into tabs / closed lists
  function reveal() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    if (!id) return;
    var target = d.getElementById(id);
    if (!target || !target.closest('#main')) return;
    var changed = false;
    var panel = target.closest('.sw-panel[role="tabpanel"]');
    if (panel) {
      var tab = d.getElementById(panel.getAttribute('aria-labelledby'));
      if (tab && tab.getAttribute('aria-selected') !== 'true') { tab.click(); changed = true; }
    }
    for (var n = target; n && n !== d.body; n = n.parentElement) {
      if (n.tagName === 'DETAILS' && !n.open) { n.open = true; changed = true; }
    }
    if (changed) target.scrollIntoView();
  }
  w.addEventListener('hashchange', reveal);
  reveal();

  // ------------------------------------------------------------------ private notes
  var box = $('[data-sw-notes]');
  if (box) {
    var KEY = 'sc-us-research-notes', MAX = 5000, DELAY = 700;
    var vendorId = box.getAttribute('data-sw-notes');
    var field = $('[data-sw-note]', box), status = $('[data-sw-note-status]', box), count = $('[data-sw-note-count]', box);
    var timer = null, last = '';
    var all = function () { var o = SC.store(KEY, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };
    var say = function (msg) { status.textContent = msg; };
    var showCount = function () { count.textContent = field.value.length.toLocaleString('en-US') + ' / 5,000'; };
    var load = function () {
      var saved = all()[vendorId];
      last = saved && typeof saved.text === 'string' ? saved.text.slice(0, MAX) : '';
      field.value = last;
      showCount();
      say(last ? 'Saved in this browser.' : '');
    };
    var persist = function () {
      clearTimeout(timer); timer = null;
      var value = field.value.trim().slice(0, MAX);
      if (value === last) { say(value ? 'Saved in this browser.' : ''); return; }
      var o = all();
      if (value) o[vendorId] = { text: value, updatedAt: new Date().toISOString() }; else delete o[vendorId];
      if (!SC.save(KEY, Object.keys(o).length ? o : null)) { say('This browser could not save the note. Copy it before leaving this page.'); return; }
      say(value ? 'Saved in this browser.' : 'Note removed.');
      last = value;
    };
    load();
    field.addEventListener('input', function () { showCount(); say('Saving…'); clearTimeout(timer); timer = setTimeout(persist, DELAY); });
    field.addEventListener('blur', function () { if (timer) persist(); });
    w.addEventListener('pagehide', function () { if (timer) persist(); });
    w.addEventListener('storage', function (e) { if (e.key === KEY && d.activeElement !== field && !timer) load(); });
  }

  // ------------------------------------------------------------------ researched plan → shortlist
  var planButtons = $$('[data-sw-plan]');
  function syncPlans() {
    var o = SC.shortlist.get();
    planButtons.forEach(function (b) {
      var id = b.getAttribute('data-vendor'), isOn = o.ids.indexOf(id) >= 0 && o.plans[id] === b.getAttribute('data-sw-plan');
      b.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      b.textContent = isOn ? b.getAttribute('data-plan-name') + ' saved in your shortlist ✓' : 'Save ' + b.getAttribute('data-plan-name') + ' to shortlist';
    });
  }
  if (planButtons.length) {
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-sw-plan]');
      if (!b) return;
      var id = b.getAttribute('data-vendor'), category = b.getAttribute('data-category'), plan = b.getAttribute('data-sw-plan');
      var name = b.getAttribute('data-name'), planName = b.getAttribute('data-plan-name');
      var o = SC.shortlist.get();
      if (o.ids.indexOf(id) < 0) {
        if (SC.shortlist.toggle(id, category, name) !== 'added') return;
        o = SC.shortlist.get();
      } else if (o.category && o.category !== category) {
        SC.toast('Your shortlist compares products in one category at a time.', [{ label: 'Open shortlist', href: SC.url('/shortlist/') }]);
        return;
      }
      var removing = o.plans[id] === plan;
      if (removing) delete o.plans[id]; else o.plans[id] = plan;
      o.at = new Date().toISOString();
      if (!SC.save('sc-us-shortlist', o)) { SC.toast('This browser could not save your shortlist.'); return; }
      d.dispatchEvent(new CustomEvent('sc:shortlist-updated', { detail: SC.shortlist.get() }));
      SC.toast(removing ? name + ' now uses product-wide evidence in your shortlist.' : name + ' ' + planName + ' plan saved to your shortlist.');
    });
    d.addEventListener('sc:shortlist-updated', syncPlans);
    w.addEventListener('storage', function (e) { if (e.key === 'sc-us-shortlist') syncPlans(); });
    syncPlans();
  }
})();
