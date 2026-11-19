#!/usr/bin/env bash
# Local demo, no keys needed: Hardhat node + contracts + the five agents + web on http://127.0.0.1:5180.
# Same story as Fuji; the identity registry, the reputation registry and the price feed are local stand-ins.
set -euo pipefail
cd "$(dirname "$0")/.."
LOG=.demo-logs; mkdir -p "$LOG"
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd packages/contracts && exec npx hardhat node > "../../$LOG/node.log" 2>&1) &
for i in $(seq 1 60); do
  curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' http://127.0.0.1:8545 >/dev/null && break
  sleep 0.5
done
# The local feed starts at the live AVAX price when a public source answers, else 7 USD.
PRICE=$(curl -sf -m 4 'https://api.binance.com/api/v3/ticker/price?symbol=AVAXUSDT' | sed -E 's/.*"price":"([0-9.]+)".*/\1/' || true)
LOCAL_FEED_PRICE=${PRICE:-7} pnpm -s -F @aida/contracts deploy:local
pnpm -s -F @aida/contracts bootstrap:local
(cd packages/agent && CHAIN_ID=31337 exec node src/network.ts > "../../$LOG/network.log" 2>&1) &
sleep 2
echo
echo "AIDA local demo → http://127.0.0.1:5180  (agents :8790-8794, logs in $LOG/). Open Economy → Run, then Attack."
echo "Second terminal: pnpm e2e"
pnpm -F @aida/web dev
