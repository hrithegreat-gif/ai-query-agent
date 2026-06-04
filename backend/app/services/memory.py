import json

from redis.asyncio import Redis

from app.config import settings
from app.services.storage import get_session_history

redis_client: Redis | None = None


async def init_memory() -> None:
    global redis_client
    try:
        redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
        await redis_client.ping()
    except Exception:
        redis_client = None


async def append_memory(session_id: str, role: str, content: str) -> None:
    if redis_client is None:
        return
    key = f"session:{session_id}:messages"
    try:
        await redis_client.rpush(key, json.dumps({"role": role, "content": content}))
        await redis_client.ltrim(key, -settings.history_limit, -1)
        await redis_client.expire(key, 60 * 60 * 24)
    except Exception:
        return


async def get_memory(session_id: str) -> list[dict[str, str]]:
    if redis_client is not None:
        try:
            rows = await redis_client.lrange(f"session:{session_id}:messages", -settings.history_limit, -1)
            return [json.loads(row) for row in rows]
        except Exception:
            return []
    return await get_session_history(session_id, settings.history_limit)
