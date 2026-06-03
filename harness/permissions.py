#each tool declares the minimum permissions it needs (read, workspace, or full
#the harness needs to provide that extenisbility and control the permissions of every tool
#one thing to keep in mind is that the same tool can be safe or dangerous depending on the command
#to address this, we classify the commands:
    #safe stays at read-only
    #dangerous jumps straight to full access
    #anything else is workspace level
#on top of these static rules, the agent can also pause and ask the user for explicit approval before running anything destructive



class Permission:
    READ_ONLY = "read"
    WORKSPACE = "workspace"
    FULL      = "full"

RANK = {Permission.READ_ONLY: 1, Permission.WORKSPACE: 2, Permission.FULL: 3}

_READ_CMDS   = {"ls", "cat", "head", "grep", "find", "wc", "echo", ...}
_DANGER_CMDS = {"rm", "sudo", "mv", "kill", "shutdown", "dd", ...}

def classify_bash(cmd: str) -> str:
    parts = shlex.split(cmd) if cmd else []
    if not parts:                    return Permission.READ_ONLY
    if parts[0] in _READ_CMDS:       return Permission.READ_ONLY
    if parts[0] in _DANGER_CMDS:     return Permission.FULL
    return Permission.WORKSPACE

def can_dispatch(required: str, current: str) -> bool:
    return RANK[current] >= RANK[required]