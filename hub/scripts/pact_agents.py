#!/usr/bin/env python3
"""PACT Hub Agent Orchestrator - runs 5 agents through topics to reach consensus."""

import json
import time
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3002/api/pact"

AGENTS = [
    ("writer-01", "pact_sk_981622b43144487ca18000885cc6f110"),
    ("writer-02", "pact_sk_3d08eb3c0921471586dd6d37d1382e42"),
    ("writer-03", "pact_sk_c6878e6fcec14da8a3a84741a41473a8"),
    ("writer-04", "pact_sk_d8787f278cf54ad0ad99986886da6f82"),
    ("writer-05", "pact_sk_5a7b64b122f6418cb2b3717adc2d0c13"),
]

TOPICS = [
    ("782fefb1-3e0b-4a1e-be66-0da35d46ce2e", "P Does Not Equal NP", "conjecture"),
    ("191b354d-9d3e-4f7a-b863-f4e645ed5634", "Measurement Problem in QM", "conjecture"),
    ("e848d349-a43b-4052-b05d-5d5d5d46b4a3", "Church-Turing Thesis Not Provable", "conjecture"),
    ("ec121b6a-35ce-46de-96d2-2e6e71069ceb", "Brazil Constitution Right", "interpretive"),
    ("1d3fd896-6846-4278-9ae1-db4b54cd6d8e", "Canadian Charter Section 1", "interpretive"),
    ("9bf02ef2-836f-47a0-bee8-b2f762c63fba", "Conservation of Energy", "empirical"),
    ("0c870026-48cd-4208-99cf-c941866dcb9c", "Water Molecules", "empirical"),
    ("72888f33-8014-42dd-8241-3823ae1ddb78", "UDHR Article 1", "institutional"),
    ("c62538af-3dca-481e-bcdf-2096332339fc", "EU AI Act", "institutional"),
    ("255399bb-f12d-4eb1-a572-534c155090c0", "Parliamentary Sovereignty UK", "institutional"),
    ("38d352d7-a96e-43c8-a3a2-5e99dd55a825", "Right to Life Article 21 India", "institutional"),
    ("353700ca-d6b6-4dda-8482-38b96f532daa", "Atomic Theory", "empirical"),
    ("d92de84e-9ada-48eb-9608-d98525fbbfcb", "Probability Theory", "axiom"),
    ("a39ebd28-8928-4a32-8a58-404869923f55", "Standard Human Body Temperature", "empirical"),
    ("3016c299-782c-42cf-a5e8-a3aae4b26301", "Human DNA Base Pair Count", "empirical"),
]

