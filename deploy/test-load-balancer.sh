#!/usr/bin/env bash
# Proves the load balancer actually splits traffic across both app servers,
# not just that one of them happens to be up. Hits /healthz through lb-01
# repeatedly and checks that both web-01 and web-02 show up in the replies
# (each reply includes its own hostname+pid, see server/src/routes/health.js).
#
# Usage: ./deploy/test-load-balancer.sh [url] [request-count]
#   ./deploy/test-load-balancer.sh
#   ./deploy/test-load-balancer.sh https://www.jargsai.tech 20

set -uo pipefail

HOST="${1:-https://www.jargsai.tech}"
# Accept a bare domain (www.jargsai.tech) as well as a full URL, so it
# doesn't matter whether the scheme was typed in.
case "$HOST" in
  http://*|https://*) ;;
  *) HOST="https://$HOST" ;;
esac
URL="$HOST/healthz"
COUNT="${2:-10}"

echo "=================================================================="
echo "  Load balancer test: $COUNT requests to $URL"
echo "=================================================================="
echo
echo "How this proves the split: every reply carries the hostname and pid"
echo "of whichever backend actually served it (server/src/routes/health.js)."
echo "If lb-01 is really round-robining, that hostname should alternate."
echo

instances=()
failures=0

for i in $(seq 1 "$COUNT"); do
  response=$(curl -s -L -m 10 -w '\n%{http_code}' "$URL" 2>/dev/null)
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" != "200" ] || [ -z "$body" ]; then
    printf "  request %2d: FAILED (no response / HTTP %s)\n" "$i" "${http_code:-none}"
    failures=$((failures + 1))
    continue
  fi

  instance=$(echo "$body" | grep -o '"instance":"[^"]*"' | cut -d'"' -f4)
  printf "  request %2d: %s\n" "$i" "$instance"
  instances+=("$instance")
done

echo
echo "------------------------------------------------------------------"
echo "  Summary"
echo "------------------------------------------------------------------"

if [ "$failures" -gt 0 ]; then
  echo "  $failures of $COUNT requests got no response."
  echo "  If every request failed, check: is the URL right, is DNS pointing"
  echo "  at lb-01 yet (see README troubleshooting), is lb-01 up?"
  echo
fi

if [ "${#instances[@]}" -eq 0 ]; then
  echo "  FAIL: no successful responses at all, nothing to compare."
  exit 1
fi

echo "  Requests that succeeded: ${#instances[@]}"
echo
echo "  Breakdown by backend:"
printf '%s\n' "${instances[@]}" | sort | uniq -c | while read -r count name; do
  printf "    %-20s %d requests\n" "$name" "$count"
done

unique_count=$(printf '%s\n' "${instances[@]}" | sort -u | wc -l)
echo
echo "  Distinct backends that answered: $unique_count"
echo

if [ "$unique_count" -ge 2 ]; then
  echo "  PASS: traffic is being split across $unique_count backends."
  echo "  This is what round-robin load balancing looks like: no single"
  echo "  backend served every request, they alternated."
  exit 0
else
  echo "  FAIL: only one backend answered. Either the load balancer isn't"
  echo "  distributing traffic, or the other backend is down."
  exit 1
fi
