#end-to-end tests for the harness that run WITHOUT a live LLM (we use StubModel)
#run from the build/ directory with:   python -m pytest tests/ -q
#or without pytest:                     python tests/test_harness.py

import sys
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BUILD_DIR))

from harness import (
    Agent,
    StubModel,
    ToolRegistry,
    ContextManager,
    Permission,
    Hooks,
    HookContext,
    HookDecision,
    Session,
    classify_bash,
    can_dispatch,
    assemble_system_prompt,
    builtins,
)
from harness.model import _extract_json, _normalize


def _registry():
    reg = ToolRegistry()
    reg.register("read_file", Permission.READ_ONLY, builtins.read_file, "read a file")
    reg.register("write_file", Permission.WORKSPACE, builtins.write_file, "write a file")
    reg.register("bash", Permission.WORKSPACE, builtins.bash, "run a command")
    return reg


def test_permissions_classify_and_rank():
    assert classify_bash("ls -la") == Permission.READ_ONLY
    assert classify_bash("rm -rf /") == Permission.FULL
    assert classify_bash("python foo.py") == Permission.WORKSPACE
    assert classify_bash("") == Permission.READ_ONLY
    assert can_dispatch(Permission.READ_ONLY, Permission.WORKSPACE) is True
    assert can_dispatch(Permission.FULL, Permission.WORKSPACE) is False


def test_classifier_blocks_chaining_and_hidden_danger():
    #the old first-token classifier rated these READ_ONLY; they must now be FULL (i.e. denied)
    assert classify_bash("ls; rm -rf ~") == Permission.FULL
    assert classify_bash("echo hi && rm file") == Permission.FULL
    assert classify_bash("cat x | sh") == Permission.FULL
    assert classify_bash("echo $(rm -rf /)") == Permission.FULL
    assert classify_bash("cat secrets > /tmp/x") == Permission.FULL
    assert classify_bash("/bin/rm file") == Permission.FULL      # path-qualified danger cmd
    assert classify_bash("ls 'unbalanced") == Permission.FULL    # unparseable -> safe default


def test_workspace_tools_block_escape(tmp_path):
    root = tmp_path / "ws"
    root.mkdir()
    (root / "inside.txt").write_text("ok")
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")

    wt = builtins.WorkspaceTools(root)
    assert wt.read_file("inside.txt") == "ok"                    # inside is fine
    for bad in [str(secret), "../secret.txt", "/etc/passwd"]:
        try:
            wt.read_file(bad)
            assert False, f"expected PermissionError for {bad}"
        except PermissionError:
            pass
    # writing outside is also refused
    try:
        wt.write_file("../escape.txt", "x")
        assert False, "expected PermissionError on write escape"
    except PermissionError:
        pass
    assert not (tmp_path / "escape.txt").exists()


def test_tool_registry_descriptors_hide_handler():
    reg = _registry()
    descs = reg.descriptors()
    names = {d["name"] for d in descs}
    assert {"read_file", "write_file", "bash"} <= names
    assert all("handler" not in d for d in descs)  # never leak callables to the model


def test_context_compaction():
    cm = ContextManager(compact_threshold=5, keep_recent=2)
    msgs = [{"role": "user", "content": f"m{i}"} for i in range(10)]
    out = cm.compact_if_needed(msgs)
    assert len(out) == 3  # 1 summary + 2 recent
    assert out[0]["content"].startswith("[summary of")
    assert out[-1]["content"] == "m9"


def test_session_persistence_roundtrip(tmp_path):
    path = tmp_path / "s.jsonl"
    s = Session(path)
    s.append({"type": "goal", "content": "hi"})
    s.append({"type": "final", "content": "bye"})
    replayed = Session(path).replay()
    assert [e["content"] for e in replayed] == ["hi", "bye"]


def test_prompt_assembly_includes_scaffold_and_instructions(tmp_path):
    (tmp_path / "CLAUDE.md").write_text("PROJECT RULE: be terse")
    prompt = assemble_system_prompt(tmp_path)
    assert "helpful coding agent" in prompt
    assert "PROJECT RULE: be terse" in prompt


def test_agent_runs_tool_then_finishes(tmp_path):
    target = tmp_path / "hello.txt"
    model = StubModel([
        {"stop_reason": "tool_call", "text": "",
         "tool_call": {"name": "write_file", "args": {"path": str(target), "content": "hi there"}}},
        {"stop_reason": "end_turn", "text": "wrote the file", "tool_call": None},
    ])
    agent = Agent(cwd=tmp_path, model=model, tools=_registry(), permission=Permission.WORKSPACE)
    result = agent.run("create hello.txt")
    assert result == "wrote the file"
    assert target.read_text() == "hi there"


