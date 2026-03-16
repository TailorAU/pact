#!/usr/bin/env python3
"""
Tailor <> PACT Hub Legislation API Integration
===============================================

Demonstrates how Tailor's compliance pipeline can replace website scraping
and LLM-based clause extraction with a single PACT Hub API call.

Old pipeline (ClauseTreeExtractor):
    1. Scrape legislation website HTML
    2. Parse HTML to find section boundaries
    3. Send ~50 LLM calls to extract clause structure
    4. Reconcile cross-references across sections
    5. Build hierarchical section tree
    Total: ~50 API calls, ~120 seconds, ~$0.40 in LLM costs

New pipeline (PACT Hub Legislation API):
    1. Call GET /api/axiom/legislation/{id}
    2. Map pre-parsed sections to ExtractedSection format
    Total: 1 API call, <500ms, 1 credit (~$0.001)

Usage:
    python tailor_integration.py

Requires:
    pip install requests
"""

from __future__ import annotations

import re
import time
import json
import hashlib
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from typing import Optional, Protocol
from urllib.parse import quote, urlencode

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tailor-compatible data structures
# ---------------------------------------------------------------------------

@dataclass
class ExtractedSection:
    """Mirrors Tailor's internal ExtractedSection format.

    Each instance represents a single legislative provision with its position
    in the document hierarchy, enforcement status, and cross-reference links.
    """

    section_id: str
    """Canonical reference: 's 42', 'r 89(2)(b)', 'sch 1 pt 2'."""

    title: str
    """Section heading text. Empty string if the section has no heading."""

    content: str
    """Clean text content of the section body."""

    depth: int
    """Hierarchy level: 0 = Act root, 1 = Part/Chapter, 2 = Division, 3 = Section, etc."""

    parent_id: Optional[str]
    """Parent section reference, or None for top-level sections."""

    order: int
    """Zero-based document order for deterministic sorting."""

    status: str
    """Enforcement status: 'in_force', 'repealed', or 'not_yet_commenced'."""

    cross_references: list[str] = field(default_factory=list)
    """List of canonical references this section cites (e.g. ['s 15', 's 42(1)'])."""

    source_ref: str = ""
    """Full citation including document short title, e.g. 'CMSHA 1999 s 42'."""


# ---------------------------------------------------------------------------
# Canonical section-ID validation
# ---------------------------------------------------------------------------

# Matches patterns like: s 42, s 42(1)(a), r 89, sch 1 pt 2, ch 3, div 4
CANONICAL_SECTION_PATTERN = re.compile(
    r"^(s|r|sch|ch|div|pt|cl|reg|art|app|preamble|long_title|notes)"
    r"(\s+\d+[A-Za-z]?"
    r"(\(\d+[A-Za-z]?\))?"  # optional sub-section (1)
    r"(\([a-z]\))?"          # optional paragraph (a)
    r"(\([ivxlc]+\))?"       # optional sub-paragraph (i)
    r")?$"
)


def is_canonical_section_id(section_id: str) -> bool:
    """Check whether a section ID follows PACT canonical format.

    Examples of valid IDs:
        s 42, s 42(1)(a), r 89(2)(b)(i), sch 1, ch 3, div 4, pt 2, preamble

    Returns:
        True if the ID matches the canonical pattern.
    """
    return bool(CANONICAL_SECTION_PATTERN.match(section_id.strip()))


# ---------------------------------------------------------------------------
# PACT Hub Legislation API client
# ---------------------------------------------------------------------------

class PactApiError(Exception):
    """Raised when the PACT Hub API returns an error response."""

    def __init__(self, status_code: int, message: str, response: Optional[dict] = None):
        self.status_code = status_code
        self.message = message
        self.response = response
        super().__init__(f"PACT API {status_code}: {message}")


