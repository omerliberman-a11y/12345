// /404.html — served by the host for unknown URLs. Uses root-absolute links (it can be shown at any depth).

import { html } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';

export function routes() {
  return [{ path: '/404.html', absoluteLinks: true, render }];
}

function render(ctx) {
  const popular = ['crm', 'email-marketing', 'accounting', 'payroll', 'customer-service', 'project-management'].map((id) => ctx.category(id)).filter(Boolean);
  return {
    title: 'Page not found | System Compare US',
    description: 'This page does not exist. Search System Compare or start from a software category.',
    robots: 'noindex,follow',
    hideCrumbs: true,
    body: html`<div class="wrap nf">
      <h1>We can’t find that page</h1>
      <p class="lede">The address may have changed, or the page never existed. Search for what you need, or start from a category.</p>
      <div class="nf__search">${ui.searchField(ctx, { id: 'nf-q' })}</div>
      ${ui.chipLinks(popular.map((c) => ({ href: ctx.url.category(c.id), label: c.name })))}
      <p class="nf__links"><a class="link-arrow" href="/categories/">All categories</a> · <a class="link-arrow" href="/software/">Software directory</a> · <a class="link-arrow" href="/">Home</a></p>
    </div>`,
  };
}
