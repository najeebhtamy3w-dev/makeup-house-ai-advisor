#!/usr/bin/env bash
# AI COUNCIL V2 — uninstaller. Removes only files the installer recorded.
#   ./uninstall.sh [--project DIR] [--restore-latest-backup]
set -euo pipefail
TARGET="${HOME}/.claude"; RESTORE=0
while [ $# -gt 0 ]; do case "$1" in
  --project) TARGET="$(cd "$2" && pwd)/.claude"; shift 2;;
  --restore-latest-backup) RESTORE=1; shift;;
  *) echo "unknown option: $1" >&2; exit 2;;
esac; done
STATE="$TARGET/ai-council"; MAN="$STATE/INSTALLED_FILES"
[ -f "$MAN" ] || { echo "no AI Council install recorded in $TARGET"; exit 0; }
while read -r rel; do
  case "$rel" in agents/council-*.md|skills/council*) rm -rf "${TARGET:?}/$rel"; echo "removed $rel";; esac
done < "$MAN"
if [ $RESTORE = 1 ] && [ -d "$STATE/backups" ]; then
  last="$(ls -1 "$STATE/backups" | sort | tail -1)"
  if [ -n "$last" ]; then
    [ -d "$STATE/backups/$last/agents" ] && cp -p "$STATE/backups/$last/agents/"* "$TARGET/agents/"
    [ -d "$STATE/backups/$last/skills" ] && cp -rp "$STATE/backups/$last/skills/"* "$TARGET/skills/"
    echo "restored backup $last"
  fi
fi
rm -f "$MAN" "$STATE/VERSION"
rmdir "$TARGET/agents" "$TARGET/skills" 2>/dev/null || true
echo "AI Council uninstalled from $TARGET (backups kept in $STATE/backups if any)."
