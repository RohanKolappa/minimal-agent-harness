#this code implements simple context management
#performing compaction if history grows beyond a certain point (summarize some of the older conversations and put them together)
#if we are making tool calls then we need to decide if we want to bring in everything that's done within the tool call or just the inputs/outputs

from dataclasses import dataclass

@dataclass
class ContextManager:
    compact_threshold: int = 18
    keep_recent: int = 4

    def compact_if_needed(self, messages: list[dict]) -> list[dict]:
        if len(messages) < self.compact_threshold:
            return messages
        older = messages[: -self.keep_recent]
        recent = messages[-self.keep_recent :]

        summary = self._summarize(older)
        return [summary] + recent

    def _summarize(self, older: list[dict]) -> dict:
        #deterministic, dependency-free compaction: fold the older turns into one short recap message
        #(kept local so compaction never costs an extra LLM round-trip; swap in a model call if you want richer summaries)
        lines = []
        for m in older:
            content = str(m.get("content", "")).replace("\n", " ")
            if len(content) > 200:
                content = content[:200] + "..."
            lines.append(f"- {m.get('role', '?')}: {content}")
        recap = "\n".join(lines)
        return {
            "role": "user",
            "content": f"[summary of {len(older)} earlier messages]\n{recap}",
        }