// /countries/ — the 17 country editions as one compact table (was 17 tall cards), the current edition
// marked, and the publisher's explanatory copy kept verbatim.

import { html, raw } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { docLayout, liftLead, prepareHtml, relatedLinks, stripSuffix } from './static.mjs';

export function routes() {
  return [{ path: '/countries/', render }];
}

// Primary locale per edition for hreflang/lang on the links (catalog `locale` wins when present).
const LOCALE = { US: 'en-US', GB: 'en-GB', DE: 'de-DE', AT: 'de-AT', CH: 'de-CH', FR: 'fr-FR', IT: 'it-IT', PL: 'pl-PL', IL: 'he-IL', NL: 'nl-NL', PH: 'en-PH', CO: 'es-CO', CL: 'es-CL', TW: 'zh-Hant-TW', ZA: 'en-ZA', SE: 'sv-SE', PE: 'es-PE' };

const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function render(ctx) {
  const path = '/countries/';
  const page = ctx.pages[path];
  const live = ctx.liveHead(path) || {};
  const editions = page.editions || [];
  const here = editions.find((e) => host(e.url) === host(ctx.site.origin));

  // The catalog HTML is: lead + intro paragraph, the old card grid (now rendered from `editions`),
  // and the explanation section. Keep the two text parts verbatim.
  const gridAt = page.html.indexOf('<div class="network-grid">');
  const intro = liftLead(gridAt >= 0 ? page.html.slice(0, gridAt) : page.html);
  const explain = (page.html.match(/<section class="network-explanation">([\s\S]*?)<\/section>/) || [])[1] || '';
  const { html: explainHtml } = prepareHtml(explain);

  const localeOf = (e) => e.locale || LOCALE[e.countryCode] || null;
  const langOf = (e) => (localeOf(e) || '').split('-')[0] || null;

  const table = html`<table class="dtable st-pg-ed" role="table">
    <caption class="sr-only">System Compare country editions: country, language, market currency and website</caption>
    <thead role="rowgroup">
      <tr role="row">
        <th scope="col" role="columnheader">Edition</th>
        <th scope="col" role="columnheader">Language</th>
        <th scope="col" role="columnheader">Market currency</th>
        <th scope="col" role="columnheader">Website</th>
      </tr>
    </thead>
    <tbody role="rowgroup">
      ${editions.map((e) => {
        const current = e === here;
        const native = e.nativeName && e.nativeName !== e.name ? e.nativeName : '';
        return html`<tr role="row"${raw(current ? ' class="is-here"' : '')}>
          <th scope="row" role="rowheader" class="st-pg-ed__name">
            <span class="st-pg-ed__wrap">
              <span class="st-pg-ed__code" aria-hidden="true">${e.countryCode}</span>
              <span class="st-pg-ed__text">
                <span class="st-pg-ed__country">${e.name}${native ? html` <span class="st-pg-ed__native" dir="auto"${raw(langOf(e) ? ` lang="${langOf(e)}"` : '')}>${native}</span>` : ''}${current ? html` ${ui.tag('You are here', 'brand')}` : ''}</span>
                <small>${e.summary}</small>
              </span>
            </span>
          </th>
          <td role="cell" class="st-pg-ed__lang"><span class="st-pg-ed__label">Language: </span><span dir="auto">${(e.languages || []).join(', ')}</span></td>
          <td role="cell" class="st-pg-ed__cur"><span class="st-pg-ed__label">Market currency: </span>${e.currency}</td>
          <td role="cell" class="st-pg-ed__site">
            <a href="${e.url}"${raw(localeOf(e) ? ` hreflang="${localeOf(e)}"` : '')}${raw(current ? ' aria-current="true"' : '')} aria-label="Visit ${e.name}: ${host(e.url)}">${host(e.url)}</a>
          </td>
        </tr>`;
      })}
    </tbody>
  </table>`;

  const langCount = new Set(editions.flatMap((e) => e.languages || [])).size;
  const body = docLayout({
    wide: true,
    head: {
      h1: page.title,
      lede: intro.lead ? raw(intro.lead) : '',
      after: html`<div class="doc-answer">
        ${ui.answer(
          ctx,
          html`System Compare has <strong>${editions.length} country editions</strong> in ${langCount} languages.${
            here ? html` You are on the ${here.name} edition (${(here.languages || []).join(', ')}, ${here.currency}).` : ''
          } There is no automatic redirect: you choose which edition to visit.`,
        )}
      </div>`,
    },
    main: html`<section class="doc-sec st-pg-editions" aria-labelledby="editions">
        <h2 id="editions">Choose an edition</h2>
        <div class="prose doc-prose">${raw(intro.rest)}</div>
        ${table}
      </section>
      <div class="prose doc-prose">${raw(explainHtml)}</div>
      ${relatedLinks(['/about/', '/methodology/', '/contact/', '/partners/'])}`,
  });

  const listId = `${ctx.abs(path)}#editions`;
  return {
    title: live.title || `${page.title} | System Compare US`,
    description: live.description || page.description,
    body,
    breadcrumbs: [{ name: stripSuffix(live.title) || page.title, url: path }],
    pageType: 'CollectionPage',
    pageExtra: { mainEntity: { '@id': listId } },
    jsonld: [
      {
        '@type': 'ItemList',
        '@id': listId,
        name: 'System Compare country editions',
        numberOfItems: editions.length,
        itemListOrder: 'https://schema.org/ItemListUnordered',
        itemListElement: editions.map((e, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: { '@type': 'WebSite', name: `System Compare ${e.name}`, url: e.url, ...(localeOf(e) ? { inLanguage: localeOf(e) } : {}) },
        })),
      },
    ],
  };
}
