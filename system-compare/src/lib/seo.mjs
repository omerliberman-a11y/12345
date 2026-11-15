// SEO + structured-data helpers shared by every page module.
//
// Rules baked in here (see docs/SEO-GEO.md):
//  - titles ≤ 60 chars, descriptions ≤ 155 chars, picked from the first variant that fits
//  - one JSON-LD @graph per page: Organization + WebSite(SearchAction) + page node + BreadcrumbList
//  - the documented-fit score is NEVER marked up as a rating/review (it is not a customer rating)

import { clip } from './html.mjs';

const BR_US = ' | System Compare US';
const BR = ' | System Compare';

export const fits = (variants, max) => variants.filter(Boolean).find((v) => v.length <= max);

/** <title>: first variant that fits 60 chars; `year` is the year of the latest evidence date on the page. */
export function title(core, year) {
  const y = year ? String(year).slice(0, 4) : '';
  return (
    fits([y && `${core} (${y})${BR_US}`, `${core}${BR_US}`, y && `${core} (${y})${BR}`, `${core}${BR}`, y && `${core} (${y})`, core], 60) ||
    clip(core, 60)
  );
}

/** Meta description: first variant ≤ 155 chars, else the last one clipped at a word boundary. */
export function describe(variants, max = 155) {
  const list = variants.filter(Boolean);
  return fits(list, max) || clip(list[list.length - 1] || '', max);
}

