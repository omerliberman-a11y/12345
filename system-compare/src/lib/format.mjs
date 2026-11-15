// Formatting helpers shared by the build context, answers and templates.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-11-05' or ISO timestamp → 'Nov 5, 2026' (no timezone drift: the date part is used as written). */
export function fmtDate(iso, { long = false } = {}) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const name = (long ? MONTHS_LONG : MONTHS)[Number(m[2]) - 1];
  return `${name} ${Number(m[3])}, ${m[1]}`;
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
    maximumFractionDigits: whole ? 0 : categoryId === 'sms-marketing' ? 4 : 2,
  }).format(amount);
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const listText = (items, conj = 'and') =>
  items.length <= 1 ? items.join('') : items.length === 2 ? items.join(` ${conj} `) : `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;

/**
 * "Plus" → "Plus plan"; names that already carry their noun ("Base plan", "Starter Suite", "Configured plan")
 * are left alone; lists ("Free, Starter, Professional and Enterprise") become "… plans".
 */
export function planLabel(plan) {
  const p = String(plan || '').trim();
  if (!p) return '';
  if (/\b(plan|plans|tier|tiers|edition|package|suite|bundle|subscription|offer)\b/i.test(p)) return p;
  if (/,|\band\b|\bor\b|\//i.test(p)) return `${p} plans`;
  return `${p} plan`;
}
