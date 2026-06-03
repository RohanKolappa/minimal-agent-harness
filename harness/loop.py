#the main engine
#assembles the system prompt and starts looping
#on every iteration, the context will be compacted if it grows too large
#everything mentioned above + the tool calls + calling subagents will all be implemented in this while loop
#we also will cap how many iterations that can take place in this loop so that it never runs forever

#every other component exists to support this loop

import json
from pathlib import Path

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
    ) -> None:
        self.cwd = Path(cwd)
        self.model = model
        self.tools = tools
        self.context = context or ContextManager()
        self.hooks = hooks or Hooks()
        self.session = session
        self.permission = permission
        self.max_iterations = max_iterations

    def _log(self, event: dict) -> None:
        if self.session is not None:
            self.session.append(event)

    def run(self, goal: str) -> str:
        system_prompt = assemble_system_prompt(self.cwd)
        messages = [{"role": "user", "content": goal}]
        self._log({"type": "goal", "content": goal})

        for step in range(1, self.max_iterations + 1):
            messages = self.context.compact_if_needed(messages)
            response = self.model(system_prompt, messages, self.tools.descriptors())

            if response.get("stop_reason") == "end_turn":
                text = response.get("text", "")
                self._log({"type": "final", "content": text})
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
            return f"error: unknown tool {name!r}"

        #bash can be safe or dangerous depending on the command, so classify it dynamically
        required = tool.permissions
        if name == "bash":
            required = classify_bash(args.get("cmd", ""))
        if not can_dispatch(required, self.permission):
            return f"error: tool {name!r} needs '{required}' permission but agent only has '{self.permission}'"

        ctx = HookContext(tool_name=name, args=args)
        if self.hooks.fire_pre(ctx) == HookDecision.DENY:
            self._log({"type": "denied", "tool": name, "args": args})
            return f"error: tool {name!r} denied by pre-hook"

        self._log({"type": "tool_call", "tool": name, "args": args})
        try:
            result = tool.handler(**args)
        except Exception as e:  # surface tool failures to the model instead of crashing the loop
            result = f"error: {type(e).__name__}: {e}"

        self._log({"type": "tool_result", "tool": name, "result": str(result)[:500]})
        self.hooks.fire_post(ctx)
        return str(result)
