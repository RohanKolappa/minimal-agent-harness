#implementing a simple tools and skills registry, you can also call this a dispatch table
#every tool in the harness is described by a small dataclass, a name, what type of permissions they're going to have, a handler function, and a one-line description
#the registry is a simple dictionary that maps the tool name to that record
#there are a few functions: 1) register: adds a new tool , 2) get: retrieves a tool for dispatch, 3) descriptors: returns a lightweight version of the table/list which is going to contain name, permissions, description
#descriptors are sent to the model so that it knows what is available. look at loop.py (response = self.model(system_prompt, messages, self.tools.descriptors()))
#skills are registered the exact same way, they're just tools whose handler reads a markdown file at invocation time (In other words, skills only load their markdown instructions into the active context when the agent determines the skill is relevant, saving tokens and keeping the workspace clean. If you put specialized instructions in CLAUDE.md, they take up valuable tokens permanently.)
#skills are knowledge-oriented and tools are action-oriented


from dataclasses import dataclass
from typing import Callable


@dataclass
class Tool:
    name: str
    permissions: str
    handler: Callable
    description: str = ""

class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}
    
    def register(self, name, permission, handler, description=""):
        self._tools[name] = Tool(name, permission, handler, description)
    
    def get(self, name):
        return self._tools[name] #if it's missing it returns KeyError rather than returning None (which would be the case if we used .get(name))
    
    def descriptors(self):
        return [{"name": t.name, "permission": t.permission, "handler": t.handler, "description": t.description} for t in self._tools.values()]
    