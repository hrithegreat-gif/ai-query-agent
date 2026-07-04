import asyncio
import json
import re
from collections.abc import AsyncIterator
from datetime import date, datetime, timezone
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_ollama import ChatOllama

from app.config import settings
from app.services.events import sse
from app.services.memory import append_memory, get_memory
from app.services.storage import save_message
from app.services.web import SearchResult, scrape_url, search_web, rank_sources, score_source
from app.config import load_prompt, settings

SYSTEM_PROMPT = load_prompt("system")
DECOMPOSE_PROMPT = load_prompt("decompose")
CONFIDENCE_PROMPT = load_prompt("confidence")
CONTRADICTIONS_PROMPT = load_prompt("contradictions")
FOLLOWUPS_PROMPT = load_prompt("followups")
REFINE_PROMPT = load_prompt("refine")
PLANNER_PROMPT = load_prompt("planner")

llm = ChatOllama(
    model=settings.ollama_model,
    base_url=settings.ollama_base_url,
    temperature=0.7,
)


CITATION_PATTERN = re.compile(r"\[Source:\s*(https?://[^\]\s]+)\s*\]")
MAX_REQUERY_ATTEMPTS = 2



# ── Helpers ───────────────────────────────────────────────────────────────────

def get_llm() -> ChatOllama:
    return llm


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_json(text: str) -> Any:
    """Strip markdown fences then parse JSON. Handles ```json ... ``` wrapping from local LLMs."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"```\s*$", "", cleaned.strip(), flags=re.MULTILINE)
    return json.loads(cleaned.strip())


async def query_plan(query: str) -> dict[str, Any]:
    prompt = [
        SystemMessage(content=PLANNER_PROMPT),
        HumanMessage(content=query),
    ]
    try:
        response = await llm.ainvoke(prompt)
        parsed = _parse_json(str(response.content))
        return {
            "needs_search": bool(parsed.get("needs_search", False)),
            "complex": bool(parsed.get("complex", False)),
            "subquestions": parsed.get("subquestions", []) if isinstance(parsed.get("subquestions"), list) else [],
            "reasoning": str(parsed.get("reasoning", "")),
        }
    except Exception as exc:
        print(f"ERROR: Query planner failed: {exc}")
        return {
            "needs_search": True,
            "complex": False,
            "subquestions": [],
            "reasoning": "Planner error, falling back to basic search",
        }




def _tool_call(
    event_type: str,
    tool_name: str,
    tool_input: str,
    message: str,
    extra: dict[str, Any] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": event_type,
        "tool_name": tool_name,
        "input": tool_input,
        "message": message,
        "timestamp": now_iso(),
    }
    if extra:
        payload.update(extra)
    return sse("tool_call", payload)


# ── Message formatting ────────────────────────────────────────────────────────

def _history_messages(history: list[dict[str, str]]) -> list[HumanMessage | AIMessage]:
    messages: list[HumanMessage | AIMessage] = []
    for item in history:
        if item["role"] == "user":
            messages.append(HumanMessage(content=item["content"]))
        elif item["role"] == "assistant":
            messages.append(AIMessage(content=item["content"]))
    return messages


def _source_key(item: SearchResult) -> str:
    return item.url.strip().rstrip("/")


def _dedupe_results(results: list[SearchResult]) -> list[SearchResult]:
    seen: set[str] = set()
    deduped: list[SearchResult] = []
    for item in results:
        key = _source_key(item)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _format_sources(results: list[SearchResult], page_contents: str | list[str] | None = None) -> str:
    if not results:
        return "No live web results were available."
    lines = []
    for index, item in enumerate(results, start=1):
        lines.append(
            f"{index}. {item.title}\n"
            f"URL: {item.url}\n"
            f"Published: {item.published_date or 'unknown'}\n"
            f"Snippet: {item.snippet}"
        )
    if page_contents:
        if isinstance(page_contents, str):
            page_contents = [page_contents]
        lines.append(
            "\nDetailed page content from top sources, capped to 3000 characters each:"
        )
        for idx, content in enumerate(page_contents, start=1):
            if content.strip():
                lines.append(f"\n[Source {idx} Content]\n{content}")
    return "\n\n".join(lines)


def _format_decomposed_context(searches: list[tuple[str, list[SearchResult]]]) -> str:
    if not searches:
        return "No decomposed search context was available."
    blocks = []
    for sub_question, results in searches:
        blocks.append(f"Sub-question: {sub_question}\n{_format_sources(results)}")
    return "\n\n---\n\n".join(blocks)


def _build_citations(sources: list[SearchResult]) -> list[dict[str, Any]]:
    return [
        {
            "url": item.url,
            "title": item.title,
            "snippet": item.snippet,
            "published_date": item.published_date,
            "cited_at": now_iso(),
        }
        for item in sources
    ]


def _answer_messages(
    query: str,
    web_context: str,
    history: list[dict[str, str]],
) -> list[SystemMessage | HumanMessage | AIMessage]:
    return [
        SystemMessage(content=f"{SYSTEM_PROMPT}\nToday's date is {date.today().isoformat()}."),
        *_history_messages(history),
        HumanMessage(
            content=(
                f"User question: {query}\n\n"
                f"Live web context:\n{web_context or 'No live web context was needed for this question.'}\n\n"
                "IMPORTANT: You MUST cite every factual claim using ONLY this exact format: [Source: URL]\n"
                "Use the exact URLs from the web context above. Do not use numbered references like [1] or [Source Name].\n"
                "If no live web context was provided, do NOT invent or hallucinate any sources.\n"
                "Example: The sky is blue [Source: https://example.com].\n"
                "If you don't follow this exact format, citations will break."
            )
        ),
    ]


# ── LLM calls ────────────────────────────────────────────────────────────────



async def _search_sub_question(sub_question: str) -> tuple[str, list[SearchResult]]:
    return sub_question, await search_web(sub_question)


def _confidence_fallback(answer: str, citations: list[dict[str, Any]]) -> dict[str, str]:
    if len(citations) >= 2:
        return {"level": "HIGH", "reason": f"{len(citations)} cited sources support the answer."}
    if len(citations) == 1:
        return {"level": "MEDIUM", "reason": "One cited source supports the answer."}
    if "not configured" in answer.lower() or "did not return" in answer.lower():
        return {"level": "LOW", "reason": "Live source retrieval was unavailable or empty."}
    return {"level": "MEDIUM", "reason": "No live sources were needed or cited for this answer."}


async def _confidence(answer: str, citations: list[dict[str, Any]]) -> dict[str, str]:
    prompt = [
    SystemMessage(content=CONFIDENCE_PROMPT),
        HumanMessage(content=f"Answer:\n{answer}\n\nCitation count: {len(citations)}"),
    ]
    try:
        response = await llm.ainvoke(prompt)
        parsed = _parse_json(str(response.content))
        level = str(parsed.get("level", "MEDIUM")).upper()
        if level not in {"HIGH", "MEDIUM", "LOW"}:
            level = "MEDIUM"
        reason = str(parsed.get("reason", "")).strip() or "Confidence was estimated from the answer and citations."
        result = {"level": level, "reason": reason}
        
        return result
    except Exception as exc:
        
        return _confidence_fallback(answer, citations)


async def _refine_query(query: str, answer: str) -> str:
    prompt = [
        SystemMessage(content=REFINE_PROMPT),
        HumanMessage(content=f"Original query: {query}\nLow-confidence answer:\n{answer}"),
    ]
    try:
        response = await llm.ainvoke(prompt)
        refined = str(response.content).strip().strip('"')
        return refined or f"{query} latest reliable sources"
    except Exception:
        return f"{query} latest reliable sources"


async def _contradictions(sources: list[SearchResult]) -> dict[str, Any]:
    if len(sources) < 2:
        return {"has_conflicts": False, "items": [], "summary": "Not enough sources to compare."}

    source_text = _format_sources(sources[:5])
    prompt = [
        SystemMessage(content=CONTRADICTIONS_PROMPT),
        HumanMessage(content=source_text),
    ]
    try:
        response = await llm.ainvoke(prompt)
        raw = str(response.content)
        
        parsed = _parse_json(raw)
        result = {
            "has_conflicts": bool(parsed.get("has_conflicts", False)),
            "summary": str(parsed.get("summary", "")).strip() or "Sources were compared.",
            "items": parsed.get("items", []) if isinstance(parsed.get("items"), list) else [],
        }
        
        return result
    except Exception as exc:
      
        return {"has_conflicts": False, "items": [], "summary": "Could not compare sources."}


async def _followups(query: str, answer: str) -> list[str]:
    prompt = [
        SystemMessage(content=FOLLOWUPS_PROMPT),
        HumanMessage(content=f"Original question: {query}\nAnswer:\n{answer}"),
    ]
    try:
        response = await llm.ainvoke(prompt)
        parsed = _parse_json(str(response.content))
        questions = parsed.get("questions", [])
        return [str(item).strip() for item in questions if str(item).strip()][:3]
    except Exception:
        return [
            "What are the most important sources behind this?",
            "What changed recently on this topic?",
            "What should I compare this against next?",
        ]


# ── Live context builder ──────────────────────────────────────────────────────

async def _build_live_context(query: str) -> AsyncIterator[tuple[str, list[SearchResult], str]]:
    plan = await query_plan(query)
    
    if not plan["needs_search"]:
        yield ("", [], "")
        return

    if plan["complex"] and plan["subquestions"]:
        sub_questions = plan["subquestions"]
        yield (
            _tool_call(
                "DECOMPOSING",
                "query_planner",
                query,
                f"Decomposed into {len(sub_questions)} steps: {plan['reasoning']}",
                {"sub_questions": sub_questions},
            ),
            [],
            "",
        )
        searches = await asyncio.gather(*[_search_sub_question(item) for item in sub_questions])
        all_results = _dedupe_results([result for _, results in searches for result in results])
        
        # Rank results
        ranked_pairs = rank_sources(all_results, query, top_k=3)
        ranked_results = [r for r, _ in ranked_pairs]

        yield (
            _tool_call(
                "SEARCHING",
                "tavily_search",
                " | ".join(sub_questions),
                f"Searched {len(sub_questions)} sub-questions in parallel. Ranked top {len(ranked_results)} results.",
                {"sources": [item.__dict__ for item in ranked_results]},
            ),
            ranked_results,
            _format_decomposed_context(searches),
        )
        return

    yield (_tool_call("SEARCHING", "tavily_search", query, f"Searching: {plan['reasoning']}"), [], "")
    results = await search_web(query)
    if not results:
        yield (
            _tool_call("SEARCH_COMPLETE", "tavily_search", query, "No web results available"),
            [],
            _format_sources([]),
        )
        return

    # Rank results
    ranked_pairs = rank_sources(results, query, top_k=3)
    ranked_results = [r for r, _ in ranked_pairs]

    yield (
        _tool_call(
            "SEARCH_COMPLETE",
            "tavily_search",
            query,
            f"Found {len(results)} web results, ranked top {len(ranked_results)}",
            {"sources": [item.__dict__ for item in ranked_results]},
        ),
        ranked_results,
        "",
    )
    
    urls_str = ", ".join(r.url for r in ranked_results)
    yield (
        _tool_call("READING", "firecrawl_scrape", urls_str, f"Reading top {len(ranked_results)} sources in parallel"),
        ranked_results,
        "",
    )
    
    # Async scraping
    page_contents = await asyncio.gather(*[scrape_url(r.url) for r in ranked_results])
    yield ("", ranked_results, _format_sources(ranked_results, list(page_contents)))


# ── Answer streaming ──────────────────────────────────────────────────────────

async def _stream_answer(
    messages: list[SystemMessage | HumanMessage | AIMessage],
) -> AsyncIterator[str]:
    async for chunk in llm.astream(messages):
        token = str(chunk.content or "")
        if token:
            yield token


# ── Main entry point ──────────────────────────────────────────────────────────

async def stream_chat(query: str, session_id: str) -> AsyncIterator[str]:
    history = await get_memory(session_id)
    await save_message(session_id, "user", query)
    await append_memory(session_id, "user", query)

    all_sources: list[SearchResult] = []
    web_context = ""

    async for event, sources, context in _build_live_context(query):
        if event:
            yield event
        if sources:
            all_sources = _dedupe_results([*all_sources, *sources])
        if context:
            web_context = context

    if all_sources or web_context:
        yield _tool_call("ANSWERING", "ollama", settings.ollama_model, "Generating answer")

    answer_parts: list[str] = []
    try:
        async for token in _stream_answer(_answer_messages(query, web_context, history)):
            answer_parts.append(token)
            yield sse("token", {"token": token})
    except Exception as exc:
        yield sse(
            "error",
            {
                "message": "The local LLM could not be reached. Check that Ollama is running and the model is pulled.",
                "detail": str(exc),
            },
        )
        return

    answer = "".join(answer_parts)
    citations = _build_citations(all_sources)
    confidence = await _confidence(answer, citations) if all_sources else None

    # ── Auto re-query loop ────────────────────────────────────────────────────
    for attempt in range(1, MAX_REQUERY_ATTEMPTS + 1):
        if not confidence or confidence.get("level") != "LOW":
            break

        refined_query = await _refine_query(query, answer)
        yield _tool_call(
            "REQUERYING",
            "query_refiner",
            refined_query,
            f"Low confidence detected — refining search, attempt {attempt}/{MAX_REQUERY_ATTEMPTS}",
            {"attempt": attempt, "max_attempts": MAX_REQUERY_ATTEMPTS},
        )

        refined_results = await search_web(refined_query)
        if not refined_results:
            continue

        all_sources = _dedupe_results([*all_sources, *refined_results])
        web_context = f"{web_context}\n\nRefined search context:\n{_format_sources(refined_results)}"

        yield _tool_call(
            "SEARCHING",
            "tavily_search",
            refined_query,
            f"Search attempt {attempt + 1}/{MAX_REQUERY_ATTEMPTS + 1} returned {len(refined_results)} results",
            {"sources": [item.__dict__ for item in refined_results], "attempt": attempt + 1},
        )

        yield sse("token", {"token": "\n\n**Refined answer after additional search:**\n"})
        answer_parts.append("\n\n**Refined answer after additional search:**\n")

        try:
            async for token in _stream_answer(_answer_messages(query, web_context, history)):
                answer_parts.append(token)
                yield sse("token", {"token": token})
        except Exception as exc:
            yield sse(
                "error",
                {
                    "message": "The refined answer could not be generated. Check that Ollama is still running.",
                    "detail": str(exc),
                },
            )
            return

        answer = "".join(answer_parts)
        citations = _build_citations(all_sources)
        confidence = await _confidence(answer, citations)

    # ── Post-answer analysis ──────────────────────────────────────────────────
    contradictions = await _contradictions(all_sources) if all_sources else None

    if all_sources:
        if contradictions:
            yield sse("contradictions", contradictions)
        if confidence:
            yield sse("confidence", confidence)

    followups = await _followups(query, answer)
    yield sse("followups", {"questions": followups})

    await save_message(session_id, "assistant", answer)
    await append_memory(session_id, "assistant", answer)

    yield sse(
        "done",
        {
            "message": "complete",
            "sources": [item.__dict__ for item in all_sources],
            "citations": citations,
            "confidence": confidence,
            "contradictions": contradictions,
            "followups": followups,
        },
    )
