# AI_COUNCIL_CLAUDE_CODE_V2 — Manifest

Version: 2.0.0 · Built and verified with Claude Code 2.1.331 (cloud container).

| Path | Purpose | Tools / permissions |
|---|---|---|
| `agents/council-architect.md` | 01 Software Architect | `tools: Read, Grep, Glob` · `model: sonnet` |
| `agents/council-security.md` | 02 Security Engineer | same |
| `agents/council-database.md` | 03 Database Engineer | same |
| `agents/council-ai-automation.md` | 04 AI & Automation Engineer | same |
| `agents/council-uiux.md` | 05 UI/UX Expert | same |
| `agents/council-qa.md` | 06 QA & Regression Engineer | same |
| `agents/council-finance-ops.md` | 07 Financial & Operations Advisor | same |
| `agents/council-strategy.md` | 08 Strategic Innovation Advisor | same |
| `agents/council-red-team.md` | 09 Red Team Reviewer | same |
| `skills/council/PROTOCOL.md` | Chairman protocol (phases P1–P8, mode table) | — |
| `skills/council/SKILL.md` | `/council` STANDARD | `disable-model-invocation: true`; pre-approves Read, Grep, Glob, Agent |
| `skills/council-quick/SKILL.md` | `/council-quick` | same |
| `skills/council-full/SKILL.md` | `/council-full` | same |
| `skills/council-red-team/SKILL.md` | `/council-red-team` | same |
| `skills/council-release/SKILL.md` | `/council-release` | same |
| `skills/council-status/SKILL.md` | `/council-status` (launches no agents) | `disable-model-invocation: true`; Read, Glob |
| `skills/council-stop/SKILL.md` | `/council-stop` | `disable-model-invocation: true` |
| `skills/council-ar/SKILL.md` | Arabic command router (only model-invocable skill; guarded to explicit phrases) | Read, Grep, Glob, Agent |
| `.claude-plugin/plugin.json`, `marketplace.json` | Plugin packaging (`claude plugin validate` passes) | — |
| `install.sh` / `uninstall.sh` | Safe install / update / removal with backups | touches only `agents/council-*`, `skills/council*`, `ai-council/` |
| `tests/static_checks.sh` | 42 offline checks (no model calls) | — |
| `tests/ACCEPTANCE_RESULTS.md` | Recorded results of the live acceptance tests | — |

Not shipped by design: hooks, settings.json, CLAUDE.md, MCP servers, background jobs, API keys or secrets.
