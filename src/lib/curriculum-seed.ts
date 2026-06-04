// Authoritative curriculum seed — ACARA v9 + EYLF v2.0 vertical slice (#2520)
//
// This is the representative, genuinely-useful slice that proves the pattern
// end-to-end: real ACARA v9 content descriptors (English + Mathematics) for
// Foundation, Year 3 and Year 6, plus the five EYLF v2.0 Learning Outcomes for
// Early Learning. Every `code` is the real authoritative identifier and every
// `descriptor` is the verbatim public text from the government framework — NOT
// paraphrased-and-relabelled. Where a code was not verified it is omitted
// rather than invented (see #2520 honesty constraint).
//
// Sources (all public Australian government curriculum documents):
//   - ACARA Australian Curriculum v9.0 — English F-10 & Mathematics F-10.
//     https://v9.australiancurriculum.edu.au
//     Descriptor text from the official "Curriculum content F-6" documents.
//     © ACARA 2022 (Copyright Act 1968 (Cth)); used per ACARA's terms of use.
//   - Belonging, Being & Becoming: The Early Years Learning Framework for
//     Australia V2.0 (2022). https://www.acecqa.gov.au — five Learning Outcomes.
//
// The full F-10 + senior secondary surface is deferred to a follow-up issue;
// this slice ships live via seedCurriculumIfEmpty() (idempotent, runs on first
// getDb()), and new grades can be bulk-loaded later through the admin ingest
// route POST /api/curriculum/ingest or the Python seed script.

import type { DbClient } from "./db";

export interface CurriculumFramework {
  id: string;
  name: string;
  shortName: string;
  authority: string;
  jurisdiction: string;
  version: string;
  frameworkUrl: string;
}

export interface CurriculumDescriptor {
  frameworkId: string;
  code: string;
  level: string;        // "F" | "3" | "6" | "EL"
  levelName: string;    // "Foundation" | "Year 3" | "Year 6" | "Early Learning (EYLF)"
  subject: string;      // PLG SubjectKind: English | Maths | Science | HASS | Health | DigiTech | Play
  learningArea: string;
  strand: string;
  title: string;        // short label for the PLG topic tile
  descriptor: string;   // verbatim content-descriptor / outcome text
  blurb: string;        // short plain-language gloss for the PLG tile
  sourceRef: string;
  sourceUrl: string;
}

export const CURRICULUM_FRAMEWORKS: CurriculumFramework[] = [
  {
    id: "acara-v9",
    name: "Australian Curriculum Version 9.0",
    shortName: "ACARA v9",
    authority: "Australian Curriculum, Assessment and Reporting Authority (ACARA)",
    jurisdiction: "AU",
    version: "9.0",
    frameworkUrl: "https://v9.australiancurriculum.edu.au",
  },
  {
    id: "eylf-v2",
    name: "Belonging, Being & Becoming: The Early Years Learning Framework for Australia V2.0",
    shortName: "EYLF v2.0",
    authority: "Australian Government Department of Education / ACECQA",
    jurisdiction: "AU",
    version: "2.0",
    frameworkUrl: "https://www.acecqa.gov.au/nqf/national-law-regulations/approved-learning-frameworks",
  },
];

// ── ACARA v9 — Foundation ───────────────────────────────────────────────────
const ACARA_FOUNDATION_URL =
  "https://v9.australiancurriculum.edu.au/f-10-curriculum/learning-areas?subjects-start-index=0";

const FOUNDATION: CurriculumDescriptor[] = [
  {
    frameworkId: "acara-v9",
    code: "AC9EFLY10",
    level: "F",
    levelName: "Foundation",
    subject: "English",
    learningArea: "English",
    strand: "Literacy — Phonic and word knowledge",
    title: "Phonemic awareness — blending and segmenting sounds",
    descriptor:
      "segment sentences into individual words; orally blend and segment single-syllable spoken words; isolate, blend and manipulate phonemes in single-syllable words (phonological awareness)",
    blurb: "Hear, blend and segment the sounds in short spoken words.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Foundation (Literacy)",
    sourceUrl: ACARA_FOUNDATION_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9EFLY09",
    level: "F",
    levelName: "Foundation",
    subject: "English",
    learningArea: "English",
    strand: "Literacy — Phonic and word knowledge",
    title: "Rhyme, alliteration and syllables",
    descriptor:
      "recognise and generate rhyming words, alliteration patterns, syllables and sounds (phonemes) in spoken words (phonological awareness)",
    blurb: "Spot and make rhymes; clap the syllables in words.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Foundation (Literacy)",
    sourceUrl: ACARA_FOUNDATION_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9MFN01",
    level: "F",
    levelName: "Foundation",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Number",
    title: "Naming and ordering numbers to 20",
    descriptor:
      "name, represent and order numbers including zero to at least 20, using physical and virtual materials and numerals",
    blurb: "Count, name and order numbers from zero to twenty.",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Foundation (Number)",
    sourceUrl: ACARA_FOUNDATION_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9MFSP01",
    level: "F",
    levelName: "Foundation",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Space",
    title: "Naming and finding familiar shapes",
    descriptor:
      "sort, name and create familiar shapes; recognise and describe familiar shapes within objects in the environment, giving reasons",
    blurb: "Name circles, squares and triangles in the world around you.",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Foundation (Space)",
    sourceUrl: ACARA_FOUNDATION_URL,
  },
];