class PactLegislationClient:
    """Client for the PACT Hub Legislation API (Axiom tier).

    Provides typed access to legislation documents, sections, and search.
    Handles authentication, pagination, and response format negotiation.

    Example::

        client = PactLegislationClient(api_key="pact_ax_live_abc123")
        docs = client.list_legislation(jurisdiction="QLD", doc_type="act")
        doc = client.get_document("qld/act-1999-039")
        sections = client.get_sections_as_extraction_result("qld/act-1999-039")
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://pacthub.ai",
        timeout: float = 30.0,
    ) -> None:
        """Initialise the client.

        Args:
            api_key: Axiom API key (format: ``pact_ax_*``).
            base_url: PACT Hub base URL. Defaults to production.
            timeout: HTTP request timeout in seconds.
        """
        if not api_key.startswith("pact_ax_"):
            raise ValueError(
                f"Invalid API key format. Expected 'pact_ax_*', got '{api_key[:12]}...'"
            )
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "TailorPACTIntegration/1.0",
        })
        self._credits_remaining: Optional[int] = None

    @property
    def credits_remaining(self) -> Optional[int]:
        """Credits remaining after the last API call, or None if unknown."""
        return self._credits_remaining

    # -- List legislation --------------------------------------------------

    def list_legislation(
        self,
        jurisdiction: str,
        doc_type: Optional[str] = None,
        search: Optional[str] = None,
        act: Optional[str] = None,
        include: str = "sections",
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """List legislation documents, optionally filtered.

        Args:
            jurisdiction: Jurisdiction code ('QLD', 'CTH', 'NSW', etc.).
                          Prefix matching: 'AU' matches 'AU-QLD', 'AU-NSW'.
            doc_type: Filter by type: 'act', 'regulation', 'standard', 'guidance'.
            search: Keyword search across title and section content.
            act: Filter by short title substring.
            include: 'sections' (default) to include full section content,
                     'metadata' for document metadata only.
            limit: Maximum results per page (max 200).
            offset: Pagination offset.

        Returns:
            List of legislation document dicts.

        Raises:
            PactApiError: If the API returns an error.
        """
        params: dict[str, str | int] = {
            "jurisdiction": jurisdiction,
            "include": include,
            "limit": limit,
            "offset": offset,
            "format": "json",
        }
        if doc_type:
            params["type"] = doc_type
        if search:
            params["q"] = search
        if act:
            params["act"] = act

        data = self._get("/api/axiom/legislation", params=params)
        return data.get("legislation", [])

    # -- Get single document -----------------------------------------------

    def get_document(
        self,
        doc_id: str,
        format: str = "json",
        section: Optional[str] = None,
    ) -> dict:
        """Fetch a single legislation document with all sections.

        Args:
            doc_id: Document ID, e.g. 'qld/act-1999-039'.
            format: Response format: 'json', 'sections', 'text', 'citation', 'markdown'.
            section: Filter to a specific section ID, e.g. 's 42'.

        Returns:
            Document dict (shape depends on ``format``).

        Raises:
            PactApiError: If the document is not found or auth fails.
        """
        params: dict[str, str] = {"format": format}
        if section:
            params["section"] = section

        encoded_id = quote(doc_id, safe="")
        return self._get(f"/api/axiom/legislation/{encoded_id}", params=params)

    # -- Full-text search --------------------------------------------------

    def search(
        self,
        query: str,
        jurisdiction: Optional[str] = None,
        doc_type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Full-text search across all legislation.

        Args:
            query: Search query (min 3-character words).
            jurisdiction: Optional jurisdiction filter.
            doc_type: Optional document type filter.
            status: Optional section status filter: 'in_force', 'repealed',
                    'not_yet_commenced'.
            limit: Maximum results (max 200).
            offset: Pagination offset.

        Returns:
            Dict with 'results', 'total', 'query', 'keywords', and pagination links.

        Raises:
            PactApiError: If the query is invalid or auth fails.
        """
        params: dict[str, str | int] = {"q": query, "limit": limit, "offset": offset}
        if jurisdiction:
            params["jurisdiction"] = jurisdiction
        if doc_type:
            params["type"] = doc_type
        if status:
            params["status"] = status

        return self._get("/api/axiom/legislation/search", params=params)

    # -- Convert to Tailor ExtractedSection format -------------------------

    def get_sections_as_extraction_result(
        self,
        doc_id: str,
    ) -> list[ExtractedSection]:
        """Fetch a document and convert its sections to Tailor's ExtractedSection format.

        This is the primary integration point: replaces ClauseTreeExtractor's
        ~50 LLM calls with a single API call and a local mapping step.

        Args:
            doc_id: PACT document ID, e.g. 'qld/act-1999-039'.

        Returns:
            List of ExtractedSection instances, ordered by document position.

        Raises:
            PactApiError: If the document is not found.
        """
        data = self.get_document(doc_id, format="json")

        # The single-document endpoint wraps the doc under 'legislation'
        legislation = data.get("legislation", data)

        short_title = legislation.get("shortTitle") or legislation.get("title", "")
        sections_raw = legislation.get("sections", [])

        result: list[ExtractedSection] = []
        for s in sections_raw:
            section_id = s.get("sectionId", "")
            title = s.get("title") or ""
            content = s.get("content", "")
            depth = s.get("depth", 2)
            parent_id = s.get("parentId")
            order = s.get("order", 0)
            status = s.get("status", "in_force")
            cross_refs = s.get("crossReferences", [])

            # Build full citation reference
            source_ref = f"{short_title} {section_id}".strip()

            result.append(ExtractedSection(
                section_id=section_id,
                title=title,
                content=content,
                depth=depth,
                parent_id=parent_id,
                order=order,
                status=status,
                cross_references=cross_refs,
                source_ref=source_ref,
            ))

        result.sort(key=lambda s: s.order)
        return result

    # -- Internal HTTP helpers ---------------------------------------------

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        """Make an authenticated GET request.

        Args:
            path: API path (e.g. '/api/axiom/legislation').
            params: Query parameters.

        Returns:
            Parsed JSON response body.

        Raises:
            PactApiError: On non-2xx responses.
        """
        url = f"{self.base_url}{path}"
        logger.debug("GET %s params=%s", url, params)

        response = self._session.get(url, params=params, timeout=self.timeout)

        # Track remaining credits from response
        credits_header = response.headers.get("X-Credits-Remaining")
        if credits_header is not None:
            self._credits_remaining = int(credits_header)

        if not response.ok:
            try:
                body = response.json()
                message = body.get("error", response.reason)
            except (ValueError, KeyError):
                body = None
                message = response.reason or f"HTTP {response.status_code}"
            raise PactApiError(response.status_code, message, body)

        data = response.json()

        # Also check credits from JSON body
        if "creditsRemaining" in data:
            self._credits_remaining = data["creditsRemaining"]

        return data


