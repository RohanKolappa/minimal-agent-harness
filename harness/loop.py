#the main engine
#assembles the system prompt and starts looping
#on every iteration, the context will be compacted if it grows too large
#everythign mentioned above + the tool calls + calling subagents will all be implemented in this while loop
#we also will cap how iterations that can take place in this loop so that it never runs forever

#every other component exists to support this loop

def run(self, goal: str) -> str:
    system_prompt = assemble_system_prompt(self.cwd)
    messages = [{"role": "user", "content": goal}]

    for step in range(1, self.max_iterations + 1):
        messages = self.context.compact_if_needed(messages)
        response = self.model(system_prompt, messages, self.tools.descriptors())

        if response.get("stop_reason") == "end_turn":
            return response.get("text", "")

        result = self._dispatch_tool(response["tool_call"])
        messages.append({"role": "user", "content": f"tool_result: {result}"})

    return f"(stopped after {self.max_iterations} iterations)"