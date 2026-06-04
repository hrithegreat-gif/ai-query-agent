from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, Text, select
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings

metadata = MetaData()

messages = Table(
    "messages",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("session_id", String(80), nullable=False, index=True),
    Column("role", String(20), nullable=False),
    Column("content", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

engine: AsyncEngine | None = None


async def init_storage() -> None:
    global engine
    if not settings.database_url:
        return
    try:
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        async with engine.begin() as conn:
            await conn.run_sync(metadata.create_all)
    except Exception:
        engine = None


async def save_message(session_id: str, role: str, content: str) -> None:
    if engine is None:
        return
    try:
        async with engine.begin() as conn:
            await conn.execute(
                messages.insert().values(
                    session_id=session_id,
                    role=role,
                    content=content,
                    created_at=datetime.now(timezone.utc),
                )
            )
    except Exception:
        return


async def get_session_history(session_id: str, limit: int = 10) -> list[dict[str, str]]:
    if engine is None:
        return []
    query = (
        select(messages.c.role, messages.c.content)
        .where(messages.c.session_id == session_id)
        .order_by(messages.c.created_at.desc(), messages.c.id.desc())
        .limit(limit)
    )
    try:
        async with engine.connect() as conn:
            rows = (await conn.execute(query)).all()
    except Exception:
        return []
    return [{"role": role, "content": content} for role, content in reversed(rows)]
