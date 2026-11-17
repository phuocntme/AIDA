#!/usr/bin/env bash
# E2E on a running local demo: low-reputation agent refused, trusted agent pays via x402 and rates the Oracle.
set -euo pipefail
cd "$(dirname "$0")/../packages/agent"
K1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # Hardhat test key #1 (TranslatorVN owner)
K2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a # Hardhat test key #2 (SpamBot owner)
echo "== SpamBot 9000 (#2) asks for a report on #1 =="
if CALLER_PRIVATE_KEY=$K2 node src/client.ts --as 2 --target 1; then echo "FAIL: spam bot was served"; exit 1; fi
echo; echo "== TranslatorVN (#1) asks for a report on #2, then rates the Oracle 95 =="
CALLER_PRIVATE_KEY=$K1 node src/client.ts --as 1 --target 2 --rate 95
echo; echo "E2E OK"
