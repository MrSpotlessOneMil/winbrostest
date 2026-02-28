#!/bin/bash
# Deterministic security checks for API route files.
# Runs as a PostToolUse hook on Edit/Write — validates the resulting file
# against known patterns. Returns JSON with decision:"block" + reason if
# a check fails, giving Claude immediate feedback to fix it.
#
# Checks are deliberately simple greps with near-zero false-positive risk.
# Subjective / data-flow checks stay in CLAUDE.md pre-flight checklist.
#
# ZERO EXTERNAL DEPENDENCIES — no jq, no python, pure bash+grep.

set -euo pipefail

INPUT=$(cat)

# --- Parse JSON fields with sed (no jq dependency) ---
# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
# Extract cwd
PROJECT_DIR=$(echo "$INPUT" | sed -n 's/.*"cwd"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

# Normalise Windows backslashes to forward slashes
FILE_PATH="${FILE_PATH//\\\\//}"
FILE_PATH="${FILE_PATH//\\/\/}"
PROJECT_DIR="${PROJECT_DIR//\\\\//}"
PROJECT_DIR="${PROJECT_DIR//\\/\/}"

# Only check API route files (1-3 levels deep under /app/api/)
[[ "$FILE_PATH" == */app/api/*/route.ts ]] || \
[[ "$FILE_PATH" == */app/api/*/*/route.ts ]] || \
[[ "$FILE_PATH" == */app/api/*/*/*/route.ts ]] || exit 0

# Determine route category from path
if [[ "$FILE_PATH" == */app/api/actions/* ]]; then
  ROUTE_TYPE="action"
elif [[ "$FILE_PATH" == */app/api/cron/* ]]; then
  ROUTE_TYPE="cron"
elif [[ "$FILE_PATH" == */app/api/webhooks/* ]]; then
  ROUTE_TYPE="webhook"
elif [[ "$FILE_PATH" == */app/api/automation/* ]]; then
  ROUTE_TYPE="automation"
elif [[ "$FILE_PATH" == */app/api/admin/* ]]; then
  ROUTE_TYPE="admin"
else
  exit 0
fi

# Verify project root
if [[ -z "$PROJECT_DIR" ]]; then
  exit 0
fi

# Convert to unix path for git-bash / MSYS2
to_unix_path() {
  local p="$1"
  if [[ "$p" =~ ^[A-Za-z]:/ ]]; then
    local drive
    drive=$(echo "${p:0:1}" | tr '[:upper:]' '[:lower:]')
    echo "/${drive}${p:2}"
  else
    echo "$p"
  fi
}

UNIX_PROJECT=$(to_unix_path "$PROJECT_DIR")
UNIX_FILE=$(to_unix_path "$FILE_PATH")

if [[ ! -f "$UNIX_PROJECT/vercel.json" ]]; then
  exit 0  # Can't find project root, skip rather than false-positive
fi

if [[ ! -f "$UNIX_FILE" ]]; then
  exit 0  # File doesn't exist yet (Write creating new), skip
fi

FAILS=()

fail() {
  FAILS+=("$1")
}

# Read file content once
CONTENT=$(cat "$UNIX_FILE")

# ===========================================================================
# ACTION ROUTE CHECKS
# ===========================================================================
if [[ "$ROUTE_TYPE" == "action" ]]; then

  # 1. Must call requireAuthWithTenant
  if ! echo "$CONTENT" | grep -q 'requireAuthWithTenant'; then
    fail "Action route missing requireAuthWithTenant() call"
  fi

  # 2. Must check instanceof NextResponse after auth
  if echo "$CONTENT" | grep -q 'requireAuthWithTenant'; then
    if ! echo "$CONTENT" | grep -q 'instanceof NextResponse'; then
      fail "Action route missing 'instanceof NextResponse' check after auth"
    fi
  fi

# ===========================================================================
# CRON ROUTE CHECKS
# ===========================================================================
elif [[ "$ROUTE_TYPE" == "cron" ]]; then

  # 1. Must verify cron auth
  if ! echo "$CONTENT" | grep -qE 'verifyCronAuth|CRON_SECRET'; then
    fail "Cron route missing auth verification (verifyCronAuth or CRON_SECRET check)"
  fi

  # 2. Must use service client — but only if the file does direct Supabase DB access
  #    Orchestrator crons that delegate to lib functions don't need it in the route
  #    Match Supabase chaining: .from('table'), .rpc('func') — not Array.from()
  if echo "$CONTENT" | grep -qE "\.(from|rpc)\s*\(\s*'"; then
    if ! echo "$CONTENT" | grep -qE 'getSupabaseServiceClient|getSupabaseClient'; then
      fail "Cron route does direct DB access but doesn't instantiate service client"
    fi
  fi

  # 3. Must be registered in vercel.json (unless marked as a sub-cron)
  #    Files with "route-check:no-vercel-cron" comment are sub-crons called by another cron
  if ! echo "$CONTENT" | grep -q 'route-check:no-vercel-cron'; then
    CRON_NAME=""
    if [[ "$FILE_PATH" =~ /app/api/cron/([^/]+)/ ]]; then
      CRON_NAME="${BASH_REMATCH[1]}"
    fi
    if [[ -n "$CRON_NAME" ]]; then
      if ! grep -q "/api/cron/${CRON_NAME}" "$UNIX_PROJECT/vercel.json"; then
        fail "Cron route '${CRON_NAME}' not registered in vercel.json — it will never run in production. If this is a sub-cron called by another route, add a comment: // route-check:no-vercel-cron"
      fi
    fi
  fi

# ===========================================================================
# WEBHOOK ROUTE CHECKS
# ===========================================================================
elif [[ "$ROUTE_TYPE" == "webhook" ]]; then

  # 1. Must NOT use requireAuthWithTenant (webhooks have no user session)
  if echo "$CONTENT" | grep -q 'requireAuthWithTenant'; then
    fail "Webhook route must NOT use requireAuthWithTenant — webhooks have no user session"
  fi

  # 2. Must use service client (skip thin delegator files < 30 lines)
  if ! echo "$CONTENT" | grep -qE 'getSupabaseServiceClient|getSupabaseClient'; then
    LINE_COUNT=$(echo "$CONTENT" | wc -l | tr -d ' ')
    if [[ "$LINE_COUNT" -gt 30 ]]; then
      fail "Webhook route must use service client (getSupabaseServiceClient or getSupabaseClient)"
    fi
  fi

  # 3. Stripe webhooks must check stripe_processed_events for idempotency
  if [[ "$FILE_PATH" == */webhooks/stripe/* ]]; then
    if ! echo "$CONTENT" | grep -q 'stripe_processed_events'; then
      # Skip thin delegator files that call processStripeEvent
      if ! echo "$CONTENT" | grep -q 'processStripeEvent'; then
        fail "Stripe webhook missing idempotency check (stripe_processed_events table)"
      fi
    fi
  fi

# ===========================================================================
# AUTOMATION ROUTE CHECKS
# ===========================================================================
elif [[ "$ROUTE_TYPE" == "automation" ]]; then

  # 1. Must have some auth check
  if ! echo "$CONTENT" | grep -qE 'verifyCronAuth|CRON_SECRET|requireAuth'; then
    fail "Automation route missing auth verification"
  fi

fi

# ===========================================================================
# UNIVERSAL CHECKS (all route types)
# ===========================================================================

# Fetch timeout: if file uses raw fetch(), it should have AbortController
if echo "$CONTENT" | grep -qE '\bfetch\s*\('; then
  if ! echo "$CONTENT" | grep -q 'AbortController'; then
    fail "Route uses fetch() but has no AbortController timeout — all external calls need 10-15s timeout"
  fi
fi

# ===========================================================================
# REPORT
# ===========================================================================
if [[ ${#FAILS[@]} -gt 0 ]]; then
  # Build reason string
  REASON="Route check failed for ${ROUTE_TYPE} route:"
  for f in "${FAILS[@]}"; do
    REASON+=$'\n'"  - ${f}"
  done
  REASON+=$'\n\n'"Fix these issues before continuing."

  # Escape for JSON: backslashes, quotes, newlines
  ESCAPED=$(echo "$REASON" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')

  echo "{\"decision\":\"block\",\"reason\":\"${ESCAPED}\"}"
fi

exit 0