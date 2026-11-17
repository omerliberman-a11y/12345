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
 *   "a vs b vs c", "compare a and b", "a or b", "a, b and c"
 *                                → the published head-to-head (two products) or the compare tool (2–4);
 *                                  suppliers of one documentary category: its criteria table; a name several
 *                                  products share ("quickbooks vs zoho") is the one that can be compared
 *   "attio vs", "attio or", "compare attio"
 *                                → the compare tool with that product chosen (a documentary supplier: the
 *                                  criteria comparison on its category page), then its head-to-heads
 *   "crm pricing", "crm alternatives", "best crm", "crm score", "crm vs"
 *                                → a category's own words and nothing else lead with that category: its costs
 *                                  section (a documentary category: its plans and prices), its ranking, its
 *                                  compare tool and head-to-heads — never one product's page
 *   "zoho pricing", "zoho vs", "microsoft alternatives"
 *                                → words that start several products' names: that row for each of them (suggestions);
 *                                  "deque pricing": a documented supplier's plans and prices on its category page
 *   "how we score", "corrections", "how do you make money"
 *                                → the site's own page or FAQ answer as the best match
 *
 * The index comes in two parts (src/gen/search-index.mjs): names, aliases and categories first, so the first
 * results show quickly; descriptions, features and integrations second (extend()), which refines them.
 * Everything runs in the browser: search terms are never sent anywhere.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.SC = root.SC || {}).searchEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STOP = toSet('a an the of in on to with and or for from by at is are be my our your you that this it i we need want looking find get me can do does what which who how why often much vs versus');
  var GENERIC = toSet('software tool tools app apps platform platforms system systems solution solutions program programs service services product products provider providers vendor vendors company companies business small online us usa');
  // field weights: name, alias, the site's own question words (pages and FAQ answers; not used for typo
  // matching), category, feature, integration, best-for, description, AI capability, heading
  var W = { n: 10, a: 9, q: 9, c: 5, f: 3, i: 3, b: 2.5, d: 2, ai: 2, h: 1.5 };
  // the previous site's limits: a query is read up to 120 characters and 20 words (the interfaces say so)
  var MAX_CHARS = 120, MAX_WORDS = 20;
  function capped(raw) {
    return String(raw == null ? '' : raw).slice(0, MAX_CHARS).split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(' ');
  }
  /** The address of an index entry from its type and id (the index stores an address only where it differs). */
  function urlOf(t, id, c, pf) {
    var c0 = c && c[0];
    if (t === 'category') return '/categories/' + id + '/';
    if (t === 'product') return pf ? '/software/' + id + '/' : c0 ? '/categories/' + c0 + '/#supplier-' + id : '';
    if (t === 'comparison') return '/vs/' + id + '/';
    if (t === 'guide') return '/guides/' + id + '/';
    if (t === 'page') return id;
    if (t === 'faq') return c0 ? '/categories/' + c0 + '/#faq' : '/faq/#' + String(id).replace(/^faq-/, '');
    return '';
  }

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
   *   own: { "words as typed": categoryId } — for a phrase shared by several categories, the one whose own name
   *        or synonym it is ("help desk" → customer-service), so that typing it exactly can open that category
   *   key: fingerprint of the docs list (the second part of the index applies only to the same list),
   *   docs: [ { t: type, id, n: name, u: url (only when urlOf() would differ), s: sub-line, c: [categoryIds],
   *             f: { n,a,c,f,i,b,d,ai,h: "tok tok" }, al: [normalised alias strings], sc: bestScore|null,
   *             am: amount|null, pu: price text, fr: 1 if free, ai: level, pf: 1 if full profile, lg: logo path,
   *             pr: [idA, idB] for comparisons } ]
   * }
   * part 2 (extend) = { key, x: [ { d, f, i, b, ai, h: "tok tok" } | 0 — one entry per doc, in the same order ] }
   */
  function create(index) {
    var docs = index.docs.map(function (d) {
      var f = {};
      Object.keys(d.f || {}).forEach(function (k) { f[k] = toSet(d.f[k]); });
      return {
        type: d.t, id: d.id, name: d.n, url: d.u || urlOf(d.t, d.id, d.c, d.pf), sub: d.s || '', cats: d.c || [], f: f,
        al: d.al || [], aq: d.aq || null, nameNorm: words(d.n).join(' '), nameKey: key(d.n),
        best: d.sc == null ? null : d.sc, amount: d.am == null ? null : d.am, priceText: d.pu || '', free: !!d.fr,
        ai: d.ai || null, profile: !!d.pf, logo: d.lg || '', dark: !!d.dk, wide: !!d.wd, pair: d.pr || null, mode: d.m || null, count: d.k || 0, cs: d.cs || null,
      };
    });
    var cats = index.cats;
    var phrase = index.phrase;
    var own = index.own || {};
    var api = { full: !index.key }; // an index without a key is complete (one file, as the build uses it)
    /** Adds the second part of the index (descriptions, features, integrations). False when it does not belong. */
    function extend(more) {
      if (api.full || !more || more.key !== index.key || !more.x || more.x.length !== docs.length) return false;
      more.x.forEach(function (f, i) { if (f) for (var k in f) docs[i].f[k] = toSet(f[k]); });
      api.full = true;
      intStats = null; // brandLike() counts the descriptions and integrations that have just arrived
      return true;
    }

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

    /** Every product these words can mean, in index order: { x, t: 100 its name or alias, 70 their start, 60 all its
     *  words, 40 the same with typos; s: t + 5 for a profile + its best score / 100 }. */
    function resolveAll(text) {
      var q = words(text).join(' '), out = [];
      if (!q) return out;
      var qt = toks(text);
      docs.forEach(function (x) {
        if (x.type !== 'product') return;
        var s = 0, al = [x.nameNorm].concat(x.al);
        if (al.indexOf(q) >= 0) s = 100;
        else if (al.some(function (a) { return a.indexOf(q + ' ') === 0 || a.indexOf(q) === 0; })) s = 70;
        else if (qt.length && qt.every(function (t) { return x.f.n[t] || (x.f.a && x.f.a[t]); })) s = 60;
        else if (qt.length && qt.every(function (t) { return x.f.n[t] || fuzzy(t).some(function (p) { return x.f.n[p[0]] || (x.f.a && x.f.a[p[0]]); }); })) s = 40;
        if (s) out.push({ x: x, t: s, s: s + (x.profile ? 5 : 0) + (x.best || 0) / 100 });
      });
      return out;
    }
    function resolveProduct(text) {
      var best = null;
      resolveAll(text).forEach(function (c) { if (!best || c.s > best.s) best = c; });
      return best ? best.x : null;
    }
    /**
     * "quickbooks vs zoho", "microsoft vs zendesk": the two names resolve to products that cannot be compared (Zoho
     * CRM is no accounting product). The strongest pair of what the names can also mean that can be (Zoho Books;
     * Microsoft Copilot Studio), or null. Only as strong a match as the names allow (a name's start or all its words;
     * typos only where nothing better matches).
     */
    function comparablePair(ta, tb) {
      var pick = function (text) {
        var l = resolveAll(text), top = l.reduce(function (m, c) { return Math.max(m, c.t); }, 0);
        return l.filter(function (c) { return c.t >= Math.min(60, top); }).sort(function (a, b) { return b.s - a.s; }).slice(0, 24);
      };
      var A = pick(ta), B = pick(tb), best = null;
      A.forEach(function (ca) {
        B.forEach(function (cb) {
          var lv = ca.x === cb.x ? 0 : pairLevel(ca.x, cb.x);
          if (lv && (!best || lv > best.lv || (lv === best.lv && ca.s + cb.s > best.s))) best = { lv: lv, s: ca.s + cb.s, a: ca.x, b: cb.x };
        });
      });
      return best;
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
    // every product's name in plain lower-case words ("quickbooks online", never the "quick books" of its capitals)
    var plainNames = docs.map(function (x) { return x.type === 'product' ? words(String(x.name).toLowerCase()).join(' ') : ''; });
    /**
     * Words that start the names of two or more products, as whole words ("zoho": Zoho Books, Zoho CRM …; "microsoft
     * power": Power BI and Power Automate; "fathom": Fathom and Fathom Analytics): those products, the one these words
     * name most exactly and the best-documented first; else null. A word that starts one name only, or only aliases
     * ("power" of "Power BI" and "Power Automate"), is no such word.
     */
    var sharedMemo = Object.create(null), namedMemo = Object.create(null); // both depend on the names only
    function sharedBy(text) {
      var run = words(String(text).toLowerCase()).join(' '), list = [], rank = Object.create(null);
      if (!run) return null;
      if (run in sharedMemo) return sharedMemo[run] && sharedMemo[run].slice();
      docs.forEach(function (x, i) { var n = plainNames[i]; if (n && (n === run || n.indexOf(run + ' ') === 0)) list.push(x); });
      if (list.length < 2) return (sharedMemo[run] = null);
      resolveAll(text).forEach(function (c) { rank[c.x.id] = c.s; });
      sharedMemo[run] = list.sort(function (a, b) { return (rank[b.id] || 0) - (rank[a.id] || 0); });
      return sharedMemo[run].slice();
    }
    /**
     * Do these words, as typed, name a product: its whole name or alias, words that start several products' names
     * ("zoho", "google"), or the start of one name or alias that a search for the words alone opens ("monday")?
     * { one: product } or { many: [products] }, else null — generic words ("sales" of "Sales Cloud", "cloud", "quick",
     * "open") name none.
     */
    function namedBy(ws) {
      var run = ws.join(' '), many, one = null;
      if (run in namedMemo) return namedMemo[run];
      if ((many = run ? sharedBy(run) : null)) return (namedMemo[run] = { many: many });
      docs.forEach(function (x, i) {
        if (one || !run || x.type !== 'product') return;
        var all = [plainNames[i]].concat(x.al);
        // a name typed apart counts as typed whole ("quick books": QuickBooks)
        if (all.indexOf(run) >= 0 || (ws.length > 1 && all.indexOf(ws.join('')) >= 0) || (all.some(function (n) { return n.indexOf(run + ' ') === 0; }) && namedProduct(run) === x)) one = x;
      });
      return (namedMemo[run] = one ? { one: one } : null);
    }
    /** Is the text exactly this product's name or one of its aliases ("hubspot", not "contact" for Constant Contact)? */
    function isExactName(x, text) {
      var q = words(text).join(' ');
      return !!q && (x.nameNorm === q || x.al.indexOf(q) >= 0);
    }
    /** Do these words name a product or contain a category phrase ("attio", "crm", "email marketing",
     *  "hubspot vs salesforce")? */
    function namesSomething(text) {
      var ws = words(text).filter(function (w) { return !STOP[w] && !GENERIC[w]; }), seq = ws.map(stem), n, i;
      if (!seq.length) return false;
      for (n = Math.min(4, seq.length); n >= 1; n--) for (i = 0; i + n <= seq.length; i++) if (phrase[seq.slice(i, i + n).join(' ')]) return true;
      return !!resolveProduct(text) || ws.some(function (w) { return !!strictProduct(w); });
    }
    /** The one product these words name exactly (name or alias) or uniquely; never a category's own words ("email"). */
    function strictProduct(text) {
      var q = words(text).join(' '), exact = [];
      if (!q) return null;
      docs.forEach(function (x) { if (x.type === 'product' && (x.nameNorm === q || x.al.indexOf(q) >= 0)) exact.push(x); });
      if (exact.length > 1) exact = exact.filter(function (x) { return x.profile; });
      if (exact.length) return exact.length === 1 ? exact[0] : null;
      var k = key(text);
      return k && q.length >= 4 ? namedProduct(text, !!phrase[k]) : null; // "fin" is no product's start
    }
    /**
     * These words are a category's name or synonym and nothing else but generic words ("crm", "email marketing
     * software", "ERP & Business Management", "help desk"), and no product's exact name or alias ("bill" is BILL):
     * { id, ids, sure }. sure: one category's own words ("crm"; "help desk" is Customer support's), not words several
     * categories share ("marketing": ids lists them).
     */
    function categoryOf(text) {
      var all = words(text).filter(function (w) { return !STOP[w]; }), seq = all.map(stem), n, i, ids = null, own1 = '';
      // the longest category phrase in the words (as parse() finds them); every word outside it is generic
      for (n = Math.min(4, seq.length); n >= 1 && !ids; n--) {
        for (i = 0; i + n <= seq.length && !ids; i++) {
          var k = seq.slice(i, i + n).join(' '), a0 = i, a1 = i + n;
          if (phrase[k] && all.every(function (w, j) { return (j >= a0 && j < a1) || GENERIC[w]; })) { ids = phrase[k]; own1 = all.slice(a0, a1).join(' '); }
        }
      }
      if (!ids || !ids.length) return null;
      var typed = [words(text).join(' '), all.join(' '), own1, all.filter(function (w) { return !GENERIC[w]; }).join(' ')];
      if (docs.some(function (x) { return x.type === 'product' && typed.some(function (t) { return x.nameNorm === t || x.al.indexOf(t) >= 0; }); })) return null;
      var id = ids.length === 1 ? ids[0] : own[typed[0]] || own[typed[1]] || own[typed[2]] || null;
      // words that also start a product's name ("gemini": the Gemini app) lead with the category, as a suggestion
      var named = docs.some(function (x) { return x.type === 'product' && [x.nameNorm].concat(x.al).some(function (n) { return n.indexOf(typed[3] + ' ') === 0; }); });
      return { id: id || ids[0], ids: ids, sure: !!id && !named };
    }
    var SEP = /(\s*,\s*|\s+(?:vs\.?|versus|v\.?|or|and|&|\/|compared (?:to|with)|against)\s+)/;
    var SEP_AFTER_COMPARE = /(\s*,\s*|\s+(?:vs\.?|versus|v\.?|or|and|&|\/|with|to|compared (?:to|with)|against)\s+)/;
    /**
     * "a vs b vs c", "compare a and b", "a or b", "a, b and c" → two to four different products, or null. Around
     * "vs" a name may be typed loosely (as in "a vs b"); around "and", "or" and commas each part must name one
     * product exactly, so "email or sms" stays a search. A name that contains a separator ("Intercom and Fin")
     * is kept whole.
     */
    function productList(s) {
      var t = s.trim(), lead = /^compare\s+/.test(t);
      if (lead) t = t.replace(/^compare\s+/, '');
      var bits = t.split(lead ? SEP_AFTER_COMPARE : SEP), pieces = [], seps = [], loose = false, i;
      if (bits.length < 3 || bits.length > 15) return null;
      for (i = 0; i < bits.length; i++) {
        if (i % 2) { seps.push(bits[i]); if (/\b(?:vs|versus|v|compared|against)\b/.test(bits[i])) loose = true; }
        else if (!bits[i].trim()) return null;
        else pieces.push(bits[i]);
      }
      var memo = {};
      function named(a, b) {
        var k = a + ':' + b;
        if (!(k in memo)) {
          var text = pieces[a];
          for (var j = a + 1; j <= b; j++) text += seps[j - 1] + pieces[j];
          memo[k] = loose && text.trim().length >= 4 ? resolveProduct(text) : strictProduct(text);
        }
        return memo[k];
      }
      // the longest name first, so that a whole name is never split at its own "and"
      function from(a, used) {
        if (a === pieces.length) return [];
        for (var b = pieces.length - 1; b >= a; b--) {
          var p = named(a, b);
          if (!p || used.indexOf(p) >= 0) continue;
          var rest = from(b + 1, used.concat([p]));
          if (rest) return [p].concat(rest);
        }
        return null;
      }
      var list = from(0, []);
      return list && list.length >= 2 && list.length <= 4 ? list : null;
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
    // dictionary words that integrations here use the way they use names, so brandLike() cannot tell them from one (each
    // is only in integration names: "REST APIs", "Relational databases", "HubSpot Marketplace")
    var NOT_A_NAME = toSet(['rest', 'relational', 'marketplace'].map(stem).join(' '));
    var intStats = null;
    /** Is token t a brand that is no product here ("gmail", "slack", "outlook")? In the integrations of two or more
     *  products, as a word of its own (not the "talk" of "CloudTalk"), and in any other text (descriptions, features,
     *  best-for, headings) at most once for every five products that list it — generic words ("cloud", "sales",
     *  "calendar", "webhook") are everywhere. Needs the second part of the index. */
    function brandLike(t) {
      if (!api.full || t.length < 4 || NOT_A_NAME[t]) return false;
      if (!intStats) {
        intStats = Object.create(null);
        docs.forEach(function (x) {
          if (x.type !== 'product' || !x.f.i) return;
          for (var k in x.f.i) {
            var s = intStats[k] || (intStats[k] = { n: 0, frag: 0, prose: 0 });
            s.n++;
            for (var u in x.f.i) if (u !== k && u.indexOf(k) >= 0) { s.frag++; break; }
          }
        });
        docs.forEach(function (x) { ['d', 'f', 'b', 'ai', 'h', 'q'].forEach(function (k) { for (var t2 in x.f[k] || {}) if (intStats[t2]) intStats[t2].prose++; }); });
      }
      var st = intStats[t];
      return !!st && st.n >= 2 && !st.frag && st.prose * 5 <= st.n;
    }
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
    /** The published head-to-heads by pair ("idA|idB", both orders). */
    var pairs = Object.create(null);
    docs.forEach(function (x) { if (x.type === 'comparison' && x.pair && x.pair.length === 2) { pairs[x.pair[0] + '|' + x.pair[1]] = x; pairs[x.pair[1] + '|' + x.pair[0]] = x; } });
    /** How a and b can be compared here: 3 a published head-to-head, 2 both with a profile in one scored category (a
     *  live comparison), 1 both suppliers of one documentary category (its criteria table), 0 not at all. */
    function pairLevel(a, b) {
      if (pairs[a.id + '|' + b.id]) return 3;
      var shared = a.cats.filter(function (id) { return b.cats.indexOf(id) >= 0 && cats[id]; });
      if (a.profile && b.profile && shared.some(function (id) { return cats[id][1] === 's'; })) return 2;
      return shared.some(function (id) { return cats[id][1] === 'f'; }) ? 1 : 0;
    }
    function pairable(a, b) { return pairLevel(a, b) > 0; }
    /** The documentary category both (or all) are suppliers of, or null. */
    function sharedFactual(list) {
      return list[0].cats.filter(function (id) { return cats[id] && cats[id][1] === 'f' && list.every(function (x) { return x.cats.indexOf(id) >= 0; }); })[0] || null;
    }
    /** "Compare X with another product": the compare tool with X chosen, in X's first scored category; for a
     *  documentary supplier, the criteria comparison of the suppliers on its category page. */
    function compareWith(f) {
      var s = f.profile ? f.cats.filter(function (id) { return cats[id] && cats[id][1] === 's'; })[0] : null;
      if (s) return { type: 'compare', id: 'compare:' + f.id, name: 'Compare ' + f.name + ' with another product', url: '/compare/?scope=' + s + '&a=' + f.id, sub: 'Choose from ' + cats[s][2] + ' ' + cats[s][0] + ' products', why: 'Compare tool' };
      var c = f.cats.filter(function (id) { return cats[id] && cats[id][1] === 'f'; })[0];
      if (c) return { type: 'compare', id: 'compare:' + f.id, name: 'Compare ' + f.name + ' with the other suppliers', url: '/categories/' + c + '/#factual-comparison', sub: 'Criteria table · ' + cats[c][0], why: 'Criteria comparison' };
      return null;
    }
    /** The published head-to-heads that include product f, against the best-documented products first. */
    function comparisonsOf(f) {
      var other = function (c) { var id = c.pair[0] === f.id ? c.pair[1] : c.pair[0], o = byId('product', id); return o && o.best != null ? o.best : -1; };
      return docs.filter(function (x) { return x.type === 'comparison' && x.pair && x.pair.indexOf(f.id) >= 0; })
        .sort(function (a, b) { return other(b) - other(a) || a.name.localeCompare(b.name); });
    }
    /** What leads a query about category c on its own (parse() q.catq): its costs section ("crm pricing"; a
     *  documentary category: its plans and prices), its compare tool ("crm vs"), else its ranking ("crm
     *  alternatives", "best crm", "crm score"). */
    function categoryRow(kind, c) {
      var scored = c.mode !== 'f';
      if (kind === 'pricing') return { type: 'category', id: 'pricing:' + c.id, name: c.name + ' pricing', url: c.url + (scored ? '#costs' : '#plans'), sub: scored ? 'Starting prices · ' + c.count + ' products' : 'Plans and prices · ' + c.count + ' suppliers', why: 'Pricing' };
      if (kind !== 'vs') return ext(c, { why: 'Ranking' });
      return scored
        ? { type: 'compare', id: 'compare:' + c.id, name: 'Compare products in ' + c.name, url: '/compare/?scope=' + c.id, sub: 'Pick 2–4 of its ' + c.count + ' products', why: 'Compare tool' }
        : { type: 'compare', id: 'compare:' + c.id, name: 'Compare the ' + c.name + ' suppliers', url: c.url + '#factual-comparison', sub: 'Criteria table · ' + c.count + ' suppliers', why: 'Criteria comparison' };
    }
    /** "X pricing" / "X score" for product p: its profile's pricing section or score evidence; a documented supplier's
     *  plans and prices on its category page (#plans-<id>; it has no score: null). */
    function sectionRow(kind, p) {
      var pricing = kind === 'pricing', c = p.cats[0], doc = !p.profile;
      if (doc && (!pricing || !cats[c])) return null;
      return {
        type: 'product', of: p.id, name: p.name + (pricing ? ' pricing' : ' score and evidence'),
        url: doc ? '/categories/' + c + '/#plans-' + p.id : p.url + (pricing ? '#pricing' : '#capabilities'),
        sub: !pricing ? 'Documented-fit score and capability evidence' : doc ? 'Plans and prices · ' + cats[c][0] : p.priceText || 'Pricing details and sources',
        logo: p.logo, dark: p.dark, wide: p.wide, why: pricing ? 'Pricing' : 'Score',
      };
    }
    /** The published head-to-heads of category id, the best-documented pairs first. */
    function categoryComparisons(id) {
      var best = function (c) { return Math.max.apply(null, c.pair.map(function (p) { var o = byId('product', p); return o && o.best != null ? o.best : -1; })); };
      return docs.filter(function (x) { return x.type === 'comparison' && x.pair && x.cats[0] === id; })
        .sort(function (a, b) { return best(b) - best(a) || a.name.localeCompare(b.name); });
    }

    function parse(raw) {
      var q = { raw: raw, filters: {}, sort: null, intent: null, boost: {}, integration: null, suffix: null, rest: '', catq: null, shared: null };
      var s = ' ' + fold(raw).toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
      var m, a, b, cq, typedAll = words(s).join(' ');
      // the exact title of a published head-to-head ("Intercom and Fin vs Freshdesk") is that comparison
      docs.forEach(function (x) {
        if (q.intent || x.type !== 'comparison' || !x.pair || x.nameNorm !== typedAll) return;
        var pa = byId('product', x.pair[0]), pb = byId('product', x.pair[1]);
        if (pa && pb) q.intent = { kind: 'vs', a: pa, b: pb, cmp: x };
      });
      if (!q.intent && (m = s.match(/^(.+?)\s+(?:vs\.?|versus|v\.?|compared (?:to|with)|against)\s+(.+)$/))) {
        a = resolveProduct(m[1]); b = resolveProduct(m[2]);
        // one or two letters after "vs" are the start of a name ("pipedrive vs s"): unless they already point
        // at a product that can be compared with the first one, list the first product's comparisons instead
        if (a && m[2].trim().length < 3 && !(b && b !== a && pairable(a, b))) { q.vsOf = a; q.vsSure = strictProduct(m[1]) === a; q.vsNext = m[2].trim(); s = ' ' + m[1] + ' '; }
        else if (a && b && a !== b) {
          // a name several products share ("zoho", "microsoft") means the one that can be compared with the other
          var cp = pairable(a, b) ? null : comparablePair(m[1], m[2]);
          q.intent = cp ? { kind: 'vs', a: cp.a, b: cp.b } : { kind: 'vs', a: a, b: b };
        }
      }
      if (!q.intent && ((m = s.match(/^\s*(.+?)\s+(?:alternatives?|competitors?|replacements?|substitutes?)\s*$/)) ||
          (m = s.match(/^\s*(?:alternatives?|competitors?) (?:to|for|of)\s+(.+?)\s*$/)) ||
          (m = s.match(/^\s*(?:similar to|like|instead of|replace|switch from)\s+(.+?)\s*$/)))) {
        // "crm alternatives": the category's own words are a question about its ranking, not about the product
        // the words happen to resolve to (HubSpot through its "HubSpot CRM" alias)
        if ((cq = categoryOf(m[1]))) { cq.kind = 'alternatives'; q.catq = cq; s = ' ' + m[1] + ' '; }
        // all: words that start several products' names ("zoho alternatives") list the alternatives of each of them
        else if ((a = resolveProduct(m[1]))) q.intent = { kind: 'alternatives', a: a, all: sharedBy(m[1]) };
      }
      // "pipedrive v" / "hubspot vs" while the second name is still being typed: a comparison is coming,
      // so list that product's comparisons (and match on the name alone).
      if (!q.intent && !q.catq && !q.vsOf && (m = s.match(/^\s*(.+?)\s+(?:vs?\.?|versus|compared(?: to| with)?|against)\s*$/))) {
        // "crm vs": comparing within a category (its compare tool), not the product its words resolve to
        if ((cq = categoryOf(m[1]))) { cq.kind = 'vs'; q.catq = cq; s = ' ' + m[1] + ' '; }
        // vsSure: the name is typed exactly or names one product only ("zoho vs" could be Zoho Books or Zoho CRM);
        // vsAll: the products whose names those words start ("zoho vs": each of them is compared with one to choose)
        else if ((a = resolveProduct(m[1]))) { q.vsOf = a; q.vsAll = sharedBy(m[1]); q.vsSure = !q.vsAll && strictProduct(m[1]) === a; s = ' ' + m[1] + ' '; }
      }
      // "attio or", "attio compare", "compare attio", "compare attio with": the same, for a product named exactly or for
      // words that start several products' names ("compare microsoft"); "email or" stays a search for email tools,
      // "compare attio and folk" is read below
      if (!q.intent && !q.vsOf && !q.catq) {
        [/^\s*compare\s+(.+?)(?:\s+(?:with|to|and|or|&|vs\.?|versus|v\.?|against))?\s*$/, /^\s*(.+?)\s+(?:or|compare|comparisons?)\s*$/].some(function (re) {
          var mm = s.match(re), all = mm && sharedBy(mm[1]), p = mm && (strictProduct(mm[1]) || (all && all[0]));
          if (p) { q.vsOf = p; q.vsAll = all; q.vsSure = !all; s = ' ' + mm[1] + ' '; }
          return !!p;
        });
      }
      // "a vs b vs c", "compare a and b", "a or b", "a, b and c": two products are a head-to-head, more go to the tool
      if (!q.intent && !q.vsOf && !q.catq) {
        var many = productList(s);
        if (many && many.length === 2) q.intent = { kind: 'vs', a: many[0], b: many[1] };
        else if (many) q.intent = { kind: 'multi', items: many };
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
      // "attio pricing", "crm score": only when a product or category is left to apply it to — "score", "how we
      // score" and "pricing" on their own are questions about the site, answered by its pages
      [['pricing', /\b(pricing|price|cost|plans?)\s*$/], ['score', /\b(reviews?|rating|score)\s*$/]].forEach(function (x) {
        if (!x[1].test(s)) return;
        var rest = s.replace(x[1], ' ');
        if (!namesSomething(rest)) return;
        q.suffix = x[0]; q.rest = rest; s = rest;
        // "crm pricing", "payroll software cost", "email marketing score": the category's costs section or ranking
        if (!q.intent && !q.vsOf && !q.catq && !q.integration && !q.filters.free && q.filters.maxPrice == null && (cq = categoryOf(rest))) { cq.kind = x[0]; q.catq = cq; }
        // "zoho pricing", "microsoft score": words that start several products' names give each of them its row
        else if (!q.intent && !q.vsOf && !q.catq) q.shared = sharedBy(rest);
      });
      // "best crm", "top email marketing software": the category's ranking
      if (q.sort === 'score' && !q.intent && !q.vsOf && !q.catq && !q.suffix && !q.integration && !q.filters.free && q.filters.maxPrice == null && (cq = categoryOf(s))) { cq.kind = 'best'; q.catq = cq; }
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

    /** Field weight of the best exact or prefix match of token t in doc x (0: none). */
    function fieldScore(x, t) {
      var best = 0, fk, set, w, u;
      for (fk in x.f) {
        set = x.f[fk]; w = W[fk] || 1;
        if (set[t]) { if (w > best) best = w; }
        else if (t.length >= 3 && w * 0.8 > best) { for (u in set) { if (u.indexOf(t) === 0) { best = w * 0.8; break; } } }
      }
      return best;
    }
    /** The site's own pages and site-wide FAQ answers (method, money, corrections …), not category FAQs. */
    function isSite(x) { return x.type === 'page' || (x.type === 'faq' && !(x.cats && x.cats.length)); }
    function listText(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

    function query(raw) {
      raw = capped(raw);
      var q = parse(raw), res = [], top = [];
      if (q.intent && q.intent.kind === 'vs') {
        var a = q.intent.a, b = q.intent.b, published = q.intent.cmp || null;
        docs.forEach(function (x) { if (!published && x.type === 'comparison' && x.pair && x.pair.indexOf(a.id) >= 0 && x.pair.indexOf(b.id) >= 0) published = x; });
        if (published) top.push(ext(published, { why: 'Head-to-head comparison' }));
        else {
          var shared = a.cats.filter(function (id) { return b.cats.indexOf(id) >= 0 && cats[id] && cats[id][1] === 's' && a.profile && b.profile; });
          var fx = shared.length ? null : sharedFactual([a, b]);
          if (shared.length) top.push({ type: 'compare', name: a.name + ' vs ' + b.name, url: '/compare/?scope=' + shared[0] + '&a=' + a.id + '&b=' + b.id, sub: 'Side-by-side comparison in ' + cats[shared[0]][0], why: 'Live comparison' });
          // two suppliers of one documentary category: its criteria table sets them side by side
          else if (fx) top.push({ type: 'compare', id: 'compare:' + a.id + '+' + b.id, name: a.name + ' vs ' + b.name, url: '/categories/' + fx + '/#factual-comparison', sub: 'Criteria table · ' + cats[fx][0], why: 'Criteria comparison' });
          else top.push({ type: 'notice', name: a.name + ' and ' + b.name + ' are researched in different categories', url: a.url, sub: 'Open each profile to compare them yourself' });
        }
        top.push(ext(a), ext(b));
      }
      if (q.intent && q.intent.kind === 'multi') {
        // three or four products: the compare tool in the scored category they all share
        var its = q.intent.items, nms = its.map(function (x) { return x.name; });
        var common = its.every(function (x) { return x.profile; }) ? its[0].cats.filter(function (id) {
          return cats[id] && cats[id][1] === 's' && its.every(function (x) { return x.cats.indexOf(id) >= 0; });
        }) : [];
        var fxm = common.length ? null : sharedFactual(its);
        if (common.length) top.push({ type: 'compare', id: 'compare:' + its.map(function (x) { return x.id; }).join('+'), name: nms.join(' vs '), url: '/compare/?scope=' + common[0] + its.map(function (x, i) { return '&' + 'abcd'[i] + '=' + x.id; }).join(''), sub: 'Side-by-side comparison in ' + cats[common[0]][0], why: 'Live comparison' });
        else if (fxm) top.push({ type: 'compare', id: 'compare:' + its.map(function (x) { return x.id; }).join('+'), name: nms.join(' vs '), url: '/categories/' + fxm + '/#factual-comparison', sub: 'Criteria table · ' + cats[fxm][0], why: 'Criteria comparison' });
        else top.push({ type: 'notice', name: listText(nms) + ' are not researched in one category', url: its[0].url, sub: 'Open each profile to compare them yourself' });
        its.forEach(function (x) { top.push(ext(x)); });
      }
      if (q.intent && q.intent.kind === 'alternatives') {
        var f = q.intent.a;
        if (q.intent.all) q.intent.all.forEach(function (x) { top.push(alternativesRow(x)); });
        else top.push(alternativesRow(f), ext(f));
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
      var typed = words(raw).join(' ');
      var focus = q.vsOf || (plain ? namedProduct(q.termWords.join(' '), strongCat) : null);
      // ... unless the words are exactly the title of one of the site's own pages: "contact" is the Contact page,
      // not a part of "Constant Contact"
      if (focus && !q.vsOf && !isExactName(focus, q.termWords.join(' ')) && docs.some(function (x) { return isSite(x) && (x.nameKey === qn || (x.aq && x.aq.indexOf(typed) >= 0)); })) focus = null;
      // Products that match only because they list the named product or service as an integration go into
      // their own small group ("Works with HubSpot"), unless the query is a category's own name ("crm"), and only when
      // the query names what they work with: products in a comparison or alternatives query; a product its words name
      // ("hubspot", "hubspot pricing", "zoho"), whose brand or alias each of them lists (not the "Connected systems" of
      // "connect", Dialpad Connect's last word); a name that starts with a brand here ("google sheets"); or a brand that is
      // no product here, which the index uses like one ("gmail", "slack": brandLike). Generic words name nothing ("sales"
      // listed the products that work with Salesforce as "Works with sales", "cloud" those with cloud connectors): those
      // products are then listed with the other products.
      var topCatDoc = strongCat ? byId('category', strongCat) : null;
      var byWords = focus || q.intent ? null : namedBy(q.termWords);
      var viaOne = q.vsAll || q.shared || (byWords && byWords.many) ? null : focus || (byWords && byWords.one) || null;
      // viaKeys: the words one of a listed product's integrations must all have (any one list of them will do)
      var viaKeys = viaOne ? [toks(String(viaOne.name).split(/\s+/)[0])].concat(viaOne.al.map(toks))
        : focus || byWords || (q.termWords.length && namedBy(q.termWords.slice(0, 1))) || (req.length && req.every(brandLike)) ? [req] : null;
      var viaOk = !q.integration && req.length > 0 && !(topCatDoc && req.every(function (t) { return hasTok(topCatDoc.f.n, t); })) && !!(q.intent || viaKeys);
      if (q.intent) viaKeys = null; // a comparison or alternatives query names its products: their integrations as typed
      docs.forEach(function (x) {
        var s = 0, matched = 0, titled = 0, kinds = {}, t, best, kind, fk, set, w, u, i, fz;
        for (var ti = 0; ti < req.length; ti++) {
          t = req[ti]; best = 0; kind = '';
          for (fk in x.f) {
            set = x.f[fk]; w = W[fk] || 1;
            if (set[t]) { if (w > best) { best = w; kind = 'exact'; } }
            else if (t.length >= 3 && w * 0.8 > best) { for (u in set) { if (u.indexOf(t) === 0) { best = w * 0.8; kind = 'prefix'; break; } } }
          }
          if (best >= W.a * 0.8) titled++; // in the name or the keywords (nothing else weighs as much)
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
        if (qn && x.nameKey === qn) s += 100;
        else if (x.aq && x.aq.indexOf(typed) >= 0) s += 100; // one of the site's own phrases, typed exactly ("why not 100")
        else if (qn && x.nameKey.indexOf(qn) === 0) s += 30;
        q.soft.forEach(function (sf) { for (var k2 in x.f) if (x.f[k2][sf]) { s += 0.5; break; } });
        if (x.type === 'product') s += ((x.best || 0) / 100) * 3 + (x.profile ? 1.5 : 0);
        // The whole query names a category ("crm", "help desk"): list that category's products in
        // published order rather than favouring products that happen to carry the word in their name.
        if (strongCat && x.type === 'product' && x.cats.indexOf(strongCat) >= 0 && x.nameKey !== qn) s = 60 + (x.cs && x.cs[strongCat] != null ? x.cs[strongCat] : 0) / 5 + (x.profile ? 1 : 0);
        if (x.type === 'guide') s += q.boost.guide || 0;
        if (q.integration && x.type === 'product' && x.f.i) { if (toks(q.integration).every(function (it) { return x.f.i[it]; })) s += 6; }
        var r = ext(x); r.score = s; r.kinds = Object.keys(kinds).join('+');
        if (titled === req.length && isSite(x)) r.titled = 1;
        if (viaOk && x.type === 'product' && x !== focus && matched === req.length && x.f.i &&
            !catHits.some(function (id) { return x.cats.indexOf(id) >= 0; }) &&
            req.every(function (t2) { return hasTok(x.f.i, t2) && !NOT_INTEGRATION.some(function (k) { return hasTok(x.f[k], t2); }); }) &&
            (!viaKeys || viaKeys.some(function (ks) { return ks.length && ks.every(function (k) { return x.f.i[k]; }); }))) r.via = 1;
        res.push(r);
      });
      // Nothing has every word: rank the site's pages and FAQ answers by the words they do have (at least half)
      // instead of answering "No results" ("how often do you update your prices", a word typed wrongly)
      if (!res.length && !top.length && req.length > 1) {
        docs.forEach(function (x) {
          if (x.type !== 'page' && x.type !== 'faq') return;
          var s = 0, hit = 0;
          req.forEach(function (t) { var b = fieldScore(x, t); if (b) { s += b; hit++; } });
          if (hit * 2 >= req.length) { var r = ext(x); r.score = hit * 100 + s; r.kinds = 'some'; res.push(r); }
        });
      }
      // A question about the site itself ("how we score", "corrections", "how do you make money"): a page or
      // site-wide FAQ answer that has every word in its title or keywords and outscores every category, product,
      // comparison and guide is the best match (Enter opens it). One word alone must be the title, start it or be
      // one of the page's own phrases — "list" is not a question about "How can a vendor be listed?"
      if (plain && !focus && !strongCat) {
        var bestOther = 0, floor = req.length > 1 ? W.n : W.n + 30;
        res.forEach(function (r) { if (r.type !== 'page' && r.type !== 'faq' && r.score > bestOther) bestOther = r.score; });
        res.filter(function (r) { return r.titled && r.score >= floor && r.score > bestOther; })
          .sort(function (x, y) { return y.score - x.score || (x.type === 'page' ? 0 : 1) - (y.type === 'page' ? 0 : 1) || x.name.localeCompare(y.name); })
          .slice(0, 2).forEach(function (r) { top.push(r); });
      }
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
      // A category's own words and nothing else ("crm pricing", "crm alternatives", "best crm", "crm vs"): that category
      // leads, not the product its words happen to resolve to. Words several categories share ("marketing pricing")
      // list up to three of them, in the order of the results.
      var catLead = q.catq && !top.length ? q.catq : null;
      if (catLead) {
        var order = (groups.category || []).map(function (c) { return c.id; }), rank = function (id) { var i = order.indexOf(id); return i < 0 ? 99 : i; };
        (catLead.sure ? [catLead.id] : catLead.ids.slice().sort(function (x, y) { return rank(x) - rank(y); }).slice(0, 3)).forEach(function (id) {
          var c = byId('category', id);
          if (c) top.push(categoryRow(catLead.kind, c));
        });
        if (catLead.kind === 'vs' && catLead.sure && top.length) categoryComparisons(catLead.id).slice(0, 5).forEach(function (c) { top.push(ext(c, { why: 'Head-to-head comparison' })); });
      }
      // "X pricing" / "X score" → the right section for the first product hit: its profile's pricing or evidence, or a
      // documented supplier's plans and prices on its category page (a supplier has no score). Words that start several
      // products' names ("zoho pricing", "microsoft score") give each of those products its row.
      // The one product whose name or alias the words are comes first ("firefly pricing": Adobe Firefly, whose alias it is,
      // not Fireflies, which the stemmer reads as "firefly"). A documented supplier gets its row only when the words name
      // it so; otherwise the first hit gets one only if it has a profile, as before ("ai 3d asset generation pricing" is
      // about the category, not about the supplier that happens to come first).
      if (q.suffix && groups.product && groups.product.length && !top.length) {
        var exactly = q.shared ? [] : docs.filter(function (x) { return x.type === 'product' && isExactName(x, q.rest) && passes(x); });
        var p0 = exactly.length === 1 ? exactly[0] : groups.product[0].profile ? groups.product[0] : null;
        (q.shared ? q.shared.filter(passes) : p0 ? [p0] : []).forEach(function (p) { var row = sectionRow(q.suffix, p); if (row) top.push(row); });
      }
      // direct: the first "best match" answers the query ("X vs Y", "X alternatives", "X pricing"), so Enter opens it;
      // a category's row only when the words are that one category's own ("crm pricing", not "marketing pricing")
      var direct = top.length > 0;
      if (catLead && top.length) direct = catLead.sure;
      if (focus && !top.length) {
        var mine = comparisonsOf(focus);
        if (q.vsNext) {
          // "pipedrive vs s": comparisons against a product whose name starts with those letters come first
          var nx = words(q.vsNext).join(' '), opp = function (c) { var o = byId('product', c.pair[0] === focus.id ? c.pair[1] : c.pair[0]); return !!o && words(o.name).some(function (w) { return w.indexOf(nx) === 0; }); };
          mine = mine.filter(opp).concat(mine.filter(function (c) { return !opp(c); }));
        }
        if (q.vsAll) {
          // "zoho vs", "compare microsoft": words that start several products' names compare each of them with one still
          // to choose (suggestions: which one is meant?); the published head-to-heads follow in their own group
          q.vsAll.forEach(function (x) { var t = compareWith(x); if (t) top.push(t); });
          if (!top.length) top.push(ext(focus));
          direct = false;
        } else if (q.vsOf) {
          // "X vs", "X or", "compare X" with no second product yet: comparing X with one still to choose leads
          // (Enter opens it when X is named exactly), then X's published head-to-heads
          var tool = compareWith(focus);
          if (tool) top.push(tool);
          mine.slice(0, 6).forEach(function (c) { top.push(ext(c, { why: 'Head-to-head comparison' })); });
          if (!top.length) top.push(ext(focus));
          direct = !!(tool && q.vsSure);
        } else {
          top.push(ext(focus));
          mine.slice(0, 3).forEach(function (c) { top.push(ext(c, { why: 'Head-to-head comparison' })); });
          if (focus.profile) top.push(alternativesRow(focus));
          direct = true; // the query is that product's name: Enter opens its profile
        }
      }
      // The whole query is one category's own name or synonym ("crm", "email marketing", "help desk") and that
      // category leads the results: Enter opens it (r.exact; "See all results" stays one row further down)
      var exact = null;
      if (plain && !focus && !top.length && strongCat && groups.category && groups.category.length) {
        var owners = phrase[qn], ownId = owners ? (owners.length === 1 ? owners[0] : own[typed]) : null;
        if (ownId && groups.category[0].id === ownId) exact = { type: 'category', id: ownId };
      }
      // a named product makes typo matches noise ("stripe" is not a misspelt "CrowdStrike")
      if (focus) Object.keys(groups).forEach(function (k) { groups[k] = groups[k].filter(function (r) { return r.kinds !== 'fuzzy'; }); });
      var via = null, viaItems = (groups.product || []).filter(function (r) { return r.via; });
      if (viaItems.length) {
        var vs = q.intent && q.intent.kind === 'vs' ? q.intent : null, first = function (x) { return String(x.name).split(/\s+/)[0]; };
        // the product's brand as typed ("HubSpot" of HubSpot Sales Hub), or its whole name where the words typed are a
        // later part of it ("workspace": Google Workspace)
        var label = function (p) { var b = brandOf(p, req); return b.toLowerCase().indexOf(String(p.name).split(/\s+/)[0].toLowerCase()) === 0 ? b : p.name; };
        var named = focus ? label(focus) : vs ? first(vs.a) + ' and ' + first(vs.b) : q.intent && q.intent.kind === 'multi' ? listText(q.intent.items.map(first)) : q.intent ? brandOf(q.intent.a, req) : byWords && byWords.one ? label(byWords.one) : q.termWords.map(spell).join(' ');
        via = { label: 'Works with ' + named, items: viaItems };
      }
      var seen = {}, total = 0;
      Object.keys(groups).reduce(function (all, k) { return all.concat(groups[k]); }, top.slice()).forEach(function (r) { var k = r.type + ':' + (r.id || r.url); if (!seen[k]) { seen[k] = 1; total++; } });
      return { q: q, top: top, direct: direct, exact: exact, groups: groups, via: via, total: total, catHits: catHits.map(function (id) { return byId('category', id); }).filter(Boolean).map(function (x) { return ext(x); }) };
    }

    function ext(x, extra) {
      var r = { type: x.type, id: x.id, name: x.name, url: x.url, sub: x.sub, cats: x.cats, best: x.best, amount: x.amount, priceText: x.priceText, free: x.free, ai: x.ai, profile: x.profile, logo: x.logo, dark: x.dark, wide: x.wide, mode: x.mode, count: x.count };
      if (extra) for (var k in extra) r[k] = extra[k];
      return r;
    }

    api.query = query; api.parse = parse; api.resolveProduct = resolveProduct; api.pairLevel = pairLevel; api.docs = docs; api.cats = cats; api.size = docs.length; api.extend = extend;
    return api;
  }

  return { create: create, words: words, toks: toks, stem: stem, key: key, fold: fold, urlOf: urlOf, capped: capped, MAX_CHARS: MAX_CHARS, MAX_WORDS: MAX_WORDS };
});
