---
name: council-status
description: Show AI Council installation status without launching any council member. Manual only: runs when the owner types /council-status.
disable-model-invocation: true
allowed-tools: Read, Glob
---

# AI COUNCIL — STATUS (no agents are launched)

Do NOT call the `Agent` tool in this command.

Collect evidence with at most 3 cheap calls, and do NOT open agent/skill files one by one:
- `Glob` pattern `council-*.md` with path `~/.claude/agents` (then `.claude/agents` only if the first is empty)
- `Glob` pattern `council*/SKILL.md` with path `~/.claude/skills`
- `Read` `~/.claude/ai-council/VERSION`
(If installed as the ai-council plugin, members are named `ai-council:council-*`.)

Report, in the owner's language, concisely:
1. Installation status and scope (user-level `~/.claude`, project `.claude`, or plugin) based on the listing above.
2. Available members (the 9 `council-*` agents) and whether each file exists.
3. Available commands: /council, /council-quick, /council-full, /council-red-team, /council-release, /council-status, /council-stop, plus Arabic commands handled by the `council-ar` skill.
4. Current mode: **NORMAL MODE** (the council is invocation-scoped; it holds no running state between turns). If council subagents were launched in the background earlier in THIS conversation and are still running, mention them.
5. Known limits: cloud sessions do not keep `~/.claude` between sessions unless re-installed (setup script / plugin); members are read-only (Read, Grep, Glob); members use the `sonnet` model.
