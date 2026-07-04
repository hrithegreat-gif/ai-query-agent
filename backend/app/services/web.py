import asyncio
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from pydantic import BaseModel
from langchain_core.tools import tool
from app.config import settings

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    published_date: str | None = None


class SourceScore(BaseModel):
    relevance: float
    authority: float
    recency: float
    total: float


class SourceRanker:
    @staticmethod
    def get_domain(url: str) -> str:
        try:
            return urlparse(url).netloc.lower()
        except Exception:
            return ""

    @staticmethod
    def score_source(source: SearchResult, query: str) -> SourceScore:
        # 1. Relevance: keyword overlap between query and title/snippet
        query_words = set(query.lower().split())
        text = (source.title + " " + source.snippet).lower()
        overlap = sum(1 for word in query_words if word in text)
        relevance_score = overlap / max(len(query_words), 1)

        # 2. Authority: check domain
        domain = SourceRanker.get_domain(source.url)
        authority_score = 0.5  # Default
        high_authority = [
            "wikipedia.org", "github.com", "arxiv.org", "reuters.com",
            "bloomberg.com", "nytimes.com", "wsj.com", "techcrunch.com",
            "nature.com", "medium.com", "stackoverflow.com", "w3schools.com",
            "mozilla.org", "microsoft.com", "google.com", "apple.com"
        ]
        if any(auth in domain for auth in high_authority):
            authority_score = 0.9
        elif domain.endswith((".edu", ".gov", ".org")):
            authority_score = 0.8
        elif not domain or len(domain.split('.')) < 2:
            authority_score = 0.1

        # 3. Recency: parse date
        recency_score = 0.5  # Default if unknown
        if source.published_date:
            try:
                pub_date = None
                date_match = re.search(r"(\d{4})-(\d{2})-(\d{2})", source.published_date)
                if date_match:
                    year, month, day = map(int, date_match.groups())
                    pub_date = datetime(year, month, day)
                else:
                    pub_date = datetime.fromisoformat(source.published_date.replace("Z", "+00:00"))
                
                if pub_date:
                    days_ago = (datetime.utcnow() - pub_date.replace(tzinfo=None)).days
                    if days_ago < 0:
                        days_ago = 0
                    if days_ago <= 30:
                        recency_score = 1.0
                    elif days_ago <= 180:
                        recency_score = 0.8
                    elif days_ago <= 365:
                        recency_score = 0.6
                    else:
                        recency_score = max(0.1, 1.0 / (days_ago / 365.0))
            except Exception:
                recency_score = 0.5

        # Weighted total score
        total_score = (relevance_score * 0.5) + (authority_score * 0.3) + (recency_score * 0.2)

        return SourceScore(
            relevance=relevance_score,
            authority=authority_score,
            recency=recency_score,
            total=total_score
        )

    @staticmethod
    def rank_sources(sources: list[SearchResult], query: str, top_k: int = 3) -> list[tuple[SearchResult, SourceScore]]:
        scored_sources = []
        for src in sources:
            score = SourceRanker.score_source(src, query)
            scored_sources.append((src, score))

        # Sort by total score descending
        scored_sources.sort(key=lambda x: x[1].total, reverse=True)

        # Apply Domain Diversity (limit duplicate domains to max 1 copy in top_k)
        seen_domains: dict[str, int] = {}
        diverse_scored_sources = []
        remaining_sources = []

        for src, score in scored_sources:
            domain = SourceRanker.get_domain(src.url)
            count = seen_domains.get(domain, 0)
            if count < 1:
                seen_domains[domain] = count + 1
                diverse_scored_sources.append((src, score))
            else:
                remaining_sources.append((src, score))

        # If we don't have enough diverse sources, fill with remaining sources
        if len(diverse_scored_sources) < top_k:
            diverse_scored_sources.extend(remaining_sources)

        return diverse_scored_sources[:top_k]


def score_source(source: SearchResult, query: str) -> SourceScore:
    return SourceRanker.score_source(source, query)


def rank_sources(sources: list[SearchResult], query: str, top_k: int = 3) -> list[tuple[SearchResult, SourceScore]]:
    return SourceRanker.rank_sources(sources, query, top_k)


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
