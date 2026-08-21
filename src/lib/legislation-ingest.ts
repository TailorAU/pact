import { randomUUID } from "node:crypto";
import type { DbClient } from "./db";

export const LEGISLATION_DOCUMENT_TYPES = [
  "act",
  "regulation",
  "standard",
  "guidance",
  "local_law",
  "planning_scheme",
] as const;

export const LEGISLATION_SECTION_STATUSES = [
  "in_force",
  "repealed",
  "not_yet_commenced",
] as const;

export type LegislationDocumentType = (typeof LEGISLATION_DOCUMENT_TYPES)[number];
export type LegislationSectionStatus = (typeof LEGISLATION_SECTION_STATUSES)[number];

export const LEGISLATION_INGEST_LIMITS = {
  documents: 100,
  sectionsPerDocument: 10_000,
  totalSections: 20_000,
  relatedDocuments: 2_000,
  crossReferencesPerSection: 500,
  documentIdChars: 256,
  jurisdictionChars: 32,
  titleChars: 2_000,
  metadataChars: 2_000,
  urlChars: 2_048,
  sectionIdChars: 512,
  sectionTextChars: 2_000,
  sectionContentChars: 2 * 1024 * 1024,
  sectionNotesChars: 64 * 1024,
} as const;

const MAX_VALIDATION_ISSUES = 20;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const DOCUMENT_FIELDS = new Set([
  "id",
  "jurisdiction",
  "type",
  "title",
  "shortTitle",
  "year",
  "number",
  "inForceDate",
  "lastAmendedDate",
  "repealedDate",
  "administeredBy",
  "legislationUrl",
  "sections",
  "relatedDocs",
]);

const SECTION_FIELDS = new Set([
  "sectionId",
  "title",
  "content",
  "depth",
  "parentSection",
  "order",
  "status",
  "amendedBy",
  "crossReferences",
  "notes",
]);

export interface LegislationDocumentInput {
  id: string;
  jurisdiction: string;
  type: LegislationDocumentType;
  title: string;
  shortTitle?: string | null;
  year?: number | null;
  number?: string | null;
  inForceDate?: string | null;
  lastAmendedDate?: string | null;
  repealedDate?: string | null;
  administeredBy?: string | null;
  legislationUrl?: string | null;
  sections: LegislationSectionInput[];
  relatedDocs?: string[];
}

export interface LegislationSectionInput {
  sectionId: string;
  title?: string | null;
  content: string;
  depth?: number;
  parentSection?: string | null;
  order?: number;
  status?: LegislationSectionStatus;
  amendedBy?: string | null;
  crossReferences?: string[];
  notes?: string | null;
}

export interface NormalizedLegislationDocument {
  id: string;
  jurisdiction: string;
  type: LegislationDocumentType;
  title: string;
  shortTitle: string | null;
  year: number | null;
  number: string | null;
  inForceDate: string | null;
  lastAmendedDate: string | null;
  repealedDate: string | null;
  administeredBy: string | null;
  legislationUrl: string | null;
  sections: NormalizedLegislationSection[];
  /** Omitted means preserve; an explicit array is the complete replacement set. */
  relatedDocs?: string[];
}

export interface NormalizedLegislationSection {
  sectionId: string;
  title: string | null;
  /** Legal text is deliberately not trimmed; whitespace bytes are payload state. */
  content: string;
  depth: number;
  parentSection: string | null;
  order: number;
  status: LegislationSectionStatus;
  amendedBy: string | null;
  crossReferences: string[];
  notes: string | null;
}

export interface LegislationValidationIssue {
  path: string;
  message: string;
}

export class LegislationValidationError extends Error {
  readonly code = "invalid_legislation_payload";
  readonly issues: readonly LegislationValidationIssue[];
  readonly truncated: boolean;

  constructor(issues: readonly LegislationValidationIssue[], totalIssues: number) {
    super("Legislation payload validation failed");
    this.name = "LegislationValidationError";
    this.issues = issues;
    this.truncated = totalIssues > issues.length;
  }
}

export interface LegislationIngestResult {
  ingested: number;
  sectionsTotal: number;
  documents: { id: string; title: string; sectionsInserted: number }[];
}

type JsonRecord = Record<string, unknown>;
type SqlStatement = { sql: string; args: unknown[] };

