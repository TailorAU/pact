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


# ── Fuel Tools ──────────────────────────────────────────────────


class CheapestFuelInput(BaseModel):
    fuel_type: Optional[str] = Field(default=None, description="Fuel type: Diesel, U91, U95, U98, E10, LPG")
    state: Optional[str] = Field(default=None, description="State: QLD, NSW, VIC, WA, SA, ACT, TAS, NT")
    limit: Optional[int] = Field(default=None, description="Max results (default 10)")


class SourceCheapestFuelTool(BaseTool):
    """Find the cheapest fuel stations in Australia right now."""

    name: str = "source_cheapest_fuel"
    description: str = "Find the cheapest fuel stations in Australia. Real-time prices from 1,700+ stations. Free, no API key."
    args_schema: type[BaseModel] = CheapestFuelInput

    def _run(
        self,
        fuel_type: Optional[str] = None,
        state: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> str:
        params = {}
        if fuel_type:
            params["fuelType"] = fuel_type
        if state:
            params["state"] = state
        if limit:
            params["limit"] = str(limit)
        return _get("/api/market/fuel/cheapest", params=params)


class FuelNearMeInput(BaseModel):
    latitude: float = Field(description="GPS latitude")
    longitude: float = Field(description="GPS longitude")
    fuel_type: Optional[str] = Field(default=None, description="Fuel type (default: Diesel)")
    radius_km: Optional[int] = Field(default=None, description="Search radius in km (default: 10)")
    limit: Optional[int] = Field(default=None, description="Max results (default: 10)")


class SourceFuelNearMeTool(BaseTool):
    """Find fuel stations near a GPS location with current prices."""

    name: str = "source_fuel_near_me"
    description: str = "Find fuel stations near a location. Returns stations sorted by distance with current prices."
    args_schema: type[BaseModel] = FuelNearMeInput

    def _run(
        self,
        latitude: float,
        longitude: float,
        fuel_type: Optional[str] = None,
        radius_km: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> str:
        params: dict = {"latitude": str(latitude), "longitude": str(longitude)}
        if fuel_type:
            params["fuelType"] = fuel_type
        if radius_km:
            params["radiusKm"] = str(radius_km)
        if limit:
            params["limit"] = str(limit)
        return _get("/api/market/fuel/near-me", params=params)


class FuelSummaryInput(BaseModel):
    state: Optional[str] = Field(default=None, description="State filter (omit for national summary)")


class SourceFuelSummaryTool(BaseTool):
    """Get national or state-level fuel price summary."""

    name: str = "source_fuel_summary"
    description: str = "Get a fuel price summary — average, min, max prices by fuel type. National or state-level."
    args_schema: type[BaseModel] = FuelSummaryInput

    def _run(self, state: Optional[str] = None) -> str:
        params = {}
        if state:
            params["state"] = state
        return _get("/api/market/fuel/summary", params=params)
