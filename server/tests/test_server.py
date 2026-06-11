#backend tests (§4.7). No live Ollama required: every run uses the offline StubModel script.
#runnable standalone:   .venv/bin/python server/tests/test_server.py   (or via pytest)

import asyncio
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

from server import runner
from server.config import Config
from server.schemas import ApprovalPolicy, RunRequest


def _config(tmp: Path) -> Config:
    cfg = Config()
    cfg.workspace_root = tmp / "ws"
    cfg.data_dir = tmp / "data"
    return cfg


async def _drain(state, decision=None, cancel_on_approval=False, timeout=15.0):
    #consume the SSE source queue to the terminal event, optionally resolving/cancelling approvals.
    events = []
    while True:
        ev = await asyncio.wait_for(state.queue.get(), timeout)
        events.append(ev)
        if ev["type"] == "approval_request":
            if cancel_on_approval:
                runner.cancel_run(state.run_id)
            elif decision is not None:
                runner.approve(state.run_id, ev["approval_id"], decision)
        if ev["type"] == "run_finished":
            break
    return events


async def _offline_completed():
    with tempfile.TemporaryDirectory() as d:
        cfg = _config(Path(d))
        req = RunRequest(offline=True, workspace_root=str(cfg.workspace_root),
                         approval_policy=ApprovalPolicy(auto_approve_all=True))
        state = runner.start_run(req, cfg)
        events = await _drain(state)
    types = [e["type"] for e in events]
    assert types[0] == "run_started", types
    assert types[-1] == "run_finished", types
    assert events[-1]["reason"] == "completed", events[-1]
    assert "final" in types
    #ordered shape: run_started precedes the first iteration, final precedes run_finished
    assert types.index("run_started") < types.index("iteration") < types.index("final")
    #auto_approve_all -> no approval cards at all
    assert "approval_request" not in types
    print("PASS offline_completed")


async def _approval_allow():
    with tempfile.TemporaryDirectory() as d:
        cfg = _config(Path(d))
        req = RunRequest(offline=True, workspace_root=str(cfg.workspace_root))  # default policy
        state = runner.start_run(req, cfg)
        events = await _drain(state, decision="allow")
        out = cfg.workspace_root / "offline-demo.txt"
        assert out.exists(), "approved write must apply inside the sandbox"
    types = [e["type"] for e in events]
    assert "approval_request" in types and "approval_resolved" in types
    resolved = [e for e in events if e["type"] == "approval_resolved"][0]
    assert resolved["decision"] == "allow"
    write_results = [e for e in events if e["type"] == "tool_result" and e["tool"] == "write_file"]
    assert write_results and write_results[0]["is_error"] is False
    assert events[-1]["reason"] == "completed"
    print("PASS approval_allow")


async def _approval_deny():
    with tempfile.TemporaryDirectory() as d:
        cfg = _config(Path(d))
        req = RunRequest(offline=True, workspace_root=str(cfg.workspace_root))
        state = runner.start_run(req, cfg)
        events = await _drain(state, decision="deny")
        out = cfg.workspace_root / "offline-demo.txt"
        assert not out.exists(), "denied write must NOT touch the sandbox"
    types = [e["type"] for e in events]
    assert "hook_denied" in types, "deny should surface as a hook_denied event"
    #the write tool never ran -> no successful write_file tool_result
    assert not any(e["type"] == "tool_result" and e["tool"] == "write_file" and not e["is_error"]
                   for e in events)
    assert events[-1]["reason"] == "completed"
    print("PASS approval_deny")


async def _cancel_during_approval():
    with tempfile.TemporaryDirectory() as d:
        cfg = _config(Path(d))
        req = RunRequest(offline=True, workspace_root=str(cfg.workspace_root))
        state = runner.start_run(req, cfg)
        events = await _drain(state, cancel_on_approval=True)
        out = cfg.workspace_root / "offline-demo.txt"
        assert not out.exists()
    types = [e["type"] for e in events]
    assert "approval_request" in types
    assert events[-1]["type"] == "run_finished" and events[-1]["reason"] == "cancelled", events[-1]
    print("PASS cancel_during_approval")


async def _disconnect_cancels_orphan():
    # Fix B: if the SSE client disconnects before run_finished, the background run must be
    # cancelled (not driven to completion invisibly).
    with tempfile.TemporaryDirectory() as d:
        cfg = _config(Path(d))
        req = RunRequest(offline=True, workspace_root=str(cfg.workspace_root))  # pauses at write approval
        state = runner.start_run(req, cfg)
        gen = runner.event_stream(state)
        saw_approval = False
        async for frame in gen:  # consume until the run is paused on the approval card
            if '"approval_request"' in frame:
                saw_approval = True
                break
        assert saw_approval
        assert not state.finished, "run should still be in-flight at the approval"
        await gen.aclose()  # simulate the browser tab closing mid-run
        await asyncio.wait_for(state.task, timeout=10)  # orphan must unwind promptly
        assert state.cancel.is_set()
        assert state.finished
        assert not (cfg.workspace_root / "offline-demo.txt").exists()  # gated write never ran
        assert runner.RUNS.get(state.run_id) is None  # cleaned up
    print("PASS disconnect_cancels_orphan")


def _health_unreachable():
    #health must return promptly with ollama_running:false when Ollama is down.
    from fastapi.testclient import TestClient
    from server import app as app_mod

    saved = app_mod.config.ollama_host
    app_mod.config.ollama_host = "http://127.0.0.1:1"  # nothing listens here
    try:
        client = TestClient(app_mod.app)
        import time
        t0 = time.time()
        resp = client.get("/api/health")
        elapsed = time.time() - t0
        body = resp.json()
        assert resp.status_code == 200
        assert body["ollama_running"] is False, body
        assert body["offline_available"] is True
        assert elapsed < 5.0, f"health took too long: {elapsed:.1f}s"
    finally:
        app_mod.config.ollama_host = saved
    print("PASS health_unreachable")


def main() -> int:
    failed = 0
    for coro in (_offline_completed, _approval_allow, _approval_deny, _cancel_during_approval,
                 _disconnect_cancels_orphan):
        try:
            asyncio.run(coro())
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"FAIL {coro.__name__}: {e}")
            failed += 1
    try:
        _health_unreachable()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"FAIL _health_unreachable: {e}")
        failed += 1
    print(f"\n{'all backend tests passed' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


#pytest entry points
def test_offline_completed():
    asyncio.run(_offline_completed())


def test_approval_allow():
    asyncio.run(_approval_allow())


def test_approval_deny():
    asyncio.run(_approval_deny())


def test_cancel_during_approval():
    asyncio.run(_cancel_during_approval())


def test_disconnect_cancels_orphan():
    asyncio.run(_disconnect_cancels_orphan())


def test_health_unreachable():
    _health_unreachable()


if __name__ == "__main__":
    sys.exit(main())
