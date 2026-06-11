#central configuration. One ollama_host is shared by the agent runs, the health probe, and the
#help assistant so they never disagree about where Ollama lives.

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Config:
    #matches OllamaModel's default host so the agent and the UI probe the same endpoint
    ollama_host: str = field(default_factory=lambda: os.environ.get("OLLAMA_HOST", "http://localhost:11434"))
    default_model: str = field(default_factory=lambda: os.environ.get("AGENT_UI_MODEL", "qwen2.5-coder:7b"))
    recommended_model: str = "qwen2.5-coder:7b"

    #a dedicated, gitignored sandbox — NOT the repo root. The agent's cwd is set equal to this.
    workspace_root: Path = field(default_factory=lambda: REPO_ROOT / ".agent-workspace")
    data_dir: Path = field(default_factory=lambda: REPO_ROOT / ".agent-data")

    #locked CORS origins for separate-process Vite dev. Prod serves built assets same-origin (no CORS).
    dev_origins: list[str] = field(default_factory=lambda: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ])

    host: str = "127.0.0.1"
    port: int = 8765

    @property
    def sessions_dir(self) -> Path:
        return self.data_dir / "sessions"

    @property
    def web_dist(self) -> Path:
        return REPO_ROOT / "web" / "dist"


_WELCOME = """\
Welcome to the Minimal Agent Harness workspace.

This is the agent's sandbox. Every file tool (read_file, write_file, edit_file, grep)
is confined to this directory — paths that resolve outside it raise a PermissionError.
bash runs here too, and is classified per-command: a plain `ls` or `cat` is read-only,
while anything with a pipe, redirect, or a command like `rm`/`git` is forced to `full`
and therefore blocked under the default `workspace` ceiling.

Try asking the agent to read this file, grep it, or create a new file beside it.
"""


def ensure_workspace(root: Path) -> Path:
    #create the sandbox and seed a welcome file so read/grep demos always have content.
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    welcome = root / "welcome.txt"
    if not welcome.exists():
        welcome.write_text(_WELCOME)
    return root


_config: Config | None = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config()
    return _config
