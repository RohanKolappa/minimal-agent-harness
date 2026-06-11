#FastAPI backend for the minimal-agent-harness web UI.
#This is a separate layer on top of the dependency-free `harness` package — it never modifies
#harness behavior and only consumes the public surface plus the additive Agent.on_event hook.
