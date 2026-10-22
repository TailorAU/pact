import { createHash } from "node:crypto";
import {
  normalizeLegislationDocuments,
  type NormalizedLegislationDocument,
  type NormalizedLegislationSection,
} from "@/lib/legislation-ingest";

/**
 * Versioned, input-shaped legislation replacement digest.
 *
 * The digest is SHA-256 over compact UTF-8 JSON produced by
 * `serializeCanonicalLegislation`: object keys are recursively Unicode
 * code-point sorted,
 * with no insignificant whitespace. Changing the projected fields, defaults,
 * collection ordering, or encoding is a contract change and requires a new
 * version.
 */
export const LEGISLATION_PAYLOAD_DIGEST_VERSION = "legislation-payload-v1" as const;

export type CanonicalLegislationSectionInput = NormalizedLegislationSection;

/** A canonical read is complete state, so omission can never mean relation preservation. */
export type CanonicalLegislationDocumentInput = Omit<
  NormalizedLegislationDocument,
  "relatedDocs"
> & {
  relatedDocs: string[];
};

export type CanonicalLegislationSection = NormalizedLegislationSection;
export type CanonicalLegislationDocument = CanonicalLegislationDocumentInput;

export interface CanonicalLegislationState {
  document: CanonicalLegislationDocument;
  sectionCount: number;
  digestVersion: typeof LEGISLATION_PAYLOAD_DIGEST_VERSION;
  payloadHash: string;
}

function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a, (character) => character.codePointAt(0) as number);
  const right = Array.from(b, (character) => character.codePointAt(0) as number);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

/**
 * Normalize a replacement payload into the exact field/key order hashed by
 * both preflight and persisted-state verification.
 *
 * Section content is preserved byte-for-byte. Identifiers and textual
 * metadata are trimmed; nullable empty text becomes null. Collection order is
 * normalized only where persistence defines set/order semantics: sections use
 * `(order, sectionId)`, while references and relations are code-point-sorted
 * sets.
 */
export function normalizeCanonicalLegislation(
  input: CanonicalLegislationDocumentInput,
): CanonicalLegislationDocument {
  if (!Object.prototype.hasOwnProperty.call(input, "relatedDocs")) {
    throw new TypeError("Canonical legislation state requires explicit relatedDocs");
  }

  // Reuse the write contract at runtime as well as at the type seam. This
  // prevents malformed persisted state from being silently trimmed or
  // deduplicated into a false-valid digest.
  const [normalized] = normalizeLegislationDocuments([input]);
  if (normalized.relatedDocs === undefined) {
    throw new TypeError("Canonical legislation state requires explicit relatedDocs");
  }

  return {
    ...normalized,
    relatedDocs: normalized.relatedDocs,
  };
}

export function serializeCanonicalLegislation(
  input: CanonicalLegislationDocumentInput,
): string {
  return JSON.stringify(deepSortObjectKeys(normalizeCanonicalLegislation(input)));
}

function deepSortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSortObjectKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, child]) => [key, deepSortObjectKeys(child)]),
  );
}

export function hashCanonicalLegislation(
  input: CanonicalLegislationDocumentInput,
): string {
  return createHash("sha256")
    .update(serializeCanonicalLegislation(input), "utf8")
    .digest("hex");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Invalid persisted legislation field: ${field}`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value == null) return null;
  return requiredString(value, field);
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`Invalid persisted legislation field: ${field}`);
  }
  return value;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  return requiredNumber(value, field);
}

function decodedArray(value: unknown, field: string): unknown[] {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      throw new TypeError(`Invalid persisted legislation field: ${field}`);
    }
  }
  if (!Array.isArray(decoded)) {
    throw new TypeError(`Invalid persisted legislation field: ${field}`);
  }
  return decoded;
}

function decodedStringArray(value: unknown, field: string): string[] {
  const values = decodedArray(value, field);
  if (!values.every((entry) => typeof entry === "string")) {
    throw new TypeError(`Invalid persisted legislation field: ${field}`);
  }
  return values as string[];
}

function persistedReferences(value: unknown, field: string): string[] {
  if (value == null) return [];
  return decodedStringArray(value, field);
}

function persistedField(
  row: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(row, camelCase)
    ? row[camelCase]
    : row[snakeCase];
}

/**
 * Project the single-row aggregate returned by the canonical exact-ID query.
 * Generated/audit columns (row IDs, topic IDs, created_at) are deliberately
 * absent; only replacement-payload-controlled state participates.
 */
export function canonicalLegislationFromPersistedRow(
  row: Record<string, unknown>,
): CanonicalLegislationDocument {
  const sections = decodedArray(row.sections, "sections").map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new TypeError(`Invalid persisted legislation field: sections[${index}]`);
    }
    const section = raw as Record<string, unknown>;
    return {
      sectionId: requiredString(
        persistedField(section, "sectionId", "section_id"),
        `sections[${index}].sectionId`,
      ),
      title: nullableString(section.title, `sections[${index}].title`),
      content: requiredString(section.content, `sections[${index}].content`),
      depth: requiredNumber(section.depth, `sections[${index}].depth`),
      parentSection: nullableString(
        persistedField(section, "parentSection", "parent_section"),
        `sections[${index}].parentSection`,
      ),
      order: requiredNumber(section.order, `sections[${index}].order`),
      status: requiredString(
        section.status,
        `sections[${index}].status`,
      ) as NormalizedLegislationSection["status"],
      amendedBy: nullableString(
        persistedField(section, "amendedBy", "amended_by"),
        `sections[${index}].amendedBy`,
      ),
      crossReferences: persistedReferences(
        persistedField(section, "crossReferences", "cross_references"),
        `sections[${index}].crossReferences`,
      ),
      notes: nullableString(section.notes, `sections[${index}].notes`),
    } satisfies CanonicalLegislationSectionInput;
  });

  return normalizeCanonicalLegislation({
    id: requiredString(row.id, "id"),
    jurisdiction: requiredString(row.jurisdiction, "jurisdiction"),
    type: requiredString(row.doc_type, "doc_type") as NormalizedLegislationDocument["type"],
    title: requiredString(row.title, "title"),
    shortTitle: nullableString(row.short_title, "short_title"),
    year: nullableNumber(row.year, "year"),
    number: nullableString(row.number, "number"),
    inForceDate: nullableString(row.in_force_date, "in_force_date"),
    lastAmendedDate: nullableString(row.last_amended_date, "last_amended_date"),
    repealedDate: nullableString(row.repealed_date, "repealed_date"),
    administeredBy: nullableString(row.administered_by, "administered_by"),
    legislationUrl: nullableString(row.legislation_url, "legislation_url"),
    sections,
    relatedDocs: decodedStringArray(row.related_docs, "related_docs"),
  });
}

export function buildCanonicalLegislationState(
  row: Record<string, unknown>,
): CanonicalLegislationState {
  const document = canonicalLegislationFromPersistedRow(row);
  return {
    document,
    sectionCount: document.sections.length,
    digestVersion: LEGISLATION_PAYLOAD_DIGEST_VERSION,
    payloadHash: hashCanonicalLegislation(document),
  };
}
