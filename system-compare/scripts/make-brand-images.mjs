#!/usr/bin/env node
// Renders the raster brand assets from the SVG mark (run when the brand changes):
//   src/assets/static/brand/logo-512.png, apple-touch-icon.png, icon-192.png, icon-512.png
//   src/assets/static/assets/social-preview.png (1200×630 Open Graph image)
// Needs Playwright with Chromium available (not required for a normal build).
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATIC = path.join(ROOT, 'src/assets/static');
const mark = await readFile(path.join(STATIC, 'brand/icon.svg'), 'utf8');
const rubik = (await readFile(path.join(STATIC, 'assets/fonts/rubik-latin.woff2'))).toString('base64');
const inter = (await readFile(path.join(STATIC, 'assets/fonts/inter-latin.woff2'))).toString('base64');
const fonts = `@font-face{font-family:R;font-weight:500 800;src:url(data:font/woff2;base64,${rubik})}@font-face{font-family:I;font-weight:100 900;src:url(data:font/woff2;base64,${inter})}`;

const browser = await chromium.launch();
async function shot(file, width, height, body, css = '') {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>${fonts}*{margin:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px}${css}</style>${body}`);
  await page.evaluate(() => document.fonts.ready);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: false });
  await page.close();
  console.log('wrote', path.relative(ROOT, file));
}
const icon = (size, pad, radius = 0) =>
  [`body{display:grid;place-items:center;background:#fff;${radius ? `border-radius:${radius}px;` : ''}}svg{width:${size - pad * 2}px;height:${size - pad * 2}px}`, mark];

for (const [name, size, pad] of [['logo-512.png', 512, 72], ['icon-512.png', 512, 72], ['icon-192.png', 192, 26], ['apple-touch-icon.png', 180, 24]]) {
  const [css, body] = icon(size, pad);
  await shot(path.join(STATIC, 'brand', name), size, size, body, css);
}

await shot(
  path.join(STATIC, 'assets/social-preview.png'),
  1200,
  630,
  `<main><div class="brand">${mark}<span>system<i></i><b>compare</b></span></div>
   <h1>Find the right software.<br><em>Know the trade-offs.</em></h1>
   <p>Capabilities, prices and limits — every claim linked to a dated official source.</p>
   <footer>Research, not star ratings · system-compare.com</footer></main>`,
  `body{background:radial-gradient(900px 420px at 88% -8%,rgba(74,58,255,.16),transparent 62%),radial-gradient(620px 360px at 0% 0%,rgba(255,106,61,.13),transparent 62%),#fff;color:#11131f;font-family:I}
   main{padding:72px 80px;height:100%;display:flex;flex-direction:column}
   .brand{display:flex;align-items:center;gap:16px;font:500 34px R;letter-spacing:-.02em}.brand svg{width:52px;height:52px}.brand b{font-weight:800}.brand i{display:inline-block;width:2px;height:32px;margin:0 14px;background:#c9ccdb;vertical-align:-5px}
   h1{font:700 80px/1.04 R;letter-spacing:-.035em;margin-top:64px}h1 em{font-style:normal;color:#4a3aff}
   p{font-size:30px;line-height:1.4;color:#3a3e50;margin-top:28px;max-width:900px}
   footer{margin-top:auto;font-size:24px;color:#5d6274;font-weight:500}`,
);
await browser.close();
