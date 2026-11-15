// /feed.xml (RSS 2.0) and /atom.xml (Atom 1.0): the research-updates log as feeds.
//
// Subscriber safety: item GUIDs / entry ids and titles are exactly the ones the previous site published
// ("https://system-compare.com/software/{id}/#{review.id}", "{name} — source review"), so no reader sees
// duplicates. Dates come from review.observedAt only — never from the build time.

import { researchUpdates, FEED_PREFIX } from '../pages/research-updates.mjs';

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const rfc822 = (iso) => new Date(iso).toUTCString(); // "Fri, 06 Nov 2026 06:29:00 GMT"

export async function generate(ctx, emit) {
  const origin = ctx.site.origin;
  const title = `${ctx.site.editionName} research updates`;
  const page = `${origin}/research-updates/`;
  const items = researchUpdates(ctx).map(({ vendor, review }) => {
    const category = ctx.primaryCategory(vendor);
    return {
      title: `${vendor.name} — source review`,
      guid: `${origin}/software/${vendor.id}/#${review.id}`,
      link: `${origin}/software/${vendor.id}/#source-review`,
      observedAt: review.observedAt,
      day: review.observedAt.slice(0, 10),
      summary: `${FEED_PREFIX} ${review.limitations.join(' ')}`,
      category: category ? category.name : '',
    };
  });
  const newest = items.map((i) => i.observedAt).sort().pop();

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(title)}</title>
<link>${xml(page)}</link>
<description>Dated documentary checks and open questions.</description>
<language>${xml(ctx.site.lang)}</language>
${newest ? `<lastBuildDate>${rfc822(newest)}</lastBuildDate>\n` : ''}<atom:link href="${xml(origin)}/feed.xml" rel="self" type="application/rss+xml"/>
${items
  .map(
    (i) => `<item>
<title>${xml(i.title)}</title>
<link>${xml(i.link)}</link>
<guid isPermaLink="false">${xml(i.guid)}</guid>
<pubDate>${rfc822(i.observedAt)}</pubDate>
${i.category ? `<category>${xml(i.category)}</category>\n` : ''}<description>${xml(`${i.day}: ${i.summary}`)}</description>
</item>`,
  )
  .join('\n')}
</channel>
</rss>
`;

  const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(ctx.site.lang)}">
<title>${xml(title)}</title>
<id>${xml(page)}</id>
<link href="${xml(origin)}/atom.xml" rel="self" type="application/atom+xml"/>
<link href="${xml(page)}" rel="alternate" type="text/html"/>
${newest ? `<updated>${xml(newest)}</updated>\n` : ''}<author><name>${xml(ctx.site.name)}</name></author>
${items
  .map(
    (i) => `<entry>
<id>${xml(i.guid)}</id>
<title>${xml(i.title)}</title>
<link href="${xml(i.link)}" rel="alternate" type="text/html"/>
<published>${xml(i.observedAt)}</published>
<updated>${xml(i.observedAt)}</updated>
${i.category ? `<category term="${xml(i.category)}"/>\n` : ''}<summary>${xml(i.summary)}</summary>
</entry>`,
  )
  .join('\n')}
</feed>
`;

  await emit('/feed.xml', rss);
  await emit('/atom.xml', atom);
}
