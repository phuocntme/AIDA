#!/usr/bin/env bash
# Real Fuji demo: the agent network (:8790-8794) + web (http://127.0.0.1:5181) against deployments/43113.json.
# Needs .env.fuji with AGENT_KEY_* (created by bootstrap:fuji). Testnet only, never committed.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deployments/43113.json ] || { echo "deployments/43113.json missing: run deploy:fuji + bootstrap:fuji first"; exit 1; }
set -a; . ./.env.fuji; set +a
LOG=.demo-logs; mkdir -p "$LOG"
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM
FUJI_RPC=${FUJI_RPC_URL:-https://avalanche-fuji-c-chain-rpc.publicnode.com}
# No demo accounts: on Fuji you connect your own Core / MetaMask wallet. Agents run as real services.
printf 'VITE_CHAIN_ID=43113\nVITE_RPC_URL=%s\nVITE_ORACLE_URL=http://127.0.0.1:8790\n' "$FUJI_RPC" > packages/web/.env.fuji.local
(cd packages/agent && FUJI_RPC_URL=$FUJI_RPC exec node src/network.ts > "../../$LOG/network-fuji.log" 2>&1) &
sleep 2
echo "AIDA on Avalanche Fuji → http://127.0.0.1:5181   (agents :8790-8794, log $LOG/network-fuji.log)"
cd packages/web && exec npx vite --mode fuji --host 127.0.0.1 --port 5181 --strictPort
