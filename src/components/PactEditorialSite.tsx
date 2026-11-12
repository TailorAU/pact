"use client";

import React, { useState } from "react";

export type PactPageId =
  | "home"
  | "space"
  | "protocol"
  | "platform"
  | "market"
  | "research"
  | "company";

const C = {
  paper: "#FFFFFF",
  paper2: "#F5F5F5",
  ink: "#0A0A0A",
  euc: "#000000",
  ox: "#525252",
  rust: "#525252",
  hair: "#E5E5E5",
  muted: "#525252",
} as const;

const STAGES = [
  {
    num: "01",
    title: "Your Information & Intent",
    branch: false,
    body: "The buyer states what the work is for and what may be used. Documents, purpose and limits enter as a declared intent, so every later step can be checked against it.",
    trace:
      'intent.declare\n  purpose   "compare contract versions"\n  inputs    2 documents · buyer-held\n  limits    residency=AU · retain=none',
  },
  {
    num: "02",
    title: "PACT Consensus & Policy",
    branch: false,
    body: "Independent agents test the request against policy and the buyer's rules. Agreement, dissent and any escalation to a person are written to the record before work is routed.",
    trace:
      "consensus.resolve\n  agents    3 · agree 3 · dissent 0\n  policy    buyer-rules v4 · pass\n  gate      no human approval required",
  },
  {
    num: "03",
    title: "Qualified Routing",
    branch: true,
    body: "Work goes only to qualified supply that meets residency, capability and security criteria. If the primary route fails, failover is permitted only to destinations the buyer has already allowed.",
    trace:
      'route.select\n  primary   AU · qualified supplier\n  failover  permitted · buyer-approved list\n  excluded  non-qualified · out-of-policy\n  clearing_rule: "cheapest_qualified_token"',
  },
  {
    num: "04",
    title: "Traceable Result",
    branch: false,
    body: "The result returns with a receipt: where it was processed, by which model and provider, from which sources, under whose authority, and at what cost.",
    trace:
      'receipt.issue\n  location  Australia · Sydney\n  sources   2 · hashed\n  authority buyer delegate · reversible\n  clearing_rule: "cheapest_qualified_token"\n  effective_rate_aud_per_1m: "$1.18"\n  unrouted_frontier_aud_per_1m: "$15.00"',
  },
] as const;

const PILLARS: {
  status: string;
  tone: string;
  title: string;
  body: string;
  space?: boolean;
  link: string;
  page: PactPageId;
}[] = [
  {
    status: "Available · MIT",
    tone: C.euc,
    title: "Protocol & Open Knowledge",
    body: "Multi-agent consensus with recorded agreement and dissent, Space (pact.tailor.au/map) — the shared X, Y, Z, T layer of public law and verified consensus above every Fabric, and a free Australian Legislation API.",
    space: true,
    link: "Read the protocol",
    page: "protocol",
  },
  {
    status: "Proposed · PACT routing",
    tone: C.rust,
    title: "Managed Delivery & Routing",
    body: "Policy-governed API routing, permitted failover within buyer rules, and a full provenance receipt for every call.",
    link: "See the routing walkthrough",
    page: "platform",
  },
  {
    status: "Beta by request",
    tone: C.ox,
    title: "Capacity Market",
    body: "Qualified supply and demand across Firm, Floating and Reserve contracts, and Intelligence Offtake Agreements.",
    link: "Enter the market",
    page: "market",
  },
];

const EVIDENCE = [
  {
    figure: "39.6% renewable",
    label: "Share of Australian electricity generation",
    source: "DCCEEW",
  },
  {
    figure: "NCI Gadi",
    label: "Operating national research computing",
    source: "NCI",
  },
  {
    figure: "Research into industry",
    label: "Applied AI strengths and commercialisation",
    source: "NAIC / CSIRO",
  },
] as const;

const STEPS = [
  {
    name: "Intent",
    who: "Requesting agent",
    next: "Constraints",
    body: "An agent declares what it is trying to establish and why. Intent fixes the question so that later positions can be judged against it.",
    record:
      '{ "state": "INTENT",\n  "by": "agent:requester",\n  "question": "May this file be summarised offshore?",\n  "purpose": "client service" }',
  },
  {
    name: "Constraints",
    who: "Any participant",
    next: "Propose",
    body: "Participants state the rules that bound an answer: jurisdiction, consent, residency, reversibility. Constraints are recorded before any position is taken.",
    record:
      '{ "state": "CONSTRAINTS",\n  "jurisdiction": "AU",\n  "consent": "service delivery only",\n  "residency": "AU preferred" }',
  },
  {
    name: "Propose",
    who: "Independent agents",
    next: "Challenge",
    body: "Each agent proposes a position and must cite primary sources. A position without a source cannot advance.",
    record:
      '{ "state": "PROPOSE",\n  "by": "agent:b",\n  "position": "Permitted with reasonable steps",\n  "sources": ["Privacy Act 1988 (Cth) Sch 1, APP 8"] }',
  },
  {
    name: "Challenge",
    who: "Independent agents",
    next: "Agreement or Escalate",
    body: "Any agent may challenge a position or record dissent. Dissent is kept with the claim permanently; it is never averaged away.",
    record:
      '{ "state": "CHALLENGE",\n  "by": "agent:c",\n  "dissent": "Overseas recipient not yet identified",\n  "retained": true }',
  },
  {
    name: "Agreement",
    who: "Quorum",
    next: "Record published",
    body: "When the quorum agrees within the stated constraints, the claim is published to the canonical record with its sources and dissent attached.",
    record:
      '{ "state": "AGREEMENT",\n  "quorum": "3 of 3 on conditions",\n  "dissent_count": 1,\n  "published": "record/rc-0412" }',
  },
  {
    name: "Escalate",
    who: "Human gate",
    next: "Human decision",
    body: "If agents cannot agree, or the decision exceeds their delegated authority, the record is sent to a named person. Their decision is recorded as authority, not consensus.",
    record:
      '{ "state": "ESCALATE",\n  "reason": "exceeds delegated authority",\n  "to": "human:privacy-officer",\n  "status": "awaiting decision" }',
  },
] as const;

type ExplorerNodeType = "topic" | "leg" | "scen";
const NODES: { id: string; type: ExplorerNodeType; label: string }[] = [
  { id: "t-xb", type: "topic", label: "Cross-border disclosure" },
  { id: "t-adm", type: "topic", label: "Automated decision-making" },
  { id: "t-pi", type: "topic", label: "Personal information handling" },
  { id: "l-pa", type: "leg", label: "Privacy Act 1988 (Cth)" },
  { id: "l-app8", type: "leg", label: "APP 8: Cross-border disclosure" },
  {
    id: "l-pola",
    type: "leg",
    label: "Privacy and Other Legislation Amendment Act 2024 (Cth)",
  },
  {
    id: "l-soci",
    type: "leg",
    label: "Security of Critical Infrastructure Act 2018 (Cth)",
  },
  {
    id: "s-off",
    type: "scen",
    label: "Agent summarises a client file using offshore capacity",
  },
  {
    id: "s-credit",
    type: "scen",
    label: "Agent recommends declining a credit application",
  },
  {
    id: "s-fail",
    type: "scen",
    label: "Routing fails over during a regional outage",
  },
];

const EDGES: [string, string][] = [
  ["t-xb", "l-app8"],
  ["t-xb", "l-pa"],
  ["t-pi", "l-pa"],
  ["t-pi", "l-pola"],
  ["t-adm", "l-pola"],
  ["t-adm", "l-pa"],
  ["s-off", "t-xb"],
  ["s-off", "l-app8"],
  ["s-off", "t-pi"],
  ["s-credit", "t-adm"],
  ["s-credit", "l-pola"],
  ["s-fail", "t-xb"],
  ["s-fail", "l-soci"],
];

const AG = "agreed";
const DS = "dissent";
const ES = "escalated";

const RECS: Record<
  string,
  {
    st: string;
    claim: string;
    agents: string;
    sources: string[];
    dissent: string;
    authority: string;
  }
> = {
  "t-xb": {
    st: DS,
    claim:
      "Disclosure of personal information to an overseas recipient requires reasonable steps to ensure the recipient handles it consistently with the APPs.",
    agents: "4 agents · 3 agree · 1 dissent",
    sources: [
      "Privacy Act 1988 (Cth) Sch 1, APP 8.1",
      "Privacy Act 1988 (Cth) s 16C",
    ],
    dissent:
      "One agent holds that routing to a processor is a use, not a disclosure, in some configurations.",
    authority:
      "Classification of use vs disclosure in a specific contract is reserved to the buyer's privacy officer.",
  },
  "t-adm": {
    st: AG,
    claim:
      "Privacy policies must describe the kinds of decisions made by computer programs that use personal information and significantly affect individuals.",
    agents: "3 agents · 3 agree · 0 dissent",
    sources: ["Privacy and Other Legislation Amendment Act 2024 (Cth) Sch 1"],
    dissent: "None recorded.",
    authority:
      'Whether a given decision "significantly affects" an individual is escalated to a person.',
  },
  "t-pi": {
    st: AG,
    claim:
      "Personal information handled by agents remains subject to the Australian Privacy Principles regardless of which model processes it.",
    agents: "3 agents · 3 agree · 0 dissent",
    sources: ["Privacy Act 1988 (Cth) s 6", "Privacy Act 1988 (Cth) Sch 1"],
    dissent: "None recorded.",
    authority: "Consent scope is set by the buyer and cannot be widened by an agent.",
  },
  "l-pa": {
    st: AG,
    claim:
      "Principal Commonwealth statute regulating the handling of personal information by APP entities.",
    agents: "Source node · verified against Federal Register of Legislation",
    sources: ["Federal Register of Legislation · C2004A03712"],
    dissent: "None recorded.",
    authority:
      "Interpretation for a specific matter is not provided by the record.",
  },
  "l-app8": {
    st: DS,
    claim:
      "APP 8 sets the conditions for cross-border disclosure; s 16C can make the disclosing entity accountable for the overseas recipient's acts.",
    agents: "4 agents · 3 agree · 1 dissent",
    sources: ["Privacy Act 1988 (Cth) Sch 1, APP 8", "OAIC APP Guidelines, Ch 8"],
    dissent:
      'Scope of the "substantially similar" exception remains contested between agents.',
    authority: "Reliance on any exception requires a named human decision.",
  },
  "l-pola": {
    st: AG,
    claim:
      "Amends the Privacy Act, including new transparency obligations for automated decisions.",
    agents: "Source node · verified against Federal Register of Legislation",
    sources: ["Federal Register of Legislation · Act No. 128, 2024"],
    dissent: "None recorded.",
    authority:
      "Commencement dates for each schedule are checked against the Act text before reliance.",
  },
  "l-soci": {
    st: AG,
    claim:
      "Imposes obligations on responsible entities for critical infrastructure assets, including data storage or processing assets.",
    agents: "Source node · verified against Federal Register of Legislation",
    sources: ["Security of Critical Infrastructure Act 2018 (Cth)"],
    dissent: "None recorded.",
    authority:
      "Whether a supplier's asset is in scope is determined by the supplier and regulator.",
  },
  "s-off": {
    st: ES,
    claim:
      "Offshore summarisation of a client file may proceed only if the overseas recipient is identified and APP 8 steps are documented.",
    agents: "3 agents · 2 agree · 1 dissent → escalated",
    sources: ["APP 8.1", "s 16C", "Buyer rules v4 · residency clause"],
    dissent:
      "Recipient identity was not supplied; one agent refused to agree on conditions.",
    authority:
      "Escalated to the buyer's privacy officer. No routing until a person decides.",
  },
  "s-credit": {
    st: ES,
    claim:
      "An agent may draft a recommendation, but a decision to decline credit must be made and recorded by a person.",
    agents: "3 agents · 3 agree on escalation",
    sources: ["POLA Act 2024 Sch 1", "Buyer delegation register"],
    dissent: "None recorded.",
    authority:
      "Decision reserved to a credit officer. Agent output is advisory only.",
  },
  "s-fail": {
    st: AG,
    claim:
      "Failover during an outage may use only destinations already on the buyer's permitted list; otherwise work is held.",
    agents: "3 agents · 3 agree · 0 dissent",
    sources: [
      "Buyer rules v4 · failover clause",
      "SOCI Act 2018 (supplier obligations)",
    ],
    dissent: "None recorded.",
    authority:
      "Adding a new failover destination requires a human change to the buyer rules.",
  },
};

