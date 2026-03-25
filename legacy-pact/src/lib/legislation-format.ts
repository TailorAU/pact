// =====================================================
// Legislation Format Transformers
// Agents choose how they consume legislation data:
//   json     — full structured objects (default)
//   sections — hierarchical act → part → section tree
//   text     — clean plain text, ready for LLM context
//   citation — minimal: just references + IDs
//   markdown — markdown-formatted for agent consumption
// =====================================================

export type LegislationSection = {
  sectionId: string;
  title: string | null;
  content: string;
  depth: number;
  parentId: string | null;
  order: number;
  status: string;
  amendedBy: string | null;
  crossReferences: string[];
  notes: string | null;
};

export type LegislationDoc = {
  id: string;
  jurisdiction: string;
  type: string;
  title: string;
  shortTitle: string | null;
  year: number | null;
  number: string | null;
  inForceDate: string | null;
  lastAmendedDate: string | null;
  repealedDate: string | null;
  administeredBy: string | null;
  legislationUrl: string | null;
  relatedLegislation?: { docId: string; title: string; relationType: string }[];
  sections?: LegislationSection[];
};

// ── JSON format (default) ──
export function formatAsJson(docs: LegislationDoc[]) {
  return { legislation: docs };
}

// ── Sections format — hierarchical tree ──
export function formatAsSections(docs: LegislationDoc[]) {
  return {
    acts: docs.map((doc) => {
      const sections = doc.sections ?? [];
      // Build tree: group by depth
      const tree = buildSectionTree(sections);
      return {
        id: doc.id,
        title: doc.title,
        shortTitle: doc.shortTitle,
        jurisdiction: doc.jurisdiction,
        year: doc.year,
        type: doc.type,
        inForceDate: doc.inForceDate,
        lastAmendedDate: doc.lastAmendedDate,
        administeredBy: doc.administeredBy,
        tree,
      };
    }),
  };
}

function buildSectionTree(sections: LegislationSection[]): SectionTreeNode[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const roots: SectionTreeNode[] = [];
  const byId: Record<string, SectionTreeNode> = {};

  for (const s of sorted) {
    const node: SectionTreeNode = {
      sectionId: s.sectionId,
      title: s.title,
      content: s.content,
      depth: s.depth,
      status: s.status,
      children: [],
    };
    byId[s.sectionId] = node;

    if (s.parentId && byId[s.parentId]) {
      byId[s.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

type SectionTreeNode = {
  sectionId: string;
  title: string | null;
  content: string;
  depth: number;
  status: string;
  children: SectionTreeNode[];
};

// ── Text format — clean plain text ──
export function formatAsText(docs: LegislationDoc[]): string {
  return docs.map((doc) => {
    const header = [
      `${"=".repeat(72)}`,
      doc.title,
      `Jurisdiction: ${doc.jurisdiction} | Type: ${doc.type}`,
      doc.year ? `Year: ${doc.year}` : null,
      doc.administeredBy ? `Administered by: ${doc.administeredBy}` : null,
      doc.inForceDate ? `In force: ${doc.inForceDate}` : null,
      doc.lastAmendedDate ? `Last amended: ${doc.lastAmendedDate}` : null,
      doc.repealedDate ? `REPEALED: ${doc.repealedDate}` : null,
      `${"=".repeat(72)}`,
    ].filter(Boolean).join("\n");

    const sections = (doc.sections ?? [])
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        const indent = "  ".repeat(Math.max(0, s.depth - 1));
        const statusTag = s.status !== "in_force" ? ` [${s.status.toUpperCase()}]` : "";
        const titleLine = s.title ? `${indent}${s.sectionId} — ${s.title}${statusTag}` : `${indent}${s.sectionId}${statusTag}`;
        return `${titleLine}\n${indent}${s.content}`;
      })
      .join("\n\n");

    return `${header}\n\n${sections}`;
  }).join("\n\n\n");
}

// ── Citation format — minimal references ──
export function formatAsCitation(docs: LegislationDoc[]) {
  return {
    citations: docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      jurisdiction: doc.jurisdiction,
      year: doc.year,
      sections: (doc.sections ?? []).map((s) => ({
        sectionId: s.sectionId,
        title: s.title,
        status: s.status,
      })),
    })),
  };
}

// ── Markdown format — agent-friendly ──
export function formatAsMarkdown(docs: LegislationDoc[]): string {
  return docs.map((doc) => {
    const meta = [
      `# ${doc.title}`,
      "",
      `| Field | Value |`,
      `|-------|-------|`,
      `| Jurisdiction | ${doc.jurisdiction} |`,
      `| Type | ${doc.type} |`,
      doc.year ? `| Year | ${doc.year} |` : null,
      doc.administeredBy ? `| Administered by | ${doc.administeredBy} |` : null,
      doc.inForceDate ? `| In force | ${doc.inForceDate} |` : null,
      doc.lastAmendedDate ? `| Last amended | ${doc.lastAmendedDate} |` : null,
      doc.repealedDate ? `| **REPEALED** | ${doc.repealedDate} |` : null,
      "",
    ].filter(x => x !== null).join("\n");

    const sections = (doc.sections ?? [])
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        const heading = "#".repeat(Math.min(s.depth + 1, 6));
        const statusTag = s.status !== "in_force" ? ` _(${s.status})_` : "";
        const title = s.title ? `${heading} ${s.sectionId} — ${s.title}${statusTag}` : `${heading} ${s.sectionId}${statusTag}`;
        return `${title}\n\n${s.content}`;
      })
      .join("\n\n");

    return `${meta}\n${sections}`;
  }).join("\n\n---\n\n");
}

// Format dispatcher
export function formatLegislation(docs: LegislationDoc[], format: string): { body: unknown; contentType: string } {
  switch (format) {
    case "sections":
      return { body: formatAsSections(docs), contentType: "application/json" };
    case "text":
      return { body: formatAsText(docs), contentType: "text/plain" };
    case "citation":
      return { body: formatAsCitation(docs), contentType: "application/json" };
    case "markdown":
      return { body: formatAsMarkdown(docs), contentType: "text/markdown" };
    case "json":
    default:
      return { body: formatAsJson(docs), contentType: "application/json" };
  }
}
