// Site-level settings for the System Compare (US edition) static build.
// Everything here is a product decision the owner may want to change without touching templates.

export default {
  origin: 'https://system-compare.com',
  name: 'System Compare',
  editionName: 'System Compare US',
  tagline: 'Choose software with confidence.',
  lang: 'en-US',
  locale: 'en_US',
  country: 'United States',
  currency: 'USD',
  themeColor: '#4a3aff',
  publisher: {
    legalName: 'CLICSYNC LTD',
    companyNumber: '515343549',
    street: '9 Tversky Street',
    city: 'Tel Aviv-Yafo',
    postalCode: '6721010',
    countryCode: 'IL',
    supportEmail: 'support@system-compare.com',
    partnersEmail: 'partnerships@system-compare.com',
  },

  // Verification tags are emitted byte-for-byte as the live site serves them.
  verificationMetaHtml:
    '<meta name="5734a8eb53bdcd4" content="9fc1231f4ab88c8afcbadbb3e5d856b7" />' +
    '<meta name="impact-site-verification" value="c3dee32d-33bb-4a2f-a830-d74ada451653">' +
    '<meta name="msvalidate.01" content="0CA2714E2C757ACA8D0690F187E8F7F1">',

  // Google Analytics 4 — loaded only after explicit opt-in and only on the production hostname.
  analytics: { ga4Id: 'G-1PS558T592', productionHost: 'system-compare.com' },

  // Which pages search engines may index.
  //   'parity' — exactly the live site's policy (255 indexable URLs). Safe default for launch.
  //   'gated'  — additionally index generated /vs/ pages and /alternatives/ pages that pass the
  //              data-quality gates in src/lib/indexing.mjs (pages with enough scored, differing data).
  indexPolicy: 'parity',

  // How "Visit vendor" / pricing links are written.
  //   'go'     — /go/{vendorId}/?intent=…&from=…  (the live redirect service; keeps affiliate tracking)
  //   'direct' — the vendor's own URL (for previews on hosts where /go/ does not exist)
  outbound: 'go',

  // External services the static pages talk to (unchanged from the live site).
  contactEndpoint: 'https://systemcompare.co.il/wp-json/systemcompare-contact/v1/',

  // Home page editorial picks (same selections the live home page uses).
  home: {
    featuredCategories: ['crm', 'email-marketing', 'accounting', 'project-management', 'payroll', 'customer-service', 'ecommerce-platforms', 'endpoint-security'],
    popularSearches: ['CRM', 'Email marketing', 'Accounting', 'Payroll', 'Help desk', 'Project management'],
  },

  // Sponsored partner call-outs on category pages (advertisers are not ranked products).
  categoryPartners: {
    'customer-service': { name: 'Trengo', label: 'Book a Trengo demo', url: 'https://trengo.com/getdemo?kfl_ln=clicsync-ltd' },
    'whatsapp-business': { name: 'Trengo', label: 'Book a Trengo demo', url: 'https://trengo.com/getdemo?kfl_ln=clicsync-ltd' },
    'web-hosting': { name: 'Cloudways', label: 'Visit Cloudways', url: 'https://www.awin1.com/cread.php?awinmid=89935&awinaffid=3126927' },
    'vpn-security': { name: 'BelkaVPN', label: 'Visit BelkaVPN', url: 'https://www.awin1.com/cread.php?awinmid=129301&awinaffid=3126927&ued=https%3A%2F%2Fbelkavpn.com%2F' },
  },
};
