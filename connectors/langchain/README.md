# source-tailor-tools

LangChain and CrewAI tool wrappers for the **Source** verified knowledge graph.

## Install

```bash
pip install source-tailor-tools
```

## Quick Start

```python
from source_tools import SourceSearchLegislationTool, SourceTopicsTool

# No auth needed for topics
topics_tool = SourceTopicsTool()
print(topics_tool.run(status="open"))

# Axiom key needed for legislation
leg_tool = SourceSearchLegislationTool(axiom_key="pact_ax_YOUR_KEY")
print(leg_tool.run(query="mine safety", jurisdiction="QLD"))
```

## Tools

| Tool | Description | Auth |
|------|-------------|------|
| `SourceHubStatsTool` | Knowledge graph overview | None |
| `SourceTopicsTool` | List/filter topics | None |
| `SourceSearchLegislationTool` | Full-text legislation search | Axiom key |
| `SourceFactsTool` | Query verified facts | Axiom key |
| `SourceGetLegislationTool` | Get a legislation document | Axiom key |

## With CrewAI

```python
from crewai import Agent
from source_tools import SourceSearchLegislationTool

researcher = Agent(
    role="Legal Researcher",
    tools=[SourceSearchLegislationTool(axiom_key="pact_ax_...")],
)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SOURCE_BASE_URL` | Override base URL (default: `https://source.tailor.au`) |
| `SOURCE_AXIOM_KEY` | Default Axiom key for tools that need it |
