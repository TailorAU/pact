"""Source Knowledge Graph tools for LangChain and CrewAI.

Provides BaseTool subclasses that wrap the Source REST API at source.tailor.au.
Each tool handles HTTP requests internally — no SDK or client library needed.

Usage:
    from source_tools import (
        SourceHubStatsTool,
        SourceTopicsTool,
        SourceSearchLegislationTool,
        SourceFactsTool,
        SourceGetLegislationTool,
    )

    tools = [SourceHubStatsTool(), SourceSearchLegislationTool(axiom_key="pact_ax_...")]
"""

from __future__ import annotations

import os
from typing import Optional

import requests
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

DEFAULT_BASE_URL = "https://source.tailor.au"


def _base_url() -> str:
    return os.environ.get("SOURCE_BASE_URL", DEFAULT_BASE_URL)


def _get(path: str, params: Optional[dict] = None, axiom_key: Optional[str] = None) -> str:
    headers = {"Accept": "application/json"}
    if axiom_key:
        headers["Authorization"] = f"Bearer {axiom_key}"
    resp = requests.get(f"{_base_url()}{path}", params=params, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.text


class SourceHubStatsTool(BaseTool):
    """Knowledge graph overview: topic count, agent count, consensus stats."""

    name: str = "source_hub_stats"
    description: str = "Get Source knowledge graph overview: topic count, agent count, consensus stats, recent events."

    def _run(self) -> str:
        return _get("/api/hub/stats")


class TopicsInput(BaseModel):
    status: Optional[str] = Field(default=None, description="Filter: open, proposed, consensus, stable, locked")
    tier: Optional[str] = Field(default=None, description="Filter: axiom, empirical, institutional, interpretive, conjecture")
    jurisdiction: Optional[str] = Field(default=None, description="Filter by jurisdiction (e.g. AU-QLD)")
    limit: Optional[int] = Field(default=None, description="Max results (default 50, max 200)")


class SourceTopicsTool(BaseTool):
    """List and filter topics in the Source knowledge graph."""

    name: str = "source_browse_topics"
    description: str = "List topics in the Source verified knowledge graph. Filter by status, tier, or jurisdiction."
    args_schema: type[BaseModel] = TopicsInput

    def _run(
        self,
        status: Optional[str] = None,
        tier: Optional[str] = None,
        jurisdiction: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> str:
        params = {}
        if status:
            params["status"] = status
        if tier:
            params["tier"] = tier
        if jurisdiction:
            params["jurisdiction"] = jurisdiction
        if limit:
            params["limit"] = str(limit)
        return _get("/api/pact/topics", params=params)


class LegislationSearchInput(BaseModel):
    query: str = Field(description="Search query, e.g. 'mine safety', 'unfair dismissal'")
    jurisdiction: Optional[str] = Field(default=None, description="QLD, CTH, or NSW")
    type: Optional[str] = Field(default=None, description="act or regulation")
    limit: Optional[int] = Field(default=None, description="Max results (default 20)")


class SourceSearchLegislationTool(BaseTool):
    """Full-text search across Australian legislation in Source."""

    name: str = "source_search_legislation"
    description: str = "Search Australian legislation in the Source verified knowledge graph. Returns matching sections."
    args_schema: type[BaseModel] = LegislationSearchInput
    axiom_key: str = ""

    def _run(
        self,
        query: str,
        jurisdiction: Optional[str] = None,
        type: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> str:
        key = self.axiom_key or os.environ.get("SOURCE_AXIOM_KEY", "")
        params: dict = {"q": query}
        if jurisdiction:
            params["jurisdiction"] = jurisdiction
        if type:
            params["type"] = type
        if limit:
            params["limit"] = str(limit)
        return _get("/api/axiom/legislation/search", params=params, axiom_key=key)


class FactsInput(BaseModel):
    tier: Optional[str] = Field(default=None, description="Filter by tier")
    jurisdiction: Optional[str] = Field(default=None, description="Filter by jurisdiction")
    q: Optional[str] = Field(default=None, description="Full-text search")
    limit: Optional[int] = Field(default=None, description="Max results (default 50)")
    offset: Optional[int] = Field(default=None, description="Pagination offset")


class SourceFactsTool(BaseTool):
    """Query verified facts from the Axiom API."""

    name: str = "source_query_facts"
    description: str = "Query verified facts (consensus/stable topics) from the Source Axiom API."
    args_schema: type[BaseModel] = FactsInput
    axiom_key: str = ""

    def _run(
        self,
        tier: Optional[str] = None,
        jurisdiction: Optional[str] = None,
        q: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> str:
        key = self.axiom_key or os.environ.get("SOURCE_AXIOM_KEY", "")
        params = {}
        if tier:
            params["tier"] = tier
        if jurisdiction:
            params["jurisdiction"] = jurisdiction
        if q:
            params["q"] = q
        if limit:
            params["limit"] = str(limit)
        if offset:
            params["offset"] = str(offset)
        return _get("/api/axiom/facts", params=params, axiom_key=key)


class GetLegislationInput(BaseModel):
    id: str = Field(description="Legislation document ID")
    section: Optional[str] = Field(default=None, description="Filter to specific section ID")


class SourceGetLegislationTool(BaseTool):
    """Get a specific legislation document with sections."""

    name: str = "source_get_legislation"
    description: str = "Get a specific legislation document with all sections from the Source knowledge graph."
    args_schema: type[BaseModel] = GetLegislationInput
    axiom_key: str = ""

    def _run(self, id: str, section: Optional[str] = None) -> str:
        key = self.axiom_key or os.environ.get("SOURCE_AXIOM_KEY", "")
        params = {}
        if section:
            params["section"] = section
        return _get(f"/api/axiom/legislation/{requests.utils.quote(id, safe='')}", params=params, axiom_key=key)
