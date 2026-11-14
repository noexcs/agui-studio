"""Deep agent served over LangGraph Agent Server, then adapted to AG-UI by
@ag-ui/langgraph (see server/deepagent.mjs).

Model: DeepSeek via its OpenAI-compatible endpoint. Credentials are read from
DEEPSEEK_API_KEY or the pi provider config — never committed.
"""
import json
import os
from pathlib import Path

from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI


def _deepseek() -> ChatOpenAI:
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")
    if not key:
        try:
            cfg = json.loads(Path.home().joinpath(".pi/agent/models.json").read_text(encoding="utf-8"))
            provider = cfg.get("providers", {}).get("deepseek-api", {})
            key = provider.get("apiKey", "")
            base_url = provider.get("baseUrl", base_url)
            models = provider.get("models") or []
            if models:
                model = models[0].get("id", model)
        except Exception:
            pass
    return ChatOpenAI(model=model, base_url=base_url, api_key=key or "missing", temperature=0.3)


agent = create_deep_agent(
    model=_deepseek(),
    system_prompt=(
        "You are a concise travel assistant. When the user asks for live facts, "
        "use the built-in tools/subagents and keep the final answer under four sentences. "
        "Answer in the user's language."
    ),
)