// ── ACARA v9 — Year 1 ───────────────────────────────────────────────────────
const ACARA_Y1_URL =
  "https://v9.australiancurriculum.edu.au/f-10-curriculum/learning-areas?subjects-start-index=0";

const YEAR_1: CurriculumDescriptor[] = [
  {
    frameworkId: "acara-v9",
    code: "AC9E1LY10",
    level: "1",
    levelName: "Year 1",
    subject: "English",
    learningArea: "English",
    strand: "Literacy — Phonic and word knowledge",
    title: "Sounding out and blending to read",
    descriptor:
      "use short vowels, common long vowels, consonant blends and digraphs to write words, and blend these to read one- and two-syllable words",
    blurb: "Blend letter-sounds to read and write short words.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Year 1 (Literacy)",
    sourceUrl: ACARA_Y1_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9E1LE05",
    level: "1",
    levelName: "Year 1",
    subject: "English",
    learningArea: "English",
    strand: "Literature — Creating literature",
    title: "Retell or adapt a familiar story",
    descriptor:
      "orally retell or adapt a familiar story using plot and characters, language features including vocabulary, and structure of a familiar text, through role-play, writing, drawing or digital tools",
    blurb: "Retell a favourite story your own way — characters, plot, ending.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Year 1 (Literature)",
    sourceUrl: ACARA_Y1_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9M1N01",
    level: "1",
    levelName: "Year 1",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Number",
    title: "Numbers to 120",
    descriptor:
      "recognise, represent and order numbers to at least 120 using physical and virtual materials, numerals, number lines and charts",
    blurb: "Read, write and order numbers all the way to 120.",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Year 1 (Number)",
    sourceUrl: ACARA_Y1_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9M1N04",
    level: "1",
    levelName: "Year 1",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Number",
    title: "Add and subtract within 20",
    descriptor:
      "add and subtract numbers within 20, using physical and virtual materials, part-part-whole knowledge to 10 and a variety of calculation strategies",
    blurb: "Add and take away numbers up to 20.",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Year 1 (Number)",
    sourceUrl: ACARA_Y1_URL,
  },
];

// ── ACARA v9 — Year 3 ───────────────────────────────────────────────────────
const ACARA_Y3_URL =
  "https://v9.australiancurriculum.edu.au/f-10-curriculum/learning-areas?subjects-start-index=0";

const YEAR_3: CurriculumDescriptor[] = [
  {
    frameworkId: "acara-v9",
    code: "AC9E3LY06",
    level: "3",
    levelName: "Year 3",
    subject: "English",
    learningArea: "English",
    strand: "Literacy — Creating texts",
    title: "Plan and create persuasive and informative texts",
    descriptor:
      "plan, create, edit and publish imaginative, informative and persuasive written and multimodal texts, using visual features, appropriate form and layout, with ideas grouped in simple paragraphs, mostly correct tense, topic-specific vocabulary and correct spelling of most high-frequency and phonetically regular words",
    blurb: "Plan and write a short text that informs or persuades, in paragraphs.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Year 3 (Literacy)",
    sourceUrl: ACARA_Y3_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9E3LE05",
    level: "3",
    levelName: "Year 3",
    subject: "English",
    learningArea: "English",
    strand: "Literature — Creating literature",
    title: "Create and edit imaginative texts",
    descriptor:
      "create and edit imaginative texts, using or adapting language features, characters, settings, plot structures and ideas encountered in literary texts",
    blurb: "Write and improve a story, borrowing ideas from books you have read.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Year 3 (Literature)",
    sourceUrl: ACARA_Y3_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9M3N02",
    level: "3",
    levelName: "Year 3",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Number",
    title: "Unit fractions — halves, thirds, quarters, fifths, tenths",
    descriptor:
      "recognise and represent unit fractions including 1/2, 1/3, 1/4, 1/5 and 1/10 and their multiples in different ways; combine fractions with the same denominator to complete the whole",
    blurb: "Name and represent halves, thirds, quarters, fifths and tenths.",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Year 3 (Number)",
    sourceUrl: ACARA_Y3_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9M3N04",
    level: "3",
    levelName: "Year 3",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Number",
    title: "Multiply and divide using arrays and number sentences",
    descriptor:
      "multiply and divide one- and two-digit numbers, representing problems using number sentences, diagrams and arrays, and using a variety of calculation strategies",
    blurb: "Use arrays and number sentences to multiply and divide.",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Year 3 (Number)",
    sourceUrl: ACARA_Y3_URL,
  },
];

