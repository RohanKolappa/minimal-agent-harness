#tests for the one sanctioned additive harness change: Agent.on_event (§3).
#proves (a) with on_event=None the persisted session log is unchanged, and (b) a capturing
#on_event yields the expected ordered emit stream, including a tool_result that is NOT truncated.
#run standalone:   python tests/test_on_event.py    (or via pytest)

import sys
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BUILD_DIR))

from harness import Agent, StubModel, ToolRegistry, Permission, Session, builtins


def _registry():
    reg = ToolRegistry()
    reg.register("read_file", Permission.READ_ONLY, builtins.read_file, "read a file")
    reg.register("write_file", Permission.WORKSPACE, builtins.write_file, "write a file")
    return reg


def _script(target: Path, content: str):
    return [
        {"stop_reason": "tool_call", "text": "",
         "tool_call": {"name": "write_file", "args": {"path": str(target), "content": content}}},
        {"stop_reason": "end_turn", "text": "all done", "tool_call": None},
    ]


def test_on_event_none_leaves_persisted_log_unchanged(tmp_path):
    target = tmp_path / "out.txt"
    path = tmp_path / "s.jsonl"
    agent = Agent(
        cwd=tmp_path,
        model=StubModel(_script(target, "hello")),
        tools=_registry(),
        session=Session(path),
        permission=Permission.WORKSPACE,
        on_event=None,
    )
    agent.run("write out.txt")

    events = Session(path).replay()
    types = [e["type"] for e in events]
    #exactly the five persisted shapes, in order, unchanged by the additive emit code
    assert types == ["goal", "tool_call", "tool_result", "final"]
    assert events[0] == {"type": "goal", "content": "write out.txt"}
    assert events[1] == {"type": "tool_call", "tool": "write_file",
                         "args": {"path": str(target), "content": "hello"}}
    assert events[2]["type"] == "tool_result" and events[2]["tool"] == "write_file"
    assert "is_error" not in events[2]            # persisted shape never grew the emit-only fields
    assert "required_permission" not in events[1]
    assert events[3] == {"type": "final", "content": "all done"}


def test_capturing_on_event_yields_ordered_untruncated_stream(tmp_path):
    #read_file returns the file's full text, so its tool_result is a good non-truncation probe
    big = "X" * 2000  # far larger than the 500-char session truncation
    target = tmp_path / "big.txt"
    target.write_text(big)
    captured: list[dict] = []
    agent = Agent(
        cwd=tmp_path,
        model=StubModel([
            {"stop_reason": "tool_call", "text": "",
             "tool_call": {"name": "read_file", "args": {"path": str(target)}}},
            {"stop_reason": "end_turn", "text": "all done", "tool_call": None},
        ]),
        tools=_registry(),
        permission=Permission.WORKSPACE,
        on_event=captured.append,
    )
    agent.run("read a big file")

    types = [e["type"] for e in captured]
    assert types == [
        "run_started",
        "iteration",
        "model_response",
        "tool_call",
        "tool_result",
        "iteration",
        "model_response",
        "final",
    ]

    run_started = captured[0]
    assert run_started["goal"] == "read a big file"
    assert run_started["workspace"] == str(tmp_path)
    assert run_started["permission"] == Permission.WORKSPACE

    tool_call = captured[3]
    assert tool_call["tool"] == "read_file"
    assert tool_call["required_permission"] == Permission.READ_ONLY

    tool_result = captured[4]
    assert tool_result["is_error"] is False
    #the emit stream carries the FULL result; only the persisted log truncates to 500 chars
    assert tool_result["result"] == big
    assert len(tool_result["result"]) > 500

    assert captured[-1] == {"type": "final", "text": "all done"}


def test_emit_surfaces_permission_denied(tmp_path):
    target = tmp_path / "blocked.txt"
    captured: list[dict] = []
    agent = Agent(
        cwd=tmp_path,
        model=StubModel(_script(target, "nope")),
        tools=_registry(),
        permission=Permission.READ_ONLY,  # write_file exceeds the ceiling
        on_event=captured.append,
    )
    agent.run("try to write")

    denied = [e for e in captured if e["type"] == "permission_denied"]
    assert len(denied) == 1
    assert denied[0] == {"type": "permission_denied", "tool": "write_file",
                         "required": Permission.WORKSPACE, "ceiling": Permission.READ_ONLY}
    assert not any(e["type"] == "tool_result" for e in captured)  # tool never ran
    assert not target.exists()


if __name__ == "__main__":
    import tempfile, traceback

    passed = failed = 0
    for fname, fn in sorted(globals().items()):
        if not fname.startswith("test_") or not callable(fn):
            continue
        try:
            with tempfile.TemporaryDirectory() as d:
                fn(Path(d))
            print(f"PASS {fname}")
            passed += 1
        except Exception:
            print(f"FAIL {fname}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
