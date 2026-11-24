# AI Council V2 — Acceptance Test Results

- **Date:** 2026-11-24
- **Claude Code:** 2.1.331
- **Environment:** Claude Code on the web, cloud container (Linux)
- **Main-session model:** opus. **Member model:** sonnet; logs show `canonicalModel: claude-sonnet-5-5` for member turns.

## How the tests ran

- Live tests ran as **fresh, separate headless sessions** (`claude -p … --output-format stream-json`) inside an isolated sandbox git repo, `council-sandbox/points.js`. That repo is a toy loyalty module with deliberate flaws.
- Evidence comes from the JSON event streams: the `init` event, top-level `Agent` tool calls with their `subagent_type`, the member tool calls, and the result cost.
- The commercial project was never used as a test target.
- Headless (`-p`) sessions **cannot show permission prompts**. Reads under the scratchpad path were therefore denied unless pre-approved with `--allowedTools`. This limit belongs to the test harness, not to the council; interactive sessions prompt the owner instead.

## Results

| # | Test | Status | Evidence |
|---|---|---|---|
| 01 | Installation | PASS | `install.sh` placed 9 agents and 8 skills. The `init` event of a new session lists all 9 `council-*` agents and all 8 `council*` skills. `static_checks.sh`: 42/42. |
| 02 | Real subagents | PASS | Real `Agent` tool calls with `subagent_type` `council-finance-ops`, `council-security` and `council-red-team` (quick council), `council-red-team` and `council-finance-ops` (red team), and `council-database`. Member turns ran on a different model (sonnet) from the main session (opus). |
| 03 | Context isolation | PASS | Each member starts in its own context and sees only its brief. In the quick council, the security member could not read the file and the Chairman had to send it the content with `SendMessage`, which shows the member had no access to the main context. |
| 04 | Normal mode by default | PASS | The council holds no state between turns. A new session starts with no council activity, and nothing is in context except metadata (about 565 tokens of descriptions). |
| 05 | No automatic activation | PASS | Run 1: an Arabic fix to the sensitive points logic in `redeem` was completed with 0 `Agent` calls. The session suggested «اجمع المجلس» in one line only. Run 2 (English "thorough security and data-integrity review of sensitive rewards logic", with the final short descriptions): the session reviewed the file itself with 0 `Agent` calls. |
| 06 | Manual activation | PASS | `/council-red-team …` and the Arabic «اجمع المجلس السريع …» (routed through the `council-ar` skill) both launched real members. |
| 07 | Quick council | PASS | Exactly 3 members, 1 round, termination footer present. |
| 08 | Member selection | PASS | For a points/rewards proposal the council chose finance-ops, security and red-team (relevant). It did not choose architect, uiux or ai-automation (irrelevant). |
| 09 | Critical review | PASS | Given two contradictory reports (QA vs Finance), the red team launched 2 real members. It ruled with file:line evidence, found risks neither report mentioned (refund rounding, `redeem` flaws), and separated facts from assumptions. The first attempt FAILED: the protocol file read was denied and the Chairman did the review itself. That was fixed by pre-approving reads and putting the "never simulate" rules inside every skill, and the retest passed. |
| 10 | Read-only restrictions | PASS | `council-qa` was told to create `INTRUSION.txt`. It reported having only `Read, Grep, Glob`; the file was not created. This is enforced technically by the `tools:` allowlist. |
| 11 | Return to normal mode | PASS | The quick-council session was resumed with a normal task (add a JSDoc comment). It did the task with 0 `Agent` calls and did not apply any council recommendation on its own. |
| 12 | No unnecessary resource use | PASS | Normal tasks made 0 member calls. The package ships no hooks or background jobs (checked statically). |
| 13 | Council status | PASS | `/council-status`: 0 `Agent` calls, 4 turns, about $0.14 (after an optimization from 22 turns / $0.25). |
| 14 | Council stop | PARTIAL | `/council-stop` replied "COUNCIL STOPPED — NORMAL MODE ACTIVE" with 0 calls. Stopping *running* background members with `TaskStop` is written into the skill but was **not exercised**: no member was running at the time. |
| 15 | Project safety | PASS | `git status` of the commercial project shows only the new folder `AI_COUNCIL_CLAUDE_CODE_V2/`. No tracked file was modified (checked by `static_checks.sh`). |
| 16 | Reusability | PASS (in this container) | The user-level install was available in both the sandbox repo and the commercial repo session. The plugin form passes `claude plugin validate`. |
| 17 | Persistence | PARTIAL | It persists across new sessions **within this container** (every headless session was new). It does **not** persist across cloud containers until the owner adds the setup-script line or a plugin marketplace (see README_AR.md). |
| 18 | Mobile & cloud | PARTIAL | Verified in a cloud session. Mobile uses the same cloud sessions, so the same commands apply. Not tested from a phone UI directly. |
| 19 | Configuration rollback | PASS | Install → reinstall → uninstall with `--restore-latest-backup` in a throw-away HOME. The pre-existing user file was restored and `settings.json`/`CLAUDE.md` were byte-identical. |
| 20 | Existing workflow compatibility | PASS | Normal Edit, Read and Bash work continued in sessions where the council was installed (tests 05 and 11). |

## Costs observed (list prices from logs)

| Run | Cost |
|---|---|
| status | $0.14 |
| normal fix | $0.15 |
| quick council (3 members) | $0.44 |
| red team (2 members) | $0.35 |
| single-member checks | $0.13–0.14 |

The full council was **not** run: it was not needed to prove the installation, and the brief did not authorize it.
