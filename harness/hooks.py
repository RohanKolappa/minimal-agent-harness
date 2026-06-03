#hooks are used for extensibility
#there are two different types of hooks: 1) pre_tool, 2) post_tool
#pre_tool hook fires before any tool runs and can either allow or deny the call
#post_tool hook fires after any tool runs and sees the output. It cannot block anything, it's just there to audit and used for logging and observability

from typing import Callable, Any
from dataclasses import dataclass
from enum import Enum

class HookDecision(Enum):
    ALLOW = "allow"
    DENY = "deny"

@dataclass
class HookContext:
    tool_name: str
    args: dict[str, Any]

class Hooks:
    def __init__(self) -> None:
        self._pre: list[Callable[[HookContext], HookDecision]] = []
        self._post: list[Callable[[HookContext], None]] = []
    
    def add_pre(self, hook): self._pre.append(hook)
    def add_post(self, hook): self._post.append(hook)

    def fire_pre(self, ctx: HookContext) -> HookDecision:
        for hook in self._pre:
            if hook(ctx) == HookDecision.DENY:
                return HookDecision.DENY
        return HookDecision.ALLOW
    
    def fire_post(self, ctx: HookContext) -> None:
        for hook in self._post:
            hook(ctx)