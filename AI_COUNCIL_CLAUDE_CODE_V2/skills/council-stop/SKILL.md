---
name: council-stop
description: Stop the AI Council and return to NORMAL MODE. Manual only: runs when the owner types /council-stop.
disable-model-invocation: true
---

# AI COUNCIL — STOP

1. Do not start any new council round or launch any council member.
2. If council subagents (`council-*`) are still running in the background in this conversation, stop them with `TaskStop` (load it via ToolSearch if needed). Do not stop unrelated, non-council tasks.
3. Discard any pending council follow-up plans.
4. Confirm to the owner, in their language, in at most 3 lines:
   `COUNCIL STOPPED — NORMAL MODE ACTIVE. Ongoing work continues normally; the council will only run again on an explicit command.`
