import { createHash, randomUUID } from "node:crypto";
import { withTransaction, type DbClient } from "./db";

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

/**
 * Who is writing (tailor-group#35). Every caller declares itself; there is no
 * default. Only `reviewed` stamps `legislation_docs.reviewed_at` /
 * `review_hash`: the admin `X-Admin-Key` ingest route maps to it only when the
 * request asserts `X-Ingest-Source: reviewed`, which
 * scripts/run_reviewed_legislation_ingest.py sends after binding the payload
 * to scripts/reviewed_legislation_builders.json. An admin POST without that
 * assertion — the deploy-time seeds in .github/workflows/cd-kg.yml, one of
 * which live-scrapes the Planning Act 2016 — is `admin`; `scheduled` is the
 * CTH/QLD parsers and `proposal` the PACT proposal finalizer. Those three
 * never touch the marker columns and never overwrite a document that carries
 * the marker.
 */
export type LegislationIngestSource =
  | { source: "reviewed" }
  | { source: "admin" }
  | { source: "scheduled" }
  | { source: "proposal" };

const LEGISLATION_INGEST_SOURCES: ReadonlySet<string> = new Set([
  "reviewed",
  "admin",
  "scheduled",
  "proposal",
]);

/** A document left untouched because a reviewed ingest marked it. */
export interface SkippedReviewedDocument {
  id: string;
  /** ISO-8601 UTC timestamp of the reviewed ingest that stamped the row. */
  reviewedAt: string;
}

export interface LegislationIngestResult {
  /** Documents actually written; skipped documents are not counted. */
  ingested: number;
  sectionsTotal: number;
  documents: { id: string; title: string; sectionsInserted: number }[];
  /** Reviewed documents excluded from every statement. Always `[]` for source `reviewed`. */
  skipped: SkippedReviewedDocument[];
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

function deepSortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSortObjectKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, child]) => [key, deepSortObjectKeys(child)]),
  );
}

/**
 * `legislation_docs.review_hash` (tailor-group#35): lowercase SHA-256 hex of
 * the normalized document as compact JSON with recursively code-point-sorted
 * keys. It is computed from the normalized document, never the raw request,
 * so the same reviewed content always stamps the same hash. When `relatedDocs`
 * is explicit this is byte-for-byte the `legislation-payload-v1` digest the
 * canonical read publishes (`hashCanonicalLegislation`); an omitted
 * `relatedDocs` (preserve stored relations) hashes without that key.
 */
