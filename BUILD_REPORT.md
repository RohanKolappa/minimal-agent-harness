# Build Report — Local Web UI for the Minimal Agent Harness

A polished, localhost-only web UI on top of the existing harness, delivering the three pillars
(Agent workspace, Setup & onboarding, Help assistant) plus History — without touching the harness's
safety model or its dependency-free core.

---

## (a) Changes to `harness/`

**Exactly one file changed: `harness/loop.py`. The change is purely additive** — an opt-in
`on_event` callback. With `on_event=None` (the default), the engine's behavior and its persisted
session log are byte-for-byte identical to before. No other harness file was modified; `harness/`
still imports nothing outside the standard library (verified programmatically).

Precise description of the diff:

1. `from typing import Callable` added.
2. `Agent.__init__` gained `on_event: Callable[[dict], None] | None = None`, stored as
   `self.on_event`.
3. New `_emit(self, event)` method — calls `self.on_event(event)` only if set; **never** writes to
   the session. `_log` is unchanged (session-only). The two stay separate.
4. `_emit(...)` calls inserted at the points specified in §3, every existing `_log` left in place:
   - `run()` top: `run_started` (goal, workspace, permission, max_iterations)
   - each iteration start: `iteration` (n, max)
   - compaction: capture `before=len(messages)`, and after `compact_if_needed`, if it shrank, emit
     `compaction` (from, to)
   - immediately after the model call (before the end_turn check): `model_response`
     (stop_reason, text, tool_call)
   - end_turn branch: `final` (text)
   - `_dispatch_tool`: before the unknown-tool return → `tool_error`; before the ceiling return →
     `permission_denied` (tool, required, ceiling); on the pre-hook DENY branch (in addition to the
     existing `_log`) → `hook_denied`; before running the handler → `tool_call` (tool, args,
     required_permission); after the handler returns → `tool_result` (tool, **full untruncated**
     result, is_error).

The permission-check order, the five persisted event shapes, and `classify_bash` /
`can_dispatch` / `WorkspaceTools` are all unchanged.

Cancellation reuses this hook with no further loop change: the UI's emit closure raises
`RunCancelled` when its run's cancel flag is set, and because `_emit` runs at iteration/tool
boundaries, the run unwinds cooperatively (an in-flight blocking model call finishes first).

---

## (b) New files

### Harness test
- `tests/test_on_event.py` — 3 tests: (a) `on_event=None` leaves the persisted log unchanged
  (exact five-shape sequence); (b) a capturing callback yields the expected ordered emit stream
  including a `tool_result` whose result is **not** truncated; (c) `permission_denied` is surfaced
  and the tool never runs.

### Backend (`server/`, FastAPI)
- `server/__init__.py`
- `server/config.py` — single shared `ollama_host`, default model, dedicated gitignored
  `.agent-workspace/` + `.agent-data/`, dev CORS origins, `ensure_workspace` (creates + seeds
  `welcome.txt`).
- `server/schemas.py` — Pydantic v2 models (RunRequest, ApprovalPolicy, ApproveRequest,
  AssistantRequest, …).
- `server/ollama_client.py` — `probe_health` (stdlib urllib, never throws; run via `to_thread`) +
  `stream_assistant` (httpx async NDJSON streaming). Does **not** reuse `OllamaModel`.
- `server/approvals.py` — `ApprovalRegistry` (threading.Event + default-deny slots,
  `resolve_all_pending` for cancel), `ApprovalPolicy`, `make_approval_hook`.
