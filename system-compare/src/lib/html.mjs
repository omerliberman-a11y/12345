// Tiny auto-escaping HTML tagged template. Every interpolated value is escaped
// unless it is a Raw (the result of html`` or raw()). Arrays are joined,
// null/undefined/booleans render as nothing.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

/** Mark a string as trusted HTML (use only for markup we generated or for the publisher's own page HTML). */
export const raw = (s) => new Raw(s == null ? '' : String(s));

function val(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/** Render an attribute map: attrs({href:'/x', hidden:true, title:null}) → ` href="/x" hidden` */
export const attrs = (obj) =>
  raw(
    Object.entries(obj || {})
      .filter(([, v]) => v != null && v !== false)
      .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
      .join(''),
  );

/** classnames helper */
export const cx = (...a) => a.flat(Infinity).filter(Boolean).join(' ');

/** Join rendered fragments with a separator (separator is escaped unless Raw). */
export const join = (items, sep = '') => raw(items.map(val).join(val(sep)));

/** Strip tags → plain text (for meta descriptions, search index, JSON-LD text). */
export const text = (h) =>
  String(h instanceof Raw ? h.s : h == null ? '' : h)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Truncate plain text at a word boundary. */
export function clip(s, max) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, '') + '…';
}

/** JSON for embedding inside a <script> tag (prevents </script> and HTML comment breakouts). */
export const jsonForScript = (obj) =>
  raw(JSON.stringify(obj).replace(/</g, '\\u003c').replace(/ /g, '\\u2028').replace(/ /g, '\\u2029'));