const TYPE_LABEL: Record<ExplorerNodeType, string> = {
  topic: "Topic",
  leg: "Australian Legislation",
  scen: "Scenario",
};

const LOCS = [
  {
    id: "UK",
    label: "United Kingdom",
    fail: "United Kingdom · London",
    basis: "UK buyer rules permit failover to UK-resident qualified capacity.",
  },
  {
    id: "CA",
    label: "Canada",
    fail: "Canada · Toronto",
    basis:
      "Canadian buyer rules permit failover to Canadian-resident qualified capacity.",
  },
  {
    id: "NZ",
    label: "New Zealand",
    fail: "New Zealand · Auckland",
    basis: "NZ buyer rules permit trans-Tasman failover only.",
  },
  {
    id: "US",
    label: "United States",
    fail: "United States · Virginia",
    basis: "US buyer rules permit failover to US-resident qualified capacity.",
  },
  {
    id: "AU",
    label: "Australia",
    fail: "Australia · Melbourne only",
    basis: "Australian residency required. No offshore failover.",
  },
] as const;

const TASKS: Record<
  string,
  {
    label: string;
    model: string;
    sources: string;
    authority: string;
    perf: string;
  }
> = {
  compare: {
    label: "Compare two documents",
    model: "Long-context reasoning class\nQualified supplier AU-1 (Sydney)",
    sources:
      "Buyer document A · v3 · sha256 9f2c…e41a\nBuyer document B · v1 · sha256 41bd…07c3",
    authority:
      "3 agents · 2 agree · 1 dissent on materiality of clause 4.2\nReleased under buyer delegate authority · reversible",
    perf: "p50 6.8 s · est. A$0.42 per task\nDrawn from prepaid credits",
  },
  summarise: {
    label: "Summarise source material",
    model: "Summarisation class\nQualified supplier AU-2 (Sydney)",
    sources: "Source pack · 14 documents\n4 passages cited in output",
    authority: "3 agents · 3 agree · no dissent\nAuto-release within policy",
    perf: "p50 3.1 s · est. A$0.09 per task\nDrawn from prepaid credits",
  },
};

const TIERS = [
  {
    id: "firm",
    label: "Firm",
    share: 55,
    body: "Contract a predictable base under agreed terms.",
    facts: [
      { k: "Use", v: "Steady production workloads with known volume" },
      { k: "Term", v: "Fixed volume and price for an agreed period" },
      { k: "Clears", v: "At contract signature, against qualified supply" },
    ],
  },
  {
    id: "floating",
    label: "Floating",
    share: 30,
    body: "Cover variable peaks, batch workloads, and specialist models as eligible capacity clears.",
    facts: [
      { k: "Use", v: "Seasonal peaks, batch jobs, specialist models" },
      { k: "Term", v: "Drawn as needed within a pre-agreed ceiling" },
      { k: "Clears", v: "When eligible capacity is available" },
    ],
  },
  {
    id: "reserve",
    label: "Reserve",
    share: 15,
    body: "Keep qualified capacity ready for disruption or failover within policy.",
    facts: [
      { k: "Use", v: "Continuity during outages or supplier disruption" },
      { k: "Term", v: "Standby fee; usage only on activation" },
      { k: "Clears", v: "On a permitted failover event" },
    ],
  },
] as const;

const GRID = [
  {
    k: "Jurisdiction",
    d: "Where work may be processed and fail over",
    s: "Data-centre location and legal entity",
  },
  {
    k: "Capability",
    d: "Task class and required evaluation results",
    s: "Independent evaluation on the stated task class",
  },
  {
    k: "Security",
    d: "Required controls and assurance level",
    s: "Current certification and audit evidence",
  },
  {
    k: "Provenance",
    d: "Receipt fields the buyer must receive",
    s: "Ability to emit a complete PACT receipt",
  },
  {
    k: "Availability",
    d: "Firm, Floating or Reserve profile",
    s: "Committed capacity and continuity plan",
  },
  {
    k: "Price",
    d: "Maximum $/1M token ceiling and volume",
    s: "Lowest $/1M token bid among qualified providers — cleared automatically to the cheapest token",
  },
] as const;

const REG: Record<string, { k: string; v: string; src: string }[]> = {
  AU: [
    {
      k: "Electricity generation mix",
      v: "Renewable share of generation, by state",
      src: "DCCEEW",
    },
    {
      k: "National research computing",
      v: "Operating national facilities",
      src: "NCI · Pawsey",
    },
    {
      k: "Grid and connection",
      v: "Connection pipeline and constraints",
      src: "AEMO",
    },
    {
      k: "Applied AI capability",
      v: "Research strengths and commercialisation",
      src: "CSIRO · NAIC",
    },
  ],
  UK: [
    {
      k: "Electricity generation mix",
      v: "Generation by source",
      src: "DESNZ",
    },
    {
      k: "National research computing",
      v: "Public AI research compute",
      src: "UKRI",
    },
    {
      k: "Grid and connection",
      v: "Connection queue reform",
      src: "NESO",
    },
  ],
  US: [
    {
      k: "Electricity generation mix",
      v: "Generation by source and state",
      src: "EIA",
    },
    {
      k: "National research computing",
      v: "National laboratory systems",
      src: "DOE",
    },
    {
      k: "Grid and connection",
      v: "Interconnection queue rules",
      src: "FERC",
    },
  ],
};

const ROLES = [
  {
    k: "PACT protocol",
    v: "Open protocol for agent consensus, dissent and human escalation, with the Open Knowledge API.",
    s: "Available · MIT",
    tone: C.euc,
  },
  {
    k: "Space",
    v: "Shared X, Y, Z, T layer of legislation, standards, scenarios, and verified consensus above every Fabric · pact.tailor.au/map",
    s: "Available · MIT",
    tone: C.euc,
  },
  {
    k: "Research & advisory",
    v: "Infrastructure Evidence Register, evidence briefs and commissioned advisory.",
    s: "Available",
    tone: C.euc,
  },
  {
    k: "Market framework",
    v: "Firm, Floating and Reserve contracts and Intelligence Offtake Agreements.",
    s: "Beta by request",
    tone: C.ox,
  },
  {
    k: "PACT routing",
    v: "Commercial inference routing under PACT policy, with receipts. Prepaid credits.",
    s: "Proposed",
    tone: C.rust,
  },
  {
    k: "Tailor application engine",
    v: "Applications built by Tailor on the PACT record.",
    s: "Tailor",
    tone: C.muted,
  },
] as const;

type MapNode = {
  id: string;
  type: ExplorerNodeType;
  label: string;
  warrant: "empirical" | "institutional" | "interpretive" | null;
  status: "verified" | "open" | "proposed" | "challenged";
  depth: number;
  x: number;
  y: number;
  claim: string;
  src: string;
};

const MN: MapNode[] = [
  {
    id: "t-si",
    type: "topic",
    label: "SI base constants",
    warrant: "empirical",
    status: "verified",
    depth: 0,
    x: 60,
    y: 80,
    claim:
      "The SI is defined by seven fixed constants, including c, h, e, k and the Avogadro constant.",
    src: "BIPM · SI Brochure, 9th edition",
  },
  {
    id: "l-jorc",
    type: "leg",
    label: "JORC Code 2012",
    warrant: "institutional",
    status: "verified",
    depth: 0,
    x: 60,
    y: 152,
    claim:
      "Australasian code for reporting exploration results, mineral resources and ore reserves.",
    src: "Joint Ore Reserves Committee · 2012 Edition",
  },
  {
    id: "l-seq",
    type: "leg",
    label: "QLD Faster Rail / ShapingSEQ 2023",
    warrant: "institutional",
    status: "verified",
    depth: 0,
    x: 60,
    y: 224,
    claim:
      "Queensland regional plan and rail program instruments for South East Queensland.",
    src: "Queensland Government · ShapingSEQ 2023",
  },
  {
    id: "l-nsla",
    type: "leg",
    label: "Foreign Acquisitions and Takeovers Act 1975 (Cth)",
    warrant: "institutional",
    status: "verified",
    depth: 0,
    x: 60,
    y: 306,
    claim:
      "Commonwealth Act regulating foreign acquisitions and investment in Australia.",
    src: "Federal Register of Legislation (CTH)",
  },
  {
    id: "l-safe",
    type: "leg",
    label: "Safeguards Act 1973 (Cth)",
    warrant: "institutional",
    status: "verified",
    depth: 0,
    x: 60,
    y: 378,
    claim: "Commonwealth Act giving effect to nuclear safeguards obligations.",
    src: "Federal Register of Legislation (CTH)",
  },
  {
    id: "l-itar",
    type: "leg",
    label: "ITAR 22 CFR 120–130",
    warrant: "institutional",
    status: "verified",
    depth: 0,
    x: 60,
    y: 450,
    claim: "US International Traffic in Arms Regulations.",
    src: "US eCFR · Title 22, Parts 120–130",
  },
  {
    id: "l-ear",
    type: "leg",
    label: "EAR 15 CFR 730–774",
    warrant: "institutional",
    status: "verified",
    depth: 0,
    x: 60,
    y: 522,
    claim: "US Export Administration Regulations.",
    src: "US eCFR · Title 15, Parts 730–774",
  },
  {
    id: "t-asx",
    type: "topic",
    label: "ASX Listing Rule 3.1 immediate disclosure",
    warrant: "institutional",
    status: "verified",
    depth: 1,
    x: 350,
    y: 110,
    claim:
      "A listed entity must immediately tell ASX information a reasonable person would expect to materially affect its securities.",
    src: "ASX Listing Rules · Chapter 3, Rule 3.1",
  },
  {
    id: "t-qld",
    type: "topic",
    label: "QLD Budget FY2026-27 fiscal aggregates",
    warrant: "empirical",
    status: "proposed",
    depth: 1,
    x: 350,
    y: 230,
    claim:
      "Fiscal aggregates are as published in the Queensland Budget papers for FY2026-27.",
    src: "Queensland Treasury · Budget Paper 2",
  },
  {
    id: "t-class",
    type: "topic",
    label: "Controlled-technology classification",
    warrant: "interpretive",
    status: "challenged",
    depth: 1,
    x: 350,
    y: 480,
    claim:
      "Whether a technology is export-controlled depends on its listing under ITAR or EAR.",
    src: "ITAR 22 CFR 120–130 · EAR 15 CFR 730–774",
  },
  {
    id: "t-min",
    type: "topic",
    label: "Mineral resource estimate disclosure",
    warrant: "interpretive",
    status: "verified",
    depth: 2,
    x: 630,
    y: 120,
    claim:
      "Public reports of mineral resources by listed entities are prepared under the JORC Code 2012.",
    src: "ASX Listing Rules · Chapter 5 · JORC Code 2012",
  },
  {
    id: "t-rail",
    type: "topic",
    label: "SEQ rail corridor delivery timing",
    warrant: "interpretive",
    status: "proposed",
    depth: 2,
    x: 630,
    y: 240,
    claim:
      "Delivery timing of SEQ rail corridors depends on funding in the forward estimates.",
    src: "ShapingSEQ 2023 · Queensland Budget papers",
  },
  {
    id: "t-firb",
    type: "topic",
    label: "FIRB critical-technologies notification",
    warrant: "institutional",
    status: "open",
    depth: 2,
    x: 630,
    y: 410,
    claim:
      "Foreign investment involving critical technologies may require notification for national security review.",
    src: "Foreign Acquisitions and Takeovers Act 1975 (Cth) & Foreign Acquisitions and Takeovers Regulation 2015 — FIRB Guidance Note 8",
  },
  {
    id: "s-miner",
    type: "scen",
    label: "Listed miner announces a resource upgrade",
    warrant: null,
    status: "verified",
    depth: 3,
    x: 900,
    y: 120,
    claim:
      "Applies when: entity is ASX-listed and reports a changed mineral resource.",
    src: "Linked claims and legislation",
  },
  {
    id: "s-rail",
    type: "scen",
    label: "Agency plans SEQ rail investment",
    warrant: null,
    status: "proposed",
    depth: 3,
    x: 900,
    y: 250,
    claim:
      "Applies when: Queensland agency commits capital to an SEQ rail corridor.",
    src: "Linked claims and legislation",
  },
  {
    id: "s-acq",
    type: "scen",
    label: "Foreign investor acquires a dual-use technology firm",
    warrant: null,
    status: "open",
    depth: 3,
    x: 900,
    y: 430,
    claim:
      "Applies when: foreign person acquires an interest in an Australian firm holding controlled technology.",
    src: "Linked claims and legislation",
  },
];