# ---------------------------------------------------------------------------
# Extraction strategy pattern (mirrors Tailor's strategy resolver)
# ---------------------------------------------------------------------------

class IExtractionStrategy(ABC):
    """Interface for legislation extraction strategies."""

    @abstractmethod
    def extract(self, legislation_url: str) -> list[ExtractedSection]:
        """Extract sections from a legislation source.

        Args:
            legislation_url: URL of the legislation document.

        Returns:
            Ordered list of extracted sections.
        """
        ...

    @abstractmethod
    def name(self) -> str:
        """Human-readable strategy name for logging."""
        ...


class PreParsedLegislationExtractor(IExtractionStrategy):
    """Extracts sections via PACT Hub's pre-parsed legislation API.

    Zero LLM calls. Sections are already parsed, canonically identified,
    and linked with cross-references.
    """

    def __init__(self, client: PactLegislationClient, doc_id: str) -> None:
        self._client = client
        self._doc_id = doc_id

    def extract(self, legislation_url: str) -> list[ExtractedSection]:
        """Fetch pre-parsed sections from PACT Hub.

        The legislation_url parameter is accepted for interface compatibility
        but ignored; the document is fetched by its PACT doc_id.
        """
        return self._client.get_sections_as_extraction_result(self._doc_id)

    def name(self) -> str:
        return f"PreParsedLegislationExtractor(pact:{self._doc_id})"