def test_agent_denies_tool_over_permission_ceiling(tmp_path):
    #agent only has READ_ONLY, so a write_file call must be blocked, not executed
    target = tmp_path / "blocked.txt"
    model = StubModel([
        {"stop_reason": "tool_call", "text": "",
         "tool_call": {"name": "write_file", "args": {"path": str(target), "content": "nope"}}},
        {"stop_reason": "end_turn", "text": "could not write", "tool_call": None},
    ])
    agent = Agent(cwd=tmp_path, model=model, tools=_registry(), permission=Permission.READ_ONLY)
    agent.run("try to write")
    assert not target.exists()


def test_pre_hook_can_deny(tmp_path):
    target = tmp_path / "hooked.txt"
    hooks = Hooks()
    hooks.add_pre(lambda ctx: HookDecision.DENY if ctx.tool_name == "write_file" else HookDecision.ALLOW)
    model = StubModel([
        {"stop_reason": "tool_call", "text": "",
         "tool_call": {"name": "write_file", "args": {"path": str(target), "content": "x"}}},
        {"stop_reason": "end_turn", "text": "blocked by hook", "tool_call": None},
    ])
    agent = Agent(cwd=tmp_path, model=model, tools=_registry(), hooks=hooks, permission=Permission.WORKSPACE)
    agent.run("write but hook denies")
    assert not target.exists()


def test_extract_json_tolerates_single_quotes_and_fences():
    #strict JSON
    assert _extract_json('{"action": "final", "text": "hi"}')["text"] == "hi"
    #python-style single quotes (common from local models)
    assert _extract_json("{'action': 'final', 'text': 'hi'}")["text"] == "hi"
    #wrapped in a ```json fence with surrounding prose
    assert _extract_json('sure!\n```json\n{"action": "final", "text": "hi"}\n```')["text"] == "hi"
    #NESTED args inside a fence must not be truncated at the first '}'
    nested = _extract_json('```json\n{"action": "tool", "tool": "write_file", "args": {"path": "x", "content": "y"}}\n```')
    assert nested["tool"] == "write_file" and nested["args"]["content"] == "y"
    #prose containing unrelated braces before the real object -> skip to the parseable one
    assert _extract_json('use {curly} braces, then {"action": "final", "text": "ok"}')["text"] == "ok"
    #no json at all
    assert _extract_json("just some prose") is None


def test_normalize_accepts_protocol_variants():
    names = {"grep", "write_file"}
    spec = _normalize({"action": "tool", "tool": "grep", "args": {"pattern": "x"}}, "", names)
    assert spec["stop_reason"] == "tool_call" and spec["tool_call"]["name"] == "grep"
    #tool name living in the 'action' slot
    variant = _normalize({"action": "write_file", "args": {"path": "p", "content": "c"}}, "", names)
    assert variant["tool_call"]["name"] == "write_file"
    #no 'action', just 'name'
    named = _normalize({"name": "grep", "args": {}}, "", names)
    assert named["tool_call"]["name"] == "grep"
    #final variants
    assert _normalize({"action": "final", "text": "bye"}, "", names)["stop_reason"] == "end_turn"
    assert _normalize({"action": "done", "answer": "bye"}, "", names)["text"] == "bye"
    #unparseable -> falls back to raw text as a final answer (never hangs)
    assert _normalize(None, "raw answer", names) == {"stop_reason": "end_turn", "text": "raw answer", "tool_call": None}


def test_unknown_tool_is_handled_gracefully(tmp_path):
    model = StubModel([
        {"stop_reason": "tool_call", "text": "", "tool_call": {"name": "does_not_exist", "args": {}}},
        {"stop_reason": "end_turn", "text": "recovered", "tool_call": None},
    ])
    agent = Agent(cwd=tmp_path, model=model, tools=_registry(), permission=Permission.WORKSPACE)
    assert agent.run("call a bad tool") == "recovered"


if __name__ == "__main__":
    import tempfile, traceback

    passed = failed = 0
    for fname, fn in sorted(globals().items()):
        if not fname.startswith("test_") or not callable(fn):
            continue
        try:
            if "tmp_path" in fn.__code__.co_varnames[: fn.__code__.co_argcount]:
                with tempfile.TemporaryDirectory() as d:
                    fn(Path(d))
            else:
                fn()
            print(f"PASS {fname}")
            passed += 1
        except Exception:
            print(f"FAIL {fname}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
