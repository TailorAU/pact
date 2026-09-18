import type { DbClient } from "../db";
import type { LegislationDoc, LegislationSection, SyncResult } from "../legislation-sync";
import { ingestDocuments } from "../legislation-sync";

const CTH_API = "https://api.prod.legislation.gov.au/v1";
const CTH_WEB = "https://www.legislation.gov.au";
const BATCH_SIZE = 10;
const DEFAULT_MAX_ACTS = 50;

/**
 * Newest-first ceiling on acts examined per run. Env-tunable so an operator
 * can widen a refill (or narrow a smoke run) without a code change.
 */
function maxActs(): number {
  const raw = Number(process.env.CTH_SYNC_MAX_ACTS ?? DEFAULT_MAX_ACTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ACTS;
}

/**
 * Parser version stamp written into legislation_sync_log.parser_version.
 * Bump when parsing semantics change (regex shape, anomaly detection rules,
 * fallback paths) so downstream regressions can be tied back to a specific
 * parser revision. WS9 introduces 2.0.0 alongside the silent-zero alarm.
 */
const CTH_PARSER_VERSION = "cth-parser@2.1.0";

interface CthTitle {
  id: string;
  name: string;
  year: number;
  number: number;
  status: string;
  seriesType: string;
  makingDate: string;
}

interface CthVersion {
  titleId: string;
  start: string;
  registerId: string;
  compilationNumber: string;
  isLatest: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`CTH API ${res.status}: ${url.slice(0, 120)}`);
  return res.json() as Promise<T>;
}

/**
 * Titles query (tailor-group#7). `status` and `collection` are OData enums
 * on this service; `status eq 'InForce'` parses alone but, conjoined with
 * `collection eq 'Act'`, the binder mis-reads the literal as a property and
 * answers 400 "Could not find a property named 'InForce'" — every run since
 * the API moved to enums fetched zero titles and recorded one error. The `in`
 * operator binds the enum literal correctly in a conjunction (verified live
 * 2026-09-18: 4,768 in-force Acts). The secondary `number desc` makes the
 * newest-first paging stable; `year desc` alone left ties unordered so
 * consecutive `$skip` pages could repeat or drop acts.
 */
export function buildTitlesUrl(skip: number, top: number): string {
  const filter = encodeURIComponent("collection eq 'Act' and status in ('InForce')");
  const select = encodeURIComponent("id,name,year,number,status,seriesType,makingDate");
  const orderby = encodeURIComponent("year desc,number desc");
  return `${CTH_API}/Titles?$filter=${filter}&$top=${top}&$skip=${skip}&$select=${select}&$orderby=${orderby}`;
}

export async function fetchInForceActs(skip: number, top: number): Promise<CthTitle[]> {
  const data = await fetchJson<{ value: CthTitle[] }>(buildTitlesUrl(skip, top));
  return data.value;
}

async function getLatestVersion(titleId: string): Promise<CthVersion | null> {
  const filter = encodeURIComponent(`titleId eq '${titleId}' and isLatest eq true`);
  const url = `${CTH_API}/Versions?$filter=${filter}&$top=1`;
  const data = await fetchJson<{ value: CthVersion[] }>(url);
  return data.value[0] ?? null;
}

function buildEpubHtmlUrl(titleId: string, version: CthVersion): string {
  const start = version.start.split("T")[0];
  return `${CTH_WEB}/${titleId}/${start}/${start}/text/original/epub/OEBPS/document_1/document_1.html`;
}

function normalizeEncoding(text: string): string {
  return text
    .replace(/\u00e2\u0080\u0099/g, "\u2019") // '
    .replace(/\u00e2\u0080\u009c/g, "\u201c") // "
    .replace(/\u00e2\u0080\u009d/g, "\u201d") // "
    .replace(/\u00e2\u0080\u0093/g, "\u2013") // –
    .replace(/\u00e2\u0080\u0094/g, "\u2014") // —
    .replace(/\u00c2\u00a7/g, "\u00a7")       // §
    .replace(/[\u0080-\u009f]/g, "");          // strip remaining C1 control chars
}

