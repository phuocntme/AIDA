#!/usr/bin/env bash
# End-to-end check on a running local demo (`pnpm demo` in another terminal):
# paid jobs with on-chain scores, the attack that the contract reverts, the kill switch.
set -euo pipefail
cd "$(dirname "$0")/.."
export CHAIN_ID=31337
OUT=$(mktemp)
say() { printf '\n== %s ==\n' "$1"; }
run() { pnpm -s -F @aida/agent "$@" | tee "$OUT"; }

say "1. Treasury Bot buys quotes: pays through AgentPolicy, the contract scores each quote"
run hire --rounds 3
grep -q "paid 0.0005 AVAX" "$OUT" || { echo "FAIL: no payment"; exit 1; }
grep -q "computed on-chain" "$OUT" || { echo "FAIL: no on-chain score"; exit 1; }

say "2. Attack: unlisted recipient and over-cap amount"
run hire --attack
grep -q "AgentPolicy reverted: RecipientNotAllowed" "$OUT" || { echo "FAIL: whitelist did not stop it"; exit 1; }
grep -q "AgentPolicy reverted: OverPerPaymentCap" "$OUT" || { echo "FAIL: cap did not stop it"; exit 1; }
grep -q "0 AVAX left the policy" "$OUT" || { echo "FAIL: money moved"; exit 1; }

say "3. Kill switch: the guardian pauses, the next run is refused by the contract"
pnpm -s -F @aida/agent guardian pause
run hire --rounds 1
grep -q "run refused" "$OUT" || { echo "FAIL: paused bot was not refused"; exit 1; }
pnpm -s -F @aida/agent guardian resume

say "E2E OK"
