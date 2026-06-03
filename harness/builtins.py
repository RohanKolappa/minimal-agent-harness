#Every harness needs to have built-in primitives.
#There are 5 non-negotiable primitives that every coding harness must ship with:
    #read, write, edit, bash, grep
#The type of primitives you have depend on the type of work you want your agent to perform
#It is better to use pure standard libraries rather than framework dependencies for the primitives because it enables the model to take actions


from pathlib import Path
import re
import subprocess

def read_file(path: str) -> str:
    return Path(path).read_text()

def write_file(path: str, content: str) -> str:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return f"wrote {path}: {len(content)} chars"

def edit_file(path: str, find: str, replace: str) -> str:
    p = Path(path)
    text = p.read_text()
    if text.count(find) != 1:
        raise ValueError(f"text not unique in {path!r}")
    p.write_text(text.replace(find, replace, 1))
    return f"edited {path}: 1 replacement applied"

def grep(pattern: str, path: str = ".", max_matches: int = 100) -> str:
    #pure-stdlib recursive search so the primitive has no framework dependency
    rx = re.compile(pattern)
    root = Path(path)
    files = [root] if root.is_file() else [p for p in root.rglob("*") if p.is_file()]
    hits: list[str] = []
    for f in files:
        try:
            for i, line in enumerate(f.read_text(errors="ignore").splitlines(), 1):
                if rx.search(line):
                    hits.append(f"{f}:{i}:{line.strip()}")
                    if len(hits) >= max_matches:
                        return "\n".join(hits)
        except (OSError, UnicodeError):
            continue
    return "\n".join(hits) if hits else "(no matches)"

def bash(cmd: str, timeout: int = 30) -> str:
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "")[:8192]
    err = (r.stderr or "")[:8192]
    return f"exit_code={r.returncode}\nstdout: {out}\nstderr: {err}"


#The bare functions above touch ANY path on the filesystem. That's fine for tests/flexibility,
#but a real agent should be confined. WorkspaceTools binds every file operation to a single root
#directory and refuses to read or write outside it (blocking ../ escapes, absolute paths to
#/etc/passwd, ~/.ssh, etc.). This is the safe-by-default surface the demo registers.
_MAX_BASH_TIMEOUT = 60

class WorkspaceTools:
    def __init__(self, root) -> None:
        self.root = Path(root).resolve()

    def _resolve(self, path: str) -> Path:
        p = Path(path)
        full = (self.root / p).resolve() if not p.is_absolute() else p.resolve()
        if full != self.root and self.root not in full.parents:
            raise PermissionError(f"path {path!r} is outside the workspace {self.root}")
        return full

    def read_file(self, path: str) -> str:
        return self._resolve(path).read_text()

    def write_file(self, path: str, content: str) -> str:
        fp = self._resolve(path)
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(content)
        return f"wrote {fp}: {len(content)} chars"

    def edit_file(self, path: str, find: str, replace: str) -> str:
        fp = self._resolve(path)
        text = fp.read_text()
        if text.count(find) != 1:
            raise ValueError(f"text not unique in {path!r}")
        fp.write_text(text.replace(find, replace, 1))
        return f"edited {fp}: 1 replacement applied"

    def grep(self, pattern: str, path: str = ".", max_matches: int = 100) -> str:
        base = self._resolve(path)
        rx = re.compile(pattern)
        files = [base] if base.is_file() else [p for p in base.rglob("*") if p.is_file()]
        hits: list[str] = []
        for f in files:
            try:
                for i, line in enumerate(f.read_text(errors="ignore").splitlines(), 1):
                    if rx.search(line):
                        hits.append(f"{f}:{i}:{line.strip()}")
                        if len(hits) >= max_matches:
                            return "\n".join(hits)
            except (OSError, UnicodeError):
                continue
        return "\n".join(hits) if hits else "(no matches)"

    def bash(self, cmd: str, timeout: int = 30) -> str:
        #run inside the workspace and clamp the timeout so the model can't pin the box
        timeout = max(1, min(int(timeout), _MAX_BASH_TIMEOUT))
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=self.root)
        out = (r.stdout or "")[:8192]
        err = (r.stderr or "")[:8192]
        return f"exit_code={r.returncode}\nstdout: {out}\nstderr: {err}"


