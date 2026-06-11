# Minimal Agent Harness

> **TL;DR** — A readable, dependency-free reference implementation of how an AI coding agent works: a tool-calling while-loop wired to a free **local** LLM, with real permission and sandbox safety. Built so you can understand every moving part instead of treating the agent as a black box.

A small, dependency-free coding agent that runs entirely on a **local** LLM via [Ollama](https://ollama.com) — no API key, no cloud, no `pip install`. Pure Python standard library.

It covers the nine building blocks of a coding harness. Most are fully wired into the loop; two
(**sub-agents** and **skills**) are present as scaffolding only — see "What's real vs. scaffolding" below.

1. a **while loop** engine — *working*
2. **context management** (compaction) — *working*
3. a **tools** registry — *working* (**skills** are scaffolding)
4. **sub-agents** — *scaffolding (presets defined, not yet invoked by the loop)*
5. **built-in primitives** — *working*
6. **session persistence** — *working*
7. **system-prompt assembly** — *working*
8. **lifecycle hooks** — *working*
9. **permissions & safety** — *working*

---

## Quick start

### 1. Install Ollama (one time)

On macOS, install the **app bundle** (cask), not the bare formula:

```bash
brew install --cask ollama-app
```

> The plain `brew install ollama` formula currently ships without its `llama-server` inference backend, so model calls fail with HTTP 500. The cask (`ollama-app`) bundles the runner and "just works".

Then launch the app once (it keeps the server running on `127.0.0.1:11434`):

```bash
open -a Ollama          # or run `ollama serve` in its own terminal
```

### 2. Pull a model

```bash
ollama pull qwen2.5-coder:7b      # ~4.7GB, recommended — strong at tool/JSON formatting
# ollama pull llama3.1:8b         # works too, but sloppier with structured output
```

### 3. Run the agent

From the repo root:

```bash
OLLAMA_MODEL=qwen2.5-coder:7b python demo/run_demo.py "Create a file note.txt containing 'hi', then confirm what you did."
```

`OLLAMA_MODEL` defaults to `llama3.1:8b` if unset. The demo sandboxes its tools to the **repo root**, so file paths must stay inside it — an absolute path like `/tmp/note.txt` is refused on purpose (see Permissions & safety). (The Web UI below uses a separate, dedicated sandbox directory instead.)

### 4. Run with no LLM at all

A scripted `StubModel` drives the full loop offline, so you can see the mechanics (and run tests) without Ollama:

```bash
python demo/run_demo.py --offline "anything"
python tests/test_harness.py          # 13 tests; or: python -m pytest tests/ -q
```

---

## Web UI

A local web UI (`server/` FastAPI backend + `web/` React frontend) wraps the harness with three
things: an **Agent workspace** (give a plain-English task and watch it run step by step, with
truthful permission badges and human-in-the-loop approval), **Setup & onboarding** (detects
Ollama's state and walks you to a working setup, with an instant offline path), and a **Help
assistant** (a chat answered by your local model, grounded in this README). It binds to
`127.0.0.1` only — it drives a shell-capable agent, so never expose it to a network.

The UI never modifies the harness's behavior or its safety model. The only harness change is an
additive, opt-in `Agent(on_event=...)` callback used to stream a live view; with `on_event=None`
the engine and its persisted log are byte-for-byte unchanged.

### One-command (production): built frontend served by the backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
( cd web && npm install && npm run build )      # builds web/dist
uvicorn server.app:app --host 127.0.0.1 --port 8765
# open http://127.0.0.1:8765
```

FastAPI serves the built assets at `/` and the API under `/api` — one origin, no CORS.

### Development (hot-reload frontend)

```bash
# terminal 1 — backend
uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload
# terminal 2 — frontend (Vite proxies /api to the backend; CORS is locked to this origin)
cd web && npm run dev        # http://127.0.0.1:5173
```

### Offline

No Ollama? Tick **Offline (scripted demo)** in the Agent tab (or use the Setup tab's *Skip — try
offline* button). The entire UI is usable with a scripted `StubModel`, including the approval card.

The agent's sandbox defaults to a dedicated, gitignored `.agent-workspace/` directory (seeded with
a `welcome.txt`), and per-run session logs are written under `.agent-data/sessions/`.

```bash
.venv/bin/python server/tests/test_server.py    # backend tests (offline; no Ollama needed)
```

---

## How it works

### The loop (`harness/loop.py`)

`Agent.run(goal)` is the engine. Each iteration:

1. **Compacts** the message history if it has grown past a threshold.
2. Calls the **model** with `(system_prompt, messages, tool_descriptors)`.
3. If the model returns `stop_reason == "end_turn"`, it logs and returns the final text.
4. Otherwise it **dispatches the tool call**, appends both the action and its result to the history, and loops.
5. A hard `max_iterations` cap (default 20) guarantees it can never run forever.

Every step is appended to a session log (if one is attached), so a run is fully replayable.

### The model protocol (`harness/model.py`)

Open models don't all support native tool-calling, so the harness uses a tiny **JSON protocol** injected into the system prompt. On each turn the model must reply with one JSON object:

```json
{"action": "tool",  "tool": "<name>", "args": { ... }}   // call a tool
{"action": "final", "text": "<answer>"}                   // stop
```

The loop only ever sees a normalized shape — `{"stop_reason", "text", "tool_call"}` — so swapping `OllamaModel` for `StubModel` (or, later, a cloud model) requires **zero** changes to the engine.

Because local models are inconsistent, parsing is deliberately tolerant:

- `_extract_json` pulls the first balanced `{...}` out of the reply, even when it's wrapped in ` ```json ` fences or surrounding prose, and falls back to `ast.literal_eval` for Python-style single-quoted dicts.
- `_normalize` accepts several near-equivalent shapes — `{"action":"tool","tool":"X"}`, `{"action":"X","args":{}}` (tool name in `action`), `{"name":"X",...}`, and treats `final`/`finish`/`done`/`answer`/etc. as "stop". Anything unparseable becomes a final answer, so the loop never hangs.

`StubModel` takes a scripted list of those normalized response dicts and returns them in order — that's what the tests and `--offline` mode use.

### Tools & built-ins (`harness/tools.py`, `harness/builtins.py`)

A tool is a small record: `name`, required `permissions`, a `handler` callable, and a one-line `description`. `ToolRegistry.descriptors()` sends only the **safe** metadata (name, permission, description) to the model — never the handler function.

The five built-in primitives, all pure stdlib:

| tool | permission | what it does |
|------|-----------|--------------|
| `read_file` | read | read a file's text |
| `grep` | read | recursive regex search |
| `write_file` | workspace | create/overwrite a file |
| `edit_file` | workspace | replace a unique string in a file |
| `bash` | (classified) | run a shell command |

### Permissions & safety (`harness/permissions.py`, `harness/builtins.py`)

Two independent layers protect the host:

**1. Permission levels.** `read` < `workspace` < `full`. Each tool declares the minimum it needs, and the `Agent` runs with a permission ceiling (default `workspace`). A call is dispatched only if `can_dispatch(required, ceiling)` passes.

`bash` is classified **per-command**, because the same tool is safe or dangerous depending on the input:
- a plain safe command (`ls`, `cat`, `grep`, …) → `read`
- a dangerous command anywhere in the line (`rm`, `sudo`, `dd`, `curl`, …) → `full`
- **any** shell chaining/piping/redirection/substitution (`;`, `&&`, `|`, `>`, `` ` ``, `$(…)`) → `full`

That last rule is deliberate: a first-token check alone is bypassable (`ls; rm -rf ~`), so anything we can't statically reason about is forced to `full` and therefore **denied under the default `workspace` ceiling**. The trade-off is that legitimate pipes (`grep x | wc -l`) are also denied unless you raise the ceiling to `full` — safety over convenience.

**2. Workspace path sandboxing.** `WorkspaceTools(root)` binds every file operation to a root directory and refuses paths that resolve outside it — blocking `../` escapes, absolute paths to `/etc/passwd`, `~/.ssh/...`, etc. The demo registers these sandboxed tools, and `bash` runs with `cwd=root` and a clamped timeout. (The bare `read_file`/`write_file`/… functions in `builtins.py` are unconfined and exist for tests and flexibility — don't register those directly in an untrusted setting.)

> Caveat: `bash` still uses `shell=True`, so if you raise the ceiling to `full`, the model gets a real shell. The sandbox confines *file-tool* paths and the bash working directory, but a `full`-permission shell is not containerized. For untrusted use, run the whole harness in a container/VM.

### Lifecycle hooks (`harness/hooks.py`)

- **pre-hooks** fire before a tool runs and can return `DENY` to block it (e.g. require approval for destructive actions).
- **post-hooks** fire after and observe the result (logging, auditing) — they can't block.

### Context management (`harness/context.py`)

When the history exceeds `compact_threshold` messages, the oldest turns are folded into a single recap message and the most recent `keep_recent` are preserved. The default summary is deterministic (no extra LLM round-trip); swap in a model call if you want richer summaries.

### Session persistence (`harness/persistence.py`)

`Session` writes one JSON event per line (append-only, flushed immediately). If the process dies, the log doesn't — and `replay()` reconstructs the full session. Two runs can share a log without stepping on each other.

### Sub-agents (`harness/subagents.py`) — scaffolding

Three presets are defined, each with its own permission level, restricted tool list, and focused system prompt:

- **explore** — read-only (`read_file`, `grep`)
- **general** — full workspace toolset
- **verify** — read + `bash`, for confirming changes with tests

**Note:** these are data only. The loop does not yet spawn sub-agents — there is no `call_subagent` tool wired into the registry. Implementing that (a tool whose handler builds a nested `Agent` with the preset's restricted registry and permission ceiling) is the natural next step.

### System-prompt assembly (`harness/prompt.py`)

`assemble_system_prompt(cwd)` puts a static scaffold first (so the model's prompt prefix stays cacheable), states the working directory (which keeps local models from inventing paths like `/home/user/...`), then walks ancestor directories appending any `AGENTS.md` / `CLAUDE.md` / `.cursorrules` it finds, bounded by per-file and total size caps.

---

## What's real vs. scaffolding

Being upfront so the code matches the claims:

| Feature | Status |
|---------|--------|
| while loop, dispatch, iteration cap | working |
| model protocol + tolerant parsing | working |
| tools registry + 5 built-ins | working |
| permission levels + per-command bash classification | working |
| workspace path sandboxing | working |
| lifecycle hooks (pre-deny / post-observe) | working |
| context compaction | working (deterministic summary) |
| session persistence (JSONL replay) | working |
| system-prompt assembly | working |
| **sub-agents** | **scaffolding** — presets defined, not invoked by the loop |
| **skills** (markdown-backed tools) | **scaffolding** — described in comments, none implemented/registered |

A skill would just be a normal registered tool whose handler reads a markdown file at call time; the registry already supports it, but no example ships yet.

## Layout

```
minimal-agent-harness/   (repo root — these dirs sit at the top level; there is no build/ wrapper)
  harness/        the package
    loop.py         Agent engine
    model.py        OllamaModel + StubModel
    tools.py        Tool / ToolRegistry
    builtins.py     read/write/edit/grep/bash
    permissions.py  read/workspace/full + bash classifier
    hooks.py        pre/post lifecycle hooks
    context.py      history compaction
    persistence.py  append-only JSONL session log
    prompt.py       system-prompt assembly
    subagents.py    explore/general/verify presets
  demo/
    run_demo.py     runnable entry point (live + --offline)
  tests/
    test_harness.py 13 tests, no LLM required
    test_on_event.py  tests the additive Agent.on_event hook
  server/           FastAPI backend for the Web UI (not part of the core)
    app.py            routes, CORS, static serving, help assistant
    runner.py         per-run queue / SSE transport / cancel
    approvals.py      approval registry + pre-hook + policy
    ollama_client.py  health probe + assistant streaming
    sessions.py       per-run session files + replay
    config.py         shared host / default model / sandbox dirs
    schemas.py        Pydantic request & response models
  web/              React + TypeScript + Tailwind frontend
```

## Notes & limitations

- `qwen2.5-coder:7b` is far more reliable at the JSON protocol than `llama3.1:8b`; the parser is tolerant either way.
- Inference is CPU-bound on Macs without a supported GPU runner, so expect ~5–12s per model turn.
- This is a teaching harness: the model has no native function-calling, retries, or streaming. The point is that the whole agent loop fits in a handful of readable, dependency-free files.
