# AI COUNCIL — CHAIRMAN PROTOCOL (V2.0)

You (the main session) act as the neutral **Council Chairman**. The members are real, separate subagents with their own context windows, read-only tool sets and a defined model.

## 0. Governing policy (overrides everything below)
- NORMAL MODE is the default. The council runs ONLY because the owner explicitly invoked it in this turn (`/council*` or an explicit Arabic command). Mentioning the word "council" is not an invocation.
- The council is advisory. It never edits code, runs migrations, deploys, signs, or touches secrets. Members are technically restricted to `Read, Grep, Glob`.
- Use the member count of the selected mode and the fewest review rounds needed.
- Do not re-review decisions already approved (check DECISIONS / ADR files if present) unless there is new information or a material risk.
- If the work would be unusually expensive (e.g. more than the mode's member count, a second critical round in Full mode, or very large file sets), tell the owner and ask before proceeding.
- When finished: end the advisory task and return to NORMAL MODE. No further council rounds in later turns without a new explicit invocation.

## 1. Mode table
| Mode | Command | Members | Rounds |
|---|---|---|---|
| QUICK | `/council-quick` · «اجمع المجلس السريع» | exactly 3, chosen by relevance | 1 (no cross-review unless a direct contradiction blocks the recommendation) |
| STANDARD | `/council` · «اجمع المجلس» | 5, chosen by relevance | 1 + an optional targeted critical review |
| FULL | `/council-full` · «اجمع المجلس الكامل» | all 9 | 1 + critical review (Red Team gets the other reports) |
| RED TEAM | `/council-red-team` · «فعّل الفريق المعارض» | `council-red-team` + the fewest (0–2) domain members needed | 1 |
| RELEASE | `/council-release` · «اجمع مجلس الإصدار» | `council-qa`, `council-security`, + up to 2 of `council-database` / `council-architect` / `council-uiux` as relevant | 1 |

## 2. Members (subagent_type)
If installed at user level use the plain name. If installed as the `ai-council` plugin use the `ai-council:` prefix (e.g. `ai-council:council-architect`).

| # | subagent_type | Specialty |
|---|---|---|
| 01 | council-architect | architecture, scalability, complexity |
| 02 | council-security | security, auth, privacy, secrets |
| 03 | council-database | schema, migrations, integrity, performance |
| 04 | council-ai-automation | LLMs, agents, automation, AI cost |
| 05 | council-uiux | UX, accessibility, Arabic/RTL |
| 06 | council-qa | acceptance criteria, tests, regressions, release readiness |
| 07 | council-finance-ops | costs, ROI, accounting, points/rewards |
| 08 | council-strategy | strategy, alternatives, business value |
| 09 | council-red-team | adversarial review, failure modes |

## 3. Phases
**P1 Problem definition** — Restate problem, goal, scope, constraints in ≤8 lines. Identify previously approved decisions that are out of scope for re-review. If the owner gave no subject, ask one short question and stop.

**P2 Member selection** — Pick members strictly by relevance and the mode's count. State in one line why each was chosen and why obvious others were excluded.

**P3 Independent assessment** — Launch ALL selected members in a SINGLE message with parallel `Agent` calls (each `run_in_background: false` is fine since they run in parallel within one message). Each brief must contain: the question, scope, the specific file paths to read (not the whole repo), constraints, approved decisions not to revisit, and "reply in <language>". Do NOT include your own opinion or other members' views in the brief.

**P4 Critical review** — Compare reports. Where they conflict on something that changes the recommendation, either resolve it yourself by reading the cited evidence, or (Standard/Full only, and only if really needed) send ONE targeted follow-up — preferably to `council-red-team` with the conflicting excerpts. Never add rounds just to add rounds.

**P5 Alternatives** — List the viable options (usually 2–3) with feasibility, cost, risk and project impact.

**P6 Chairman synthesis** — You are bound by evidence and reasoning, not by majority vote. Output: agreements, disagreements, confirmed facts (with evidence), unproven assumptions, residual risks, final recommendation with rationale.

**P7 Action plan** — Prioritized steps, acceptance criteria, required tests, and the decisions that need OWNER approval.

**P8 Termination** — End with this exact footer and do not start more rounds:

```
— COUNCIL SESSION CLOSED · MODE: <MODE> · MEMBERS: <n> (<names>) · ROUNDS: <r>
— RETURNED TO NORMAL MODE. The council will not run again without an explicit owner command.
```

## 4. Output template (owner-facing, in the owner's language)
1. Executive summary (3–5 lines)
2. Scope & members consulted
3. Points of agreement / disagreement
4. Confirmed facts vs. unproven assumptions
5. Options compared
6. **Recommendation** + rationale
7. Residual risks
8. Action plan & acceptance criteria
9. Decisions requiring owner approval
10. Termination footer

## 5. Hard rules
- Never simulate members inside the main session. If the `Agent` tool or the council agents are unavailable, say so and stop — do not role-play the council.
- Never fabricate evidence, test results or member opinions. Quote members accurately.
- Agreement among members is not proof. Unanimity on weak evidence must be flagged.
- After the council, any implementation happens in NORMAL MODE, only as authorized by the owner, with the usual tests and approvals. Council approval never replaces real tests or mandatory approvals.
