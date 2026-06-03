#runnable entry point for the harness, driven by a local Ollama model (free, no API key)
#
#prerequisites (one time):
#   brew install --cask ollama-app   # the plain 'ollama' formula lacks the inference backend
#   open -a Ollama                   # starts the local server (or run 'ollama serve')
#   ollama pull qwen2.5-coder:7b
#
#then:
#   python demo/run_demo.py "list the python files in the harness package"
#
#pass --offline to run a scripted StubModel instead (no Ollama needed) so you can see the loop work.

import os
import sys
from pathlib import Path

#make the package importable whether you run this from build/ or build/demo/
BUILD_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BUILD_DIR))

from harness import (  # noqa: E402
    Agent,
    OllamaModel,
    StubModel,
    ToolRegistry,
    Session,
    Permission,
    builtins,
)


def build_registry(root) -> ToolRegistry:
    #use the sandboxed tools so file ops are confined to `root` (no reading ~/.ssh, writing /etc, etc.)
    wt = builtins.WorkspaceTools(root)
    reg = ToolRegistry()
    reg.register("read_file", Permission.READ_ONLY, wt.read_file, "Read a file's text. args: path")
    reg.register("grep", Permission.READ_ONLY, wt.grep, "Search files for a regex. args: pattern, path")
    reg.register("write_file", Permission.WORKSPACE, wt.write_file, "Write text to a file. args: path, content")
    reg.register("edit_file", Permission.WORKSPACE, wt.edit_file, "Replace unique text in a file. args: path, find, replace")
    reg.register("bash", Permission.WORKSPACE, wt.bash, "Run a shell command. args: cmd")
    return reg


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--offline"]
    offline = "--offline" in sys.argv
    goal = args[0] if args else "Say hello and then finish."

    registry = build_registry(BUILD_DIR)
    session = Session(BUILD_DIR / "demo" / ".session.jsonl")

    if offline:
        #scripted run: read this file via the read_file tool, then finish - proves the loop end-to-end
        model = StubModel([
            {"stop_reason": "tool_call", "text": "",
             "tool_call": {"name": "grep", "args": {"pattern": "def ", "path": str(BUILD_DIR / "harness" / "loop.py")}}},
            {"stop_reason": "end_turn", "text": "Done - found the function definitions in loop.py.", "tool_call": None},
        ])
    else:
        #defaults to a model you already have; override with OLLAMA_MODEL=... (e.g. qwen2.5-coder:7b for stronger coding)
        model = OllamaModel(model=os.environ.get("OLLAMA_MODEL", "llama3.1:8b"))

    agent = Agent(
        cwd=BUILD_DIR,
        model=model,
        tools=registry,
        session=session,
        permission=Permission.WORKSPACE,
        max_iterations=15,
    )

    print(f"GOAL: {goal}\n{'-' * 60}")
    answer = agent.run(goal)
    print(f"{'-' * 60}\nRESULT:\n{answer}")
    print(f"\n(session log: {session.path})")


if __name__ == "__main__":
    main()
