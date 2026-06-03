#each tool declares the minimum permissions it needs (read, workspace, or full
#the harness needs to provide that extenisbility and control the permissions of every tool
#one thing to keep in mind is that the same tool can be safe or dangerous depending on the command
#to address this, we classify the commands:
    #safe stays at read-only
    #dangerous jumps straight to full access
    #anything else is workspace level
#on top of these static rules, the agent can also pause and ask the user for explicit approval before running anything destructive

import os
import shlex

class Permission:
    READ_ONLY = "read"
    WORKSPACE = "workspace"
    FULL      = "full"

RANK = {Permission.READ_ONLY: 1, Permission.WORKSPACE: 2, Permission.FULL: 3}

_READ_CMDS = {"ls", "cat", "head", "tail", "grep", "rg", "find", "wc", "echo", "pwd", "which", "stat", "file", "diff"}
_DANGER_CMDS = {
    "rm", "rmdir", "sudo", "su", "doas", "mv", "kill", "killall", "pkill",
    "shutdown", "reboot", "halt", "dd", "mkfs", "fdisk", "chmod", "chown",
    "chgrp", "curl", "wget", "ssh", "scp", "nc", "ncat", "telnet", "eval",
    "exec", "crontab", "launchctl", "systemctl", "brew", "pip", "npm", "git",
}
#shell metacharacters mean we can't reason about the command from its first token alone,
#so any of these forces the highest permission level (and thus a denial under a normal ceiling)
_SHELL_OPS = (";", "&&", "||", "|", ">", "<", "`", "$(", "${", "&", "\n", "(", ")")

def classify_bash(cmd: str) -> str:
    if not cmd or not cmd.strip():
        return Permission.READ_ONLY
    #chaining / piping / redirection / substitution can smuggle a dangerous command past a
    #first-token check, so treat any of it as full access (deny-by-default under a normal ceiling)
    if any(op in cmd for op in _SHELL_OPS):
        return Permission.FULL
    try:
        parts = shlex.split(cmd)
    except ValueError:
        return Permission.FULL  # unbalanced quotes etc. -> can't classify safely
    if not parts:
        return Permission.READ_ONLY
    #scan every token (not just the first) and normalize paths like /bin/rm -> rm
    bases = {os.path.basename(p) for p in parts if not p.startswith("-")}
    if bases & _DANGER_CMDS:
        return Permission.FULL
    base = os.path.basename(parts[0])
    if base in _READ_CMDS:
        return Permission.READ_ONLY
    return Permission.WORKSPACE

def can_dispatch(required: str, current: str) -> bool:
    return RANK[current] >= RANK[required]