export function reviewHashForDocument(document: NormalizedLegislationDocument): string {
  return createHash("sha256")
    .update(JSON.stringify(deepSortObjectKeys(document)), "utf8")
    .digest("hex");
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
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
 * Everything runs inside ONE transaction on ONE connection (`withTransaction`;
 * a two-method test mock runs the same statement stream directly). The
 * transaction first locks every existing row of the batch — `SELECT … FOR
 * UPDATE` in one fixed order (`ORDER BY id COLLATE "C"`, the code-point order
 * the upserts also use) — so overlapping writers serialise on the same
 * document rows in the same order: whichever transaction locks first finishes
 * first, and the other then reads the committed marker. Document upserts
 * follow in code-point ID order (PostgreSQL's ON CONFLICT update locks the
 * row, and an INSERT of a new id waits for a concurrent insert of the same
 * id), then sections and explicitly-owned relations are replaced.
 *
 * Reviewed-document guard (tailor-group#35): a `reviewed` write stamps
 * `reviewed_at = NOW()` and `review_hash` on every document it writes. An
 * `admin`, `scheduled` or `proposal` write reads `reviewed_at` from the rows
 * it has just locked, excludes every marked id from every statement (no
 * upsert, no section delete/insert, no relation change) and reports them in
 * `skipped`. Its upsert never assigns the two marker columns and its
 * ON CONFLICT update is conditional on `reviewed_at IS NULL`, so a marker
 * always survives it. A document that did not exist when the batch locked
 * (nothing to lock) can still be inserted — and marked — by a concurrent
 * reviewed write that commits first: the guarded INSERT then waits on that
 * row, its conditional update leaves it untouched, its section and relation
 * statements are each conditional on `reviewed_at IS NULL` too (re-read per
 * statement, so they see that commit), and a marker read after the batch,
 * while this transaction holds every remaining row, reports the document as
 * `skipped` rather than written. Without the guard any
 * re-run — the deploy-time SEQ seed that POSTs a live-scraped Planning Act
 * 2016 through the admin route, or a scheduled QLD run whose KEY_ACTS
 * overlapped a reviewed document — replaced the human-reviewed sections with
 * parser output; and without the locks a reviewed write landing between an
 * unlocked pre-select on a pooled connection and the batch's own transaction
 * was overwritten the same way (Cursor Bugbot on pact#78).
 */
export async function replaceLegislationDocuments(
  db: DbClient,
  documents: readonly NormalizedLegislationDocument[],
  options: LegislationIngestSource,
): Promise<LegislationIngestResult> {
  if (documents.length === 0) {
    throw new TypeError("replaceLegislationDocuments requires at least one normalized document");
  }
  if (!options || !LEGISLATION_INGEST_SOURCES.has(options.source)) {
    throw new TypeError(
      "replaceLegislationDocuments requires an explicit source: reviewed, admin, scheduled or proposal",
    );
  }
  const reviewed = options.source === "reviewed";
  const orderedDocuments = [...documents].sort((a, b) => compareCodePoints(a.id, b.id));
  return withTransaction(db, (tx) => replaceLockedDocuments(tx, documents, orderedDocuments, reviewed));
}

/** The statement stream of `replaceLegislationDocuments`, run on one transaction-scoped client. */
async function replaceLockedDocuments(
  tx: DbClient,
  documents: readonly NormalizedLegislationDocument[],
  orderedDocuments: readonly NormalizedLegislationDocument[],
  reviewed: boolean,
): Promise<LegislationIngestResult> {
  const skipped: SkippedReviewedDocument[] = [];
  const skippedIds = new Set<string>();
  const skipMarked = (rows: Record<string, unknown>[]): void => {
    for (const row of rows) {
      if (row.reviewed_at === null || row.reviewed_at === undefined) continue;
      const id = String(row.id);
      if (skippedIds.has(id)) continue;
      skippedIds.add(id);
      skipped.push({ id, reviewedAt: isoTimestamp(row.reviewed_at) });
    }
  };

  // 1. Lock every existing row of the batch, in one fixed order, and read the
  //    marker from the locked rows: no other writer can change them before COMMIT.
  const locked = await tx.execute({
    sql: `SELECT id, reviewed_at FROM legislation_docs
      WHERE id IN (${orderedDocuments.map(() => "?").join(", ")})
      ORDER BY id COLLATE "C" ASC
      FOR UPDATE`,
    args: orderedDocuments.map((document) => document.id),
  });
  if (!reviewed) skipMarked(locked.rows);
  let remaining = orderedDocuments.filter((document) => !skippedIds.has(document.id));
  if (remaining.length === 0) {
    return { ingested: 0, sectionsTotal: 0, documents: [], skipped };
  }

  // 2. One batch: document upserts in code-point order, then sections and
  //    explicitly-owned relations. A guarded write's statements are each
  //    conditional on `reviewed_at IS NULL`, re-read per statement, so a
  //    document absent at step 1 (nothing to lock) that a concurrent reviewed
  //    write inserted and marked before this INSERT reached the row — the
  //    INSERT waits on that row — is left untouched all the way down.
  const statements: SqlStatement[] = remaining.map((document) =>
    reviewed ? reviewedUpsert(document) : guardedUpsert(document),
  );

  for (const document of remaining) {
    statements.push(reviewed
      ? { sql: "DELETE FROM legislation_sections WHERE doc_id = ?", args: [document.id] }
      : {
        sql: `DELETE FROM legislation_sections WHERE doc_id = ?
          AND EXISTS (SELECT 1 FROM legislation_docs WHERE id = ? AND reviewed_at IS NULL)`,
        args: [document.id, document.id],
      });
    if (document.relatedDocs !== undefined) {
      statements.push(reviewed
        ? {
          sql: "DELETE FROM legislation_relations WHERE from_doc_id = ? AND relation_type = 'subordinate'",
          args: [document.id],
        }
        : {
          sql: `DELETE FROM legislation_relations WHERE from_doc_id = ? AND relation_type = 'subordinate'
            AND EXISTS (SELECT 1 FROM legislation_docs WHERE id = ? AND reviewed_at IS NULL)`,
          args: [document.id, document.id],
        });
    }
  }

  for (const document of remaining) {
    for (const section of document.sections) {
      const values: unknown[] = [
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
      ];
      statements.push(reviewed
        ? {
          sql: `INSERT INTO legislation_sections
            (id, doc_id, section_id, title, content, depth, parent_section, sort_order,
             status, amended_by, cross_references, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: values,
        }
        : {
          sql: `INSERT INTO legislation_sections
            (id, doc_id, section_id, title, content, depth, parent_section, sort_order,
             status, amended_by, cross_references, notes)
            SELECT ?::text, ?::text, ?::text, ?::text, ?::text, ?::integer, ?::text, ?::integer,
                   ?::text, ?::text, ?::text, ?::text
            FROM legislation_docs WHERE id = ? AND reviewed_at IS NULL`,
          args: [...values, document.id],
        });
    }
  }

  for (const document of remaining) {
    if (document.relatedDocs === undefined) continue;
    for (const relatedId of document.relatedDocs) {
      statements.push(reviewed
        ? {
          sql: `INSERT INTO legislation_relations (id, from_doc_id, to_doc_id, relation_type)
            VALUES (?, ?, ?, 'subordinate')`,
          args: [randomUUID(), document.id, relatedId],
        }
        : {
          sql: `INSERT INTO legislation_relations (id, from_doc_id, to_doc_id, relation_type)
            SELECT ?::text, ?::text, ?::text, 'subordinate'
            FROM legislation_docs WHERE id = ? AND reviewed_at IS NULL`,
          args: [randomUUID(), document.id, relatedId, document.id],
        });
    }
  }

  await tx.batch(statements);

  // 3. Guarded writes only: report the documents step 2 left untouched. Every
  //    remaining row is locked by this transaction now, so this read is final.
  if (!reviewed) {
    const late = await tx.execute({
      sql: `SELECT id, reviewed_at FROM legislation_docs
        WHERE id IN (${remaining.map(() => "?").join(", ")})
          AND reviewed_at IS NOT NULL
        ORDER BY id COLLATE "C" ASC`,
      args: remaining.map((document) => document.id),
    });
    skipMarked(late.rows);
    remaining = remaining.filter((document) => !skippedIds.has(document.id));
  }

  const written = documents.filter((document) => remaining.includes(document));
  return {
    ingested: written.length,
    sectionsTotal: written.reduce((total, document) => total + document.sections.length, 0),
    documents: written.map((document) => ({
      id: document.id,
      title: document.title,
      sectionsInserted: document.sections.length,
    })),
    skipped,
  };
}

/** A `reviewed` write: replaces the metadata and (re-)stamps the marker. */
function reviewedUpsert(document: NormalizedLegislationDocument): SqlStatement {
  return {
    sql: `INSERT INTO legislation_docs
      (id, jurisdiction, doc_type, title, short_title, year, number, in_force_date,
       last_amended_date, repealed_date, administered_by, legislation_url,
       reviewed_at, review_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
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
        legislation_url = excluded.legislation_url,
        reviewed_at = NOW(),
        review_hash = excluded.review_hash`,
    args: [...documentUpsertArgs(document), reviewHashForDocument(document)],
  };
}

/**
 * An `admin` / `scheduled` / `proposal` write: never assigns `reviewed_at` or
 * `review_hash`, and leaves a row alone once a marker is on it — even one that
 * landed after step 1 (a concurrent reviewed insert this INSERT waited on).
 */
function guardedUpsert(document: NormalizedLegislationDocument): SqlStatement {
  return {
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
        legislation_url = excluded.legislation_url
      WHERE legislation_docs.reviewed_at IS NULL`,
    args: documentUpsertArgs(document),
  };
}

function documentUpsertArgs(document: NormalizedLegislationDocument): unknown[] {
  return [
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
  ];
}
