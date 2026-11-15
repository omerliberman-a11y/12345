// /partners/apply/ — the supplier application.
//
// The flow itself (12 interface languages, validation, CSRF, idempotency, receipt) lives in the existing
// /partners-ui.js bundle and talks to the same-origin /api/partners/* backend. This module keeps that
// script's markup contract byte-for-byte (the <section data-partner-page="apply"> captured from the live
// server: element ids, input names, data-* attributes and every text node the script translates) and only
// places it inside the normal site shell with new styling (src/assets/css/pages/static.css, ".st-pg-apply").
//
// Without the backend (any plain static host) the script cannot load /api/partners/config: it shows its
// own error status and the "applications are temporarily unavailable — e-mail us" fallback that is part
// of the captured markup. Nothing else on the page depends on the backend.

import { html, raw, text } from '../lib/html.mjs';
import { stripSuffix } from './static.mjs';

export function routes() {
  return [{ path: '/partners/apply/', render }];
}

// The published privacy text says no optional analytics is loaded on this page, and the live page sends
// no referrer: both are per-page switches of the shared layout (analytics: false, head).

function render(ctx) {
  const path = '/partners/apply/';
  const live = ctx.liveHead(path) || {};
  const captured = ctx.content.staticServer.partners_apply_body_html;

  const section = (captured.match(/<section class="partner-workspace"[\s\S]*<\/section>(?=<\/main>)/) || [])[0];
  const language = (captured.match(/<label class="partner-language-switch">[\s\S]*?<\/label>/) || [])[0];
  if (!section || !language) throw new Error('partners apply: captured markup not found in static-server-content.json');

  // Class names only — ids, names, data-* attributes and text nodes are untouched.
  const restyled = section
    .replace('class="button secondary"', 'class="btn btn--ghost"')
    .replace('<button class="button" type="submit">', '<button class="btn btn--lg" type="submit">')
    .replace(/class="muted"/g, 'class="fineprint"');
  const h1 = text((section.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || 'Apply');

  const body = html`<div class="wrap wrap--narrow st-pg-apply">
      <div class="st-pg-apply__lang" data-nosnippet>${raw(language)}</div>
      ${raw(restyled)}
    </div>`;

  return {
    title: live.title || 'Apply to add your software | System Compare',
    description: live.description || 'Free supplier application for the System Compare network.',
    ogTitle: stripSuffix(live.title) || h1,
    body,
    breadcrumbs: [
      { name: 'Software supplier partners', url: '/partners/' },
      { name: stripSuffix(live.title) || h1, url: path },
    ],
    pageType: 'WebPage',
    analytics: false,
    head: '<meta name="referrer" content="no-referrer">',
    staticScripts: ['/partners-ui.js'],
  };
}
