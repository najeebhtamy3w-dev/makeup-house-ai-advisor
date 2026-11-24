#!/usr/bin/env bash
# AI COUNCIL V2 — safe installer.
# Usage:
#   ./install.sh                 install for the current user  (~/.claude)
#   ./install.sh --project DIR   install into DIR/.claude      (project scope)
#   ./install.sh --dry-run       show what would happen
# It never edits settings.json, CLAUDE.md, hooks, or any project source file.
# Existing council-* files are backed up before being replaced.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${HOME}/.claude"; DRY=0
while [ $# -gt 0 ]; do case "$1" in
  --project) TARGET="$(cd "$2" && pwd)/.claude"; shift 2;;
  --dry-run) DRY=1; shift;;
  -h|--help) sed -n '2,8p' "$0"; exit 0;;
  *) echo "unknown option: $1" >&2; exit 2;;
esac; done
STATE="$TARGET/ai-council"; TS="$(date +%Y%m%d-%H%M%S)"; BK="$STATE/backups/$TS"
run() { if [ $DRY = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
echo "AI Council $(cat "$SRC/VERSION") -> $TARGET"
run mkdir -p "$TARGET/agents" "$TARGET/skills" "$STATE"
# back up foreign files we are about to replace (files we installed earlier are not backed up)
PREV="$STATE/INSTALLED_FILES"; ours(){ [ -f "$PREV" ] && grep -qxF "$1" "$PREV"; }
for f in "$SRC"/agents/council-*.md; do
  rel="agents/$(basename "$f")"; t="$TARGET/$rel"
  [ -e "$t" ] && ! ours "$rel" && { run mkdir -p "$BK/agents"; run cp -p "$t" "$BK/agents/"; }
done
for d in "$SRC"/skills/council*; do
  rel="skills/$(basename "$d")"; t="$TARGET/$rel"
  [ -e "$t" ] && ! ours "$rel" && { run mkdir -p "$BK/skills"; run cp -rp "$t" "$BK/skills/"; }
done
# install
MAN="$STATE/INSTALLED_FILES"; [ $DRY = 1 ] || : > "$MAN"
for f in "$SRC"/agents/council-*.md; do
  run cp "$f" "$TARGET/agents/"; [ $DRY = 1 ] || echo "agents/$(basename "$f")" >> "$MAN"
done
for d in "$SRC"/skills/council*; do
  n="$(basename "$d")"; run rm -rf "$TARGET/skills/$n"; run cp -r "$d" "$TARGET/skills/$n"
  [ $DRY = 1 ] || echo "skills/$n" >> "$MAN"
done
run cp "$SRC/VERSION" "$STATE/VERSION"
[ $DRY = 1 ] || { [ -d "$BK" ] && echo "backup: $BK" || echo "backup: none needed (fresh install)"; }
echo "done. Restart Claude Code (or start a new session) so new agents are loaded. Try: /council-status"
