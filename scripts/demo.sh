#!/usr/bin/env bash
# One command local demo: Hardhat node + deploy + seed + Trust Oracle + web (http://127.0.0.1:5180)
set -euo pipefail
cd "$(dirname "$0")/.."
LOG=.demo-logs; mkdir -p "$LOG"
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd packages/contracts && exec npx hardhat node > "../../$LOG/node.log" 2>&1) &
for i in $(seq 1 40); do
  curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' http://127.0.0.1:8545 >/dev/null && break
  sleep 0.5
done
pnpm -s -F @aida/contracts deploy:local
pnpm -s -F @aida/contracts seed:local
(cd packages/agent && exec node src/server.ts > "../../$LOG/oracle.log" 2>&1) &
sleep 1
echo
echo "AIDA demo ready → http://127.0.0.1:5180   (oracle http://127.0.0.1:8787, logs in $LOG/)"
pnpm -F @aida/web dev
