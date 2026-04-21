#!/usr/bin/env bash
# verify-ad-url.sh — sanity-curl a Meta ad landing URL before creating the ad creative.
#
# Exits 0 if the URL returns 200 (following redirects).
# Exits 1 if it doesn't, printing the status code so you know what broke.
#
# Meant to be called by Claude (or anyone) before `create_ad_creative` via
# the Pipeboard MCP. The 2026-04-20 incident would have been prevented if
# this check had run for each of the 8 URLs I created.
#
# Usage:
#   ./scripts/verify-ad-url.sh "https://spotlessscrubbers.org/post-construction?utm_source=meta"
#
# Batch mode (one URL per line on stdin):
#   cat urls.txt | ./scripts/verify-ad-url.sh --stdin

set -u

if [[ "${1:-}" == "--stdin" ]]; then
  fail=0
  while IFS= read -r url; do
    [[ -z "$url" ]] && continue
    code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 15 "$url" || echo "000")
    if [[ "$code" == "200" ]]; then
      echo "OK   $code  $url"
    else
      echo "FAIL $code  $url"
      fail=1
    fi
  done
  exit "$fail"
fi

url="${1:-}"
if [[ -z "$url" ]]; then
  echo "Usage: $0 <url>   or   $0 --stdin <<< 'urls...'" >&2
  exit 2
fi

code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 15 "$url" || echo "000")
if [[ "$code" == "200" ]]; then
  echo "OK   $code  $url"
  exit 0
fi
echo "FAIL $code  $url" >&2
exit 1
