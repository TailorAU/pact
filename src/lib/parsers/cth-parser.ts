import type { DbClient } from "../db";
import type { LegislationDoc, LegislationSection, SyncResult } from "../legislation-sync";
import { ingestDocuments } from "../legislation-sync";

const CTH_API = "https://api.prod.legislation.gov.au/v1";
const CTH_WEB = "https://www.legislation.gov.au";
const BATCH_SIZE = 10;
const MAX_ACTS = 50;

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

async function fetchInForceActs(skip: number, top: number): Promise<CthTitle[]> {
  const filter = encodeURIComponent("collection eq 'Act' and status eq 'InForce'");
  const select = encodeURIComponent("id,name,year,number,status,seriesType,makingDate");
  const url = `${CTH_API}/Titles?$filter=${filter}&$top=${top}&$skip=${skip}&$select=${select}&$orderby=year desc`;
  const data = await fetchJson<{ value: CthTitle[] }>(url);
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

async function fetchLegislationHtml(titleId: string, version: CthVersion): Promise<string | null> {
  const url = buildEpubHtmlUrl(titleId, version);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function parseActHtml(html: string): LegislationSection[] {
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

    const contentSlice = html.slice(sec.index, Math.min(sec.index + 5000, nextSecIndex));
    const textParts: string[] = [];
    const textPattern = /class="(?:subsection|paragraph|subparagraph|note|definition|DefnSectn)"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)/g;
    let textMatch;
    while ((textMatch = textPattern.exec(contentSlice)) !== null) {
      const text = textMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#xa0;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
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
  const result: SyncResult = { jurisdiction: "CTH", docsChecked: 0, docsUpdated: 0, sectionsTotal: 0, errors: [] };
  const docsToIngest: LegislationDoc[] = [];
  let skip = 0;

  while (result.docsChecked < MAX_ACTS) {
    let titles: CthTitle[];
    try {
      titles = await fetchInForceActs(skip, BATCH_SIZE);
    } catch (e) {
      result.errors.push(`Titles fetch at skip=${skip}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    if (titles.length === 0) break;
    result.docsChecked += titles.length;

    for (const title of titles) {
      try {
        const version = await getLatestVersion(title.id);
        if (!version) {
          result.errors.push(`No latest version for ${title.name}`);
          continue;
        }

        const html = await fetchLegislationHtml(title.id, version);
        if (!html) {
          result.errors.push(`No HTML for ${title.name}`);
          continue;
        }

        const sections = parseActHtml(html);
        if (sections.length === 0) {
          result.errors.push(`No sections parsed for ${title.name} (html ${html.length} chars)`);
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
        result.errors.push(`${title.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (docsToIngest.length >= 5) {
      const batch = docsToIngest.splice(0, 5);
      try {
        const { sectionsTotal } = await ingestDocuments(db, batch);
        result.docsUpdated += batch.length;
        result.sectionsTotal += sectionsTotal;
      } catch (e) {
        result.errors.push(`Ingest batch failed: ${e instanceof Error ? e.message : String(e)}`);
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
    }
  }

  return result;
}