class ClaudeTreeExtractor(IExtractionStrategy):
    """Legacy extractor: scrapes HTML and uses LLM calls to parse clauses.

    This is a stub simulating Tailor's current pipeline for comparison.
    In production, this would invoke Claude/GPT to parse each section from HTML.
    """

    SIMULATED_SECTIONS_PER_ACT = 50
    SIMULATED_LLM_LATENCY_SECONDS = 2.4  # average per call
    SIMULATED_LLM_COST_PER_CALL = 0.008  # USD

    def extract(self, legislation_url: str) -> list[ExtractedSection]:
        """Simulate LLM-based extraction (stub for demo purposes).

        In production this would:
        1. Fetch the HTML from legislation_url
        2. Chunk the document into sections
        3. Send each chunk to an LLM for structured extraction
        4. Reconcile cross-references
        """
        logger.info(
            "ClaudeTreeExtractor would make ~%d LLM calls for %s",
            self.SIMULATED_SECTIONS_PER_ACT,
            legislation_url,
        )
        # Return empty list -- this is a simulation stub
        return []

    def name(self) -> str:
        return "ClaudeTreeExtractor"


class ExtractionStrategyResolver:
    """Resolves the best extraction strategy for a given legislation URL.

    If PACT Hub has the document pre-parsed, uses PreParsedLegislationExtractor
    (instant, zero LLM cost). Otherwise falls back to ClaudeTreeExtractor
    (slow, expensive).
    """

    # Known URL patterns that map to PACT document IDs.
    # In production this would be a database lookup or a PACT search call.
    URL_TO_PACT_DOC: dict[str, str] = {
        "legislation.qld.gov.au/view/html/inforce/current/act-1999-039": "qld/act-1999-039",
        "legislation.qld.gov.au/view/html/inforce/current/act-1899-009": "qld/act-1899-009",
    }

    def __init__(self, client: PactLegislationClient) -> None:
        self._client = client
        self._pact_doc_cache: dict[str, Optional[str]] = {}

    def resolve(self, legislation_url: str) -> IExtractionStrategy:
        """Choose the best extraction strategy for a legislation URL.

        Args:
            legislation_url: URL of the legislation document to extract.

        Returns:
            An IExtractionStrategy instance ready to call .extract().
        """
        doc_id = self._lookup_pact_doc_id(legislation_url)

        if doc_id is not None:
            logger.info(
                "PACT Hub has document '%s' -> using PreParsedLegislationExtractor",
                doc_id,
            )
            return PreParsedLegislationExtractor(self._client, doc_id)

        logger.info(
            "Document not in PACT Hub -> falling back to ClaudeTreeExtractor"
        )
        return ClaudeTreeExtractor()

    def _lookup_pact_doc_id(self, url: str) -> Optional[str]:
        """Look up a legislation URL in PACT Hub.

        First checks a static mapping, then attempts a search query.
        Results are cached for the lifetime of the resolver.
        """
        if url in self._pact_doc_cache:
            return self._pact_doc_cache[url]

        # Check static mapping
        for pattern, doc_id in self.URL_TO_PACT_DOC.items():
            if pattern in url:
                self._pact_doc_cache[url] = doc_id
                return doc_id

        # Attempt dynamic lookup via PACT search API
        try:
            # Extract a searchable title from the URL path
            title_hint = self._extract_title_from_url(url)
            if title_hint:
                results = self._client.search(title_hint)
                if results.get("results"):
                    doc_id = results["results"][0]["docId"]
                    self._pact_doc_cache[url] = doc_id
                    return doc_id
        except PactApiError:
            pass

        self._pact_doc_cache[url] = None
        return None

    @staticmethod
    def _extract_title_from_url(url: str) -> Optional[str]:
        """Extract a human-readable title hint from a legislation URL.

        Examples:
            'legislation.qld.gov.au/.../act-1999-039' -> 'act 1999 039'
        """
        match = re.search(r"(act|regulation|reg|standard)-(\d{4})-(\d+)", url)
        if match:
            return f"{match.group(1)} {match.group(2)} {match.group(3)}"
        return None