class ValidationCollector {
  readonly issues: LegislationValidationIssue[] = [];
  totalIssues = 0;

  add(path: string, message: string): void {
    this.totalIssues++;
    if (this.issues.length < MAX_VALIDATION_ISSUES) {
      this.issues.push({ path, message });
    }
  }

  throwIfAny(): void {
    if (this.totalIssues > 0) {
      throw new LegislationValidationError(this.issues, this.totalIssues);
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: JsonRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a, (character) => character.codePointAt(0) as number);
  const right = Array.from(b, (character) => character.codePointAt(0) as number);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function checkKnownFields(
  record: JsonRecord,
  allowed: ReadonlySet<string>,
  path: string,
  collector: ValidationCollector,
): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    collector.add(path, "contains one or more unsupported fields");
  }
}

function requiredTrimmedString(
  value: unknown,
  path: string,
  maxChars: number,
  collector: ValidationCollector,
): string {
  if (typeof value !== "string") {
    collector.add(path, "must be a string");
    return "";
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    collector.add(path, "must not be blank");
  } else if (normalized.length > maxChars) {
    collector.add(path, `must be at most ${maxChars} characters`);
  }
  return normalized;
}

function requiredIdentifier(
  value: unknown,
  path: string,
  maxChars: number,
  collector: ValidationCollector,
): string {
  const normalized = requiredTrimmedString(value, path, maxChars, collector);
  if (normalized && CONTROL_CHARACTER.test(normalized)) {
    collector.add(path, "must not contain control characters");
  }
  return normalized;
}

function nullableTrimmedString(
  record: JsonRecord,
  field: string,
  path: string,
  maxChars: number,
  collector: ValidationCollector,
): string | null {
  const value = record[field];
  if (!hasOwn(record, field) || value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    collector.add(path, "must be a string or null");
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maxChars) {
    collector.add(path, `must be at most ${maxChars} characters`);
  }
  return normalized;
}

function nullableInteger(
  record: JsonRecord,
  field: string,
  path: string,
  min: number,
  max: number,
  collector: ValidationCollector,
): number | null {
  const value = record[field];
  if (!hasOwn(record, field) || value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    collector.add(path, `must be an integer from ${min} to ${max}, or null`);
    return null;
  }
  return value as number;
}

function defaultedInteger(
  record: JsonRecord,
  field: string,
  path: string,
  defaultValue: number,
  min: number,
  max: number,
  collector: ValidationCollector,
): number {
  if (!hasOwn(record, field) || record[field] === undefined) return defaultValue;
  const value = record[field];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    collector.add(path, `must be an integer from ${min} to ${max}`);
    return defaultValue;
  }
  return value as number;
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nullableDate(
  record: JsonRecord,
  field: string,
  path: string,
  collector: ValidationCollector,
): string | null {
  const normalized = nullableTrimmedString(record, field, path, 10, collector);
  if (normalized !== null && !isValidIsoDate(normalized)) {
    collector.add(path, "must be a real date in YYYY-MM-DD format, or null");
  }
  return normalized;
}

function nullableHttpUrl(
  record: JsonRecord,
  field: string,
  path: string,
  collector: ValidationCollector,
): string | null {
  const normalized = nullableTrimmedString(
    record,
    field,
    path,
    LEGISLATION_INGEST_LIMITS.urlChars,
    collector,
  );
  if (normalized === null) return null;

  try {
    const parsed = new URL(normalized);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      collector.add(path, "must be an http(s) URL without embedded credentials, or null");
    }
  } catch {
    collector.add(path, "must be a valid http(s) URL, or null");
  }
  return normalized;
}

function normalizeEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  collector: ValidationCollector,
): T {
  if (typeof value !== "string") {
    collector.add(path, `must be one of: ${allowed.join(", ")}`);
    return allowed[0];
  }
  const normalized = value.trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(normalized)) {
    collector.add(path, `must be one of: ${allowed.join(", ")}`);
    return allowed[0];
  }
  return normalized as T;
}