export function createSeo(ctx) {
  const { site, abs } = ctx;
  const ORG_ID = `${site.origin}/#publisher`;
  const SITE_ID = `${site.origin}/#website`;
  const PERSON_ID = `${site.origin}/editorial-policy/#approver`;
  const approver = ctx.catalog.researchApprover || null;

  const orgNode = (full = false) => {
    const node = {
      '@type': 'Organization',
      '@id': ORG_ID,
      name: site.name,
      legalName: site.publisher.legalName,
      url: `${site.origin}/`,
      logo: { '@type': 'ImageObject', '@id': `${site.origin}/#logo`, url: `${site.origin}/brand/logo-512.png`, width: 512, height: 512 },
      publishingPrinciples: `${site.origin}/editorial-policy/`,
      correctionsPolicy: `${site.origin}/corrections/`,
      ownershipFundingInfo: `${site.origin}/how-we-make-money/`,
    };
    if (full) {
      const live = ctx.content.staticServer.organization_jsonld_home_only || {};
      Object.assign(node, {
        alternateName: live.alternateName || ['SystemCompare', 'System-Compare', 'CLICXY'],
        address: {
          '@type': 'PostalAddress',
          streetAddress: site.publisher.street,
          addressLocality: site.publisher.city,
          postalCode: site.publisher.postalCode,
          addressCountry: site.publisher.countryCode,
        },
        identifier: { '@type': 'PropertyValue', name: 'Company number', value: site.publisher.companyNumber },
        contactPoint: { '@type': 'ContactPoint', email: site.publisher.supportEmail, contactType: 'customer support' },
        actionableFeedbackPolicy: `${site.origin}/corrections/`,
        sameAs: live.sameAs || [],
      });
    }
    return node;
  };

  const websiteNode = () => ({
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: site.editionName,
    alternateName: site.name,
    url: `${site.origin}/`,
    inLanguage: site.lang,
    publisher: { '@id': ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site.origin}/search/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  });

  /** The accountable person (publication approver). Use as `accountablePerson`, never as author/reviewer. */
  const personNode = () =>
    approver && {
      '@type': 'Person',
      '@id': PERSON_ID,
      name: approver.name,
      jobTitle: approver.role,
      worksFor: { '@id': ORG_ID },
      url: `${site.origin}/editorial-policy/`,
    };
  const accountable = () => (approver ? { '@id': PERSON_ID } : undefined);

  const pageId = (path) => `${abs(path)}#page`;

  /** Breadcrumbs: [{name, url}] WITHOUT Home; the last item is the current page. */
  const breadcrumbNode = (path, crumbs) => ({
    '@type': 'BreadcrumbList',
    '@id': `${abs(path)}#breadcrumb`,
    itemListElement: [{ name: 'Home', url: '/' }, ...crumbs].map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.url || path),
    })),
  });

  const pageNode = ({ path, name, description, type = 'WebPage', dateModified, datePublished, image, hasCrumbs = true, extra = {} }) => {
    const node = {
      '@type': type,
      '@id': pageId(path),
      url: abs(path),
      name,
      description,
      inLanguage: site.lang,
      isPartOf: { '@id': SITE_ID },
      publisher: { '@id': ORG_ID },
    };
    if (hasCrumbs) node.breadcrumb = { '@id': `${abs(path)}#breadcrumb` };
    if (dateModified) node.dateModified = dateModified;
    if (datePublished) node.datePublished = datePublished;
    if (image) node.primaryImageOfPage = { '@type': 'ImageObject', url: abs(image.url), ...(image.width ? { width: image.width, height: image.height } : {}) };
    return { ...node, ...extra };
  };

  /** Ranked or plain list. items: [{name, url, description?}] in display order. */
  const itemListNode = (path, items, { id = '#primary-list', name, ordered = true } = {}) => ({
    '@type': 'ItemList',
    '@id': `${abs(path)}${id}`,
    ...(name ? { name } : {}),
    numberOfItems: items.length,
    itemListOrder: ordered ? 'https://schema.org/ItemListOrderDescending' : 'https://schema.org/ItemListUnordered',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: abs(it.url),
    })),
  });

  /** FAQ node. faqs: [{q, a}] where `a` is the plain visible answer text. */
  const faqNode = (path, faqs, { id = '#faq' } = {}) => ({
    '@type': 'FAQPage',
    '@id': `${abs(path)}${id}`,
    isPartOf: { '@id': pageId(path) },
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  });

  /**
   * SoftwareApplication for a vendor profile. No rating/review properties — the documented-fit score
   * is documentation coverage, not a customer rating. `offers` only for a verified, non-zero-base price.
   */
  function softwareNode(vendor, { path = ctx.url.software(vendor.id), categoryNames = [], featureList = [] } = {}) {
    const p = ctx.price(vendor);
    const node = {
      '@type': 'SoftwareApplication',
      '@id': `${abs(path)}#software`,
      name: vendor.name,
      description: vendor.description,
      url: vendor.url,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      mainEntityOfPage: { '@id': pageId(path) },
    };
    if (categoryNames.length) node.applicationSubCategory = categoryNames.join(', ');
    if (featureList.length) node.featureList = featureList;
    if (vendor.logo?.path) node.image = abs(vendor.logo.path);
    const zeroBase = p.amount === 0 && vendor.pricing?.model === 'mixed';
    if (p.hasAmount && p.currency && !zeroBase && !p.smsUnverified) {
      node.offers = {
        '@type': 'Offer',
        price: String(p.amount),
        priceCurrency: p.currency,
        ...(p.plan ? { name: p.plan } : {}),
        ...(p.unit ? { description: `${p.headline} ${p.unit}${p.billingNote ? ', ' + p.billingNote : ''}` } : {}),
        ...(p.sourceUrl ? { url: p.sourceUrl } : {}),
      };
    }
    return node;
  }

  /** The score as a neutral Observation (never emitted for a pending score). */
  function scoreObservation(vendor, category) {
    const s = ctx.score(category.id, vendor.id);
    if (!s || s.pending) return null;
    return {
      '@type': 'Observation',
      '@id': `${abs(ctx.url.software(vendor.id))}#fit-${category.id}`,
      name: `Documented-fit score of ${vendor.name} in ${category.name}`,
      observationAbout: { '@id': `${abs(ctx.url.software(vendor.id))}#software` },
      measuredProperty: { '@id': `${site.origin}/methodology/#documented-fit-score` },
      value: s.value,
      minValue: 0,
      maxValue: 100,
      ...(s.checkedAt ? { observationDate: s.checkedAt } : {}),
      measurementMethod: `${site.origin}/methodology/`,
      description: `${s.value}/100. ${s.coverageText}. Share of the ${category.name} checklist documented in official sources. Not a customer rating, review or performance test.`,
    };
  }

  const articleNode = ({ path, headline, description, datePublished, dateModified, image, about = [], citation = [] }) => ({
    '@type': 'Article',
    '@id': `${abs(path)}#article`,
    headline: clip(headline, 110),
    description,
    inLanguage: site.lang,
    mainEntityOfPage: { '@id': pageId(path) },
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
    ...(accountable() ? { accountablePerson: accountable() } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(image ? { image: abs(image) } : {}),
    ...(about.length ? { about } : {}),
    ...(citation.length ? { citation } : {}),
  });

  return {
    title,
    describe,
    fits,
    ORG_ID,
    SITE_ID,
    PERSON_ID,
    pageId,
    orgNode,
    websiteNode,
    personNode,
    accountable,
    pageNode,
    breadcrumbNode,
    itemListNode,
    faqNode,
    softwareNode,
    scoreObservation,
    articleNode,
  };
}
