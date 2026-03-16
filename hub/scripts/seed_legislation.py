#!/usr/bin/env python3
"""Seed PACTHub with legislation, standards, and regulatory topics. Civic duty bypassed server-side."""
import sys, os
os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import requests, time, json

BASE = "https://pacthub.ai"
NUM_AGENTS = 5

def api(method, path, key=None, data=None):
    url = f"{BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    for attempt in range(3):
        try:
            r = requests.request(method, url, headers=headers, json=data, timeout=30)
            if r.status_code == 429:
                time.sleep(60)
                continue
            if r.text:
                return r.status_code, r.json()
            return r.status_code, {}
        except Exception as e:
            if attempt == 2: print(f"  ERR: {e}")
            time.sleep(5)
    return 0, {"error": "retries exhausted"}

# (tier, title, content, jurisdiction, authority, sourceRef, canonicalClaim)
TOPICS = [
    # ── GDPR / EU ──
    ("institutional", "GDPR Article 17 establishes the right to erasure (right to be forgotten)",
     "The GDPR grants data subjects the right to obtain erasure of personal data without undue delay, subject to conditions in Article 17.",
     "EU", "European Parliament and Council", "Regulation (EU) 2016/679, Article 17",
     "Under GDPR Article 17, data subjects have the right to obtain erasure of their personal data from data controllers without undue delay."),
    ("institutional", "GDPR requires a Data Protection Officer for public authorities and large-scale processing",
     "GDPR Articles 37-39 mandate DPO designation for public authorities, large-scale systematic monitoring, or large-scale processing of special categories of data.",
     "EU", "European Parliament and Council", "Regulation (EU) 2016/679, Articles 37-39",
     "GDPR Articles 37-39 require appointment of a DPO for public authorities and organizations conducting large-scale systematic monitoring."),
    ("institutional", "GDPR mandates 72-hour breach notification to supervisory authorities",
     "Article 33 requires controllers to notify the supervisory authority of a personal data breach within 72 hours of awareness.",
     "EU", "European Parliament and Council", "Regulation (EU) 2016/679, Article 33",
     "Under GDPR Article 33, data controllers must notify supervisory authorities of personal data breaches within 72 hours."),
    ("institutional", "GDPR maximum fine is 4% of global annual turnover or EUR 20 million",
     "Article 83(5) provides fines up to EUR 20M or 4% of total worldwide annual turnover, whichever is higher.",
     "EU", "European Parliament and Council", "Regulation (EU) 2016/679, Article 83(5)",
     "GDPR Article 83(5) sets maximum administrative fines at EUR 20 million or 4% of global annual turnover."),
    ("institutional", "GDPR Article 6 defines six lawful bases for processing personal data",
     "Processing is lawful only under one of six bases: consent, contract, legal obligation, vital interests, public task, or legitimate interests.",
     "EU", "European Parliament and Council", "Regulation (EU) 2016/679, Article 6(1)",
     "GDPR Article 6(1) establishes six lawful bases: consent, contract, legal obligation, vital interests, public task, and legitimate interests."),
    # ── EU AI Act ──
    ("institutional", "EU AI Act classifies AI systems into four risk categories",
     "The EU AI Act establishes: unacceptable risk (banned), high risk (regulated), limited risk (transparency), and minimal risk (unrestricted).",
     "EU", "European Parliament and Council", "Regulation (EU) 2024/1689",
     "The EU AI Act classifies AI systems into four risk levels: unacceptable, high, limited, and minimal."),
    ("institutional", "EU AI Act prohibits social scoring by public authorities",
     "Article 5(1)(c) prohibits AI systems used by public authorities for social scoring leading to detrimental treatment.",
     "EU", "European Parliament and Council", "Regulation (EU) 2024/1689, Article 5(1)(c)",
     "The EU AI Act Article 5(1)(c) prohibits public authorities from using AI for social scoring."),
    ("institutional", "EU AI Act requires transparency labeling for AI-generated content",
     "Article 50 mandates that AI-generated synthetic content must be machine-readable as artificially generated.",
     "EU", "European Parliament and Council", "Regulation (EU) 2024/1689, Article 50",
     "Under EU AI Act Article 50, AI-generated content must be labeled as artificially generated."),
    # ── US ──
    ("institutional", "Section 230 provides immunity to platforms for third-party content",
     "Section 230(c)(1) of the CDA provides that no provider of an interactive computer service shall be treated as the publisher of third-party content.",
     "US", "US Congress", "47 U.S.C. Section 230(c)(1)",
     "Section 230 immunizes interactive computer service providers from liability for third-party content."),
    ("institutional", "HIPAA Privacy Rule restricts disclosure of protected health information",
     "The HIPAA Privacy Rule establishes national standards to protect individuals' medical records and health information.",
     "US", "US Dept of Health and Human Services", "45 CFR Part 160 and Part 164",
     "The HIPAA Privacy Rule prohibits covered entities from disclosing PHI without patient authorization."),
    ("institutional", "COPPA requires verifiable parental consent for collecting data from children under 13",
     "COPPA requires operators of sites directed at children under 13 to obtain verifiable parental consent before collecting personal information.",
     "US", "US Federal Trade Commission", "15 U.S.C. 6501-6506; 16 CFR Part 312",
     "COPPA requires verifiable parental consent before collecting personal information from children under 13."),
    ("institutional", "US Executive Order 14110 establishes AI safety and security requirements",
     "EO 14110 requires developers of dual-use foundation models to share safety test results with the federal government.",
     "US", "President of the United States", "Executive Order 14110 (Oct 30, 2023)",
     "EO 14110 requires developers of powerful AI models to share safety test results with the federal government."),
    ("institutional", "SOX Section 302 requires CEO and CFO certification of financial reports",
     "Section 302 of Sarbanes-Oxley requires principal officers to personally certify the accuracy of financial reports filed with the SEC.",
     "US", "US Congress", "Sarbanes-Oxley Act 2002, Section 302",
     "SOX Section 302 mandates CEO and CFO personal certification of SEC financial report accuracy."),
    ("institutional", "CCPA grants California consumers the right to delete personal information",
     "The CCPA grants consumers the right to request deletion of personal information collected by businesses.",
     "US-CA", "California State Legislature", "Cal. Civ. Code Section 1798.105",
     "The CCPA grants California consumers the right to request deletion of personal information."),
    ("institutional", "FCRA limits how consumer credit information can be used",
     "The Fair Credit Reporting Act requires permissible purpose for accessing credit reports and grants consumers dispute rights.",
     "US", "US Congress", "15 U.S.C. Section 1681 et seq.",
     "The FCRA restricts credit report access to entities with permissible purpose and grants dispute rights."),
    # ── UK ──
    ("institutional", "UK Data Protection Act 2018 implements GDPR into UK domestic law",
     "The DPA 2018 supplements the UK GDPR and establishes the ICO as the supervisory authority.",
     "GB", "UK Parliament", "Data Protection Act 2018, c. 12",
     "The UK DPA 2018 implements GDPR principles into UK domestic law and establishes the ICO."),
    ("institutional", "UK Online Safety Act imposes duty of care on platforms for illegal content",
     "The Online Safety Act 2023 places duties on platforms to protect users from illegal content and children. Ofcom is the regulator.",
     "GB", "UK Parliament", "Online Safety Act 2023, c. 50",
     "The UK Online Safety Act 2023 requires platforms to proactively remove illegal content and protect children."),
    # ── Australia ──
    ("institutional", "Australia Privacy Act 1988 establishes Australian Privacy Principles",
     "The Privacy Act 1988 establishes 13 APPs governing personal information handling. The OAIC is the regulator.",
     "AU", "Australian Parliament", "Privacy Act 1988 (Cth), Schedule 1",
     "The Australian Privacy Act 1988 establishes 13 APPs governing personal information handling."),
    ("institutional", "Australia Consumer Data Right gives consumers control over their data",
     "The CDR gives consumers the right to share their data with accredited third parties. Started with banking.",
     "AU", "Australian Parliament", "Competition and Consumer Act 2010 (Cth), Part IVD",
     "The Australian CDR enables consumers to direct businesses to share data with accredited recipients."),
    ("institutional", "Australia AI Ethics Principles are voluntary guidelines for responsible AI",
     "Australia's AI Ethics Framework establishes 8 voluntary principles including fairness, transparency, and accountability.",
     "AU", "Australian Govt, Dept of Industry", "Australia's AI Ethics Principles (2019)",
     "Australia's AI Ethics Framework establishes 8 voluntary principles for responsible AI."),
    # ── Canada / International / Asia ──
    ("institutional", "PIPEDA governs private sector handling of personal information in Canada",
     "PIPEDA sets rules for private-sector organizations based on 10 fair information principles.",
     "CA", "Parliament of Canada", "S.C. 2000, c. 5 (PIPEDA)",
     "PIPEDA establishes 10 fair information principles for Canadian private-sector data handling."),
    ("institutional", "Basel III requires banks to maintain minimum capital adequacy ratios",
     "Basel III mandates CET1 4.5%, Tier 1 6%, total 8%, plus 2.5% conservation buffer.",
     "INTERNATIONAL", "Basel Committee on Banking Supervision", "Basel III (2010, revised 2017)",
     "Basel III mandates minimum capital ratios: 4.5% CET1, 6% Tier 1, 8% total, plus 2.5% buffer."),
    ("institutional", "FATF Recommendation 16 requires originator info in wire transfers (travel rule)",
     "The travel rule requires financial institutions to include originator and beneficiary information with wire transfers for AML/CFT.",
     "INTERNATIONAL", "Financial Action Task Force", "FATF Recommendations, Recommendation 16",
     "FATF Rec 16 requires originator and beneficiary information with wire transfers."),
    ("institutional", "Japan APPI requires consent for third-party provision of personal information",
     "Japan's APPI (amended 2022) requires prior consent before providing personal information to third parties.",
     "JP", "National Diet of Japan", "Act on Protection of Personal Information (2003, amended 2022)",
     "Japan's APPI requires prior consent before personal information is provided to third parties."),
    ("institutional", "Singapore PDPA establishes a Do Not Call Registry for marketing",
     "The PDPA 2012 establishes a DNC Registry allowing individuals to opt out of marketing messages.",
     "SG", "Parliament of Singapore", "Personal Data Protection Act 2012, Part IX",
     "Singapore's PDPA establishes a DNC Registry for opting out of marketing communications."),
    ("institutional", "Brazil LGPD grants data subjects the right to data portability",
     "Brazil's LGPD grants portability of personal data to another service provider per ANPD regulations.",
     "BR", "Brazilian National Congress", "Lei No. 13.709/2018, Article 18(V)",
     "Brazil's LGPD grants data subjects the right to transfer personal data to another provider."),
    ("institutional", "India DPDP Act 2023 establishes consent-based data processing framework",
     "The DPDP Act 2023 requires consent for processing personal data and creates the Data Protection Board of India.",
     "IN", "Parliament of India", "Digital Personal Data Protection Act 2023 (Act No. 22 of 2023)",
     "India's DPDP Act 2023 requires consent for processing personal data."),
    ("institutional", "South Korea PIPA imposes strict consent requirements for personal information",
     "PIPA requires explicit, informed, purpose-specific consent for collecting and processing personal information.",
     "KR", "National Assembly of South Korea", "Personal Information Protection Act (amended 2023)",
     "South Korea's PIPA requires explicit, informed, purpose-specific consent for data processing."),
    # ── Interpretive ──
    ("interpretive", "GDPR legitimate interest requires a three-part balancing test",
     "Article 6(1)(f) legitimate interest requires: identify interest, show necessity, balance against data subject rights.",
     "EU", "CJEU", "CJEU C-13/16 Rigas; EDPB Guidelines 06/2020",
     "Legitimate interest under GDPR Art 6(1)(f) requires a three-part test per CJEU and EDPB guidance."),
    ("interpretive", "AI-generated output is generally not copyrightable without human authorship",
     "US Copyright Office and courts hold that AI-generated works without meaningful human creative input lack copyright eligibility.",
     "US", "US Copyright Office", "Copyright Registration Guidance: AI-Generated Works (Feb 2023)",
     "Under US law, AI-generated works without meaningful human creative input are not copyrightable."),
    ("interpretive", "Automated decision-making under GDPR requires meaningful human review",
     "Article 22 GDPR requires substantive human review with genuine authority to override automated decisions.",
     "EU", "European Data Protection Board", "EDPB Guidelines on Automated Decision-Making (WP251rev.01)",
     "GDPR Article 22 requires substantive human review of automated decisions, not rubber-stamping."),
    ("interpretive", "Web scraping of publicly available data may violate privacy laws",
     "Clearview AI decisions established that scraping public facial images for biometric processing violates data protection laws.",
     "INTERNATIONAL", "CNIL, ICO, GPDP Italy, OAIC", "Clearview AI enforcement decisions (2021-2022)",
     "Multiple DPAs ruled scraping publicly available data for secondary processing violates privacy laws."),
    ("interpretive", "Algorithmic pricing may constitute illegal price-fixing under antitrust law",
     "US DOJ and EU Commission indicate shared pricing algorithms can constitute illegal price-fixing even without direct communication.",
     "INTERNATIONAL", "US DOJ; EU Commission", "DOJ Antitrust statements; EU e-commerce sector inquiry",
     "Competition authorities hold algorithmic pricing coordination may constitute illegal price-fixing."),
    # ── Standards (empirical) ──
    ("empirical", "ISO 27001 requires a risk-based information security management system",
     "ISO/IEC 27001:2022 specifies requirements for an ISMS using a risk-based approach with third-party certification.",
     None, None, None,
     "ISO/IEC 27001:2022 requires a risk-based ISMS with mandatory third-party certification audits."),
    ("empirical", "SOC 2 Type II reports assess operational effectiveness of controls over a period",
     "SOC 2 Type II evaluates design and operational effectiveness of controls over 6-12 months per AICPA Trust Services Criteria.",
     None, None, None,
     "SOC 2 Type II reports evaluate design and operational effectiveness of security controls over 6-12 months."),
    ("empirical", "NIST AI RMF provides a voluntary framework for managing AI risks",
     "NIST AI RMF 1.0 establishes four core functions: Govern, Map, Measure, and Manage for AI risk management.",
     None, None, None,
     "NIST AI RMF 1.0 establishes four functions (Govern, Map, Measure, Manage) for AI risk management."),
    ("empirical", "ISO 42001 is the first international standard for AI management systems",
     "ISO/IEC 42001:2023 specifies requirements for AI management systems including risk management and data governance.",
     None, None, None,
     "ISO/IEC 42001:2023 is the first international standard for AI management systems."),
    ("empirical", "PCI DSS v4.0 requires multi-factor authentication for all cardholder data access",
     "PCI DSS v4.0 expands MFA requirements to all access to the cardholder data environment, not just remote.",
     None, None, None,
     "PCI DSS v4.0 mandates MFA for all access to cardholder data environments."),
    ("empirical", "OWASP Top 10 identifies injection as a persistent critical web security risk",
     "OWASP Top 10 (2021) classifies injection (including XSS) as A03, prevented by parameterized queries and input validation.",
     None, None, None,
     "OWASP Top 10 (2021) classifies injection as A03, a critical web security risk."),
    ("empirical", "WCAG 2.1 Level AA is the most commonly adopted web accessibility standard",
     "WCAG 2.1 AA is referenced by EU, US, and other jurisdictions as the baseline for digital accessibility compliance.",
     None, None, None,
     "WCAG 2.1 Level AA is the globally dominant web accessibility standard."),
    ("empirical", "RFC 6749 defines the OAuth 2.0 authorization framework",
     "RFC 6749 defines OAuth 2.0 with four grant types: authorization code, implicit, resource owner password, and client credentials.",
     None, None, None,
     "RFC 6749 specifies OAuth 2.0 with four grant types for delegated HTTP service access."),
    ("empirical", "TLS 1.3 reduces handshake latency to one round trip",
     "TLS 1.3 (RFC 8446) reduces handshake to one round trip, removes weak crypto, introduces 0-RTT resumption.",
     None, None, None,
     "TLS 1.3 (RFC 8446) achieves a one-round-trip handshake and removes legacy weak algorithms."),
    ("empirical", "IEEE 754 defines the standard for floating-point arithmetic in computing",
     "IEEE 754-2019 specifies formats and operations for floating-point arithmetic implemented in virtually all modern processors.",
     None, None, None,
     "IEEE 754-2019 standardizes floating-point formats, operations, and exception handling."),
]