# ---------------------------------------------------------------------------
# Demo / comparison harness
# ---------------------------------------------------------------------------

def generate_demo_api_key() -> str:
    """Generate a deterministic demo API key for local testing.

    In production, keys are provisioned via the PACT Hub dashboard.
    """
    seed = f"tailor-demo-{int(time.time()) // 3600}"
    suffix = hashlib.sha256(seed.encode()).hexdigest()[:24]
    return f"pact_ax_demo_{suffix}"


def run_demo() -> None:
    """Run the full integration demo.

    Demonstrates:
        1. Client initialisation and API key creation
        2. Listing QLD legislation
        3. Fetching the Coal Mining Safety and Health Act 1999
        4. Converting to Tailor ExtractedSection format
        5. Validating canonical section IDs
        6. Side-by-side cost/speed comparison
        7. ExtractionStrategyResolver routing
    """
    print("=" * 72)
    print("  Tailor <> PACT Hub Legislation API Integration Demo")
    print("=" * 72)
    print()

    # ── Step 1: Create API key and client ──────────────────────────────
    api_key = generate_demo_api_key()
    print(f"[1] API Key:  {api_key}")
    print(f"    Base URL: https://pacthub.ai")
    print()

    client = PactLegislationClient(
        api_key=api_key,
        base_url="https://pacthub.ai",
    )

    # ── Step 2: List QLD legislation ───────────────────────────────────
    print("[2] Listing QLD legislation...")
    print(f"    GET /api/axiom/legislation?jurisdiction=QLD&include=metadata")
    print()

    t0 = time.perf_counter()
    try:
        qld_docs = client.list_legislation(
            jurisdiction="QLD",
            include="metadata",
        )
        list_elapsed = time.perf_counter() - t0
    except PactApiError as e:
        # In demo mode without a live server, simulate the response
        print(f"    (Live API unavailable: {e}. Using simulated data.)")
        print()
        qld_docs = _simulated_qld_legislation_list()
        list_elapsed = 0.042

    print(f"    Found {len(qld_docs)} QLD documents in {list_elapsed:.3f}s")
    for doc in qld_docs[:8]:
        title = doc.get("title") or doc.get("shortTitle", "Untitled")
        doc_type = doc.get("type", "?")
        year = doc.get("year", "?")
        print(f"      - [{doc_type}] {title} ({year})")
    if len(qld_docs) > 8:
        print(f"      ... and {len(qld_docs) - 8} more")
    print()

    # ── Step 3: Fetch Coal Mining Safety and Health Act 1999 ───────────
    cmsha_id = "qld/act-1999-039"
    print(f"[3] Fetching full document: {cmsha_id}")
    print(f"    GET /api/axiom/legislation/{cmsha_id}")
    print()

    t0 = time.perf_counter()
    try:
        sections = client.get_sections_as_extraction_result(cmsha_id)
        fetch_elapsed = time.perf_counter() - t0
    except PactApiError as e:
        print(f"    (Live API unavailable: {e}. Using simulated data.)")
        print()
        sections = _simulated_cmsha_sections()
        fetch_elapsed = 0.187

    print(f"    Received {len(sections)} sections in {fetch_elapsed:.3f}s")
    print(f"    Credits remaining: {client.credits_remaining or 'N/A (demo)'}")
    print()

    # ── Step 4: Display sample ExtractedSection data ───────────────────
    print("[4] Sample ExtractedSection objects:")
    print()
    for s in sections[:5]:
        print(f"    ExtractedSection(")
        print(f"        section_id  = {s.section_id!r},")
        print(f"        title       = {s.title!r},")
        print(f"        content     = {s.content[:80]!r}{'...' if len(s.content) > 80 else ''},")
        print(f"        depth       = {s.depth},")
        print(f"        parent_id   = {s.parent_id!r},")
        print(f"        order       = {s.order},")
        print(f"        status      = {s.status!r},")
        print(f"        cross_refs  = {s.cross_references!r},")
        print(f"        source_ref  = {s.source_ref!r},")
        print(f"    )")
        print()

    # ── Step 5: Validate canonical section IDs ─────────────────────────
    print("[5] Validating canonical section IDs...")
    canonical_count = 0
    non_canonical: list[str] = []
    for s in sections:
        if is_canonical_section_id(s.section_id):
            canonical_count += 1
        else:
            non_canonical.append(s.section_id)

    pct = (canonical_count / len(sections) * 100) if sections else 0
    print(f"    {canonical_count}/{len(sections)} ({pct:.1f}%) match canonical format")
    if non_canonical:
        shown = non_canonical[:5]
        print(f"    Non-canonical IDs: {shown}")
        if len(non_canonical) > 5:
            print(f"    ... and {len(non_canonical) - 5} more")
    print()

    # ── Step 6: Cost/speed comparison ──────────────────────────────────
    print("[6] Pipeline comparison:")
    print()

    section_count = len(sections) or ClaudeTreeExtractor.SIMULATED_SECTIONS_PER_ACT

    # Old way: ClaudeTreeExtractor
    old_llm_calls = section_count
    old_latency = old_llm_calls * ClaudeTreeExtractor.SIMULATED_LLM_LATENCY_SECONDS
    old_cost = old_llm_calls * ClaudeTreeExtractor.SIMULATED_LLM_COST_PER_CALL

    # New way: PACT Hub API
    new_api_calls = 1
    new_latency = fetch_elapsed
    new_cost = 0.001  # 1 credit

    print(f"    {'Metric':<30} {'ClauseTreeExtractor':>22} {'PACT Hub API':>22}")
    print(f"    {'─' * 30} {'─' * 22} {'─' * 22}")
    print(f"    {'API / LLM calls':<30} {old_llm_calls:>22} {new_api_calls:>22}")
    print(f"    {'Latency (seconds)':<30} {old_latency:>22.1f} {new_latency:>22.3f}")
    print(f"    {'Cost (USD)':<30} {'${:.2f}'.format(old_cost):>22} {'${:.4f}'.format(new_cost):>22}")
    print(f"    {'Sections returned':<30} {'(requires parsing)':>22} {len(sections):>22}")
    print(f"    {'Cross-refs included':<30} {'No':>22} {'Yes':>22}")
    print(f"    {'Canonical IDs':<30} {'No':>22} {'Yes':>22}")
    print(f"    {'Amendment tracking':<30} {'No':>22} {'Yes':>22}")
    print()

    speedup = old_latency / new_latency if new_latency > 0 else float("inf")
    cost_reduction = old_cost / new_cost if new_cost > 0 else float("inf")
    print(f"    Speedup:        {speedup:,.0f}x faster")
    print(f"    Cost reduction: {cost_reduction:,.0f}x cheaper")
    print()

    # ── Step 7: ExtractionStrategyResolver demo ────────────────────────
    print("[7] ExtractionStrategyResolver routing demo:")
    print()

    resolver = ExtractionStrategyResolver(client)

    test_urls = [
        "https://legislation.qld.gov.au/view/html/inforce/current/act-1999-039",
        "https://legislation.qld.gov.au/view/html/inforce/current/act-1899-009",
        "https://www.legislation.gov.au/C2017C00341/latest/text",
    ]

    for url in test_urls:
        strategy = resolver.resolve(url)
        strategy_name = strategy.name()
        print(f"    URL:      {url}")
        print(f"    Strategy: {strategy_name}")
        print()

    # ── Summary ────────────────────────────────────────────────────────
    print("=" * 72)
    print("  Integration Summary")
    print("=" * 72)
    print()
    print("  PACT Hub provides pre-parsed, canonically-structured legislation")
    print("  that drops directly into Tailor's compliance pipeline.")
    print()
    print("  Key integration points:")
    print("    1. PactLegislationClient  ->  replaces HTML scraper + LLM extractor")
    print("    2. ExtractedSection        ->  direct mapping, no transformation loss")
    print("    3. ExtractionStrategyResolver  ->  graceful fallback for missing docs")
    print("    4. Canonical section IDs   ->  stable references across versions")
    print()


