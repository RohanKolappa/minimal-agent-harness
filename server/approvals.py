#human-in-the-loop approval: a registry of pending decisions and a synchronous pre-hook that
#blocks the worker thread until the UI resolves (or a timeout / cancel unblocks it).

import threading
from uuid import uuid4

from harness import HookContext, HookDecision, Permission, classify_bash


class ApprovalRegistry:
    #per-run. Each approval is a threading.Event plus a decision slot, default-deny until set.
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: dict[str, threading.Event] = {}
        self._decisions: dict[str, str] = {}

    def register(self, approval_id: str) -> None:
        with self._lock:
            self._events[approval_id] = threading.Event()
            self._decisions[approval_id] = "deny"  # default-deny on timeout/cancel

    def resolve(self, approval_id: str, decision: str) -> bool:
        with self._lock:
            ev = self._events.get(approval_id)
            if ev is None:
                return False
            self._decisions[approval_id] = decision
            ev.set()
            return True

    def wait(self, approval_id: str, timeout: float = 300.0) -> str:
        ev = self._events.get(approval_id)
        if ev is None:
            return "deny"
        ev.wait(timeout)  # times out -> event never set -> the default-deny slot stands
        with self._lock:
            return self._decisions.get(approval_id, "deny")

    def resolve_all_pending(self, decision: str = "deny") -> None:
        #used by cancel: unblock any worker stuck in wait() so the run can unwind promptly.
        with self._lock:
            pending = [aid for aid, ev in self._events.items() if not ev.is_set()]
            for aid in pending:
                self._decisions[aid] = decision
                self._events[aid].set()


class ApprovalPolicy:
    #decides which tool calls need explicit approval. Reads/safe-bash auto-allow by default;
    #writes/edits/non-read bash require approval. auto_approve_all bypasses everything (warned in UI).
    def __init__(self, auto_approve_reads=True, require_approval_for_writes=True, auto_approve_all=False) -> None:
        self.auto_approve_reads = auto_approve_reads
        self.require_approval_for_writes = require_approval_for_writes
        self.auto_approve_all = auto_approve_all

    def needs_approval(self, ctx: HookContext) -> bool:
        if self.auto_approve_all:
            return False
        name = ctx.tool_name
        if name == "bash":
            #only bash that classifies above read-only is gated here; full-classified bash never
            #reaches the hook at all (the ceiling rejects it first).
            return classify_bash(ctx.args.get("cmd", "")) != Permission.READ_ONLY
        if name in ("read_file", "grep"):
            return not self.auto_approve_reads
        # write_file, edit_file, and anything else mutating
        return self.require_approval_for_writes

    def reason(self, ctx: HookContext) -> str:
        name = ctx.tool_name
        if name == "bash":
            return f"Run shell command: {ctx.args.get('cmd', '')!r}"
        if name == "write_file":
            return f"Create/overwrite {ctx.args.get('path', '?')} in the sandbox"
        if name == "edit_file":
            return f"Edit {ctx.args.get('path', '?')} in the sandbox"
        if name in ("read_file", "grep"):
            return f"Read access via {name}"
        return f"Run {name}"


def make_approval_hook(emit, registry: ApprovalRegistry, policy: ApprovalPolicy):
    #synchronous pre-hook; runs in the worker thread, where blocking is fine.
    def hook(ctx: HookContext) -> HookDecision:
        if not policy.needs_approval(ctx):
            return HookDecision.ALLOW
        approval_id = uuid4().hex
        registry.register(approval_id)
        emit({
            "type": "approval_request",
            "approval_id": approval_id,
            "tool": ctx.tool_name,
            "args": ctx.args,
            "reason": policy.reason(ctx),
        })
        decision = registry.wait(approval_id, timeout=300)
        #if the run was cancelled mid-wait, this emit raises RunCancelled and unwinds agent.run
        emit({"type": "approval_resolved", "approval_id": approval_id, "decision": decision})
        return HookDecision.ALLOW if decision == "allow" else HookDecision.DENY

    return hook
