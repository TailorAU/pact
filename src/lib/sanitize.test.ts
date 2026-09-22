/**
 * tailor-group#7 — stripHtml / sanitizeContent after the CodeQL
 * js/incomplete-multi-character-sanitization fix (sanitize.ts:10).
 */
import { describe, expect, it } from "vitest";
import { sanitizeAgentName, sanitizeContent, stripHtml } from "./sanitize";

// The pre-fix implementation, as an oracle for pass 1.
const oldStripHtml = (s: string) => s.replace(/<[^>]*>/g, "");

describe("stripHtml", () => {
  it("removes complete tags exactly as before", () => {
    expect(stripHtml("<b>bold</b> text")).toBe("bold text");
    expect(stripHtml("<scr<script>ipt>alert(1)")).toBe("ipt>alert(1)");
    expect(stripHtml("a < b and c > d")).toBe("a  d");
  });

  it("leaves no tag opener behind when a '<' has no closing '>'", () => {
    expect(stripHtml("hello <script")).toBe("hello script");
    expect(stripHtml("x <<<img src=x onerror=alert(1)")).toBe("x img src=x onerror=alert(1)");
    expect(stripHtml("<!-- c")).toBe("!-- c");
    expect(stripHtml("</div")).toBe("/div");
    expect(stripHtml("<?xml")).toBe("?xml");
  });

  it("keeps a '<' that cannot open a tag", () => {
    expect(stripHtml("n < 5")).toBe("n < 5");
    expect(stripHtml("x <= y; 3<4")).toBe("x <= y; 3<4");
    expect(stripHtml("trailing <")).toBe("trailing <");
  });

  // Deterministic PRNG over an alphabet dense in '<', '>' and tag starts.
  const prng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const ALPHABET = ["<", "<", ">", "s", "script", "/", "!", "?", " ", "1", "=", "a"];

  it("never leaves a tag opener, is a fixed point, and agrees with the old pass when no '<' survives it", () => {
    const rnd = prng(3);
    for (let i = 0; i < 5000; i++) {
      const s = Array.from({ length: Math.floor(rnd() * 16) }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join("");
      const out = stripHtml(s);
      expect(out, s).not.toMatch(/<[A-Za-z!/?]/);
      expect(stripHtml(out), s).toBe(out);
      if (!oldStripHtml(s).includes("<")) expect(out, s).toBe(oldStripHtml(s));
    }
  });

  it("is linear on a request-sized body of unclosed '<'", () => {
    const body = "<".repeat(256 * 1024); // DEFAULT_MAX_BODY_BYTES
    const t0 = performance.now();
    const out = stripHtml(body);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(out).toBe(body);
  });
});

describe("sanitizeContent / sanitizeAgentName", () => {
  it("strip unterminated tag openers", () => {
    expect(sanitizeContent("see <script").sanitized).toBe("see script");
    expect(sanitizeAgentName("bot<img").sanitized).toBe("botimg");
  });

  it("keep comparison text", () => {
    expect(sanitizeContent("if n < 5 then").sanitized).toBe("if n < 5 then");
  });
});