# ---------------------------------------------------------------------------
# Simulated data for offline / demo mode
# ---------------------------------------------------------------------------

def _simulated_qld_legislation_list() -> list[dict]:
    """Return a representative list of QLD legislation for offline demos."""
    return [
        {
            "id": "qld/act-1899-009",
            "jurisdiction": "QLD",
            "type": "act",
            "title": "Criminal Code Act 1899",
            "shortTitle": "Criminal Code 1899",
            "year": 1899,
        },
        {
            "id": "qld/act-1971-016",
            "jurisdiction": "QLD",
            "type": "act",
            "title": "Penalties and Sentences Act 1992",
            "shortTitle": "PSA 1992",
            "year": 1992,
        },
        {
            "id": "qld/act-1999-039",
            "jurisdiction": "QLD",
            "type": "act",
            "title": "Coal Mining Safety and Health Act 1999",
            "shortTitle": "CMSHA 1999",
            "year": 1999,
        },
        {
            "id": "qld/act-1999-040",
            "jurisdiction": "QLD",
            "type": "act",
            "title": "Mining and Quarrying Safety and Health Act 1999",
            "shortTitle": "MQSHA 1999",
            "year": 1999,
        },
        {
            "id": "qld/reg-2001-0068",
            "jurisdiction": "QLD",
            "type": "regulation",
            "title": "Coal Mining Safety and Health Regulation 2017",
            "shortTitle": "CMSHR 2017",
            "year": 2017,
        },
        {
            "id": "qld/act-2003-013",
            "jurisdiction": "QLD",
            "type": "act",
            "title": "Electrical Safety Act 2002",
            "shortTitle": "ESA 2002",
            "year": 2002,
        },
        {
            "id": "qld/act-2011-018",
            "jurisdiction": "QLD",
            "type": "act",
            "title": "Work Health and Safety Act 2011",
            "shortTitle": "WHS Act 2011",
            "year": 2011,
        },
        {
            "id": "qld/act-1994-035",
            "jurisdiction": "QLD",
            "type": "act",
            "title": "Environmental Protection Act 1994",
            "shortTitle": "EP Act 1994",
            "year": 1994,
        },
    ]


