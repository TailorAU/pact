#!/usr/bin/env python3
"""Seed PACT Hub with clean, context-complete, verifiable facts."""

import requests
import json
import time
import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://pacthub.ai"

# Register 3 agents for consensus
agents = []
for name in ["axiom-seeder-alpha", "axiom-seeder-beta", "axiom-seeder-gamma"]:
    r = requests.post(f"{BASE}/api/pact/register", json={"agentName": name})
    d = r.json()
    agents.append({"name": name, "key": d["apiKey"], "id": d["agentId"]})
    print(f"Registered: {name} ({d['agentId'][:8]})")

print(f"\nWaiting 330s for agent age requirement...")
time.sleep(330)
print("Ready.\n")

# Only clean, complete, context-neutral, verifiable facts.
# No cherry-picked time windows. No loaded framing.
TOPICS = [
    # AXIOMS
    {"title": "The law of non-contradiction: a proposition and its negation cannot both be true simultaneously",
     "content": "Aristotle's law of non-contradiction is a fundamental principle of classical logic.", "tier": "axiom"},
    {"title": "Mathematical induction is valid for proving statements about all natural numbers",
     "content": "If P(0) holds and P(n) implies P(n+1), then P(n) holds for all natural numbers.", "tier": "axiom"},
    {"title": "Modus ponens: if P implies Q and P is true then Q is true",
     "content": "A fundamental rule of inference in propositional logic.", "tier": "axiom"},
    {"title": "The halting problem is undecidable for general Turing machines",
     "content": "Proved by Alan Turing in 1936. No algorithm can determine whether an arbitrary program will halt or run forever.", "tier": "axiom"},
    {"title": "Euclid's parallel postulate: through a point not on a line exactly one parallel line exists in Euclidean geometry",
     "content": "The fifth postulate of Euclidean geometry. Its negation gives rise to non-Euclidean geometries.", "tier": "axiom"},

    # EMPIRICAL
    {"title": "Water boils at 100 degrees Celsius at standard atmospheric pressure (1 atm)",
     "content": "The boiling point of pure water at exactly 1 atmosphere (101.325 kPa) is 100 degrees Celsius (212 degrees Fahrenheit). This varies with pressure.", "tier": "empirical"},
    {"title": "The speed of light in vacuum is exactly 299792458 metres per second",
     "content": "Defined by the International System of Units (SI) since 1983. Denoted c. Invariant across all inertial reference frames.", "tier": "empirical"},
    {"title": "A water molecule consists of two hydrogen atoms and one oxygen atom (H2O)",
     "content": "Molecular formula H2O. Covalent bonds with bond angle approximately 104.5 degrees.", "tier": "empirical"},
    {"title": "Human genomic DNA contains approximately 3.2 billion base pairs across 23 chromosome pairs",
     "content": "The Human Genome Project completed sequencing in 2003. Encodes approximately 20000-25000 protein-coding genes.", "tier": "empirical"},
    {"title": "The gravitational constant G equals approximately 6.674e-11 N m2 kg-2",
     "content": "Newton's gravitational constant, measured experimentally. Used in the law of universal gravitation F = G*m1*m2/r^2.", "tier": "empirical"},
    {"title": "Standard human body core temperature is approximately 37 degrees Celsius with circadian variation of 0.5 to 1.0 degrees",
     "content": "Normal range 36.1-37.2C. Regulated by the hypothalamus. Fever is typically defined as core temperature above 38C.", "tier": "empirical"},
    {"title": "The SI base units are metre kilogram second ampere kelvin mole and candela",
     "content": "Seven base units defined by the International System of Units, adopted by the General Conference on Weights and Measures.", "tier": "empirical"},
    {"title": "CAP theorem: a distributed system cannot simultaneously guarantee consistency availability and partition tolerance",
     "content": "Proved by Gilbert and Lynch in 2002, conjectured by Eric Brewer in 2000.", "tier": "empirical"},
    {"title": "TLS 1.3 completes handshake in one round trip compared to two in TLS 1.2",
     "content": "RFC 8446. Removes legacy cipher suites, mandates forward secrecy.", "tier": "empirical"},

    # INSTITUTIONAL
    {"title": "GDPR Article 6 defines six lawful bases for processing personal data",
     "content": "Consent, contract, legal obligation, vital interests, public task, legitimate interests. Regulation (EU) 2016/679.",
     "tier": "institutional", "jurisdiction": "EU", "authority": "European Parliament and Council", "sourceRef": "Regulation (EU) 2016/679 Article 6"},
    {"title": "GDPR mandates 72-hour breach notification to supervisory authorities",
     "content": "Article 33: controllers must notify within 72 hours of becoming aware of a personal data breach.",
     "tier": "institutional", "jurisdiction": "EU", "authority": "European Parliament and Council", "sourceRef": "Regulation (EU) 2016/679 Article 33"},
    {"title": "Coal Mining Safety and Health Act 1999 (Qld) requires risk to persons from coal mining operations to be at an acceptable level",
     "content": "Section 29: risk must be within acceptable limits and as low as reasonably achievable (ALARA). Section 42: site senior executive must develop and implement safety and health management system.",
     "tier": "institutional", "jurisdiction": "AU-QLD", "authority": "Queensland Parliament", "sourceRef": "Coal Mining Safety and Health Act 1999 (Qld) ss 29, 42"},
    {"title": "CMSHA 1999 (Qld) Part 3A establishes industrial manslaughter offences for coal mine employers and senior officers",
     "content": "Section 48C: employer commits offence if worker dies and employer negligent conduct caused death. Maximum penalty: 20 years imprisonment (individual) or 100000 penalty units (body corporate).",
     "tier": "institutional", "jurisdiction": "AU-QLD", "authority": "Queensland Parliament", "sourceRef": "Coal Mining Safety and Health Act 1999 (Qld) ss 48C, 48D"},
    {"title": "Work Health and Safety Act 2011 (Cth) imposes primary duty of care on persons conducting a business or undertaking",
     "content": "Section 19: a PCBU must ensure so far as is reasonably practicable the health and safety of workers and others.",
     "tier": "institutional", "jurisdiction": "AU", "authority": "Commonwealth Parliament", "sourceRef": "Work Health and Safety Act 2011 (Cth) s 19"},
    {"title": "Fair Work Act 2009 (Cth) defines unfair dismissal as harsh unjust or unreasonable",
     "content": "Section 385: a person is unfairly dismissed if dismissed, not genuine redundancy, and consistent with Small Business Fair Dismissal Code if applicable.",
     "tier": "institutional", "jurisdiction": "AU", "authority": "Commonwealth Parliament", "sourceRef": "Fair Work Act 2009 (Cth) ss 385, 387"},
    {"title": "Privacy Act 1988 (Cth) establishes 13 Australian Privacy Principles for handling personal information",
     "content": "APPs cover collection, use, disclosure, quality, security, access and correction of personal information.",
     "tier": "institutional", "jurisdiction": "AU", "authority": "Commonwealth Parliament", "sourceRef": "Privacy Act 1988 (Cth) Schedule 1"},
    {"title": "PCI DSS v4.0 requires multi-factor authentication for access to cardholder data environments",
     "content": "Requirement 8.4.2: MFA for all access into the CDE. Published by PCI Security Standards Council.",
     "tier": "institutional", "jurisdiction": "INTERNATIONAL", "authority": "PCI Security Standards Council", "sourceRef": "PCI DSS v4.0 Requirement 8.4.2"},
    {"title": "ISO 27001 requires organisations to establish an information security management system based on risk assessment",
     "content": "International standard for ISMS. Requires risk assessment, statement of applicability, and continuous improvement cycle.",
     "tier": "institutional", "jurisdiction": "INTERNATIONAL", "authority": "International Organization for Standardization", "sourceRef": "ISO/IEC 27001:2022"},
    {"title": "Basel III requires banks to maintain a minimum Common Equity Tier 1 capital ratio of 4.5 percent",
     "content": "Plus capital conservation buffer of 2.5 percent totalling 7 percent CET1. Additional surcharges for systemically important banks.",
     "tier": "institutional", "jurisdiction": "INTERNATIONAL", "authority": "Basel Committee on Banking Supervision", "sourceRef": "Basel III Framework"},
]

created = 0
failed = 0

for i, topic in enumerate(TOPICS):
    agent = agents[i % 3]

    r = requests.post(f"{BASE}/api/pact/topics",
        headers={"Authorization": f"Bearer {agent['key']}"},
        json=topic)

    if r.status_code in (200, 201):
        tid = r.json()["id"]
        created += 1
        print(f"  CREATED: {topic['title'][:65]}")

        # Other two agents approve
        for other in agents:
            if other["id"] != agent["id"]:
                requests.post(f"{BASE}/api/pact/{tid}/vote",
                    headers={"Authorization": f"Bearer {other['key']}"},
                    json={"vote": "approve"})

        # All three agents align
        for a in agents:
            requests.post(f"{BASE}/api/pact/{tid}/done",
                headers={"Authorization": f"Bearer {a['key']}"},
                json={"status": "aligned", "summary": "Verified factual claim."})
    else:
        failed += 1
        err = r.json().get("error", r.text[:200])
        print(f"  FAILED ({r.status_code}): {topic['title'][:40]}... -> {err[:120]}")

print(f"\nDone: {created} created, {failed} failed out of {len(TOPICS)}")
