import asyncio
from dataclasses import dataclass
from typing import Any

from langchain_core.tools import tool

from app.config import settings


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    published_date: str | None = None


def _normalize_result(result: dict[str, Any]) -> SearchResult:
    return SearchResult(
        title=result.get("title") or "Untitled source",
        url=result.get("url") or "",
        snippet=result.get("content") or result.get("snippet") or "",
        published_date=result.get("published_date"),
    )


async def search_web(query: str, max_results: int = 5) -> list[SearchResult]:
    if not settings.tavily_api_key:
        return []

    def run_search() -> list[SearchResult]:
        from tavily import TavilyClient

        client = TavilyClient(api_key=settings.tavily_api_key)
        response = client.search(
            query=query,
            max_results=max_results,
            include_answer=False,
            include_raw_content=False,
        )
        return [_normalize_result(item) for item in response.get("results", [])]

    try:
        return await asyncio.to_thread(run_search)
    except Exception:
        return []


async def scrape_url(url: str, limit: int = 3000) -> str:
    if not settings.firecrawl_api_key or not url:
        return ""

    def run_scrape() -> str:
        from firecrawl import FirecrawlApp

        app = FirecrawlApp(api_key=settings.firecrawl_api_key)
        response = app.scrape_url(url, formats=["markdown"])
        markdown = ""
        if isinstance(response, dict):
            markdown = response.get("markdown") or response.get("content") or ""
        else:
            markdown = getattr(response, "markdown", "") or ""
        return markdown[:limit]

    try:
        return await asyncio.to_thread(run_scrape)
    except Exception:
        return ""


@tool
async def search_web_tool(query: str) -> str:
    """Search the live web and return top results as title, URL, snippet, and date."""
    results = await search_web(query)
    if not results:
        return "No live web results were available."
    return "\n\n".join(
        f"Title: {item.title}\nURL: {item.url}\nSnippet: {item.snippet}\nPublished: {item.published_date or 'unknown'}"
        for item in results
    )


@tool
async def fetch_page_content(url: str) -> str:
    """Fetch clean markdown for a web page when search snippets are not enough."""
    content = await scrape_url(url)
    return content or "No page content was available."
