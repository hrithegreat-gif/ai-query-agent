from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.llm import stream_chat

router = APIRouter()


class ChatRequest(BaseModel):
    query: str = Field(min_length=1)
    session_id: str | None = None


@router.post("/chat")
async def chat_endpoint(request: ChatRequest) -> StreamingResponse:
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    session_id = request.session_id or str(uuid4())
    return StreamingResponse(
        stream_chat(query, session_id),
        media_type="text/event-stream",
        headers={"X-Session-Id": session_id},
    )
