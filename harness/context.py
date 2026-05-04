#this code implements simple context management
#performing compaction if history grows beyond a certain point (summarize some of the older conversations and put them together)
#if we are making tool calls then we need to decide if we want to bring in everything that's done within the tool call or just the inputs/outputs

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