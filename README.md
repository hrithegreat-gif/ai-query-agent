# AI Query Agent

Real-time conversational AI agent built with React, FastAPI, LangChain, Ollama, Tavily, Firecrawl, PostgreSQL, and Redis.

## Phase 4 Features

- Auto re-query loop: when a source-grounded answer is rated `LOW` confidence, the backend asks the model to refine the search query, runs up to two additional Tavily searches, streams the re-query steps into the reasoning panel, and appends a refined answer.
- Contradiction detection: when multiple sources are available, the backend compares snippets for meaningful factual conflicts and returns either a conflict report or a source-agreement status.
- Follow-up suggestions: every completed answer can return three context-aware follow-up questions. Clicking a chip submits it immediately.
- Markdown export: each answer can be exported with the original question, answer text, confidence rating, and citations.

## Local Notes

Run Postgres and Redis with:

```powershell
docker compose up -d
```

Run the frontend with:

```powershell
cd frontend
npm.cmd run dev
```

Run the backend after Python is available and dependencies are installed:

```powershell
cd backend
uvicorn main:app --reload
```
