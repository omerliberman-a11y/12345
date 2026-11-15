// /faq/ — the site-wide FAQ hub. Answers are condensed from the publisher's own policy pages (src/lib/site-faq.mjs).

import { html, text } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { siteFaq } from '../lib/site-faq.mjs';

export function routes() {
  return [{ path: '/faq/', render }];
}

function render(ctx) {
  const groups = siteFaq(ctx);
  const all = groups.flatMap((g) => g.items);
  const pages = ctx.pages;
  const dateModified = ctx.maxDate(pages['/methodology/']?.modifiedAt, pages['/editorial-policy/']?.modifiedAt, pages['/about/']?.modifiedAt, ctx.catalog.researchUpdatedAt);

  // Popular category questions: one curated question per popular scored category, linking to its FAQ.
  const popular = ['crm', 'email-marketing', 'accounting', 'payroll', 'customer-service', 'project-management', 'hr', 'payments']
    .map((id) => ctx.category(id))
    .filter((c) => c && c.faq?.length)
    .map((c) => ({ href: `${ctx.url.category(c.id)}#faq`, title: c.faq[0].q, meta: c.name }));

  const body = html`<header class="wrap wrap--narrow page-head">
      <h1>Frequently asked questions</h1>
      <p class="lede">How the scores work, where prices and dates come from, how System Compare makes money, and how to report an error.</p>
      ${ui.trustline([
        dateModified ? html`Updated ${ui.time(ctx, dateModified)}` : null,
        html`<a href="/methodology/">How we score</a>`,
        html`<a href="/editorial-policy/">Editorial responsibility</a>`,
        html`<a href="/how-we-make-money/">How we make money</a>`,
      ])}
    </header>
    <div class="wrap wrap--narrow faq-answer">
      ${ui.answer(
        ctx,
        'The documented-fit score is a number from 0 to 100: the weighted share of a category’s checklist that official vendor documentation supports. It is research, not a customer rating or a hands-on test. A product shows “Score pending” until 80% of the checklist weight has been checked. No vendor pays for a score or for placement.',
        { label: 'In short' },
      )}
    </div>
    ${ui.subnav(groups.map((g) => ({ href: `#${g.id}`, label: g.title })))}
    <div class="wrap wrap--narrow faq-page">
      ${groups.map(
        (g) => html`<section class="section" id="${g.id}" aria-labelledby="${g.id}-h">
          <h2 id="${g.id}-h">${g.title}</h2>
          <div class="acc">
            ${g.items.map(
              (it) => html`<details id="${it.id}" open>
                <summary><h3>${it.q}</h3></summary>
                <div class="acc__body"><p>${ui.dated(it.a)}</p>${related(it.id)}</div>
              </details>`,
            )}
          </div>
        </section>`,
      )}
      ${
        popular.length
          ? html`<section class="section" aria-labelledby="catfaq-h">
              <h2 id="catfaq-h">Questions about a specific category</h2>
              <p class="lede">Every scored category page ends with the questions buyers ask about that kind of software.</p>
              ${ui.linkList(popular, { cols: 1 })}
            </section>`
          : ''
      }
      <section class="section" aria-labelledby="more-h">
        <h2 id="more-h">Still have a question?</h2>
        <p class="lede">Search the site, read the full method, or write to us.</p>
        <p class="cluster faq-page__cta"><a class="btn" href="/search/" data-search-open>Search</a><a class="btn btn--ghost" href="/methodology/">How we score</a><a class="btn btn--ghost" href="/contact/">Contact</a></p>
      </section>
    </div>`;

  return {
    title: 'Software scoring & pricing FAQ | System Compare US',
    description: 'Answers about the documented-fit score, score pending, price and evidence dates, affiliate links, corrections and who publishes System Compare US.',
    ogTitle: 'Software scoring & pricing FAQ',
    breadcrumbs: [{ name: 'FAQ', url: '/faq/' }],
    nav: 'methodology',
    pageType: 'FAQPage',
    pageExtra: {
      mainEntity: all.map((it) => ({ '@type': 'Question', '@id': `${ctx.abs('/faq/')}#${it.id}`, name: it.q, acceptedAnswer: { '@type': 'Answer', text: text(it.a) } })),
    },
    dateModified,
    accountable: true,
    body,
  };

  // one "read more" link per answer, to the authoritative policy page
  function related(id) {
    const map = {
      'score-meaning': ['/methodology/#documented-fit-score', 'The full definition'],
      'score-calculation': ['/methodology/', 'Formula and a worked example'],
      'score-pending': ['/methodology/', 'The 80% gate'],
      recommended: ['/methodology/', 'Tie rules'],
      ordering: ['/methodology/', 'Ordering rules'],
      'update-frequency': ['/research-updates/', 'Research updates'],
      'business-model': ['/how-we-make-money/', 'How we make money'],
      'pay-to-rank': ['/editorial-policy/', 'Editorial responsibility'],
      'vendor-links': ['/how-we-make-money/', 'Privacy after you click'],
      'report-error': ['/corrections/', 'Suggest a correction'],
      'get-listed': ['/partners/', 'Partners'],
      publisher: ['/about/', 'About the publisher'],
      'ai-assisted': ['/editorial-policy/', 'Editorial responsibility'],
      coverage: ['/categories/', 'All categories'],
      'price-sources': ['/methodology/', 'How prices are recorded'],
    };
    const m = map[id];
    return m ? html`<p><a class="link-arrow" href="${m[0]}">${m[1]}</a></p>` : '';
  }
}
