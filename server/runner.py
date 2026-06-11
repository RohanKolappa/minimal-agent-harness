#per-run orchestration: a buffered event queue, the worker that drives agent.run off the loop,
#cooperative cancellation, and the SSE stream generator.
#
#Two distinct delivery paths — do NOT conflate them:
#  enqueue(): the transport. Stamps run_id/ts and hands the event to the loop thread-safely.
#             NEVER gated by cancel. The runner uses it for run_started and run_finished so a
#             cancelled run can still emit its terminal frame.
#  emit():    enqueue() unless cancel is set, in which case it RAISES RunCancelled. This is the
#             closure given to Agent(on_event=...) and the approval hook; raising is how a
#             cancelled run unwinds at the next iteration/tool boundary.

import asyncio
import json
import threading
import time
from pathlib import Path
from uuid import uuid4

from harness import Agent, OllamaModel, Permission, StubModel, ToolRegistry, builtins

from .approvals import ApprovalPolicy, ApprovalRegistry, make_approval_hook
from .config import Config, ensure_workspace
from .sessions import make_session


class RunCancelled(Exception):
    """Raised inside the emit closure to cooperatively stop a run at a safe boundary."""


class RunState:
    def __init__(self, run_id: str, loop: asyncio.AbstractEventLoop, goal: str) -> None:
        self.run_id = run_id
        self.loop = loop
        self.goal = goal
        self.queue: asyncio.Queue = asyncio.Queue()  # unbounded -> put_nowait never raises
        self.cancel = threading.Event()
        self.approvals = ApprovalRegistry()
        self.task: asyncio.Task | None = None
        self.finished = False
        self.created = time.time()


RUNS: dict[str, RunState] = {}


def _build_registry(root: Path) -> ToolRegistry:
    #mirrors run_demo.build_registry: the five sandboxed tools at the same permission levels.
    wt = builtins.WorkspaceTools(root)
    reg = ToolRegistry()
    reg.register("read_file", Permission.READ_ONLY, wt.read_file, "Read a file's text. args: path")
    reg.register("grep", Permission.READ_ONLY, wt.grep, "Search files for a regex. args: pattern, path")
    reg.register("write_file", Permission.WORKSPACE, wt.write_file, "Write text to a file. args: path, content")
    reg.register("edit_file", Permission.WORKSPACE, wt.edit_file, "Replace unique text in a file. args: path, find, replace")
    reg.register("bash", Permission.WORKSPACE, wt.bash, "Run a shell command. args: cmd")
    return reg


def _offline_script(root: Path) -> list[dict]:
    #a fixed, scripted StubModel run using REAL workspace paths so it can't reference missing files.
    #Sequence: a read-classified bash echo (auto-approved), read_file welcome.txt (auto-approved),
    #then a write_file (needs approval under the default policy) and a final answer. Under
    #auto_approve_all it runs straight to completion; under the default policy it raises the
    #approval card for the write and completes once approved.
    demo_out = str(Path(root) / "offline-demo.txt")
    return [
        {"stop_reason": "tool_call", "text": "",
         "tool_call": {"name": "bash", "args": {"cmd": "echo hello from offline mode"}}},
        {"stop_reason": "tool_call", "text": "",
         "tool_call": {"name": "read_file", "args": {"path": "welcome.txt"}}},
        {"stop_reason": "tool_call", "text": "",
         "tool_call": {"name": "write_file",
                       "args": {"path": demo_out, "content": "Created by the offline scripted demo.\n"}}},
        {"stop_reason": "end_turn",
         "text": "Offline demo complete: I echoed a message, read welcome.txt, and (on approval) "
                 "wrote offline-demo.txt — all inside the sandbox. This was a scripted run; the "
                 "goal text was not interpreted.",
         "tool_call": None},
    ]


def enqueue(state: RunState, event: dict) -> None:
    #transport only — thread-safe from both the worker thread and the loop. Never checks cancel.
    event = {**event, "run_id": state.run_id, "ts": time.time()}
    state.loop.call_soon_threadsafe(state.queue.put_nowait, event)


def _make_emit(state: RunState):
    def emit(event: dict) -> None:
        #the runner sends the authoritative, enriched run_started via enqueue; suppress the
        #agent's duplicate here (and keep run_started off the cancel-checking path).
        if event.get("type") == "run_started":
            return
        if state.cancel.is_set():
            raise RunCancelled()
        enqueue(state, event)

    return emit