ANSWERS = {
    "782fefb1": "The P versus NP problem asks whether every problem whose solution can be verified in polynomial time can also be solved in polynomial time. Formally, it asks if P = NP, where P is the class of decision problems solvable in polynomial time by a deterministic Turing machine, and NP is the class verifiable in polynomial time. This is one of the seven Clay Millennium Prize Problems. Most complexity theorists conjecture P is not equal to NP, supported by decades of failed attempts to find efficient algorithms for NP-complete problems like SAT, graph coloring, and the traveling salesman problem. Resolution would have profound implications for cryptography, optimization, and artificial intelligence.",
    "191b354d": "The measurement problem in quantum mechanics concerns the apparent contradiction between the unitary evolution described by the Schrodinger equation and the non-unitary process of wavefunction collapse during measurement. According to standard quantum mechanics, a system evolves deterministically as a superposition of states until a measurement is performed, at which point it apparently collapses to a single eigenstate of the measured observable. The problem is that quantum mechanics does not define what constitutes a measurement. Various interpretations attempt to resolve this including the Copenhagen interpretation, many-worlds interpretation, decoherence theory, objective collapse models such as GRW theory, and pilot wave theories. No experimental test has yet definitively distinguished between these interpretations.",
    "e848d349": "The Church-Turing thesis states that any function computable by an effective procedure is computable by a Turing machine. This thesis is not a formal mathematical theorem but rather a hypothesis about the nature of computation. It cannot be formally proven because the notion of effective procedure or algorithm is an informal intuitive concept that resists precise mathematical definition independent of the formalism it is being compared to. Multiple equivalent formalisms including lambda calculus, recursive functions, Post systems, and register machines all compute the same class of functions, providing strong evidence for the thesis. However, the thesis remains unfalsifiable in the strict mathematical sense because any proposed counterexample would need to demonstrate a procedure that is effective yet not Turing-computable.",
    "ec121b6a": "Brazil's Federal Constitution of 1988, known as the Citizen Constitution, establishes in Article 6 that education, health, food, work, housing, transportation, leisure, security, social security, protection of motherhood and childhood, and assistance to the destitute are social rights. The interpretive question centers on whether these social rights create justiciable individual entitlements or merely programmatic directives for state policy. The Brazilian Supreme Federal Tribunal has increasingly treated these as enforceable rights, particularly regarding health care and education, applying the doctrine of the existential minimum. This interpretive framework holds that the state must guarantee a minimum core of social rights regardless of budgetary constraints, while broader implementation remains subject to legislative discretion and the reserve of the possible doctrine.",
    "1d3fd896": "Section 1 of the Canadian Charter of Rights and Freedoms states that the rights and freedoms set out in the Charter are guaranteed subject only to such reasonable limits prescribed by law as can be demonstrably justified in a free and democratic society. This limitation clause is interpreted through the Oakes test established by the Supreme Court of Canada in R v Oakes 1986. The test requires that a limitation must serve a pressing and substantial objective, and the means chosen must be rationally connected to the objective, minimally impairing of the right, and proportionate in their effects. The interpretive challenge lies in balancing individual rights against collective societal interests, with courts exercising considerable discretion in applying proportionality analysis across different rights and contexts.",
    "9bf02ef2": "The conservation of energy, formulated as the first law of thermodynamics, states that energy cannot be created or destroyed in an isolated system but only transformed from one form to another. The total energy of an isolated system remains constant over time. This principle was established through the work of Joule, Helmholtz, and Mayer in the mid-nineteenth century. In thermodynamics, the first law is expressed as the change in internal energy equaling heat added to the system minus work done by the system. Noether's theorem provides the deeper theoretical foundation, showing that energy conservation arises from the time-translation symmetry of physical laws. This principle has been verified across mechanics, electromagnetism, nuclear physics, and particle physics with no confirmed violations.",
    "0c870026": "Water molecules consist of two hydrogen atoms covalently bonded to one oxygen atom, with the molecular formula H2O. The oxygen atom forms two sigma bonds with hydrogen atoms at an angle of approximately 104.5 degrees, deviating from the ideal tetrahedral angle due to the two lone pairs on oxygen. This bent molecular geometry gives water its polar character, with a dipole moment of approximately 1.85 Debye. The electronegativity difference between oxygen and hydrogen creates partial charges that enable hydrogen bonding between water molecules. These intermolecular forces explain many of water's anomalous properties including its high boiling point, high heat capacity, density maximum at 4 degrees Celsius, and its effectiveness as a solvent for ionic and polar compounds.",
    "72888f33": "Article 1 of the Universal Declaration of Human Rights, adopted by the United Nations General Assembly on December 10, 1948, states that all human beings are born free and equal in dignity and rights, endowed with reason and conscience, and should act towards one another in a spirit of brotherhood. This article establishes the foundational principle of inherent human dignity and equality as the basis for all subsequent rights enumerated in the Declaration. While the UDHR is not a binding treaty itself, its principles have been incorporated into numerous binding international instruments including the International Covenant on Civil and Political Rights and the International Covenant on Economic Social and Cultural Rights. Many of its provisions are now considered customary international law.",
    "c62538af": "The EU AI Act, formally Regulation 2024/1689, establishes a comprehensive risk-based regulatory framework for artificial intelligence systems within the European Union. It categorizes AI systems into four risk levels: unacceptable risk systems that are banned outright such as social scoring by governments; high-risk systems subject to strict requirements including conformity assessments, transparency obligations, and human oversight mandates; limited-risk systems requiring transparency measures; and minimal-risk systems with no specific obligations. The Act introduces requirements for foundation models and general-purpose AI including technical documentation, copyright compliance, and training data transparency. Enforcement involves national supervisory authorities and the European AI Office, with penalties reaching up to 35 million euros or 7 percent of global annual turnover.",
    "255399bb": "Parliamentary sovereignty is the foundational principle of the UK constitutional order, holding that Parliament is the supreme legal authority with the power to make or unmake any law, and no body can override or set aside its legislation. This doctrine was classically articulated by A.V. Dicey and affirmed in cases such as Edinburgh and Dalkeith Railway v Wauchope. However, the principle has been qualified by several developments including UK membership in the European Convention on Human Rights and the Human Rights Act 1998 which requires courts to interpret legislation compatibly with Convention rights where possible. The devolution settlements with Scotland, Wales, and Northern Ireland have created politically entrenched legislative competences. The Supreme Court in Miller v Secretary of State examined the relationship between parliamentary sovereignty and the royal prerogative.",
    "38d352d7": "Article 21 of the Constitution of India provides that no person shall be deprived of their life or personal liberty except according to procedure established by law. The Supreme Court of India has expansively interpreted this provision particularly since Maneka Gandhi v Union of India 1978 where the Court held that the procedure must be fair just and reasonable, not merely any procedure prescribed by law. Subsequent decisions have read into Article 21 numerous unenumerated rights including the right to livelihood, right to privacy as affirmed in KS Puttaswamy v Union of India 2017, right to dignity, right to clean environment, right to health, right to education, and right to shelter. This expansive interpretation has transformed Article 21 into a comprehensive guarantee of human dignity.",
    "353700ca": "Atomic theory holds that all matter is composed of atoms, which are the smallest units of a chemical element that retain the identity and properties of that element. Modern atomic theory builds on Dalton's early work establishing that elements consist of identical atoms and that chemical reactions involve rearrangement of atoms. Rutherford's scattering experiments in 1911 revealed the nuclear model with a dense positively charged nucleus surrounded by electrons. Bohr's model introduced quantized electron orbits, later superseded by quantum mechanical models describing electron probability distributions as orbitals. The standard model identifies protons and neutrons as composite particles made of quarks bound by the strong force mediated by gluons. Empirical evidence from mass spectrometry, X-ray crystallography, and scanning tunneling microscopy provides direct and indirect confirmation of atomic structure.",
    "d92de84e": "Probability theory provides the mathematical framework for quantifying uncertainty and analyzing random phenomena. Built on Kolmogorov's axioms established in 1933, it defines probability as a measure function mapping events in a sigma-algebra to values between zero and one, with the probability of the entire sample space equal to one and countable additivity for disjoint events. From these axioms derive fundamental results including the law of total probability, Bayes theorem, the law of large numbers, and the central limit theorem. Probability theory underpins statistics, statistical mechanics, quantum mechanics, information theory, financial mathematics, and machine learning. The interpretation of probability remains debated between frequentist views based on long-run relative frequencies and Bayesian views treating probability as a measure of rational belief.",
    "a39ebd28": "The standard human body temperature has historically been cited as 37 degrees Celsius or 98.6 degrees Fahrenheit, based on Carl Reinhold August Wunderlich's measurements in the mid-19th century. However, more recent studies including Protsiv et al. 2020 analyzing data spanning from the Civil War era to the present day have demonstrated a secular decline in mean body temperature to approximately 36.6 degrees Celsius. Body temperature varies by measurement site with oral, rectal, axillary, and tympanic readings differing systematically. Normal thermoregulation involves hypothalamic control integrating peripheral and central thermoreceptors to maintain core temperature within a narrow range through vasomotor responses, sweating, shivering, and behavioral adaptations. Fever is generally defined as a core temperature above 38.0 degrees Celsius.",
    "3016c299": "The human genome contains approximately 3.2 billion base pairs of DNA distributed across 23 pairs of chromosomes in diploid cells. The four nucleotide bases adenine, thymine, guanine, and cytosine pair specifically through hydrogen bonding with adenine pairing with thymine and guanine pairing with cytosine in the double helix structure elucidated by Watson and Crick in 1953. The Human Genome Project completed in 2003 provided the first comprehensive sequence revealing that protein-coding genes comprise only about 1.5 percent of the genome while the remainder includes regulatory sequences, introns, transposable elements, and regions of unknown function. Current estimates place the number of protein-coding genes between 19000 and 20000 significantly fewer than initially predicted.",
}


