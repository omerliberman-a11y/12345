#!/usr/bin/env node
// Lossless-looking size cut for heavy SVG vendor logos, without dependencies (run after adding logos).
//
// Exported logo paths often carry 3-5 decimals in absolute coordinates (moosend.svg: 85 KB, 10,460 numbers). A logo
// is painted at most ~140 CSS px wide (about 420 device px on a 3x screen), so every coordinate is rounded to a
// step of at most 1/2000 of the viewBox (0.1 unit in a 432-unit logo, 0.01 in a 126-unit one: under 1/20 of a
// device pixel) and each segment is then written in whichever of absolute or
// relative form is shorter. Relative steps are taken between the ROUNDED absolute points, so rounding never
// accumulates along a path. Only path data made of absolute commands without arcs is touched (arc flags would need
// their own parser); every other byte stays as it is. Names and paths are unchanged (the catalog points at them).
//
//   node scripts/optimize-svg-logos.mjs            rewrite files over 8 KB that shrink by at least 10%
//   node scripts/optimize-svg-logos.mjs --dry-run  list them
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'src/assets/static/assets/logos');
const DRY = process.argv.includes('--dry-run');
const MIN_BYTES = 8 * 1024;

/** "0.50" → ".5", "-0.25" → "-.25", "3.0" → "3", "-0" → "0" */
const fmt = (n, decimals) => {
  let s = n.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s.replace(/^(-?)0\./, '$1.');
};

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };
/** Numbers written with the fewest separators ("1 2-3.5.5"). */
const joinNums = (nums, after = '') => {
  let out = '';
  let prev = after;
  for (const s of nums) {
    const glue = prev === '' || /[A-Za-z]$/.test(prev) || s.startsWith('-') || (s.startsWith('.') && /\.\d*$/.test(prev));
    out += (glue ? '' : ' ') + s;
    prev = s;
  }
  return out;
};

/** Absolute, arc-free path data → rounded, shortest absolute/relative form; null when the path is not of that kind. */
function optimizePath(d, decimals) {
  if (/[a-y]/.test(d) || /[Aa]/.test(d) || /[eE]/.test(d)) return null;
  const tokens = d.match(/[MLHVCSQTZz]|-?(?:\d+\.?\d*|\.\d+)/g);
  if (!tokens || tokens.join('').length !== d.replace(/[\s,]+/g, '').length) return null; // something we do not parse
  const round = (v) => Number(Number(v).toFixed(decimals));
  // segments with rounded absolute coordinates
  const segs = [];
  let cmd = null;
  for (let i = 0; i < tokens.length; ) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i++].toUpperCase();
      if (cmd === 'Z') { segs.push({ c: 'Z', a: [] }); continue; }
    }
    if (!cmd || cmd === 'Z') return null; // numbers without a command
    const a = tokens.slice(i, i + ARGS[cmd]);
    if (a.length !== ARGS[cmd] || a.some((t) => /^[A-Za-z]$/.test(t))) return null;
    i += ARGS[cmd];
    segs.push({ c: cmd, a: a.map(round) });
    if (cmd === 'M') cmd = 'L'; // coordinates after a moveto are linetos
  }
  let out = '';
  let last = ''; // the command a bare number list would continue
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const s of segs) {
    if (s.c === 'Z') { out += 'z'; last = ''; cx = sx; cy = sy; continue; }
    const rel = s.c === 'H' ? [s.a[0] - cx] : s.c === 'V' ? [s.a[0] - cy] : s.a.map((v, k) => v - (k % 2 ? cy : cx));
    const absText = joinNums(s.a.map((v) => fmt(v, decimals)), 'X');
    const relText = joinNums(rel.map((v) => fmt(round(v), decimals)), 'X');
    const useRel = relText.length < absText.length;
    const letter = useRel ? s.c.toLowerCase() : s.c;
    const nums = (useRel ? rel.map(round) : s.a).map((v) => fmt(v, decimals));
    if (letter !== last || s.c === 'M') out += letter + joinNums(nums, letter);
    else out += joinNums(nums, out);
    last = s.c === 'M' ? (useRel ? 'l' : 'L') : letter;
    if (s.c === 'H') cx = s.a[0];
    else if (s.c === 'V') cy = s.a[0];
    else { cx = s.a[s.a.length - 2]; cy = s.a[s.a.length - 1]; }
    if (s.c === 'M') { sx = cx; sy = cy; }
  }
  return out;
}

let saved = 0;
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.svg')).sort()) {
  const file = path.join(DIR, f);
  const src = await readFile(file, 'utf8');
  if (Buffer.byteLength(src) < MIN_BYTES) continue;
  // user units span the viewBox, or the width/height of an <svg> that has none
  const vb = src.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/) || src.match(/<svg\b[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/);
  if (!vb) continue;
  const extent = Math.max(Number(vb[1]), Number(vb[2]));
  const decimals = Math.max(0, Math.ceil(Math.log10(2000 / extent))); // steps of 1/2000 of the viewBox or finer
  let changed = false;
  const out = src.replace(/(\sd=")([^"]*)"/g, (m, pre, d) => {
    const r = optimizePath(d, decimals);
    if (r == null) return m;
    changed = true;
    return `${pre}${r}"`;
  });
  const before = Buffer.byteLength(src), after = Buffer.byteLength(out);
  if (!changed || after > before * 0.9) continue;
  saved += before - after;
  console.log(`${f.padEnd(36)} ${String(before).padStart(6)} → ${String(after).padStart(6)} bytes  (${decimals} decimal${decimals === 1 ? '' : 's'}, viewBox ${extent})`);
  if (!DRY) await writeFile(file, out);
}
console.log(`saved ${saved} bytes${DRY ? ' (dry run)' : ''}`);
