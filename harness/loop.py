#the main engine
#assembles the system prompt and starts looping
#on every iteration, the context will be compacted if it grows too large
#everything mentioned above + the tool calls + calling subagents will all be implemented in this while loop
#we also will cap how many iterations that can take place in this loop so that it never runs forever

#every other component exists to support this loop

import json
from pathlib import Path
from typing import Callable

from harness.prompt import assemble_system_prompt
from harness.context import ContextManager
from harness.permissions import Permission, classify_bash, can_dispatch
from harness.hooks import Hooks, HookContext, HookDecision


class Agent:
    def __init__(
        self,
        cwd,
        model,
        tools,
        context: ContextManager | None = None,
        hooks: Hooks | None = None,
        session=None,
        permission: str = Permission.WORKSPACE,
        max_iterations: int = 20,
        on_event: Callable[[dict], None] | None = None,
    ) -> None:
        self.cwd = Path(cwd)
        self.model = model
        self.tools = tools
        self.context = context or ContextManager()
        self.hooks = hooks or Hooks()
        self.session = session
        self.permission = permission
        self.max_iterations = max_iterations
        #optional, additive observability hook for a live UI. With on_event=None the engine's
        #behavior and its persisted session log are byte-for-byte identical to before.
        self.on_event = on_event

    def _log(self, event: dict) -> None:
        #session-only: writes one of the five persisted event shapes (never the UI emit stream)
        if self.session is not None:
            self.session.append(event)

    def _emit(self, event: dict) -> None:
        #UI-only: streams a complete, untruncated view of the run. Never writes to the session.
        #(The closure a UI passes here may raise to cooperatively cancel the run at this boundary.)
        if self.on_event is not None:
            self.on_event(event)

    def run(self, goal: str) -> str:
        system_prompt = assemble_system_prompt(self.cwd)
        messages = [{"role": "user", "content": goal}]
        self._log({"type": "goal", "content": goal})
        self._emit({
            "type": "run_started",
            "goal": goal,
            "workspace": str(self.cwd),
            "permission": self.permission,
            "max_iterations": self.max_iterations,
        })

        for step in range(1, self.max_iterations + 1):
            self._emit({"type": "iteration", "n": step, "max": self.max_iterations})
            before = len(messages)
            messages = self.context.compact_if_needed(messages)
            if len(messages) < before:
                self._emit({"type": "compaction", "from": before, "to": len(messages)})
            response = self.model(system_prompt, messages, self.tools.descriptors())
            self._emit({
                "type": "model_response",
                "stop_reason": response.get("stop_reason"),
                "text": response.get("text", ""),
                "tool_call": response.get("tool_call"),
            })

            if response.get("stop_reason") == "end_turn":
                text = response.get("text", "")
                self._log({"type": "final", "content": text})
                self._emit({"type": "final", "text": text})
                return text

            tool_call = response["tool_call"]
            #echo the action back as the SAME protocol JSON the model is supposed to emit, so the
            #history stays internally consistent and the model keeps producing valid protocol messages
            assistant_turn = json.dumps({"action": "tool", "tool": tool_call.get("name"), "args": tool_call.get("args", {})})
            messages.append({"role": "assistant", "content": assistant_turn})
            result = self._dispatch_tool(tool_call)
            messages.append({
                "role": "user",
                "content": f"Result of {tool_call.get('name')}:\n{result}\n\n"
                           f"Now either call another tool or finish with {{\"action\": \"final\", \"text\": ...}}.",
            })

        return f"(stopped after {self.max_iterations} iterations)"

    def _dispatch_tool(self, tool_call: dict) -> str:
        name = tool_call.get("name")
        args = tool_call.get("args", {}) or {}

        try:
            tool = self.tools.get(name)
        except KeyError:
            self._emit({"type": "tool_error", "tool": name, "error": "unknown_tool"})
            return f"error: unknown tool {name!r}"

        #bash can be safe or dangerous depending on the command, so classify it dynamically
        required = tool.permissions
        if name == "bash":
            required = classify_bash(args.get("cmd", ""))
        if not can_dispatch(required, self.permission):
            self._emit({"type": "permission_denied", "tool": name, "required": required, "ceiling": self.permission})
            return f"error: tool {name!r} needs '{required}' permission but agent only has '{self.permission}'"

        ctx = HookContext(tool_name=name, args=args)
        if self.hooks.fire_pre(ctx) == HookDecision.DENY:
            self._log({"type": "denied", "tool": name, "args": args})
            self._emit({"type": "hook_denied", "tool": name, "args": args})
            return f"error: tool {name!r} denied by pre-hook"

        self._log({"type": "tool_call", "tool": name, "args": args})
        self._emit({"type": "tool_call", "tool": name, "args": args, "required_permission": required})
        try:
            result = tool.handler(**args)
        except Exception as e:  # surface tool failures to the model instead of crashing the loop
            result = f"error: {type(e).__name__}: {e}"

        self._log({"type": "tool_result", "tool": name, "result": str(result)[:500]})
        self._emit({"type": "tool_result", "tool": name, "result": str(result), "is_error": str(result).startswith("error:")})
        self.hooks.fire_post(ctx)
        return str(result)
