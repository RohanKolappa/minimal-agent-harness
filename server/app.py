#FastAPI wiring: CORS, routes, the help assistant, and static serving of the built frontend.
#Localhost only. This drives a shell-capable agent — never expose it to a network.

import json
import sys
from pathlib import Path

#put the repo root on sys.path so `import harness` works regardless of launch directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import REPO_ROOT, ensure_workspace, get_config
from .ollama_client import probe_health, stream_assistant
from .schemas import ApproveRequest, AssistantRequest, RunRequest, RunResponse
from . import runner
from . import sessions as sessions_mod

config = get_config()

#read the actual README once at startup to ground the help assistant
try:
    _README = (REPO_ROOT / "README.md").read_text()
except OSError:
    _README = "(README.md not found)"

_SAFETY_CHEATSHEET = """\
Permissions & safety cheat-sheet (ground truth for answering "why was X blocked?"):
- Three permission levels: read < workspace < full. The agent runs with a ceiling (default: workspace).
- A tool runs only if its required level <= the ceiling.
- bash is classified per-command: plain reads (ls, cat, grep, echo, ...) -> read; anything with a
  pipe/redirect/substitution (| > < ` $( ) && ; ) or a dangerous command (rm, mv, sudo, dd, curl,
  git, pip, npm, brew, ...) -> full. Under the default workspace ceiling, full-classified bash is
  HARD-BLOCKED before any approval card appears.
- All file tools are sandboxed to a workspace root; paths that escape it (../, absolute paths
  outside, ~/.ssh) raise a PermissionError.
- Approval cards appear only for actions that already passed the ceiling (e.g. write_file, edit_file,
  workspace-level bash). Raising the ceiling to full is an advanced, explicitly-confirmed action.
"""

ASSISTANT_SYSTEM_PROMPT = (
    "You are the built-in help assistant for the Minimal Agent Harness web UI. Answer questions ONLY "
    "about this project: how to install and run it, what the agent can do, the permission/safety model, "
    "and the UI itself. Be concise and accurate, and ground every answer in the README and cheat-sheet "
    "below. If asked to actually perform a task (edit files, run commands), do NOT attempt it — explain "
    "that actions happen in the Agent tab, where they are sandboxed and approval-gated.\n\n"
    "===== README.md =====\n" + _README + "\n\n===== " + _SAFETY_CHEATSHEET
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # modern Starlette lifespan (replaces the deprecated @app.on_event("startup"))
    ensure_workspace(config.workspace_root)
    config.sessions_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Minimal Agent Harness UI", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.dev_origins,  # locked to the Vite dev origin; prod is same-origin
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


# ----------------------------------------------------------------------------- health
@app.get("/api/health")
async def health() -> dict:
    #offload the probe so a hung/missing Ollama can never block the event loop
    probe = await asyncio.to_thread(probe_health, config.ollama_host, 2.0)
    models = probe["models"]
    return {
        **probe,
        "recommended_present": config.recommended_model in models,
        "ollama_host": config.ollama_host,
        "default_model": config.default_model,
        "recommended_model": config.recommended_model,
        "workspace_root": str(config.workspace_root),
        "offline_available": True,
    }


# ----------------------------------------------------------------------------- runs
@app.post("/api/run", response_model=RunResponse)
async def create_run(req: RunRequest) -> RunResponse:
    if req.permission not in ("read", "workspace", "full"):
        raise HTTPException(status_code=400, detail="invalid permission")
    runner.sweep_finished()
    state = runner.start_run(req, config)
    return RunResponse(run_id=state.run_id)


@app.get("/api/run/{run_id}/events")
async def run_events(run_id: str):
    state = runner.RUNS.get(run_id)
    if state is None:
        raise HTTPException(status_code=404, detail="unknown or finished run")
    return StreamingResponse(
        runner.event_stream(state),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@app.post("/api/run/{run_id}/approve")
async def approve_run(run_id: str, req: ApproveRequest) -> dict:
    ok = runner.approve(run_id, req.approval_id, req.decision)
    return {"ok": ok}


@app.post("/api/run/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict:
    ok = runner.cancel_run(run_id)
    return {"ok": ok}


# ----------------------------------------------------------------------------- assistant
@app.post("/api/assistant")
async def assistant(req: AssistantRequest):
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    model = req.model or config.default_model

    async def gen():
        try:
            async for delta in stream_assistant(
                config.ollama_host, model, ASSISTANT_SYSTEM_PROMPT, messages
            ):
                yield f"data: {json.dumps({'type': 'token', 'text': delta})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:  # Ollama down/unreachable -> point the user at onboarding
            msg = f"The local model is unavailable ({e}). Open the Setup tab to get Ollama running, "
            msg += "or use offline mode in the Agent tab."
            yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ----------------------------------------------------------------------------- sessions
@app.get("/api/sessions")
async def list_sessions() -> list[dict]:
    return sessions_mod.list_sessions(config.sessions_dir)


@app.get("/api/sessions/{run_id}")
async def get_session(run_id: str) -> dict:
    events = sessions_mod.replay_session(config.sessions_dir, run_id)
    if events is None:
        raise HTTPException(status_code=404, detail="unknown session")
    return {"id": run_id, "events": events}


# ----------------------------------------------------------------------------- config
@app.get("/api/config")
async def get_config_route() -> dict:
    return {
        "default_model": config.default_model,
        "recommended_model": config.recommended_model,
        "ollama_host": config.ollama_host,
        "workspace_root": str(config.workspace_root),
        "permissions": ["read", "workspace", "full"],
        "default_permission": "workspace",
    }


# ----------------------------------------------------------------------------- static (prod)
#serve the built frontend at / when web/dist exists. Mounted last so it never shadows /api routes.
if config.web_dist.exists():
    app.mount("/", StaticFiles(directory=str(config.web_dist), html=True), name="static")
