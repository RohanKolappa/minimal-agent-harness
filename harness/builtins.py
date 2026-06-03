#Every harness needs to have built-in primitives.
#There are 5 non-negotiable primitives that every coding harness must ship with:
    #read, write, edit, bash, grep
#The type of primitives you have depend on the type of work you want your agent to perform
#It is better to use pure standard libraries rather than framework dependencies for the primitives because it enables the model to take actions


def read_file(path: str) -> str:
    return Path(path).read_text()

def edit_file(path: str, find: str, replace: str) -> str:
    p = Path(path)
    text = p.read_text()
    if text.count(find) != 1:
        raise ValueError(f"text not unique in {path!r}")
    p.write_text(text.replace(find, replace, 1))
    return f"edited {path}: 1 replacement applied"

def bash(cmd: str, timeout: int = 30) -> str:
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "")[:8192]
    err = (r.stderr or "")[:8192]
    return f"exit_code={r.returncode}\nstdout: {out}\nstderr: {err}"


