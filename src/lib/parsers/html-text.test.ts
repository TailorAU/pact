/**
 * tailor-group#7 — pins the CodeQL fixes in html-text.ts:
 *   js/double-escaping (cth-parser.ts:116, qld-parser.ts:181),
 *   js/bad-tag-filter and js/incomplete-multi-character-sanitization
 *   (qld-parser.ts:162/:164).
 */
import { describe, expect, it } from "vitest";
import { decodeCthEntities, decodeQldEntities, stripRawTextElements } from "./html-text";

describe("decodeCthEntities — single pass", () => {
  it("decodes each entity once: &amp;lt; is the literal text &lt;, never <", () => {
    expect(decodeCthEntities("a &amp;lt;b&amp;gt; c")).toBe("a &lt;b&gt; c");
    expect(decodeCthEntities("&amp;#60;script&amp;#x3e;")).toBe("&#60;script&#x3e;");
    expect(decodeCthEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeCthEntities("&amp;quot;&amp;apos;&amp;nbsp;")).toBe("&quot;&apos;&nbsp;");
  });

  it("keeps the former decoding for ordinary input", () => {
    expect(decodeCthEntities("A&#xa0;B&nbsp;C D")).toBe("A B C D");
    expect(decodeCthEntities("&lt;&gt;&quot;&apos;&amp;")).toBe(`<>"'&`);
    expect(decodeCthEntities("s&#8217;s &#x2014; &#167;")).toBe("s’s — §");
    expect(decodeCthEntities("&unknown; & &#; &#xg;")).toBe("&unknown; & &#; &#xg;");
  });

  it("yields U+FFFD for an out-of-range numeric reference instead of throwing", () => {
    expect(decodeCthEntities("&#x110000;")).toBe("�");
    expect(decodeCthEntities("&#99999999999999999999;")).toBe("�");
    expect(decodeCthEntities("&#xD800;")).toBe("�");
  });
});

describe("decodeQldEntities — single pass", () => {
  it("decodes each entity once", () => {
    expect(decodeQldEntities("x &amp;lt;y&amp;gt;")).toBe("x &lt;y&gt;");
    expect(decodeQldEntities("&amp;#160;")).toBe("&#160;");
    expect(decodeQldEntities("&amp;nbsp;")).toBe("&nbsp;");
  });

  it("keeps the former mapping: nbsp/#xa0/#160 and other decimals → space", () => {
    expect(decodeQldEntities("a&nbsp;b&#xa0;c&#160;d&#8217;e")).toBe("a b c d e");
    expect(decodeQldEntities("&lt;&gt;&quot;&amp;")).toBe(`<>"&`);
    expect(decodeQldEntities("&apos; &#xA0; &copy;")).toBe("&apos; &#xA0; &copy;");
  });
});

describe("stripRawTextElements", () => {
  const strip = (s: string) => stripRawTextElements(s, ["style", "script"]);

  it("removes ordinary script and style elements", () => {
    expect(strip("a<script>x()</script>b")).toBe("a b");
    expect(strip("a<style type=\"text/css\">p{}</style>b")).toBe("a b");
  });

  it("matches end tags with whitespace, attributes and any case (js/bad-tag-filter)", () => {
    expect(strip("a<script>x</script >b")).toBe("a b");
    expect(strip("a<script>x</script\t\n bar>b")).toBe("a b");
    expect(strip("a<SCRIPT src=x>y</ScRiPt>b")).toBe("a b");
    expect(strip("a<script/>b</script>c")).toBe("a c");
  });

  it("removes an unterminated element to the end of input, as a browser would", () => {
    expect(strip("a<script>alert(1)")).toBe("a ");
    expect(strip("a<script")).toBe("a ");
    expect(strip("a<script>x</script")).toBe("a ");
  });

  it("cannot splice a new tag from the text around a removed element", () => {
    const out = strip("<scr<script>x</script>ipt>alert(1)</scr<style></style>ipt>");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<\/script/i);
    expect(strip("<script<script>x</script>>y")).not.toMatch(/<script/i);
  });

  it("leaves lookalike element names and plain text alone", () => {
    expect(strip("<scripts>a</scripts><stylesheet>b")).toBe("<scripts>a</scripts><stylesheet>b");
    expect(strip("x < y and 1<2")).toBe("x < y and 1<2");
  });

  it("is linear on long malformed input", () => {
    const t0 = performance.now();
    strip("<script".repeat(20_000));
    strip("<scrip".repeat(20_000) + "</".repeat(20_000));
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
