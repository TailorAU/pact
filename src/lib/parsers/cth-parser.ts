import type { DbClient } from "../db";
import type { LegislationDoc, LegislationSection, SyncResult } from "../legislation-sync";
import { ingestDocuments } from "../legislation-sync";

const CTH_API = "https://api.prod.legislation.gov.au/v1";
const BATCH_SIZE = 20;

interface CthTitle {
  id: string;
  name: string;
  collection: string;
  year: number;
  number: number;
  status: string;
  isInForce: boolean;
  makingDate: string;
  seriesType: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CTH API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

async function fetchInForceActs(skip: number, top: number): Promise<{ value: CthTitle[]; nextLink?: string }> {
  const filter = encodeURIComponent("collection eq 'Act' and status eq 'InForce'");
  const url = `${CTH_API}/Titles?$filter=${filter}&$top=${top}&$skip=${skip}&$orderby=year desc`;
  return fetchJson(url);
}

async function getExistingDocIds(db: DbClient): Promise<Map<string, string | null>> {
  const result = await db.execute("SELECT id, last_amended_date FROM legislation_docs WHERE jurisdiction = 'CTH'");
  const map = new Map<string, string | null>();
  for (const row of result.rows) {
    map.set(row.id as string, (row.last_amended_date as string) ?? null);
  }
  return map;
}

function cthIdToSourceId(cthId: string, year: number, number: number): string {
  return `cth/act-${year}-${String(number).padStart(3, "0")}`;
}

async function fetchDocumentHtml(titleId: string): Promise<string | null> {
  try {
    const findUrl = `${CTH_API}/documents/find(titleid='${titleId}',asatspecification='Latest',type='Primary',format='Epub',uniqueTypeNumber=0,volumeNumber=0,rectificationVersionNumber=0)`;
    const metaRes = await fetch(findUrl, { headers: { Accept: "application/json" } });
    if (!metaRes.ok) return null;

    const itemsUrl = `${findUrl}/getzipitems`;
    const itemsRes = await fetch(itemsUrl, { headers: { Accept: "application/json" } });
    if (!itemsRes.ok) return null;
    const items: string[] = await itemsRes.json();

    const htmlItems = items.filter(i => i.endsWith(".xhtml") || i.endsWith(".html"));
    if (htmlItems.length === 0) return null;

    const mainItem = htmlItems.find(i => i.includes("body") || i.includes("text")) || htmlItems[0];
    const contentRes = await fetch(`${findUrl}/${mainItem}`);
    if (!contentRes.ok) return null;
    return contentRes.text();
  } catch {
    return null;
  }
}

function parseHtmlToSections(html: string, title: string): LegislationSection[] {
  const sections: LegislationSection[] = [];
  const sectionPattern = /<(?:h[1-6]|div[^>]*class="[^"]*(?:section|provision|part|division)[^"]*")[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)<\/(?:h[1-6]|div)>/gi;

  const partPattern = /(?:Part|Division|Chapter|Schedule)\s+[\dIVXLCDM]+[A-Z]?\s*[-–—]?\s*([^\n<]+)/gi;
  const sectionIdPattern = /(?:(?:Section|s)\s*\.?\s*)(\d+[A-Z]*(?:\([^)]+\))?)/gi;

  const lines = html.replace(/<[^>]+>/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);

  let currentPart = "";
  let order = 0;

  for (const line of lines) {
    const partMatch = line.match(/^(Part|Division|Chapter|Schedule)\s+([\dIVXLCDM]+[A-Z]?)\s*[-–—]\s*(.+)/i);
    if (partMatch) {
      currentPart = `${partMatch[1]} ${partMatch[2]} — ${partMatch[3]}`;
      continue;
    }

    const secMatch = line.match(/^(\d+[A-Z]*(?:\([^)]+\))?)\s+(.+)/);
    if (secMatch && line.length > 20) {
      const sectionId = `s ${secMatch[1]}`;
      const sectionTitle = secMatch[2].slice(0, 200);
      const depth = currentPart ? 2 : 1;

      sections.push({
        sectionId,
        title: sectionTitle,
        content: line,
        depth,
        parentSection: currentPart || undefined,
        order: order++,
        status: "in_force",
      });
    }
  }

  if (sections.length === 0 && lines.length > 0) {
    const chunkSize = 2000;
    for (let i = 0; i < lines.length && sections.length < 50; i += 10) {
      const chunk = lines.slice(i, i + 10).join(" ").slice(0, chunkSize);
      if (chunk.length > 50) {
        sections.push({
          sectionId: `chunk-${sections.length + 1}`,
          title: `Section ${sections.length + 1}`,
          content: chunk,
          depth: 1,
          order: sections.length,
          status: "in_force",
        });
      }
    }
  }

  return sections;
}

export async function syncCth(db: DbClient): Promise<SyncResult> {
  const result: SyncResult = { jurisdiction: "CTH", docsChecked: 0, docsUpdated: 0, sectionsTotal: 0, errors: [] };

  const existing = await getExistingDocIds(db);
  const docsToIngest: LegislationDoc[] = [];
  let skip = 0;

  while (true) {
    let titles: CthTitle[];
    try {
      const response = await fetchInForceActs(skip, BATCH_SIZE);
      titles = response.value;
    } catch (e) {
      result.errors.push(`Failed to fetch titles at skip=${skip}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }

    if (titles.length === 0) break;
    result.docsChecked += titles.length;

    for (const title of titles) {
      const sourceId = cthIdToSourceId(title.id, title.year, title.number);

      const html = await fetchDocumentHtml(title.id);
      if (!html) {
        result.errors.push(`No HTML content for ${title.name} (${title.id})`);
        continue;
      }

      const sections = parseHtmlToSections(html, title.name);
      if (sections.length === 0) {
        result.errors.push(`No sections parsed for ${title.name}`);
        continue;
      }

      docsToIngest.push({
        id: sourceId,
        jurisdiction: "CTH",
        type: title.seriesType?.toLowerCase() === "act" ? "act" : "regulation",
        title: `${title.name} (Cth)`,
        shortTitle: title.name,
        year: title.year,
        number: `Act No. ${title.number} of ${title.year}`,
        inForceDate: title.makingDate?.split("T")[0],
        administeredBy: undefined,
        legislationUrl: `https://www.legislation.gov.au/${title.id}/latest/text`,
        sections,
      });

      if (docsToIngest.length >= 5) {
        const batch = docsToIngest.splice(0, 5);
        const { sectionsTotal } = await ingestDocuments(db, batch);
        result.docsUpdated += batch.length;
        result.sectionsTotal += sectionsTotal;
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    skip += BATCH_SIZE;

    if (skip >= 100) break;
  }

  if (docsToIngest.length > 0) {
    const { sectionsTotal } = await ingestDocuments(db, docsToIngest);
    result.docsUpdated += docsToIngest.length;
    result.sectionsTotal += sectionsTotal;
  }

  return result;
}
