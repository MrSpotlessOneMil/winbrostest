# Auto-Run Tests on Push — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically run `npm run test` before any git push via a Claude Code hook, blocking the push if tests fail.

**Architecture:** A PreToolUse hook in `.claude/settings.json` intercepts Bash commands containing `git push`. The hook runs a shell script that executes `npm run test` and returns `{"decision":"block"}` on failure or `{"decision":"allow"}` on success. This mirrors the existing `route-check.sh` PostToolUse pattern already in the project.

**Tech Stack:** Claude Code hooks (settings.json) + Bash + Vitest (existing)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.claude/hooks/pre-push-tests.sh` | Create | Intercepts Bash tool input, detects `git push`, runs `npm run test`, returns block/allow JSON |
| `.claude/settings.json` | Modify | Add PreToolUse hook entry for Bash commands |

---

## Chunk 1: The Hook

### Task 0: Verify PreToolUse hook mechanics

Before writing the real hook, confirm the input/output format with a diagnostic script.

- [ ] **Step 0a: Create a diagnostic hook script**

Create `.claude/hooks/hook-diagnostic.sh`:

```bash
#!/bin/bash
INPUT=$(cat)
echo "$INPUT" > /tmp/hook-debug.json
exit 0
```

- [ ] **Step 0b: Temporarily register it in settings.json**

Add a temporary PreToolUse entry pointing to the diagnostic script.

- [ ] **Step 0c: Trigger a Bash command via Claude, then inspect /tmp/hook-debug.json**

This reveals the exact JSON structure Claude Code sends to PreToolUse hooks — confirming where `command` and `cwd` live in the payload.

- [ ] **Step 0d: Remove the diagnostic script and revert settings.json**

---

### Task 1: Write the hook script

**Files:**
- Create: `.claude/hooks/pre-push-tests.sh`
- Reference: `.claude/hooks/route-check.sh` (existing pattern to follow)

- [ ] **Step 1: Create the hook script**

The script needs to:
1. Read stdin (Claude Code passes JSON with `tool_name`, `tool_input`, and `cwd`)
2. Extract the `command` field from `tool_input`
3. Validate extraction succeeded (non-empty)
4. Check if the command contains `git push`
5. If yes, run `npm run test` from the project directory
6. If tests fail, output `{"decision":"block","reason":"..."}` with the test output
7. If tests pass, output `{"decision":"allow"}`
8. If command isn't a push, exit 0 (silent allow)

```bash
#!/bin/bash
# Pre-push test gate — runs vitest before allowing git push.
# Claude Code PreToolUse hook for Bash commands.
#
# Note: git push --force is also gated — tests must pass regardless.
# This hook only fires when Claude runs git push, not manual terminal pushes.

set -euo pipefail

INPUT=$(cat)

# Extract the command from tool_input JSON (grep -oP for precise extraction)
COMMAND=$(echo "$INPUT" | grep -oP '"command"\s*:\s*"\K[^"]*' | head -1)

# Validate extraction — block if we can't parse the command
if [[ -z "$COMMAND" ]]; then
  exit 0  # Can't parse, allow through rather than false-block non-push commands
fi

# Only gate git push commands (includes --force, -u, etc.)
if ! echo "$COMMAND" | grep -qE '\bgit\s+push\b'; then
  exit 0
fi

# Extract project directory (cwd is at root level of hook JSON, not inside tool_input)
PROJECT_DIR=$(echo "$INPUT" | grep -oP '"cwd"\s*:\s*"\K[^"]*' | head -1)
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

# Log to stderr for debugging (visible in Claude Code output, not parsed as hook response)
echo "Pre-push hook: running tests..." >&2

# Run tests, capture output
TEST_OUTPUT=$(cd "$UNIX_PROJECT" && npm run test 2>&1) || TEST_EXIT=$?
TEST_EXIT=${TEST_EXIT:-0}

echo "Pre-push hook: tests finished (exit code $TEST_EXIT)" >&2

if [[ "$TEST_EXIT" -ne 0 ]]; then
  # Truncate output to last 40 lines to keep the block reason readable
  TRUNCATED=$(echo "$TEST_OUTPUT" | tail -40)
  # Escape for JSON: backslashes, quotes, then join lines
  ESCAPED=$(printf '%s' "$TRUNCATED" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')

  echo "{\"decision\":\"block\",\"reason\":\"Tests failed — push blocked.\\n\\n${ESCAPED}\\n\\nFix failing tests before pushing.\"}"
else
  echo '{"decision":"allow"}'
fi

exit 0
```

Key improvements over initial draft:
- Uses `grep -oP` for precise JSON field extraction instead of greedy sed
- Validates `COMMAND` and `PROJECT_DIR` are non-empty before proceeding
- Returns explicit `{"decision":"allow"}` on test success (not silent exit)
- Logs to stderr for debugging visibility
- Uses `printf '%s'` instead of `echo` for safer escaping
- Documents that `--force` push is also gated

- [ ] **Step 2: Verify the script exists**

Run: `ls -la .claude/hooks/pre-push-tests.sh`
Expected: file exists

---

### Task 2: Register the hook in settings.json

**Files:**
- Modify: `.claude/settings.json` (add PreToolUse entry alongside existing PostToolUse)

- [ ] **Step 3: Add the PreToolUse hook to settings.json**

The existing file has a `PostToolUse` array for route checks. Add a sibling `PreToolUse` array that matches on `Bash` tool calls and runs the test script.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/pre-push-tests.sh",
            "timeout": 120
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "if": "Edit(*/app/api/**)|Write(*/app/api/**)",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/route-check.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Key details:
- `"matcher": "Bash"` — only fires on Bash tool calls, not Edit/Write/etc.
- `"timeout": 120` — vitest suite takes ~15s but allow headroom for cold start
- The script itself filters to only `git push` commands, so non-push Bash calls pass through instantly

- [ ] **Step 4: Validate the JSON is well-formed**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

---

### Task 3: Verification

- [ ] **Step 5: Dry-run — confirm tests pass**

Run: `npm run test`
Expected: All tests pass (confirms the test suite is healthy before we gate on it)

- [ ] **Step 6: End-to-end verification**

Ask Claude to push code. The hook should:
1. Intercept the push
2. Log "Pre-push hook: running tests..." to stderr
3. Run `npm run test`
4. If tests pass → log exit code 0 → return `{"decision":"allow"}` → push proceeds
5. If tests fail → return `{"decision":"block"}` with truncated test output → push blocked

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/pre-push-tests.sh .claude/settings.json
git commit -m "feat: add pre-push test hook — blocks git push via Claude if vitest fails"
```

---

## Notes

- **This only covers pushes through Claude.** Manual `git push` in terminal is not intercepted. A git pre-push hook (`.git/hooks/pre-push`) or GitHub Actions can be layered on later if needed.
- **Force-push is also gated.** `git push --force` still triggers the test run. Tests must pass regardless of push flags.
- **E2E tests (Playwright) are excluded** — only `npm run test` (vitest unit + integration) runs. E2E tests require a running server and take much longer. This keeps the gate fast (~15s).
- **Timeout is 120s** — generous buffer. If tests consistently take >60s in the future, investigate rather than increasing timeout.
- **`grep -oP` requires GNU grep** — git-bash on Windows ships with GNU grep, so this is safe. If porting to macOS, use `grep -oE` with adjusted patterns.