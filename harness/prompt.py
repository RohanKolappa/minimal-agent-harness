#walk (checking for md files --> in this case,INSTRUCTIONS_FILES) + stitch (taking the raw text found during the walk and piecing it together into a single, cohesive string)
#this code assembles the system prompt for the agent
#order matters here:static scaffold first, load dynamic content after (for example, markdown files)
    #otherwise you will break the prefix caching

from pathlib import Path
from typing import Generator

STATIC_SCAFFOLD = """\
You are a helpful coding agent. Follow instructions carefully, use available tools, and be concise.
"""

INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", ".cursorrules"]

def _walk_ancestors(path: Path) -> Generator[Path, None, None]:
    current = path if path.is_dir() else path.parent
    while True:
        yield current
        if current.parent == current:  # filesystem root
            break
        current = current.parent

def assemble_system_prompt( 
    cwd: Path | str,
    max_per_file: int = 4000,
    max_total: int = 12000,
) -> str:
    parts: list[str] = [STATIC_SCAFFOLD]
    total_dynamic = 0
    for directory in _walk_ancestors(Path(cwd)):
        for fname in INSTRUCTION_FILES:
            f = directory / fname
            if not f.exists():
                continue
            text = f.read_text()[:max_per_file]
            remaining = max_total - total_dynamic
            text = text[:remaining]
            parts.append(f"\n # {fname} (from {directory})\n{text}")
            total_dynamic += len(text)
    return "\n".join(parts)
