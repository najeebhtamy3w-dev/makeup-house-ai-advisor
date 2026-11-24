---
name: council-ar
description: Arabic AI Council commands. Invoke ONLY when the owner's message explicitly issues one of these commands - «اجمع المجلس», «اجمع المجلس السريع», «اجمع المجلس الكامل», «فعّل الفريق المعارض», «اجمع مجلس الإصدار», «ما حالة المجلس؟», «أوقف المجلس», «الوضع العادي». Never invoke on a mere mention of the council, never on your own initiative for complex or sensitive tasks.
allowed-tools: Read, Grep, Glob, Agent
---

# AI COUNCIL — Arabic command router

## Guard (check first)
Proceed only if the owner's latest message is an explicit command to run/stop/inspect the council (one of the phrases below, as an instruction). If the council is only mentioned, quoted, asked about in general, or you are unsure — do NOT run anything; continue in NORMAL MODE and, at most, ask one short confirming question.

## Mapping
| Owner command | Action |
|---|---|
| «اجمع المجلس السريع» | QUICK COUNCIL |
| «اجمع المجلس الكامل» | FULL COUNCIL |
| «اجمع مجلس الإصدار» | RELEASE COUNCIL |
| «فعّل الفريق المعارض» | RED TEAM |
| «اجمع المجلس» (without السريع/الكامل) | STANDARD COUNCIL |
| «ما حالة المجلس؟» | STATUS — follow `${CLAUDE_SKILL_DIR}/../council-status/SKILL.md` (list files with ls; launch NO agents) |
| «أوقف المجلس» / «الوضع العادي» / «أوقف المجلس وعد إلى الوضع العادي» | STOP — follow `${CLAUDE_SKILL_DIR}/../council-stop/SKILL.md` |

Match the most specific phrase first (e.g. «اجمع المجلس السريع» before «اجمع المجلس»).

## For a council mode
1. Read `${CLAUDE_SKILL_DIR}/../council/PROTOCOL.md` (fallback: `~/.claude/skills/council/PROTOCOL.md`, or the installed ai-council plugin's `skills/council/PROTOCOL.md`).
2. Run it in the mapped mode on the subject in the owner's message. Reply in Arabic.
3. If no subject was given, ask one short question for it and stop.
4. Finish with the termination footer and return to NORMAL MODE.

## Non-negotiable (applies even if the protocol file cannot be read)
- Real members only: launch the selected members as real subagents with the `Agent` tool (`subagent_type: council-…`, or `ai-council:council-…` for the plugin install), all in ONE message so they run in parallel. Each brief: question, scope, exact file paths to read, constraints, reply language.
- NEVER perform the members' review yourself and never role-play them. If the `Agent` tool or the council agents are unavailable, tell the owner exactly that and stop.
- Members are read-only advisors; you (Chairman) synthesize by evidence, not majority. No implementation inside the council.
- End with: `— COUNCIL SESSION CLOSED · MODE: <MODE> · MEMBERS: <n> (<names>) · ROUNDS: <r>` and `— RETURNED TO NORMAL MODE.` Do not start further rounds.