- `server/sessions.py` — per-run `Session` files, list, replay.
- `server/runner.py` — `RunState`, module-level `RUNS`, `enqueue` (transport, never gated) vs
  `emit` (cancel-checking, raises `RunCancelled`; suppresses the agent's duplicate `run_started`),
  `build_agent`, `run_agent_task` (one terminal `run_finished`), `start_run`, `cancel_run`,
  `approve`, `event_stream` (SSE), `sweep_finished` (TTL backstop), and the fixed offline
  `StubModel` script with real workspace paths.
- `server/app.py` — CORS (locked to dev origin), routes (`/api/health`, `/api/run`,
  `/api/run/{id}/events|approve|cancel`, `/api/assistant`, `/api/sessions[/{id}]`, `/api/config`),
  the README-grounded help assistant, and static serving of `web/dist` at `/` mounted last.
- `server/requirements.txt` — fastapi, uvicorn[standard], httpx, pydantic.
- `server/tests/__init__.py`, `server/tests/test_server.py` — 5 tests (§4.7, all offline).

### Frontend (`web/`, React + TypeScript + Tailwind v4 + Vite)
- Config: `package.json`, `package-lock.json`, `vite.config.ts` (dev proxy `/api` →
  `127.0.0.1:8765`), `tsconfig.json`, `index.html`.
- `src/main.tsx`, `src/index.css` (design tokens: dark-default + light, one accent, neutral scale,
  mono/sans stacks, motion/skeleton helpers), `src/vite-env.d.ts`, `src/types.ts`.
- `src/lib/` — `api.ts` (same-origin `/api` base), `sse.ts` (one fetch-based SSE parser for both
  the GET run stream and the POST assistant stream), `format.ts` (multiline-safe bash parse, grep
  parse, ext→language, time).
- `src/hooks/` — `useTheme.ts`, `useHealth.ts` (auto-re-polling), `useRun.ts` (SSE lifecycle,
  approvals, cancel).
- `src/agent/runModel.ts` — folds the raw event stream into ordered renderable blocks, pairing
  approval → tool_call → tool_result.
- `src/components/` — `ui.tsx` (permission/status badges), `CodeBlock.tsx` (prism-react-renderer,
  custom theme), `DiffView.tsx` (`diff` line diff), `RunBlocks.tsx` (bash terminal, file viewer,
  grep matches, write preview, edit diff, approval card, blocked treatments, iteration/compaction
  markers, model collapsible, final, run-finished).
- `src/views/` — `AgentWorkspace.tsx`, `Setup.tsx`, `HelpAssistant.tsx`, `History.tsx`.
- `src/App.tsx` — sidebar shell, tabs (`?tab=` deep-link), theme toggle, health dot, first-run
  Setup nudge.

---

## (c) Run commands

**Production (one origin, no CORS):**
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
( cd web && npm install && npm run build )
uvicorn server.app:app --host 127.0.0.1 --port 8765
# http://127.0.0.1:8765
```

**Development (hot reload):**
```bash
uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload   # terminal 1
cd web && npm run dev                                           # terminal 2 → http://127.0.0.1:5173
```

**Offline:** tick *Offline (scripted demo)* in the Agent tab, or *Skip — try offline* in Setup. No
Ollama needed. CLI offline path unchanged: `python demo/run_demo.py --offline "anything"`.

**Tests:**
```bash
python tests/test_harness.py                  # 13, harness
python tests/test_on_event.py                 # 3, on_event
.venv/bin/python server/tests/test_server.py  # 5, backend (offline)
```

---

## (d) Acceptance criteria verified, and how

- **Core untouched.** `python tests/test_harness.py` → 13/13 pass. `python demo/run_demo.py "..."`
  (live, llama3.1:8b) returned `Hello!`; `--offline` returned the scripted answer. A programmatic
  AST scan confirmed `harness/` imports **no** third-party modules. The `loop.py` git diff shows
  only additive `_emit` lines; every `_log` is intact, so the persisted log is unchanged
  (also asserted by `test_on_event.py`).
- **One-command UI.** `uvicorn server.app:app …` serves the built SPA at `/` and the API at `/api`;
  verified `curl /` returns the app HTML and `curl /api/health` still works (not shadowed).
- **Live run with approval gating.** Drove a real run over HTTP (goal: create `note.txt` with
  "hi"): stream was `run_started → iteration → model_response → approval_request(write_file) →`
  [approved] `→ approval_resolved(allow) → tool_call(workspace) → tool_result(is_error=false) →
  final → run_finished(completed)`, and `note.txt` contained `hi` inside `.agent-workspace/`.
  Also reproduced in the real browser (puppeteer): the write_file **approval card gated execution**,
  approving applied the write, and the final answer + Completed badge rendered. Tool blocks showed
  correct permission badges (READ on read_file, WORKSPACE on write_file) and the syntax-highlighted
  file viewer.
- **Safety, demonstrably** (run through the exact sandboxed registry the server uses):
  - `bash "rm -rf ."` → `permission_denied {required: full, ceiling: workspace}`, **not executed**.
  - `bash "git status"` → `permission_denied {full vs workspace}`, not executed.
  - `bash "cat x | wc -l"` (pipe) → `permission_denied {full vs workspace}`, not executed.
  - `write_file "../escape.txt"` → `tool_result` with `error: PermissionError … outside the
    workspace`, `is_error=true`; the file did **not** appear outside the sandbox.
  - `read_file "/etc/passwd"` → same `PermissionError` tool error, nothing read.
- **Control / cancel during approval.** Backend test `test_cancel_during_approval`: cancel while an
  approval card is pending resolves the pending approval (deny) and the next emit raises
  `RunCancelled`, ending in `run_finished{cancelled}` with no hung stream and no write.
- **Onboarding / offline when Ollama absent.** `test_health_unreachable` (Ollama pointed at a dead
  port) returns promptly (<5s) with `ollama_running:false`, `offline_available:true`. The Setup tab
  shows live status chips with copyable commands and a Skip-to-offline CTA (screenshotted).
  Offline `StubModel` run completes end-to-end (`test_offline_completed`).
- **Help assistant grounded + streamed.** `POST /api/assistant` streamed token deltas for "what is
  the default permission ceiling?" → "The default permission ceiling is `workspace`." (correct,
  README-grounded).
- **Localhost & no-CORS / no-blocking.** Server binds `127.0.0.1`; prod is same-origin; dev CORS is
  locked to the Vite origin. Every Ollama call (health probe, agent run, assistant stream) runs off
  the event loop (`asyncio.to_thread` / `httpx.AsyncClient`). Full mode is gated behind an explicit
  confirmation modal warning that a full shell is not containerized.
- **Approval allow vs deny** (`test_approval_allow` / `test_approval_deny`): allow applies the write;
  deny surfaces `hook_denied` and the file is never written.

Backend test run: **all 5 pass.** on_event: **3 pass.** harness: **13 pass.**

---

## (e) Deviations from the spec

- **Single `run_started`.** The runner emits the authoritative, enriched `run_started` (with `model`
  and `offline`) via `enqueue`; the emit closure **suppresses** the agent's own additive
  `run_started` to avoid a duplicate frame. This keeps `run_started` off the cancel-checking path
  (per §9b) while honoring the agent-side emit from §3. No other event is filtered.
- **`?tab=` deep-link.** Added a tiny query-param to pick the initial tab — a real UX nicety and what
  enabled deterministic screenshots of each pillar. Purely additive.
- **`config.py` is a dataclass with a `get_config()` singleton** rather than module constants — lets
  the backend tests construct an isolated `Config` (temp workspace/data dirs) without env juggling.

No deviations affect the harness, the safety model, the persisted log, or the event contract.

## (f) Known limitations

- **Cancel latency.** Cooperative by design: an in-flight blocking model call (up to OllamaModel's
  120s timeout, typically 5–12s) completes before cancel takes effect at the next boundary; pending
  approvals are resolved immediately so that wait can't hang. The UI shows a "Stopping…" state.
- **Offline mode is a fixed scripted demo** (echo → read welcome.txt → write offline-demo.txt →
  final); the goal text is intentionally not interpreted, and the UI labels it as such.
- **Run streams are in-memory** (`RUNS` + per-run queue): a backend restart drops live runs, though
  the persisted session log is replayable from History afterward. A TTL sweep backstops orphaned
  finished runs.
- **`StarletteDeprecationWarning`** about the TestClient/httpx pairing is emitted by the test harness
  only; it does not affect runtime.
- Single-user assumption; no auth (localhost-only by design).
- `web/dist` must be rebuilt (`npm run build`) after frontend changes for the production
  single-command path to reflect them.

---

# Iteration 2 — targeted fixes + frontend self-audit

`harness/` was **not touched** this iteration (`git diff --stat harness/` = only the iteration-1
`loop.py` on_event change, 35 insertions). All persisted shapes, the SSE contract, the
`enqueue` (never gated) vs `emit` (raises `RunCancelled`) split, the runner suppressing the agent's
duplicate `run_started`, the dedicated `.agent-workspace/` sandbox, 127.0.0.1-only binding, and the
off-loop Ollama calls are all preserved.

## (a) Fix diffs A–D

**Fix A — model selection (drives both live runs and the assistant).**
- `server/schemas.py`: `AssistantRequest` gained `model: str | None = None`; `RunRequest` gained
  `max_iterations: int = 15` (Fix D).
- `server/app.py` `/api/assistant`: computes `model = req.model or config.default_model` and passes
  it to `stream_assistant(...)` instead of the hardcoded default.
- `web/src/lib/models.ts` (new): `bestAvailableModel(models, default, preferred)` — preferred-if-pulled
  → default-if-pulled → first available → null. Used by both views.
- `web/src/views/AgentWorkspace.tsx`: a `model:` `<select>` in the composer controls (populated from
  `health.models`, persisted to `localStorage["agent_model"]`), shown only for live runs (hidden in
  offline mode). The chosen model is sent as `RunRequest.model`. When `models` is empty and not
  offline, the Run button is disabled with a Setup/offline nudge so a live run can't fire with no model.
- `web/src/views/HelpAssistant.tsx`: computes the same best-available model, sends it as `model` in
  the assistant request, and disables the input + suggestions (with a Setup nudge) when no model is
  available (covers both "Ollama down" and "no model pulled").

**Fix B — cancel orphaned runs on SSE disconnect** (`server/runner.py`, `event_stream` finally):
before popping `RUNS`, `if not state.finished: state.cancel.set(); state.approvals.resolve_all_pending("deny")`.
On normal completion `run_agent_task` has already set `state.finished=True`, so the guard skips and
nothing is cancelled; on early disconnect the orphaned task unwinds at its next emit boundary.

**Fix C — modern lifespan** (`server/app.py`): replaced `@app.on_event("startup")` with an
`@asynccontextmanager async def lifespan(app)` passed to `FastAPI(..., lifespan=lifespan)`. Verified
the server starts with no deprecation warning in its log.

**Fix D — configurable iteration cap**: `RunRequest.max_iterations` (default 15), clamped server-side
to `max(1, min(n, 50))` in `runner.build_agent`, passed to `Agent(max_iterations=...)`.

## (b) Frontend self-audit findings & fixes

- **SSE frame buffering (`src/lib/sse.ts`) — already correct, no change.** It accumulates bytes
  with `buffer += decoder.decode(value, {stream:true})`, splits on `\n\n`, parses only complete
  frames, and carries the partial remainder to the next read. It does not assume one read = one
  frame, so split/merged/partial frames are handled. (Shared by both streams.)
- **Reader teardown — fixed.** `useRun` now aborts the previous reader at the top of `start()` and on
  unmount (`useEffect(() => () => handleRef.current?.abort(), [])`). `HelpAssistant` now stores the
  `SseHandle` in a ref, aborts any prior stream before a new `send`, and aborts on unmount.
- **Stop = cancel + deliberate teardown — confirmed.** Stop POSTs `/cancel` and keeps consuming
  until `run_finished{cancelled}` ends the stream (so the terminal event is received), showing a
  "Stopping…" state meanwhile. No dangling reader (unmount/new-run both abort).
- **Approval double-submit — fixed.** `ApprovalCard` now has a local `submitted` lock: the first
  click disables both buttons immediately (before `approval_resolved` arrives), so the same
  `approval_id` can't be POSTed twice.
- **Empty/error states — fixed/confirmed.** Models-empty nudge (Fix A); `/api/run` failure surfaces
  via `useRun.error` rendered in the transcript; the assistant error frame renders inline in the
  bubble; History now distinguishes a fetch **error** (red banner) from the **empty** state.
- **Accessibility — confirmed/hardened.** The run transcript and assistant transcript are
  `aria-live="polite"`; approval/primary actions are real `<button>`s; added a global
  `:focus-visible` outline so keyboard focus is always visible (mouse clicks stay ring-free).

## (c) Re-verification evidence

- **Tests:** `tests/test_harness.py` → **13 pass**; `tests/test_on_event.py` → **3 pass**;
  `server/tests/test_server.py` → **6 pass** (the original 5 + a new `test_disconnect_cancels_orphan`).
- **Frontend builds clean** under strict `tsc -b` + vite (`npm run build` succeeds; no TS errors).
- **Model picker end-to-end:** started a live run with the **non-default** `llama3.1:8b` explicitly
  selected (two models pulled) → `run_started.model = "llama3.1:8b"`, run completed. The help
  assistant answered correctly with `model: "llama3.1:8b"` passed in the request.
- **Disconnect no longer orphans:** `test_disconnect_cancels_orphan` starts an offline run, consumes
  the stream until it pauses on the approval card (run not finished), closes the SSE generator
  (`aclose()` → the `finally` cancel path), and asserts the background task unwinds to cancelled
  within 10s, `state.cancel` is set, the gated write never ran, and `RUNS` is cleaned up.
- **Lifespan:** server starts with no `on_event`/deprecation warning in its log.
- **Safety still holds** (through the server's `_build_registry`): `bash "rm -rf ."`,
  `bash "git status"`, and `bash "cat x | wc -l"` are each `permission_denied {required: full}` and
  never run; `write_file "../escape.txt"` and `read_file "/etc/passwd"` raise `PermissionError`
  (`is_error: true`) and touch nothing outside `.agent-workspace/` (escape file confirmed absent).
- **Offline mode** still runs end-to-end over HTTP including the approval card (approve → completed).

## (d) Confirmation

`harness/` is unchanged this iteration (the on_event change is final). **All 22 tests pass**
(13 harness + 3 on_event + 6 backend). Frontend builds clean under strict `tsc -b`.

---

# Iteration 3 — lock down core logic with tests (merge-ready)

A verification/hardening pass: added a frontend test runner and unit tests for the three pure-logic
modules whose correctness isn't visually obvious, ran a full pre-merge sweep. **No `harness/`
changes** (`git diff --stat harness/` is still only the iteration-1 `on_event` diff, 35 insertions).
**No backend changes this iteration** — the SSE contract, `enqueue`/`emit` split, sandbox, localhost
binding, and off-loop Ollama calls are untouched.

## (a) New test files (Vitest)

Added **Vitest 2.1.9** (`devDependencies`) + `"test": "vitest run"` in `web/package.json`; it reuses
the existing Vite config. `web/coverage/` and `web/.vitest/` added to `.gitignore`.

- **`web/src/lib/sse.test.ts`** (8 tests) — adversarial chunkings of the fetch `ReadableStream`
  (mocked via a pull-based stream so each test controls read boundaries exactly):
  1. one complete frame in a single read;
  2. one frame **split across two reads** → exactly one frame;
  3. two frames in a single read → both, in order;
  4. a payload whose JSON `result` contains `\n` and `}` and the substrings `stderr:`/`exit_code=`
     → parsed whole, not mis-split;
  5. a **trailing partial frame with no `\n\n`** → never emitted;
  6. `onError` fires on a non-OK HTTP response, and on a fetch/stream throw;
  7. **handle returned before drain + `abort()` stops consumption** — a gated stream that delivers
     one frame then parks forever; `await streamSse(...)` still resolves (proving the read loop runs
     in the background, not awaited inside `streamSse`), and after `abort()` no further frames arrive.
- **`web/src/agent/runModel.test.ts`** (7 tests) — the canonical backend sequences: auto-approved
  read; gated write approved (approval + tool_call fold into ONE tool block, decision `allow`, result
  present, not denied); gated write denied (no `tool_call`; renders denied/did-not-run, no success
  result); hard-block by ceiling → `blocked(permission)` carrying required `full` vs ceiling
  `workspace` (distinct from an approval card); unknown tool → `blocked(unknown)`; iteration +
  compaction markers preserved in order; plus a two-tools-in-sequence pairing test.
- **`web/src/lib/format.test.ts`** (9 tests) — `parseBashResult` on the real
  `exit_code=…\nstdout: …\nstderr: …` format: multiline stdout preserved verbatim; inline
  `stderr:`/`exit_code=` substrings don't mis-split (anchored `^exit_code=` + `\nstderr: ` marker);
  non-zero exit with multiline stderr; malformed input degrades to nulls. `parseGrep`: grouping by
  file with `{line,text}`, colon-in-text preserved, `(no matches)` and empty → empty map.

## (b) Did any module need a fix?

**No.** All three were already correct; the 24 tests pass against them unchanged.
- **`sse.ts` — check (a) buffering across reads:** PASS. It decodes incrementally
  (`TextDecoder.decode(value,{stream:true})`), accumulates into `buffer`, splits only on the `\n\n`
  delimiter, parses complete frames, and carries the remainder forward (tests 2, 4, 5).
- **`sse.ts` — check (b) handle returned before drain:** PASS. The read loop runs in a non-awaited
  background IIFE and `streamSse` returns the `SseHandle` synchronously, so `handleRef.current?.abort()`
  in `useRun`/`HelpAssistant` interrupts an in-flight stream (test 7). This is the property the
  iteration-2 disconnect/teardown fixes rely on.
- **`runModel.ts`:** PASS. Approved-vs-denied pairing and hard-block-vs-approval distinction are
  exactly what `RunBlocks` needs.
- **`format.ts`:** PASS on the multiline and marker-collision cases.

(The only edits to test files: switched `global.fetch` → `globalThis.fetch` so the strict `tsc -b`
build — which type-checks `src/**` including tests — passes without `@types/node`.)

## (c) Optional polish (done, low-risk)

- **Auto-scroll on in-place updates** (`AgentWorkspace`): the scroll effect now also depends on a
  `tailSig` derived from the last block's `result`/`text` length and `decision`, so the view stays
  pinned while a long `tool_result` or the final answer fills an **existing** block (not only when a
  new block is appended), as long as the user is at the bottom.
- **Replay error state** (`History`): a failed `getSession` now shows a red error message instead of
  an empty replay, matching the list's error handling.

## (d) Final green results

- `python tests/test_harness.py` → **13 pass**; `python tests/test_on_event.py` → **3 pass**;
  `server/tests/test_server.py` → **6 pass**.
- `cd web && npm run build` → **clean** strict `tsc -b` + vite; `npm test` → **24 pass** (3 files).
- **Safety re-check** (through `server.runner._build_registry`): `bash "rm -rf ."`, `bash "git status"`,
  `bash "cat x | wc -l"` each `permission_denied{required: full}` and never run; `write_file
  "../escape.txt"` and `read_file "/etc/passwd"` raise `PermissionError` (`is_error: true`); nothing
  written outside `.agent-workspace/`.
- `harness/` untouched (only the iteration-1 `on_event` diff).

**Note:** `npm audit` reports advisories in the dev toolchain only (vite/esbuild/vitest); none ship
in the static `dist/` bundle, and `audit fix --force` would upgrade Vite to v7 (breaking). Left as-is
for this localhost dev tool.
