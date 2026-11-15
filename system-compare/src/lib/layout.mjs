// Document shell: <head> (SEO, structured data, fonts), header, footer. One shell for every page.

import { html, raw, attrs, jsonForScript, esc } from './html.mjs';
import { createSeo } from './seo.mjs';

// ------------------------------------------------------------------ icons (inline, currentColor)
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  scale: '<path d="M12 4v16M6 20h12M5 8h14"/><path d="M5 8l-2.5 6a2.7 2.7 0 0 0 5 0zM19 8l-2.5 6a2.7 2.7 0 0 0 5 0z"/>',
  book: '<path d="M5 5a2 2 0 0 1 2-2h12v16H7a2 2 0 0 0-2 2z"/><path d="M5 21V5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7h14v-7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
export const icon = (name, { size } = {}) =>
  raw(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${
      size ? ` width="${size}" height="${size}"` : ''
    }>${ICONS[name] || ''}</svg>`,
  );

const MARK = `<svg class="brand__mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect x="6.5" y="19" width="11" height="15" rx="3.5" fill="#4a3aff"/><rect x="22.5" y="10" width="11" height="24" rx="3.5" fill="#ff6a3d"/><rect x="3" y="35.5" width="34" height="2.6" rx="1.3" fill="#11131f"/><path d="M12 13.2 28 4.2" fill="none" stroke="#11131f" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="13.2" r="2.6" fill="#11131f"/><circle cx="28" cy="4.2" r="2.6" fill="#11131f"/></svg>`;

export const brand = (ctx) =>
  html`<a class="brand" href="/" aria-label="${ctx.site.editionName} home">${raw(MARK)}<span class="brand__word">system<i></i> <b>compare</b></span></a>`;

// ------------------------------------------------------------------ header
function megaMenu(ctx) {
  return html`<details class="mega-wrap" data-mega>
    <summary class="nav__link" aria-haspopup="true">Categories ${icon('chevron')}</summary>
    <div class="mega" data-nosnippet>
      <div class="wrap">
        <div class="mega__inner">
          ${ctx.groups.map(
            (g) => html`<div class="mega__group" data-group="${g.id}">
              <p class="mega__title">${g.label}</p>
              <ul>
                ${g.categories.map((c) => html`<li><a href="${ctx.url.category(c.id)}">${c.name}</a></li>`)}
              </ul>
            </div>`,
          )}
        </div>
        <div class="mega__foot">
          <a class="link-arrow" href="/categories/">All ${ctx.categories.length} categories</a>
          <a class="link-arrow" href="/software/">All software A–Z</a>
          <a class="link-arrow" href="/ai/">AI capability research</a>
        </div>
      </div>
    </div>
  </details>`;
}

function header(ctx, page) {
  const cur = (key) => (page.nav === key ? { 'aria-current': 'page' } : {});
  return html`<header class="site-header" data-nosnippet>
    <div class="wrap site-header__bar">
      ${brand(ctx)}
      <nav class="nav" aria-label="Primary">
        ${megaMenu(ctx)}
        <a class="nav__link" href="/compare/"${attrs(cur('compare'))}>Compare</a>
        <a class="nav__link" href="/guides/"${attrs(cur('guides'))}>Guides</a>
        <a class="nav__link" href="/methodology/"${attrs(cur('methodology'))}>How we score</a>
      </nav>
      <a class="searchbtn" href="/search/" data-search-open role="button" aria-label="Search software, categories and comparisons" aria-keyshortcuts="/ Control+K Meta+K">
        ${icon('search')}<span class="searchbtn__label">Search software, categories, comparisons…</span><kbd>/</kbd>
      </a>
      <a class="shortlist-link" href="/shortlist/"${attrs(cur('shortlist'))}>
        ${icon('bookmark')}<span class="shortlist-link__text">Shortlist</span>
        <span class="count" data-shortlist-count data-n="0" aria-label="products saved">0</span>
      </a>
      <a class="menu-btn" href="/categories/" data-menu-open role="button" aria-label="Menu">${icon('menu')}</a>
    </div>
  </header>`;
}

// ------------------------------------------------------------------ footer
function footer(ctx) {
  const col = (title, links) => html`<div>
    <p class="site-footer__title">${title}</p>
    <ul>
      ${links.map((l) => (l.button ? html`<li><button type="button"${attrs(l.button)}>${l.label}</button></li>` : html`<li><a href="${l.href}">${l.label}</a></li>`))}
    </ul>
  </div>`;
  return html`<footer class="site-footer" data-nosnippet>
    <div class="wrap">
      <div class="site-footer__grid">
        <div class="site-footer__about">
          ${brand(ctx)}
          <p>${ctx.site.tagline} Research built on dated, official sources. Not customer star ratings.</p>
          <p><a href="/countries/">${ctx.site.country} · English · ${ctx.site.currency}</a></p>
        </div>
        <nav aria-label="Footer">
          ${col('Find your software', [
            { href: '/categories/', label: 'All categories' },
            { href: '/software/', label: 'Software directory' },
            { href: '/comparisons/', label: 'Comparison library' },
            { href: '/ai/', label: 'AI capability research' },
            { href: '/search/', label: 'Search' },
          ])}
          ${col('Make a decision', [
            { href: '/guides/', label: 'Buying guides' },
            { href: '/tools/cost/', label: 'Total cost calculator' },
            { href: '/shortlist/', label: 'Your shortlist' },
            { href: '/methodology/', label: 'How we score' },
            { href: '/faq/', label: 'FAQ' },
            { href: '/research-updates/', label: 'Research updates' },
            { href: '/editorial-policy/', label: 'Editorial responsibility' },
            { href: '/corrections/', label: 'Suggest a correction' },
          ])}
          ${col('System Compare', [
            { href: '/about/', label: 'About the publisher' },
            { href: '/countries/', label: 'System Compare worldwide' },
            { href: '/how-we-make-money/', label: 'How we make money' },
            { href: '/partners/', label: 'Partners' },
            { href: '/contact/', label: 'Contact' },
            { href: '/privacy/', label: 'Privacy policy' },
            { href: '/terms/', label: 'Terms of use' },
            { href: '/accessibility/', label: 'Accessibility' },
            { label: 'Accessibility options', button: { 'data-a11y-open': true } },
            { label: 'Privacy choices', button: { 'data-privacy-open': true } },
          ])}
        </nav>
      </div>
      <div class="site-footer__legal">
        <span>© ${ctx.year} ${ctx.site.publisher.legalName} · Product names and logos belong to their owners.</span>
        <span>Research, not customer star ratings. No vendor pays for placement.</span>
      </div>
    </div>
  </footer>`;
}

// ------------------------------------------------------------------ breadcrumbs (visible)
export function crumbs(ctx, items) {
  if (!items || !items.length) return '';
  const all = [{ name: 'Home', url: '/' }, ...items];
  return html`<nav class="wrap" aria-label="Breadcrumb">
    <ol class="crumbs">
      ${all.map((c, i) =>
        i === all.length - 1 ? html`<li><span aria-current="page">${c.name}</span></li>` : html`<li><a href="${c.url}">${c.name}</a></li>`,
      )}
    </ol>
  </nav>`;
}

const AFFILIATE_NOTICE = html`<div class="wrap" data-nosnippet>
  <p class="note" role="note"><span class="tag tag--ad">Ad</span><span><strong>Affiliate advertising.</strong> Some links on this page are marked “Ad · affiliate link”. We may earn a commission if you buy through them. Commissions never change a score or a ranking. <a href="/how-we-make-money/">How we make money</a></span></p>
</div>`;

// Applied before first paint: reader preferences + the saved-shortlist count (avoids a flash of "0").
const EARLY_JS = `(function(){var d=document.documentElement;d.className+=' js';try{var p=JSON.parse(localStorage.getItem('sc-accessibility-v1')||'{}');if(p.size&&p.size!==100)d.setAttribute('data-a11y-size',p.size);['contrast','spacing','links','motion'].forEach(function(k){if(p[k])d.setAttribute('data-a11y-'+k,'1')})}catch(e){}})();`;

// ------------------------------------------------------------------ document
/**
 * page = {
 *   title, description,                 required
 *   body,                               required — HTML for <main> (must contain exactly one <h1>)
 *   breadcrumbs: [{name, url}],         without Home; last item = this page (visible + JSON-LD)
 *   nav: 'categories'|'compare'|'guides'|'methodology'|'shortlist',
 *   pageType: 'WebPage'|'CollectionPage'|'AboutPage'|'ContactPage'|'FAQPage'|'SearchResultsPage'|…,
 *   pageExtra: {}                       extra properties merged into the page node (about, mainEntity …)
 *   jsonld: [nodes]                     extra @graph nodes
 *   faq: [{q, a}]                       emits FAQPage JSON-LD (render the visible block with components.faq())
 *   dateModified, datePublished         ISO dates from DATA only (never the build date)
 *   ogType, ogImage: {url,width,height,alt}, ogTitle
 *   robots                              override; default follows ctx.isIndexable(path)
 *   canonical                           override; default = absolute path
 *   scripts: ['js/x.js'],               extra deferred scripts (after core.js)
 *   pageData: {}                        JSON for page scripts (<script type="application/json" id="page-data">)
 *   bodyAttrs: {}, bodyClass,           e.g. {'data-hero-search': ''}
 *   fullOrg: true                       emit the full Organization node (home, about)
 *   accountable: true                   add the publication approver as accountablePerson
 *   preload: [{href, as, type}]         e.g. the LCP hero image
 *   head                                extra <head> markup (Raw), e.g. a referrer policy meta
 *   staticScripts: ['/partners-ui.js']  deferred scripts that live in src/assets/static (not hashed)
 *   analytics: false                    never load the consent-gated analytics script on this page
 * }
 */
export function renderDocument(ctx, route, page) {
  const seo = ctx.seo || (ctx.seo = createSeo(ctx));
  const path = route.path;
  const { site } = ctx;
  const canonical = page.canonical || ctx.abs(path);
  const indexable = page.robots ? !/noindex/.test(page.robots) : ctx.isIndexable(path);
  const robots = page.robots || (indexable ? 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1' : 'noindex,follow');
  const ogImage = page.ogImage || { url: '/assets/social-preview.png', width: 1200, height: 630, alt: `${site.editionName} — ${site.tagline}` };
  const ogTitle = page.ogTitle || String(page.title).replace(/ \| System Compare( US)?$/, '');
  const hreflang = indexable ? ctx.hreflang(path) : null;
  const is404 = path === '/404.html';

  const crumbItems = page.breadcrumbs || [];
  const graph = [seo.orgNode(Boolean(page.fullOrg)), seo.websiteNode()];
  if (page.accountable && seo.personNode()) graph.push(seo.personNode());
  if (!is404) {
    graph.push(
      seo.pageNode({
        path,
        name: ogTitle,
        description: page.description,
        type: page.pageType || 'WebPage',
        dateModified: page.dateModified,
        datePublished: page.datePublished,
        image: page.ogImage,
        hasCrumbs: crumbItems.length > 0,
        extra: { ...(page.accountable && seo.accountable() ? { accountablePerson: seo.accountable() } : {}), ...(page.pageExtra || {}) },
      }),
    );
    if (crumbItems.length) graph.push(seo.breadcrumbNode(path, crumbItems));
    if (page.faq && page.faq.length) graph.push(seo.faqNode(path, page.faq));
  }
  for (const node of page.jsonld || []) if (node) graph.push(node);

  const bodyStr = String(page.body);
  const hasAffiliate = bodyStr.includes('data-outbound-affiliate="true"') || bodyStr.includes('data-partner-ad');
  const scripts = ['js/core.js', ...(page.scripts || [])];

  return html`<!doctype html>
<html lang="${site.lang}" data-base="__BASE__" data-v="${ctx.dataVersion}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
${is404 ? '' : html`<link rel="canonical" href="${canonical}">`}
<meta name="robots" content="${robots}">
${hreflang ? hreflang.map((h) => html`<link rel="alternate" hreflang="${h.hreflang}" href="${h.href}">`) : ''}
<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:site_name" content="${site.editionName}">
<meta property="og:locale" content="${site.locale}">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ctx.abs(ogImage.url)}">
${ogImage.width ? html`<meta property="og:image:width" content="${ogImage.width}"><meta property="og:image:height" content="${ogImage.height}">` : ''}
${ogImage.alt ? html`<meta property="og:image:alt" content="${ogImage.alt}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${page.description}">
<meta name="twitter:image" content="${ctx.abs(ogImage.url)}">
<link rel="alternate" type="application/rss+xml" title="${site.editionName} research updates" href="/feed.xml">
<link rel="alternate" type="application/atom+xml" title="${site.editionName} research updates" href="/atom.xml">
${raw(site.verificationMetaHtml)}
<meta name="theme-color" content="${site.themeColor}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/inter-latin.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/rubik-latin.woff2" crossorigin>
${(page.preload || []).map((p) => html`<link rel="preload"${attrs(p)}>`)}
<link rel="stylesheet" href="${ctx.asset('site.css')}">
<link rel="prefetch" as="script" href="${ctx.asset('js/search.js')}" id="sc-search-engine">
<script>${raw(EARLY_JS)}</script>
<script type="application/ld+json">${jsonForScript({ '@context': 'https://schema.org', '@graph': graph })}</script>
${page.head ? raw(String(page.head)) : ''}
${scripts.map((s) => html`<script defer src="${ctx.asset(s)}"></script>`)}
${(page.staticScripts || []).map((src) => html`<script defer src="${src}"></script>`)}
${page.analytics === false ? '' : html`<script defer src="${ctx.asset('js/analytics.js')}" data-sc-measurement="${site.analytics.ga4Id}" data-sc-host="${site.analytics.productionHost}"></script>`}
</head>
<body${attrs({ class: page.bodyClass, 'data-page': route.module, ...(page.bodyAttrs || {}) })}>
<a class="skip-link" href="#main">Skip to content</a>
${header(ctx, page)}
<main id="main" tabindex="-1">
${page.hideCrumbs ? '' : crumbs(ctx, crumbItems)}
${hasAffiliate && !page.noAffiliateNotice ? AFFILIATE_NOTICE : ''}
${raw(bodyStr)}
</main>
${footer(ctx)}
${page.pageData ? html`<script type="application/json" id="page-data">${jsonForScript(page.pageData)}</script>` : ''}
</body>
</html>
`;
}

export { esc };
