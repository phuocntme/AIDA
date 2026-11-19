#!/usr/bin/env bash
# Fuji demo: the agent network (:8790-8794) + web (http://127.0.0.1:5181) against deployments/43113.json.
# Needs .env.fuji (agent keys). The kill switch needs the guardian: a wallet in the browser, or .env.guardian for
# the demo signer / `pnpm guardian`. Testnet only, never committed.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deployments/43113.json ] || { echo "deployments/43113.json missing: run deploy:fuji + bootstrap:fuji first"; exit 1; }
[ -f .env.fuji ] || { echo ".env.fuji missing (agent keys)"; exit 1; }
LOG=.demo-logs; mkdir -p "$LOG"
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM
FUJI_RPC=${FUJI_RPC_URL:-https://avalanche-fuji-c-chain-rpc.publicnode.com}
printf 'VITE_CHAIN_ID=43113\nVITE_RPC_URL=%s\n' "$FUJI_RPC" > packages/web/.env.fuji.local
(cd packages/agent && FUJI_RPC_URL=$FUJI_RPC exec node src/network.ts > "../../$LOG/network-fuji.log" 2>&1) &
sleep 2
echo "AIDA on Avalanche Fuji → http://127.0.0.1:5181   (agents :8790-8794, log $LOG/network-fuji.log)"
cd packages/web && exec npx vite --mode fuji --host 127.0.0.1 --port 5181 --strictPort
