#!/usr/bin/env bash
# החצר usage, read-only: people, yards, activity (D1) and the free-tier meters (Cloudflare GraphQL).
#   bash scripts/chatzer-stats.sh
# Needs CLOUDFLARE_ACCOUNT_ID; in the cloud dev environment the proxy injects the real token.
set -euo pipefail
cd "$(dirname "$0")/../server"

q() {
  npx wrangler d1 execute chatzer --remote --env chatzer --json --command "$1" 2>&1 | python3 -c '
import sys, json, re
t = sys.stdin.read()
m = re.search(r"^\[\s*\{", t, re.M)
if not m: print(t[-600:]); sys.exit(1)
for r in json.loads(t[m.start():])[0]["results"]: print("  ", r)'
}
D="(strftime('%s','now')-86400)*1000"
W="(strftime('%s','now')-7*86400)*1000"

echo "People and yards"
q "SELECT (SELECT COUNT(*) FROM identities) ducks, (SELECT COUNT(*) FROM identities WHERE created_at > $W) new_7d, (SELECT COUNT(*) FROM groups) yards, (SELECT COUNT(*) FROM groups WHERE created_at > $W) yards_7d, (SELECT COUNT(*) FROM members WHERE removed_at IS NULL) memberships, (SELECT COUNT(DISTINCT member_id) FROM members WHERE removed_at IS NULL) in_yards"
echo "Activity"
q "SELECT (SELECT COUNT(*) FROM events WHERE created_at > $D) events_24h, (SELECT COUNT(DISTINCT author_id) FROM events WHERE created_at > $D) active_24h, (SELECT COUNT(DISTINCT author_id) FROM events WHERE created_at > $W) active_7d, (SELECT COUNT(*) FROM push_subs) push_phones, (SELECT COUNT(*) FROM vaults) saves, (SELECT COUNT(*) FROM reminders) reminders_waiting, (SELECT COALESCE(SUM(bytes),0) FROM groups) photo_bytes"
echo "Per day (last 14 days)"
q "SELECT date(created_at/1000,'unixepoch') day, COUNT(*) events, COUNT(DISTINCT author_id) people, COUNT(DISTINCT group_id) yards FROM events WHERE created_at > (strftime('%s','now')-14*86400)*1000 GROUP BY day ORDER BY day"

echo "Free-tier meters, last 24h (Workers free: 100k requests/day; D1 free: 5M rows read, 100k written/day; R2: 10 GB, 1M class A, 10M class B/month)"
npx wrangler d1 info chatzer --env chatzer 2>/dev/null | grep -E "database_size|rows_read_24h|rows_written_24h" || true
S=$(date -u -d '-24 hours' +%Y-%m-%dT%H:%M:%SZ)
E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s https://api.cloudflare.com/client/v4/graphql -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-proxy-injected}" -H 'Content-Type: application/json' \
  --data "{\"query\":\"query(\$a:String!,\$s:Time!,\$e:Time!){viewer{accounts(filter:{accountTag:\$a}){workersInvocationsAdaptive(limit:10,filter:{datetime_geq:\$s,datetime_leq:\$e}){sum{requests errors} dimensions{scriptName}} r2StorageAdaptiveGroups(limit:5,filter:{datetime_geq:\$s,datetime_leq:\$e}){max{payloadSize objectCount} dimensions{bucketName}}}}}\",\"variables\":{\"a\":\"$CLOUDFLARE_ACCOUNT_ID\",\"s\":\"$S\",\"e\":\"$E\"}}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if d.get("errors"): print("  ", d["errors"]); sys.exit()
a = d["data"]["viewer"]["accounts"][0]
for r in a["workersInvocationsAdaptive"]: print("   worker", r["dimensions"]["scriptName"], r["sum"])
for r in a["r2StorageAdaptiveGroups"]: print("   r2", r["dimensions"]["bucketName"], r["max"])'
