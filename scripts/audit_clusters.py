import json

with open("C:/Users/knoxh/pact/hub/scripts/graph_data.json") as f:
    data = json.load(f)

topics = {t['id']: t for t in data['topics']}
deps = data.get('dependencies', [])

depends_on = {}
depended_by = {}
for d in deps:
    tid, did, rel = d['topic_id'], d['depends_on'], d['relationship']
    depends_on.setdefault(tid, []).append((did, rel))
    depended_by.setdefault(did, []).append((tid, rel))

DOMAIN_KEYWORDS = {
    'mathematics': ['math', 'axiom', 'proof', 'induction', 'modus ponens', 'non-contradiction', 'postulate', 'euclidean', 'euclid'],
    'physics': ['gravity', 'gravitational', 'speed of light', 'molecule', 'boils', 'boiling', 'celsius', 'kelvin', 'pressure', 'h2o', 'water molecule'],
    'computing': ['turing', 'halting', 'cap theorem', 'distributed system', 'tls'],
    'biology': ['dna', 'genome', 'body core temperature', 'base pairs', 'chromosome'],
    'law': ['gdpr', 'privacy act', 'cmsha', 'coal mining', 'work health', 'fair work', 'unfair dismissal', 'duty of care', 'manslaughter', 'breach notification'],
    'economics': ['basel', 'capital ratio', 'tier 1'],
    'standards': ['iso 27001', 'si base units', 'units', 'measurement', 'pci dss'],
}

def detect_domain(title):
    lower = title.lower()
    best, best_score = 'other', 0
    for domain, kws in DOMAIN_KEYWORDS.items():
        score = sum(1 for kw in kws if kw in lower)
        if score > best_score:
            best, best_score = domain, score
    return best

domains = {}
for tid, t in topics.items():
    d = detect_domain(t['title'])
    domains.setdefault(d, []).append(tid)

for domain in ['mathematics', 'physics', 'biology', 'computing', 'law', 'economics', 'standards']:
    tids = domains.get(domain, [])
    if not tids:
        continue
    print(f'=== {domain.upper()} ({len(tids)} topics) ===')
    for tid in tids:
        t = topics[tid]
        print(f'  [{t["tier"]:13s}] {t["title"]}')
        for dep_id, rel in depends_on.get(tid, []):
            dep = topics.get(dep_id, {})
            dd = detect_domain(dep.get('title', ''))
            xd = ' ** CROSS-DOMAIN' if dd != domain else ''
            print(f'       depends on ({rel}): {dep.get("title","?")[:55]} [{dd}]{xd}')
        for child_id, rel in depended_by.get(tid, []):
            child = topics.get(child_id, {})
            cd = detect_domain(child.get('title', ''))
            xd = ' ** CROSS-DOMAIN' if cd != domain else ''
            print(f'       used by    ({rel}): {child.get("title","?")[:55]} [{cd}]{xd}')

    orphans = [tid for tid in tids if tid not in depends_on and tid not in depended_by]
    if orphans:
        print(f'  ORPHANS (no links):')
        for tid in orphans:
            print(f'       {topics[tid]["title"][:70]}')
    print()

# Summary
print("=== AUDIT SUMMARY ===")
total_cross = 0
total_orphans = 0
for domain, tids in domains.items():
    orphans = [tid for tid in tids if tid not in depends_on and tid not in depended_by]
    total_orphans += len(orphans)
    for tid in tids:
        for dep_id, rel in depends_on.get(tid, []):
            dep = topics.get(dep_id, {})
            if detect_domain(dep.get('title', '')) != domain:
                total_cross += 1

print(f"Cross-domain links: {total_cross}")
print(f"Orphan topics (no links): {total_orphans}")
print(f"Total dependency links: {len(deps)}")
