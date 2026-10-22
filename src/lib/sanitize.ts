// Input sanitization utilities for PACT

const MAX_AGENT_NAME_LENGTH = 128;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_CONTENT_LENGTH = 50000;
const MAX_REASON_LENGTH = 1000;

const isTagStart = (c: number): boolean =>
  (c >= 0x41 && c <= 0x5a) || // A-Z
  (c >= 0x61 && c <= 0x7a) || // a-z
  c === 0x21 || // !  (comment, doctype)
  c === 0x2f || // /  (end tag)
  c === 0x3f; //   ?  (processing instruction)

/**
 * Strip HTML tags (XSS defence in depth; every in-repo render path is
 * React-escaped text, but API consumers may not be).
 *
 * tailor-group#7 (CodeQL js/incomplete-multi-character-sanitization):
 *   1. Remove every "<…>" span — the same result as the former
 *      `input.replace(/<[^>]*>/g, "")`, but as a linear scan. The regex
 *      rescanned to the end of the input from every unclosed "<", which was
 *      quadratic: ~26 s for a 256 KB body of "<" (DEFAULT_MAX_BODY_BYTES), and
 *      it runs before the length check.
 *   2. After (1) a "<" survives only when no ">" follows it anywhere, e.g. the
 *      "<script" in "a <script". Drop any run of "<" directly followed by a
 *      letter, "!", "/" or "?", so nothing that could open a tag, comment or
 *      declaration remains. Other "<" (e.g. "n < 5", "x <= y") are kept.
 * Both passes are single-pass and neither can create a new "<": the output is
 * a fixed point (stripHtml(stripHtml(x)) === stripHtml(x)).
 */
export function stripHtml(input: string): string {
  let text = "";
  let from = 0;
  for (;;) {
    const open = input.indexOf("<", from);
    if (open === -1) break;
    const close = input.indexOf(">", open + 1);
    if (close === -1) break; // no ">" after this "<", so none after any later "<"
    text += input.slice(from, open);
    from = close + 1;
  }
  text += input.slice(from);

  let out = "";
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;
    let runEnd = lt;
    while (runEnd < text.length && text.charCodeAt(runEnd) === 0x3c) runEnd++;
    const opensTag = runEnd < text.length && isTagStart(text.charCodeAt(runEnd));
    out += text.slice(i, opensTag ? lt : runEnd);
    i = runEnd;
  }
  return out + text.slice(i);
}

// Remove null bytes and other control characters (except newlines/tabs in content)
function stripControlChars(input: string, allowNewlines = false): string {
  if (allowNewlines) {
    // Allow \n, \r, \t but strip everything else
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }
  // Strip all control characters including null bytes
  return input.replace(/[\x00-\x1F\x7F]/g, "");
}

/**
 * Sanitize agent name:
 * - Strip HTML tags (XSS prevention)
 * - Remove null bytes and control characters
 * - Trim whitespace
 * - Enforce max length
 * - Must be non-empty after sanitization
 */
export function sanitizeAgentName(name: string): { valid: boolean; sanitized: string; error?: string } {
  if (typeof name !== "string") {
    return { valid: false, sanitized: "", error: "agentName must be a string" };
  }

  let sanitized = name;

  // Strip null bytes and control characters first
  sanitized = stripControlChars(sanitized, false);

  // Strip HTML tags
  sanitized = stripHtml(sanitized);

  // Trim whitespace
  sanitized = sanitized.trim();

  // Collapse multiple spaces into one
  sanitized = sanitized.replace(/\s+/g, " ");

  if (sanitized.length === 0) {
    return { valid: false, sanitized: "", error: "agentName is empty after sanitization" };
  }

  if (sanitized.length > MAX_AGENT_NAME_LENGTH) {
    return { valid: false, sanitized: "", error: `agentName exceeds max length of ${MAX_AGENT_NAME_LENGTH} characters` };
  }

  // Reject names that are only special characters or look suspicious
  if (/^[^a-zA-Z0-9]+$/.test(sanitized)) {
    return { valid: false, sanitized: "", error: "agentName must contain at least one alphanumeric character" };
  }

  return { valid: true, sanitized };
}

/**
 * Sanitize text content (proposals, summaries, reasons):
 * - Strip HTML tags
 * - Remove null bytes (but allow newlines/tabs)
 * - Trim whitespace
 * - Enforce max length
 */
export function sanitizeContent(content: string, maxLength = MAX_CONTENT_LENGTH): { valid: boolean; sanitized: string; error?: string } {
  if (typeof content !== "string") {
    return { valid: false, sanitized: "", error: "Content must be a string" };
  }

  let sanitized = content;
  sanitized = stripControlChars(sanitized, true);
  sanitized = stripHtml(sanitized);
  sanitized = sanitized.trim();

  if (sanitized.length === 0) {
    return { valid: false, sanitized: "", error: "Content is empty after sanitization" };
  }

  if (sanitized.length > maxLength) {
    return { valid: false, sanitized: "", error: `Content exceeds max length of ${maxLength} characters` };
  }

  return { valid: true, sanitized };
}

/**
 * Sanitize summary text (shorter limit)
 */
export function sanitizeSummary(summary: string): { valid: boolean; sanitized: string; error?: string } {
  return sanitizeContent(summary, MAX_SUMMARY_LENGTH);
}

/**
 * Sanitize reason text (shorter limit)
 */
export function sanitizeReason(reason: string): { valid: boolean; sanitized: string; error?: string } {
  return sanitizeContent(reason, MAX_REASON_LENGTH);
}

/**
 * Validate TTL within bounds
 */
const MIN_TTL = 30;
const MAX_TTL = 86400;

export function validateTTL(ttl: unknown): { valid: boolean; value: number; error?: string } {
  if (ttl === undefined || ttl === null) {
    return { valid: true, value: 300 }; // default 5 minutes
  }

  const num = Number(ttl);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { valid: false, value: 300, error: "TTL must be an integer" };
  }

  if (num < MIN_TTL) {
    return { valid: false, value: 300, error: `TTL must be at least ${MIN_TTL} seconds` };
  }

  if (num > MAX_TTL) {
    return { valid: false, value: 300, error: `TTL must not exceed ${MAX_TTL} seconds (24 hours)` };
  }

  return { valid: true, value: num };
}
