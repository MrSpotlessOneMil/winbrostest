#!/bin/bash
# Pre-push test gate — runs vitest before allowing git push.
# Claude Code PreToolUse hook for Bash commands.
#
# Note: git push --force is also gated — tests must pass regardless.
# This hook only fires when Claude runs git push, not manual terminal pushes.

set -euo pipefail

INPUT=$(cat)

# Use node for reliable JSON parsing (sed breaks on escaped quotes in commands)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
eval $(echo "$INPUT" | node "$SCRIPT_DIR/parse-hook-input.js")

COMMAND="${HOOK_COMMAND:-}"
PROJECT_DIR="${HOOK_CWD:-}"

# If we can't parse the command, allow through (don't false-block non-push commands)
if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Only gate git push commands (includes --force, -u, etc.)
if ! echo "$COMMAND" | grep -qE '\bgit\s+push\b'; then
  exit 0
fi

# Normalize Windows backslashes in project dir
PROJECT_DIR="${PROJECT_DIR//\\\\//}"
PROJECT_DIR="${PROJECT_DIR//\\/\/}"

if [[ -z "$PROJECT_DIR" ]]; then
  echo '{"decision":"block","reason":"Pre-push hook: could not determine project directory."}'
  exit 0
fi

# Convert Windows path for git-bash
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

# Run tests, capture output
TEST_OUTPUT=$(cd "$UNIX_PROJECT" && npm run test 2>&1) || TEST_EXIT=$?
TEST_EXIT=${TEST_EXIT:-0}

if [[ "$TEST_EXIT" -ne 0 ]]; then
  # Use node to safely build JSON (avoids escaping issues with Windows paths in test output)
  BLOCK_JSON=$(echo "$TEST_OUTPUT" | tail -30 | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      const reason='Tests failed — push blocked.\\n\\n'+d+'\\n\\nRun npm run test to see full output. Fix failing tests before pushing.';
      console.log(JSON.stringify({decision:'block',reason:reason}));
    });
  ")
  echo "$BLOCK_JSON"
else
  echo '{"decision":"allow"}'
fi

exit 0