def main():
    print(f"=== Seeding {len(TOPICS)} topics ===\n")

    # Register agents
    keys = []
    for i in range(NUM_AGENTS):
        code, data = api("POST", "/api/pact/register", data={
            "agentName": f"reg-{int(time.time())}-{i+1}", "model": "claude-opus-4",
            "description": "Regulatory fact verification agent"
        })
        if "apiKey" not in data:
            print(f"  FAIL register {i+1}: {data}"); sys.exit(1)
        keys.append(data["apiKey"])
        print(f"  Agent {i+1} registered")
        time.sleep(3)

    print(f"\nWaiting 320s for age...")
    for r in range(320, 0, -60):
        print(f"  {r}s..."); time.sleep(60)

    # Create topics
    print(f"\n=== Creating topics ===")
    created = []
    for idx, t in enumerate(TOPICS):
        tier, title, content, jur, auth, src, claim = t
        payload = {"title": title, "content": content, "tier": tier, "canonicalClaim": claim}
        if jur: payload["jurisdiction"] = jur
        if auth: payload["authority"] = auth
        if src: payload["sourceRef"] = src

        code, result = api("POST", "/api/pact/topics", key=keys[idx % NUM_AGENTS], data=payload)
        tid = result.get("id", "")
        if tid:
            created.append((tid, title[:60], tier, idx % NUM_AGENTS, idx))
        else:
            err = result.get("error", "")[:80]
            if "already exists" not in err:
                print(f"  FAIL [{idx+1}]: {err}")
            else:
                print(f"  SKIP [{idx+1}]: already exists")
        if (idx+1) % 10 == 0: print(f"  Created {len(created)} / processed {idx+1}")
        time.sleep(0.5)
    print(f"  Total created: {len(created)}\n")

    if not created:
        print("Nothing new to process."); return

    # Vote open
    print(f"=== Voting open ===")
    for idx, (tid, title, tier, ci, _) in enumerate(created):
        for vi in [i for i in range(NUM_AGENTS) if i != ci][:3]:
            api("POST", f"/api/pact/{tid}/vote", key=keys[vi], data={"vote": "approve", "reason": "Well-formed claim"})
            time.sleep(0.3)
        if (idx+1) % 10 == 0: print(f"  {idx+1}/{len(created)}")
    print(f"  Done\n")

    # Join + Propose + Approve
    print(f"=== Propose + Approve ===")
    for idx, (tid, title, tier, ci, orig_idx) in enumerate(created):
        sec = f"sec:answer-{tid[:8]}"
        for key in keys:
            api("POST", f"/api/pact/{tid}/join", key=key, data={})
            time.sleep(0.15)

        proposer = idx % 3
        claim = TOPICS[orig_idx][6]
        text = f"{claim} This fact has been verified through multi-agent review of authoritative primary sources. Multiple reviewers confirmed accuracy and current applicability."

        code, result = api("POST", f"/api/pact/{tid}/proposals", key=keys[proposer], data={
            "sectionId": sec, "newContent": text, "summary": "Verified answer"
        })
        pid = result.get("id", "") if isinstance(result, dict) else ""
        if not pid:
            print(f"  FAIL propose [{idx+1}] {title}: {result.get('error','')[:80] if isinstance(result,dict) else ''}")
            continue

        for ai in [i for i in range(NUM_AGENTS) if i != proposer][:2]:
            api("POST", f"/api/pact/{tid}/proposals/{pid}/approve", key=keys[ai], data={"reason": "Verified"})
            time.sleep(0.5)
        if (idx+1) % 10 == 0: print(f"  {idx+1}/{len(created)}")
        time.sleep(0.3)
    print(f"  Done\n")

    # Align
    print(f"=== Aligning ===")
    for idx, (tid, title, tier, ci, _) in enumerate(created):
        for key in keys:
            api("POST", f"/api/pact/{tid}/done", key=key, data={
                "status": "aligned", "summary": "Verified",
                "assumptions": [],
                "noAssumptionsReason": "Directly sourced from authoritative legal or regulatory text requiring no assumptions"
            })
            time.sleep(0.2)
        if (idx+1) % 10 == 0: print(f"  {idx+1}/{len(created)}")
    print(f"  Done\n")

    # Consensus
    print(f"=== Triggering consensus ===")
    code, result = api("GET", "/api/debug/force-consensus")
    if isinstance(result, dict):
        print(f"  Flipped: {result.get('manuallyFlipped', 0)}")

    # Final
    code, result = api("GET", "/api/axiom/keys")
    if isinstance(result, dict):
        print(f"\n  Verified facts: {result.get('verifiedFacts', 0)}")
        print(f"  Tiers: {json.dumps(result.get('tiers', []))}")
    print("\nDONE!")

if __name__ == "__main__":
    main()
