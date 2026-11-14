#!/usr/bin/env node
// Minimal static file server for previewing a build:  node scripts/serve.mjs [dir=dist] [port=4173]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.resolve(ROOT, process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

http
  .createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(dir, p);
      if (!file.startsWith(dir)) throw Object.assign(new Error('forbidden'), { code: 403 });
      let st = await stat(file).catch(() => null);
      if (st && st.isDirectory()) {
        if (!p.endsWith('/')) {
          res.writeHead(301, { Location: p + '/' });
          return res.end();
        }
        file = path.join(file, 'index.html');
        st = await stat(file).catch(() => null);
      }
      if (!st) {
        const nf = await readFile(path.join(dir, '404.html')).catch(() => 'Not found');
        res.writeHead(404, { 'Content-Type': TYPES['.html'] });
        return res.end(nf);
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(e.code === 403 ? 403 : 500);
      res.end(String(e.message));
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${dir} at http://127.0.0.1:${port}/`));
