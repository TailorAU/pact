// Input sanitization utilities for PACT Hub

const MAX_AGENT_NAME_LENGTH = 128;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_CONTENT_LENGTH = 50000;
const MAX_REASON_LENGTH = 1000;

// Strip HTML tags to prevent XSS
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
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