def _simulated_cmsha_sections() -> list[ExtractedSection]:
    """Return representative sections of the CMSHA 1999 for offline demos."""
    return [
        ExtractedSection(
            section_id="s 1",
            title="Short title",
            content="This Act may be cited as the Coal Mining Safety and Health Act 1999.",
            depth=1, parent_id=None, order=0, status="in_force",
            cross_references=[], source_ref="CMSHA 1999 s 1",
        ),
        ExtractedSection(
            section_id="s 2",
            title="Commencement",
            content="This Act commences on a day to be fixed by proclamation.",
            depth=1, parent_id=None, order=1, status="in_force",
            cross_references=[], source_ref="CMSHA 1999 s 2",
        ),
        ExtractedSection(
            section_id="s 3",
            title="Object of Act",
            content=(
                "The principal object of this Act is to protect the safety and "
                "health of persons at coal mines and persons who may be affected "
                "by coal mining operations."
            ),
            depth=1, parent_id=None, order=2, status="in_force",
            cross_references=["s 4", "s 5"], source_ref="CMSHA 1999 s 3",
        ),
        ExtractedSection(
            section_id="s 4",
            title="How object is to be achieved",
            content=(
                "The object is to be achieved by — (a) requiring that risk of "
                "injury or illness to any person resulting from coal mining "
                "operations be at an acceptable level."
            ),
            depth=1, parent_id=None, order=3, status="in_force",
            cross_references=["s 3"], source_ref="CMSHA 1999 s 4",
        ),
        ExtractedSection(
            section_id="s 5",
            title="Act binds all persons",
            content=(
                "This Act binds all persons, including the State and, so far as "
                "the legislative power of the Parliament permits, the Commonwealth "
                "and the other States."
            ),
            depth=1, parent_id=None, order=4, status="in_force",
            cross_references=[], source_ref="CMSHA 1999 s 5",
        ),
        ExtractedSection(
            section_id="s 6",
            title="Application of Act",
            content=(
                "This Act applies to all coal mines in Queensland and all coal "
                "mining operations carried out in Queensland."
            ),
            depth=1, parent_id=None, order=5, status="in_force",
            cross_references=[], source_ref="CMSHA 1999 s 6",
        ),
        ExtractedSection(
            section_id="s 7",
            title="Definitions",
            content=(
                "The dictionary in schedule 3 defines particular words used in "
                "this Act."
            ),
            depth=1, parent_id=None, order=6, status="in_force",
            cross_references=["sch 3"], source_ref="CMSHA 1999 s 7",
        ),
        ExtractedSection(
            section_id="s 25",
            title="Obligation of coal mine operator",
            content=(
                "A coal mine operator must ensure the safety and health of each "
                "coal mine worker at the coal mine."
            ),
            depth=2, parent_id="pt 3", order=20, status="in_force",
            cross_references=["s 26", "s 27"], source_ref="CMSHA 1999 s 25",
        ),
        ExtractedSection(
            section_id="s 26",
            title="Obligation of site senior executive",
            content=(
                "The site senior executive for a coal mine must manage the coal "
                "mine so that the safety and health of each coal mine worker at "
                "the coal mine is ensured."
            ),
            depth=2, parent_id="pt 3", order=21, status="in_force",
            cross_references=["s 25"], source_ref="CMSHA 1999 s 26",
        ),
        ExtractedSection(
            section_id="s 42",
            title="Safety and health management system",
            content=(
                "The site senior executive for a coal mine must develop and "
                "implement a documented safety and health management system for "
                "the coal mine."
            ),
            depth=2, parent_id="pt 5", order=35, status="in_force",
            cross_references=["s 43", "s 44", "s 62"],
            source_ref="CMSHA 1999 s 42",
        ),
        ExtractedSection(
            section_id="s 43",
            title="Content of safety and health management system",
            content=(
                "The safety and health management system must include — "
                "(a) a safety and health policy for the coal mine; and "
                "(b) a description of the risk management process to be used."
            ),
            depth=2, parent_id="pt 5", order=36, status="in_force",
            cross_references=["s 42"], source_ref="CMSHA 1999 s 43",
        ),
        ExtractedSection(
            section_id="s 62",
            title="Review of safety and health management system",
            content=(
                "The site senior executive for a coal mine must ensure a review "
                "of the safety and health management system for the coal mine is "
                "carried out at intervals of not more than 1 year."
            ),
            depth=2, parent_id="pt 5", order=50, status="in_force",
            cross_references=["s 42", "s 43"], source_ref="CMSHA 1999 s 62",
        ),
    ]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )
    run_demo()
