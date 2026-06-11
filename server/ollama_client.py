#all Ollama I/O for the UI layer. Two concerns, both kept off the event loop by the callers:
#  - probe_health(): a fast, never-throwing health check (stdlib urllib, run via asyncio.to_thread)
#  - stream_assistant(): a plain streaming chat for the help assistant (httpx.AsyncClient).
#
#NOTE: we deliberately do NOT reuse harness.OllamaModel here — that client is protocol-bound and
#forces tool-call JSON. The help assistant needs an ordinary, free-form chat completion.

import json
import shutil
import urllib.error
import urllib.request

import httpx


def probe_health(host: str, timeout: float = 2.0) -> dict:
    #blocking; intended to run inside asyncio.to_thread. Never raises — a down server is data.
    host = host.rstrip("/")
    installed = shutil.which("ollama") is not None
    running = False
    models: list[str] = []
    try:
        req = urllib.request.Request(f"{host}/api/tags")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read())
        running = True
        models = [m.get("name") for m in body.get("models", []) if m.get("name")]
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError, TimeoutError):
        running = False
    return {"ollama_installed": installed, "ollama_running": running, "models": models}


async def stream_assistant(
    host: str,
    model: str,
    system_prompt: str,
    messages: list[dict],
    temperature: float = 0.2,
    timeout: float = 120.0,
):
    #async generator yielding content deltas. Raises on connection/HTTP failure so the route can
    #forward a single {"type":"error"} frame. Ollama returns NDJSON: one JSON object per line.
    host = host.rstrip("/")
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}, *messages],
        "stream": True,
        "options": {"temperature": temperature},
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", f"{host}/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                delta = obj.get("message", {}).get("content", "")
                if delta:
                    yield delta
                if obj.get("done"):
                    break
