import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    app_name = "AI Query Agent"
    frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    tavily_api_key = os.getenv("TAVILY_API_KEY", "")
    firecrawl_api_key = os.getenv("FIRECRAWL_API_KEY", "")
    database_url = os.getenv("DATABASE_URL", "")
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    history_limit = int(os.getenv("HISTORY_LIMIT", "10"))



settings = Settings()

from pathlib import Path

def load_prompt(name: str) -> str:
    path = Path(__file__).parent / "prompts" / f"{name}.txt"
    return path.read_text(encoding="utf-8").strip()