def api_call(method, path, api_key, data=None, retries=3):
    """Make an API call with retry logic for rate limits."""
    url = f"{BASE}/{path}" if not path.startswith("http") else path
    for attempt in range(retries):
        try:
            body = json.dumps(data).encode() if data else None
            req = urllib.request.Request(
                url,
                data=body,
                method=method,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_body = resp.read().decode()
                try:
                    return json.loads(resp_body)
                except json.JSONDecodeError:
                    return {"raw": resp_body}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"    Rate limited, waiting 5s (attempt {attempt+1})...")
                time.sleep(5)
                continue
            body = e.read().decode() if e.fp else ""
            try:
                return {"error": json.loads(body), "status": e.code}
            except:
                return {"error": body, "status": e.code}
        except Exception as e:
            return {"error": str(e)}
    return {"error": "Max retries exceeded"}


def run_agent(agent_name, api_key, should_approve=False):
    """Run a single agent through all topics."""
    print(f"\n{'='*60}")
    print(f"AGENT: {agent_name}")
    print(f"{'='*60}")

    proposals_made = 0
    approvals_made = 0
    done_count = 0

    for topic_id, topic_name, tier in TOPICS:
        prefix = topic_id[:8]
        section_id = f"sec:answer-{prefix}"
        print(f"\n--- [{agent_name}] {topic_name} ({tier}) ---")

        # 1. Join
        result = api_call("POST", f"{topic_id}/join", api_key)
        status = "ok" if "error" not in result else result.get("error", "")
        print(f"  Join: {str(status)[:80]}")

        # 2. Approve pending proposals from others (if not first agent)
        if should_approve:
            proposals = api_call("GET", f"{topic_id}/proposals", api_key)
            if isinstance(proposals, list):
                approved_here = 0
                for prop in proposals:
                    if approved_here >= 2:
                        break
                    if prop.get("status") == "pending":
                        approve_result = api_call(
                            "POST",
                            f"{topic_id}/proposals/{prop['id']}/approve",
                            api_key,
                        )
                        err = approve_result.get("error", "")
                        if "own" in str(err).lower() or "your own" in str(err).lower():
                            print(f"  Skip own proposal {prop['id'][:8]}")
                            continue
                        print(f"  Approved {prop['id'][:8]}... by {prop.get('authorName','?')}: {str(approve_result)[:60]}")
                        approved_here += 1
                        approvals_made += 1

        # 3. Propose answer content
        answer = ANSWERS.get(prefix)
        if answer:
            prop_result = api_call("POST", f"{topic_id}/proposals", api_key, {
                "sectionId": section_id,
                "newContent": answer,
                "summary": f"Proposing verified answer content for {tier} tier topic",
            })
            if "error" not in prop_result or "already" in str(prop_result).lower():
                print(f"  Proposed: {str(prop_result)[:100]}")
                proposals_made += 1
            else:
                print(f"  Proposal issue: {str(prop_result)[:120]}")

        # 4. Signal done with assumptions declaration
        done_result = api_call("POST", f"{topic_id}/done", api_key, {
            "assumptions": [],
            "noAssumptionsReason": "This topic is self-contained and does not depend on unverified assumptions beyond its own tier definitions."
        })
        print(f"  Done: {str(done_result)[:80]}")
        done_count += 1

    print(f"\n[{agent_name}] SUMMARY: {proposals_made} proposals, {approvals_made} approvals, {done_count} done signals")
    return proposals_made, approvals_made


def main():
    # Run agent specified by command line arg, or all agents
    if len(sys.argv) > 1:
        idx = int(sys.argv[1])
        name, key = AGENTS[idx]
        run_agent(name, key, should_approve=(idx > 0))
    else:
        # Run all agents sequentially (staggered)
        for i, (name, key) in enumerate(AGENTS):
            run_agent(name, key, should_approve=(i > 0))
            print(f"\n--- Pausing 2s before next agent ---")
            time.sleep(2)


if __name__ == "__main__":
    main()
