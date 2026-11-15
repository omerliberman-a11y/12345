// /contact/ — direct e-mail first, then the contact form. The form talks to the same contact service
// as the live site (challenge → wait → submit; see src/assets/js/contact.js); all runtime copy comes
// from the captured server configuration and is passed to the script through #page-data.

import { html, raw } from '../lib/html.mjs';
import * as ui from '../lib/components.mjs';
import { docLayout, relatedLinks, stripSuffix } from './static.mjs';

export function routes() {
  return [{ path: '/contact/', render }];
}

// The published privacy notice says no analytics is loaded on the contact form page. The shared layout
// has no per-page switch, so this inline script runs before the deferred scripts: analytics.js then finds
// no measurement tag and stops (no consent panel, no Google Analytics on this page).

const TOPIC_VALUES = ['general', 'listing', 'partnership', 'correction', 'privacy', 'other'];

function render(ctx) {
  const path = '/contact/';
  const live = ctx.liveHead(path) || {};
  const cfg = ctx.content.staticServer['contact_form_config(data-contact)'];
  const copy = cfg.copy;
  const p = ctx.site.publisher;
  const catalogPage = ctx.pages[path] || {};

  const direct = html`<section class="st-pg-direct" aria-labelledby="direct-h">
    <h2 id="direct-h">Email us directly</h2>
    <dl class="st-pg-direct__list">
      <div>
        <dt>Questions, corrections, privacy</dt>
        <dd><a href="mailto:${p.supportEmail}">${p.supportEmail}</a><small>Include the relevant page URL.</small></dd>
      </div>
      <div>
        <dt>Supplier applications</dt>
        <dd><a href="mailto:${p.partnersEmail}">${p.partnersEmail}</a><small>Or start with the free <a href="/partners/">Partners program</a>.</small></dd>
      </div>
      <div>
        <dt>Publisher</dt>
        <dd>${p.legalName}<small>Israel company ${p.companyNumber}. ${p.street}, ${p.city} ${p.postalCode}, Israel.</small></dd>
      </div>
    </dl>
  </section>`;

  const form = html`<section class="st-pg-form" aria-labelledby="form-h">
    <h2 id="form-h">${copy.intro}</h2>
    <p id="contact-required" class="st-pg-form__note">${copy.requiredNote}</p>
    <form id="sc-contact-form" class="st-pg-form__form" method="post" aria-describedby="contact-required" novalidate data-contact-form>
      <div class="field">
        <label for="contact-name">${copy.name}</label>
        <input class="input" id="contact-name" name="name" autocomplete="name" maxlength="120" required>
      </div>
      <div class="field">
        <label for="contact-email">${copy.email}</label>
        <input class="input" id="contact-email" name="email" type="email" autocomplete="email" maxlength="254" required>
      </div>
      <div class="field">
        <label for="contact-topic">${copy.topic}</label>
        <select class="select" id="contact-topic" name="topic" required>
          ${TOPIC_VALUES.map((v, i) => html`<option value="${v}">${copy.topics[i]}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="contact-message">${copy.message}</label>
        <textarea class="textarea" id="contact-message" name="message" rows="8" maxlength="10000" aria-describedby="contact-sensitive" required></textarea>
        <p id="contact-sensitive" class="hint">${copy.sensitive}</p>
      </div>
      <div class="st-pg-hp" aria-hidden="true">
        <label for="contact-website">Website</label>
        <input id="contact-website" name="website" tabindex="-1" autocomplete="off">
      </div>
      <label class="check st-pg-form__consent" for="contact-consent">
        <input id="contact-consent" name="consent" type="checkbox" required>
        <span>${copy.consent} <a href="/privacy/">${copy.privacy}</a>.</span>
      </label>
      <div class="st-pg-form__send">
        <button class="btn btn--lg" type="submit" disabled>${copy.submit}</button>
        <p id="contact-status" class="st-pg-form__status" role="status" aria-live="polite" tabindex="-1"></p>
      </div>
    </form>
    <noscript><p class="note note--warn">${copy.nojs} <a href="mailto:${p.supportEmail}">${p.supportEmail}</a></p></noscript>
  </section>`;

  const side = html`<aside class="st-pg-side" aria-label="Before you write">
    <h2>Research corrections</h2>
    <p>Include the product, the exact claim, the plan and a supporting official source. <a href="/corrections/">Read the corrections process</a>. Commercial proposals do not change our scoring rules.</p>
    <h2>Supplier applications</h2>
    <p>To propose a new product, use the <a href="/partners/">Partners program</a>. The initial application is free and nonbinding. Messages sent through this general form, including the Partnership topic, go to our central support team; they do not create a Partners application.</p>
    <h2>How your message is handled</h2>
    <p>${copy.notice} <a href="/privacy/">Privacy policy</a></p>
    <p>Describe the request without sending passwords, customer lists or other sensitive account information. See also our <a href="/accessibility/">accessibility information</a>.</p>
  </aside>`;

  const body = html`${docLayout({
    cls: 'doc-layout--contact',
    head: { h1: copy.title, lede: copy.description },
    main: html`${direct}
      <div class="st-pg-contact">${form}${side}</div>
      ${relatedLinks(['/corrections/', '/partners/', '/privacy/', '/faq/'])}`,
  })}`;

  return {
    title: live.title || `${copy.title} | System Compare US`,
    description: live.description || catalogPage.description,
    body,
    breadcrumbs: [{ name: stripSuffix(live.title) || copy.title, url: path }],
    pageType: 'ContactPage',
    analytics: false, // the published privacy text says no optional analytics is loaded on the contact page
    pageExtra: { mainEntity: { '@id': ctx.seo.ORG_ID } },
    fullOrg: true,
    scripts: ['js/contact.js'],
    pageData: {
      contact: {
        endpoint: ctx.site.contactEndpoint,
        site: cfg.site,
        locale: cfg.locale,
        pageUrl: ctx.abs(path),
        copy,
      },
    },
  };
}
