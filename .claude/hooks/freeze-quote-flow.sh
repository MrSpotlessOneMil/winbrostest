#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# freeze-quote-flow.sh
# PreToolUse guard. Blocks Edit / Write / NotebookEdit on the quote-flow
# surface that Dominic froze on 2026-04-16. Unfreezing requires an
# explicit ask from Dominic, then deleting this hook.
#
# Exit 0 → allow. Exit 2 → block (stderr is surfaced back to the agent).
# Zero external deps — pure bash + sed (matches route-check.sh style).
# ─────────────────────────────────────────────────────────────────────

set -u

INPUT="$(cat)"

# Extract file_path (or notebook_path) using sed — no jq dependency.
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$FILE_PATH" ]; then
  FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
fi
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Normalise Windows backslashes to forward slashes for suffix match.
NORMALIZED="${FILE_PATH//\\\\//}"
NORMALIZED="${NORMALIZED//\\/\/}"

FROZEN=(
  "apps/house-cleaning/lib/service-scope.ts"
  "apps/house-cleaning/lib/quote-pricing.ts"
  "apps/house-cleaning/lib/quote-invoice.ts"
  "packages/core/src/service-scope.ts"
  "packages/core/src/quote-pricing.ts"
  "packages/core/src/quote-invoice.ts"
  "apps/house-cleaning/app/api/quotes/[token]/route.ts"
  "apps/house-cleaning/app/api/actions/quotes/route.ts"
  "apps/house-cleaning/app/api/crew/[token]/new-quote/route.ts"
  "apps/house-cleaning/app/quote/[token]/page.tsx"
  "apps/house-cleaning/app/(dashboard)/jobs/page.tsx"
  "apps/house-cleaning/app/(dashboard)/quotes/page.tsx"
  "tests/quote-pricing-inclusion.test.ts"
)

for frozen in "${FROZEN[@]}"; do
  case "$NORMALIZED" in
    *"$frozen")
      cat >&2 <<EOF
BLOCKED: "$FILE_PATH" is on Dominic's FROZEN quote-flow list.

This surface was locked on 2026-04-16 after the included-addons fix was
verified and shipped. Invoice, customer quote page, cleaner checklist
and pricing rule all line up — regressions here are expensive.

Do NOT modify unless Dominic has EXPLICITLY asked for a change to the
quote flow in his most recent prompt. If he has not, STOP and ask him
first, even if the change looks safe or trivial.

If he has authorised the change:
  1. Quote his exact instruction back to him in your reply.
  2. Ask him to either (a) unfreeze temporarily by deleting
     .claude/hooks/freeze-quote-flow.sh, or (b) reply "unfreeze for
     this edit" so you can proceed with a one-off bypass.

Frozen files:
EOF
      printf '  - %s\n' "${FROZEN[@]}" >&2
      exit 2
      ;;
  esac
done

exit 0
