from collections.abc import AsyncIterator
from datetime import date

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_ollama import ChatOllama

from app.config import settings
from app.services.events import sse
from app.services.memory import append_memory, get_memory
from app.services.storage import save_message
from app.services.web import SearchResult, scrape_url, search_web

llm = ChatOllama(
    model=settings.ollama_model,
    base_url=settings.ollama_base_url,
    temperature=0.7,
)

CURRENT_INFO_TERMS = {
    "latest",
    "today",
    "yesterday",
    "current",
    "recent",
    "news",
    "now",
    "this week",
    "this month",
    "2025",
    "2026",
    "price",
    "stock",
    "weather",
    "release",
    "update",
}

SYSTEM_PROMPT = """You are a helpful real-time AI query agent.
Answer clearly and concisely.
When live web context is provided, ground your answer in it and cite sources inline as [Source: URL].
If no live data is available for a current-events question, say that live search is not configured or did not return results."""


def get_llm() -> ChatOllama:
    return llm


def should_search(query: str) -> bool:
    lowered = query.lower()
    return any(term in lowered for term in CURRENT_INFO_TERMS)


def _history_messages(history: list[dict[str, str]]) -> list[HumanMessage | AIMessage]:
    messages: list[HumanMessage | AIMessage] = []
    for item in history:
        if item["role"] == "user":
            messages.append(HumanMessage(content=item["content"]))
        elif item["role"] == "assistant":
            messages.append(AIMessage(content=item["content"]))
    return messages


def _format_sources(results: list[SearchResult], page_content: str) -> str:
    if not results:
        return "No live web results were available."

    lines = []
    for index, item in enumerate(results, start=1):
        lines.append(
            f"{index}. {item.title}\nURL: {item.url}\nPublished: {item.published_date or 'unknown'}\nSnippet: {item.snippet}"
        )
    if page_content:
        lines.append(f"\nDetailed page content from top source, capped to 3000 characters:\n{page_content}")
    return "\n\n".join(lines)


async def stream_chat(query: str, session_id: str) -> AsyncIterator[str]:
    history = await get_memory(session_id)
    await save_message(session_id, "user", query)
    await append_memory(session_id, "user", query)

    web_context = ""
    results: list[SearchResult] = []
    page_content = ""

    if should_search(query):
        yield sse("status", {"type": "SEARCHING", "message": "Searching the live web", "input": query})
        results = await search_web(query)
        if results:
            yield sse(
                "status",
                {
                    "type": "SEARCH_COMPLETE",
                    "message": f"Found {len(results)} web results",
                    "sources": [item.__dict__ for item in results],
                },
            )
            yield sse("status", {"type": "READING", "message": "Reading the strongest source", "input": results[0].url})
            page_content = await scrape_url(results[0].url)
        else:
            yield sse("status", {"type": "SEARCH_COMPLETE", "message": "No web results available"})
        web_context = _format_sources(results, page_content)

    messages = [
        SystemMessage(content=f"{SYSTEM_PROMPT}\nToday's date is {date.today().isoformat()}."),
        *_history_messages(history),
        HumanMessage(
            content=(
                f"User question: {query}\n\n"
                f"Live web context:\n{web_context or 'No live web context was needed for this question.'}"
            )
        ),
    ]

    answer_parts: list[str] = []
    yield sse("status", {"type": "ANSWERING", "message": "Generating answer"})
    try:
        async for chunk in llm.astream(messages):
            token = str(chunk.content or "")
            if not token:
                continue
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
    await save_message(session_id, "assistant", answer)
    await append_memory(session_id, "assistant", answer)
    yield sse("done", {"message": "complete", "sources": [item.__dict__ for item in results]})
