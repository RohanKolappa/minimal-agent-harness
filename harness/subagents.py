#you can implement multiple different subbagents
#this code looks at three different things (presets): 1) exploration, 2) general, 3) verification
#each archetype has its own permission levels, its own restricted tool list, and its own focused system prompt

from dataclasses import dataclass
from harness.permissions import Permission

@dataclass
class SubAgentSpec:
    permission: str
    tools: tuple[str, ...]
    system_prompt: str

class SubAgentRegistry:
    PRESETS = {
        "explore" : SubAgentSpec(
            permission=Permission.READ_ONLY,
            tools=("read_file", "grep"),
            system_prompt="You are EXPLORE. You can only read.",
        ),
        "general" : SubAgentSpec(
            permission=Permission.WORKSPACE,
            tools=("read_file", "write_file", "edit_file", "bash", "grep"),
            system_prompt="You are GENERAL. Get the work done.",
        ),
        "verify" : SubAgentSpec(
            permission=Permission.WORKSPACE,
            tools=("read_file", "grep", "bash"),
            system_prompt="You are VERIFY. Confirm a change with tests.",
        ),
    }