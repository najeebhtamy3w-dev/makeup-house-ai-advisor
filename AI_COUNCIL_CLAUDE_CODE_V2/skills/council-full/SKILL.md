---
name: council-full
description: AI Council FULL mode (all 9 expert subagents). Manual only: runs when the owner types /council-full.
disable-model-invocation: true
argument-hint: "<subject / question / files to review>"
allowed-tools: Read, Grep, Glob, Agent
---

# AI COUNCIL — FULL COUNCIL

The owner explicitly invoked **FULL COUNCIL** with this subject:

> $ARGUMENTS

1. Read the Chairman protocol: `${CLAUDE_SKILL_DIR}/../council/PROTOCOL.md` (if the variable did not expand, use `~/.claude/skills/council/PROTOCOL.md`, or the `skills/council/PROTOCOL.md` of the installed ai-council plugin).
2. Run it in mode **FULL COUNCIL** — members: all 9 members, plus one critical-review round by council-red-team.
3. If the subject above is empty, ask the owner one short question for the subject and stop (do not launch members).
4. Finish with the termination footer and return to NORMAL MODE.

## Non-negotiable (applies even if the protocol file cannot be read)
- Real members only: launch the selected members as real subagents with the `Agent` tool (`subagent_type: council-…`, or `ai-council:council-…` for the plugin install), all in ONE message so they run in parallel. Each brief: question, scope, exact file paths to read, constraints, reply language.
- NEVER perform the members' review yourself and never role-play them. If the `Agent` tool or the council agents are unavailable, tell the owner exactly that and stop.
- Members are read-only advisors; you (Chairman) synthesize by evidence, not majority. No implementation inside the council.
- End with: `— COUNCIL SESSION CLOSED · MODE: <MODE> · MEMBERS: <n> (<names>) · ROUNDS: <r>` and `— RETURNED TO NORMAL MODE.` Do not start further rounds.
