#!/bin/bash
# Retargeting Freeze Hook — PreToolUse on Edit/Write.
#
# OUTREACH-SPEC v1.0 Section 14. Blocks edits to files listed in
# `.claude/hooks/retargeting-frozen-paths.txt` unless the session has
# RETARGETING_UNFROZEN=1 set in the environment.
#
# Activated at Stage 5 (after the new pipelines are green in prod) by
# adding this script to .claude/settings.json under hooks.PreToolUse.
#
# To unfreeze for a single change:
#   1. Dominic confirms in-session.
#   2. export RETARGETING_UNFROZEN=1
#   3. Update Change Log in docs/OUTREACH-SPEC.md Section 17.
#   4. Retry the edit.
#
# ZERO EXTERNAL DEPENDENCIES — pure bash + grep + sed.

set -euo pipefail

INPUT=$(cat)

# Extract file_path
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
PROJECT_DIR=$(echo "$INPUT" | sed -n 's/.*"cwd"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

# Normalise Windows paths
FILE_PATH="${FILE_PATH//\\\\//}"
FILE_PATH="${FILE_PATH//\\/\/}"
PROJECT_DIR="${PROJECT_DIR//\\\\//}"
PROJECT_DIR="${PROJECT_DIR//\\/\/}"

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Kill switch: RETARGETING_UNFROZEN=1 disables the freeze for this session
if [[ "${RETARGETING_UNFROZEN:-0}" == "1" ]]; then
  exit 0
fi

FROZEN_LIST="${PROJECT_DIR}/.claude/hooks/retargeting-frozen-paths.txt"
[[ -f "$FROZEN_LIST" ]] || exit 0

# Convert absolute FILE_PATH to a project-relative path for matching
REL_PATH="${FILE_PATH#${PROJECT_DIR}/}"

# Check each frozen path pattern (glob-like — grep as substring)
while IFS= read -r pattern; do
  # Skip blanks and comments
  [[ -z "$pattern" || "$pattern" =~ ^# ]] && continue

  # Exact match or prefix match (treat trailing * as wildcard)
  if [[ "$pattern" == *"*" ]]; then
    prefix="${pattern%\*}"
    if [[ "$REL_PATH" == "$prefix"* ]]; then
      MATCHED="$pattern"
      break
    fi
  else
    if [[ "$REL_PATH" == "$pattern" ]]; then
      MATCHED="$pattern"
      break
    fi
  fi
done < "$FROZEN_LIST"

if [[ -n "${MATCHED:-}" ]]; then
  cat <<EOF
{
  "decision": "block",
  "reason": "FROZEN: $REL_PATH is part of the retargeting spec (matched pattern: $MATCHED).\n\nTo edit:\n  1. Confirm the change with Dominic in-session.\n  2. export RETARGETING_UNFROZEN=1\n  3. Add a row to the Change Log in winbrostest/docs/OUTREACH-SPEC.md Section 17.\n  4. Retry the edit.\n\nDo NOT bypass this without Dominic's explicit verbal approval."
}
EOF
  exit 0
fi

exit 0
