/* System Compare — site search engine.
 *
 * One engine for the search palette and the /search/ page (and for the build, which uses the same
 * tokenizer to pre-compute the index — see src/gen/search-index.mjs).
 *
 * What it understands:
 *   "crm"                        → category + its best-documented products
 *   "hubspot vs salesforce"      → the published head-to-head, or a live comparison
 *   "quickbooks alternatives"    → the alternatives page
 *   "free email marketing"       → category, products filtered to a free entry price
 *   "payroll under $50"          → products with a public starting price ≤ $50
 *   "cheap crm" / "best crm"     → sort by price / by score
 *   "hubspt", "mailchmp"         → typo tolerance (product and category names only)
 *   "helpdesk", "newsletter"     → synonyms → category
 *
 * Everything runs in the browser: search terms are never sent anywhere.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.SC = root.SC || {}).searchEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STOP = toSet('a an the of in on to with and or for from by at is are be my our your that this it i we need want looking find get me can do does what which who how vs versus');
  var GENERIC = toSet('software tool tools app apps platform platforms system systems solution solutions program programs service services product products provider providers vendor vendors company companies business small online us usa');
  // field weights: name, alias, category, feature, integration, best-for, description, AI capability, heading
  var W = { n: 10, a: 9, c: 5, f: 3, i: 3, b: 2.5, d: 2, ai: 2, h: 1.5 };

  function toSet(s) {
    var o = Object.create(null);
    s.split(' ').forEach(function (w) { o[w] = 1; });
    return o;
  }
  var MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  function fold(s) {
    return String(s == null ? '' : s).normalize('NFKD').replace(MARKS, '');
  }
  /** Split text into lower-case words; "QuickBooks" also yields "quick" + "books", "monday.com" yields "mondaycom". */
  function words(s) {
    var raw = fold(s);
    var split = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    var out = Object.create(null);
    var list = [];
    [raw.toLowerCase(), split.toLowerCase()].forEach(function (src) {
      src.replace(/&/g, ' and ').replace(/[^a-z0-9.\-+']+/g, ' ').split(' ').forEach(function (w) {
        if (!w) return;
        var parts = w.split(/[.\-+']+/).filter(Boolean);
        parts.forEach(function (p) { if (!out[p]) { out[p] = 1; list.push(p); } });
        if (parts.length > 1) { var j = parts.join(''); if (!out[j]) { out[j] = 1; list.push(j); } }
      });
    });
    return list;
  }
  /** Light stemmer: plurals and common suffixes only (crms → crm, invoicing → invoic, payments → pay). */
  function stem(w) {
    if (w.length <= 3) return w;
    var x = w.replace(/ies$/, 'y').replace(/ment$/, '');
    var y = x.replace(/(ing|ers|er|ed|es|s)$/, '');
    if (y.length >= 3 && !/ss$/.test(x)) x = y;
    if (x.length > 3) x = x.replace(/e$/, '');
    return x;
  }
  function toks(s) {
    return words(s).filter(function (w) { return !STOP[w]; }).map(stem);
  }
  function key(s) { return toks(s).join(' '); }

  /** Damerau-Levenshtein with an early exit. */
  function dl(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return 99;
    var m = a.length, n = b.length, p2 = null, p1 = [], i, j, c;
    for (j = 0; j <= n; j++) p1[j] = j;
    for (i = 1; i <= m; i++) {
      c = [i];
      for (j = 1; j <= n; j++) {
        c[j] = Math.min(p1[j] + 1, c[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) c[j] = Math.min(c[j], p2[j - 2] + 1);
      }
      p2 = p1; p1 = c;
    }
    return p1[n];
  }

  /**
   * index = {
   *   cats: { id: [name, mode, count] },
   *   phrase: { "stem stem": [categoryId…] },
   *   docs: [ { t: type, id, n: name, u: url, s: sub-line, c: [categoryIds], f: { n,a,c,f,i,b,d,ai,h: "tok tok" },
   *             al: [normalised alias strings], sc: bestScore|null, am: amount|null, pu: price text, fr: 1 if free,
   *             ai: level, pf: 1 if full profile, lg: logo path, pr: [idA, idB] for comparisons } ]
   * }
   */
  function create(index) {
    var docs = index.docs.map(function (d) {
      var f = {};
      Object.keys(d.f || {}).forEach(function (k) { f[k] = toSet(d.f[k]); });
      return {
        type: d.t, id: d.id, name: d.n, url: d.u, sub: d.s || '', cats: d.c || [], f: f,
        al: d.al || [], nameNorm: words(d.n).join(' '), nameKey: key(d.n),
        best: d.sc == null ? null : d.sc, amount: d.am == null ? null : d.am, priceText: d.pu || '', free: !!d.fr,
        ai: d.ai || null, profile: !!d.pf, logo: d.lg || '', dark: !!d.dk, pair: d.pr || null, mode: d.m || null, count: d.k || 0, cs: d.cs || null,
      };
    });
    var cats = index.cats;
    var phrase = index.phrase;

    // fuzzy vocabulary: tokens of names and aliases only (never free prose), 4+ letters
    var vocab = Object.create(null);
    docs.forEach(function (x) {
      ['n', 'a'].forEach(function (k) {
        for (var t in x.f[k] || {}) if (t.length >= 4) vocab[t] = 1;
      });
    });
    var vocabList = Object.keys(vocab);
    var fuzzyCache = Object.create(null);
    function fuzzy(t) {
      if (t.length < 4) return [];
      if (fuzzyCache[t]) return fuzzyCache[t];
      var max = t.length >= 8 ? 2 : 1, out = [];
      for (var i = 0; i < vocabList.length; i++) {
        var w = vocabList[i];
        if (w[0] !== t[0]) continue;
        var k = dl(t, w, max);
        if (k <= max && k > 0) out.push([w, k]);
      }
      out.sort(function (a, b) { return a[1] - b[1]; });
      return (fuzzyCache[t] = out.slice(0, 3));
    }

    function resolveProduct(text) {
      var q = words(text).join(' ');
      if (!q) return null;
      var qt = toks(text), best = null;
      docs.forEach(function (x) {
        if (x.type !== 'product') return;
        var s = 0, al = [x.nameNorm].concat(x.al);
        if (al.indexOf(q) >= 0) s = 100;
        else if (al.some(function (a) { return a.indexOf(q + ' ') === 0 || a.indexOf(q) === 0; })) s = 70;
        else if (qt.length && qt.every(function (t) { return x.f.n[t] || (x.f.a && x.f.a[t]); })) s = 60;
        else if (qt.length && qt.every(function (t) { return x.f.n[t] || fuzzy(t).some(function (p) { return x.f.n[p[0]] || (x.f.a && x.f.a[p[0]]); }); })) s = 40;
        if (s) {
          s += (x.profile ? 5 : 0) + (x.best || 0) / 100;
          if (!best || s > best.s) best = { s: s, x: x };
        }
      });
      return best ? best.x : null;
    }

    /**
     * The one product a query names ("hubspot", "zoom", "square"), or null when the words are not a product
     * name or alias, are only a partial name shared with a category query ("chat"), or are part of the
     * name of several products ("zoho" → Zoho Books, Zoho CRM …; "google").
     */
    function namedProduct(text, strongCat) {
      var qq = words(text).join(' '), qt = toks(text), hits = [];
      if (!qq || !qt.length) return null;
      docs.forEach(function (x) {
        if (x.type !== 'product') return;
        var al = [x.nameNorm].concat(x.al), s = 0;
        if (al.indexOf(qq) >= 0) s = 100;
        else if (al.some(function (a) { return a.indexOf(qq) === 0; })) s = 70;
        else if (qt.every(function (t) { return x.f.n[t] || (x.f.a && x.f.a[t]); })) s = 60;
        if (s) hits.push({ x: x, s: s, inName: qt.every(function (t) { return x.f.n[t]; }) });
      });
      if (!hits.length) return null;
      hits.sort(function (a, b) { return b.s - a.s || (b.x.profile ? 1 : 0) - (a.x.profile ? 1 : 0) || (b.x.best || 0) - (a.x.best || 0); });
      var top = hits[0];
      if (top.s < 100 && (strongCat || (hits[1] && hits[1].s >= top.s))) return null;
      if (hits.some(function (h) { return h !== top && h.inName; })) return null;
      return top.x;
    }
    /** Is token t (or a word starting with it) in this token set? */
    function hasTok(set, t) {
      if (!set) return false;
      if (set[t]) return true;
      if (t.length < 3) return false;
      for (var u in set) if (u.indexOf(t) === 0) return true;
      return false;
    }
    var NOT_INTEGRATION = ['n', 'a', 'c', 'f', 'b', 'ai', 'h'];
    /** The words of a product name that the query typed ("hubspot" in "HubSpot Sales Hub" → "HubSpot"). */
    function brandOf(x, terms) {
      var hit = String(x.name).split(/\s+/).filter(function (w) {
        var k = toks(w);
        return k.length && k.some(function (t) { return terms.some(function (q) { return t === q || t.indexOf(q) === 0; }); });
      });
      return hit.length ? hit.join(' ') : x.name;
    }
    // display spelling of a lower-case word as it appears in product and category names ("crm" → "CRM")
    var spelling = Object.create(null);
    docs.forEach(function (x) {
      if (x.type !== 'product' && x.type !== 'category') return;
      String(x.name).split(/[^A-Za-z0-9.+]+/).forEach(function (w) { var k = w.toLowerCase(); if (k && !spelling[k]) spelling[k] = w; });
    });
    function spell(w) { return spelling[w] || (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)); }
    function alternativesRow(f) {
      return { type: 'alternatives', id: f.id, name: f.name + ' alternatives', url: f.profile ? '/alternatives/' + f.id + '/' : '/categories/' + f.cats[0] + '/', sub: 'Researched alternatives to ' + f.name + (cats[f.cats[0]] ? ' in ' + cats[f.cats[0]][0] : ''), why: 'Alternatives' };
    }
    /** A published head-to-head exists, or both have a profile in one scored category (a live comparison). */
    function pairable(a, b) {
      return docs.some(function (x) { return x.type === 'comparison' && x.pair && x.pair.indexOf(a.id) >= 0 && x.pair.indexOf(b.id) >= 0; }) ||
        (a.profile && b.profile && a.cats.some(function (id) { return b.cats.indexOf(id) >= 0 && cats[id] && cats[id][1] === 's'; }));
    }
    /** The published head-to-heads that include product f, against the best-documented products first. */
    function comparisonsOf(f) {
      var other = function (c) { var id = c.pair[0] === f.id ? c.pair[1] : c.pair[0], o = byId('product', id); return o && o.best != null ? o.best : -1; };
      return docs.filter(function (x) { return x.type === 'comparison' && x.pair && x.pair.indexOf(f.id) >= 0; })
        .sort(function (a, b) { return other(b) - other(a) || a.name.localeCompare(b.name); });
    }

    function parse(raw) {
      var q = { raw: raw, filters: {}, sort: null, intent: null, boost: {}, integration: null, suffix: null };
      var s = ' ' + fold(raw).toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
      var m, a, b;
      if ((m = s.match(/^(.+?)\s+(?:vs\.?|versus|v\.?|compared (?:to|with)|against)\s+(.+)$/))) {
        a = resolveProduct(m[1]); b = resolveProduct(m[2]);
        // one or two letters after "vs" are the start of a name ("pipedrive vs s"): unless they already point
        // at a product that can be compared with the first one, list the first product's comparisons instead
        if (a && m[2].trim().length < 3 && !(b && b !== a && pairable(a, b))) { q.vsOf = a; q.vsNext = m[2].trim(); s = ' ' + m[1] + ' '; }
        else if (a && b && a !== b) q.intent = { kind: 'vs', a: a, b: b };
      }
      if (!q.intent && ((m = s.match(/^\s*(.+?)\s+(?:alternatives?|competitors?|replacements?|substitutes?)\s*$/)) ||
          (m = s.match(/^\s*(?:alternatives?|competitors?) (?:to|for|of)\s+(.+?)\s*$/)) ||
          (m = s.match(/^\s*(?:similar to|like|instead of|replace|switch from)\s+(.+?)\s*$/)))) {
        a = resolveProduct(m[1]);
        if (a) q.intent = { kind: 'alternatives', a: a };
      }
      // "pipedrive v" / "hubspot vs" while the second name is still being typed: a comparison is coming,
      // so list that product's comparisons (and match on the name alone).
      if (!q.intent && !q.vsOf && (m = s.match(/^\s*(.+?)\s+(?:vs?\.?|versus|compared(?: to| with)?|against)\s*$/))) {
        a = resolveProduct(m[1]);
        if (a) { q.vsOf = a; s = ' ' + m[1] + ' '; }
      }
      if ((m = s.match(/(?:under|below|less than|up to|max(?:imum)?|<)\s*\$?\s*(\d+(?:\.\d+)?)|\$\s*(\d+(?:\.\d+)?)\s*(?:or less|max)/))) {
        q.filters.maxPrice = Number(m[1] || m[2]); s = s.replace(m[0], ' ');
      }
      if (/\b(free|freemium|no cost|\$0)\b/.test(s)) { q.filters.free = true; s = s.replace(/\b(free|freemium|no cost)\b|\$0/g, ' '); }
      if (/\b(cheap|cheapest|affordable|low[- ]cost|budget|inexpensive|lowest price)\b/.test(s)) {
        q.sort = 'price'; q.filters.hasPrice = true; s = s.replace(/\b(cheap|cheapest|affordable|low[- ]cost|budget|inexpensive|lowest price)\b/g, ' ');
      }
      if (/\b(best|top|leading|recommended|highest rated|top rated|#1)\b/.test(s)) {
        q.sort = q.sort || 'score'; s = s.replace(/\b(best|top|leading|recommended|highest rated|top rated)\b/g, ' ');
      }
      if ((m = s.match(/\b(?:integrat\w*|works|connects?|sync\w*) with\s+([a-z0-9 .]+?)\s*$/)) || (m = s.match(/^\s*([a-z0-9 .]+?)\s+(?:integrations?|connectors?|plugins?)\s*$/))) q.integration = m[1].trim();
      if (/\b(how to|guide|checklist|choose|buying|migrate|migration)\b/.test(s)) q.boost.guide = 3;
      if (/\b(pricing|price|cost|plans?)\s*$/.test(s)) { q.suffix = 'pricing'; s = s.replace(/\b(pricing|price|cost|plans?)\s*$/, ' '); }
      if (/\b(reviews?|rating|score)\s*$/.test(s)) { q.suffix = 'score'; s = s.replace(/\b(reviews?|rating|score)\s*$/, ' '); }
      var all = words(s).filter(function (w) { return !STOP[w]; });
      q.soft = all.filter(function (w) { return GENERIC[w]; }).map(stem);
      q.terms = all.filter(function (w) { return !GENERIC[w]; }).map(stem);
      q.termWords = all.filter(function (w) { return !GENERIC[w]; }); // unstemmed, for labels ("Works with HubSpot")
      if (!q.terms.length && q.soft.length && !q.filters.free && q.filters.maxPrice == null && !q.sort) { q.terms = q.soft; q.soft = []; }
      // phrase → category (longest n-gram first)
      q.cats = Object.create(null); q.catOrder = [];
      var seq = all.map(stem), n, i, k;
      for (n = Math.min(4, seq.length); n >= 1; n--) {
        for (i = 0; i + n <= seq.length; i++) {
          k = seq.slice(i, i + n).join(' ');
          if (phrase[k]) phrase[k].forEach(function (id) {
            if (q.cats[id] == null) { q.cats[id] = n / Math.max(1, q.terms.length); q.catOrder.push(id); }
          });
        }
      }
      q.catOrder.sort(function (x, y) { return q.cats[y] - q.cats[x]; });
      return q;
    }

    function byId(type, id) {
      for (var i = 0; i < docs.length; i++) if (docs[i].type === type && docs[i].id === id) return docs[i];
      return null;
    }

    function query(raw) {
      raw = String(raw || '').slice(0, 120);
      var q = parse(raw), res = [], top = [];
      if (q.intent && q.intent.kind === 'vs') {
        var a = q.intent.a, b = q.intent.b, published = null;
        docs.forEach(function (x) { if (!published && x.type === 'comparison' && x.pair && x.pair.indexOf(a.id) >= 0 && x.pair.indexOf(b.id) >= 0) published = x; });
        if (published) top.push(ext(published, { why: 'Head-to-head comparison' }));
        else {
          var shared = a.cats.filter(function (id) { return b.cats.indexOf(id) >= 0 && cats[id] && cats[id][1] === 's' && a.profile && b.profile; });
          if (shared.length) top.push({ type: 'compare', name: a.name + ' vs ' + b.name, url: '/compare/?scope=' + shared[0] + '&a=' + a.id + '&b=' + b.id, sub: 'Side-by-side comparison in ' + cats[shared[0]][0], why: 'Live comparison' });
          else top.push({ type: 'notice', name: a.name + ' and ' + b.name + ' are researched in different categories', url: a.url, sub: 'Open each profile to compare them yourself' });
        }
        top.push(ext(a), ext(b));
      }
      if (q.intent && q.intent.kind === 'alternatives') {
        var f = q.intent.a;
        top.push(alternativesRow(f), ext(f));
      }
      var catHits = q.catOrder;
      var req = q.terms;
      function passes(x) {
        if (x.type !== 'product') return true;
        if (q.filters.free && !x.free) return false;
        if (q.filters.maxPrice != null && !(x.amount != null && x.amount <= q.filters.maxPrice)) return false;
        if (q.filters.hasPrice && x.amount == null) return false;
        return true;
      }
      var qn = req.join(' ');
      var strongCat = catHits.length && q.cats[catHits[0]] >= 1 ? catHits[0] : null;
      // The whole query names one product ("hubspot", "pipedrive v"): it, its published comparisons and its
      // alternatives page lead the results.
      var plain = !q.intent && !q.suffix && !q.sort && !q.integration && q.filters.maxPrice == null && !q.filters.free && req.length > 0;
      var focus = q.vsOf || (plain ? namedProduct(q.termWords.join(' '), strongCat) : null);
      // Products that match only because they list the named product or service as an integration go into
      // their own small group ("Works with HubSpot"), unless the query is a category's own name ("crm").
      var topCatDoc = strongCat ? byId('category', strongCat) : null;
      var viaOk = !q.integration && req.length > 0 && !(topCatDoc && req.every(function (t) { return hasTok(topCatDoc.f.n, t); }));
      docs.forEach(function (x) {
        var s = 0, matched = 0, kinds = {}, t, best, kind, fk, set, w, u, i, fz;
        for (var ti = 0; ti < req.length; ti++) {
          t = req[ti]; best = 0; kind = '';
          for (fk in x.f) {
            set = x.f[fk]; w = W[fk] || 1;
            if (set[t]) { if (w > best) { best = w; kind = 'exact'; } }
            else if (t.length >= 3 && w * 0.8 > best) { for (u in set) { if (u.indexOf(t) === 0) { best = w * 0.8; kind = 'prefix'; break; } } }
          }
          if (!best && x.type !== 'category') { for (i = 0; i < catHits.length; i++) if (x.cats.indexOf(catHits[i]) >= 0) { best = W.c * 0.7; kind = 'synonym'; break; } }
          if (!best && x.type === 'category' && q.cats[x.id] != null) { best = W.a * 0.9; kind = 'synonym'; }
          if (!best) { fz = fuzzy(t); for (i = 0; i < fz.length; i++) if (x.f.n[fz[i][0]] || (x.f.a && x.f.a[fz[i][0]])) { best = W.n * (fz[i][1] === 1 ? 0.5 : 0.35); kind = 'fuzzy'; break; } }
          if (best) { s += best; matched++; kinds[kind] = 1; }
        }
        if (req.length && matched < req.length) {
          var catOnly = x.type === 'category' && q.cats[x.id] != null;
          var prodInTopCat = x.type === 'product' && catHits.length && q.cats[catHits[0]] >= 1 && x.cats.indexOf(catHits[0]) >= 0;
          if (!catOnly && !prodInTopCat) return;
          if (x.type === 'product') { s = W.c * 0.7 * req.length; kinds.synonym = 1; }
        }
        if (!req.length) {
          if (x.type !== 'product' || (!q.filters.free && q.filters.maxPrice == null && !q.sort)) return;
          s = 1;
        }
        if (!passes(x)) return;
        if (x.type === 'category' && q.cats[x.id] != null) s += 40 * q.cats[x.id] + (x.mode === 's' ? 4 : 0);
        if (qn && x.nameKey === qn) s += 100; else if (qn && x.nameKey.indexOf(qn) === 0) s += 30;
        q.soft.forEach(function (sf) { for (var k2 in x.f) if (x.f[k2][sf]) { s += 0.5; break; } });
        if (x.type === 'product') s += ((x.best || 0) / 100) * 3 + (x.profile ? 1.5 : 0);
        // The whole query names a category ("crm", "help desk"): list that category's products in
        // published order rather than favouring products that happen to carry the word in their name.
        if (strongCat && x.type === 'product' && x.cats.indexOf(strongCat) >= 0 && x.nameKey !== qn) s = 60 + (x.cs && x.cs[strongCat] != null ? x.cs[strongCat] : 0) / 5 + (x.profile ? 1 : 0);
        if (x.type === 'guide') s += q.boost.guide || 0;
        if (q.integration && x.type === 'product' && x.f.i) { if (toks(q.integration).every(function (it) { return x.f.i[it]; })) s += 6; }
        var r = ext(x); r.score = s; r.kinds = Object.keys(kinds).join('+');
        if (viaOk && x.type === 'product' && x !== focus && matched === req.length && x.f.i &&
            !catHits.some(function (id) { return x.cats.indexOf(id) >= 0; }) &&
            req.every(function (t2) { return hasTok(x.f.i, t2) && !NOT_INTEGRATION.some(function (k) { return hasTok(x.f[k], t2); }); })) r.via = 1;
        res.push(r);
      });
      var bothProducts = function (x, y) { return x.type === 'product' && y.type === 'product'; };
      res.sort(q.sort === 'price'
        ? function (x, y) { return (bothProducts(x, y) ? (x.amount == null ? 1e9 : x.amount) - (y.amount == null ? 1e9 : y.amount) : 0) || y.score - x.score; }
        : (q.sort === 'score' && !strongCat) || !req.length
          ? function (x, y) { return (bothProducts(x, y) ? (y.best == null ? -1 : y.best) - (x.best == null ? -1 : x.best) : 0) || y.score - x.score || x.name.localeCompare(y.name); }
          : function (x, y) { return y.score - x.score || x.name.localeCompare(y.name); });
      var groups = {};
      res.forEach(function (r) { (groups[r.type] = groups[r.type] || []).push(r); });
      // keep only categories that are close to the best category match
      if (groups.category && groups.category.length > 1) {
        var topCat = groups.category[0].score;
        groups.category = groups.category.filter(function (c) { return c.score >= topCat * (strongCat ? 0.35 : 0.2); });
      }
      // "X pricing" / "X score" → send the first product hit to the right section of its profile
      if (q.suffix && groups.product && groups.product.length && groups.product[0].profile && !top.length) {
        var p0 = groups.product[0];
        top.push({ type: 'product', name: p0.name + (q.suffix === 'pricing' ? ' pricing' : ' score and evidence'), url: p0.url + (q.suffix === 'pricing' ? '#pricing' : '#capabilities'), sub: q.suffix === 'pricing' ? (p0.priceText || 'Pricing details and sources') : 'Documented-fit score and capability evidence', logo: p0.logo, dark: p0.dark, why: q.suffix === 'pricing' ? 'Pricing' : 'Score' });
      }
      // direct: the first "best match" answers the query ("X vs Y", "X alternatives", "X pricing"), so Enter opens it
      var direct = top.length > 0;
      if (focus && !top.length) {
        var mine = comparisonsOf(focus);
        if (q.vsNext) {
          // "pipedrive vs s": comparisons against a product whose name starts with those letters come first
          var nx = words(q.vsNext).join(' '), opp = function (c) { var o = byId('product', c.pair[0] === focus.id ? c.pair[1] : c.pair[0]); return !!o && words(o.name).some(function (w) { return w.indexOf(nx) === 0; }); };
          mine = mine.filter(opp).concat(mine.filter(function (c) { return !opp(c); }));
        }
        if (q.vsOf) {
          mine.slice(0, 6).forEach(function (c) { top.push(ext(c, { why: 'Head-to-head comparison' })); });
          var scope = focus.profile ? focus.cats.filter(function (id) { return cats[id] && cats[id][1] === 's'; })[0] : null;
          if (scope) top.push({ type: 'compare', id: 'compare:' + focus.id, name: 'Compare ' + focus.name + ' with another product', url: '/compare/?scope=' + scope + '&a=' + focus.id, sub: 'Choose from ' + cats[scope][2] + ' ' + cats[scope][0] + ' products', why: 'Compare tool' });
          if (!top.length) top.push(ext(focus));
        } else {
          top.push(ext(focus));
          mine.slice(0, 3).forEach(function (c) { top.push(ext(c, { why: 'Head-to-head comparison' })); });
          if (focus.profile) top.push(alternativesRow(focus));
        }
      }
      // a named product makes typo matches noise ("stripe" is not a misspelt "CrowdStrike")
      if (focus) Object.keys(groups).forEach(function (k) { groups[k] = groups[k].filter(function (r) { return r.kinds !== 'fuzzy'; }); });
      var via = null, viaItems = (groups.product || []).filter(function (r) { return r.via; });
      if (viaItems.length) {
        var vs = q.intent && q.intent.kind === 'vs' ? q.intent : null, first = function (x) { return String(x.name).split(/\s+/)[0]; };
        var named = focus ? brandOf(focus, req) : vs ? first(vs.a) + ' and ' + first(vs.b) : q.intent ? brandOf(q.intent.a, req) : q.termWords.map(spell).join(' ');
        via = { label: 'Works with ' + named, items: viaItems };
      }
      var seen = {}, total = 0;
      Object.keys(groups).reduce(function (all, k) { return all.concat(groups[k]); }, top.slice()).forEach(function (r) { var k = r.type + ':' + (r.id || r.url); if (!seen[k]) { seen[k] = 1; total++; } });
      return { q: q, top: top, direct: direct, groups: groups, via: via, total: total, catHits: catHits.map(function (id) { return byId('category', id); }).filter(Boolean).map(function (x) { return ext(x); }) };
    }

    function ext(x, extra) {
      var r = { type: x.type, id: x.id, name: x.name, url: x.url, sub: x.sub, cats: x.cats, best: x.best, amount: x.amount, priceText: x.priceText, free: x.free, ai: x.ai, profile: x.profile, logo: x.logo, dark: x.dark, mode: x.mode, count: x.count };
      if (extra) for (var k in extra) r[k] = extra[k];
      return r;
    }

    return { query: query, parse: parse, resolveProduct: resolveProduct, docs: docs, cats: cats, size: docs.length };
  }

  return { create: create, words: words, toks: toks, stem: stem, key: key, fold: fold };
});
