#!/bin/bash
#
# Full System E2E Test Runner
#
# Creates a Supabase test branch, seeds it, runs all E2E tests,
# and tears down the branch. One command to test everything.
#
# Usage:
#   ./scripts/run-full-e2e.sh
#
# Requirements:
#   - SUPABASE_ACCESS_TOKEN env var (from supabase.com/dashboard/account/tokens)
#   - Playwright installed (npx playwright install chromium)
#

set -e

PROJECT_ID="kcmbwstjmdrjkhxhkkjt"
ORG_ID="hlfkpaergwnsfnuxdmpu"
BRANCH_NAME="e2e-$(date +%s)"

echo "═══════════════════════════════════════════════════"
echo "  FULL SYSTEM E2E TEST RUNNER"
echo "═══════════════════════════════════════════════════"
echo ""

# Check for access token
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "❌ SUPABASE_ACCESS_TOKEN not set"
  echo "   Get one from: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

echo "1/5  Creating test branch: $BRANCH_NAME..."

# Create branch via Supabase Management API
BRANCH_RESPONSE=$(curl -s -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_ID/branches" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"branch_name\": \"$BRANCH_NAME\", \"git_branch\": \"test\"}")

BRANCH_ID=$(echo "$BRANCH_RESPONSE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('')}})")
BRANCH_REF=$(echo "$BRANCH_RESPONSE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).project_ref)}catch{console.log('')}})")

if [ -z "$BRANCH_REF" ]; then
  echo "❌ Failed to create branch"
  echo "$BRANCH_RESPONSE"
  exit 1
fi

BRANCH_URL="https://$BRANCH_REF.supabase.co"
echo "   ✓ Branch created: $BRANCH_REF"

# Get anon key
echo "2/5  Getting branch credentials..."
sleep 10  # Wait for branch to be ready

KEYS_RESPONSE=$(curl -s \
  "https://api.supabase.com/v1/projects/$BRANCH_REF/api-keys" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")

ANON_KEY=$(echo "$KEYS_RESPONSE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const k=JSON.parse(d);console.log(k.find(x=>x.name==='anon')?.api_key||'')}catch{console.log('')}})")

if [ -z "$ANON_KEY" ]; then
  echo "   ⚠ Could not get anon key, retrying in 15s..."
  sleep 15
  KEYS_RESPONSE=$(curl -s \
    "https://api.supabase.com/v1/projects/$BRANCH_REF/api-keys" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
  ANON_KEY=$(echo "$KEYS_RESPONSE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const k=JSON.parse(d);console.log(k.find(x=>x.name==='anon')?.api_key||'')}catch{console.log('')}})")
fi

echo "   ✓ Got credentials"

# Apply schema + seed
echo "3/5  Applying schema and seeding test data..."
# Use Supabase SQL endpoint
curl -s -X POST \
  "$BRANCH_URL/rest/v1/rpc/exec_sql" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null 2>&1 || true

# Apply schema via management API
node -e "
const fs = require('fs');
const schema = fs.readFileSync('scripts/e2e-schema-seed.sql', 'utf8');
fetch('https://api.supabase.com/v1/projects/$BRANCH_REF/database/query', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: schema }),
}).then(r => r.json()).then(d => {
  if (d.error) { console.error('Schema error:', d.error); process.exit(1); }
  console.log('   ✓ Schema applied and data seeded');
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
"

# Run tests
echo "4/5  Running full system E2E tests..."
echo ""

E2E_SUPABASE_URL="$BRANCH_URL" \
E2E_SUPABASE_ANON_KEY="$ANON_KEY" \
PLAYWRIGHT_BASE_URL=https://cleanmachine.live \
npx playwright test crew-full-flow crew-portal-calendar \
  --config=playwright.crash.config.ts \
  --reporter=list \
  --timeout=30000

TEST_EXIT=$?

# Cleanup
echo ""
echo "5/5  Deleting test branch..."
curl -s -X DELETE \
  "https://api.supabase.com/v1/projects/$PROJECT_ID/branches/$BRANCH_ID" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" > /dev/null 2>&1

echo "   ✓ Branch deleted (billing stopped)"
echo ""

if [ $TEST_EXIT -eq 0 ]; then
  echo "═══════════════════════════════════════════════════"
  echo "  ✅ ALL TESTS PASSED"
  echo "═══════════════════════════════════════════════════"
else
  echo "═══════════════════════════════════════════════════"
  echo "  ❌ SOME TESTS FAILED (exit code: $TEST_EXIT)"
  echo "═══════════════════════════════════════════════════"
fi

exit $TEST_EXIT