// ── ACARA v9 — Year 6 ───────────────────────────────────────────────────────
const ACARA_Y6_URL =
  "https://v9.australiancurriculum.edu.au/f-10-curriculum/learning-areas?subjects-start-index=0";

const YEAR_6: CurriculumDescriptor[] = [
  {
    frameworkId: "acara-v9",
    code: "AC9E6LY07",
    level: "6",
    levelName: "Year 6",
    subject: "English",
    learningArea: "English",
    strand: "Literacy — Creating texts",
    title: "Plan and deliver presentations with argument",
    descriptor:
      "plan, create, rehearse and deliver spoken and multimodal presentations that include information, arguments and details that develop a theme or idea, organising ideas using precise topic-specific and technical vocabulary, pitch, tone, pace, volume, and visual and digital features",
    blurb: "Build and deliver a presentation that argues a point with evidence.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Year 6 (Literacy)",
    sourceUrl: ACARA_Y6_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9E6LA02",
    level: "6",
    levelName: "Year 6",
    subject: "English",
    learningArea: "English",
    strand: "Language — Language for interacting with others",
    title: "Objective vs subjective language; identifying bias",
    descriptor:
      "understand the uses of objective and subjective language, and identify bias",
    blurb: "Tell fact-style language from opinion-style language; spot bias.",
    sourceRef: "ACARA Australian Curriculum v9.0 — English, Year 6 (Language)",
    sourceUrl: ACARA_Y6_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9M6A02",
    level: "6",
    levelName: "Year 6",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Algebra",
    title: "Order of operations with brackets",
    descriptor:
      "find unknown values in numerical equations involving brackets and combinations of arithmetic operations, using the properties of numbers and operations",
    blurb: "Evaluate multi-step expressions with brackets and operations.",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Year 6 (Algebra)",
    sourceUrl: ACARA_Y6_URL,
  },
  {
    frameworkId: "acara-v9",
    code: "AC9M6N07",
    level: "6",
    levelName: "Year 6",
    subject: "Maths",
    learningArea: "Mathematics",
    strand: "Number",
    title: "Fractions, decimals and percentages of a quantity",
    descriptor:
      "solve problems that require finding a familiar fraction, decimal or percentage of a quantity, including percentage discounts, choosing efficient calculation strategies and using digital tools where appropriate",
    blurb: "Find a fraction, decimal or percentage of an amount (incl. discounts).",
    sourceRef: "ACARA Australian Curriculum v9.0 — Mathematics, Year 6 (Number)",
    sourceUrl: ACARA_Y6_URL,
  },
];

// ── EYLF v2.0 — Early Learning (the five Learning Outcomes) ──────────────────
const EYLF_URL =
  "https://www.acecqa.gov.au/sites/default/files/2023-01/EYLF-2022-V2.0.pdf";