function normalizeStringSet(
  value: unknown,
  path: string,
  maxEntries: number,
  maxChars: number,
  collector: ValidationCollector,
): string[] {
  if (!Array.isArray(value)) {
    collector.add(path, "must be an array");
    return [];
  }
  if (value.length > maxEntries) {
    collector.add(path, `must contain at most ${maxEntries} entries`);
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = requiredIdentifier(value[index], `${path}[${index}]`, maxChars, collector);
    if (!item) continue;
    if (seen.has(item)) {
      collector.add(`${path}[${index}]`, "must not duplicate another entry");
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized.sort(compareCodePoints);
}

function normalizeSection(
  value: unknown,
  documentIndex: number,
  sectionIndex: number,
  collector: ValidationCollector,
): NormalizedLegislationSection | null {
  const path = `documents[${documentIndex}].sections[${sectionIndex}]`;
  if (!isRecord(value)) {
    collector.add(path, "must be an object");
    return null;
  }
  checkKnownFields(value, SECTION_FIELDS, path, collector);

  const sectionId = requiredIdentifier(
    value.sectionId,
    `${path}.sectionId`,
    LEGISLATION_INGEST_LIMITS.sectionIdChars,
    collector,
  );
  const title = nullableTrimmedString(
    value,
    "title",
    `${path}.title`,
    LEGISLATION_INGEST_LIMITS.sectionTextChars,
    collector,
  );

  let content = "";
  if (typeof value.content !== "string") {
    collector.add(`${path}.content`, "must be a string");
  } else {
    content = value.content;
    if (content.length > LEGISLATION_INGEST_LIMITS.sectionContentChars) {
      collector.add(
        `${path}.content`,
        `must be at most ${LEGISLATION_INGEST_LIMITS.sectionContentChars} characters`,
      );
    }
  }

  const depth = defaultedInteger(value, "depth", `${path}.depth`, 2, 1, 64, collector);
  const parentSection = nullableTrimmedString(
    value,
    "parentSection",
    `${path}.parentSection`,
    LEGISLATION_INGEST_LIMITS.sectionTextChars,
    collector,
  );
  const order = defaultedInteger(
    value,
    "order",
    `${path}.order`,
    sectionIndex,
    0,
    MAX_POSTGRES_INTEGER,
    collector,
  );
  const status = hasOwn(value, "status") && value.status !== undefined
    ? normalizeEnum(value.status, `${path}.status`, LEGISLATION_SECTION_STATUSES, collector)
    : "in_force";
  const amendedBy = nullableTrimmedString(
    value,
    "amendedBy",
    `${path}.amendedBy`,
    LEGISLATION_INGEST_LIMITS.sectionTextChars,
    collector,
  );
  const crossReferences = hasOwn(value, "crossReferences") && value.crossReferences !== undefined
    ? normalizeStringSet(
      value.crossReferences,
      `${path}.crossReferences`,
      LEGISLATION_INGEST_LIMITS.crossReferencesPerSection,
      LEGISLATION_INGEST_LIMITS.sectionIdChars,
      collector,
    )
    : [];
  const notes = nullableTrimmedString(
    value,
    "notes",
    `${path}.notes`,
    LEGISLATION_INGEST_LIMITS.sectionNotesChars,
    collector,
  );

  return {
    sectionId,
    title,
    content,
    depth,
    parentSection,
    order,
    status,
    amendedBy,
    crossReferences,
    notes,
  };
}

function normalizeDocument(
  value: unknown,
  documentIndex: number,
  collector: ValidationCollector,
): NormalizedLegislationDocument | null {
  const path = `documents[${documentIndex}]`;
  if (!isRecord(value)) {
    collector.add(path, "must be an object");
    return null;
  }
  checkKnownFields(value, DOCUMENT_FIELDS, path, collector);

  const id = requiredIdentifier(
    value.id,
    `${path}.id`,
    LEGISLATION_INGEST_LIMITS.documentIdChars,
    collector,
  );
  const jurisdiction = requiredIdentifier(
    value.jurisdiction,
    `${path}.jurisdiction`,
    LEGISLATION_INGEST_LIMITS.jurisdictionChars,
    collector,
  ).toUpperCase();
  if (jurisdiction && !/^[A-Z][A-Z0-9-]*$/.test(jurisdiction)) {
    collector.add(`${path}.jurisdiction`, "must contain only letters, digits, and hyphens");
  }
  const type = normalizeEnum(value.type, `${path}.type`, LEGISLATION_DOCUMENT_TYPES, collector);
  const title = requiredTrimmedString(
    value.title,
    `${path}.title`,
    LEGISLATION_INGEST_LIMITS.titleChars,
    collector,
  );

  const shortTitle = nullableTrimmedString(
    value,
    "shortTitle",
    `${path}.shortTitle`,
    LEGISLATION_INGEST_LIMITS.titleChars,
    collector,
  );
  const year = nullableInteger(value, "year", `${path}.year`, 1, 9_999, collector);
  const number = nullableTrimmedString(
    value,
    "number",
    `${path}.number`,
    LEGISLATION_INGEST_LIMITS.metadataChars,
    collector,
  );
  const inForceDate = nullableDate(value, "inForceDate", `${path}.inForceDate`, collector);
  const lastAmendedDate = nullableDate(value, "lastAmendedDate", `${path}.lastAmendedDate`, collector);
  const repealedDate = nullableDate(value, "repealedDate", `${path}.repealedDate`, collector);
  const administeredBy = nullableTrimmedString(
    value,
    "administeredBy",
    `${path}.administeredBy`,
    LEGISLATION_INGEST_LIMITS.metadataChars,
    collector,
  );
  const legislationUrl = nullableHttpUrl(
    value,
    "legislationUrl",
    `${path}.legislationUrl`,
    collector,
  );

  const sections: NormalizedLegislationSection[] = [];
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    collector.add(`${path}.sections`, "must be a non-empty array");
  } else if (value.sections.length > LEGISLATION_INGEST_LIMITS.sectionsPerDocument) {
    collector.add(
      `${path}.sections`,
      `must contain at most ${LEGISLATION_INGEST_LIMITS.sectionsPerDocument} entries`,
    );
  } else {
    for (let sectionIndex = 0; sectionIndex < value.sections.length; sectionIndex++) {
      const section = normalizeSection(value.sections[sectionIndex], documentIndex, sectionIndex, collector);
      if (section) sections.push(section);
    }
  }

  const sectionIds = new Set<string>();
  const sectionOrders = new Set<number>();
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    if (sectionIds.has(section.sectionId)) {
      collector.add(`${path}.sections[${sectionIndex}].sectionId`, "must be unique within the document");
    }
    sectionIds.add(section.sectionId);
    if (sectionOrders.has(section.order)) {
      collector.add(`${path}.sections[${sectionIndex}].order`, "must be unique within the document");
    }
    sectionOrders.add(section.order);
  }
  sections.sort((a, b) => a.order - b.order || compareCodePoints(a.sectionId, b.sectionId));

  const normalized: NormalizedLegislationDocument = {
    id,
    jurisdiction,
    type,
    title,
    shortTitle,
    year,
    number,
    inForceDate,
    lastAmendedDate,
    repealedDate,
    administeredBy,
    legislationUrl,
    sections,
  };

  if (hasOwn(value, "relatedDocs")) {
    normalized.relatedDocs = normalizeStringSet(
      value.relatedDocs,
      `${path}.relatedDocs`,
      LEGISLATION_INGEST_LIMITS.relatedDocuments,
      LEGISLATION_INGEST_LIMITS.documentIdChars,
      collector,
    );
    if (normalized.relatedDocs.includes(id)) {
      collector.add(`${path}.relatedDocs`, "must not contain the document itself");
    }
  }

  return normalized;
}

