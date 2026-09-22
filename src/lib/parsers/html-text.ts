/**
 * tailor-group#7 — small, linear-time HTML-to-text helpers for the
 * legislation parsers. No regex backtracking, no chained replacements.
 *
 * CodeQL findings these replace (paths as on rehome-review):
 *   - qld-parser.ts:162 js/incomplete-multi-character-sanitization and
 *     qld-parser.ts:164 js/bad-tag-filter: `<script[^>]*>[\s\S]*?<\/script>`
 *     missed `</script >`, `</SCRIPT foo>` and unterminated elements, and a
 *     removal could splice a new `<script` together from its neighbours.
 *   - cth-parser.ts:116 and qld-parser.ts:181 js/double-escaping: chained
 *     `.replace(/&amp;/…).replace(/&lt;/…)` decoded `&amp;lt;` twice, to "<".
 */

const isAsciiAlnum = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/** ASCII case-insensitive `s.startsWith(word, at)`; `word` must be lowercase. */
function startsWithCI(s: string, at: number, word: string): boolean {
  if (at + word.length > s.length) return false;
  for (let k = 0; k < word.length; k++) {
    let c = s.charCodeAt(at + k);
    if (c >= 0x41 && c <= 0x5a) c += 0x20;
    if (c !== word.charCodeAt(k)) return false;
  }
  return true;
}

/**
 * `<name` (or `</name` when `close`) at `at`, not followed by an ASCII letter
 * or digit — so `<script>`, `<SCRIPT type=x>`, `</script >`, `<script/` and a
 * `<script` at end of input all count, while `<scripts>` does not. Treating any
 * non-alphanumeric follower as a boundary is deliberately broader than the
 * HTML tokenizer: nothing that could begin such an element survives.
 */
function tagAt(s: string, at: number, name: string, close: boolean): boolean {
  const prefix = close ? `</${name}` : `<${name}`;
  if (!startsWithCI(s, at, prefix)) return false;
  const next = at + prefix.length;
  return next >= s.length || !isAsciiAlnum(s.charCodeAt(next));
}

/**
 * Remove raw-text elements (`script`, `style`, …) and their contents in one
 * linear pass. Each element runs from its start tag to the end (`>`) of the
 * first matching end tag, whatever its case, whitespace or attributes; an
 * element with no end tag runs to the end of input, as it does in a browser.
 *
 * Each removed element is replaced by a single space rather than nothing, so
 * the text on either side can never join into a new tag: `<scr<script>…
 * </script>ipt>` yields `<scr ipt>`, not `<script>`. Callers here collapse
 * whitespace and strip remaining tags to spaces afterwards, so the extra space
 * does not change their output. After this function, no `<name` followed by a
 * non-alphanumeric character (or end of input) remains for any given name.
 */
export function stripRawTextElements(html: string, names: readonly string[]): string {
  const lower = names.map((n) => n.toLowerCase());
  let out = "";
  let from = 0;
  let pos = 0;
  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) break;
    const name = lower.find((n) => tagAt(html, lt, n, false));
    if (name === undefined) {
      pos = lt + 1;
      continue;
    }
    // Find the matching end tag, then the ">" that closes it.
    let end = html.length;
    let search = lt + 1 + name.length;
    for (;;) {
      const candidate = html.indexOf("</", search);
      if (candidate === -1) break;
      if (tagAt(html, candidate, name, true)) {
        const gt = html.indexOf(">", candidate + 2 + name.length);
        end = gt === -1 ? html.length : gt + 1;
        break;
      }
      search = candidate + 2;
    }
    out += html.slice(from, lt) + " ";
    from = end;
    pos = end;
  }
  return out + html.slice(from);
}

/** A numeric character reference's code point, or U+FFFD when it has none. */
export function codePointOrReplacement(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(n);
}

const CTH_NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * CTH EPUB entity decoding (the EPUB uses `&#xa0;` heavily): hex and decimal
 * numeric references plus nbsp/amp/lt/gt/quot/apos, then U+00A0 → space.
 *
 * One pass over the input, so a decoded "&" is never decoded again:
 * `&amp;lt;` is the literal text "&lt;", not "<" (js/double-escaping). A
 * numeric reference outside Unicode yields U+FFFD instead of throwing.
 */
export function decodeCthEntities(s: string): string {
  return s
    .replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(nbsp|amp|lt|gt|quot|apos));/g, (_m, hex?: string, dec?: string, named?: string) => {
      if (hex !== undefined) return codePointOrReplacement(parseInt(hex, 16));
      if (dec !== undefined) return codePointOrReplacement(parseInt(dec, 10));
      return CTH_NAMED[named as string];
    })
    .replace(/\u00a0/g, " ");
}

const QLD_NAMED: Record<string, string> = {
  nbsp: " ",
  "#xa0": " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
};

/**
 * QLD section-content entity decoding: nbsp / `&#xa0;` → space, amp/lt/gt/quot
 * decoded, and every other decimal numeric reference → space (the QLD parser
 * has always blanked those rather than decode them).
 *
 * One pass over the input, so `&amp;lt;` stays the literal text "&lt;" and
 * `&amp;#160;` stays "&#160;" (js/double-escaping).
 */
export function decodeQldEntities(s: string): string {
  return s.replace(/&(nbsp|#xa0|amp|lt|gt|quot|#\d+);/g, (_m, ref: string) => QLD_NAMED[ref] ?? " ");
}