const EYLF: CurriculumDescriptor[] = [
  {
    frameworkId: "eylf-v2",
    code: "EYLF-LO1",
    level: "EL",
    levelName: "Early Learning (EYLF)",
    subject: "Health",
    learningArea: "Belonging, Being & Becoming",
    strand: "Outcome 1: Identity",
    title: "Children have a strong sense of identity",
    descriptor: "Children have a strong sense of identity",
    blurb: "Belonging, confidence and a sense of who they are.",
    sourceRef: "Belonging, Being & Becoming: The Early Years Learning Framework for Australia V2.0 (2022)",
    sourceUrl: EYLF_URL,
  },
  {
    frameworkId: "eylf-v2",
    code: "EYLF-LO2",
    level: "EL",
    levelName: "Early Learning (EYLF)",
    subject: "HASS",
    learningArea: "Belonging, Being & Becoming",
    strand: "Outcome 2: Community",
    title: "Children are connected with and contribute to their world",
    descriptor: "Children are connected with and contribute to their world",
    blurb: "Belonging to groups; caring for people, places and Country.",
    sourceRef: "Belonging, Being & Becoming: The Early Years Learning Framework for Australia V2.0 (2022)",
    sourceUrl: EYLF_URL,
  },
  {
    frameworkId: "eylf-v2",
    code: "EYLF-LO3",
    level: "EL",
    levelName: "Early Learning (EYLF)",
    subject: "Health",
    learningArea: "Belonging, Being & Becoming",
    strand: "Outcome 3: Wellbeing",
    title: "Children have a strong sense of wellbeing",
    descriptor: "Children have a strong sense of wellbeing",
    blurb: "Big feelings, healthy bodies, and asking for help.",
    sourceRef: "Belonging, Being & Becoming: The Early Years Learning Framework for Australia V2.0 (2022)",
    sourceUrl: EYLF_URL,
  },
  {
    frameworkId: "eylf-v2",
    code: "EYLF-LO4",
    level: "EL",
    levelName: "Early Learning (EYLF)",
    subject: "Play",
    learningArea: "Belonging, Being & Becoming",
    strand: "Outcome 4: Confident and involved learners",
    title: "Children are confident and involved learners",
    descriptor: "Children are confident and involved learners",
    blurb: "Curiosity, problem-solving and learning through play.",
    sourceRef: "Belonging, Being & Becoming: The Early Years Learning Framework for Australia V2.0 (2022)",
    sourceUrl: EYLF_URL,
  },
  {
    frameworkId: "eylf-v2",
    code: "EYLF-LO5",
    level: "EL",
    levelName: "Early Learning (EYLF)",
    subject: "English",
    learningArea: "Belonging, Being & Becoming",
    strand: "Outcome 5: Communication",
    title: "Children are effective communicators",
    descriptor: "Children are effective communicators",
    blurb: "Talking, listening, stories, early reading and mark-making.",
    sourceRef: "Belonging, Being & Becoming: The Early Years Learning Framework for Australia V2.0 (2022)",
    sourceUrl: EYLF_URL,
  },
];

export const CURRICULUM_DESCRIPTORS: CurriculumDescriptor[] = [
  ...EYLF,
  ...FOUNDATION,
  ...YEAR_1,
  ...YEAR_3,
  ...YEAR_6,
];

/**
 * Idempotent curriculum seed — mirrors seedIfEmpty() in db.ts.
 *
 * Runs on first getDb() (called from initSchema). Inserts the framework rows
 * and the descriptor slice with ON CONFLICT DO NOTHING so re-runs and partial
 * states are safe. New descriptors added to CURRICULUM_DESCRIPTORS later are
 * picked up automatically because the guard is row-level (ON CONFLICT), not a
 * single COUNT short-circuit — adding a grade and redeploying back-fills it.
 */
export async function seedCurriculum(db: DbClient): Promise<void> {
  for (const fw of CURRICULUM_FRAMEWORKS) {
    await db.execute({
      sql: `INSERT INTO curriculum_frameworks
              (id, name, short_name, authority, jurisdiction, version, framework_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING`,
      args: [fw.id, fw.name, fw.shortName, fw.authority, fw.jurisdiction, fw.version, fw.frameworkUrl],
    });
  }

  for (let i = 0; i < CURRICULUM_DESCRIPTORS.length; i++) {
    const d = CURRICULUM_DESCRIPTORS[i];
    await db.execute({
      sql: `INSERT INTO curriculum_descriptors
              (id, framework_id, code, level, level_name, subject, learning_area,
               strand, title, descriptor, blurb, source_ref, source_url, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (framework_id, code) DO NOTHING`,
      args: [
        `${d.frameworkId}/${d.code}`,
        d.frameworkId,
        d.code,
        d.level,
        d.levelName,
        d.subject,
        d.learningArea,
        d.strand,
        d.title,
        d.descriptor,
        d.blurb,
        d.sourceRef,
        d.sourceUrl,
        i,
      ],
    });
  }
}