function normalizeDocumentsWithCollector(
  value: unknown,
  collector: ValidationCollector,
): NormalizedLegislationDocument[] {
  if (!Array.isArray(value) || value.length === 0) {
    collector.add("documents", "must be a non-empty array");
    return [];
  }
  if (value.length > LEGISLATION_INGEST_LIMITS.documents) {
    collector.add("documents", `must contain at most ${LEGISLATION_INGEST_LIMITS.documents} entries`);
    return [];
  }

  const documents: NormalizedLegislationDocument[] = [];
  for (let documentIndex = 0; documentIndex < value.length; documentIndex++) {
    const document = normalizeDocument(value[documentIndex], documentIndex, collector);
    if (document) documents.push(document);
  }

  const documentIds = new Set<string>();
  let totalSections = 0;
  for (let documentIndex = 0; documentIndex < documents.length; documentIndex++) {
    const document = documents[documentIndex];
    if (documentIds.has(document.id)) {
      collector.add(`documents[${documentIndex}].id`, "must be unique within the request");
    }
    documentIds.add(document.id);
    totalSections += document.sections.length;
  }
  if (totalSections > LEGISLATION_INGEST_LIMITS.totalSections) {
    collector.add(
      "documents",
      `must contain at most ${LEGISLATION_INGEST_LIMITS.totalSections} sections in total`,
    );
  }

  return documents;
}

