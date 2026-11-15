/* System Compare — consent-gated analytics (behaviour unchanged from the previous site).
 *
 *  - Google Analytics 4 loads only after an explicit opt-in, and only on the production hostname.
 *  - The choice is remembered for 180 days in localStorage "sc-analytics-consent-v1" ({allowed, until}).
 *  - Global Privacy Control forces analytics off. Ad storage is always denied.
 *  - page_location never includes the query string, so search terms are never sent.
 *  - Events: page_view, comparison_view, vendor_outbound, comparison_add, cost_calculation.
 */
(() => {
  'use strict';
  const script = document.querySelector('script[data-sc-measurement]');
  if (!script) return;
  const host = script.dataset.scHost || 'system-compare.com';
  if (![host, 'www.' + host].includes(location.hostname) || /^\/(admin|api|wp-admin|wp-login)/.test(location.pathname)) return;
  const id = script.dataset.scMeasurement;
  if (!/^G-[A-Z0-9]+$/.test(id)) return;
  if (window.SC) window.SC.hasAnalytics = true; // lets the privacy dialog offer "Analytics cookie settings"
  const key = 'sc-analytics-consent-v1', maxAge = 180 * 86400000;
  const gpc = navigator.globalPrivacyControl === true;
  let consent = null, loaded = false;
  try { const saved = JSON.parse(localStorage.getItem(key)); if (saved && typeof saved.allowed === 'boolean' && saved.until > Date.now()) consent = saved.allowed; } catch {}
  if (gpc) consent = false;

  const panel = document.createElement('section');
  panel.className = 'consent'; panel.id = 'sc-privacy-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'sc-privacy-title'); panel.setAttribute('data-nosnippet', '');
  const h = document.createElement('h2'); h.id = 'sc-privacy-title'; h.textContent = 'Your privacy choices';
  const p = document.createElement('p');
  p.textContent = gpc
    ? 'Your browser sends a Global Privacy Control signal. Analytics is disabled. You can manage this signal in your browser settings. '
    : 'With your permission, we use Google Analytics to measure visits and how our comparison tools are used. Analytics stays off until you agree. You can change your choice at any time. ';
  const policy = document.createElement('a'); policy.href = (window.SC && SC.url ? SC.url('/privacy/') : '/privacy/'); policy.textContent = 'Privacy policy'; p.append(policy);
  const actions = document.createElement('div'); actions.className = 'consent__actions';
  const no = document.createElement('button'); no.type = 'button'; no.className = 'btn btn--ghost btn--sm'; no.textContent = 'Reject analytics';
  const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn btn--sm'; yes.textContent = 'Allow analytics'; yes.disabled = gpc;
  actions.append(no, yes); panel.append(h, p, actions); document.body.append(panel);

  const show = (open) => { panel.hidden = !open; };
  function clearCookies() { for (const item of document.cookie.split(';')) { const name = item.split('=')[0].trim(); if (/^_ga(?:_|$)/.test(name)) document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax; Secure'; } }
  function send(name, params = {}) { if (consent === true && loaded) window.gtag('event', name, params); }
  function loadAnalytics() {
    if (loaded || consent !== true) return;
    loaded = true; window['ga-disable-' + id] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('js', new Date());
    let referrer = ''; try { referrer = new URL(document.referrer).origin + '/'; } catch {}
    window.gtag('config', id, { send_page_view: true, page_location: location.origin + location.pathname, page_title: 'System Compare ' + location.pathname, page_referrer: referrer, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_domain: 'none', cookie_expires: 31536000, cookie_flags: 'SameSite=Lax;Secure' });
    const tag = document.createElement('script'); tag.async = true; tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + id; tag.dataset.scGoogleTag = 'true'; document.head.append(tag);
    if (/^\/(vs|compare)\//.test(location.pathname)) send('comparison_view', { page_path: location.pathname });
  }
  function choose(allowed) {
    const previouslyLoaded = loaded; consent = allowed && !gpc; allowed = consent;
    try { localStorage.setItem(key, JSON.stringify({ allowed, until: Date.now() + maxAge })); } catch {}
    show(false);
    if (allowed) loadAnalytics(); else { window['ga-disable-' + id] = true; clearCookies(); if (previouslyLoaded) { location.reload(); return; } }
  }
  yes.addEventListener('click', () => choose(true));
  no.addEventListener('click', () => choose(false));
  document.addEventListener('sc:open-consent', () => { show(true); no.focus(); });
  window.addEventListener('storage', (event) => { if (event.key === key) { window['ga-disable-' + id] = true; location.reload(); } });
  document.addEventListener('click', (event) => {
    if (consent !== true || !(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]'); if (!link) return;
    let target; try { target = new URL(link.href); } catch { return; }
    if (/^[a-z0-9-]{1,80}$/.test(link.dataset.vendorId || '') && ['website', 'pricing'].includes(link.dataset.outboundIntent)) {
      const params = { vendor_id: link.dataset.vendorId, link_intent: link.dataset.outboundIntent, affiliate_link: link.dataset.outboundAffiliate === 'true' };
      if (/^[a-z0-9-]{1,60}$/.test(link.dataset.outboundPlacement || '')) params.link_placement = link.dataset.outboundPlacement;
      if (/^[a-z0-9.-]{1,253}$/.test(link.dataset.destinationHost || '')) params.destination_host = link.dataset.destinationHost;
      send('vendor_outbound', params); return;
    }
    if (target.origin === location.origin && /^\/go\/[a-z0-9-]+\/?$/.test(target.pathname)) send('vendor_outbound', { vendor_id: target.pathname.split('/')[2] });
  });
  document.addEventListener('sc:comparison-add', (event) => { const vid = event.detail && event.detail.vendorId; if (/^[a-z0-9-]{1,80}$/.test(vid || '')) send('comparison_add', { vendor_id: vid }); });
  document.addEventListener('sc:cost-calculation', () => send('cost_calculation'));
  show(consent === null && !gpc);
  if (consent === true) loadAnalytics(); else { window['ga-disable-' + id] = true; clearCookies(); }
})();
