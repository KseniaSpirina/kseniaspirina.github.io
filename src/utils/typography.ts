/**
 * Line-break hygiene for project pages (see "Typography rules for project pages - line breaks").
 * Applied to the rendered HTML, so source texts stay clean:
 *  - the last two words of a paragraph / list item are glued with &nbsp; (no one-word last line);
 *  - short function words (a, an, the, to, of, in ...) are glued to the following word;
 *  - hyphenated words are wrapped in <span class="nw"> so they never break at the hyphen.
 * Manual exception: if the last two words are already glued with &nbsp;, the block is left alone.
 */
const NB = '&nbsp;';
const SHORT_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'by', 'or', 'as', 'is', 'it', 'its']);
const P_RE = /<p\b([^>]*\bclass="[^"]*\b(?:text|p-text|ui-text|running)\b[^"]*"[^>]*)>([\s\S]*?)<\/p>/g;
const LIST_RE = /<(ul|ol)\b[^>]*\bclass="[^"]*\b(?:list|ui-list|p-list)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g;
const LI_RE = /<li\b([^>]*)>([\s\S]*?)<\/li>/g;

function wrapHyphens(s: string): string {
  return s
    .split(/(<span class="nw"[^>]*>[\s\S]*?<\/span>|<[^>]+>)/)
    .map((t, i) =>
      i % 2 ? t : t.replace(/[\p{L}\d]+(?:-[\p{L}\d]+)+/gu, (m) => `<span class="nw">${m}</span>`),
    )
    .join('');
}

function processSegment(seg: string): string {
  const s = wrapHyphens(seg);
  const masked = s.replace(/<[^>]*>/g, (t) => '\u0000'.repeat(t.length));
  const gaps: { a: number; b: number }[] = [];
  const re = /\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const a = m.index;
    const b = a + m[0].length;
    if (a === 0 || b === masked.length) continue;
    gaps.push({ a, b });
  }
  // short function words (a, an, the, to, of ...) never stay at the end of a line: glue them to the next word
  const words: string[] = [];
  let prev = 0;
  for (const g of gaps) {
    words.push(s.slice(prev, g.a).replace(/<[^>]+>/g, ''));
    prev = g.b;
  }
  const glue = new Set<number>();
  words.forEach((w, i) => {
    if (SHORT_WORDS.has(w.toLowerCase())) glue.add(i);
  });
  // the last two words of the block
  if (gaps.length + 1 >= 3) {
    const tailStart = gaps[gaps.length - 2].b;
    if (!/&nbsp;|\u00a0/.test(s.slice(tailStart))) glue.add(gaps.length - 1);
  }
  if (!glue.size) return s;
  let out = '';
  let q = 0;
  gaps.forEach((g, i) => {
    out += s.slice(q, g.a) + (glue.has(i) ? NB : s.slice(g.a, g.b));
    q = g.b;
  });
  return out + s.slice(q);
}

// Credits lines: <strong>Role:</strong> First Last, First Last and First Last.
// The first and last name of one person are never split across two lines.
const CREDIT_RE = /^(\s*<strong\b[^>]*>[^<]*:<\/strong>)([\s\S]*)$/;

function glueNames(text: string): string {
  return text
    .split(/(,\s+|\s+and\s+|\s+&amp;\s+)/)
    .map((t, i) => (i % 2 ? t : t.trim() ? t.replace(/(\S)[ \t\r\n]+(?=\S)/g, `$1${NB}`) : t))
    .join('');
}

function processBlock(inner: string): string {
  const credit = inner.match(CREDIT_RE);
  // only real name lists: no sentences, and every comma-separated item is at most 4 words
  const isNameList =
    credit !== null &&
    !/[.!?]/.test(credit[2].replace(/<[^>]+>/g, '')) &&
    credit[2]
      .replace(/<[^>]+>/g, ' ')
      .split(/,|\s+and\s+|\s+&amp;\s+/)
      .every((c) => c.trim().split(/\s+/).filter(Boolean).length <= 4);
  if (credit && isNameList) {
    const rest = credit[2]
      .split(/(<br\s*\/?>)/)
      .map((p) => (/^<br/.test(p) ? p : glueNames(p)))
      .join('');
    return credit[1] + rest;
  }
  return inner
    .split(/(<br\s*\/?>)/)
    .map((p) => (/^<br/.test(p) ? p : processSegment(p)))
    .join('');
}

export function applyTypography(html: string): string {
  let out = html.replace(P_RE, (_all, attrs: string, inner: string) => `<p${attrs}>${processBlock(inner)}</p>`);
  out = out.replace(LIST_RE, (ul: string) =>
    ul.replace(LI_RE, (_a, attrs: string, inner: string) => `<li${attrs}>${processBlock(inner)}</li>`),
  );
  return out;
}

/**
 * Images are never shown wider than their desktop size.
 * The desktop width is the last (non-media-query) value in the img `sizes` attribute, e.g.
 * sizes="(max-width: 1260px) 100vw, 435px" -> max-width: 435px.
 * Without this, stacked layouts (tablet / half-width windows) stretch small images to the full column and blur them.
 */
export function capImageWidths(html: string): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const sizes = tag.match(/\bsizes="([^"]*)"/);
    if (!sizes) return tag;
    const last = sizes[1].split(',').pop()!.trim();
    const m = last.match(/^(\d+(?:\.\d+)?)px$/);
    if (!m) return tag;
    const cap = `max-width:${m[1]}px`;
    if (/\sstyle="/.test(tag)) return tag.replace(/\sstyle="([^"]*)"/, (_a, s: string) => ` style="${s.replace(/;?\s*$/, ';')}${cap}"`);
    return tag.replace(/^<img\b/, `<img style="${cap}"`);
  });
}