type MapEdgeKind = "depends_on" | "cites" | "applies_when";
const ME: [string, string, MapEdgeKind][] = [
  ["t-min", "t-asx", "depends_on"],
  ["t-min", "t-si", "depends_on"],
  ["t-min", "l-jorc", "cites"],
  ["t-rail", "t-qld", "depends_on"],
  ["t-rail", "l-seq", "cites"],
  ["t-qld", "l-seq", "cites"],
  ["t-firb", "t-class", "depends_on"],
  ["t-firb", "l-nsla", "cites"],
  ["t-class", "l-itar", "cites"],
  ["t-class", "l-ear", "cites"],
  ["s-miner", "t-min", "applies_when"],
  ["s-miner", "t-asx", "applies_when"],
  ["s-rail", "t-rail", "applies_when"],
  ["s-rail", "t-qld", "applies_when"],
  ["s-acq", "t-firb", "applies_when"],
  ["s-acq", "t-class", "applies_when"],
];

const MES: Record<MapEdgeKind, string> = {
  depends_on: "1.5px solid #000000",
  cites: "1.5px dashed #525252",
  applies_when: "2px dotted #000000",
};

const MEL: Record<MapEdgeKind, string> = {
  cites: "Cites statute",
  depends_on: "Builds on",
  applies_when: "Applies when",
};

const MWL: Record<string, string> = {
  empirical: "Empirical",
  institutional: "Statutory / Institutional",
  interpretive: "Interpretive",
};

const MSHAPE: Record<
  ExplorerNodeType,
  { w: string; h: string; radius: string; tf: string }
> = {
  leg: { w: "26px", h: "16px", radius: "0", tf: "translate(-50%,-50%)" },
  topic: { w: "18px", h: "18px", radius: "50%", tf: "translate(-50%,-50%)" },
  scen: {
    w: "16px",
    h: "16px",
    radius: "0",
    tf: "translate(-50%,-50%) rotate(45deg)",
  },
};

const MTYPE: Record<ExplorerNodeType, string> = {
  leg: "Legislation & Standards",
  topic: "Verified Claim",
  scen: "Trigger Scenario",
};

const PAGES: PactPageId[] = [
  "home",
  "space",
  "protocol",
  "platform",
  "market",
  "research",
  "company",
];

