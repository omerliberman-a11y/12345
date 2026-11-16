/* System Compare — total cost calculator (/tools/cost/).
 *
 * Part 1 is the cost model: pure functions with no DOM access, exported as SC.cost in the browser and as
 * module.exports in Node (the build's worked example and the unit tests run the very same code).
 *   - calculateCostScenario(offer, input)   dated list price ("calculator-ready" offers) or the buyer's own quote
 *   - totalCost(input)                      the month-by-month own-quote formula with growth compounding
 *   - comparisonCsv(rows)                   assumptions export (documented columns, formula-injection guard)
 * Part 2 is the page: one category, up to three products, shared inputs, totals that update as you type,
 * state in the URL (?scope=&a=&b=&c=&months=…) so a scenario can be shared. Nothing is sent anywhere.
 *
 * The model is a partial cost model from dated public prices. It is not a quote and not a ranking.
 */
(function (root) {
  'use strict';

  // ==================================================================================== 1. the model
  var UNREADY = 'This price is not ready for automatic cost modeling. Its unit, tier, commitment or included scope still needs confirmation. You can enter your own whole-scope USD quote below.';
  var SUPPLIER_UNREADY = 'No calculator-ready price has been established for this supplier. Enter your own whole-scope USD quote, or leave it pending.';

  /** Compact offer from /data/cost-<category>.js → the documented offer shape (see src/lib/cost-catalog.mjs). */
  function expandOffer(c) {
    return {
      id: c.i,
      name: c.n,
      kind: c.k || 'unverified',
      amount: c.a === undefined ? null : c.a,
      publishedAmount: c.pa === undefined ? null : c.pa,
      currency: c.c === undefined ? 'USD' : c.c,
      unit: c.u || '',
      billing: c.b || '',
      summary: c.s || '',
      source: c.src || null,
      checkedAt: c.d || null,
      extras: c.x || [],
      commitmentMonths: c.cm === undefined ? null : c.cm,
      minimumQuantity: c.mq === undefined ? null : c.mq,
      maxEmails: c.me === undefined ? null : c.me,
      maxContacts: c.mc === undefined ? null : c.mc,
      unavailableReason: c.k ? '' : c.r === 2 ? SUPPLIER_UNREADY : typeof c.r === 'string' ? c.r : UNREADY,
    };
  }

  function fin(n) { return typeof n === 'number' && isFinite(n); }
  function num(value, o) {
    o = o || {};
    var min = o.min === undefined ? 0 : o.min, max = o.max === undefined ? 100000000 : o.max;
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return o.optional ? { value: null } : { error: 'required' };
    if (typeof value !== 'string' && typeof value !== 'number') return { error: 'invalid' };
    var n = Number(value);
    return isFinite(n) && n >= min && n <= max && (!o.integer || Math.floor(n) === n) ? { value: n } : { error: 'invalid' };
  }

  /**
   * Own-quote month-by-month formula (the previous "manual budget scenario", unchanged):
   *   cost[i] = (seats × rate + units × unitRate) × (1 + growth/100)^(i/12) + base + addons     for i = 0 … months-1
   *   total   = Σ cost + setup
   * Every value is clamped to [0, 1e9] (growth to [0, 1000]); months is rounded and clamped to 1–60.
   */
  function totalCost(input) {
    var v = {};
    ['seats', 'rate', 'base', 'units', 'unitRate', 'addons', 'setup', 'months', 'growth'].forEach(function (k) {
      var n = Number(input[k]);
      v[k] = Math.min(k === 'growth' ? 1000 : 1e9, Math.max(0, isFinite(n) ? n : 0));
    });
    var months = Math.min(60, Math.max(1, Math.round(v.months)));
    var recurring = 0, rows = [];
    for (var i = 0; i < months; i++) {
      var factor = Math.pow(1 + v.growth / 100, i / 12);
      var cost = (v.seats * v.rate + v.units * v.unitRate) * factor + v.base + v.addons;
      recurring += cost;
      rows.push(cost);
    }
    return { total: recurring + v.setup, monthly: rows[0], average: recurring / months, setup: v.setup, recurring: recurring, months: months, rows: rows };
  }

  /**
   * offer: one documented offer (expandOffer). input values are strings or numbers; '' = blank:
   *   months, addons, setup                       every scenario
   *   quantity                                    paid seats (seat offers, own quote with a per-seat price) or SMS segments
   *   emails, contacts                            entry email tier
   *   own: true                                   use the buyer's quote although the offer is calculator-ready
   *   quoteMonthly, quoteBilling                  own quote: whole-scope monthly amount, 'monthly' | 'annual'
   *   seatRate, units, unitRate, growth           own quote, optional: per-seat price, usage and annual growth
   *
   * billableMonths = ceil(months / commitmentMonths) × commitmentMonths      (annual terms round UP to whole years)
   * modeledExtras  = addons × months + setup                                 (extras run for the requested months only)
   * modeledTotal   = modeledBase + modeledExtras
   */
  function calculateCostScenario(offer, input) {
    input = input || {};
    var errors = [], fieldErrors = {}, excluded = ['Taxes', 'Price changes and renewal-rate changes', 'Costs not entered'], notes = [];
    function read(key, opts, label) {
      var n = num(input[key], opts);
      if (n.error) {
        var e = label + (n.error === 'required' ? ' is required.' : ' is outside the allowed range.');
        errors.push(e);
        fieldErrors[key] = e;
      }
      return n.value;
    }
    var months = read('months', { min: 1, max: 60, integer: true }, 'A modeling period of 1–60 whole months');
    var addons = read('addons', { optional: true }, 'Monthly extras'), setup = read('setup', { optional: true }, 'One-time costs');
    if (addons === null) excluded.push('Monthly extras: not entered');
    if (setup === null) excluded.push('One-time costs: not entered');
    if (!offer) return { status: 'pending', errors: ['Choose a product and offer.'], excluded: excluded };

    var monthlyBase, quantity = null, rate = offer.amount, commitmentMonths = offer.commitmentMonths, basis = 'documented-price', quantityLabel = '';
    var own = offer.kind === 'unverified' || input.own === true;
    var seatRate = null, units = null, unitRate = null, growth = null, itemised = false;
    if (own) {
      basis = 'user-quote';
      seatRate = read('seatRate', { optional: true }, 'Your monthly price per seat');
      units = read('units', { optional: true, max: 1000000000 }, 'Monthly usage units');
      unitRate = read('unitRate', { optional: true }, 'Your cost per usage unit');
      growth = read('growth', { optional: true, max: 1000 }, 'Annual seat and usage growth');
      itemised = fin(seatRate) || (fin(units) && fin(unitRate));
      // a per-seat or usage price can stand in for the whole-scope amount (which then is a fixed monthly fee, or blank)
      rate = read('quoteMonthly', { max: 100000000, optional: itemised }, 'Your monthly whole-scope quote in USD');
      if (input.quoteBilling !== 'monthly' && input.quoteBilling !== 'annual') {
        fieldErrors.quoteBilling = 'Choose the billing commitment for your quote.';
        errors.push(fieldErrors.quoteBilling);
      }
      commitmentMonths = input.quoteBilling === 'annual' ? 12 : 1;
      if (fin(seatRate)) {
        quantityLabel = 'Paid seats';
        quantity = read('quantity', { min: 1, max: 10000000, integer: true }, quantityLabel);
      }
      monthlyBase = (rate || 0) + (fin(seatRate) && fin(quantity) ? seatRate * quantity : 0) + (fin(units) && fin(unitRate) ? units * unitRate : 0);
      notes.push('The whole-scope monthly quote and commitment are your assumptions, not a verified supplier price.');
      if (itemised) {
        notes.push('Illustrative calculation based on your inputs. A flat annual commitment may not allow seats to decrease mid-term.');
        notes.push('Enter the monthly equivalent for an annual contract. Taxes, financing, currency changes and costs not entered are excluded.');
      }
      if (fin(growth) && growth > 0) notes.push('Annual growth of ' + growth + '% is compounded monthly. Growth applies to seats and usage only.');
    } else if (offer.currency !== 'USD' || !fin(rate) || rate < 0 || (commitmentMonths !== 1 && commitmentMonths !== 12)) {
      errors.push('The selected rate cannot be modeled safely.');
    } else if (offer.kind === 'seat' || offer.kind === 'segment') {
      quantityLabel = offer.kind === 'seat' ? 'Paid seats' : 'US SMS segments per month';
      quantity = read('quantity', { min: offer.kind === 'seat' ? 1 : 0, max: 10000000, integer: true }, quantityLabel);
      if (fin(quantity) && fin(offer.minimumQuantity) && quantity < offer.minimumQuantity) {
        fieldErrors.quantity = 'This offer requires at least ' + offer.minimumQuantity + ' ' + quantityLabel.toLowerCase() + '.';
        errors.push(fieldErrors.quantity);
      }
      if (offer.minimumQuantity === null || offer.minimumQuantity === undefined) notes.push('The supplier minimum quantity is not verified. Confirm that your entered quantity is eligible.');
      if (offer.kind === 'segment') notes.push('A text message can contain several billable segments. Enter total inbound and outbound segments; the base rate excludes carrier, number and registration fees.');
      monthlyBase = quantity * rate;
    } else if (offer.kind === 'email-tier') {
      var emails = read('emails', { max: 10000000, integer: true }, 'Monthly email sends'), contacts = read('contacts', { max: 10000000, integer: true }, 'Stored contacts');
      if (!fin(offer.maxEmails) || !fin(offer.maxContacts) || emails > offer.maxEmails || contacts > offer.maxContacts) {
        var e2 = 'The documented entry tier only covers up to ' + offer.maxEmails + ' emails per month and ' + offer.maxContacts + ' stored contacts. A different tier needs a new quote.';
        errors.push(e2);
        if (emails > offer.maxEmails) fieldErrors.emails = e2;
        if (contacts > offer.maxContacts) fieldErrors.contacts = e2;
      }
      monthlyBase = rate;
      quantity = 1;
      quantityLabel = 'Documented entry package';
      notes.push('Only the entry sending/contact tier is modeled. User seats, automation limits and add-ons must be checked in the selected plan.');
    } else errors.push('This pricing model requires a supplier quote.');

    if (Array.isArray(offer.extras)) offer.extras.forEach(function (x) { excluded.push('Unless covered by your entered extras: ' + x); });
    if (errors.length || !fin(monthlyBase)) return { status: 'pending', errors: errors, fieldErrors: fieldErrors, excluded: excluded, notes: notes, basis: basis };

    var billableMonths = Math.ceil(months / commitmentMonths) * commitmentMonths; // annual commitment rounds UP to whole years
    var modeledBase = monthlyBase * billableMonths, schedule = null;
    if (own && itemised) {
      // the documented own-quote formula, run over the committed months (extras are added below, for the requested months)
      schedule = totalCost({ seats: fin(quantity) ? quantity : 0, rate: seatRate || 0, base: rate || 0, units: units || 0, unitRate: unitRate || 0, addons: 0, setup: 0, months: billableMonths, growth: growth || 0 });
      modeledBase = schedule.recurring;
      monthlyBase = schedule.rows[0];
    }
    var modeledExtras = (addons === null ? 0 : addons) * months + (setup === null ? 0 : setup), modeledTotal = modeledBase + modeledExtras;
    if (!fin(modeledTotal) || modeledTotal > 1e15) return { status: 'pending', errors: ['The scenario total is outside the supported range.'], excluded: excluded, notes: notes, basis: basis };
    if (commitmentMonths === 12) notes.push('Annual commitment: ' + billableMonths + ' base-price months are included for a ' + months + '-month modeling window. This is committed base spend, not a monthly-payment offer.');
    notes.push('Entered monthly extras run for the requested ' + months + ' months. One-time costs are added once; no separate commitment for extras is assumed.');
    return {
      status: 'modeled', currency: 'USD', basis: basis, rate: rate, quantity: quantity, quantityLabel: quantityLabel, months: months, billableMonths: billableMonths,
      commitmentMonths: commitmentMonths, monthlyBase: monthlyBase, modeledBase: modeledBase, modeledExtras: modeledExtras, modeledTotal: modeledTotal, addons: addons, setup: setup,
      excluded: excluded, notes: notes, fieldErrors: fieldErrors,
      // recurring view (base + monthly extras, without one-time costs)
      firstMonth: monthlyBase + (addons === null ? 0 : addons),
      averageMonthly: (modeledBase + (addons === null ? 0 : addons) * months) / months,
      growth: own && fin(growth) ? growth : null, seatRate: seatRate, units: units, unitRate: unitRate,
      // month-by-month recurring cost of an itemised own quote (base for every committed month + monthly extras while requested)
      schedule: schedule ? schedule.rows.map(function (v, i) { return v + (i < months && addons !== null ? addons : 0); }) : null,
    };
  }

  // ---- CSV (CRLF, every cell quoted; cells that a spreadsheet could read as a formula get a leading apostrophe)
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  var COMPARISON_CSV_HEADER = ['Product', 'Offer', 'Status', 'Price basis', 'Currency', 'Rate', 'Quantity', 'Unit', 'Requested months', 'Committed base months', 'Base spend', 'Entered extras', 'Modeled spend', 'Evidence checked', 'Evidence source', 'Exclusions', 'Assumptions / pending items', 'Input months', 'Input seats or segments', 'Input email sends per month', 'Input stored contacts', 'Input monthly whole-scope quote USD', 'Input quote commitment', 'Input monthly extras USD (blank = excluded)', 'Input one-time costs USD (blank = excluded)', 'Offer commitment months', 'Offer minimum quantity (blank = unverified)', 'Offer maximum emails', 'Offer maximum contacts'];
  // appended after the documented 29 columns: the own-quote detail inputs and the recurring view
  var EXTRA_CSV_HEADER = ['Input monthly price per seat USD (own quote)', 'Input usage units per month (own quote)', 'Input cost per usage unit USD (own quote)', 'Input annual seat and usage growth % (own quote)', 'Average monthly recurring', 'First month recurring', 'Recurring cost by month (own quote priced per seat or usage)', 'Category'];
  /** rows: [{ product:{name}, offer, input, result, category }] → file system-compare-cost-assumptions.csv */
  function comparisonCsv(rows) {
    var cells = [COMPARISON_CSV_HEADER.concat(EXTRA_CSV_HEADER)];
    rows.forEach(function (row) {
      var r = row.result || {}, i = row.input || {}, o = row.offer || {};
      cells.push([
        row.product && row.product.name, o.name, r.status, r.basis === 'user-quote' ? 'User-entered quote' : 'Dated research snapshot', 'USD', r.rate, r.quantity, r.quantityLabel || o.unit, r.months, r.billableMonths,
        r.modeledBase, r.modeledExtras, r.modeledTotal, o.checkedAt, o.source, (r.excluded || []).join('; '), (r.notes || []).concat(r.errors || []).join('; '),
        i.months, i.quantity, i.emails, i.contacts, i.quoteMonthly, i.quoteBilling, i.addons, i.setup, o.commitmentMonths, o.minimumQuantity, o.maxEmails, o.maxContacts,
        i.seatRate, i.units, i.unitRate, i.growth, r.averageMonthly, r.firstMonth,
        (r.schedule || []).map(function (v, k) { return (k + 1) + ': ' + v.toFixed(2); }).join('; '), row.category,
      ]);
    });
    return cells.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  var api = { calculateCostScenario: calculateCostScenario, totalCost: totalCost, comparisonCsv: comparisonCsv, csvCell: csvCell, expandOffer: expandOffer, COMPARISON_CSV_HEADER: COMPARISON_CSV_HEADER, EXTRA_CSV_HEADER: EXTRA_CSV_HEADER };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (!root || !root.document || !root.SC) return;
  root.SC.cost = api;

  // ==================================================================================== 2. the page
  var d = root.document, SC = root.SC, $ = SC.$, $$ = SC.$$, el = SC.el;
  var app = $('[data-cost]');
  if (!app) return;

  var catSel = $('[data-cost-category]', app), addSel = $('[data-cost-add]', app), emptyBox = $('[data-cost-empty]', app), body = $('[data-cost-body]', app), scenarioBox = $('[data-cost-scenario]', app);
  var totalsBox = $('[data-cost-totals]', app), productsBox = $('[data-cost-products]', app), barBox = $('[data-cost-bar]', app);
  var statusEl = $('[data-cost-status]', app), noteEl = $('[data-cost-note]', app), csvBtn = $('[data-cost-csv]', app), resetBtn = $('[data-cost-reset]', app);
  var shared = {};
  $$('[data-cost-shared]', app).forEach(function (i) { shared[i.getAttribute('data-cost-shared')] = i; });

  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, NUMSTR = /^\d{1,12}(?:\.\d{1,6})?$/, LETTERS = ['a', 'b', 'c'], MAX = 3;
  var SHARED_KEYS = ['months', 'seats', 'segments', 'emails', 'contacts'];
  // slot property → [URL parameter prefix, model input key]
  var SLOT_KEYS = { quote: ['quote', 'quoteMonthly'], term: ['term', 'quoteBilling'], rate: ['rate', 'seatRate'], units: ['units', 'units'], unit: ['unit', 'unitRate'], growth: ['growth', 'growth'], addons: ['addons', 'addons'], setup: ['setup', 'setup'] };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var S, data = null, touched = {}, interacted = false, startedFromShortlist = 0, loadSeq = 0, lastSig = '', eventTimer = null;
  function fresh() { return { scope: '', months: '12', seats: '10', seatsExample: true, segments: '', emails: '', contacts: '', slots: [] }; }
  function newSlot(id) { return { id: id, offer: '', own: false, quote: '', term: '', rate: '', units: '', unit: '', growth: '', addons: '', setup: '', adv: false }; }
  S = fresh();

  // ------------------------------------------------------------------ formatting
  var fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function usd(n) { return fmt2.format(n); }
  function rateText(n, currency) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n); }
    catch (e) { return n + ' ' + currency; }
  }
  function dateText(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : ''; }
  function timeEl(iso) { return el('time', { datetime: iso, text: dateText(iso) }); }
  // the compact bar has a third of a phone's width per product: long totals are shown rounded there (the table has the exact figure)
  var compactFmt = null;
  try { compactFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }); } catch (e) { /* older browsers show the full figure */ }
  function barMoney(node, n) {
    var full = usd(n);
    node.textContent = '';
    node.classList.remove('is-text');
    if (compactFmt && full.length > 11) { node.appendChild(el('span.tl-bar__full', { text: full })); node.appendChild(el('span.tl-bar__short', { text: '≈ ' + compactFmt.format(n) })); }
    else node.textContent = full;
  }
  function monthsText(n) { return n + (Number(n) === 1 ? ' month' : ' months'); }
  function intText(n) { return Number(n).toLocaleString('en-US'); }

  // ------------------------------------------------------------------ lookups
  function product(slot) { return data ? data.byId[slot.id] : null; }
  function offerOf(slot) {
    var p = product(slot);
    if (!p) return null;
    for (var i = 0; i < p.offers.length; i++) if (p.offers[i].id === slot.offer) return p.offers[i];
    return null;
  }
  function modeOf(slot) { var o = offerOf(slot); return !o ? '' : o.kind === 'unverified' || slot.own ? 'own' : o.kind; }
  function defaultOffer(p) {
    for (var i = 0; i < p.offers.length; i++) if (p.offers[i].kind !== 'unverified') return p.offers[i].id;
    return p.offers[0].id;
  }
  function inputFor(slot) {
    var mode = modeOf(slot), input = { months: S.months, addons: slot.addons, setup: slot.setup };
    if (mode === 'own') {
      input.own = true; input.quoteMonthly = slot.quote; input.quoteBilling = slot.term;
      input.seatRate = slot.rate; input.units = slot.units; input.unitRate = slot.unit; input.growth = slot.growth;
      if (slot.rate.trim() !== '') input.quantity = S.seats;
    } else if (mode === 'seat') input.quantity = S.seats;
    else if (mode === 'segment') input.quantity = S.segments;
    else if (mode === 'email-tier') { input.emails = S.emails; input.contacts = S.contacts; }
    return input;
  }
  function results() { return S.slots.map(function (slot) { return calculateCostScenario(offerOf(slot), inputFor(slot)); }); }

  // which "touched" flag belongs to a model input key of a slot
  function touchKey(slot, i, key) {
    if (key === 'months' || key === 'emails' || key === 'contacts') return key;
    if (key === 'quantity') return modeOf(slot) === 'segment' ? 'segments' : 'seats';
    for (var prop in SLOT_KEYS) if (SLOT_KEYS[prop][1] === key) return LETTERS[i] + '.' + prop;
    return key;
  }

  // ------------------------------------------------------------------ URL state
  function allParams() {
    var list = ['scope'].concat(LETTERS, SHARED_KEYS);
    LETTERS.forEach(function (L) { list.push('offer_' + L, 'own_' + L); for (var k in SLOT_KEYS) list.push(SLOT_KEYS[k][0] + '_' + L); });
    return list;
  }
  function readUrl() {
    var q = new URLSearchParams(location.search), v = q.get('scope');
    if (v && SLUG.test(v)) S.scope = v;
    LETTERS.forEach(function (L) {
      var id = q.get(L);
      if (!id || !SLUG.test(id) || S.slots.some(function (s) { return s.id === id; })) return;
      var slot = newSlot(id), o = q.get('offer_' + L);
      slot.fromUrl = [];
      if (o && SLUG.test(o)) slot.offer = o;
      slot.own = q.get('own_' + L) === '1';
      for (var k in SLOT_KEYS) {
        var val = q.get(SLOT_KEYS[k][0] + '_' + L);
        if (k === 'term') { if (val === 'monthly' || val === 'annual') { slot.term = val; slot.fromUrl.push(k); } }
        else if (val && NUMSTR.test(val)) { slot[k] = val; slot.fromUrl.push(k); }
      }
      slot.adv = !!(slot.rate || slot.units || slot.unit || slot.growth);
      S.slots.push(slot);
    });
    SHARED_KEYS.forEach(function (k) {
      var val = q.get(k);
      if (val && NUMSTR.test(val)) { S[k] = val; touched[k] = true; if (k === 'seats') S.seatsExample = false; }
    });
  }
  function writeUrl() {
    var q = new URLSearchParams(location.search);
    allParams().forEach(function (k) { q.delete(k); });
    if (S.scope) q.set('scope', S.scope);
    S.slots.forEach(function (slot, i) {
      var L = LETTERS[i], p = product(slot), mode = modeOf(slot);
      q.set(L, slot.id);
      if (p && p.offers.length > 1 && slot.offer !== defaultOffer(p)) q.set('offer_' + L, slot.offer);
      if (slot.own && offerOf(slot) && offerOf(slot).kind !== 'unverified') q.set('own_' + L, '1');
      for (var k in SLOT_KEYS) {
        var ownOnly = k !== 'addons' && k !== 'setup';
        if (slot[k] && (!ownOnly || mode === 'own' || !p)) q.set(SLOT_KEYS[k][0] + '_' + L, slot[k]);
      }
    });
    if (S.slots.length) {
      if (S.months !== '12') q.set('months', S.months);
      if (!S.seatsExample && S.seats) q.set('seats', S.seats);
      ['segments', 'emails', 'contacts'].forEach(function (k) { if (S[k]) q.set(k, S[k]); });
    }
    var s = q.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) { /* file:// previews */ }
  }

  // ------------------------------------------------------------------ data
  function setStatus(text) { statusEl.textContent = text; }
  function loadCategory() {
    var seq = ++loadSeq, scope = S.scope;
    data = null;
    // only categories the picker offers are ever requested (an unknown ?scope= is ignored, not fetched)
    if (scope && !$$('option', catSel).some(function (o) { return o.value === scope; })) { S.scope = scope = ''; S.slots = []; }
    if (!scope) { render(); return; }
    SC.load('cost-' + scope).then(function (raw) {
      if (seq !== loadSeq) return;
      var byId = {};
      var products = raw.p.map(function (p) {
        var out = { id: p.i, name: p.n, logo: p.l || '', dark: !!p.d, wide: !!p.w, supplier: !!p.f, offers: p.o.map(expandOffer) };
        out.href = out.supplier ? '/categories/' + raw.id + '/#supplier-' + p.i : '/software/' + p.i + '/';
        byId[out.id] = out;
        return out;
      });
      data = { id: raw.id, name: raw.n, products: products, byId: byId };
      // keep only products of this category, at most three; pick each product's default offer
      S.slots = S.slots.filter(function (slot) { return byId[slot.id]; }).slice(0, MAX);
      S.slots.forEach(function (slot, i) {
        if (!offerOf(slot)) slot.offer = defaultOffer(byId[slot.id]);
        (slot.fromUrl || []).forEach(function (k) { touched[LETTERS[i] + '.' + k] = true; });
        delete slot.fromUrl;
      });
      render();
    }).catch(function () {
      if (seq !== loadSeq) return;
      S.scope = ''; S.slots = [];
      render();
      setStatus('The price data for this category could not be loaded. Refresh and try again.');
      statusEl.classList.remove('sr-only');
    });
  }

  // ------------------------------------------------------------------ DOM builders
  function logoEl(p, small) {
    var cls = 'span.logo' + (small ? '.logo--sm' : '') + (p.dark ? '.logo--dark' : '');
    if (p.logo) {
      var tile = el(cls, null, [el('img', { src: SC.url(p.logo), alt: '', width: 32, height: 32, loading: 'lazy', decoding: 'async' })]);
      return small && p.wide && SC.monogram ? SC.monogram(tile, p.name) : tile; // a wide wordmark is unreadable in the small tile
    }
    var initials = p.name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
    return el(cls, { 'aria-hidden': 'true' }, [el('span.logo__fallback', { text: initials })]);
  }
  function numberField(L, prop, o) {
    var id = 'tl-' + L + '-' + prop;
    var input = el('input.input', { id: id, type: 'number', inputmode: o.integer ? 'numeric' : 'decimal', min: o.min === undefined ? 0 : o.min, max: o.max, step: o.step || 'any', value: o.value, autocomplete: 'off', 'data-k': prop, 'aria-describedby': (o.hint ? id + '-hint ' : '') + id + '-err' });
    return el('div.field', null, [el('label', { for: id, text: o.label }), input, o.hint ? el('span.hint', { id: id + '-hint', text: o.hint }) : null, el('span.error', { id: id + '-err', hidden: true })]);
  }

  function buildProduct(slot, i) {
    var p = product(slot), o = offerOf(slot), L = LETTERS[i], mode = modeOf(slot), ready = o.kind !== 'unverified';
    var kids = [];
    kids.push(el('div.tl-prod__head', null, [
      logoEl(p, true),
      el('h4', { id: 'tl-' + L + '-h', text: p.name }),
      el('button.tl-remove', { type: 'button', 'data-remove': String(i), 'aria-label': 'Remove ' + p.name + ' from the calculation', text: 'Remove' }),
    ]));
    // what the total covers — phones only (the same two lines are rows of the totals table on wide screens)
    kids.push(el('div.tl-prod__scope', null, [el('p', { 'data-inc': '' }), el('p', { 'data-exc': '' })]));

    // --- offer
    if (p.offers.length > 1) {
      var sel = el('select.select', { id: 'tl-' + L + '-offer', 'data-offer': '' }, p.offers.map(function (x) {
        var opt = el('option', { value: x.id, text: x.name + (x.kind === 'unverified' ? ' — your own quote' : ' — list price modelled') });
        if (x.id === o.id) opt.selected = true;
        return opt;
      }));
      kids.push(el('div.field', null, [el('label', { for: 'tl-' + L + '-offer', text: 'Offer' }), sel]));
    }
    var offerLine = p.offers.length > 1 ? null : el('p.tl-rate__sub', { text: 'Offer: ' + o.name });
    if (ready && mode !== 'own') {
      var noteLines = [o.commitmentMonths === 12 ? 'Billed with a 12-month commitment.' : 'No annual commitment is assumed in this model.'];
      if (o.kind === 'email-tier') noteLines.push('Entry-tier ceiling: ' + o.maxEmails + ' email sends and ' + o.maxContacts + ' stored contacts. Higher tiers need a quote.');
      kids.push(el('div.tl-rate', null, [
        el('p.tl-rate__main', null, [el('b.num', { text: rateText(o.amount, o.currency) }), ' ' + o.unit]),
        offerLine,
        el('p.tl-rate__sub', null, ['Dated list price', o.checkedAt ? ', checked ' : '', o.checkedAt ? timeEl(o.checkedAt) : null, '. ' + noteLines.join(' ')]),
      ]));
    } else if (ready) {
      kids.push(el('div.tl-rate', null, [
        el('p.tl-rate__main', null, [el('b', { text: 'Your own quote' })]),
        offerLine,
        el('p.tl-rate__sub', null, ['The dated list price (', el('b.num', { text: rateText(o.amount, o.currency) }), ' ' + o.unit + ') is not used while this is switched on.']),
      ]));
    } else {
      kids.push(el('div.tl-rate', null, [
        el('p.tl-rate__main', null, [el('b', { text: 'Your own quote' })]),
        offerLine,
        o.publishedAmount !== null ? el('p.tl-rate__sub', null, ['Published list price: ', el('b.num', { text: rateText(o.publishedAmount, o.currency) }), (o.unit ? ' ' + o.unit : '') + '. Shown for reference; it is not used in the model.']) : null,
        el('p.tl-rate__sub', { text: o.unavailableReason }),
      ]));
    }
    if (ready) {
      var cb = el('input', { type: 'checkbox', id: 'tl-' + L + '-own', 'data-own': '' });
      cb.checked = !!slot.own;
      kids.push(el('label.check.tl-own', { for: 'tl-' + L + '-own' }, [cb, el('span', { text: 'Use my own quote instead of the list price' })]));
    }

    // --- own quote
    if (mode === 'own') {
      kids.push(numberField(L, 'quote', { label: 'Your monthly whole-scope quote (USD)', max: 100000000, step: '0.01', value: slot.quote }));
      var term = el('select.select', { id: 'tl-' + L + '-term', 'data-k': 'term', 'aria-describedby': 'tl-' + L + '-term-err' }, [
        ['', 'Select the quoted commitment'], ['monthly', 'Monthly · no annual term assumed'], ['annual', 'Annual · 12-month commitment'],
      ].map(function (x) { var opt = el('option', { value: x[0], text: x[1] }); if (x[0] === slot.term) opt.selected = true; return opt; }));
      kids.push(el('div.field', null, [el('label', { for: 'tl-' + L + '-term', text: 'Your quote commitment' }), term, el('span.error', { id: 'tl-' + L + '-term-err', hidden: true })]));
      kids.push(el('p.hint', { text: 'Enter the monthly equivalent for the complete quantity and package in your quote. This is your assumption, not a price verified by System Compare.' }));
      var adv = el('details.tl-adv', { 'data-adv': '' }, [
        el('summary', { text: 'Price it per seat or by usage, with growth' }),
        el('div.tl-adv__body', null, [
          el('p.hint', { text: 'Optional. Use a vendor quote or verified plan price; the calculator makes your assumptions visible and does not guess missing costs. Each month costs (paid seats × price per seat + usage units × cost per unit), grown by the annual rate and compounded monthly, plus the whole-scope amount above as a fixed monthly fee (leave it blank if there is none).' }),
          numberField(L, 'rate', { label: 'Monthly price per seat (USD)', max: 100000000, step: '0.01', value: slot.rate, hint: 'Multiplied by the paid seats entered above.' }),
          numberField(L, 'units', { label: 'Monthly usage units', max: 1000000000, step: '1', integer: true, value: slot.units }),
          numberField(L, 'unit', { label: 'Cost per usage unit (USD)', max: 100000000, step: '0.001', value: slot.unit }),
          numberField(L, 'growth', { label: 'Annual seat & usage growth (%)', max: 1000, step: '1', value: slot.growth, hint: 'Growth applies to seats and usage only.' }),
        ]),
      ]);
      if (slot.adv) adv.open = true;
      kids.push(adv);
    }

    // --- extras
    kids.push(numberField(L, 'addons', { label: 'Add-ons per month (USD, optional)', max: 100000000, step: '0.01', value: slot.addons }));
    kids.push(numberField(L, 'setup', { label: 'One-time setup costs (USD, optional)', max: 100000000, step: '0.01', value: slot.setup }));

    // --- evidence
    var links = [];
    if (o.source) links.push(el('a.ext', { href: o.source, target: '_blank', rel: 'noopener noreferrer', text: 'Published pricing source' }));
    links.push(el('a', { href: SC.url(p.href), text: 'Review ' + p.name + ' research' }));
    kids.push(el('div.tl-evidence', null, [
      el('p', { text: o.summary || 'Confirm the package, included units and billing commitment with the supplier.' }),
      o.checkedAt ? el('p', null, ['Research snapshot checked ', timeEl(o.checkedAt), '. Reconfirm current terms.']) : el('p', { text: 'Pricing date and calculator-ready evidence have not been verified.' }),
      el('p.tl-evidence__links', null, links),
    ]));

    // --- assumptions and exclusions (filled by update)
    kids.push(el('details.tl-assume', { id: 'tl-' + L + '-assume' }, [el('summary', { text: 'Assumptions and excluded costs' }), el('div.tl-assume__body', { 'data-assume': '' })]));

    return el('section.tl-prod', { 'data-slot': String(i), 'aria-labelledby': 'tl-' + L + '-h' }, kids);
  }

  function buildTotals() {
    var n = S.slots.length, fill = [];
    for (var f = n; f < MAX; f++) fill.push(f);
    function row(key, label, labelAttr) {
      var th = el('th', { scope: 'row' }, [labelAttr ? el('span', { 'data-months-label': '', text: label }) : label]);
      th.setAttribute('role', 'rowheader');
      return el('tr', { 'data-row': key, role: 'row' }, [th].concat(S.slots.map(function (slot, i) { return el('td', { 'data-cell': key + i, role: 'cell' }); }), fill.map(function () { return el('td.tl-fill', { role: 'cell' }); })));
    }
    var head = el('tr', { role: 'row' }, [el('th', { scope: 'col', role: 'columnheader' }, [el('span.sr-only', { text: 'Figure' })])].concat(
      S.slots.map(function (slot, i) {
        var p = product(slot);
        return el('th', { scope: 'col', role: 'columnheader' }, [el('span.tl-totals__prod', null, [logoEl(p, true), el('span', { text: p.name }), el('button.tl-remove', { type: 'button', 'data-remove': String(i), 'aria-label': 'Remove ' + p.name + ' from the calculation', text: 'Remove' })])]);
      }),
      fill.map(function (x, k) { return el('td.tl-fill', { role: 'cell' }, [k === 0 ? el('span.tl-totals__hint', { text: 'Add another product above to compare.' }) : null]); })
    ));
    var table = el('table.tl-totals', { 'data-n': String(n), role: 'table' }, [
      el('caption.sr-only', { text: 'Modelled cost per product. Partial cost models from dated public prices or your own quote, not supplier quotes.' }),
      el('thead', { role: 'rowgroup' }, [head]),
      el('tbody', { role: 'rowgroup' }, [row('total', 'Total', true), row('avg', 'Average per month'), row('inc', 'Included'), row('exc', 'Not included')]),
    ]);
    totalsBox.textContent = '';
    totalsBox.appendChild(table);
    // compact copy that sticks under the header while the per-product inputs are on screen
    barBox.textContent = '';
    S.slots.forEach(function (slot, i) { barBox.appendChild(el('span.tl-bar__item', null, [el('span.tl-bar__name', { text: product(slot).name }), el('b.num', { 'data-bar': String(i) })])); });
  }

  // ------------------------------------------------------------------ render (structure) and update (numbers)
  function render() {
    var active = d.activeElement && d.activeElement.id && app.contains(d.activeElement) ? d.activeElement.id : '';
    catSel.value = S.scope;
    if (catSel.value !== S.scope) { S.scope = ''; data = null; }

    // product picker
    addSel.textContent = '';
    if (!data) {
      addSel.appendChild(el('option', { value: '', text: S.scope ? 'Loading products…' : 'Choose a category first' }));
      addSel.disabled = true;
    } else {
      var full = S.slots.length >= MAX, chosen = {};
      S.slots.forEach(function (s) { chosen[s.id] = 1; });
      addSel.appendChild(el('option', { value: '', text: full ? 'Three selected — remove one to add' : S.slots.length ? 'Add another product' : 'Choose a product' }));
      var readyList = data.products.filter(function (p) { return p.offers.some(function (o) { return o.kind !== 'unverified'; }); });
      var rest = data.products.filter(function (p) { return readyList.indexOf(p) < 0; });
      var opt = function (p) { var o = el('option', { value: p.id, text: p.name }); if (chosen[p.id]) o.disabled = true; return o; };
      if (readyList.length) {
        addSel.appendChild(el('optgroup', { label: 'List price modelled automatically' }, readyList.map(opt)));
        addSel.appendChild(el('optgroup', { label: 'Modelled from your own quote' }, rest.map(opt)));
      } else rest.forEach(function (p) { addSel.appendChild(opt(p)); });
      addSel.disabled = full;
    }

    var has = !!(data && S.slots.length);
    body.hidden = !has;
    scenarioBox.hidden = !has;
    emptyBox.hidden = has;
    resetBtn.hidden = !S.scope;
    statusEl.classList.toggle('sr-only', !has);
    if (has) {
      syncShared();
      buildTotals();
      productsBox.textContent = '';
      productsBox.setAttribute('data-n', String(S.slots.length));
      S.slots.forEach(function (slot, i) { productsBox.appendChild(buildProduct(slot, i)); });
    } else {
      // nothing selected: no stale (hidden) inputs or totals stay behind
      totalsBox.textContent = ''; productsBox.textContent = ''; barBox.textContent = '';
    }
    // where the scenario came from
    noteEl.textContent = '';
    noteEl.hidden = !(startedFromShortlist && has);
    if (startedFromShortlist && has) {
      noteEl.appendChild(d.createTextNode('Started from your shortlist' + (startedFromShortlist > MAX ? ' (the calculator compares up to three products; the first three are shown)' : '') + '. '));
      noteEl.appendChild(el('button.tl-link', { type: 'button', 'data-start-empty': '', text: 'Start empty instead' }));
    }
    update();
    if (active) { var again = d.getElementById(active); if (again && again !== d.activeElement) again.focus(); }
    if (data || !S.scope) app.setAttribute('data-state', 'ready'); // not while a category's data is still on its way
  }

  /** Shared inputs appear only when a selected product uses them (paid seats: seat prices and per-seat quotes). */
  function syncShared() {
    var modes = S.slots.map(modeOf);
    var perSeatQuote = S.slots.some(function (slot) { return modeOf(slot) === 'own' && (slot.adv || slot.rate !== ''); });
    var show = { months: true, seats: modes.indexOf('seat') >= 0 || perSeatQuote, segments: modes.indexOf('segment') >= 0, emails: modes.indexOf('email-tier') >= 0, contacts: modes.indexOf('email-tier') >= 0 };
    SHARED_KEYS.forEach(function (k) {
      shared[k].closest('.field').hidden = !show[k];
      if (d.activeElement !== shared[k]) shared[k].value = S[k];
    });
  }
  // interface wording for the one model message that reads badly (the model and the CSV keep the original string)
  function say(msg) { return msg === 'A modeling period of 1–60 whole months is outside the allowed range.' ? 'Enter a whole number of months from 1 to 60.' : msg === 'A modeling period of 1–60 whole months is required.' ? 'Enter the number of months to model, from 1 to 60.' : msg; }
  function setError(input, msg) {
    if (!input) return;
    var err = d.getElementById(input.id + '-err');
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    if (err) { err.textContent = msg ? say(msg) : ''; err.hidden = !msg; }
  }
  function pendingInfo(slot, i, r) {
    var fe = r.fieldErrors || {}, hard = [];
    (r.errors || []).forEach(function (msg) {
      var key = null;
      for (var k in fe) if (fe[k] === msg) { key = k; break; }
      if (!key || touched[touchKey(slot, i, key)]) hard.push(msg);
    });
    if (hard.length) return { hard: hard, short: 'Pending' };
    var mode = modeOf(slot);
    if (mode === 'own') return (slot.quote !== '' || slot.rate !== '') && !slot.term ? { prompt: 'Choose your quote commitment', short: 'Commitment needed' } : { prompt: 'Enter your quote', short: 'Quote needed' };
    if (mode === 'email-tier') return { prompt: 'Enter sends and contacts', short: 'Sends needed' };
    if (mode === 'segment') return { prompt: 'Enter SMS segments', short: 'Segments needed' };
    return { prompt: 'Enter paid seats', short: 'Seats needed' };
  }
  function includedText(slot, r) {
    var o = offerOf(slot), mode = modeOf(slot), base;
    if (mode === 'own') base = 'Your quote for ' + monthsText(r.billableMonths) + (r.growth ? ', growing ' + r.growth + '% a year' : '');
    else if (mode === 'seat') base = intText(r.quantity) + (r.quantity === 1 ? ' paid seat' : ' paid seats') + ' × ' + rateText(r.rate, 'USD') + ' for ' + monthsText(r.billableMonths);
    else if (mode === 'segment') base = intText(r.quantity) + ' SMS segments a month × ' + rateText(r.rate, 'USD') + ' for ' + monthsText(r.billableMonths);
    else base = o.name + ' entry tier at ' + rateText(r.rate, 'USD') + ' a month for ' + monthsText(r.billableMonths);
    if (r.billableMonths !== r.months) base += ' (annual commitment)';
    return base + (r.modeledExtras > 0 ? ', plus ' + usd(r.modeledExtras) + ' of extras you entered' : '');
  }
  function excludedNodes(slot, i, r) {
    var extra = (r.excluded || []).length - 3;
    return ['Taxes, price and renewal changes, costs not entered' + (extra > 0 ? ' and ' + extra + ' more. ' : '. '), el('a', { href: '#tl-' + LETTERS[i] + '-assume', 'data-open-assume': String(i), text: 'See all' })];
  }
  function fillAssume(box, slot, i, r) {
    box.textContent = '';
    if (r.status === 'modeled') {
      var rows = [
        ['Price basis', r.basis === 'user-quote' ? 'Your quote assumption' : 'Dated documented rate'],
        [r.growth ? 'Base monthly equivalent (first month)' : 'Base monthly equivalent', usd(r.monthlyBase)],
        ['Requested modeling window', monthsText(r.months)],
        ['Base-price commitment modeled', monthsText(r.billableMonths)],
        ['Committed base spend', usd(r.modeledBase)],
        ['Entered extras over requested window', usd(r.modeledExtras)],
      ];
      if (r.growth) rows.push(['First month recurring', usd(r.firstMonth)]);
      rows.push(['Average monthly recurring', usd(r.averageMonthly)]);
      box.appendChild(el('dl.tl-dl', null, rows.map(function (x) { return el('div', null, [el('dt', { text: x[0] }), el('dd.num', { text: x[1] })]); })));
    } else {
      var info = pendingInfo(slot, i, r);
      box.appendChild(el('p.tl-assume__pending', { text: info.hard ? 'Cost pending. ' + info.hard.map(say).join(' ') : 'Cost pending — the breakdown appears once the inputs above are complete.' }));
    }
    if (r.status === 'modeled' && r.schedule) {
      // the month-by-month view the previous manual calculator drew as a bar chart
      var max = Math.max.apply(null, r.schedule) || 1;
      box.appendChild(el('details.tl-months', null, [
        el('summary', { text: 'Recurring cost by month' }),
        el('ol', null, r.schedule.map(function (v, k) { return el('li', null, [el('span', { text: 'Month ' + (k + 1) }), el('i', { 'aria-hidden': 'true', style: 'width:' + Math.max(2, Math.round((v / max) * 100)) + '%' }), el('b.num', { text: usd(v) })]); })),
      ]));
    }
    if (r.notes && r.notes.length) { box.appendChild(el('h5', { text: 'Assumptions' })); box.appendChild(el('ul.dots', null, r.notes.map(function (t) { return el('li', { text: t }); }))); }
    box.appendChild(el('h5', { text: 'Not included' }));
    box.appendChild(el('ul.crosses', null, (r.excluded || []).map(function (t) { return el('li', { text: t }); })));
  }

  function update() {
    var has = !!(data && S.slots.length);
    if (!has) {
      setStatus(data ? 'Choose up to three products to compare.' : S.scope ? 'Loading…' : 'Choose a category, then up to three products.');
      csvBtn.disabled = true;
      writeUrl();
      return;
    }
    var res = results(), modeled = 0, sharedErr = {};
    var label = $('[data-months-label]', totalsBox);
    if (label) label.textContent = /^\d+$/.test(S.months) && Number(S.months) >= 1 && Number(S.months) <= 60 ? 'Total for ' + monthsText(Number(S.months)) : 'Total';

    S.slots.forEach(function (slot, i) {
      var r = res[i], L = LETTERS[i], block = $('[data-slot="' + i + '"]', productsBox);
      var cTotal = $('[data-cell="total' + i + '"]', totalsBox), cAvg = $('[data-cell="avg' + i + '"]', totalsBox), cInc = $('[data-cell="inc' + i + '"]', totalsBox), cExc = $('[data-cell="exc' + i + '"]', totalsBox);
      var bar = $('[data-bar="' + i + '"]', barBox), pInc = $('[data-inc]', block), pExc = $('[data-exc]', block);
      cTotal.textContent = ''; cAvg.textContent = ''; cInc.textContent = ''; cExc.textContent = ''; pInc.textContent = ''; pExc.textContent = '';
      if (r.status === 'modeled') {
        modeled++;
        var money = usd(r.modeledTotal);
        cTotal.appendChild(el('b.tl-total.num' + (money.length > 18 ? '.is-long.is-xlong' : money.length > 10 ? '.is-long' : ''), { text: money }));
        cTotal.appendChild(d.createTextNode(' '));
        cTotal.appendChild(el('small.tl-cap.tl-cap--pre', { text: monthsText(r.months) }));
        cAvg.appendChild(el('span.num', { text: usd(r.averageMonthly) }));
        cAvg.appendChild(d.createTextNode(' '));
        cAvg.appendChild(el('small.tl-cap', { text: 'avg per month' }));
        var inc = includedText(slot, r);
        cInc.textContent = inc;
        pInc.appendChild(el('b', { text: 'Included: ' })); pInc.appendChild(d.createTextNode(inc));
        barMoney(bar, r.modeledTotal);
      } else {
        var info = pendingInfo(slot, i, r);
        if (info.hard) {
          cTotal.appendChild(el('span.tl-pending', { text: 'Cost pending' }));
          cTotal.appendChild(el('ul.tl-pending__why', null, info.hard.map(function (t) { return el('li', { text: say(t) }); })));
          cTotal.appendChild(el('small.tl-cap', { text: 'see the marked fields' }));
          pInc.appendChild(el('b', { text: 'Cost pending: ' })); pInc.appendChild(d.createTextNode(info.hard.map(say).join(' ')));
        } else {
          cTotal.appendChild(el('span.tl-pending', { text: info.prompt }));
          pInc.appendChild(el('b', { text: 'Included: ' })); pInc.appendChild(d.createTextNode('nothing yet — ' + info.prompt.charAt(0).toLowerCase() + info.prompt.slice(1) + ' below.'));
        }
        cAvg.appendChild(el('span.tl-dash', { 'aria-hidden': 'true', text: '—' }));
        cAvg.appendChild(el('span.sr-only', { text: 'Not available yet' }));
        cInc.textContent = 'Nothing yet — complete the inputs for this product.';
        bar.textContent = info.short;
        bar.classList.add('is-text');
      }
      excludedNodes(slot, i, r).forEach(function (n) { cExc.appendChild(typeof n === 'string' ? d.createTextNode(n) : n); });
      pExc.appendChild(el('b', { text: 'Not included: ' }));
      excludedNodes(slot, i, r).forEach(function (n) { pExc.appendChild(typeof n === 'string' ? d.createTextNode(n) : n); });
      fillAssume($('[data-assume]', block), slot, i, r);

      // field errors: only for fields the reader has already used
      var fe = r.fieldErrors || {};
      for (var prop in SLOT_KEYS) {
        var input = d.getElementById('tl-' + L + '-' + prop), key = SLOT_KEYS[prop][1];
        setError(input, fe[key] && touched[L + '.' + prop] ? fe[key] : '');
      }
      ['months', 'quantity', 'emails', 'contacts'].forEach(function (key) {
        var tk = touchKey(slot, i, key);
        if (fe[key] && touched[tk] && !sharedErr[tk]) sharedErr[tk] = fe[key];
      });
    });
    SHARED_KEYS.forEach(function (k) {
      var msg = sharedErr[k] || '';
      setError(shared[k], msg.indexOf('The documented entry tier only covers') === 0 ? 'More than the documented entry tier covers. A different tier needs a new quote.' : msg);
    });
    var hint = d.getElementById('tl-seats-hint');
    if (hint) hint.textContent = S.seatsExample ? 'Example input: 10 paid seats. Change this to your team size.' : 'Multiplies per-seat prices. A whole-scope quote already covers your team.';

    setStatus(modeled + ' of ' + S.slots.length + ' selected scenarios can be modeled. ' + (modeled < S.slots.length ? 'Complete the pending inputs. ' : '') + 'Compare the scope, commitment and exclusions before deciding.');
    csvBtn.disabled = false;
    writeUrl();

    // analytics: one event per completed calculation the reader caused (no amounts, no product data leave the page)
    if (interacted && modeled > 0) {
      var sig = JSON.stringify([S.scope, S.slots.map(function (s) { return s.id + ':' + s.offer; }), res.map(function (r) { return r.status === 'modeled' ? r.modeledTotal : null; })]);
      clearTimeout(eventTimer);
      if (sig !== lastSig) eventTimer = setTimeout(function () { lastSig = sig; d.dispatchEvent(new CustomEvent('sc:cost-calculation', { detail: { category: S.scope, products: S.slots.length, modeled: modeled } })); }, 1200);
    }
  }

  // ------------------------------------------------------------------ events
  catSel.addEventListener('change', function () {
    S.scope = SLUG.test(catSel.value) ? catSel.value : '';
    S.slots = []; touched = {}; startedFromShortlist = 0; interacted = true;
    loadCategory();
  });
  addSel.addEventListener('change', function () {
    var id = addSel.value;
    if (!data || !id || !data.byId[id] || S.slots.length >= MAX || S.slots.some(function (s) { return s.id === id; })) return;
    var slot = newSlot(id);
    slot.offer = defaultOffer(data.byId[id]);
    S.slots.push(slot);
    interacted = true;
    render();
    addSel.focus();
  });
  SHARED_KEYS.forEach(function (k) {
    shared[k].addEventListener('input', function () {
      S[k] = shared[k].value.trim();
      if (k === 'seats') S.seatsExample = false;
      touched[k] = true; interacted = true;
      update();
    });
    shared[k].addEventListener('blur', function () { if (!touched[k]) { touched[k] = true; update(); } });
  });
  function slotOf(target) { var b = target.closest('[data-slot]'); return b ? Number(b.getAttribute('data-slot')) : -1; }
  productsBox.addEventListener('input', function (e) {
    var i = slotOf(e.target), k = e.target.getAttribute('data-k');
    if (i < 0 || !k || !S.slots[i] || k === 'term') return;
    S.slots[i][k] = e.target.value.trim();
    touched[LETTERS[i] + '.' + k] = true; interacted = true;
    update();
  });
  productsBox.addEventListener('change', function (e) {
    var i = slotOf(e.target), t = e.target;
    if (i < 0 || !S.slots[i]) return;
    interacted = true;
    if (t.hasAttribute('data-offer')) { S.slots[i].offer = t.value; S.slots[i].own = false; render(); }
    else if (t.hasAttribute('data-own')) { S.slots[i].own = t.checked; render(); }
    else if (t.getAttribute('data-k') === 'term') { S.slots[i].term = t.value; touched[LETTERS[i] + '.term'] = true; update(); }
  });
  productsBox.addEventListener('focusout', function (e) {
    var i = slotOf(e.target), k = e.target.getAttribute && e.target.getAttribute('data-k');
    if (i < 0 || !k || touched[LETTERS[i] + '.' + k]) return;
    touched[LETTERS[i] + '.' + k] = true;
    update();
  });
  productsBox.addEventListener('toggle', function (e) {
    var i = slotOf(e.target);
    if (i >= 0 && S.slots[i] && e.target.hasAttribute && e.target.hasAttribute('data-adv')) { S.slots[i].adv = e.target.open; syncShared(); }
  }, true);
  app.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-remove], [data-open-assume], [data-start-empty], [data-cost-reset], [data-cost-csv]') : null;
    if (!t) return;
    if (t.hasAttribute('data-remove')) {
      var i = Number(t.getAttribute('data-remove')), name = product(S.slots[i]).name;
      S.slots.splice(i, 1);
      // per-product "touched" flags follow their slot letters; simplest honest reset is to drop them
      Object.keys(touched).forEach(function (k) { if (k.indexOf('.') > 0) delete touched[k]; });
      interacted = true;
      render();
      SC.toast(name + ' removed from the calculation.');
      addSel.focus();
    } else if (t.hasAttribute('data-open-assume')) {
      var det = d.getElementById('tl-' + LETTERS[Number(t.getAttribute('data-open-assume'))] + '-assume');
      if (det) { e.preventDefault(); det.open = true; det.scrollIntoView({ block: 'center' }); var sum = $('summary', det); if (sum) sum.focus({ preventScroll: true }); }
    } else if (t.hasAttribute('data-start-empty') || t.hasAttribute('data-cost-reset')) {
      S = fresh(); data = null; touched = {}; startedFromShortlist = 0; loadSeq++;
      render();
      catSel.focus();
    } else if (t.hasAttribute('data-cost-csv')) {
      if (!data || !S.slots.length) return;
      var res = results();
      var csv = comparisonCsv(S.slots.map(function (slot, i) { return { product: product(slot), offer: offerOf(slot), input: inputFor(slot), result: res[i], category: data.name }; }));
      var a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })), download: 'system-compare-cost-assumptions.csv' });
      d.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      SC.toast('Assumptions CSV downloaded.');
    }
  });

  // the compact totals bar is visible only while it is stuck under the header
  if ('IntersectionObserver' in root && barBox) {
    var sentinel = $('[data-cost-bar-sentinel]', app);
    if (sentinel) new IntersectionObserver(function (en) { barBox.classList.toggle('is-stuck', !en[0].isIntersecting && en[0].boundingClientRect.top < 80); }, { rootMargin: '-72px 0px 0px 0px' }).observe(sentinel);
  }

  // ------------------------------------------------------------------ start: URL → saved shortlist → empty
  readUrl();
  var list = SC.shortlist.get();
  if (!S.slots.length && list.ids.length && list.category && (!S.scope || S.scope === list.category)) {
    S.scope = list.category;
    S.slots = list.ids.slice(0, MAX).map(function (id) {
      var slot = newSlot(id), plan = list.plans && list.plans[id];
      if (typeof plan === 'string' && SLUG.test(plan)) slot.offer = plan; // a plan saved with the product; unknown ids fall back to the default offer
      return slot;
    });
    startedFromShortlist = list.ids.length;
  } else if (S.slots.length && list.ids.length > MAX && list.category === S.scope && S.slots.every(function (slot, i) { return slot.id === list.ids[i]; })) {
    // the shortlist's "Compare costs" link carries its first three of four products: say that the fourth is left out
    startedFromShortlist = list.ids.length;
  }
  app.setAttribute('data-ready', '');
  // a scenario from the link or the saved shortlist is drawn once its data has loaded: tools.css keeps what would move
  // unseen until then (render() sets "ready")
  app.setAttribute('data-state', S.scope || S.slots.length ? 'loading' : 'ready');
  if (!S.scope && S.slots.length) {
    // a deep link with products but no category: use the first product's main category
    SC.load('vendors').then(function (v) { var hit = v.vendors[S.slots[0].id]; S.scope = hit && hit[3] ? hit[3] : ''; if (!S.scope) S.slots = []; loadCategory(); }).catch(function () { S.slots = []; render(); });
  } else loadCategory();
})(typeof window !== 'undefined' ? window : null);