def build_agent(state: RunState, req, config: Config):
    #resolve the sandbox, build tools/hooks/model, and wire the emit closure into the Agent.
    root = ensure_workspace(Path(req.workspace_root) if req.workspace_root else config.workspace_root)
    emit = _make_emit(state)

    policy = ApprovalPolicy(
        auto_approve_reads=req.approval_policy.auto_approve_reads,
        require_approval_for_writes=req.approval_policy.require_approval_for_writes,
        auto_approve_all=req.approval_policy.auto_approve_all,
    )
    from harness import Hooks
    hooks = Hooks()
    hooks.add_pre(make_approval_hook(emit, state.approvals, policy))

    if req.offline:
        model = StubModel(_offline_script(root))
    else:
        model = OllamaModel(model=req.model or config.default_model, host=config.ollama_host)

    session = make_session(config.sessions_dir, state.run_id)
    agent = Agent(
        cwd=root,
        model=model,
        tools=_build_registry(root),
        hooks=hooks,
        session=session,
        permission=req.permission,
        max_iterations=max(1, min(int(getattr(req, "max_iterations", 15) or 15), 50)),
        on_event=emit,
    )
    return agent, root


async def run_agent_task(state: RunState, agent: Agent, goal: str) -> None:
    #the executor. Runs the blocking agent off-loop and guarantees exactly ONE terminal event.
    reason, err = "completed", None
    try:
        result = await asyncio.to_thread(agent.run, goal)
        if result == f"(stopped after {agent.max_iterations} iterations)":
            reason = "max_iterations"
    except RunCancelled:
        reason = "cancelled"
    except Exception as e:  # e.g. Ollama down -> RuntimeError; surface it to the UI
        reason, err = "error", str(e)
    finally:
        state.finished = True
        enqueue(state, {"type": "run_finished", "reason": reason, **({"error": err} if err else {})})


def start_run(req, config: Config) -> RunState:
    loop = asyncio.get_running_loop()
    run_id = uuid4().hex
    state = RunState(run_id, loop, goal=req.goal)
    RUNS[run_id] = state

    agent, root = build_agent(state, req, config)

    #authoritative run_started (enriched with model + offline), sent via enqueue (not emit).
    enqueue(state, {
        "type": "run_started",
        "goal": req.goal,
        "workspace": str(root),
        "model": "(offline stub)" if req.offline else (req.model or config.default_model),
        "permission": req.permission,
        "offline": req.offline,
    })

    state.task = asyncio.create_task(run_agent_task(state, agent, req.goal))
    return state


def cancel_run(run_id: str) -> bool:
    state = RUNS.get(run_id)
    if state is None or state.finished:
        return False
    state.cancel.set()
    #unblock any worker stuck waiting on an approval so the next emit raises RunCancelled promptly.
    state.approvals.resolve_all_pending("deny")
    return True


def approve(run_id: str, approval_id: str, decision: str) -> bool:
    state = RUNS.get(run_id)
    if state is None:
        return False
    return state.approvals.resolve(approval_id, decision)


async def event_stream(state: RunState):
    #SSE generator over the run's buffered queue. Events produced before the client connected are
    #buffered (not lost). Terminates after forwarding run_finished, then cleans up the RUNS entry.
    try:
        while True:
            event = await state.queue.get()
            yield f"data: {json.dumps(event, default=str)}\n\n"
            if event.get("type") == "run_finished":
                break
    finally:
        # If the client disconnected before the run finished (GeneratorExit lands here), the
        # background task is still running and can no longer be cancelled via /cancel once we drop
        # RUNS — so cancel it now: set the flag and unblock any pending approval so it unwinds at
        # the next emit boundary instead of driving the model to completion invisibly. On normal
        # completion run_agent_task has already set state.finished=True, so this guard skips.
        if not state.finished:
            state.cancel.set()
            state.approvals.resolve_all_pending("deny")
        RUNS.pop(state.run_id, None)


def sweep_finished(ttl_seconds: float = 1800.0) -> None:
    #backstop: drop finished runs whose streams were never consumed.
    now = time.time()
    for run_id in list(RUNS):
        state = RUNS.get(run_id)
        if state and state.finished and (now - state.created) > ttl_seconds:
            RUNS.pop(run_id, None)
