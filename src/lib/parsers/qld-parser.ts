import type { DbClient } from "../db";
import type { LegislationDoc, LegislationSection, SyncResult } from "../legislation-sync";
import { ingestDocuments } from "../legislation-sync";

const QLD_API = "https://api.legislation.qld.gov.au";

/**
 * QLD legislation sync.
 *
 * Requires QLD_LEGISLATION_API_KEY env var from registration at
 * https://api.legislation.qld.gov.au/api/signup
 *
 * The QLD API Swagger is only accessible after registration; endpoint
 * paths below are provisional and will be confirmed once the key is live.
 * The parser structure follows the same pattern as the CTH parser.
 */
export async function syncQld(db: DbClient): Promise<SyncResult> {
  const result: SyncResult = { jurisdiction: "QLD", docsChecked: 0, docsUpdated: 0, sectionsTotal: 0, errors: [] };

  const apiKey = process.env.QLD_LEGISLATION_API_KEY;
  if (!apiKey) {
    result.errors.push("QLD_LEGISLATION_API_KEY not configured. Register at https://api.legislation.qld.gov.au/api/signup");
    return result;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Ocp-Apim-Subscription-Key": apiKey,
  };

  try {
    const catalogRes = await fetch(`${QLD_API}/v2/Acts?InForce=true&PageSize=50`, { headers });
    if (!catalogRes.ok) {
      result.errors.push(`QLD catalogue fetch failed: ${catalogRes.status} ${catalogRes.statusText}`);
      return result;
    }

    const catalog = await catalogRes.json() as { Results?: QldActSummary[] };
    const acts = catalog.Results ?? [];
    result.docsChecked = acts.length;

    const docsToIngest: LegislationDoc[] = [];

    for (const act of acts) {
      try {
        const detailRes = await fetch(`${QLD_API}/v2/Acts/${encodeURIComponent(act.Id)}?IncludeSections=true`, { headers });
        if (!detailRes.ok) {
          result.errors.push(`Failed to fetch QLD act ${act.Title}: ${detailRes.status}`);
          continue;
        }

        const detail = await detailRes.json() as QldActDetail;
        const sections = parseQldSections(detail);

        if (sections.length === 0) {
          result.errors.push(`No sections parsed for QLD act: ${act.Title}`);
          continue;
        }

        const sourceId = `qld/act-${act.Year || "0000"}-${String(act.Number || "000").padStart(3, "0")}`;

        docsToIngest.push({
          id: sourceId,
          jurisdiction: "QLD",
          type: "act",
          title: `${act.Title} (Qld)`,
          shortTitle: act.ShortTitle || act.Title,
          year: act.Year,
          number: act.Number ? `Act No. ${act.Number} of ${act.Year}` : undefined,
          inForceDate: act.CommencementDate,
          lastAmendedDate: act.LastAmendedDate,
          administeredBy: act.AdministeredBy,
          legislationUrl: `https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-${act.Year}-${String(act.Number || "000").padStart(3, "0")}`,
          sections,
        });

        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        result.errors.push(`Error processing QLD act ${act.Title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (docsToIngest.length > 0) {
      const { sectionsTotal } = await ingestDocuments(db, docsToIngest);
      result.docsUpdated = docsToIngest.length;
      result.sectionsTotal = sectionsTotal;
    }
  } catch (e) {
    result.errors.push(`QLD sync failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

interface QldActSummary {
  Id: string;
  Title: string;
  ShortTitle?: string;
  Year?: number;
  Number?: number;
  CommencementDate?: string;
  LastAmendedDate?: string;
  AdministeredBy?: string;
}

interface QldActDetail {
  Id: string;
  Title: string;
  Sections?: QldSection[];
  Parts?: QldPart[];
}

interface QldSection {
  Id: string;
  Number: string;
  Title?: string;
  Content?: string;
  Status?: string;
}

interface QldPart {
  Number: string;
  Title: string;
  Sections?: QldSection[];
}

function parseQldSections(detail: QldActDetail): LegislationSection[] {
  const sections: LegislationSection[] = [];
  let order = 0;

  if (detail.Parts) {
    for (const part of detail.Parts) {
      const parentSection = `Part ${part.Number} — ${part.Title}`;
      if (part.Sections) {
        for (const s of part.Sections) {
          sections.push({
            sectionId: `s ${s.Number}`,
            title: s.Title,
            content: s.Content || "",
            depth: 2,
            parentSection,
            order: order++,
            status: s.Status?.toLowerCase() === "repealed" ? "repealed" : "in_force",
          });
        }
      }
    }
  }

  if (detail.Sections) {
    for (const s of detail.Sections) {
      if (!sections.find(existing => existing.sectionId === `s ${s.Number}`)) {
        sections.push({
          sectionId: `s ${s.Number}`,
          title: s.Title,
          content: s.Content || "",
          depth: 1,
          order: order++,
          status: s.Status?.toLowerCase() === "repealed" ? "repealed" : "in_force",
        });
      }
    }
  }

  return sections;
}
