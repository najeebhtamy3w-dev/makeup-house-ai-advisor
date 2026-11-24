#!/usr/bin/env bash
# AI COUNCIL V2 — offline acceptance checks (no model calls, zero token cost).
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0; fail=0
ok(){ echo "PASS  $1"; pass=$((pass+1)); }; ko(){ echo "FAIL  $1"; fail=$((fail+1)); }
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else ko "$1"; fi; }

# T01 installation package integrity
chk "T01 nine agent definitions" '[ $(ls "$SRC"/agents/council-*.md | wc -l) -eq 9 ]'
chk "T01 eight skills" '[ $(ls -d "$SRC"/skills/council* | wc -l) -eq 8 ]'
chk "T01 plugin.json valid JSON" 'python3 -m json.tool "$SRC/.claude-plugin/plugin.json"'
chk "T01 marketplace.json valid JSON" 'python3 -m json.tool "$SRC/.claude-plugin/marketplace.json"'
for f in "$SRC"/agents/council-*.md; do n=$(basename "$f" .md)
  chk "T01 $n frontmatter name matches file" 'grep -q "^name: $n$" "$f"'
  # T10 read-only enforcement is technical: tools allowlist only Read, Grep, Glob
  chk "T10 $n tools = Read, Grep, Glob only" '[ "$(grep -m1 "^tools:" "$f")" = "tools: Read, Grep, Glob" ]'
done
# T04/T05/T12 manual-only: every slash skill disables model invocation
for d in "$SRC"/skills/council*; do n=$(basename "$d")
  [ "$n" = council-ar ] && continue
  chk "T05 $n disable-model-invocation: true" 'grep -q "^disable-model-invocation: true$" "$d/SKILL.md"'
done
chk "T05 council-ar guarded to explicit commands" 'grep -q "Invoke ONLY when the owner" "$SRC/skills/council-ar/SKILL.md"'
# T12 no hooks / background activity shipped
chk "T12 package ships no hooks or settings" '! grep -rlE "\"hooks\"|SessionStart|PreToolUse|PostToolUse" "$SRC/agents" "$SRC/skills" "$SRC/.claude-plugin"'
chk "T13 status skill forbids Agent tool" 'grep -q "Do NOT call the \`Agent\` tool" "$SRC/skills/council-status/SKILL.md"'
chk "T11 protocol has termination footer" 'grep -q "RETURNED TO NORMAL MODE" "$SRC/skills/council/PROTOCOL.md"'
chk "T—  no secrets in package" '! grep -rniE "(api[_-]?key|secret|token)\s*[:=]\s*[A-Za-z0-9_\-]{12,}" "$SRC" --exclude-dir=tests'

# T19 install -> uninstall round-trip with backup restore, in a throw-away HOME
TMPH=$(mktemp -d); mkdir -p "$TMPH/.claude/agents"
echo "user's own pre-existing file" > "$TMPH/.claude/agents/council-qa.md"
echo '{"keep":"me"}' > "$TMPH/.claude/settings.json"; echo "# my rules" > "$TMPH/.claude/CLAUDE.md"
before=$(cd "$TMPH/.claude" && cat settings.json CLAUDE.md | sha256sum)
HOME="$TMPH" "$SRC/install.sh" >/dev/null
chk "T19 install placed 9 agents" '[ $(ls "$TMPH"/.claude/agents/council-*.md | wc -l) -eq 9 ]'
chk "T19 install backed up pre-existing file" 'grep -rq "pre-existing" "$TMPH/.claude/ai-council/backups"'
chk "T19 settings.json & CLAUDE.md untouched" '[ "$(cd "$TMPH/.claude" && cat settings.json CLAUDE.md | sha256sum)" = "$before" ]'
HOME="$TMPH" "$SRC/install.sh" >/dev/null
chk "T19 reinstall (update) idempotent" '[ $(ls -d "$TMPH"/.claude/skills/council* | wc -l) -eq 8 ]'
HOME="$TMPH" "$SRC/uninstall.sh" --restore-latest-backup >/dev/null
chk "T19 uninstall removed skills" '[ $(ls -d "$TMPH"/.claude/skills/council* 2>/dev/null | wc -l) -eq 0 ]'
chk "T19 uninstall restored original file" 'grep -q "pre-existing" "$TMPH/.claude/agents/council-qa.md"'
chk "T19 settings.json & CLAUDE.md still untouched" '[ "$(cd "$TMPH/.claude" && cat settings.json CLAUDE.md | sha256sum)" = "$before" ]'
rm -rf "$TMPH"

# T15 project safety: when run inside a git repo, nothing outside the package changed
if top=$(git -C "$SRC" rev-parse --show-toplevel 2>/dev/null); then
  rel=$(realpath --relative-to="$top" "$SRC")
  chk "T15 no tracked project file modified" '[ -z "$(git -C "$top" status --porcelain -- . ":(exclude)$rel")" ]'
fi
echo "---- $pass passed, $fail failed"; [ $fail -eq 0 ]
