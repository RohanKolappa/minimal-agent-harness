#simple implementation of memory / context persistence
#every event the agent generates gets written to disk as one line of JSON
#the append method opens the file in append mode, writes the event, and immediately flushes it
#that way if the process crashes after the next line, this one is already safe on disk
#the replay method reads the file line by line and reconstructs the full session
#Since the file is append-only, two runs of the harness can share the same log without stepping on each other
#If the harness dies, the file does not. This is the whole durability story.

from pathlib import Path
import json
class Session:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: dict) -> None:
        line = json.dumps(event, ensure_ascii=False, default=str)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
    
    def replay(self) -> list[dict]:
        if not self.path.exists():
            return []
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines() if line.strip()]