async function fetchLegislationHtml(titleId: string, version: CthVersion): Promise<string | null> {
  const url = buildEpubHtmlUrl(titleId, version);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const raw = await res.text();
    return normalizeEncoding(raw);
  } catch {
    return null;
  }
}

/** Named + numeric HTML entities → text. The EPUB uses `&#xa0;` heavily. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/ /g, " ");
}

export function parseActHtml(html: string): LegislationSection[] {
  const sections: LegislationSection[] = [];
  let currentPart = "";
  let order = 0;

  const partPattern = /class="ActHead([234])"[^>]*>(?:<a[^>]*>)?(?:<span[^>]*>)?([^<]+)/g;
  let partMatch;
  const parts: { index: number; level: number; title: string }[] = [];
  while ((partMatch = partPattern.exec(html)) !== null) {
    const level = parseInt(partMatch[1]);
    let title = partMatch[2].replace(/&\w+;/g, " ").trim();
    const restMatch = html.slice(partMatch.index, partMatch.index + 500).match(/<\/span>\s*<span[^>]*>([^<]+)/);
    if (restMatch) title += " " + restMatch[1].replace(/&\w+;/g, " ").trim();
    parts.push({ index: partMatch.index, level, title: title.trim() });
  }

  const sectionPattern = /class="ActHead5"[^>]*>(?:<a[^>]*(?:id="([^"]*)")?[^>]*>)?<span class="CharSectno">([^<]+)<\/span>(?:<span[^>]*>[^<]*<\/span>)*<span[^>]*>([^<]+)/g;
  let secMatch;
  const rawSections: { index: number; anchorId: string; sectionNo: string; title: string }[] = [];
  while ((secMatch = sectionPattern.exec(html)) !== null) {
    rawSections.push({
      index: secMatch.index,
      anchorId: secMatch[1] || "",
      sectionNo: secMatch[2].trim(),
      title: secMatch[3].replace(/&\w+;/g, " ").trim(),
    });
  }

  for (let i = 0; i < rawSections.length; i++) {
    const sec = rawSections[i];
    const nextSecIndex = i + 1 < rawSections.length ? rawSections[i + 1].index : html.length;

    const relevantPart = parts.filter(p => p.index < sec.index).pop();
    if (relevantPart) currentPart = relevantPart.title;

    // The EPUB now wraps every run of text in its own <span> (indent spacers
    // as `<span style=…>&#xa0;</span>`, then the words), so a block is many
    // sibling spans, not bare text. The old extractor stopped at the first
    // closing tag and came away with a non-breaking space; every section
    // then failed the 10-char floor and the act was recorded as "No sections
    // parsed" (tailor-group#7). Take each provision-level <p> block whole,
    // up to its </p>, and strip the markup. The markup slice is wider than
    // before because the spacer spans inflate it ~5×; the text itself is
    // still capped at 4,000 chars below.
    const contentSlice = html.slice(sec.index, Math.min(sec.index + 40_000, nextSecIndex));
    const textParts: string[] = [];
    const textPattern = /<p[^>]*class="(?:subsection2?|paragraph(?:sub)?|subparagraph|note(?:text|para|ToPara)?|[Dd]efinition|DefnSectn|Penalty|SubsectionHead)"[^>]*>([\s\S]*?)<\/p>/g;
    let textMatch;
    while ((textMatch = textPattern.exec(contentSlice)) !== null) {
      const text = decodeEntities(textMatch[1].replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .replace(/\s+([.,;:)\]])/g, "$1") // "Act 2026 ." → "Act 2026." after span joins
        .trim();
      if (text.length > 5) textParts.push(text);
    }

    const content = textParts.join(" ").slice(0, 4000);
    if (content.length < 10) continue;

    sections.push({
      sectionId: `s ${sec.sectionNo}`,
      title: sec.title,
      content,
      depth: currentPart ? 2 : 1,
      parentSection: currentPart || undefined,
      order: order++,
      status: "in_force",
    });
  }

  return sections;
}

function cthSourceId(year: number, number: number): string {
  return `cth/act-${year}-${String(number).padStart(3, "0")}`;
}

export async function syncCth(db: DbClient): Promise<SyncResult> {
  const result: SyncResult = {
    jurisdiction: "CTH",
    docsChecked: 0,
    docsUpdated: 0,
    sectionsTotal: 0,
    errors: [],
    parserVersion: CTH_PARSER_VERSION,
    parserAnomalyCount: 0,
    parserCrashCount: 0,
  };
  const docsToIngest: LegislationDoc[] = [];
  let skip = 0;

  const ceiling = maxActs();
  while (result.docsChecked < ceiling) {
    let titles: CthTitle[];
    try {
      titles = await fetchInForceActs(skip, BATCH_SIZE);
    } catch (e) {
      // Top-of-loop fetch failure — record and stop. Counted as a crash so
      // a run that never reached a single title is visible in
      // legislation_sync_log.parser_crash_count, not only in `errors`
      // (this is exactly how the enum-filter 400 hid for months).
      result.errors.push(`Titles fetch at skip=${skip}: ${e instanceof Error ? e.message : String(e)}`);
      result.parserCrashCount++;
      break;
    }
    if (titles.length === 0) break;
    result.docsChecked += titles.length;

    for (const title of titles) {
      try {
        const version = await getLatestVersion(title.id);
        if (!version) {
          // Anomaly: title lookup succeeded but version metadata is missing.
          // Pre-WS9 this was silently dropped via `errors.push + continue`;
          // now we also bump parserAnomalyCount so a run where every doc has
          // this issue surfaces as silent_zero rather than "ran cleanly".
          result.errors.push(`No latest version for ${title.name}`);
          result.parserAnomalyCount++;
          continue;
        }

        const html = await fetchLegislationHtml(title.id, version);
        if (!html) {
          // Anomaly: version exists but the EPUB HTML fetch returned null.
          result.errors.push(`No HTML for ${title.name}`);
          result.parserAnomalyCount++;
          continue;
        }

        const sections = parseActHtml(html);
        if (sections.length === 0) {
          // Anomaly: HTML returned but the section regex matched nothing.
          // This is the canonical "parser drift" case the audit found.
          result.errors.push(`No sections parsed for ${title.name} (html ${html.length} chars)`);
          result.parserAnomalyCount++;
          continue;
        }

        docsToIngest.push({
          id: cthSourceId(title.year, title.number),
          jurisdiction: "CTH",
          type: "act",
          title: `${title.name} (Cth)`,
          shortTitle: title.name,
          year: title.year,
          number: `Act No. ${title.number} of ${title.year}`,
          inForceDate: title.makingDate?.split("T")[0],
          lastAmendedDate: version.start?.split("T")[0],
          legislationUrl: `${CTH_WEB}/${title.id}/latest/text`,
          sections,
        });

        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        // Per-doc exception (network, timeout, JSON parse). Counts as a
        // crash, distinct from anomaly (anomaly = parsed cleanly but found
        // nothing useful; crash = code threw mid-parse).
        result.errors.push(`${title.name}: ${e instanceof Error ? e.message : String(e)}`);
        result.parserCrashCount++;
      }
    }

    if (docsToIngest.length >= 5) {
      const batch = docsToIngest.splice(0, 5);
      try {
        const { sectionsTotal } = await ingestDocuments(db, batch);
        result.docsUpdated += batch.length;
        result.sectionsTotal += sectionsTotal;
      } catch (e) {
        // Ingest batch failure — counts as a crash because the parser had
        // already produced output that's now lost.
        result.errors.push(`Ingest batch failed: ${e instanceof Error ? e.message : String(e)}`);
        result.parserCrashCount++;
      }
    }

    skip += BATCH_SIZE;
  }

  if (docsToIngest.length > 0) {
    try {
      const { sectionsTotal } = await ingestDocuments(db, docsToIngest);
      result.docsUpdated += docsToIngest.length;
      result.sectionsTotal += sectionsTotal;
    } catch (e) {
      result.errors.push(`Final ingest batch failed: ${e instanceof Error ? e.message : String(e)}`);
      result.parserCrashCount++;
    }
  }

  return result;
}
