#!/bin/bash
# Phase A/B/D/F Shipped Files Freeze — PreToolUse on Edit/Write.
#
# These files were shipped 2026-04-27 as part of Dominic's WinBros day-goals
# (plan: ~/.claude/plans/shiny-napping-donut.md). They cover live behaviors:
#
#   - Day-off approval flow (Phase A)
#   - Standardized create-quote popup (Phase B)
#   - Job-drawer manual actions + editable line prices (Phase D)
#   - 12.5% appointment-set commission pipeline (Phase F)
#   - The 14-day-advance time-off rule (frozen by Dominic — do NOT touch)
#
# Block Edit/Write unless PHASE_SHIPPED_UNFROZEN=1 is set in the session.
#
# To unfreeze for a single change:
#   1. Confirm with Dominic in-session.
#   2. export PHASE_SHIPPED_UNFROZEN=1
#   3. Make the edit.
#   4. Tighten regression tests so the new behavior is locked.
#
# ZERO EXTERNAL DEPENDENCIES — pure bash + grep + sed.

set -euo pipefail

INPUT=$(cat)

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

# Kill switch
if [[ "${PHASE_SHIPPED_UNFROZEN:-0}" == "1" ]]; then
  exit 0
fi

FROZEN_LIST="${PROJECT_DIR}/.claude/hooks/phase-shipped-frozen-paths.txt"
[[ -f "$FROZEN_LIST" ]] || exit 0

REL_PATH="${FILE_PATH#${PROJECT_DIR}/}"

while IFS= read -r pattern; do
  [[ -z "$pattern" || "$pattern" =~ ^# ]] && continue

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
  "reason": "FROZEN (Phase A/B/D/F shipped 2026-04-27): $REL_PATH (matched: $MATCHED).\n\nThis file backs a live shipped feature. Confirm the change with Dominic in this session, then either:\n  - export PHASE_SHIPPED_UNFROZEN=1 and retry, OR\n  - extend regression tests in tests/unit/winbros/ to cover the new behavior first.\n\nDo NOT bypass without explicit approval."
}
EOF
  exit 0
fi

exit 0
