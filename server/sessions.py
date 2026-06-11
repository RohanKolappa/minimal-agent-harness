#per-run session files (reusing harness.Session) plus listing/replay for the History view.

from pathlib import Path

from harness import Session


def session_path(sessions_dir: Path, run_id: str) -> Path:
    return Path(sessions_dir) / f"{run_id}.jsonl"


def make_session(sessions_dir: Path, run_id: str) -> Session:
    return Session(session_path(sessions_dir, run_id))


def list_sessions(sessions_dir: Path) -> list[dict]:
    sessions_dir = Path(sessions_dir)
    if not sessions_dir.exists():
        return []
    out: list[dict] = []
    for path in sessions_dir.glob("*.jsonl"):
        events = Session(path).replay()
        goal = next((e.get("content") for e in events if e.get("type") == "goal"), "")
        has_final = any(e.get("type") == "final" for e in events)
        out.append({
            "id": path.stem,
            "goal": goal,
            "started": path.stat().st_mtime,
            "final_present": has_final,
            "events": len(events),
        })
    out.sort(key=lambda s: s["started"], reverse=True)
    return out


def replay_session(sessions_dir: Path, run_id: str) -> list[dict] | None:
    path = session_path(sessions_dir, run_id)
    if not path.exists():
        return None
    return Session(path).replay()
