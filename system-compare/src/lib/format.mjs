// Formatting helpers shared by the build context, answers and templates.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-11-05' or ISO timestamp → 'Nov 5, 2026' (no timezone drift: the date part is used as written).
 *  { nbsp: true } joins the parts with no-break spaces, so a printed date never wraps away from its year — for the
 *  visible text of a <time> only (ui.time, ui.dated); text that goes into JSON-LD, meta tags, feeds, llms files or
 *  data files keeps plain spaces. */
export function fmtDate(iso, { long = false, nbsp = false } = {}) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const name = (long ? MONTHS_LONG : MONTHS)[Number(m[2]) - 1];
  const sp = nbsp ? '\xa0' : ' ';
  return `${name}${sp}${Number(m[3])},${sp}${m[1]}`;
}
export const isoDate = (iso) => (String(iso || '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
export const maxDate = (...dates) => dates.flat().map(isoDate).filter(Boolean).sort().pop() || null;

/** Money without a trailing ".00": $35, $9.50, $0.0083, €119, $30,000 */
export function fmtMoney(amount, currency = 'USD', categoryId) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
  const whole = Number.isInteger(Number(amount));
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    // per-message and per-minute rates below ten cents keep up to four decimals ($0.0083), everything else two
    maximumFractionDigits: whole ? 0 : categoryId === 'sms-marketing' || Math.abs(Number(amount)) < 0.1 ? 4 : 2,
  }).format(amount);
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const listText = (items, conj = 'and') =>
  items.length <= 1 ? items.join('') : items.length === 2 ? items.join(` ${conj} `) : `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;

/**
 * "Plus" → "Plus plan". Names that already carry their noun ("Base plan", "Starter Suite", "Free and paid CRM
 * editions") are left alone; real lists ("Free, Starter, Professional and Enterprise", "Basic / Core / Plus")
 * become "… plans"; a name with a qualifier ("Starter, 5,000 emails", "Premium — displayed renewal") is one
 * plan and is quoted so the sentence stays readable. A slash inside a word ("Essentials AP/AR") is not a list.
 */
export function planLabel(plan) {
  const p = String(plan || '').trim();
  if (!p) return '';
  if (/\b(plans?|tiers?|editions?|packages?|packs?|suites?|bundles?|subscriptions?|offers?)\b/i.test(p)) return p;
  const isList = / \/ | and | or /i.test(p) || p.split(/, (?=\D)/).length > 2;
  if (isList) return `${p} plans`;
  if (/, | — | \+ /.test(p)) return `“${p}” plan`;
  return `${p} plan`;
}

/**
 * A plan or offer name without the product name it repeats, for printing right after that product name:
 * dropNamePrefix("Adobe Firefly", "Firefly Standard — individual") → "Standard — individual";
 * dropNamePrefix("WooCommerce", "WooCommerce core") → "core"; no overlap → the text unchanged.
 */
export function dropNamePrefix(name, text) {
  const words = String(name || '').trim().split(/\s+/);
  const rest = String(text || '').trim();
  for (let i = 0; i < words.length; i++) {
    const tail = words.slice(i).join(' ');
    if (tail && rest.toLowerCase().startsWith(tail.toLowerCase()) && (rest.length === tail.length || /[\s,:—–-]/.test(rest[tail.length]))) {
      return rest.slice(tail.length).replace(/^[\s,:—–-]+/, '');
    }
  }
  return rest;
}