const PAGE_PATHS: Record<PactPageId, string> = {
  home: "/",
  space: "/map",
  protocol: "/protocol",
  platform: "/platform",
  market: "/market",
  research: "/research",
  company: "/company",
};

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export function PactEditorialSite({
  initialPage = "home",
}: {
  initialPage?: PactPageId;
}) {
  const [page, setPage] = useState<PactPageId>(initialPage);
  const [stageIdx, setStageIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [nodeId, setNodeId] = useState("s-off");
  const [mNodeId, setMNodeId] = useState("t-asx");
  const [mWarrant, setMWarrant] = useState("all");
  const [mStatus, setMStatus] = useState("all");
  const [mType, setMType] = useState<string>("all");
  const [taskKey, setTaskKey] = useState("compare");
  const [locId, setLocId] = useState("UK");
  const [tierId, setTierId] = useState("firm");
  const [regKey, setRegKey] = useState("AU");
  const [copied, setCopied] = useState(false);

  const go = (nextPage: PactPageId) => {
    setPage(nextPage);
    if (typeof window !== "undefined") {
      const nextUrl = PAGE_PATHS[nextPage];
      window.history.pushState({}, "", nextUrl);
      window.scrollTo(0, 0);
    }
  };

  const nav = PAGES.map((p) => ({
    id: p,
    label: cap(p),
    go: () => go(p),
    color: p === page ? C.ink : C.muted,
    line: p === page ? C.euc : "transparent",
  }));

  const stages = STAGES.map((x, i) => ({
    ...x,
    arrow: i < 3 ? "→" : "",
    select: () => setStageIdx(i),
    bg: i === stageIdx ? C.euc : C.paper,
    fg: i === stageIdx ? C.paper : C.ink,
  }));
  const stage = STAGES[stageIdx];

  const steps = STEPS.map((x, i) => ({
    ...x,
    num: String(i + 1).padStart(2, "0"),
    select: () => setStepIdx(i),
    bg: i === stepIdx ? C.paper2 : "transparent",
    line: i === stepIdx ? (i === 5 ? C.ox : C.euc) : C.hair,
    numColor: i === 5 ? C.ox : C.euc,
  }));
  const step = steps[stepIdx];

  const linked = new Set(
    EDGES.filter((e) => e.includes(nodeId)).map((e) =>
      e[0] === nodeId ? e[1] : e[0]
    )
  );
  const gnode = (n: { id: string; type: ExplorerNodeType; label: string }) => {
    const sel = n.id === nodeId;
    const lk = linked.has(n.id);
    return {
      ...n,
      select: () => setNodeId(n.id),
      bg: sel ? C.ink : C.paper,
      fg: sel ? C.paper : C.ink,
      border: sel ? C.ink : lk ? C.euc : C.hair,
      opacity: sel || lk ? 1 : 0.45,
    };
  };
  const nd = NODES.find((n) => n.id === nodeId) ?? NODES[0];
  const r = RECS[nd.id];
  const rec = {
    id: "rc-" + nd.id,
    label: nd.label,
    typeLabel: TYPE_LABEL[nd.type],
    claim: r.claim,
    agents: r.agents,
    sources: r.sources,
    dissent: r.dissent,
    authority: r.authority,
    status:
      r.st === AG
        ? "Agreed"
        : r.st === DS
          ? "Agreed · dissent recorded"
          : "Escalated to human",
    tone: r.st === AG ? C.euc : r.st === DS ? C.rust : C.ox,
    links: [...linked].map((id) => {
      const target = NODES.find((n) => n.id === id) ?? NODES[0];
      return {
        id,
        label: target.label,
        select: () => setNodeId(id),
      };
    }),
  };

  const opt = (on: boolean) => ({
    bg: on ? C.ink : C.paper,
    fg: on ? C.paper : C.ink,
    border: on ? C.ink : C.hair,
  });

  const tasks = Object.keys(TASKS).map((k) => ({
    id: k,
    label: TASKS[k].label,
    select: () => setTaskKey(k),
    ...opt(k === taskKey),
  }));
  const locs = LOCS.map((l) => ({
    id: l.id,
    label: l.label,
    select: () => setLocId(l.id),
    ...opt(l.id === locId),
  }));
  const L = LOCS.find((l) => l.id === locId) ?? LOCS[0];
  const T = TASKS[taskKey] ?? TASKS.compare;
  const route = [
    {
      num: "01",
      text: "Intent: " + T.label.toLowerCase() + " for a buyer in " + L.label,
      tone: C.ink,
    },
    {
      num: "02",
      text: "Policy: buyer rules checked · consensus recorded",
      tone: C.ink,
    },
    {
      num: "03",
      text: "Route: Australia · Sydney (primary)",
      tone: C.euc,
    },
    {
      num: "↳",
      text: "Permitted failover: " + L.fail,
      tone: C.rust,
    },
    {
      num: "04",
      text: "Receipt issued to buyer",
      tone: C.ink,
    },
  ];
  const receipt = {
    id:
      "tr_20261110_" +
      (taskKey === "compare" ? "cmp" : "sum") +
      "_" +
      locId.toLowerCase() +
      "_0417",
    rows: [
      {
        k: "Cleared token rate (Cheap)",
        v: "AUD $1.18 / 1M tokens · lowest of 4 qualified providers · saved 68% vs default frontier route",
      },
      {
        k: "Consensus grounding (Safe)",
        v:
          (taskKey === "compare"
            ? "3 agents · 2 agree · 1 dissent"
            : "3 agents · 3 agree · 0 dissent") +
          " · grounded in Space public law",
      },
      {
        k: "Jurisdiction & controls (Secure)",
        v: "Australia · Sydney (primary) · failover within buyer rules",
      },
      {
        k: "Uptime & failover (Reliable)",
        v: "Firm base + Reserve failover · signed receipt",
      },
      {
        k: "Processing location",
        v:
          "Australia · Sydney (primary)\nFailover permitted: " +
          L.fail +
          "\n" +
          L.basis,
      },
      { k: "Model and provider", v: T.model },
      { k: "Sources", v: T.sources },
      { k: "Authority & dissent record", v: T.authority },
      { k: "Performance and cost", v: T.perf },
    ],
  };

  const tiers = TIERS.map((t) => ({
    ...t,
    select: () => setTierId(t.id),
    fg: t.id === tierId ? C.ink : C.muted,
    line: t.id === tierId ? C.euc : "transparent",
    barBg: t.id === tierId ? C.euc : C.hair,
  }));
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0];
  const grid = GRID.map((g, i) => ({ ...g, n: i + 1, tone: C.ink }));
  const regTabs = ["AU", "UK", "US"].map((k) => ({
    label: k,
    select: () => setRegKey(k),
    bg: k === regKey ? C.ink : C.paper,
    fg: k === regKey ? C.paper : C.ink,
  }));

  const mSel = mNodeId;
  const mN = (id: string) => MN.find((n) => n.id === id) ?? MN[0];
  const mLinked = new Set(
    ME.filter((e) => e[0] === mSel || e[1] === mSel).map((e) =>
      e[0] === mSel ? e[1] : e[0]
    )
  );
  const mMatch = (n: MapNode) =>
    (mType === "all" || n.type === mType) &&
    (mWarrant === "all" || n.warrant === mWarrant) &&
    (mStatus === "all" || n.status === mStatus);
  const mNodes = MN.map((n) => ({
    id: n.id,
    label: n.label,
    left: n.x + "px",
    top: n.y + "px",
    ...MSHAPE[n.type],
    fill: n.id === mSel ? "#000000" : "#FFFFFF",
    bw: mLinked.has(n.id) ? "3px" : "1.5px",
    opacity: mMatch(n) || n.id === mSel ? 1 : 0.18,
    weight: n.id === mSel ? 600 : 400,
    select: () => setMNodeId(n.id),
  }));
  const mEdges = ME.map(([a, b, t], idx) => {
    const A = mN(a);
    const B = mN(b);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    return {
      key: `${a}-${b}-${idx}`,
      left: A.x + "px",
      top: A.y + "px",
      width: Math.hypot(dx, dy).toFixed(1) + "px",
      rot: "rotate(" + ((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2) + "deg)",
      border: MES[t],
      opacity: a === mSel || b === mSel ? 1 : 0.22,
    };
  });

  const mWarrants = (
    [
      ["all", "All sources"],
      ["empirical", "Empirical"],
      ["institutional", "Statutory / Institutional"],
      ["interpretive", "Interpretive"],
    ] as const
  ).map(([v, label]) => ({
    id: v,
    label,
    select: () => setMWarrant(v),
    ...opt(mWarrant === v),
  }));

  const mStatuses = (
    [
      ["all", "All statuses"],
      ["verified", "Verified"],
      ["open", "Open"],
      ["proposed", "Proposed"],
      ["challenged", "Challenged"],
    ] as const
  ).map(([v, label]) => ({
    id: v,
    label,
    select: () => setMStatus(v),
    ...opt(mStatus === v),
  }));

  const mCols = [0, 1, 2, 3].map((d) => ({
    label: "DEPTH " + d,
    left: 46 + [0, 290, 570, 840][d] + "px",
  }));

  const mTypes = (
    [
      ["leg", "rectangles · Acts of Parliament, Regulations, and Statutory Codes"],
      [
        "topic",
        "circles · plain-language rules verified by independent agents, ≤140 characters",
      ],
      ["scen", "diamonds · real-world events where one or more rules apply"],
    ] as const
  ).map(([id, desc]) => ({
    id,
    label: MTYPE[id],
    desc,
    ...MSHAPE[id],
    tf: id === "scen" ? "rotate(45deg)" : "none",
    bg: mType === id ? "#E5E5E5" : "transparent",
    select: () => setMType(mType === id ? "all" : id),
  }));

  const mEdgeTypes = (
    [
      ["cites", "Claim → Legislation"],
      ["depends_on", "Claim → Claim"],
      ["applies_when", "Scenario → Claim"],
    ] as const
  ).map(([k, sig]) => ({
    name: MEL[k],
    sig,
    border: MES[k],
  }));

  const mCur = mN(mSel);
  const mEdge = (id: string, t: MapEdgeKind) => ({
    id,
    type: MEL[t],
    label: mN(id).label,
    select: () => setMNodeId(id),
  });
  const mOut = ME.filter((e) => e[0] === mSel).map((e) => mEdge(e[1], e[2]));
  const mInc = ME.filter((e) => e[1] === mSel).map((e) => mEdge(e[0], e[2]));
  const mi = {
    type: MTYPE[mCur.type],
    label: mCur.label,
    claim: mCur.claim,
    src: mCur.src,
    out: mOut,
    inc: mInc,
    noOut: !mOut.length,
    noIn: !mInc.length,
    rows: [
      {
        k: "Evidence",
        v: mCur.warrant ? MWL[mCur.warrant] : "Not applicable · scenario",
      },
      { k: "Status", v: cap(mCur.status) },
      { k: "Dependency depth", v: String(mCur.depth) },
    ],
  };

  const copyCurl = () => {
    try {
      navigator.clipboard.writeText(
        "curl 'https://pact.tailor.au/api/axiom/legislation/search?q=privacy'"
      );
    } catch {
      // ignore clipboard errors
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FFFFFF",
        color: "#0A0A0A",
        fontFamily: "'Source Sans 3', system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid #E5E5E5",
          background: "#FFFFFF",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: "1240px",
            margin: "0 auto",
            padding: "0 clamp(20px,4vw,40px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "24px",
            flexWrap: "wrap",
            minHeight: "68px",
          }}
        >
          <div
            onClick={() => go("home")}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "12px",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: "30px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              PACT
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "11px",
                color: "#525252",
                letterSpacing: "0.04em",
              }}
            >
              pact.tailor.au
            </span>
          </div>
          <nav
            style={{
              display: "flex",
              gap: "clamp(14px,2.4vw,30px)",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {nav.map((n) => (
              <span
                key={n.id}
                onClick={n.go}
                style={{
                  fontSize: "15px",
                  fontWeight: 500,
                  cursor: "pointer",
                  padding: "22px 0 20px",
                  color: n.color,
                  borderBottom: `2px solid ${n.line}`,
                }}
              >
                {n.label}
              </span>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ flex: 1 }}>
        {/* HOME */}
        {page === "home" && (
          <div data-screen-label="01 Home">
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding:
                  "clamp(48px,8vw,104px) clamp(20px,4vw,40px) 72px",
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(min(100%,420px),1fr))",
                gap: "56px",
                alignItems: "end",
              }}
            >
              <div>
                <p
                  style={{
                    margin: "0 0 28px",
                    fontFamily: "'Newsreader', serif",
                    fontSize: "17px",
                    color: "#525252",
                  }}
                >
                  <b style={{ fontWeight: 600, color: "#0A0A0A" }}>pact</b>,{" "}
                  <i>n.</i>{" "}
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "13px",
                    }}
                  >
                    /pakt/
                  </span>{" "}
                  · Canonical Layer of Agreement
                </p>
                <h1
                  style={{
                    margin: 0,
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 400,
                    fontSize: "clamp(44px,6.4vw,84px)",
                    lineHeight: 1.02,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Australian intelligence for the world.
                </h1>
                <p
                  style={{
                    margin: "24px 0 0",
                    fontFamily: "'Newsreader', serif",
                    fontStyle: "italic",
                    fontSize: "clamp(26px,2.8vw,36px)",
                    lineHeight: 1.2,
                  }}
                >
                  Cheap, safe, secure, reliable tokens.
                </p>
                <p
                  style={{
                    margin: "20px 0 0",
                    fontSize: "clamp(19px,1.6vw,22px)",
                    lineHeight: 1.5,
                    maxWidth: "560px",
                    color: "#404040",
                  }}
                >
                  One protocol and managed service for shared truth, AI routing,
                  qualified capacity, and human authority.
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    flexWrap: "wrap",
                    marginTop: "36px",
                  }}
                >
                  <span
                    onClick={() => go("protocol")}
                    style={{
                      background: "#000000",
                      color: "#FFFFFF",
                      padding: "14px 22px",
                      fontWeight: 500,
                      fontSize: "16px",
                      cursor: "pointer",
                    }}
                  >
                    Explore the protocol
                  </span>
                  <span
                    onClick={() => go("platform")}
                    style={{
                      border: "1px solid #0A0A0A",
                      color: "#0A0A0A",
                      padding: "13px 22px",
                      fontWeight: 500,
                      fontSize: "16px",
                      cursor: "pointer",
                    }}
                  >
                    Use the open API
                  </span>
                </div>
              </div>
              <aside
                style={{
                  borderTop: "2px solid #0A0A0A",
                  paddingTop: "18px",
                  fontFamily: "'Newsreader', serif",
                  maxWidth: "480px",
                  justifySelf: "end",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    borderBottom: "1px solid #E5E5E5",
                    paddingBottom: "12px",
                  }}
                >
                  <span style={{ fontSize: "26px", fontWeight: 600 }}>pact</span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      color: "#525252",
                    }}
                  >
                    n. · /pakt/
                  </span>
                </div>
                <ol
                  style={{
                    margin: "14px 0 0",
                    paddingLeft: "22px",
                    fontSize: "17px",
                    lineHeight: 1.5,
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <li>
                    A formal agreement between parties, recorded so that each may
                    hold the others to it.
                  </li>
                  <li>
                    <span
                      style={{
                        fontVariant: "small-caps",
                        letterSpacing: "0.04em",
                      }}
                    >
                      pact
                    </span>
                    : Protocol for Agent Consensus and Truth. An open method by
                    which independent agents state, challenge, and record a claim
                    before it is relied upon.
                  </li>
                  <li>
                    The managed service that routes AI work under that record,
                    within the buyer&apos;s rules.
                  </li>
                </ol>
                <p
                  style={{
                    margin: "14px 0 0",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "11px",
                    color: "#525252",
                    letterSpacing: "0.03em",
                  }}
                >
                  Lat. pactum, from pacisci, to agree.
                </p>
              </aside>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 72px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,250px),1fr))",
                  borderTop: "3px solid #000000",
                  borderLeft: "1px solid #E5E5E5",
                }}
              >
                <div
                  style={{
                    padding: "24px 24px 28px",
                    borderRight: "1px solid #E5E5E5",
                    borderBottom: "1px solid #E5E5E5",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                    }}
                  >
                    01 · CHEAP{" "}
                    <span style={{ color: "#525252", letterSpacing: 0 }}>
                      ($/1M tokens)
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "'Newsreader', serif",
                      fontSize: "34px",
                      lineHeight: 1.05,
                    }}
                  >
                    Cheap
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      lineHeight: 1.55,
                      color: "#404040",
                    }}
                  >
                    Cleared at the lowest $/1M token rate across qualified
                    providers, with zero tokens wasted re-proving law already
                    verified in Space.
                  </p>
                </div>
                <div
                  style={{
                    padding: "24px 24px 28px",
                    borderRight: "1px solid #E5E5E5",
                    borderBottom: "1px solid #E5E5E5",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                    }}
                  >
                    02 · SAFE
                  </span>
                  <span
                    style={{
                      fontFamily: "'Newsreader', serif",
                      fontSize: "34px",
                      lineHeight: 1.05,
                    }}
                  >
                    Safe
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      lineHeight: 1.55,
                      color: "#404040",
                    }}
                  >
                    Grounded in Space&apos;s verified legislation and multi-agent
                    consensus, with recorded dissent and human escalation.
                  </p>
                </div>
                <div
                  style={{
                    padding: "24px 24px 28px",
                    borderRight: "1px solid #E5E5E5",
                    borderBottom: "1px solid #E5E5E5",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                    }}
                  >
                    03 · SECURE
                  </span>
                  <span
                    style={{
                      fontFamily: "'Newsreader', serif",
                      fontSize: "34px",
                      lineHeight: 1.05,
                    }}
                  >
                    Secure
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      lineHeight: 1.55,
                      color: "#404040",
                    }}
                  >
                    Pinned to the buyer&apos;s jurisdiction (Australian residency
                    by default), security controls, and signed PACT mandates.
                  </p>
                </div>
                <div
                  style={{
                    padding: "24px 24px 28px",
                    borderRight: "1px solid #E5E5E5",
                    borderBottom: "1px solid #E5E5E5",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                    }}
                  >
                    04 · RELIABLE
                  </span>
                  <span
                    style={{
                      fontFamily: "'Newsreader', serif",
                      fontSize: "34px",
                      lineHeight: 1.05,
                    }}
                  >
                    Reliable
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      lineHeight: 1.55,
                      color: "#404040",
                    }}
                  >
                    Backed by Firm, Floating, and Reserve capacity with automatic
                    policy-governed failover and a signed receipt on every call.
                  </p>
                </div>
              </div>
            </section>

            <section
              style={{
                borderTop: "1px solid #E5E5E5",
                borderBottom: "1px solid #E5E5E5",
                background: "#F5F5F5",
              }}
            >
              <div
                style={{
                  maxWidth: "1240px",
                  margin: "0 auto",
                  padding: "56px clamp(20px,4vw,40px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "20px",
                    flexWrap: "wrap",
                    marginBottom: "28px",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 400,
                      fontSize: "clamp(28px,3vw,38px)",
                    }}
                  >
                    Supply and governance architecture
                  </h2>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      color: "#525252",
                    }}
                  >
                    Select a stage
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(min(100%,220px),1fr))",
                    gap: 0,
                    border: "1px solid #E5E5E5",
                    borderBottom: "none",
                    background: "#FFFFFF",
                  }}
                >
                  {stages.map((s) => (
                    <div
                      key={s.num}
                      onClick={s.select}
                      style={{
                        padding: "22px 22px 24px",
                        cursor: "pointer",
                        borderRight: "1px solid #E5E5E5",
                        background: s.bg,
                        color: s.fg,
                        minHeight: "150px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          opacity: 0.8,
                        }}
                      >
                        {s.num} {s.arrow}
                      </span>
                      <span
                        style={{
                          fontFamily: "'Newsreader', serif",
                          fontSize: "22px",
                          lineHeight: 1.2,
                        }}
                      >
                        {s.title}
                      </span>
                      {s.branch && (
                        <span
                          style={{
                            marginTop: "auto",
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: "12px",
                            borderTop: "1px dashed currentColor",
                            paddingTop: "10px",
                            opacity: 0.9,
                          }}
                        >
                          ↳ Permitted failover branch
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    border: "1px solid #E5E5E5",
                    borderTop: "3px solid #000000",
                    background: "#FFFFFF",
                    padding: "14px 22px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px 22px",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "11px",
                      color: "#000000",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Governance rail
                  </span>
                  <span style={{ fontSize: "15px", fontWeight: 500 }}>
                    Authority · Consent · Provenance · Reversibility · Australian
                    Residency
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(min(100%,320px),1fr))",
                    gap: "32px",
                    marginTop: "28px",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.55 }}>
                    {stage.body}
                  </p>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "13px",
                      lineHeight: 1.7,
                      color: "#404040",
                      borderLeft: "1px solid #E5E5E5",
                      paddingLeft: "20px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {stage.trace}
                  </div>
                </div>
              </div>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "72px clamp(20px,4vw,40px)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,300px),1fr))",
                  gap: 0,
                  borderTop: "2px solid #0A0A0A",
                }}
              >
                {PILLARS.map((p) => (
                  <div
                    key={p.title}
                    style={{
                      padding: "26px 26px 30px 0",
                      marginRight: "26px",
                      borderBottom: "1px solid #E5E5E5",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                    }}
                  >
                    <span
                      style={{
                        alignSelf: "flex-start",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        border: `1px solid ${p.tone}`,
                        color: p.tone,
                        padding: "3px 8px",
                      }}
                    >
                      {p.status}
                    </span>
                    <h3
                      style={{
                        margin: 0,
                        fontFamily: "'Newsreader', serif",
                        fontWeight: 500,
                        fontSize: "26px",
                        lineHeight: 1.15,
                      }}
                    >
                      {p.title}
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "16px",
                        lineHeight: 1.55,
                        color: "#404040",
                      }}
                    >
                      {p.body}
                    </p>
                    <span
                      onClick={() => go(p.page)}
                      style={{
                        marginTop: "auto",
                        fontSize: "15px",
                        fontWeight: 500,
                        color: "#000000",
                        cursor: "pointer",
                      }}
                    >
                      {p.link} →
                    </span>
                    {p.space && (
                      <span
                        onClick={() => go("space")}
                        style={{
                          fontSize: "15px",
                          fontWeight: 500,
                          color: "#000000",
                          cursor: "pointer",
                        }}
                      >
                        Open Space →
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 88px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  gap: "12px",
                  marginBottom: "22px",
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 400,
                    fontSize: "clamp(26px,2.6vw,34px)",
                  }}
                >
                  Australian foundations
                </h2>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "12px",
                    color: "#525252",
                  }}
                >
                  National evidence · not capacity owned by PACT
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,260px),1fr))",
                  gap: "16px",
                }}
              >
                {EVIDENCE.map((e) => (
                  <div
                    key={e.figure}
                    style={{
                      background: "#F5F5F5",
                      border: "1px solid #E5E5E5",
                      padding: "24px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Newsreader', serif",
                        fontSize: "36px",
                        lineHeight: 1.05,
                      }}
                    >
                      {e.figure}
                    </span>
                    <span style={{ fontSize: "16px", lineHeight: 1.45 }}>
                      {e.label}
                    </span>
                    <span
                      style={{
                        marginTop: "auto",
                        paddingTop: "12px",
                        borderTop: "1px solid #E5E5E5",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        color: "#525252",
                      }}
                    >
                      Source: {e.source}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* SPACE */}
        {page === "space" && (
          <div data-screen-label="02 Space">
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "clamp(48px,7vw,96px) clamp(20px,4vw,40px) 56px",
              }}
            >
              <p
                style={{
                  margin: "0 0 20px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "12px",
                  color: "#000000",
                  letterSpacing: "0.08em",
                }}
              >
                <span style={{ textTransform: "uppercase" }}>
                  Space · X, Y, Z, T Public Law &amp; Shared Reality ·{" "}
                </span>
                pact.tailor.au/map
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "'Newsreader', serif",
                  fontWeight: 400,
                  fontSize: "clamp(44px,6vw,80px)",
                  lineHeight: 1.02,
                  letterSpacing: "-0.02em",
                }}
              >
                The Space.
              </h1>
              <p
                style={{
                  margin: "26px 0 0",
                  fontSize: "20px",
                  lineHeight: 1.5,
                  maxWidth: "760px",
                  color: "#404040",
                }}
              >
                Every 2D Fabric (an organisation) exists inside a shared 4D Space
                (X, Y, Z, T) — governed by where work happens (X, Y jurisdiction),
                dependency depth from physical constants and statutes up to
                real-world scenarios (Z), and when laws take effect or facts
                change (T). Reading verified claims from Space eliminates
                redundant reasoning tokens across every organisation.
              </p>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 72px",
              }}
            >
              <div style={{ border: "1px solid #000000" }}>
                <div
                  style={{
                    padding: "22px 24px 24px",
                    background: "#000000",
                    color: "#FFFFFF",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                    }}
                  >
                    01
                  </span>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px 20px",
                      alignItems: "baseline",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Newsreader', serif",
                        fontSize: "28px",
                        letterSpacing: "0.08em",
                      }}
                    >
                      SPACE
                    </span>
                    <span style={{ fontSize: "15px" }}>
                      X, Y, Z, T Public Law &amp; Shared Reality ·
                      pact.tailor.au/map
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "16px",
                      lineHeight: 1.5,
                      maxWidth: "720px",
                    }}
                  >
                    Legislation, regulatory standards, physical constants, and
                    verified facts across jurisdiction (X, Y), dependency depth
                    (Z), and time (T). No single Fabric owns Space.
                  </p>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px",
                    padding: "20px",
                    background: "#F5F5F5",
                    alignItems: "stretch",
                  }}
                >
                  <div
                    style={{
                      flex: "1 1 240px",
                      border: "1px solid #000000",
                      background: "#FFFFFF",
                      padding: "18px 20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        color: "#525252",
                      }}
                    >
                      02
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px 12px",
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Newsreader', serif",
                          fontSize: "24px",
                          letterSpacing: "0.08em",
                        }}
                      >
                        FABRIC
                      </span>
                      <span style={{ fontSize: "14px", color: "#525252" }}>
                        Inside an Organisation (2D)
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "15px",
                        lineHeight: 1.5,
                        color: "#404040",
                      }}
                    >
                      An organisation&apos;s own boundary, private records, and
                      internal rules, operating inside Space.
                    </p>
                  </div>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "18px",
                      alignSelf: "center",
                    }}
                  >
                    ↔
                  </span>
                  <div
                    style={{
                      flex: "1 1 240px",
                      border: "1px dashed #000000",
                      background: "#FFFFFF",
                      padding: "18px 20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        color: "#525252",
                      }}
                    >
                      03
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px 12px",
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Newsreader', serif",
                          fontSize: "24px",
                          letterSpacing: "0.08em",
                        }}
                      >
                        SEAM
                      </span>
                      <span style={{ fontSize: "14px", color: "#525252" }}>
                        Between Organisations (1D)
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "15px",
                        lineHeight: 1.5,
                        color: "#404040",
                      }}
                    >
                      A signed PACT mandate joining two Fabrics for a specific
                      piece of work, with scope, expiry, and revocation.
                    </p>
                  </div>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "18px",
                      alignSelf: "center",
                    }}
                  >
                    ↔
                  </span>
                  <div
                    style={{
                      flex: "1 1 240px",
                      border: "1px solid #000000",
                      background: "#FFFFFF",
                      padding: "18px 20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        color: "#525252",
                      }}
                    >
                      02
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px 12px",
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Newsreader', serif",
                          fontSize: "24px",
                          letterSpacing: "0.08em",
                        }}
                      >
                        FABRIC
                      </span>
                      <span style={{ fontSize: "14px", color: "#525252" }}>
                        Inside an Organisation (2D)
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "15px",
                        lineHeight: 1.5,
                        color: "#404040",
                      }}
                    >
                      An organisation&apos;s own boundary, private records, and
                      internal rules, operating inside Space.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section
              style={{
                background: "#F5F5F5",
                borderTop: "1px solid #E5E5E5",
                borderBottom: "1px solid #E5E5E5",
              }}
            >
              <div
                style={{
                  maxWidth: "1240px",
                  margin: "0 auto",
                  padding: "64px clamp(20px,4vw,40px) 80px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: "12px",
                    marginBottom: "10px",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 400,
                      fontSize: "clamp(28px,3vw,38px)",
                    }}
                  >
                    Space Map
                  </h2>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      color: "#525252",
                    }}
                  >
                    pact.tailor.au/map · X, Y, Z, T illustrative preview
                  </span>
                </div>
                <p
                  style={{
                    margin: "0 0 26px",
                    fontSize: "18px",
                    lineHeight: 1.5,
                    maxWidth: "760px",
                    color: "#404040",
                  }}
                >
                  Filter the public record by how a claim is evidenced and where
                  it sits in review.
                </p>

                <div
                  style={{ display: "grid", gap: "14px", marginBottom: "22px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#525252",
                        width: "76px",
                      }}
                    >
                      Source
                    </span>
                    {mWarrants.map((f) => (
                      <span
                        key={f.id}
                        onClick={f.select}
                        style={{
                          cursor: "pointer",
                          padding: "6px 12px",
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          border: `1px solid ${f.border}`,
                          background: f.bg,
                          color: f.fg,
                        }}
                      >
                        {f.label}
                      </span>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#525252",
                        width: "76px",
                      }}
                    >
                      Status
                    </span>
                    {mStatuses.map((f) => (
                      <span
                        key={f.id}
                        onClick={f.select}
                        style={{
                          cursor: "pointer",
                          padding: "6px 12px",
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          border: `1px solid ${f.border}`,
                          background: f.bg,
                          color: f.fg,
                        }}
                      >
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #000000",
                    overflowX: "auto",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "1140px",
                      height: "580px",
                    }}
                  >
                    {mCols.map((c) => (
                      <span
                        key={c.label}
                        style={{
                          position: "absolute",
                          top: "12px",
                          left: c.left,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          color: "#525252",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {c.label}
                      </span>
                    ))}
                    {mEdges.map((e) => (
                      <div
                        key={e.key}
                        style={{
                          position: "absolute",
                          left: e.left,
                          top: e.top,
                          width: e.width,
                          height: 0,
                          borderTop: e.border,
                          transform: e.rot,
                          transformOrigin: "0 0",
                          opacity: e.opacity,
                          pointerEvents: "none",
                        }}
                      />
                    ))}
                    {mNodes.map((n) => (
                      <div
                        key={n.id}
                        onClick={n.select}
                        style={{
                          position: "absolute",
                          left: n.left,
                          top: n.top,
                          cursor: "pointer",
                          opacity: n.opacity,
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            left: "-14px",
                            bottom: "16px",
                            width: "210px",
                            fontSize: "12px",
                            lineHeight: 1.25,
                            fontWeight: n.weight,
                            background: "#FFFFFF",
                            padding: "1px 3px",
                          }}
                        >
                          {n.label}
                        </span>
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: n.w,
                            height: n.h,
                            border: `${n.bw} solid #000000`,
                            borderRadius: n.radius,
                            background: n.fill,
                            transform: n.tf,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(min(100%,340px),1fr))",
                    gap: "24px",
                    marginTop: "24px",
                    alignItems: "start",
                  }}
                >
                  <div style={{ display: "grid", gap: "20px" }}>
                    <div>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "#525252",
                        }}
                      >
                        Node types · select to isolate
                      </span>
                      <div
                        style={{
                          display: "grid",
                          gap: 0,
                          marginTop: "10px",
                          borderTop: "1px solid #D4D4D4",
                        }}
                      >
                        {mTypes.map((t) => (
                          <div
                            key={t.id}
                            onClick={t.select}
                            style={{
                              cursor: "pointer",
                              display: "grid",
                              gridTemplateColumns: "32px 160px minmax(0,1fr)",
                              gap: "10px",
                              alignItems: "center",
                              padding: "11px 10px",
                              borderBottom: "1px solid #D4D4D4",
                              background: t.bg,
                            }}
                          >
                            <div
                              style={{
                                width: t.w,
                                height: t.h,
                                border: "1.5px solid #000000",
                                borderRadius: t.radius,
                                transform: t.tf,
                                justifySelf: "center",
                                background: "#FFFFFF",
                              }}
                            />
                            <span style={{ fontWeight: 600, fontSize: "15px" }}>
                              {t.label}
                            </span>
                            <span
                              style={{
                                fontSize: "14px",
                                color: "#404040",
                                lineHeight: 1.4,
                              }}
                            >
                              {t.desc}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "#525252",
                        }}
                      >
                        Edge types
                      </span>
                      <div
                        style={{
                          display: "grid",
                          gap: 0,
                          marginTop: "10px",
                          borderTop: "1px solid #D4D4D4",
                        }}
                      >
                        {mEdgeTypes.map((t) => (
                          <div
                            key={t.name}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "44px 130px minmax(0,1fr)",
                              gap: "10px",
                              alignItems: "center",
                              padding: "11px 10px",
                              borderBottom: "1px solid #D4D4D4",
                            }}
                          >
                            <div
                              style={{ height: 0, borderTop: t.border }}
                            />
                            <span
                              style={{
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: "13px",
                              }}
                            >
                              {t.name}
                            </span>
                            <span
                              style={{
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: "12px",
                                color: "#525252",
                              }}
                            >
                              {t.sig}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #D4D4D4",
                      borderTop: "3px solid #000000",
                    }}
                  >
                    <div
                      style={{
                        padding: "18px 22px",
                        borderBottom: "1px solid #E5E5E5",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                        }}
                      >
                        {mi.type}
                      </span>
                      <h3
                        style={{
                          margin: "6px 0 0",
                          fontFamily: "'Newsreader', serif",
                          fontWeight: 500,
                          fontSize: "24px",
                          lineHeight: 1.2,
                        }}
                      >
                        {mi.label}
                      </h3>
                      <p
                        style={{
                          margin: "10px 0 0",
                          fontSize: "15px",
                          lineHeight: 1.5,
                          color: "#404040",
                        }}
                      >
                        {mi.claim}
                      </p>
                    </div>
                    {mi.rows.map((row) => (
                      <div
                        key={row.k}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0,150px) minmax(0,1fr)",
                          gap: "16px",
                          padding: "10px 22px",
                          borderBottom: "1px solid #E5E5E5",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: "12px",
                            color: "#525252",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {row.k}
                        </span>
                        <span style={{ fontSize: "15px" }}>{row.v}</span>
                      </div>
                    ))}
                    <div
                      style={{
                        padding: "14px 22px",
                        borderBottom: "1px solid #E5E5E5",
                        display: "grid",
                        gap: "8px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Outgoing edges
                      </span>
                      {mi.out.map((e) => (
                        <div
                          key={e.id}
                          onClick={e.select}
                          style={{
                            cursor: "pointer",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "4px 10px",
                            alignItems: "baseline",
                            fontSize: "14px",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: "12px",
                            }}
                          >
                            {e.type} →
                          </span>
                          <span>{e.label}</span>
                        </div>
                      ))}
                      {mi.noOut && (
                        <span style={{ fontSize: "14px", color: "#525252" }}>
                          None
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        padding: "14px 22px",
                        borderBottom: "1px solid #E5E5E5",
                        display: "grid",
                        gap: "8px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Incoming edges
                      </span>
                      {mi.inc.map((e) => (
                        <div
                          key={e.id}
                          onClick={e.select}
                          style={{
                            cursor: "pointer",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "4px 10px",
                            alignItems: "baseline",
                            fontSize: "14px",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: "12px",
                            }}
                          >
                            ← {e.type}
                          </span>
                          <span>{e.label}</span>
                        </div>
                      ))}
                      {mi.noIn && (
                        <span style={{ fontSize: "14px", color: "#525252" }}>
                          None
                        </span>
                      )}
                    </div>
                    <div style={{ padding: "14px 22px" }}>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Primary source provenance
                      </span>
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: "15px",
                          lineHeight: 1.5,
                        }}
                      >
                        {mi.src}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* PROTOCOL */}
        {page === "protocol" && (
          <div data-screen-label="02 Protocol">
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "clamp(48px,7vw,96px) clamp(20px,4vw,40px) 56px",
              }}
            >
              <p
                style={{
                  margin: "0 0 20px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "12px",
                  color: "#000000",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Protocol · Canonical layer of agreement · Available · MIT
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "'Newsreader', serif",
                  fontWeight: 400,
                  fontSize: "clamp(44px,6vw,80px)",
                  lineHeight: 1.02,
                  letterSpacing: "-0.02em",
                }}
              >
                Claims open to challenge.
              </h1>
              <p
                style={{
                  margin: "26px 0 0",
                  fontSize: "20px",
                  lineHeight: 1.5,
                  maxWidth: "680px",
                  color: "#404040",
                }}
              >
                PACT is a state machine for agreement between independent agents.
                Each claim carries its intent, its constraints, its primary
                sources and any dissent. Where agents cannot agree, or the stakes
                exceed their authority, the record goes to a person.
              </p>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 72px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,150px),1fr))",
                  borderTop: "2px solid #0A0A0A",
                }}
              >
                {steps.map((st) => (
                  <div
                    key={st.num}
                    onClick={st.select}
                    style={{
                      cursor: "pointer",
                      padding: "18px 16px 20px",
                      borderBottom: `3px solid ${st.line}`,
                      background: st.bg,
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        color: st.numColor,
                      }}
                    >
                      {st.num}
                    </span>
                    <span
                      style={{
                        fontFamily: "'Newsreader', serif",
                        fontSize: "23px",
                      }}
                    >
                      {st.name}
                    </span>
                    <span style={{ fontSize: "13px", color: "#525252" }}>
                      {st.who}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,360px),1fr))",
                  gap: "32px",
                  paddingTop: "28px",
                }}
              >
                <div>
                  <h3
                    style={{
                      margin: "0 0 12px",
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 500,
                      fontSize: "28px",
                    }}
                  >
                    {step.name}
                  </h3>
                  <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.55 }}>
                    {step.body}
                  </p>
                  <p
                    style={{
                      margin: "14px 0 0",
                      fontSize: "15px",
                      color: "#525252",
                    }}
                  >
                    Next: {step.next}
                  </p>
                </div>
                <pre
                  style={{
                    margin: 0,
                    background: "#0A0A0A",
                    color: "#F5F5F5",
                    padding: "20px 22px",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "13px",
                    lineHeight: 1.65,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {step.record}
                </pre>
              </div>
            </section>

            <section
              style={{
                background: "#F5F5F5",
                borderTop: "1px solid #E5E5E5",
                borderBottom: "1px solid #E5E5E5",
              }}
            >
              <div
                style={{
                  maxWidth: "1240px",
                  margin: "0 auto",
                  padding: "64px clamp(20px,4vw,40px) 72px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: "12px",
                    marginBottom: "8px",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 400,
                      fontSize: "clamp(28px,3vw,38px)",
                    }}
                  >
                    Consensus Record &amp; Space Explorer
                  </h2>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      color: "#525252",
                    }}
                  >
                    Illustrative preview · not legal advice
                  </span>
                </div>
                <p
                  style={{
                    margin: "0 0 28px",
                    fontSize: "16px",
                    color: "#404040",
                    maxWidth: "640px",
                  }}
                >
                  Select any node. Linked topics, legislation and scenarios stay
                  in focus; the record shows provenance, dissent and the human
                  authority boundary.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(min(100%,240px),1fr))",
                    gap: "18px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#525252",
                        paddingBottom: "6px",
                        borderBottom: "1px solid #E5E5E5",
                      }}
                    >
                      Topics
                    </span>
                    {NODES.filter((n) => n.type === "topic")
                      .map(gnode)
                      .map((g) => (
                        <div
                          key={g.id}
                          onClick={g.select}
                          style={{
                            cursor: "pointer",
                            padding: "12px 14px",
                            fontSize: "15px",
                            lineHeight: 1.35,
                            border: `1px solid ${g.border}`,
                            background: g.bg,
                            color: g.fg,
                            opacity: g.opacity,
                          }}
                        >
                          {g.label}
                        </div>
                      ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#525252",
                        paddingBottom: "6px",
                        borderBottom: "1px solid #E5E5E5",
                      }}
                    >
                      Australian Legislation
                    </span>
                    {NODES.filter((n) => n.type === "leg")
                      .map(gnode)
                      .map((g) => (
                        <div
                          key={g.id}
                          onClick={g.select}
                          style={{
                            cursor: "pointer",
                            padding: "12px 14px",
                            fontSize: "15px",
                            lineHeight: 1.35,
                            border: `1px solid ${g.border}`,
                            background: g.bg,
                            color: g.fg,
                            opacity: g.opacity,
                          }}
                        >
                          {g.label}
                        </div>
                      ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#525252",
                        paddingBottom: "6px",
                        borderBottom: "1px solid #E5E5E5",
                      }}
                    >
                      Scenarios
                    </span>
                    {NODES.filter((n) => n.type === "scen")
                      .map(gnode)
                      .map((g) => (
                        <div
                          key={g.id}
                          onClick={g.select}
                          style={{
                            cursor: "pointer",
                            padding: "12px 14px",
                            fontSize: "15px",
                            lineHeight: 1.35,
                            border: `1px solid ${g.border}`,
                            background: g.bg,
                            color: g.fg,
                            opacity: g.opacity,
                          }}
                        >
                          {g.label}
                        </div>
                      ))}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: "24px",
                    background: "#FFFFFF",
                    border: "1px solid #E5E5E5",
                    borderTop: "2px solid #0A0A0A",
                  }}
                >
                  <div
                    style={{
                      padding: "20px 24px",
                      borderBottom: "1px solid #E5E5E5",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "16px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          color: "#525252",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        {rec.typeLabel} · {rec.id}
                      </span>
                      <h3
                        style={{
                          margin: "6px 0 0",
                          fontFamily: "'Newsreader', serif",
                          fontWeight: 500,
                          fontSize: "26px",
                        }}
                      >
                        {rec.label}
                      </h3>
                    </div>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        border: `1px solid ${rec.tone}`,
                        color: rec.tone,
                        padding: "4px 9px",
                      }}
                    >
                      {rec.status}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit,minmax(min(100%,260px),1fr))",
                    }}
                  >
                    <div
                      style={{
                        padding: "20px 24px",
                        borderRight: "1px solid #E5E5E5",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          color: "#000000",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        Recorded claim
                      </span>
                      <p
                        style={{
                          margin: "8px 0 0",
                          fontFamily: "'Newsreader', serif",
                          fontSize: "19px",
                          lineHeight: 1.45,
                        }}
                      >
                        {rec.claim}
                      </p>
                      <p
                        style={{
                          margin: "12px 0 0",
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                        }}
                      >
                        {rec.agents}
                      </p>
                    </div>
                    <div
                      style={{
                        padding: "20px 24px",
                        borderRight: "1px solid #E5E5E5",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          color: "#000000",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        Provenance
                      </span>
                      <ul
                        style={{
                          margin: "8px 0 0",
                          paddingLeft: "18px",
                          fontSize: "15px",
                          lineHeight: 1.5,
                          display: "grid",
                          gap: "4px",
                        }}
                      >
                        {rec.sources.map((src) => (
                          <li key={src}>{src}</li>
                        ))}
                      </ul>
                    </div>
                    <div style={{ padding: "20px 24px" }}>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          color: "#525252",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        Dissent
                      </span>
                      <p
                        style={{
                          margin: "8px 0 16px",
                          fontSize: "15px",
                          lineHeight: 1.5,
                        }}
                      >
                        {rec.dissent}
                      </p>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          color: "#525252",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        Human authority boundary
                      </span>
                      <p
                        style={{
                          margin: "8px 0 0",
                          fontSize: "15px",
                          lineHeight: 1.5,
                        }}
                      >
                        {rec.authority}
                      </p>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "14px 24px",
                      borderTop: "1px solid #E5E5E5",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        color: "#525252",
                        marginRight: "6px",
                      }}
                    >
                      LINKS
                    </span>
                    {rec.links.map((l) => (
                      <span
                        key={l.id}
                        onClick={l.select}
                        style={{
                          cursor: "pointer",
                          fontSize: "14px",
                          border: "1px solid #E5E5E5",
                          padding: "4px 10px",
                        }}
                      >
                        {l.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* PLATFORM */}
        {page === "platform" && (
          <div data-screen-label="03 Platform">
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "clamp(48px,7vw,96px) clamp(20px,4vw,40px) 56px",
              }}
            >
              <p
                style={{
                  margin: "0 0 20px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "12px",
                  color: "#000000",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Platform · Developers
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "'Newsreader', serif",
                  fontWeight: 400,
                  fontSize: "clamp(44px,6vw,80px)",
                  lineHeight: 1.02,
                  letterSpacing: "-0.02em",
                }}
              >
                Read the record. Route the work.
              </h1>
              <p
                style={{
                  margin: "26px 0 0",
                  fontSize: "20px",
                  lineHeight: 1.5,
                  maxWidth: "680px",
                  color: "#404040",
                }}
              >
                The Open Knowledge API is available today without authentication.
                Managed routing through PACT is a proposed workflow, shown here
                so buyers can inspect what a receipt would contain.
              </p>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 72px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,400px),1fr))",
                  gap: "40px",
                  borderTop: "2px solid #0A0A0A",
                  paddingTop: "32px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                  <span
                    style={{
                      alignSelf: "flex-start",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "11px",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      border: "1px solid #000000",
                      color: "#000000",
                      padding: "3px 8px",
                    }}
                  >
                    Available today
                  </span>
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 400,
                      fontSize: "36px",
                      lineHeight: 1.1,
                    }}
                  >
                    Open Knowledge API
                  </h2>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "17px",
                      lineHeight: 1.55,
                      color: "#404040",
                    }}
                  >
                    Search Australian legislation and the consensus graph with a
                    plain GET request. No key, no account. Space is the shared X,
                    Y, Z, T layer of legislation, standards, and verified
                    consensus above every Fabric.
                  </p>
                  <div style={{ display: "grid", borderTop: "1px solid #E5E5E5" }}>
                    <a
                      href="/openapi.json"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "14px 0",
                        borderBottom: "1px solid #E5E5E5",
                        textDecoration: "none",
                        color: "#0A0A0A",
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>
                        OpenAPI specification
                      </span>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "13px",
                          color: "#000000",
                        }}
                      >
                        /openapi.json →
                      </span>
                    </a>
                    <span
                      onClick={() => go("space")}
                      style={{
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "14px 0",
                        borderBottom: "1px solid #E5E5E5",
                        textDecoration: "none",
                        color: "#0A0A0A",
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>
                        Space (X, Y, Z, T Legislation &amp; Consensus Map)
                      </span>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "13px",
                          color: "#000000",
                        }}
                      >
                        /map →
                      </span>
                    </span>
                    <a
                      href="/get-started"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "14px 0",
                        borderBottom: "1px solid #E5E5E5",
                        textDecoration: "none",
                        color: "#0A0A0A",
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>Getting started</span>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "13px",
                          color: "#000000",
                        }}
                      >
                        /get-started →
                      </span>
                    </a>
                  </div>
                </div>
                <div
                  style={{
                    background: "#0A0A0A",
                    color: "#F5F5F5",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 18px",
                      borderBottom: "1px solid #404040",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        color: "#A3A3A3",
                      }}
                    >
                      GET · unauthenticated
                    </span>
                    <span
                      onClick={copyCurl}
                      style={{
                        cursor: "pointer",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        border: "1px solid #525252",
                        padding: "3px 10px",
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "20px 18px",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "14px",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    <span style={{ color: "#A3A3A3" }}>$ </span>
                    curl
                    &apos;https://pact.tailor.au/api/axiom/legislation/search?q=privacy&apos;
                  </pre>
                  <div
                    style={{
                      padding: "0 18px 20px",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      lineHeight: 1.6,
                      color: "#A3A3A3",
                    }}
                  >
                    Returns JSON matches from the Australian legislation index.
                    See /openapi.json for the response schema.
                  </div>
                </div>
              </div>
            </section>

            <section
              style={{
                background: "#F5F5F5",
                borderTop: "1px solid #E5E5E5",
                borderBottom: "1px solid #E5E5E5",
              }}
            >
              <div
                style={{
                  maxWidth: "1240px",
                  margin: "0 auto",
                  padding: "64px clamp(20px,4vw,40px) 80px",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "11px",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    border: "1px solid #525252",
                    color: "#525252",
                    padding: "3px 8px",
                  }}
                >
                  Proposed workflow · PACT routing
                </span>
                <h2
                  style={{
                    margin: "16px 0 8px",
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 400,
                    fontSize: "clamp(30px,3.2vw,40px)",
                  }}
                >
                  Cross-border routing walkthrough
                </h2>
                <p
                  style={{
                    margin: "0 0 32px",
                    fontSize: "17px",
                    color: "#404040",
                    maxWidth: "680px",
                  }}
                >
                  Choose a task and a buyer location. Work is processed in
                  Australia by default; failover is permitted only where the
                  buyer&apos;s rules allow it.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(min(100%,340px),1fr))",
                    gap: "36px",
                    alignItems: "start",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "26px",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "#525252",
                        }}
                      >
                        Task
                      </span>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          marginTop: "10px",
                        }}
                      >
                        {tasks.map((t) => (
                          <span
                            key={t.id}
                            onClick={t.select}
                            style={{
                              cursor: "pointer",
                              padding: "10px 16px",
                              fontSize: "15px",
                              fontWeight: 500,
                              border: `1px solid ${t.border}`,
                              background: t.bg,
                              color: t.fg,
                            }}
                          >
                            {t.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "11px",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "#525252",
                        }}
                      >
                        Buyer location
                      </span>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          marginTop: "10px",
                        }}
                      >
                        {locs.map((t) => (
                          <span
                            key={t.id}
                            onClick={t.select}
                            style={{
                              cursor: "pointer",
                              padding: "10px 16px",
                              fontSize: "15px",
                              fontWeight: 500,
                              border: `1px solid ${t.border}`,
                              background: t.bg,
                              color: t.fg,
                            }}
                          >
                            {t.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div
                      style={{
                        borderTop: "1px solid #E5E5E5",
                        paddingTop: "18px",
                        display: "grid",
                        gap: "10px",
                        fontSize: "15px",
                      }}
                    >
                      {route.map((r) => (
                        <div
                          key={r.num}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "28px 1fr",
                            gap: "10px",
                            alignItems: "baseline",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: "12px",
                              color: r.tone,
                            }}
                          >
                            {r.num}
                          </span>
                          <span style={{ color: r.tone }}>{r.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #E5E5E5",
                      borderTop: "3px solid #0A0A0A",
                    }}
                  >
                    <div
                      style={{
                        padding: "16px 22px",
                        borderBottom: "1px solid #E5E5E5",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Newsreader', serif",
                          fontSize: "22px",
                          fontWeight: 500,
                        }}
                      >
                        PACT Trace Receipt
                      </span>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                        }}
                      >
                        {receipt.id}
                      </span>
                    </div>
                    {receipt.rows.map((row) => (
                      <div
                        key={row.k}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0,170px) minmax(0,1fr)",
                          gap: "16px",
                          padding: "14px 22px",
                          borderBottom: "1px solid #E5E5E5",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: "12px",
                            color: "#000000",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            lineHeight: 1.5,
                          }}
                        >
                          {row.k}
                        </span>
                        <span
                          style={{
                            fontSize: "15px",
                            lineHeight: 1.5,
                            whiteSpace: "pre-line",
                          }}
                        >
                          {row.v}
                        </span>
                      </div>
                    ))}
                    <div
                      style={{
                        padding: "12px 22px",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        color: "#525252",
                      }}
                    >
                      Illustrative values for a proposed workflow. No live
                      traffic.
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* MARKET */}
        {page === "market" && (
          <div data-screen-label="04 Market">
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "clamp(48px,7vw,96px) clamp(20px,4vw,40px) 56px",
              }}
            >
              <p
                style={{
                  margin: "0 0 20px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "12px",
                  color: "#525252",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Market · Beta by request
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "'Newsreader', serif",
                  fontWeight: 400,
                  fontSize: "clamp(40px,5.4vw,72px)",
                  lineHeight: 1.04,
                  letterSpacing: "-0.02em",
                  maxWidth: "1000px",
                }}
              >
                A market for intelligence capacity.
              </h1>
              <p
                style={{
                  margin: "18px 0 0",
                  fontFamily: "'Newsreader', serif",
                  fontStyle: "italic",
                  fontSize: "clamp(24px,2.6vw,34px)",
                  lineHeight: 1.3,
                  color: "#000000",
                }}
              >
                Qualify the supply. Contract the base. Cover the peaks. Keep
                reserve.
              </p>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 72px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid #E5E5E5",
                  gap: 0,
                  flexWrap: "wrap",
                }}
              >
                {tiers.map((t) => (
                  <span
                    key={t.id}
                    onClick={t.select}
                    style={{
                      cursor: "pointer",
                      padding: "14px 26px 12px",
                      fontFamily: "'Newsreader', serif",
                      fontSize: "24px",
                      color: t.fg,
                      borderBottom: `3px solid ${t.line}`,
                      marginBottom: "-1px",
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  height: "14px",
                  margin: "28px 0 8px",
                  gap: "3px",
                }}
              >
                {tiers.map((t) => (
                  <div
                    key={t.id}
                    style={{ flex: t.share, background: t.barBg }}
                  />
                ))}
              </div>
              <p
                style={{
                  margin: "0 0 28px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "11px",
                  color: "#525252",
                }}
              >
                Example portfolio shape · base / peaks / reserve
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,320px),1fr))",
                  gap: "40px",
                }}
              >
                <div>
                  <h3
                    style={{
                      margin: "0 0 12px",
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 500,
                      fontSize: "30px",
                    }}
                  >
                    {tier.label}
                  </h3>
                  <p style={{ margin: 0, fontSize: "19px", lineHeight: 1.5 }}>
                    {tier.body}
                  </p>
                </div>
                <div style={{ display: "grid", borderTop: "1px solid #E5E5E5" }}>
                  {tier.facts.map((f) => (
                    <div
                      key={f.k}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,140px) minmax(0,1fr)",
                        gap: "16px",
                        padding: "12px 0",
                        borderBottom: "1px solid #E5E5E5",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {f.k}
                      </span>
                      <span style={{ fontSize: "15px", lineHeight: 1.5 }}>
                        {f.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section
              style={{
                background: "#F5F5F5",
                borderTop: "1px solid #E5E5E5",
                borderBottom: "1px solid #E5E5E5",
              }}
            >
              <div
                style={{
                  maxWidth: "1240px",
                  margin: "0 auto",
                  padding: "64px clamp(20px,4vw,40px) 72px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: "12px",
                    marginBottom: "24px",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 400,
                      fontSize: "clamp(28px,3vw,38px)",
                    }}
                  >
                    Demand and supply qualification
                  </h2>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      color: "#000000",
                    }}
                  >
                    Qualify first · Clear at cheapest token ($/1M)
                  </span>
                </div>
                <div
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E5E5E5",
                    overflowX: "auto",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(150px,0.8fr) minmax(200px,1fr) minmax(200px,1fr)",
                      minWidth: "620px",
                      borderBottom: "2px solid #0A0A0A",
                    }}
                  >
                    <span
                      style={{
                        padding: "12px 18px",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#525252",
                      }}
                    >
                      Criterion
                    </span>
                    <span
                      style={{
                        padding: "12px 18px",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#525252",
                      }}
                    >
                      Demand states
                    </span>
                    <span
                      style={{
                        padding: "12px 18px",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#525252",
                      }}
                    >
                      Supply proves
                    </span>
                  </div>
                  {grid.map((g) => (
                    <div
                      key={g.k}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(150px,0.8fr) minmax(200px,1fr) minmax(200px,1fr)",
                        minWidth: "620px",
                        borderBottom: "1px solid #E5E5E5",
                      }}
                    >
                      <span
                        style={{
                          padding: "14px 18px",
                          fontWeight: 600,
                          fontSize: "15px",
                          color: g.tone,
                        }}
                      >
                        {g.n}. {g.k}
                      </span>
                      <span
                        style={{
                          padding: "14px 18px",
                          fontSize: "15px",
                          lineHeight: 1.45,
                        }}
                      >
                        {g.d}
                      </span>
                      <span
                        style={{
                          padding: "14px 18px",
                          fontSize: "15px",
                          lineHeight: 1.45,
                        }}
                      >
                        {g.s}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: "28px",
                    background: "#FFFFFF",
                    border: "1px solid #E5E5E5",
                    borderTop: "3px solid #000000",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "8px",
                      padding: "14px 20px",
                      borderBottom: "1px solid #E5E5E5",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Newsreader', serif",
                        fontSize: "22px",
                      }}
                    >
                      Token Clearing Comparison
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        color: "#525252",
                      }}
                    >
                      $/1M tokens · illustrative
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit,minmax(min(100%,240px),1fr))",
                      gap: "10px 24px",
                      alignItems: "center",
                      padding: "18px 20px",
                      borderBottom: "1px solid #E5E5E5",
                    }}
                  >
                    <span style={{ fontSize: "16px", fontWeight: 600 }}>
                      Unrouted frontier call
                    </span>
                    <div
                      style={{
                        height: "22px",
                        background: "#F5F5F5",
                        border: "1px solid #E5E5E5",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: "100%",
                          background: "#A3A3A3",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "15px",
                      }}
                    >
                      $15.00{" "}
                      <span style={{ color: "#525252", fontSize: "12px" }}>
                        AUD / 1M tokens
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit,minmax(min(100%,240px),1fr))",
                      gap: "10px 24px",
                      alignItems: "center",
                      padding: "18px 20px",
                      borderBottom: "1px solid #E5E5E5",
                    }}
                  >
                    <span style={{ fontSize: "16px", fontWeight: 600 }}>
                      PACT Firm / Floating / Reserve clearing
                    </span>
                    <div
                      style={{
                        height: "22px",
                        background: "#F5F5F5",
                        border: "1px solid #E5E5E5",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: "7.9%",
                          background: "#000000",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "15px",
                      }}
                    >
                      $1.18{" "}
                      <span style={{ color: "#525252", fontSize: "12px" }}>
                        AUD / 1M tokens
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "72px clamp(20px,4vw,40px) 88px",
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(min(100%,320px),1fr))",
                gap: "48px",
              }}
            >
              <div style={{ borderTop: "2px solid #0A0A0A", paddingTop: "20px" }}>
                <h3
                  style={{
                    margin: "0 0 12px",
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 500,
                    fontSize: "26px",
                  }}
                >
                  Intelligence Offtake Agreements
                </h3>
                <p
                  style={{
                    margin: "0 0 18px",
                    fontSize: "16px",
                    lineHeight: 1.55,
                    color: "#404040",
                  }}
                >
                  Durable demand commitments, written as offtake, give
                  infrastructure builders a contracted reason to add capacity.
                </p>
                <div style={{ display: "grid", gap: 0, fontSize: "15px" }}>
                  <div
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #E5E5E5",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: "#000000",
                        marginRight: "10px",
                      }}
                    >
                      01
                    </span>
                    Buyer commits to multi-year demand
                  </div>
                  <div
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #E5E5E5",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: "#000000",
                        marginRight: "10px",
                      }}
                    >
                      02
                    </span>
                    Offtake is matched to qualified supply
                  </div>
                  <div
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #E5E5E5",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: "#000000",
                        marginRight: "10px",
                      }}
                    >
                      03
                    </span>
                    Supplier finances compute buildout
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "2px solid #0A0A0A", paddingTop: "20px" }}>
                <h3
                  style={{
                    margin: "0 0 12px",
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 500,
                    fontSize: "26px",
                  }}
                >
                  Supplier neutrality
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: "16px",
                    lineHeight: 1.55,
                    color: "#404040",
                  }}
                >
                  PACT does not own the capacity it qualifies. Suppliers clear on
                  the same published criteria, and buyers see why a supplier was
                  eligible before they see a price.
                </p>
              </div>
              <div style={{ borderTop: "2px solid #0A0A0A", paddingTop: "20px" }}>
                <h3
                  style={{
                    margin: "0 0 12px",
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 500,
                    fontSize: "26px",
                  }}
                >
                  Commercial routing &amp; credits
                </h3>
                <p
                  style={{
                    margin: "0 0 18px",
                    fontSize: "16px",
                    lineHeight: 1.55,
                    color: "#404040",
                  }}
                >
                  PACT routing is the commercial routing service. Buyers hold
                  prepaid PACT credits; each top-up carries a disclosed fee.
                  Usage draws down against credits with a receipt for every call.
                </p>
                <span
                  onClick={() => go("company")}
                  style={{
                    fontSize: "15px",
                    fontWeight: 500,
                    color: "#000000",
                    cursor: "pointer",
                  }}
                >
                  Request beta access →
                </span>
              </div>
            </section>
          </div>
        )}

        {/* RESEARCH */}
        {page === "research" && (
          <div data-screen-label="05 Research">
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "clamp(48px,7vw,96px) clamp(20px,4vw,40px) 56px",
              }}
            >
              <p
                style={{
                  margin: "0 0 20px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "12px",
                  color: "#000000",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Research &amp; Advisory
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "'Newsreader', serif",
                  fontWeight: 400,
                  fontSize: "clamp(44px,6vw,80px)",
                  lineHeight: 1.02,
                  letterSpacing: "-0.02em",
                }}
              >
                Discoveries people can use.
              </h1>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 64px",
              }}
            >
              <article
                style={{
                  borderTop: "2px solid #0A0A0A",
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,360px),1fr))",
                  gap: "40px",
                  paddingTop: "28px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "12px",
                      color: "#525252",
                    }}
                  >
                    Evidence Brief · 9 Nov 2026
                  </span>
                  <h2
                    style={{
                      margin: "12px 0 0",
                      fontFamily: "'Newsreader', serif",
                      fontWeight: 400,
                      fontSize: "clamp(32px,3.6vw,48px)",
                      lineHeight: 1.08,
                    }}
                  >
                    What it takes to supply intelligence from Australia
                  </h2>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    justifyContent: "end",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "18px",
                      lineHeight: 1.55,
                      color: "#404040",
                    }}
                  >
                    Energy, compute, connectivity, skills and law, assessed as
                    one supply chain. Drawn from the Infrastructure Evidence
                    Register.
                  </p>
                  <span
                    style={{
                      fontSize: "16px",
                      fontWeight: 500,
                      color: "#000000",
                      cursor: "pointer",
                    }}
                  >
                    Read the brief →
                  </span>
                </div>
              </article>
            </section>

            <section
              style={{
                background: "#F5F5F5",
                borderTop: "1px solid #E5E5E5",
                borderBottom: "1px solid #E5E5E5",
              }}
            >
              <div
                style={{
                  maxWidth: "1240px",
                  margin: "0 auto",
                  padding: "56px clamp(20px,4vw,40px) 64px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "end",
                    gap: "20px",
                    flexWrap: "wrap",
                    marginBottom: "22px",
                  }}
                >
                  <div>
                    <h2
                      style={{
                        margin: 0,
                        fontFamily: "'Newsreader', serif",
                        fontWeight: 400,
                        fontSize: "clamp(28px,3vw,38px)",
                      }}
                    >
                      Infrastructure Evidence Register
                    </h2>
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "12px",
                        color: "#525252",
                      }}
                    >
                      AU / UK / US · Revision 125 · Cut-off 9 Oct 2026
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 0, border: "1px solid #0A0A0A" }}>
                    {regTabs.map((t) => (
                      <span
                        key={t.label}
                        onClick={t.select}
                        style={{
                          cursor: "pointer",
                          padding: "8px 18px",
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "13px",
                          background: t.bg,
                          color: t.fg,
                        }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div
                  style={{ background: "#FFFFFF", border: "1px solid #E5E5E5" }}
                >
                  {(REG[regKey] ?? REG.AU).map((r) => (
                    <div
                      key={r.k}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit,minmax(min(100%,200px),1fr))",
                        gap: "8px 24px",
                        padding: "16px 20px",
                        borderBottom: "1px solid #E5E5E5",
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: "16px" }}>
                        {r.k}
                      </span>
                      <span style={{ fontSize: "15px", color: "#404040" }}>
                        {r.v}
                      </span>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "12px",
                          color: "#525252",
                        }}
                      >
                        {r.src}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "72px clamp(20px,4vw,40px) 88px",
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(min(100%,380px),1fr))",
                gap: "56px",
              }}
            >
              <div style={{ borderTop: "2px solid #0A0A0A", paddingTop: "20px" }}>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "12px",
                    color: "#000000",
                  }}
                >
                  Commissioned Advisory Briefs
                </span>
                <h3
                  style={{
                    margin: "10px 0 12px",
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 500,
                    fontSize: "28px",
                    lineHeight: 1.15,
                  }}
                >
                  A question, a register, a written answer.
                </h3>
                <p
                  style={{
                    margin: "0 0 16px",
                    fontSize: "16px",
                    lineHeight: 1.55,
                    color: "#404040",
                  }}
                >
                  Governments, buyers and infrastructure owners commission briefs
                  on a defined question. Each is sourced to the register and
                  records where the evidence is thin.
                </p>
                <span
                  onClick={() => go("company")}
                  style={{
                    fontSize: "15px",
                    fontWeight: 500,
                    color: "#000000",
                    cursor: "pointer",
                  }}
                >
                  Commission a brief →
                </span>
              </div>
              <div style={{ borderTop: "2px solid #0A0A0A", paddingTop: "20px" }}>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "12px",
                    color: "#525252",
                  }}
                >
                  Research Agenda
                </span>
                <h3
                  style={{
                    margin: "10px 0 12px",
                    fontFamily: "'Newsreader', serif",
                    fontWeight: 500,
                    fontSize: "28px",
                    lineHeight: 1.15,
                  }}
                >
                  When should an agent ask permission?
                </h3>
                <ol
                  style={{
                    margin: 0,
                    paddingLeft: "20px",
                    fontSize: "16px",
                    lineHeight: 1.55,
                    color: "#404040",
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  <li>
                    Which decisions can be delegated, and to what limit?
                  </li>
                  <li>
                    How should recorded dissent change the threshold for
                    escalation?
                  </li>
                  <li>
                    What makes an action reversible enough to proceed without a
                    person?
                  </li>
                </ol>
              </div>
            </section>
          </div>
        )}

        {/* COMPANY */}
        {page === "company" && (
          <div data-screen-label="06 Company">
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "clamp(48px,7vw,96px) clamp(20px,4vw,40px) 56px",
              }}
            >
              <p
                style={{
                  margin: "0 0 20px",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "12px",
                  color: "#000000",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Company
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "'Newsreader', serif",
                  fontWeight: 400,
                  fontSize: "clamp(44px,6vw,80px)",
                  lineHeight: 1.02,
                  letterSpacing: "-0.02em",
                }}
              >
                Distinct roles, one record.
              </h1>
              <p
                style={{
                  margin: "26px 0 0",
                  fontSize: "20px",
                  lineHeight: 1.5,
                  maxWidth: "680px",
                  color: "#404040",
                }}
              >
                Each part of PACT has a separate role and status, so buyers and
                contributors know what is open, what is offered and what is
                proposed.
              </p>
            </section>
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 64px",
              }}
            >
              <div style={{ borderTop: "2px solid #0A0A0A", overflowX: "auto" }}>
                {ROLES.map((r) => (
                  <div
                    key={r.k}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(180px,1fr) minmax(260px,2fr) minmax(150px,0.8fr)",
                      gap: "20px",
                      padding: "20px 0",
                      borderBottom: "1px solid #E5E5E5",
                      minWidth: "640px",
                      alignItems: "baseline",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Newsreader', serif",
                        fontSize: "22px",
                      }}
                    >
                      {r.k}
                    </span>
                    <span
                      style={{
                        fontSize: "16px",
                        lineHeight: 1.5,
                        color: "#404040",
                      }}
                    >
                      {r.v}
                    </span>
                    <span
                      style={{
                        justifySelf: "start",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        border: `1px solid ${r.tone}`,
                        color: r.tone,
                        padding: "3px 8px",
                      }}
                    >
                      {r.s}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section
              style={{
                maxWidth: "1240px",
                margin: "0 auto",
                padding: "0 clamp(20px,4vw,40px) 88px",
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(min(100%,320px),1fr))",
                gap: "40px",
              }}
            >
              <div
                style={{
                  background: "#F5F5F5",
                  border: "1px solid #E5E5E5",
                  padding: "26px",
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "12px",
                    color: "#000000",
                  }}
                >
                  Licensing
                </span>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: "17px",
                    lineHeight: 1.55,
                  }}
                >
                  Protocol code is released under the MIT licence. The PACT
                  specification is available royalty-free to implement.
                </p>
              </div>
              <div
                style={{
                  background: "#F5F5F5",
                  border: "1px solid #E5E5E5",
                  padding: "26px",
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "12px",
                    color: "#000000",
                  }}
                >
                  Contracting entity
                </span>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: "17px",
                    lineHeight: 1.55,
                  }}
                >
                  Tailor Intelligence Pty Ltd. All commercial agreements,
                  including PACT credits and market contracts, are made with this
                  entity.
                </p>
              </div>
            </section>
          </div>
        )}
      </main>

      <footer style={{ background: "#0A0A0A", color: "#F5F5F5" }}>
        <div
          style={{
            maxWidth: "1240px",
            margin: "0 auto",
            padding: "48px clamp(20px,4vw,40px) 36px",
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(min(100%,220px),1fr))",
            gap: "32px",
          }}
        >
          <div>
            <span
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: "28px",
                fontWeight: 600,
                letterSpacing: "0.06em",
              }}
            >
              PACT
            </span>
            <p
              style={{
                margin: "10px 0 0",
                fontSize: "14px",
                lineHeight: 1.5,
                color: "#A3A3A3",
              }}
            >
              The canonical layer of agreement.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gap: "8px",
              fontSize: "14px",
              alignContent: "start",
            }}
          >
            {nav.map((n) => (
              <span
                key={n.id}
                onClick={n.go}
                style={{ cursor: "pointer", color: "#F5F5F5" }}
              >
                {n.label}
              </span>
            ))}
          </div>
          <div
            style={{
              fontSize: "14px",
              lineHeight: 1.6,
              color: "#A3A3A3",
            }}
          >
            Tailor Intelligence Pty Ltd
            <br />
            Protocol code MIT · Specification royalty-free
            <br />
            pact.tailor.au
          </div>
        </div>
        <div style={{ borderTop: "1px solid #404040" }}>
          <div
            style={{
              maxWidth: "1240px",
              margin: "0 auto",
              padding: "18px clamp(20px,4vw,40px)",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "12px",
              letterSpacing: "0.14em",
              color: "#A3A3A3",
              display: "flex",
              flexWrap: "wrap",
              gap: "6px 18px",
            }}
          >
            <span>AUSTRALIA</span>
            <span>·</span>
            <span>CANADA</span>
            <span>·</span>
            <span>NEW ZEALAND</span>
            <span>·</span>
            <span>UNITED KINGDOM</span>
            <span>·</span>
            <span>UNITED STATES</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default PactEditorialSite;