/** Validate and normalize the HTTP request envelope without acquiring a DB client. */
export function normalizeLegislationRequest(input: unknown): NormalizedLegislationDocument[] {
  const collector = new ValidationCollector();
  if (!isRecord(input)) {
    collector.add("body", "must be an object containing documents");
    collector.throwIfAny();
    return [];
  }
  checkKnownFields(input, new Set(["documents"]), "body", collector);
  const documents = normalizeDocumentsWithCollector(input.documents, collector);
  collector.throwIfAny();
  return documents;
}

/** Validate and normalize shared scheduled/PACT callers through the same contract. */
export function normalizeLegislationDocuments(input: unknown): NormalizedLegislationDocument[] {
  const collector = new ValidationCollector();
  const documents = normalizeDocumentsWithCollector(input, collector);
  collector.throwIfAny();
  return documents;
}

/**
 * Atomically replace a complete normalized request.
 *
 * All document upserts run first in code-point ID order. PostgreSQL's
 * ON CONFLICT update locks an existing row, so overlapping writers acquire
 * the same document locks in the same order. Sections and explicitly-owned
 * relations are then replaced inside the same `DbClient.batch` transaction.
 */
export async function replaceLegislationDocuments(
  db: DbClient,
  documents: readonly NormalizedLegislationDocument[],
): Promise<LegislationIngestResult> {
  if (documents.length === 0) {
    throw new TypeError("replaceLegislationDocuments requires at least one normalized document");
  }

  const orderedDocuments = [...documents].sort((a, b) => compareCodePoints(a.id, b.id));
  const statements: SqlStatement[] = [];

  for (const document of orderedDocuments) {
    statements.push({
      sql: `INSERT INTO legislation_docs
        (id, jurisdiction, doc_type, title, short_title, year, number, in_force_date,
         last_amended_date, repealed_date, administered_by, legislation_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          jurisdiction = excluded.jurisdiction,
          doc_type = excluded.doc_type,
          title = excluded.title,
          short_title = excluded.short_title,
          year = excluded.year,
          number = excluded.number,
          in_force_date = excluded.in_force_date,
          last_amended_date = excluded.last_amended_date,
          repealed_date = excluded.repealed_date,
          administered_by = excluded.administered_by,
          legislation_url = excluded.legislation_url`,
      args: [
        document.id,
        document.jurisdiction,
        document.type,
        document.title,
        document.shortTitle,
        document.year,
        document.number,
        document.inForceDate,
        document.lastAmendedDate,
        document.repealedDate,
        document.administeredBy,
        document.legislationUrl,
      ],
    });
  }

  for (const document of orderedDocuments) {
    statements.push({
      sql: "DELETE FROM legislation_sections WHERE doc_id = ?",
      args: [document.id],
    });
    if (document.relatedDocs !== undefined) {
      statements.push({
        sql: "DELETE FROM legislation_relations WHERE from_doc_id = ? AND relation_type = 'subordinate'",
        args: [document.id],
      });
    }
  }

  for (const document of orderedDocuments) {
    for (const section of document.sections) {
      statements.push({
        sql: `INSERT INTO legislation_sections
          (id, doc_id, section_id, title, content, depth, parent_section, sort_order,
           status, amended_by, cross_references, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `${document.id}/${section.sectionId}`,
          document.id,
          section.sectionId,
          section.title,
          section.content,
          section.depth,
          section.parentSection,
          section.order,
          section.status,
          section.amendedBy,
          JSON.stringify(section.crossReferences),
          section.notes,
        ],
      });
    }
  }

  for (const document of orderedDocuments) {
    if (document.relatedDocs === undefined) continue;
    for (const relatedId of document.relatedDocs) {
      statements.push({
        sql: `INSERT INTO legislation_relations (id, from_doc_id, to_doc_id, relation_type)
          VALUES (?, ?, ?, 'subordinate')`,
        args: [randomUUID(), document.id, relatedId],
      });
    }
  }

  await db.batch(statements);

  return {
    ingested: documents.length,
    sectionsTotal: documents.reduce((total, document) => total + document.sections.length, 0),
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      sectionsInserted: document.sections.length,
    })),
  };
}
