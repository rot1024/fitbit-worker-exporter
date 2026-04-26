#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <from:YYYY-MM-DD> <to:YYYY-MM-DD> [sleep_seconds]"
  echo "Example: $0 2026-04-01 2026-04-30"
  exit 1
fi

FROM="$1"
TO="$2"
SLEEP_SEC="${3:-60}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEV_VARS="$SCRIPT_DIR/../.dev.vars"

if [ ! -f "$DEV_VARS" ]; then
  echo "Error: .dev.vars not found at $DEV_VARS"
  exit 1
fi

WORKER_URL="$(grep -E '^WORKER_URL=' "$DEV_VARS" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"

if [ -z "${WORKER_URL:-}" ]; then
  echo "Error: WORKER_URL not set in .dev.vars"
  exit 1
fi

WORKER_URL="${WORKER_URL%/}"

if ! date -j -f "%Y-%m-%d" "$FROM" "+%s" >/dev/null 2>&1; then
  echo "Error: invalid from date: $FROM"
  exit 1
fi
if ! date -j -f "%Y-%m-%d" "$TO" "+%s" >/dev/null 2>&1; then
  echo "Error: invalid to date: $TO"
  exit 1
fi

START_TS="$(date -j -f "%Y-%m-%d" "$FROM" "+%s")"
END_TS="$(date -j -f "%Y-%m-%d" "$TO" "+%s")"

if [ "$START_TS" -gt "$END_TS" ]; then
  echo "Error: from must be <= to"
  exit 1
fi

TOTAL_DAYS=$(( (END_TS - START_TS) / 86400 + 1 ))

echo "Backfill via Worker"
echo "==================="
echo "Worker:   $WORKER_URL"
echo "Range:    $FROM .. $TO  ($TOTAL_DAYS days)"
echo "Sleep:    ${SLEEP_SEC}s between requests"
echo ""
echo "⚠️  Prerequisites:"
echo "  1. workers.dev subdomain must be ENABLED"
echo "     (Cloudflare Dashboard > Worker > Settings > Domains & Routes)"
echo "     Or run: npx wrangler deploy  (uses wrangler.toml workers_dev=true)"
echo "  2. DEBUG_MODE secret must be set to \"true\""
echo "     Check: npx wrangler secret list"
echo ""
echo "🔒 After backfill: disable workers.dev subdomain again from the Dashboard"
echo "   to keep /fetch unreachable from the public internet."
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

FAILED=()
COUNT=0
TS="$START_TS"

while [ "$TS" -le "$END_TS" ]; do
  COUNT=$((COUNT + 1))
  D="$(date -j -f "%s" "$TS" "+%Y-%m-%d")"

  printf "[%d/%d] %s ... " "$COUNT" "$TOTAL_DAYS" "$D"

  HTTP_CODE="$(curl -s -o /tmp/backfill-resp.json -w "%{http_code}" "$WORKER_URL/fetch?date=$D" || echo "000")"
  BODY="$(cat /tmp/backfill-resp.json 2>/dev/null || echo "")"

  if [ "$HTTP_CODE" = "200" ]; then
    echo "OK  $BODY"
  else
    echo "FAIL ($HTTP_CODE)  $BODY"
    FAILED+=("$D")
  fi

  TS=$((TS + 86400))

  if [ "$TS" -le "$END_TS" ]; then
    sleep "$SLEEP_SEC"
  fi
done

echo ""
echo "========== Summary =========="
echo "Total:   $COUNT"
echo "Success: $((COUNT - ${#FAILED[@]}))"
echo "Failed:  ${#FAILED[@]}"
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo ""
  echo "Failed dates:"
  for d in "${FAILED[@]}"; do
    echo "  $d"
  done
fi

echo ""
echo "🔒 Reminder: disable the workers.dev subdomain from the Cloudflare Dashboard"
echo "   (Worker > Settings > Domains & Routes) to lock down /fetch again."
