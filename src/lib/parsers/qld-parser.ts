import type { DbClient } from "../db";
import type { LegislationDoc, LegislationSection, SyncResult } from "../legislation-sync";
import { ingestDocuments } from "../legislation-sync";

const QLD_API = "https://api.legislation.qld.gov.au";
const MAX_ACTS = 100;

interface QldAuthResponse {
  auth_type: string;
  access_token: string;
  access_token_exp_at: number;
  refresh_token: string;
}

interface QldDocument {
  title: string;
  year: string;
  id: string;
  no: string;
  version_series_id: string;
  print_type: string;
  repealed: string;
  first_valid_date: string;
  end_valid_date: string;
  _links: {
    html?: { href: string }[];
    pdf?: { href: string }[];
  };
}

interface QldDocumentsResponse {
  documents: QldDocument[];
  _meta: { total_records: number; total_pages: number; page: number; limit: number; count: number };
}

async function authenticate(): Promise<string> {
  const username = process.env.QLD_LEGISLATION_USERNAME;
  const password = process.env.QLD_LEGISLATION_PASSWORD;
  if (!username || !password) {
    throw new Error("QLD_LEGISLATION_USERNAME and QLD_LEGISLATION_PASSWORD must be set");
  }

  const res = await fetch(`${QLD_API}/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`QLD auth failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as QldAuthResponse;
  return data.access_token;
}

async function fetchQld<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${QLD_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`QLD API ${res.status}: ${path.slice(0, 100)}`);
  return res.json() as Promise<T>;
}

async function fetchHtml(path: string, token: string): Promise<string> {
  const res = await fetch(`${QLD_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`QLD HTML ${res.status}: ${path.slice(0, 100)}`);
  return res.text();
}

async function getLatestVersion(actId: string, token: string): Promise<QldDocument | null> {
  const data = await fetchQld<QldDocumentsResponse>(
    `/v1/documents?page=1&limit=50&print_type=act-reprint&id=${encodeURIComponent(actId)}`,
    token
  );

  if (!data.documents || data.documents.length === 0) return null;

  return data.documents.reduce((latest, doc) => {
    const latestDate = latest.first_valid_date || "0000-00-00";
    const docDate = doc.first_valid_date || "0000-00-00";
    return docDate > latestDate ? doc : latest;
  });
}

const KEY_ACTS = [
  "Act-1999-039",  // Coal Mining Safety and Health Act 1999
  "Act-1999-040",  // Mining and Quarrying Safety and Health Act 1999
  "Act-2011-018",  // Work Health and Safety Act 2011 (Qld)
  "Act-1971-047",  // Mines Regulation Act 1964 (may be repealed)
  "Act-1994-062",  // Environmental Protection Act 1994
  "Act-2016-010",  // Mineral Resources Act 1989
  "Act-1999-019",  // Explosives Act 1999
  "Act-2003-013",  // Electrical Safety Act 2002
  "Act-2007-016",  // Transport Operations (Road Use Management) Act 1995
];

function parseQldHtml(html: string): LegislationSection[] {
  const sections: LegislationSection[] = [];
  let currentPart = "";
  let order = 0;

  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  const partPattern = /<h[1-4][^>]*>(?:<[^>]+>)*\s*(Part|Division|Chapter|Schedule)\s+([\dIVXLCDM]+[A-Z]?)\s*[-–—]?\s*([^<]+)/gi;
  let partMatch;
  while ((partMatch = partPattern.exec(text)) !== null) {
    currentPart = `${partMatch[1]} ${partMatch[2]} — ${partMatch[3].trim()}`;
  }

  const sectionPattern = /<(?:h\d|p)[^>]*class="[^"]*(?:section-heading|provision-title|ActHead5)[^"]*"[^>]*>(?:<[^>]+>)*\s*(\d+[A-Z]*(?:\([^)]*\))?)\s+([^<]+)/gi;
  let secMatch;
  while ((secMatch = sectionPattern.exec(text)) !== null) {
    const sectionNo = secMatch[1].trim();
    const title = secMatch[2].replace(/&\w+;/g, " ").trim();
    const afterIdx = secMatch.index + secMatch[0].length;
    const nextSecIdx = text.indexOf("<h", afterIdx + 10);
    const contentSlice = text.slice(afterIdx, nextSecIdx > 0 ? Math.min(nextSecIdx, afterIdx + 8000) : afterIdx + 8000);

    const content = contentSlice
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#xa0;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    if (content.length < 10) continue;

    sections.push({
      sectionId: `s ${sectionNo}`,
      title,
      content,
      depth: currentPart ? 2 : 1,
      parentSection: currentPart || undefined,
      order: order++,
      status: "in_force",
    });
  }

  if (sections.length === 0) {
    const stripped = text.replace(/<[^>]+>/g, "\n").replace(/\s+/g, " ").trim();
    const lines = stripped.split(/\n+/).filter(l => l.trim().length > 30);
    for (let i = 0; i < Math.min(lines.length, 80); i += 3) {
      const chunk = lines.slice(i, i + 3).join(" ").trim().slice(0, 4000);
      if (chunk.length > 30) {
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

export async function syncQld(db: DbClient): Promise<SyncResult> {
  const result: SyncResult = { jurisdiction: "QLD", docsChecked: 0, docsUpdated: 0, sectionsTotal: 0, errors: [] };

  const username = process.env.QLD_LEGISLATION_USERNAME;
  const password = process.env.QLD_LEGISLATION_PASSWORD;
  if (!username || !password) {
    result.errors.push("QLD_LEGISLATION_USERNAME and QLD_LEGISLATION_PASSWORD not configured");
    return result;
  }

  let token: string;
  try {
    token = await authenticate();
  } catch (e) {
    result.errors.push(`Auth failed: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  const docsToIngest: LegislationDoc[] = [];

  for (const actId of KEY_ACTS) {
    result.docsChecked++;
    try {
      const doc = await getLatestVersion(actId, token);
      if (!doc) {
        result.errors.push(`No versions found for ${actId}`);
        continue;
      }
      if (doc.repealed === "Y") continue;

      const htmlPath = `/v1/renditions/html/${encodeURIComponent(actId)}?print_type=act-reprint&point_in_time=${doc.first_valid_date}`;
      const html = await fetchHtml(htmlPath, token);

      const sections = parseQldHtml(html);
      if (sections.length === 0) {
        result.errors.push(`No sections parsed for ${doc.title} (html ${html.length} chars)`);
        continue;
      }

      const sourceId = `qld/act-${doc.year}-${String(doc.no).padStart(3, "0")}`;

      docsToIngest.push({
        id: sourceId,
        jurisdiction: "QLD",
        type: "act",
        title: `${doc.title} (Qld)`,
        shortTitle: doc.title,
        year: parseInt(doc.year),
        number: `Act No. ${doc.no} of ${doc.year}`,
        inForceDate: doc.first_valid_date,
        lastAmendedDate: doc.first_valid_date,
        legislationUrl: `https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-${doc.year}-${String(doc.no).padStart(3, "0")}`,
        sections,
      });

      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      result.errors.push(`${actId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (docsToIngest.length > 0) {
    try {
      const { sectionsTotal } = await ingestDocuments(db, docsToIngest);
      result.docsUpdated = docsToIngest.length;
      result.sectionsTotal = sectionsTotal;
    } catch (e) {
      result.errors.push(`Ingest failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
